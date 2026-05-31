// ── POST /api/brainstorm/sub-objectives/from-text ─────────────────────
//
// Create a sub-objective (improvement_goals row) from ARBITRARY text — not a
// picker proposal. This is the "promote to a room" path for cards that aren't
// part of the sub-objective block (e.g. a SpecForge decision card the user
// wants to expand into its own room with layers).
//
// Mirrors the insert in sub-objectives/add (same parent-goal linkage) but
// skips the proposal-block bookkeeping, since the source isn't a proposal.
// The caller then runs /room/generate on the returned goal_id to unfurl its
// Pain → Features → Outcomes → Objective layers.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  title?: string;
  description?: string;
  rationale?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const title =
    typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!spaceId || title.length < 2) {
    return NextResponse.json(
      { error: "spaceId + title required" },
      { status: 400 },
    );
  }
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  const rationale =
    typeof body?.rationale === "string" ? body.rationale.trim() : "";

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

  // Link under the root improvement_goal (parent_goal_id IS NULL), exactly
  // like sub-objectives/add — so the new cut becomes a sibling room.
  const { data: parentRows } = await db
    .from("improvement_goals")
    .select("id")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const parentGoalId: string | null =
    Array.isArray(parentRows) && parentRows.length > 0
      ? (parentRows[0]?.id as string)
      : null;

  const insertRes = await db
    .from("improvement_goals")
    .insert({
      space_id: spaceId,
      user_id: auth.user.id,
      parent_goal_id: parentGoalId,
      objective_type: "maximize",
      title,
      description: description || title,
      auto_detection_rationale: rationale || null,
    })
    .select("id, title")
    .single();

  if (insertRes.error || !insertRes.data) {
    return NextResponse.json(
      {
        error: "Could not create the room.",
        detail: insertRes.error?.message ?? "insert failed",
      },
      { status: 500 },
    );
  }

  const newGoalId = insertRes.data.id as string;

  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId: newGoalId,
    action: "concept_branched",
    metadata: {
      source: "specforge_card",
      title,
      spawned_sub_objective_id: newGoalId,
    },
  });

  return NextResponse.json({ goal_id: newGoalId });
}
