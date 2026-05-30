// ── POST /api/brainstorm/sub-objectives/add ────────────────────────
//
// Incremental sub-objective materialization. Adds ONE elected proposal
// from the variant lab as a new improvement_goals row WITHOUT touching
// the canvas stage. Used by the post-confirm "+ Add a cut" affordance
// on the main canvas — the user has already moved past picking but
// realizes they want another cut.
//
// Differs from /confirm:
//   • Confirm advances stage clarifying → picking → main
//   • Add is post-main; stage stays "main"
//   • Add inserts ONE goal, not many
//   • Add appends to picked_goal_ids / picked_proposal_ids rather
//     than overwriting them
//
// Body: { spaceId, proposalId }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  readObjectiveCanvasState,
  writeSubObjectiveBlock,
} from "@/lib/objective-canvas/sub-objective-state";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  proposalId?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const proposalId =
    typeof body?.proposalId === "string" ? body.proposalId : "";
  if (!spaceId || !proposalId) {
    return NextResponse.json(
      { error: "spaceId + proposalId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = readObjectiveCanvasState(space.synthesis_data);
  const block = state.sub_objectives;
  if (!block) {
    return NextResponse.json(
      { error: "no sub-objective block" },
      { status: 409 },
    );
  }

  const proposal = block.proposals.find((p) => p.id === proposalId);
  if (!proposal) {
    return NextResponse.json(
      { error: "proposalId not found in current block" },
      { status: 404 },
    );
  }

  // Idempotency: if the proposalId is already in picked_proposal_ids,
  // assume it was already materialized — return the existing goal id.
  if (block.picked_proposal_ids.includes(proposalId)) {
    return NextResponse.json({
      error: "proposal already added",
      already_picked: true,
    }, { status: 409 });
  }

  // Look up the parent core goal to link the new sub-objective under.
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
      title: proposal.title.slice(0, 200),
      description: proposal.summary,
      auto_detection_rationale: proposal.rationale,
    })
    .select("id, title")
    .single();
  if (insertRes.error) {
    return NextResponse.json(
      { error: "Could not add the cut.", detail: insertRes.error.message },
      { status: 500 },
    );
  }

  const newGoalId = insertRes.data?.id as string;

  // Append to picked_proposal_ids + picked_goal_ids so the picker (if
  // user navigates back) shows this proposal as already-committed.
  // Also flip its disposition to elected for consistency.
  const nextProposals = block.proposals.map((p) =>
    p.id === proposalId ? { ...p, disposition: "elected" as const } : p,
  );
  const nextBatches = block.batches?.map((b) => ({
    ...b,
    proposals: b.proposals.map((p) =>
      p.id === proposalId ? { ...p, disposition: "elected" as const } : p,
    ),
  }));

  const nextBlock = {
    ...block,
    proposals: nextProposals,
    ...(nextBatches ? { batches: nextBatches } : {}),
    picked_proposal_ids: [...block.picked_proposal_ids, proposalId],
    picked_goal_ids: [...block.picked_goal_ids, newGoalId],
  };

  const nextSynth = writeSubObjectiveBlock(space.synthesis_data, nextBlock);
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[sub-objectives/add] failed to persist block update:",
      writeRes.error.message,
    );
    // Don't fail the response — the goal row is in, that's the
    // important part. The block sync can be reconciled later.
  }

  // Telemetry: post-confirm adds are a distinct signal from initial
  // confirms — they capture "I wanted another cut after seeing the
  // first rooms." Tagged with the batch's intent.
  const sourceBatch = block.batches?.find((b) => b.id === proposal.batch_id);
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    proposalId,
    action: "confirm",
    batchIntent: sourceBatch?.intent ?? null,
    metadata: {
      batch_id: proposal.batch_id ?? null,
      lens_coverage: proposal.lens_coverage ?? [],
      confidence: proposal.confidence,
      post_confirm: true, // distinguishes from initial confirm events
      // Canonical key (was new_goal_id pre-2026-06-01) so notebook
      // row clicks can navigate to the spawned room — same field name
      // theme_distilled / concept_branched / sub-objective-add all use.
      spawned_sub_objective_id: newGoalId,
    },
  });

  return NextResponse.json({
    goal_id: newGoalId,
    sub_objectives: nextBlock,
  });
}
