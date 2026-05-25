// ── compute-chains ─────────────────────────────────────────────────
//
// Composes pairwise edges into causal CHAIN TRIPLES of the form
//
//     Friction  ──addresses──▶  Mechanism  ──produces──▶  Result
//
// A chain is the smallest complete strategic proposition the room
// can emit. The user's job is to approve a small set of these — they
// become the tracked strategic bets on the main canvas. Single
// edges are visible too (in the "All edges" sub-view) but chains
// are the primary unit because they're the only thing that's
// actually actionable: an addressed friction without a downstream
// result is just maintenance; a result without an addressed
// friction is just optimism.
//
// Composite strength = min(painFeatureStrength, featureOutcomeStrength).
// We use min (not avg) because the chain only works as well as its
// weakest hop — a 90% friction-mechanism bridge paired with a 30%
// mechanism-result bridge is fundamentally a 30% chain.

import type { RoomEdge } from "@/components/objective/sub-objective-room-view";

export interface ChainTriple {
  /** Stable id (composed from the two edge ids). */
  id: string;
  painId: string;
  painName: string;
  featureId: string;
  featureName: string;
  outcomeId: string;
  outcomeName: string;
  /** The friction → mechanism edge. */
  painFeatureEdge: RoomEdge;
  /** The mechanism → result edge. */
  featureOutcomeEdge: RoomEdge;
  /** Composite strength — min of the two hop strengths. */
  composite: number;
  /** The lever — pulled from whichever edge supplied a mechanism
   *  in agent_feedback. Falls through to null when neither edge
   *  named one (older data). */
  mechanism: string | null;
  /** Tier 3 — the category triple this chain bridges. Each entry is
   *  the SLUG of the source/feature/result item's sub_category (or
   *  null if that item wasn't categorized). The archetype label is
   *  derived from this triple. */
  categoryTriple: {
    painSlug: string | null;
    featureSlug: string | null;
    resultSlug: string | null;
  };
}

interface EntityLite {
  id: string;
  name: string;
  layer: "pain" | "features" | "outcomes" | "objective";
  /** Tier 3 — sub_category slug from causal_chain.sub_category. */
  subCategorySlug?: string | null;
}

/**
 * Walk the edge list and emit one chain per matching (pain →
 * feature, feature → outcome) pair. A single feature can anchor
 * multiple chains (one per result it produces). A single friction
 * can also appear in multiple chains if more than one mechanism
 * counters it. Both expand the user's view of substitutable bets.
 */
export function computeChains(
  edges: RoomEdge[],
  entityIndex: Map<string, EntityLite>,
): ChainTriple[] {
  // Bucket edges by category so we can do an O(F × outDegree) join
  // instead of O(E²) — small F in practice but worth being tidy.
  const painFeatureEdges: Array<{
    pain: EntityLite;
    feature: EntityLite;
    edge: RoomEdge;
  }> = [];
  const featureOutcomeEdgesByFeatureId = new Map<
    string,
    Array<{ outcome: EntityLite; edge: RoomEdge }>
  >();

  for (const e of edges) {
    const src = entityIndex.get(e.source_entity_id);
    const tgt = entityIndex.get(e.target_entity_id);
    if (!src || !tgt) continue;

    // pain → feature (either direction)
    if (
      (src.layer === "pain" && tgt.layer === "features") ||
      (src.layer === "features" && tgt.layer === "pain")
    ) {
      const pain = src.layer === "pain" ? src : tgt;
      const feature = src.layer === "features" ? src : tgt;
      painFeatureEdges.push({ pain, feature, edge: e });
      continue;
    }

    // feature → outcome (either direction)
    if (
      (src.layer === "features" && tgt.layer === "outcomes") ||
      (src.layer === "outcomes" && tgt.layer === "features")
    ) {
      const feature = src.layer === "features" ? src : tgt;
      const outcome = src.layer === "outcomes" ? src : tgt;
      const list =
        featureOutcomeEdgesByFeatureId.get(feature.id) ?? [];
      list.push({ outcome, edge: e });
      featureOutcomeEdgesByFeatureId.set(feature.id, list);
    }
  }

  // ── Compose ──
  const chains: ChainTriple[] = [];
  for (const { pain, feature, edge: pfEdge } of painFeatureEdges) {
    const outRows = featureOutcomeEdgesByFeatureId.get(feature.id) ?? [];
    if (outRows.length === 0) continue; // pain → feature with nothing downstream is a half-chain; we skip
    for (const { outcome, edge: foEdge } of outRows) {
      const composite = Math.min(
        pfEdge.strength ?? 0,
        foEdge.strength ?? 0,
      );
      const mechanism = pickMechanism(pfEdge, foEdge);
      chains.push({
        id: `${pfEdge.id}::${foEdge.id}`,
        painId: pain.id,
        painName: pain.name,
        featureId: feature.id,
        featureName: feature.name,
        outcomeId: outcome.id,
        outcomeName: outcome.name,
        painFeatureEdge: pfEdge,
        featureOutcomeEdge: foEdge,
        composite,
        mechanism,
        categoryTriple: {
          painSlug: pain.subCategorySlug ?? null,
          featureSlug: feature.subCategorySlug ?? null,
          resultSlug: outcome.subCategorySlug ?? null,
        },
      });
    }
  }

  // Sort by composite descending — strongest chain first.
  chains.sort((a, b) => b.composite - a.composite);
  return chains;
}

/**
 * Pull the mechanism string from whichever edge carries one. We
 * prefer the friction→mechanism edge's mechanism (which usually
 * names the lever) but fall back to the mechanism→result edge's
 * mechanism if only that one was supplied.
 */
function pickMechanism(
  pfEdge: RoomEdge,
  foEdge: RoomEdge,
): string | null {
  const candidates: Array<unknown> = [
    pfEdge.agent_feedback &&
    typeof pfEdge.agent_feedback === "object"
      ? (pfEdge.agent_feedback as Record<string, unknown>).mechanism
      : null,
    foEdge.agent_feedback &&
    typeof foEdge.agent_feedback === "object"
      ? (foEdge.agent_feedback as Record<string, unknown>).mechanism
      : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) {
      return c.trim();
    }
  }
  return null;
}

/**
 * Given a set of chains, return a flat set of all edge ids that
 * participate in at least one chain. Used by the side panel's
 * "All edges" sub-view so it can de-emphasize edges that don't
 * land in any chain (half-chains, isolated nodes).
 */
export function chainEdgeIds(chains: ChainTriple[]): Set<string> {
  const ids = new Set<string>();
  for (const c of chains) {
    ids.add(c.painFeatureEdge.id);
    ids.add(c.featureOutcomeEdge.id);
  }
  return ids;
}
