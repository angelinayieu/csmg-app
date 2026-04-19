/**
 * Scope-ref validation + resolution helpers.
 *
 * Canvases are polymorphic on (scope_ref_type, scope_ref_id). The DB can't
 * enforce the FK because the target table varies. These helpers:
 *
 *   1. verifyScopeRef — called by POST /api/canvases to confirm the ref
 *      actually exists in the table implied by scope_ref_type and is
 *      owned by the user.
 *   2. resolveScopeRefNames — called by GET /api/canvases to hydrate
 *      the human-readable scope_ref_name displayed on CanvasCards.
 *
 * A nightly integrity job should also be added in Sprint 5 to catch
 * drift (canvas still pointing at a deleted space, goal, or app).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanvasScope, CanvasScopeRefType } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/**
 * Check that (scope_ref_type, scope_ref_id) refers to a real row owned
 * by the given user. Returns true if the ref is valid. The DB-level
 * CHECK constraint already forces scope/scope_ref_type/scope_ref_id to
 * be consistent; this is the existence + ownership check.
 */
export async function verifyScopeRef(
  db: AnyDb,
  scope: CanvasScope,
  scopeRefType: CanvasScopeRefType | null,
  scopeRefId: string | null,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (scope === "universal") {
    if (scopeRefType !== null || scopeRefId !== null) {
      return { ok: false, reason: "Universal scope must not carry a ref" };
    }
    return { ok: true };
  }
  if (scopeRefType === null || scopeRefId === null) {
    return {
      ok: false,
      reason: "Non-universal scope requires scope_ref_type + scope_ref_id",
    };
  }

  // Each branch queries the target table gated by the owner column.
  // RLS also enforces this, but an explicit check gives a clearer 404.
  if (scopeRefType === "space") {
    const { data } = await db
      .from("spaces")
      .select("id")
      .eq("id", scopeRefId)
      .eq("user_id", userId)
      .maybeSingle();
    return data
      ? { ok: true }
      : { ok: false, reason: "Space not found or not owned by user" };
  }
  if (scopeRefType === "improvement_goal") {
    const { data } = await db
      .from("improvement_goals")
      .select("id")
      .eq("id", scopeRefId)
      .eq("user_id", userId)
      .maybeSingle();
    return data
      ? { ok: true }
      : { ok: false, reason: "Objective not found or not owned by user" };
  }
  if (scopeRefType === "app") {
    const { data } = await db
      .from("apps")
      .select("id")
      .eq("id", scopeRefId)
      .eq("user_id", userId)
      .maybeSingle();
    return data
      ? { ok: true }
      : { ok: false, reason: "App not found or not owned by user" };
  }

  return { ok: false, reason: `Unknown scope_ref_type: ${scopeRefType}` };
}

/**
 * Batch-resolve the human-readable names for a set of canvas scope refs.
 * Returns a Map keyed by `${scope_ref_type}:${scope_ref_id}` → name.
 * One query per table, so the entire list endpoint does at most 3 extra
 * round-trips regardless of page size.
 */
export async function resolveScopeRefNames(
  db: AnyDb,
  refs: Array<{ scope_ref_type: CanvasScopeRefType; scope_ref_id: string }>,
): Promise<Map<string, string>> {
  const byType: Record<CanvasScopeRefType, string[]> = {
    space: [],
    improvement_goal: [],
    app: [],
  };
  for (const r of refs) byType[r.scope_ref_type].push(r.scope_ref_id);

  const out = new Map<string, string>();

  async function fillFromTable(
    table: string,
    nameCol: string,
    type: CanvasScopeRefType,
  ) {
    const ids = byType[type];
    if (ids.length === 0) return;
    // Cast through unknown: the Supabase typed parser rejects template-
    // interpolated column names in .select(), but this helper must stay
    // polymorphic across the three ref-source tables.
    const result = (await db
      .from(table)
      .select(`id, ${nameCol}`)
      .in("id", ids)) as unknown as {
      data: Array<Record<string, string>> | null;
    };
    for (const row of result.data ?? []) {
      if (row.id && row[nameCol]) out.set(`${type}:${row.id}`, row[nameCol]);
    }
  }

  await Promise.all([
    fillFromTable("spaces", "name", "space"),
    fillFromTable("improvement_goals", "title", "improvement_goal"),
    fillFromTable("apps", "name", "app"),
  ]);

  return out;
}
