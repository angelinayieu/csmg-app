// ── Cross-space bridge loader (Gap B, last symmetry fix) ────────────────
//
// Why this exists:
//   narrative_walk (what-if route) already loads `bridges` and hands them
//   to the LLM as part of `cross_space_bridges`, so the narrative can
//   reason about cross-space propagation. monte_carlo and bootstrap
//   were blind to bridges — they'd stop propagating at the space
//   boundary. On the taxonomy that's an asymmetry: the weaker engine
//   saw more substrate than the stronger ones.
//
// What this does:
//   Loads bridges whose source_entity_id or target_entity_id is in the
//   caller's subgraph entity set, fetches the cross-space entities on
//   the far side (so name resolution works), and converts each bridge
//   into one or two synthetic Edge rows the propagation engines can
//   traverse the same way they traverse intra-space edges.
//
// Why synthetic Edge rows rather than a separate channel:
//   The engines' BFS already supports signed numeric edges. Teaching
//   them a second-class "bridge edge" type would diverge the two
//   simulation modes from what-if (which just folds bridges into the
//   prompt payload). Casting bridges as Edges keeps the three modes'
//   propagation substrate identical, honoring the taxonomy's promise
//   that MC/bootstrap reason about the same graph the narrative did.
//
// Polarity: bridges represent coupling, not opposition, so we stamp
// them "positive". confidence comes from the bridges.confidence column
// when present; falls back to coupling-strength-derived defaults.
// strength is derived from coupling_strength since bridges don't carry
// a numeric strength in the schema.

import type { Edge, Entity } from "@/types";

/** coupling_strength enum → numeric edge strength. Strong bridges
 *  propagate nearly the full delta; weak bridges are more like
 *  loose hints. Kept in [0,1] to match the edges.strength range so
 *  the engines' noise-sampling sigmas still make sense. */
const COUPLING_TO_STRENGTH: Record<
  "strong" | "moderate" | "weak",
  number
> = {
  strong: 0.8,
  moderate: 0.5,
  weak: 0.3,
};

/** Per-direction fallback confidence when bridges.confidence is null. */
const COUPLING_TO_CONFIDENCE: Record<
  "strong" | "moderate" | "weak",
  number
> = {
  strong: 0.85,
  moderate: 0.7,
  weak: 0.55,
};

/** bridge_type → polarity for synthetic edges.
 *
 * Previously every synthetic bridge edge was stamped polarity="positive".
 * That's a real bias: a bridge is a coupling claim, not a sign claim,
 * and "influence" bridges in particular could go either way. The engines
 * treat polarity four-valued (positive/negative/neutral/conditional), so
 * we pick the most-honest mapping per bridge_type:
 *
 *   identity   → "positive"    — "this IS the same variable, just
 *                                 instantiated in another space". A
 *                                 perturbation in one side should
 *                                 co-move the other side.
 *   influence  → "conditional" — causal coupling exists, but the sign
 *                                 isn't captured by the bridges schema.
 *                                 The engines sample ±1 per iteration
 *                                 which honestly represents "we know
 *                                 it couples, we don't know the sign."
 *   structural → "neutral"     — structural similarity (same topology)
 *                                 implies no directional effect. The
 *                                 engines treat neutral polarity as 0,
 *                                 so structural bridges don't propagate
 *                                 a signed delta — which is correct:
 *                                 "both spaces have a similar shape"
 *                                 doesn't mean intervening in one
 *                                 moves the other.
 */
const BRIDGE_TYPE_TO_POLARITY: Record<
  "identity" | "influence" | "structural",
  "positive" | "negative" | "neutral" | "conditional"
> = {
  identity: "positive",
  influence: "conditional",
  structural: "neutral",
};

interface BridgeRow {
  id: string;
  source_space_id: string;
  source_entity_id: string;
  target_space_id: string;
  target_entity_id: string;
  bridge_type: "identity" | "influence" | "structural";
  coupling_strength: "strong" | "moderate" | "weak";
  coupling_direction:
    | "source_to_target"
    | "target_to_source"
    | "bidirectional";
  confidence: number | null;
}

export interface CrossSpaceEdgeLoad {
  /** Synthetic edges to splice into the propagation substrate. */
  edges: Edge[];
  /** Cross-space entities reached by these bridges, to fold into the
   *  engines' entity set so BFS can resolve names + the affected-entity
   *  list isn't missing rows on the far side. */
  entities: Entity[];
  /** How many bridges were folded in — surfaced to the UI so the
   *  panel can note "3 cross-space bridges included" when relevant. */
  bridge_count: number;
}

/**
 * Load bridges touching `subgraphEntityIds` and convert them to
 * synthetic Edge rows the propagation engines can walk. Also loads
 * the cross-space entities on the far side of each bridge so the
 * subgraph has complete name resolution.
 *
 * Soft-fail: any error logs a warning and returns an empty set. A
 * broken bridges table shouldn't take down a MC/bootstrap run — the
 * engines already handle the "no bridges" case.
 */
export async function loadCrossSpaceBridgeEdges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subgraphEntityIds: string[],
): Promise<CrossSpaceEdgeLoad> {
  if (subgraphEntityIds.length === 0) {
    return { edges: [], entities: [], bridge_count: 0 };
  }

  try {
    const idList = subgraphEntityIds.join(",");
    // Bridges where either end is in our subgraph. Matches the what-if
    // route's convention of excluding user-rejected bridges so MC/
    // bootstrap don't propagate through something the user already
    // said "no" to. (The status column is added by a later migration
    // and may be absent on some dev DBs — we guard with try/catch.)
    const { data: bridgeRows, error } = (await db
      .from("bridges")
      .select(
        "id, source_space_id, source_entity_id, target_space_id, target_entity_id, bridge_type, coupling_strength, coupling_direction, confidence, status",
      )
      .or(
        `source_entity_id.in.(${idList}),target_entity_id.in.(${idList})`,
      )
      .neq("status", "user_rejected")) as {
      data: BridgeRow[] | null;
      error: unknown;
    };

    if (error || !bridgeRows || bridgeRows.length === 0) {
      // Retry without the status filter in case the column is absent
      // in this DB. This is a dev-environment defensive path — prod
      // has the migration.
      if (error) {
        const { data: fallback } = (await db
          .from("bridges")
          .select(
            "id, source_space_id, source_entity_id, target_space_id, target_entity_id, bridge_type, coupling_strength, coupling_direction, confidence",
          )
          .or(
            `source_entity_id.in.(${idList}),target_entity_id.in.(${idList})`,
          )) as { data: BridgeRow[] | null };
        return buildLoad(db, subgraphEntityIds, fallback ?? []);
      }
      return { edges: [], entities: [], bridge_count: 0 };
    }

    return buildLoad(db, subgraphEntityIds, bridgeRows);
  } catch (err) {
    console.warn("[cross-space-edges] load failed (non-fatal):", err);
    return { edges: [], entities: [], bridge_count: 0 };
  }
}

async function buildLoad(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subgraphEntityIds: string[],
  bridges: BridgeRow[],
): Promise<CrossSpaceEdgeLoad> {
  const subgraphSet = new Set(subgraphEntityIds);

  // Cross-space entity IDs: the far side of each bridge that isn't
  // already in the subgraph. We only resolve these for name/label —
  // the engines' BFS from the target never originates outside the
  // subgraph, so we don't need their intra-space edges.
  const crossEntityIds = new Set<string>();
  for (const b of bridges) {
    if (!subgraphSet.has(b.source_entity_id)) crossEntityIds.add(b.source_entity_id);
    if (!subgraphSet.has(b.target_entity_id)) crossEntityIds.add(b.target_entity_id);
  }

  let crossEntities: Entity[] = [];
  if (crossEntityIds.size > 0) {
    const { data } = (await db
      .from("entities")
      .select("*")
      .in("id", Array.from(crossEntityIds))) as { data: Entity[] | null };
    crossEntities = data ?? [];
  }

  const syntheticEdges: Edge[] = [];
  for (const b of bridges) {
    const strength = COUPLING_TO_STRENGTH[b.coupling_strength];
    const confidence =
      typeof b.confidence === "number" && Number.isFinite(b.confidence)
        ? Math.max(0, Math.min(1, b.confidence))
        : COUPLING_TO_CONFIDENCE[b.coupling_strength];

    const baseEdge = {
      relationship_type: `bridge_${b.bridge_type}`,
      dimension: "causal" as const,
      source_tag: "inferred" as const,
      strength,
      polarity: BRIDGE_TYPE_TO_POLARITY[b.bridge_type],
      confidence,
      conditions: null,
      is_tradeoff: false,
      resolved_by_entity_id: null,
      is_part_of_cycle: false,
      cycle_id: null,
      dynamics: null,
      dynamics_properties: null,
      utility: null,
      is_low_confidence: b.coupling_strength === "weak",
      knowledge_layer: "bridge" as const,
      // space_id is a required column on edges, but these are synthetic
      // and cross two spaces. Pick source_space_id — the engines don't
      // filter edges by space, they walk whatever's in the array.
      space_id: b.source_space_id,
    };

    if (
      b.coupling_direction === "source_to_target" ||
      b.coupling_direction === "bidirectional"
    ) {
      syntheticEdges.push({
        ...baseEdge,
        id: `bridge_s2t_${b.id}`,
        source_entity_id: b.source_entity_id,
        target_entity_id: b.target_entity_id,
      } as Edge);
    }
    if (
      b.coupling_direction === "target_to_source" ||
      b.coupling_direction === "bidirectional"
    ) {
      syntheticEdges.push({
        ...baseEdge,
        id: `bridge_t2s_${b.id}`,
        source_entity_id: b.target_entity_id,
        target_entity_id: b.source_entity_id,
      } as Edge);
    }
  }

  return {
    edges: syntheticEdges,
    entities: crossEntities,
    bridge_count: bridges.length,
  };
}
