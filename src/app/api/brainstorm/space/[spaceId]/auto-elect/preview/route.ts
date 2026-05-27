// ── GET /api/brainstorm/space/[spaceId]/auto-elect/preview ────────
//
// Walks every feature-layer entity in the space and produces a plan
// of what the AI would auto-elect + which mechanisms it wants the
// user to decide. Drives the AmbiguityModal in DeliverablesStrip.
//
// Returns:
//   {
//     confident: MechanismDecision[],   // ready to apply
//     ambiguous: MechanismDecision[],   // need user picks
//     skipped:   MechanismDecision[],   // user already elected here
//   }
//
// Read-only — does NOT mutate anything. Caller (the strip) reads the
// preview, optionally surfaces ambiguity to the user, then POSTs the
// resolved decisions to /auto-elect/apply.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  planMechanismElections,
  type MechanismDecision,
} from "@/lib/objective-canvas/auto-elect-strategy";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Pull every sub-objective in the space + their generated-room marker.
  // We only consider mechanisms (entity_type=feature) — pains/outcomes
  // don't carry variations.
  const { data: subRows } = await db
    .from("improvement_goals")
    .select("id, title, room_layers_generated_at")
    .eq("space_id", spaceId)
    .eq("user_id", auth.user.id)
    .not("parent_goal_id", "is", null);
  const subs = (subRows ?? []) as Array<{
    id: string;
    title: string;
    room_layers_generated_at: string | null;
  }>;
  if (subs.length === 0) {
    return NextResponse.json({
      confident: [],
      ambiguous: [],
      skipped: [],
    });
  }
  const subTitleById = new Map(subs.map((s) => [s.id, s.title]));

  // Pull all feature entities in those sub-objectives in one query.
  const subIds = subs.map((s) => s.id);
  const { data: entRows } = await db
    .from("entities")
    .select("id, name, parent_sub_objective_id, entity_type, expanded_detail")
    .in("parent_sub_objective_id", subIds);
  const entities = (entRows ?? []) as Array<{
    id: string;
    name: string;
    parent_sub_objective_id: string | null;
    entity_type: string;
    expanded_detail: ExpandedItemDetail | null;
  }>;

  const confident: MechanismDecision[] = [];
  const ambiguous: MechanismDecision[] = [];
  const skipped: MechanismDecision[] = [];

  for (const e of entities) {
    // Only mechanisms (features) carry electable variations. Pains
    // + outcomes have variations of their own in some schemas, but
    // those aren't the "method" the user ships — skip them here.
    if (e.entity_type !== "feature") continue;
    if (!e.parent_sub_objective_id) continue;
    const subTitle = subTitleById.get(e.parent_sub_objective_id) ?? "(unknown room)";
    const detail = e.expanded_detail;
    if (!detail || !Array.isArray(detail.variations)) continue;
    if (detail.variations.length === 0) continue;

    const decision = planMechanismElections({
      entityId: e.id,
      entityName: e.name,
      subObjectiveId: e.parent_sub_objective_id,
      subObjectiveTitle: subTitle,
      variations: detail.variations.map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        tradeoff: v.tradeoff,
        kind: v.kind,
        disposition: v.disposition,
        effectiveness_score: v.effectiveness_score,
        evaluation_method: v.evaluation_method,
      })),
    });

    if (decision.status === "confident") confident.push(decision);
    else if (decision.status === "ambiguous") ambiguous.push(decision);
    else skipped.push(decision);
  }

  return NextResponse.json({ confident, ambiguous, skipped });
}
