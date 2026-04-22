// ── Coverage invalidation (Phase 1 Step 6) ──
//
// When new entities / edges land in a space, prior
// `pairwise_connection_checks` rows in their 1-hop neighborhood become
// potentially stale — a pair that was ruled "no connection" before may
// now have an indirect path worth re-examining.
//
// This module flips `revisit_required = true` on those rows so the
// prospector's next pass prioritizes them alongside never-checked
// pairs. Implementation is two-step in app code (simpler than a
// Postgres trigger): find the 1-hop neighbors via `edges`, then
// UPDATE pairwise_connection_checks WHERE one endpoint ∈ neighbors.
//
// Soft-fail throughout — invalidation is a rigor improvement, not a
// correctness requirement. A failure here never blocks the caller's
// primary mutation.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export type RevisitReason =
  | "neighbor_added"
  | "dimension_uncovered"
  | "deviation_detected";

export interface InvalidateCoverageOpts {
  spaceId: string;
  /** Entity UUIDs that were just inserted (or modified in a way that changes neighborhood topology). */
  newEntityIds: string[];
  reason: RevisitReason;
}

export interface InvalidateCoverageResult {
  flagged: number;
  neighborCount: number;
  skipped: boolean;
  error?: string;
}

/**
 * Flag all pairwise_connection_checks rows whose endpoints sit in the
 * 1-hop neighborhood of the given entities. Existing rows where
 * revisit_required is already true are untouched (no unnecessary
 * flagged_at churn).
 */
export async function invalidateCoverageForNewEntities(
  db: AnyDb,
  opts: InvalidateCoverageOpts,
): Promise<InvalidateCoverageResult> {
  const { spaceId, newEntityIds, reason } = opts;
  if (!spaceId || newEntityIds.length === 0) {
    return { flagged: 0, neighborCount: 0, skipped: true };
  }

  try {
    // Step 1 — find all 1-hop neighbors via existing edges. We query
    // edges where either endpoint ∈ newEntityIds and collect the
    // *other* endpoint. The union with newEntityIds itself gives the
    // full set of "entities whose neighborhood may have changed".
    const { data: edgeRows, error: edgeErr } = await db
      .from("edges")
      .select("source_entity_id, target_entity_id")
      .eq("space_id", spaceId)
      .or(
        `source_entity_id.in.(${newEntityIds.join(",")}),target_entity_id.in.(${newEntityIds.join(",")})`,
      );
    if (edgeErr) {
      return {
        flagged: 0,
        neighborCount: 0,
        skipped: false,
        error: `edges fetch: ${edgeErr.message}`,
      };
    }

    const neighborSet = new Set<string>(newEntityIds);
    for (const row of (edgeRows ?? []) as Array<{
      source_entity_id: string;
      target_entity_id: string;
    }>) {
      neighborSet.add(row.source_entity_id);
      neighborSet.add(row.target_entity_id);
    }
    const neighbors = Array.from(neighborSet);
    if (neighbors.length === 0) {
      return { flagged: 0, neighborCount: 0, skipped: true };
    }

    // Step 2 — flag pairwise_connection_checks whose endpoints are in
    // the neighbor set AND weren't already flagged. We do two UPDATEs
    // (one per endpoint column) because Supabase's OR filter syntax
    // doesn't compose cleanly with .in().
    const nowIso = new Date().toISOString();

    const updateFor = async (endpointCol: "entity_a_id" | "entity_b_id") => {
      const { data, error } = await db
        .from("pairwise_connection_checks")
        .update({
          revisit_required: true,
          revisit_reason: reason,
          revisit_flagged_at: nowIso,
        })
        .eq("space_id", spaceId)
        .eq("revisit_required", false)
        .in(endpointCol, neighbors)
        .select("id");
      if (error) return { count: 0, err: error.message };
      return { count: (data ?? []).length, err: null };
    };

    const [aResult, bResult] = await Promise.all([
      updateFor("entity_a_id"),
      updateFor("entity_b_id"),
    ]);

    const flagged = aResult.count + bResult.count;
    const err = aResult.err ?? bResult.err ?? undefined;

    return {
      flagged,
      neighborCount: neighbors.length,
      skipped: false,
      ...(err ? { error: err } : {}),
    };
  } catch (err) {
    return {
      flagged: 0,
      neighborCount: 0,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
