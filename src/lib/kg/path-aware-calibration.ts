// ── D6 phase 2 · Path-aware edge calibration ────────────────────────
//
// Closes the gap between the existing first-pass calibration
// (apply-confidence-from-deviation.ts) and what the original critique
// in docs/KG_DEPTH_CRITIQUE.md §9 D6 specified. The first pass:
//   - Updates a fixed set of "strategy-relevant" entities + edges
//     between them (heuristic, path-blind)
//   - Uses a small fixed delta per deviation_tag (no magnitude weighting)
//   - Only updates `confidence`, NOT `strength` (the field MC propagates)
//
// This module routes updates THROUGH the actual causal path that
// produced the prediction:
//   1. Find the SINK entity (tracker → entity resolution; or via
//      tracker_id → metric_label fuzzy match when no link exists)
//   2. Reverse-BFS from sink along directed-causal edges to find the
//      causal path that produced the prediction
//   3. Compute relative error from numeric prediction vs actual:
//        relative_error = |actual - predicted| / max(|predicted|, ε)
//   4. Apply per-edge deltas with hop-distance decay:
//        edge at hop 1 (incident to sink) → full base delta
//        edge at hop N → base × DECAY^(N-1)
//   5. Persist EACH update to edge_calibrations as audit row, then
//      apply the update to the edges row (strength + confidence)
//
// Soft-fail throughout: tracker→entity resolution missing → return
// {applied: false, reason: "no_sink_entity"}; path-finding failure →
// "no_causal_path"; database error → "db_error". The legacy
// applyConfidenceFromDeviation runs FIRST as a fallback safety-net;
// THIS module runs SECOND and only fires when path resolution succeeds.
//
// Pure-ish: takes a Supabase client, returns a result. No SSE events,
// no LLM calls.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviationTag } from "@/types/prediction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── Tunables ────────────────────────────────────────────────────────

/** Numerator floor when computing relative_error to avoid divide-by-zero
 *  amplification on near-zero predictions. */
const RELATIVE_ERROR_DENOM_FLOOR = 1e-3;

/** Per-hop decay factor for delta magnitude. Edge incident to the sink
 *  gets 1.0× base; one-hop-upstream gets DECAY×; etc. With DECAY=0.7
 *  and a 4-hop path, the upstream-most edge sees ~24% of the base
 *  delta — capped enough that we don't blame a remote root cause for
 *  a downstream surprise. */
const HOP_DECAY = 0.7;

/** Maximum path depth to walk backward from the sink. Beyond this,
 *  the causal contribution is too diluted to attribute responsibly. */
const MAX_PATH_DEPTH = 4;

/** Cap on absolute base delta. Surprise + relative_error=2.0 produces
 *  a base of -0.15; this cap ensures even an extreme combined miss
 *  can't push an edge off the [0.05, 0.98] cliff in one update. */
const MAX_ABS_BASE_DELTA_STRENGTH = 0.15;
const MAX_ABS_BASE_DELTA_CONFIDENCE = 0.10;

/** Clamps applied AFTER the delta — repeated updates can't drive past
 *  these. Mirrors the first-pass calibrator's bounds for consistency. */
const STRENGTH_MIN = 0.05;
const STRENGTH_MAX = 0.99;
const CONFIDENCE_MIN = 0.05;
const CONFIDENCE_MAX = 0.98;

// ── I/O ─────────────────────────────────────────────────────────────

export interface PredictionRowForCalibration {
  id: string;
  space_id: string;
  strategy_snapshot_id: string | null;
  tracker_id: string | null;
  metric_label: string;
  predicted_value: number | null;
  resolved_actual: number | null;
  deviation: number | null;
  deviation_tag: DeviationTag | null;
}

export interface PathCalibrationResult {
  applied: boolean;
  reason:
    | "ok"
    | "qualitative_no_score"
    | "no_numeric_actual"
    | "no_sink_entity"
    | "no_causal_path"
    | "db_error"
    | "tag_skipped";
  base_delta_strength: number;
  base_delta_confidence: number;
  relative_error: number | null;
  edges_updated: number;
  audit_rows_inserted: number;
  path_depth: number;
}

// ── Public entry ────────────────────────────────────────────────────

export async function runPathAwareCalibration(
  db: AnyDb,
  prediction: PredictionRowForCalibration,
): Promise<PathCalibrationResult> {
  const result: PathCalibrationResult = {
    applied: false,
    reason: "ok",
    base_delta_strength: 0,
    base_delta_confidence: 0,
    relative_error: null,
    edges_updated: 0,
    audit_rows_inserted: 0,
    path_depth: 0,
  };

  const tag = prediction.deviation_tag;
  if (!tag || tag === "qualitative") {
    result.reason = "qualitative_no_score";
    return result;
  }
  if (
    typeof prediction.predicted_value !== "number" ||
    typeof prediction.resolved_actual !== "number"
  ) {
    result.reason = "no_numeric_actual";
    return result;
  }

  // 1. Compute relative error
  const denom = Math.max(
    Math.abs(prediction.predicted_value),
    RELATIVE_ERROR_DENOM_FLOOR,
  );
  const relativeError =
    Math.abs(prediction.resolved_actual - prediction.predicted_value) / denom;
  result.relative_error = relativeError;

  // 2. Compute base deltas
  const { dStrength, dConfidence } = computeBaseDelta(tag, relativeError);
  result.base_delta_strength = dStrength;
  result.base_delta_confidence = dConfidence;

  if (dStrength === 0 && dConfidence === 0) {
    result.reason = "tag_skipped";
    return result;
  }

  // 3. Resolve sink entity from tracker
  const sinkEntityId = await resolveSinkEntity(db, {
    spaceId: prediction.space_id,
    trackerId: prediction.tracker_id,
    metricLabel: prediction.metric_label,
  });
  if (!sinkEntityId) {
    result.reason = "no_sink_entity";
    return result;
  }

  // 4. Walk reverse-BFS along directed-causal edges from sink to find
  //    contributing path
  const path = await findCausalPath(db, {
    spaceId: prediction.space_id,
    sinkEntityId,
  });
  if (path.length === 0) {
    result.reason = "no_causal_path";
    return result;
  }
  result.path_depth = Math.max(...path.map((e) => e.position));

  // 5. Apply per-edge updates with hop decay; audit each
  const auditRows: Array<{
    space_id: string;
    edge_id: string;
    prediction_id: string;
    strategy_snapshot_id: string | null;
    delta_strength: number;
    delta_confidence: number;
    pre_strength: number | null;
    pre_confidence: number | null;
    deviation_tag: DeviationTag;
    relative_error: number;
    path_position: number;
    rationale: string;
    method: "path_aware_v1";
  }> = [];

  for (const e of path) {
    const decay = Math.pow(HOP_DECAY, e.position - 1);
    const dS = clampSignSafe(dStrength * decay, MAX_ABS_BASE_DELTA_STRENGTH);
    const dC = clampSignSafe(
      dConfidence * decay,
      MAX_ABS_BASE_DELTA_CONFIDENCE,
    );
    if (dS === 0 && dC === 0) continue;

    const newStrength =
      typeof e.current_strength === "number"
        ? clamp(e.current_strength + dS, STRENGTH_MIN, STRENGTH_MAX)
        : null;
    const newConfidence =
      typeof e.current_confidence === "number"
        ? clamp(e.current_confidence + dC, CONFIDENCE_MIN, CONFIDENCE_MAX)
        : null;

    // Skip if neither value would move
    if (
      (newStrength === null ||
        Math.abs(newStrength - (e.current_strength ?? 0)) < 1e-6) &&
      (newConfidence === null ||
        Math.abs(newConfidence - (e.current_confidence ?? 0)) < 1e-6)
    ) {
      continue;
    }

    // Apply update to the edge row
    const updates: Record<string, unknown> = {};
    if (newStrength !== null) updates.strength = newStrength;
    if (newConfidence !== null) updates.confidence = newConfidence;

    const { error: updErr } = await db
      .from("edges")
      .update(updates)
      .eq("id", e.edge_id);

    if (updErr) {
      console.warn(
        `[path-aware-calibration] edge ${e.edge_id} update failed (non-fatal):`,
        updErr.message ?? updErr,
      );
      continue;
    }
    result.edges_updated += 1;

    auditRows.push({
      space_id: prediction.space_id,
      edge_id: e.edge_id,
      prediction_id: prediction.id,
      strategy_snapshot_id: prediction.strategy_snapshot_id,
      delta_strength: newStrength !== null ? newStrength - (e.current_strength ?? 0) : 0,
      delta_confidence:
        newConfidence !== null
          ? newConfidence - (e.current_confidence ?? 0)
          : 0,
      pre_strength: e.current_strength ?? null,
      pre_confidence: e.current_confidence ?? null,
      deviation_tag: tag,
      relative_error: relativeError,
      path_position: e.position,
      rationale: `${tag} | rel_err=${relativeError.toFixed(2)} | hop ${e.position} → dS=${(newStrength !== null ? newStrength - (e.current_strength ?? 0) : 0).toFixed(3)} dC=${(newConfidence !== null ? newConfidence - (e.current_confidence ?? 0) : 0).toFixed(3)}`,
      method: "path_aware_v1",
    });
  }

  // 6. Persist audit rows in one batch
  if (auditRows.length > 0) {
    try {
      const { error: insErr } = await db
        .from("edge_calibrations")
        .insert(auditRows);
      if (!insErr) {
        result.audit_rows_inserted = auditRows.length;
      } else {
        console.warn(
          "[path-aware-calibration] audit insert failed (non-fatal):",
          insErr.message ?? insErr,
        );
      }
    } catch (err) {
      console.warn(
        "[path-aware-calibration] audit insert threw (non-fatal):",
        err,
      );
    }
  }

  result.applied = result.edges_updated > 0;
  return result;
}

// ── Sink entity resolution ──────────────────────────────────────────

async function resolveSinkEntity(
  db: AnyDb,
  input: {
    spaceId: string;
    trackerId: string | null;
    metricLabel: string;
  },
): Promise<string | null> {
  // Strategy 1: tracker_id → metric_trackers.source_entity_id (if column exists).
  // metric_trackers schema is mature; the `source_entity_id` link may or
  // may not be populated — soft-fail to strategy 2.
  if (input.trackerId) {
    try {
      const { data: trackerRow } = await db
        .from("metric_trackers")
        .select("source_entity_id, target_entity_id")
        .eq("id", input.trackerId)
        .maybeSingle();
      const row = trackerRow as
        | {
            source_entity_id?: string | null;
            target_entity_id?: string | null;
          }
        | null;
      // Prefer target_entity_id (the metric IS the outcome); fall back
      // to source_entity_id (the metric measures something upstream).
      const candidate = row?.target_entity_id ?? row?.source_entity_id ?? null;
      if (candidate) return candidate;
    } catch {
      // Soft-fail
    }
  }

  // Strategy 2: fuzzy match metric_label against entity names in space.
  // Token-overlap heuristic — cheap and good enough for "engagement"
  // → "User Engagement" cases.
  try {
    const { data: entityRows } = await db
      .from("entities")
      .select("id, name")
      .eq("space_id", input.spaceId);
    const rows = (entityRows ?? []) as Array<{ id: string; name: string }>;
    const labelTokens = tokenize(input.metricLabel);
    let best: { id: string; score: number } | null = null;
    for (const ent of rows) {
      const ents = tokenize(ent.name);
      const overlap = jaccard(labelTokens, ents);
      if (overlap >= 0.5 && (!best || overlap > best.score)) {
        best = { id: ent.id, score: overlap };
      }
    }
    return best?.id ?? null;
  } catch {
    return null;
  }
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ── Causal path discovery ──────────────────────────────────────────

interface PathEdge {
  edge_id: string;
  source_entity_id: string;
  target_entity_id: string;
  position: number; // 1 = incident to sink
  current_strength: number | null;
  current_confidence: number | null;
}

async function findCausalPath(
  db: AnyDb,
  input: { spaceId: string; sinkEntityId: string },
): Promise<PathEdge[]> {
  // Load all causal/functional/contributory edges in the space
  const { data: edgeRows } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, dimension, relationship_type, strength, confidence",
    )
    .eq("space_id", input.spaceId);

  type EdgeRow = {
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    dimension: string | null;
    relationship_type: string | null;
    strength: number | null;
    confidence: number | null;
  };

  const allEdges = (edgeRows ?? []) as EdgeRow[];

  // Filter to causal-relevant edges (causal/functional dimensions, plus
  // relationship_types that imply influence). Skip purely structural
  // (composes, has-property, etc.) since they don't carry propagation.
  const CAUSAL_DIMENSIONS = new Set(["causal", "functional", "temporal"]);
  const CAUSAL_RELS = new Set([
    "causes",
    "contributes-to",
    "enables",
    "inhibits",
    "mediates",
    "moderates",
    "constrains",
    "amplifies",
    "reduces",
    "drives",
    "influences",
    "modulates",
    "targets",
    "measures",
  ]);

  const causalEdges = allEdges.filter(
    (e) =>
      (e.dimension && CAUSAL_DIMENSIONS.has(e.dimension)) ||
      (e.relationship_type && CAUSAL_RELS.has(e.relationship_type)),
  );

  // Build reverse-adjacency: target_entity_id → array of incoming edges
  const reverseAdj = new Map<string, EdgeRow[]>();
  for (const e of causalEdges) {
    const bucket = reverseAdj.get(e.target_entity_id) ?? [];
    bucket.push(e);
    reverseAdj.set(e.target_entity_id, bucket);
  }

  // BFS reverse from sink
  const visited = new Set<string>([input.sinkEntityId]);
  const result: PathEdge[] = [];
  let frontier: string[] = [input.sinkEntityId];
  let depth = 1;

  while (frontier.length > 0 && depth <= MAX_PATH_DEPTH) {
    const next: string[] = [];
    for (const node of frontier) {
      const incoming = reverseAdj.get(node) ?? [];
      for (const e of incoming) {
        // Skip self-loops
        if (e.source_entity_id === e.target_entity_id) continue;
        // Don't re-add the edge if we've already accounted for it
        if (result.some((r) => r.edge_id === e.id)) continue;

        result.push({
          edge_id: e.id,
          source_entity_id: e.source_entity_id,
          target_entity_id: e.target_entity_id,
          position: depth,
          current_strength: e.strength,
          current_confidence: e.confidence,
        });

        if (!visited.has(e.source_entity_id)) {
          visited.add(e.source_entity_id);
          next.push(e.source_entity_id);
        }
      }
    }
    frontier = next;
    depth += 1;
  }

  return result;
}

// ── Delta formula ───────────────────────────────────────────────────

function computeBaseDelta(
  tag: DeviationTag,
  relativeError: number,
): { dStrength: number; dConfidence: number } {
  // Strength delta — magnitude-weighted by relative_error.
  // Confidence delta — fixed by tag (same as legacy heuristic) but with
  // a small magnitude-aware bonus so a 200%-off surprise shifts more
  // than a 60%-off surprise.

  let dStrength: number;
  let dConfidence: number;

  switch (tag) {
    case "expected": {
      // Reinforce. relative_error already small (else it wouldn't be
      // "expected"). Capped reinforcement.
      dStrength = +0.02;
      dConfidence = +0.01;
      break;
    }
    case "regime_shift": {
      // De-rate proportional to magnitude. relative_error is in
      // [0.10, 0.50] for this tag; map to [-0.04, -0.10] strength.
      const magnitudeFactor = Math.min(1, relativeError / 0.5);
      dStrength = -0.04 - 0.06 * magnitudeFactor;
      dConfidence = -0.02 - 0.02 * magnitudeFactor;
      break;
    }
    case "surprise": {
      // Strong de-rate. relative_error >= 0.5 (else not "surprise").
      // Map to [-0.08, -0.15] strength.
      const magnitudeFactor = Math.min(1, (relativeError - 0.5) / 1.5);
      dStrength = -0.08 - 0.07 * magnitudeFactor;
      dConfidence = -0.05 - 0.05 * magnitudeFactor;
      break;
    }
    default: {
      dStrength = 0;
      dConfidence = 0;
    }
  }

  return {
    dStrength: clamp(
      dStrength,
      -MAX_ABS_BASE_DELTA_STRENGTH,
      MAX_ABS_BASE_DELTA_STRENGTH,
    ),
    dConfidence: clamp(
      dConfidence,
      -MAX_ABS_BASE_DELTA_CONFIDENCE,
      MAX_ABS_BASE_DELTA_CONFIDENCE,
    ),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function clampSignSafe(n: number, max: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > max) return max;
  if (n < -max) return -max;
  return n;
}
