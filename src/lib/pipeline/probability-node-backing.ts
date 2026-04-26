// ── Measured backing for ProbabilityNode.probability (R6) ─────────────
//
// Before this module, every `ProbabilityNode.probability` was LLM-self-
// reported — the sub-component-expansion agent assigned a scalar and
// the engine copied it onto the node. That's a Tier 1 number
// masquerading as a measurement. When users see "this sub-component
// is 87% likely active," they reasonably read that as "observed," not
// "the language model guessed."
//
// This module provides a narrow upgrade path: when a probability-space
// node corresponds to a REAL knowledge-graph entity that has
// observable structural signals (edge degree, confidence, evidence
// backing), compute a measured-ish probability from those signals and
// stamp `probability_source: "measured"`. When the node is purely
// LLM-expansion data with no KG counterpart, keep `"estimated"` —
// honest about what we have.
//
// The formula:
//
//   measured = confidence × (1 − e^(−edges_in + edges_out) / 3))
//            × (1 + evidence_backing_count × 0.05)    // capped at 1
//
// Intuition: an entity is "more likely active" if (a) the KG is confident
// it exists, (b) it has enough edges to actually participate in the
// causal flow, and (c) real evidence citations back up its claims. Zero
// evidence → no boost; one high-reliability citation → +5%; three → +15%.
// The edge-degree term is asymptotic so small spaces don't penalize
// newly-added entities that haven't accumulated edges yet.
//
// This is Tier 3 math (structural arithmetic over real KG data), not
// Tier 4 (there's no sampling). But it's a strict upgrade from Tier 1
// and the provenance tag makes the distinction visible in the UI.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Entity = { id: string; confidence?: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EdgeRow = { source_entity_id: string; target_entity_id: string };

export interface MeasuredProbabilityResult {
  probability: number;
  /** Non-null when we had enough KG signal to call this "measured". */
  source: "measured" | null;
  /** Audit fields — kept on the node metadata so the UI can tooltip. */
  backingSignals: {
    confidence: number | null;
    edgeDegree: number;
    evidenceCount: number;
  };
}

export interface MeasureInput {
  entityId: string;
  entities: Entity[];
  edges: EdgeRow[];
  /** Count of evidence_items linked to claims on this entity. Pre-fetched
   *  by the caller in one query rather than per-node N+1. Default 0. */
  evidenceBackingCount?: number;
  /**
   * Minimum edge degree to consider the node "measured" at all. Below
   * this the LLM estimate is a better proxy; above it the structural
   * signal dominates. Default 2 — an isolated or 1-edge node is not
   * structurally backed enough to claim a measurement.
   */
  minEdgeDegree?: number;
}

/**
 * Return a measured probability for a KG-backed node, or null when
 * there isn't enough signal to upgrade from the LLM estimate.
 *
 * Caller pattern:
 *
 *   const measured = computeMeasuredNodeProbability({ entityId, entities, edges });
 *   if (measured.source === "measured") {
 *     node.probability = measured.probability;
 *     node.probability_source = "measured";
 *   } else {
 *     node.probability = sc.probability;           // LLM estimate
 *     node.probability_source = "estimated";
 *   }
 */
export function computeMeasuredNodeProbability(
  input: MeasureInput,
): MeasuredProbabilityResult {
  const { entityId, entities, edges } = input;
  const minEdgeDegree = input.minEdgeDegree ?? 2;
  const evidenceCount = input.evidenceBackingCount ?? 0;

  const entity = entities.find((e) => e.id === entityId);
  const confidence =
    typeof entity?.confidence === "number" && Number.isFinite(entity.confidence)
      ? Math.max(0, Math.min(1, entity.confidence))
      : null;

  let edgeDegree = 0;
  for (const e of edges) {
    if (e.source_entity_id === entityId || e.target_entity_id === entityId) {
      edgeDegree++;
    }
  }

  const unmeasured: MeasuredProbabilityResult = {
    probability: 0,
    source: null,
    backingSignals: {
      confidence,
      edgeDegree,
      evidenceCount,
    },
  };

  // Honest refusal — not enough structural backing to claim this is a
  // measurement. Caller falls back to the LLM estimate with an
  // "estimated" provenance tag.
  if (edgeDegree < minEdgeDegree) return unmeasured;
  if (confidence === null) return unmeasured;

  // Core formula described in the module header.
  const degreeTerm = 1 - Math.exp(-edgeDegree / 3);
  const evidenceBoost = 1 + evidenceCount * 0.05;
  const raw = confidence * degreeTerm * evidenceBoost;
  const probability = Math.max(0, Math.min(1, raw));

  return {
    probability,
    source: "measured",
    backingSignals: {
      confidence,
      edgeDegree,
      evidenceCount,
    },
  };
}
