// ── Insight Lab — graph adapters ──────────────────────────────────────
//
// Adapters pull the right slice of the full SpaceCtx for each algorithm.
// Different algorithms want different subsets (full Entity[]/Edge[],
// just ids, just edges that carry causal weight, etc.). Centralizing the
// slicing here means each algorithm registration stays one-liner.

import type { Entity, Edge } from "@/types";
import type { SpaceCtx } from "./types";

/** Pass full entity + edge arrays through. The default for any algorithm
 *  that wants the whole graph — preliminary-insights, hub-discovery,
 *  community-detection. */
export function fullGraphAdapter(
  ctx: SpaceCtx,
): { entities: Entity[]; edges: Edge[] } {
  return { entities: ctx.entities, edges: ctx.edges };
}
