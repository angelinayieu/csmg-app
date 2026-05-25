// ── POST /api/brainstorm/sub-objectives/confirm ───────────────────
//
// Takes the user's picked proposal ids, materializes each as a real
// improvement_goals row under the canvas's core goal, and advances
// the canvas stage to "main".
//
// Body: { spaceId, pickedProposalIds: string[] }
//
// Idempotent-ish: if the canvas already advanced past "picking"
// (e.g., the user double-clicked), we look up the existing child
// goals instead of duplicating them.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  readObjectiveCanvasState,
  writeSubObjectiveBlock,
} from "@/lib/objective-canvas/sub-objective-state";
import { patchObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import type { SubObjectiveProposal } from "@/lib/objective-canvas/sub-objective-state";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  pickedProposalIds?: string[];
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const pickedProposalIds = Array.isArray(body?.pickedProposalIds)
    ? Array.from(
        new Set(
          (body.pickedProposalIds as unknown[])
            .filter((v): v is string => typeof v === "string"),
        ),
      )
    : [];
  if (pickedProposalIds.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one sub-objective." },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space, error: fetchError } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: "DB error", detail: fetchError.message },
      { status: 500 },
    );
  }
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = readObjectiveCanvasState(space.synthesis_data);
  const block = state.sub_objectives;
  if (!block || block.proposals.length === 0) {
    return NextResponse.json(
      { error: "No proposals to confirm." },
      { status: 409 },
    );
  }

  // Pull the chosen proposals from the persisted set.
  const picked: SubObjectiveProposal[] = pickedProposalIds
    .map((id) => block.proposals.find((p) => p.id === id))
    .filter((p): p is SubObjectiveProposal => p !== undefined);
  if (picked.length === 0) {
    return NextResponse.json(
      { error: "None of the picked ids matched a proposal." },
      { status: 400 },
    );
  }

  // Locate the canvas's core goal — created by /api/brainstorm/start.
  // We pick the most recent root-level (parent_goal_id NULL) goal in
  // this space. If there isn't one (start failed to create it), this
  // sub-objective just lands as a parent-less goal so we don't lose
  // the user's pick.
  const { data: parentRows } = await db
    .from("improvement_goals")
    .select("id, title")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const parentGoalId: string | null =
    Array.isArray(parentRows) && parentRows.length > 0
      ? (parentRows[0]?.id as string)
      : null;

  // ── Insert one improvement_goal per pick ──────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const goalRows: Record<string, any>[] = picked.map((p) => ({
    space_id: spaceId,
    user_id: auth.user.id,
    parent_goal_id: parentGoalId,
    objective_type: "maximize",
    title: p.title.slice(0, 200),
    description: p.summary,
    auto_detection_rationale: p.rationale,
  }));

  const insertRes = await db
    .from("improvement_goals")
    .insert(goalRows)
    .select("id, title");
  if (insertRes.error) {
    return NextResponse.json(
      { error: "Could not save picks.", detail: insertRes.error.message },
      { status: 500 },
    );
  }

  const insertedGoalIds: string[] = Array.isArray(insertRes.data)
    ? (insertRes.data as Array<{ id: string }>).map((r) => r.id)
    : [];

  // ── Update synthesis_data: record picks + advance stage ───────
  const nextBlock = {
    ...block,
    picked_proposal_ids: picked.map((p) => p.id),
    picked_goal_ids: insertedGoalIds,
  };
  const afterSubBlock = writeSubObjectiveBlock(
    space.synthesis_data,
    nextBlock,
  );
  const finalSynth = patchObjectiveCanvasState(afterSubBlock, {
    stage: "main",
  });

  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: finalSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "DB error", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    stage: "main",
    sub_objectives: nextBlock,
    parent_goal_id: parentGoalId,
  });
}
