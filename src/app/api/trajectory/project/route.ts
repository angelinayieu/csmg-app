// POST /api/trajectory/project
//
// Phase 1 trajectory-engine entry point. Composes existing primitives
// — `simulateEntityChain` (which already walks the subgraph from the
// target, runs Monte Carlo, applies temporal ramps from edge
// onset/peak/persistence_days_p50, and emits a per-week trajectory)
// + `persistTrajectory` (which writes the result to prediction_ledger
// with prediction_kind="trajectory") — into a single endpoint the UI
// can hit with a structured intent.
//
// Body:
//   {
//     spaceId: string                // owner check
//     targetEntityId: string         // display id (e.g. "C5") OR uuid; resolved server-side
//     interventionEntityId?: string  // optional — when omitted, projects the prior trajectory
//     interventionMagnitude?: number // priorMean override on the intervention entity. Default 0.5.
//     horizonWeeks: number           // 1..52
//     iterations?: number            // MC iterations. Default 500 (fast). Max 2000.
//     depthHops?: number             // 1..6, default 3
//     metricLabel?: string           // human label for the metric. Falls back to entity name.
//     goalId?: string | null         // active goal id when the trajectory targets a goal metric
//     rationale?: string             // free-text reasoning. Falls back to a constructed default.
//   }
//
// Response:
//   {
//     ok: true,
//     predictionId: string,
//     trajectory: WeeklyTrajectoryEntry[],
//     targetDistribution: { p10, p50, p90, mean, stddev } | null,
//     nodeCount: number,
//     edgeCount: number,
//     gateDecisions: GateDecision[],     // any conditional edges that fired
//     basisEdgeIds: string[],            // edges in the simulated subgraph
//   }
//
// Soft-fail discipline: if the subgraph extraction fails or the target
// isn't found, we surface the simulator's `error` string in a 422 — the
// UI can render a useful message ("target not found in this space")
// instead of a generic 500.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import { simulateEntityChain } from "@/lib/simulation/simulate-entity-chain";
import { persistTrajectory } from "@/lib/trajectory/persist-trajectory";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ProjectBody {
  spaceId?: string;
  targetEntityId?: string;
  interventionEntityId?: string | null;
  interventionMagnitude?: number;
  horizonWeeks?: number;
  iterations?: number;
  depthHops?: number;
  metricLabel?: string;
  goalId?: string | null;
  rationale?: string;
}

const DEFAULT_ITERATIONS = 500;
const MAX_ITERATIONS = 2000;
const MIN_HORIZON = 1;
const MAX_HORIZON = 52;
const DEFAULT_MAGNITUDE = 0.5;

export async function POST(request: NextRequest) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body, error: bodyErr } = await safeJsonParse<ProjectBody>(
    request,
  );
  if (bodyErr) return bodyErr;

  // ── Validate body ──────────────────────────────────────────────
  const spaceId = (body?.spaceId ?? "").trim();
  const targetEntityIdRaw = (body?.targetEntityId ?? "").trim();
  const horizonWeeks = body?.horizonWeeks ?? 0;

  if (!spaceId) {
    return NextResponse.json(
      { error: "spaceId required" },
      { status: 400 },
    );
  }
  if (!targetEntityIdRaw) {
    return NextResponse.json(
      { error: "targetEntityId required" },
      { status: 400 },
    );
  }
  if (
    !Number.isFinite(horizonWeeks) ||
    horizonWeeks < MIN_HORIZON ||
    horizonWeeks > MAX_HORIZON
  ) {
    return NextResponse.json(
      { error: `horizonWeeks must be in [${MIN_HORIZON}, ${MAX_HORIZON}]` },
      { status: 400 },
    );
  }

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const iterations = clampInt(body?.iterations ?? DEFAULT_ITERATIONS, 50, MAX_ITERATIONS);
  const depthHops = clampInt(body?.depthHops ?? 3, 1, 6);
  const interventionEntityIdRaw =
    typeof body?.interventionEntityId === "string"
      ? body.interventionEntityId.trim() || null
      : null;
  const interventionMagnitude =
    typeof body?.interventionMagnitude === "number" &&
    Number.isFinite(body.interventionMagnitude)
      ? body.interventionMagnitude
      : DEFAULT_MAGNITUDE;

  // ── Resolve display IDs to UUIDs ───────────────────────────────
  // simulateEntityChain expects entity UUIDs. The UI typically holds
  // display ids ("C5") so we resolve here. Accept either.
  const { targetUuid, interventionUuid, targetName, interventionName } =
    await resolveEntityIdsForSpace(
      db,
      spaceId,
      targetEntityIdRaw,
      interventionEntityIdRaw,
    );

  if (!targetUuid) {
    return NextResponse.json(
      {
        error: `target entity "${targetEntityIdRaw}" not found in space ${spaceId}`,
      },
      { status: 404 },
    );
  }
  if (interventionEntityIdRaw && !interventionUuid) {
    return NextResponse.json(
      {
        error: `intervention entity "${interventionEntityIdRaw}" not found in space ${spaceId}`,
      },
      { status: 404 },
    );
  }

  // ── Compose perturbations map ──────────────────────────────────
  // simulate-entity-chain does the actual perturbation injection at
  // the NodeSpec level. We just hand it the magnitude per intervention.
  const perturbations = new Map<string, { priorMean?: number; priorStdDev?: number }>();
  if (interventionUuid) {
    perturbations.set(interventionUuid, { priorMean: interventionMagnitude });
  }

  // Shared seed so baseline + variant Gaussian draws cancel between
  // the two p50 samples — the per-week delta then reflects the
  // perturbation alone, not sampling noise. (Same trick simulateVariantLift
  // uses for scalar lift estimates.)
  const sharedSeed = 7919;

  // ── Run the variant simulation (perturbation applied if any) ────
  const simResult = await simulateEntityChain(db, {
    spaceId,
    targetEntityId: targetUuid,
    depthHops,
    iterations,
    perturbations,
    weeklyHorizon: horizonWeeks,
    integrator: "discrete",
    seed: sharedSeed,
  });

  if (simResult.error) {
    return NextResponse.json(
      { error: simResult.error, code: "subgraph_extraction_failed" },
      { status: 422 },
    );
  }
  if (!simResult.simulation.trajectory || simResult.simulation.trajectory.length === 0) {
    return NextResponse.json(
      {
        error:
          "simulation produced no per-week trajectory — check that horizonWeeks is set and the subgraph contains at least the target entity",
        code: "empty_trajectory",
      },
      { status: 422 },
    );
  }

  // ── Counterfactual: also run the baseline (no perturbation) ──────
  // Only meaningful when an intervention was specified — otherwise the
  // primary run IS the baseline. Same subgraph, same seed; the per-week
  // delta is structurally caused by the perturbation.
  let baselineTrajectory: typeof simResult.simulation.trajectory | null = null;
  let baselineDistribution: typeof simResult.targetDistribution | null = null;
  if (interventionUuid) {
    const baselineRes = await simulateEntityChain(db, {
      spaceId,
      targetEntityId: targetUuid,
      depthHops,
      iterations,
      // No perturbations — this is the counterfactual "what if we did nothing"
      weeklyHorizon: horizonWeeks,
      integrator: "discrete",
      seed: sharedSeed,
    });
    if (!baselineRes.error && baselineRes.simulation.trajectory) {
      baselineTrajectory = baselineRes.simulation.trajectory;
      baselineDistribution = baselineRes.targetDistribution;
    }
    // Soft-fail: if the baseline pass errors, still return the variant
    // (the chart degrades gracefully — just shows variant alone).
  }

  // ── Persist to prediction_ledger ────────────────────────────────
  const horizonAt = new Date(
    Date.now() + horizonWeeks * 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const metricLabel =
    body?.metricLabel?.trim() || targetName || targetEntityIdRaw;

  const rationale =
    body?.rationale?.trim() ||
    buildDefaultRationale({
      metricLabel,
      interventionName,
      interventionMagnitude,
      horizonWeeks,
      iterations,
      nodeCount: simResult.nodeCount,
      edgeCount: simResult.edgeCount,
    });

  // Confidence at predict-time: derive from target's stddev relative
  // to its prior magnitude — wide bands → low confidence. Falls back
  // to 0.6 when target distribution is missing.
  const td = simResult.targetDistribution;
  const confidence = td
    ? Math.max(0.2, Math.min(0.95, 1 - Math.min(1, (td.stddev ?? 0.5) / Math.max(0.5, Math.abs(td.p50 ?? 1)))))
    : 0.6;

  // Basis edges: load the actual edges in the simulated subgraph so
  // (a) calibration can later reweight them and (b) the gap classifier
  // can identify which ones are widening the bands. simulateEntityChain
  // doesn't currently surface edges, so we re-fetch them here. Cheap
  // relative to the MC pass.
  const basisEdges = await fetchSubgraphBasisEdges(
    db,
    spaceId,
    targetUuid,
    depthHops,
  );
  const basisEdgeIds = basisEdges.map((e) => e.id);
  const gaps = classifyGaps(basisEdges);

  const persistResult = await persistTrajectory(db, {
    spaceId,
    userId: user.id,
    metricLabel,
    targetEntityId: targetEntityIdRaw,
    interventionEntityId: interventionEntityIdRaw,
    interventionMagnitude,
    basisEdgeIds,
    rationale,
    confidence,
    horizonAt,
    goalId: body?.goalId ?? null,
    simulation: simResult.simulation,
    simulator: "monte_carlo_discrete",
  });

  // Lift summary — the user-visible answer to "did this intervention
  // matter?" liftAbsolute is the p50 delta in target units; liftPct
  // normalizes by baseline magnitude (floored at 0.01 so we don't
  // explode on near-zero baselines).
  let lift: {
    absolute: number;
    pct: number;
    significant: boolean;
  } | null = null;
  if (baselineDistribution && simResult.targetDistribution) {
    const liftAbsolute = simResult.targetDistribution.p50 - baselineDistribution.p50;
    const denom = Math.max(Math.abs(baselineDistribution.p50), 0.01);
    const liftPct = liftAbsolute / denom;
    // "Significant" = absolute lift exceeds the noise band (the wider
    // of the two stddevs). Cheap heuristic — the real significance
    // test would be a paired-sample t over the raw sample arrays.
    const noiseFloor = Math.max(
      simResult.targetDistribution.stddev,
      baselineDistribution.stddev,
    );
    lift = {
      absolute: liftAbsolute,
      pct: liftPct,
      significant: Math.abs(liftAbsolute) > noiseFloor,
    };
  }

  return NextResponse.json({
    ok: true,
    predictionId: persistResult.predictionId,
    trajectory: simResult.simulation.trajectory,
    baselineTrajectory,
    targetDistribution: simResult.targetDistribution,
    baselineDistribution,
    lift,
    nodeCount: simResult.nodeCount,
    edgeCount: simResult.edgeCount,
    gateDecisions: simResult.gateDecisions,
    basisEdgeIds,
    gaps,
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

/**
 * Resolve a display id ("C5") OR UUID to its UUID + canonical name.
 * Returns nulls when the entity doesn't exist in the given space.
 */
async function resolveEntityIdsForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  targetIdOrCode: string,
  interventionIdOrCode: string | null,
): Promise<{
  targetUuid: string | null;
  targetName: string | null;
  interventionUuid: string | null;
  interventionName: string | null;
}> {
  const idsToResolve = [targetIdOrCode];
  if (interventionIdOrCode) idsToResolve.push(interventionIdOrCode);

  // Fetch by either UUID or display entity_id, whichever matches.
  // OR-filter: id.eq.<x>,entity_id.eq.<x>
  // Run two queries (one for UUID-shaped values, one for display ids)
  // for simpler typing.
  const uuidLike = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  const result = {
    targetUuid: null as string | null,
    targetName: null as string | null,
    interventionUuid: null as string | null,
    interventionName: null as string | null,
  };

  const { data: rows } = await db
    .from("entities")
    .select("id, entity_id, name")
    .eq("space_id", spaceId)
    .in(
      uuidLike(targetIdOrCode) ? "id" : "entity_id",
      [targetIdOrCode],
    );
  if (rows && rows.length > 0) {
    const r = rows[0] as { id: string; entity_id: string; name: string };
    result.targetUuid = r.id;
    result.targetName = r.name;
  }

  if (interventionIdOrCode) {
    const { data: ivRows } = await db
      .from("entities")
      .select("id, entity_id, name")
      .eq("space_id", spaceId)
      .in(
        uuidLike(interventionIdOrCode) ? "id" : "entity_id",
        [interventionIdOrCode],
      );
    if (ivRows && ivRows.length > 0) {
      const r = ivRows[0] as { id: string; entity_id: string; name: string };
      result.interventionUuid = r.id;
      result.interventionName = r.name;
    }
  }

  return result;
}

/** Edge detail used both for basis tracking AND gap classification.
 *  The temporal fields are nullable because Phase 4 temporal pooling
 *  hasn't been run on every edge — those nulls are themselves a gap
 *  we surface to the user. */
interface BasisEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  source_name: string;
  target_name: string;
  strength: number | null;
  confidence: number | null;
  polarity: string | null;
  onset_days_p50: number | null;
  peak_days_p50: number | null;
  persistence_days_p50: number | null;
  decay_kinetics_modal: string | null;
}

/**
 * Re-walk the subgraph to capture which edge UUIDs (with full detail)
 * were in scope — used both as the calibration basis AND as input to
 * gap classification. Pure DB round-trip; reuses the exact same depth
 * as the simulator so we don't drift.
 */
async function fetchSubgraphBasisEdges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  targetUuid: string,
  depthHops: number,
): Promise<BasisEdge[]> {
  const { data: edges } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, strength, confidence, polarity, onset_days_p50, peak_days_p50, persistence_days_p50, decay_kinetics_modal",
    )
    .eq("space_id", spaceId);
  if (!edges || edges.length === 0) return [];

  type Row = {
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    strength: number | null;
    confidence: number | null;
    polarity: string | null;
    onset_days_p50: number | null;
    peak_days_p50: number | null;
    persistence_days_p50: number | null;
    decay_kinetics_modal: string | null;
  };
  const rows = edges as Row[];

  // BFS upstream from target.
  const incoming = new Map<string, Row[]>();
  for (const e of rows) {
    const list = incoming.get(e.target_entity_id) ?? [];
    list.push(e);
    incoming.set(e.target_entity_id, list);
  }

  const reachable = new Map<string, Row>();
  let frontier = new Set<string>([targetUuid]);
  for (let hop = 0; hop < depthHops && frontier.size > 0; hop++) {
    const next = new Set<string>();
    for (const node of frontier) {
      const ins = incoming.get(node) ?? [];
      for (const e of ins) {
        if (!reachable.has(e.id)) {
          reachable.set(e.id, e);
          next.add(e.source_entity_id);
        }
      }
    }
    frontier = next;
  }

  if (reachable.size === 0) return [];

  // Hydrate names so gap chips can show "BDNF → Working memory" instead
  // of UUIDs. One round-trip for all entity ids in the subgraph.
  const allEntityIds = new Set<string>();
  for (const e of reachable.values()) {
    allEntityIds.add(e.source_entity_id);
    allEntityIds.add(e.target_entity_id);
  }
  const { data: entityRows } = await db
    .from("entities")
    .select("id, name")
    .in("id", Array.from(allEntityIds));
  const nameById = new Map<string, string>();
  for (const r of (entityRows ?? []) as Array<{ id: string; name: string }>) {
    nameById.set(r.id, r.name);
  }

  return Array.from(reachable.values()).map((e) => ({
    id: e.id,
    source_entity_id: e.source_entity_id,
    target_entity_id: e.target_entity_id,
    source_name: nameById.get(e.source_entity_id) ?? e.source_entity_id,
    target_name: nameById.get(e.target_entity_id) ?? e.target_entity_id,
    strength: e.strength,
    confidence: e.confidence,
    polarity: e.polarity,
    onset_days_p50: e.onset_days_p50,
    peak_days_p50: e.peak_days_p50,
    persistence_days_p50: e.persistence_days_p50,
    decay_kinetics_modal: e.decay_kinetics_modal,
  }));
}

// ── Gap classification ──────────────────────────────────────────────
//
// What's a "gap"? Anything in the basis subgraph that's widening the
// confidence bands or weakening the simulator's structural fidelity.
// We surface three load-bearing kinds:
//
//   1. low_confidence — edge.confidence < 0.5. Literature is uncertain
//      about this link's strength/polarity; resolving it tightens p10/p90.
//   2. missing_timing — Phase 4 temporal pool ran but produced no
//      onset_days_p50 OR peak_days_p50. Without timing the engine
//      defaults to instant ramp = 1.0; widens timing of effects.
//   3. weak_strength — edge.strength absent or < 0.1. Pathway exists
//      structurally but contributes little; could be a missed effect.
//
// Each gap maps to a recommended fill action:
//   • low_confidence → research-rounds with this edge's source/target
//     as the outcomeVariable
//   • missing_timing → run Phase 4 temporal pooling (extract-temporal
//     pass) on this edge specifically
//   • weak_strength → effect-size extraction agent
//
// In Phase 1 we DISPLAY these gaps + the recommended action; we don't
// auto-dispatch yet (Phase 2). The chip's click handler stubs to a
// console.log so the wire-up path is visible.

export type TrajectoryGapKind =
  | "low_confidence"
  | "missing_timing"
  | "weak_strength";

export interface TrajectoryGap {
  kind: TrajectoryGapKind;
  edgeId: string;
  sourceName: string;
  targetName: string;
  /** Numeric severity 0..1 — used for sort order. Higher = more impact. */
  severity: number;
  /** What the user sees on the chip. */
  label: string;
  /** Recommended remediation action keyword. Phase 2 routes this. */
  remediation:
    | "research_rounds"
    | "extract_temporal"
    | "extract_effect_size";
}

function classifyGaps(edges: BasisEdge[]): TrajectoryGap[] {
  const gaps: TrajectoryGap[] = [];
  for (const e of edges) {
    // 1. Low-confidence
    if (typeof e.confidence === "number" && e.confidence < 0.5) {
      gaps.push({
        kind: "low_confidence",
        edgeId: e.id,
        sourceName: e.source_name,
        targetName: e.target_name,
        // Lower confidence → higher severity
        severity: 1 - e.confidence,
        label: `Low conf (${e.confidence.toFixed(2)})`,
        remediation: "research_rounds",
      });
    }
    // 2. Missing timing — neither onset nor peak populated
    if (e.onset_days_p50 == null && e.peak_days_p50 == null) {
      gaps.push({
        kind: "missing_timing",
        edgeId: e.id,
        sourceName: e.source_name,
        targetName: e.target_name,
        severity: 0.5,
        label: "No timing",
        remediation: "extract_temporal",
      });
    }
    // 3. Weak / missing strength
    if (e.strength == null || (typeof e.strength === "number" && e.strength < 0.1)) {
      gaps.push({
        kind: "weak_strength",
        edgeId: e.id,
        sourceName: e.source_name,
        targetName: e.target_name,
        severity: e.strength == null ? 0.7 : 0.4,
        label: e.strength == null ? "No effect size" : `Weak (${e.strength.toFixed(2)})`,
        remediation: "extract_effect_size",
      });
    }
  }
  // Sort by severity desc, then by label for stability.
  gaps.sort((a, b) => b.severity - a.severity || a.label.localeCompare(b.label));
  return gaps;
}

interface DefaultRationaleArgs {
  metricLabel: string;
  interventionName: string | null;
  interventionMagnitude: number;
  horizonWeeks: number;
  iterations: number;
  nodeCount: number;
  edgeCount: number;
}

function buildDefaultRationale(args: DefaultRationaleArgs): string {
  const interventionPhrase = args.interventionName
    ? `applying a +${args.interventionMagnitude.toFixed(2)} perturbation to "${args.interventionName}"`
    : "the prior baseline (no intervention)";
  return [
    `Forward projection of "${args.metricLabel}" over ${args.horizonWeeks} week${args.horizonWeeks === 1 ? "" : "s"} under ${interventionPhrase}.`,
    `Monte Carlo over ${args.nodeCount} entities and ${args.edgeCount} edges with ${args.iterations} iterations; per-edge temporal ramps sourced from edges.{onset,peak,persistence}_days_p50 with decay_kinetics_modal where available.`,
  ].join(" ");
}
