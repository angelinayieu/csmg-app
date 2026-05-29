// ── GET /api/objective/[spaceId]/board-subs ───────────────────────
//
// Lightweight room list + objective title for the LAYOUT-LEVEL whiteboard
// shell. The shell self-loads this (rather than taking props) so it can be
// mounted once in [spaceId]/layout.tsx and survive page.tsx rewrites —
// driving the circular room sidebar + the titles on collapsed board cards.
//
// Intentionally cheap: just the root goal's children (id/title/ready). No
// per-room entity/chain rollup (that lives in the heavier page loader).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // Ownership + objective text in one read.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id, description, input_text")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const objectiveTitle =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // The objective = the root improvement_goal (no parent). Its children
  // are the sub-objective rooms.
  const { data: parentRows } = await auth.supabase
    .from("improvement_goals")
    .select("id")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const parentGoalId =
    Array.isArray(parentRows) && parentRows.length > 0
      ? (parentRows[0].id as string)
      : null;

  let subs: Array<{ id: string; title: string; ready: boolean }> = [];
  if (parentGoalId) {
    const { data: childRows } = await auth.supabase
      .from("improvement_goals")
      .select("id, title, room_layers_generated_at")
      .eq("space_id", spaceId)
      .eq("parent_goal_id", parentGoalId)
      .order("created_at", { ascending: true });
    subs = (
      (childRows ?? []) as Array<{
        id: string;
        title: string;
        room_layers_generated_at: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      title: r.title,
      ready: r.room_layers_generated_at != null,
    }));
  }

  return NextResponse.json({ objectiveTitle, subs });
}
