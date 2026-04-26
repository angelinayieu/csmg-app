// ── /api/spaces/[id]/mechanisms ──────────────────────────────────
//
// GET → list mechanisms for the space + derive each mechanism's
//       entity scope (union of dominant_entity_ids across the apps
//       that are sub-branches of the mechanism). The derived scope
//       is what enables the browse page's "Save as system" gesture
//       to POST a useful entity_ids[] to /api/spaces/[id]/systems.
//
// Background: the mechanisms table (20260509_mechanisms.sql) was
// shipped as the cycle-pattern primitive used by strategy + agents
// but never received a UI surface. This endpoint + its companion
// browse page are the minimum viable surfacing — list, browse,
// promote-to-system. Detail-level views (per-mechanism agent
// assignments, cycle pattern visualizations) are deferred until
// users confirm they want richer mechanism inspection.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface MechanismListEntry {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  kind: string;
  cycle_pattern: string | null;
  rationale: string | null;
  status: string;
  agent_assignments: unknown;
  source_infrastructure_proposal_id: string | null;
  source_strategy_version: number | null;
  created_at: string;
  updated_at: string;
  /** Apps that are sub-branches of this mechanism (apps.parent_mechanism_id). */
  app_count: number;
  /** Union of every app's dominant_entity_ids — the natural entity
   *  scope when promoting this mechanism to a system. Empty when
   *  no apps reference the mechanism yet. */
  derived_entity_ids: string[];
}

export interface MechanismsListResponse {
  mechanisms: MechanismListEntry[];
  computed_at: string;
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Mechanisms list — sorted by status (active first) then updated_at.
  const { data: mechRows, error: mechErr } = await db
    .from("mechanisms")
    .select("*")
    .eq("space_id", spaceId)
    .order("status", { ascending: true })
    .order("updated_at", { ascending: false });
  if (mechErr) {
    console.warn("[mechanisms list] fetch failed:", mechErr);
    return NextResponse.json({ error: mechErr.message }, { status: 500 });
  }
  const mechanisms = (mechRows ?? []) as Array<{
    id: string;
    space_id: string;
    name: string;
    description: string | null;
    kind: string;
    cycle_pattern: string | null;
    rationale: string | null;
    status: string;
    agent_assignments: unknown;
    source_infrastructure_proposal_id: string | null;
    source_strategy_version: number | null;
    created_at: string;
    updated_at: string;
  }>;

  // Apps with parent_mechanism_id → entity scope per mechanism.
  // Single batched query so we don't N+1 across mechanisms.
  let appRows: Array<{
    parent_mechanism_id: string | null;
    dominant_entity_ids: string[] | null;
  }> = [];
  if (mechanisms.length > 0) {
    const { data: apps } = await db
      .from("apps")
      .select("parent_mechanism_id, dominant_entity_ids")
      .eq("space_id", spaceId)
      .not("parent_mechanism_id", "is", null);
    appRows = (apps ?? []) as typeof appRows;
  }

  // Aggregate: mechanism_id → { app_count, derived_entity_ids[] }.
  const aggByMech = new Map<
    string,
    { app_count: number; derived_entity_ids: Set<string> }
  >();
  for (const row of appRows) {
    const mid = row.parent_mechanism_id;
    if (!mid) continue;
    let agg = aggByMech.get(mid);
    if (!agg) {
      agg = { app_count: 0, derived_entity_ids: new Set<string>() };
      aggByMech.set(mid, agg);
    }
    agg.app_count++;
    for (const id of row.dominant_entity_ids ?? []) {
      if (typeof id === "string" && id.length > 0) {
        agg.derived_entity_ids.add(id);
      }
    }
  }

  const enriched: MechanismListEntry[] = mechanisms.map((m) => {
    const agg = aggByMech.get(m.id);
    return {
      ...m,
      app_count: agg?.app_count ?? 0,
      derived_entity_ids: agg ? Array.from(agg.derived_entity_ids) : [],
    };
  });

  const payload: MechanismsListResponse = {
    mechanisms: enriched,
    computed_at: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}
