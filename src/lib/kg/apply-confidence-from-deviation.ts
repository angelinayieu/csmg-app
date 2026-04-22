// ── Outcome → confidence feedback loop ──
//
// When a prediction in `prediction_ledger` resolves, the deviation
// between predicted and actual is a signal about whether our causal
// model was right. Surprise means the model missed something;
// expected means the model held up. Today we tag the deviation and
// walk away — no confidence update ever propagates back into
// `entities.confidence` or `edges.confidence`, so the KG can't
// self-correct.
//
// This helper closes that loop with a deliberately modest nudge:
//
//   tag             delta        semantics
//   ─────────────   ──────────   ──────────────────────────────────
//   expected        +0.01        small positive reinforcement
//   within_range    +0.005       very small reinforcement
//   regime_shift    -0.02        model was wrong; de-rate
//   surprise        -0.05        model was very wrong; de-rate more
//   qualitative     0            can't score, no change
//   abandoned       0            no ground truth, no change
//
// Applied to:
//   • The space's strategy-relevant entities (leverage/risk/bottleneck)
//     and
//   • The edges connecting them
//
// Why strategy-relevant entities specifically? They're the nodes
// most likely to load-bear the failed prediction's logic — tracker
// → specific-entity mapping is still open in prediction_ledger (v1
// gap), so until that's wired we use this heuristic to avoid the
// extreme of either updating every entity in the space (too diffuse)
// or doing nothing (the current state). Future refinement: narrow
// via tracker.source_key.
//
// Clamped to [0.05, 0.98] so repeated surprises can't zero out a
// node (preventing recovery) and repeated expected-resolutions can't
// drift confidence to 1.0 (which would read as "certain" even under
// many positive samples). The nudges are small enough that one
// resolution is barely perceptible but a pattern of 10+ shifts the
// needle by ~0.1.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviationTag } from "@/types/prediction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const CONFIDENCE_MIN = 0.05;
const CONFIDENCE_MAX = 0.98;

function deltaForTag(tag: DeviationTag): number {
  switch (tag) {
    case "expected":
      return 0.01;
    case "regime_shift":
      return -0.02;
    case "surprise":
      return -0.05;
    default:
      // qualitative, abandoned, or any future tag — no score to apply.
      return 0;
  }
}

export interface ApplyConfidenceOpts {
  spaceId: string;
  deviationTag: DeviationTag;
}

export interface ApplyConfidenceResult {
  delta: number;
  entitiesUpdated: number;
  edgesUpdated: number;
  error?: string;
}

export async function applyConfidenceFromDeviation(
  db: AnyDb,
  opts: ApplyConfidenceOpts,
): Promise<ApplyConfidenceResult> {
  const delta = deltaForTag(opts.deviationTag);
  if (delta === 0) {
    return { delta: 0, entitiesUpdated: 0, edgesUpdated: 0 };
  }

  // Fetch strategy-relevant entities in the space. Mirrors the
  // targeting heuristic used by coverage invalidation so the feedback
  // signal and the revisit signal move together.
  const { data: strategicEntities, error: entErr } = await db
    .from("entities")
    .select("id, confidence")
    .eq("space_id", opts.spaceId)
    .or(
      "is_leverage_point.eq.true,is_risk_point.eq.true,is_master_bottleneck.eq.true",
    );

  if (entErr) {
    return {
      delta,
      entitiesUpdated: 0,
      edgesUpdated: 0,
      error: `entity fetch failed: ${entErr.message}`,
    };
  }

  const entityRows = (strategicEntities ?? []) as Array<{
    id: string;
    confidence: number | null;
  }>;
  if (entityRows.length === 0) {
    return { delta, entitiesUpdated: 0, edgesUpdated: 0 };
  }

  const entityIds = entityRows.map((e) => e.id);

  // Per-row UPDATE so we can clamp. Supabase doesn't expose GREATEST/
  // LEAST cleanly via the REST layer without an RPC, and entityRows
  // is typically 3-12 rows — a small fan-out is fine.
  let entitiesUpdated = 0;
  await Promise.all(
    entityRows.map(async (e) => {
      const cur = typeof e.confidence === "number" ? e.confidence : 0.5;
      const next = Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, cur + delta));
      if (Math.abs(next - cur) < 1e-6) return;
      const { error } = await db
        .from("entities")
        .update({ confidence: next })
        .eq("id", e.id);
      if (!error) entitiesUpdated++;
    }),
  );

  // Edges connecting any two of the strategic entities. Same clamp.
  const { data: edgeRows, error: edgeErr } = await db
    .from("edges")
    .select("id, confidence")
    .eq("space_id", opts.spaceId)
    .in("source_entity_id", entityIds)
    .in("target_entity_id", entityIds);

  if (edgeErr) {
    return {
      delta,
      entitiesUpdated,
      edgesUpdated: 0,
      error: `edge fetch failed: ${edgeErr.message}`,
    };
  }

  const edgeList = (edgeRows ?? []) as Array<{
    id: string;
    confidence: number | null;
  }>;
  let edgesUpdated = 0;
  await Promise.all(
    edgeList.map(async (e) => {
      const cur = typeof e.confidence === "number" ? e.confidence : 0.5;
      const next = Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, cur + delta));
      if (Math.abs(next - cur) < 1e-6) return;
      const { error } = await db
        .from("edges")
        .update({ confidence: next })
        .eq("id", e.id);
      if (!error) edgesUpdated++;
    }),
  );

  return { delta, entitiesUpdated, edgesUpdated };
}
