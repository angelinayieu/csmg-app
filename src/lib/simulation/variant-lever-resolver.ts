// ── variant-lever-resolver ────────────────────────────────────────────
//
// Given a variant (which belongs to an app, which has `dominant_entity_ids[]`),
// resolve a (lever, target) pair so `simulateVariantLift` can compute
// real MC lift.
//
// Heuristic:
//   Step 1. Gather candidate entities:
//     - `dominant_entity_ids` from the variant's app (in order; first is
//       usually the app's "primary concept")
//   Step 2. For each candidate pair (lever, target) where lever ≠ target:
//     - Walk forward from lever through `edges`, depth-limited
//     - If target reachable within `depthHops`, pair is valid
//     - Score the pair: prefer deeper causal distance (longer chain ⇒
//       more propagation math to do) + prefer levers with higher
//       user_controllability hint (from entity.provenance)
//   Step 3. Return the highest-scored valid pair, or null if none exist.
//
// When no valid pair exists, iv-scorer falls back to LLM review — which
// is honest ("we can't compute real MC lift without a mappable causal
// chain from lever to target"). No fake numbers generated in that case.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface LeverTargetPair {
  leverEntityId: string;
  targetEntityId: string;
  /** Hops from lever to target on the shortest causal path. */
  pathHops: number;
  /** Score used for ranking candidate pairs; higher = better. */
  score: number;
}

export interface ResolveOpts {
  spaceId: string;
  appId: string;
  /** Max hops to explore from each candidate lever. Default 3. */
  depthHops?: number;
}

/**
 * Returns the best (lever, target) pair for MC lift computation, or
 * null when the variant's app has no mappable causal chain.
 */
export async function resolveVariantLeverTarget(
  db: AnyDb,
  opts: ResolveOpts,
): Promise<LeverTargetPair | null> {
  const depthHops = opts.depthHops ?? 3;

  // Load the app's dominant entities (ordered — first is primary).
  const { data: appRow, error: appErr } = await db
    .from("apps")
    .select("dominant_entity_ids")
    .eq("id", opts.appId)
    .maybeSingle();
  if (appErr || !appRow) return null;
  const dominantIds: string[] = Array.isArray(
    (appRow as { dominant_entity_ids?: unknown }).dominant_entity_ids,
  )
    ? ((appRow as { dominant_entity_ids?: string[] }).dominant_entity_ids as string[])
    : [];
  if (dominantIds.length < 2) return null; // need at least 2 distinct entities

  // Load entity metadata for scoring (controllability hint).
  const { data: entitiesRaw } = await db
    .from("entities")
    .select("id, provenance")
    .in("id", dominantIds);
  const entityById = new Map<string, { provenance: Record<string, unknown> | null }>();
  for (const e of entitiesRaw ?? []) {
    entityById.set(
      (e as { id: string }).id,
      {
        provenance:
          ((e as { provenance?: unknown }).provenance as Record<
            string,
            unknown
          > | null) ?? null,
      },
    );
  }

  // Load all edges in the space. Bounded by typical space sizes (≤2000
  // edges); acceptable for occasional per-variant scoring.
  const { data: edgesRaw, error: edgesErr } = await db
    .from("edges")
    .select("source_entity_id, target_entity_id");
  if (edgesErr) return null;
  const edgesBySource = new Map<string, string[]>();
  for (const e of edgesRaw ?? []) {
    const s = (e as { source_entity_id: string }).source_entity_id;
    const t = (e as { target_entity_id: string }).target_entity_id;
    const arr = edgesBySource.get(s) ?? [];
    arr.push(t);
    edgesBySource.set(s, arr);
  }

  // Score each ordered (lever, target) pair from the dominant set.
  const candidates: LeverTargetPair[] = [];
  for (let i = 0; i < dominantIds.length; i++) {
    for (let j = 0; j < dominantIds.length; j++) {
      if (i === j) continue;
      const lever = dominantIds[i];
      const target = dominantIds[j];
      const hops = shortestPathHops(edgesBySource, lever, target, depthHops);
      if (hops === null) continue;
      // Score: longer chain = more propagation structure = richer lift
      // signal (more edges contribute). User-controllable lever bonus.
      const lm = entityById.get(lever);
      const stopReason =
        lm?.provenance &&
        typeof lm.provenance === "object" &&
        (lm.provenance as Record<string, unknown>).stop_reason;
      const userControlBonus = stopReason === "user_controllable" ? 0.4 : 0;
      const externalPenalty = stopReason === "external" ? -0.3 : 0;
      // Prefer the "primary → secondary" ordering (i=0 → j>0) slightly;
      // app-generator tends to list upstream-most first.
      const primaryBonus = i === 0 ? 0.1 : 0;
      const secondaryBonus = j === dominantIds.length - 1 ? 0.1 : 0;
      const score =
        hops + userControlBonus + externalPenalty + primaryBonus + secondaryBonus;
      candidates.push({
        leverEntityId: lever,
        targetEntityId: target,
        pathHops: hops,
        score,
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/**
 * BFS forward from `source` over `edgesBySource`. Returns shortest hop
 * count to reach `target`, or null if unreachable within `maxHops`.
 */
function shortestPathHops(
  edgesBySource: Map<string, string[]>,
  source: string,
  target: string,
  maxHops: number,
): number | null {
  if (source === target) return 0;
  const visited = new Set<string>([source]);
  let frontier: string[] = [source];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      const outs = edgesBySource.get(node) ?? [];
      for (const out of outs) {
        if (out === target) return hop;
        if (!visited.has(out)) {
          visited.add(out);
          next.push(out);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return null;
}
