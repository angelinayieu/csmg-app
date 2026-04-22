// ── Analog retrieval (Phase 2H) ──
//
// Given a source space's KG signature, find structurally similar
// signatures in OTHER spaces. Two query modes:
//
//   • mode="structural" — pure-topology ANN over the 32-dim
//     structural_vector. This is the cross-domain invention path:
//     returns graphs with the same shape regardless of vocabulary.
//     A churn loop (B2B SaaS) can surface a habit-formation cycle
//     (behavioral science) because they both reduce to the same
//     feature signature (cycle_count=1, reinforcing_cycle_ratio=1,
//     similar clustering + degree profile).
//
//   • mode="blended" — concat [structural(32) | semantic(1536)] ANN.
//     Matches on shape + subject matter. Used when the user wants
//     to surface their own prior spaces on related problems.
//
// Both paths:
//   1. Call the corresponding RPC (defined in the signatures
//      migration) with HNSW cosine search.
//   2. Convert cosine distance to [0,1] similarity for the UI.
//   3. Filter for meaningful matches (similarity ≥ floor).
//   4. Return ranked analogs with summary metadata + owner attribution.
//
// RLS in the table guarantees the caller only ever sees their own
// signatures + anonymized cross-user signatures, so we don't need
// extra filtering here — the RPC already returns only authorized rows.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export type AnalogSearchMode = "structural" | "blended";

export interface AnalogMatch {
  signature_id: string;
  space_id: string;
  user_id: string | null;
  cluster_id: string | null;
  summary_text: string | null;
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  has_master_bottleneck: boolean;
  is_cross_user: boolean;
  distance: number;
  similarity: number;
  mode: AnalogSearchMode;
}

export interface RetrieveAnalogsOpts {
  /** Source space — excluded from results. */
  excludeSpaceId: string;
  /** Caller's user id — used to flag cross-user matches. */
  callerUserId: string;
  /** 32-dim structural vector. Required for "structural" mode. */
  structuralVector?: number[];
  /** 1568-dim combined vector. Required for "blended" mode. */
  combinedVector?: number[];
  mode: AnalogSearchMode;
  /** Over-fetch to give the similarity floor room to cull. Default 10. */
  matchCount?: number;
  /** Minimum [0,1] similarity for a result to count as an analog. Default 0.75. */
  minSimilarity?: number;
}

interface RpcRow {
  id: string;
  space_id: string;
  user_id: string | null;
  cluster_id: string | null;
  summary_text: string | null;
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  has_master_bottleneck: boolean;
  is_anonymized_for_cross_user: boolean;
  distance: number;
}

export async function retrieveAnalogs(
  db: AnyDb,
  opts: RetrieveAnalogsOpts,
): Promise<AnalogMatch[]> {
  const matchCount = opts.matchCount ?? 10;
  const floor = opts.minSimilarity ?? 0.75;

  let rows: RpcRow[] = [];
  if (opts.mode === "structural") {
    if (!opts.structuralVector) {
      throw new Error("retrieveAnalogs: structuralVector required for structural mode");
    }
    const { data, error } = await db.rpc("match_kg_signatures_structural", {
      query_vector: opts.structuralVector,
      exclude_space_id: opts.excludeSpaceId,
      match_count: matchCount,
    });
    if (error) {
      console.warn("[analog-retrieval] structural rpc failed:", error.message);
      return [];
    }
    rows = (data ?? []) as RpcRow[];
  } else {
    if (!opts.combinedVector) {
      throw new Error("retrieveAnalogs: combinedVector required for blended mode");
    }
    const { data, error } = await db.rpc("match_kg_signatures_blended", {
      query_vector: opts.combinedVector,
      exclude_space_id: opts.excludeSpaceId,
      match_count: matchCount,
    });
    if (error) {
      console.warn("[analog-retrieval] blended rpc failed:", error.message);
      return [];
    }
    rows = (data ?? []) as RpcRow[];
  }

  const matches: AnalogMatch[] = [];
  for (const r of rows) {
    // cosine distance ∈ [0, 2]; similarity = 1 - distance, clamped
    const similarity = Math.max(0, Math.min(1, 1 - r.distance));
    if (similarity < floor) continue;
    matches.push({
      signature_id: r.id,
      space_id: r.space_id,
      user_id: r.user_id,
      cluster_id: r.cluster_id,
      summary_text: r.summary_text,
      entity_count: r.entity_count,
      edge_count: r.edge_count,
      cycle_count: r.cycle_count,
      has_master_bottleneck: r.has_master_bottleneck,
      is_cross_user: r.user_id !== opts.callerUserId,
      distance: r.distance,
      similarity,
      mode: opts.mode,
    });
  }

  return matches;
}

// Two-stage retrieval — structural first (for invention), then blended
// (for intra-domain variation discovery). Results are de-duplicated by
// signature_id with the stronger similarity kept. Mode is set to the
// mode that produced the winning row.
export async function retrieveAnalogsBothModes(
  db: AnyDb,
  opts: Omit<RetrieveAnalogsOpts, "mode"> & {
    structuralVector: number[];
    combinedVector: number[];
  },
): Promise<AnalogMatch[]> {
  const [structuralMatches, blendedMatches] = await Promise.all([
    retrieveAnalogs(db, { ...opts, mode: "structural" }),
    retrieveAnalogs(db, { ...opts, mode: "blended" }),
  ]);

  const byId = new Map<string, AnalogMatch>();
  for (const m of [...structuralMatches, ...blendedMatches]) {
    const existing = byId.get(m.signature_id);
    if (!existing || m.similarity > existing.similarity) {
      byId.set(m.signature_id, m);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.similarity - a.similarity);
}
