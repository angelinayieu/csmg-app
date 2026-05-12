// ── POST /api/spaces/[id]/framing/approve ────────────────────────────
//
// Approve a problem-framing pick. Flips the latest pending
// twin_proposals(kind='problem_twin') row from user_status='proposed'
// to 'approved' AND emits a framing_approved event with
// approvalMode: 'user'.
//
// Body (all optional):
//   {
//     proposal_id?: string,   // defensive: must match the latest
//                             // 'proposed' problem_twin for this
//                             // space. Prevents stale-tab writes.
//     run_id?: string,        // SSE run context for event emit.
//                             // Falls back to spaces' latest
//                             // pipeline_run when omitted.
//   }
//
// Re-rank semantics: this endpoint does NOT re-rank. If the user
// wants to approve a non-rank-1 option, the client should call
// /api/spaces/[id]/framing/select FIRST to change chosen_rank, then
// /approve to commit. Keeping the two operations separate matches
// the same separation in the strategy gate
// (twin-proposal/swap-rank + twin-proposal/approve).
//
// Idempotency: re-approving an already-approved row is a 200 + the
// row as-is. Re-approving a 'superseded' or 'rejected' row is a 409
// — terminal states require a fresh frame-panel run.
//
// Cascade-supersede:
// On approval, marks any other lingering 'proposed' problem_twin
// rows for this space as 'superseded' so the canvas always sees ONE
// actionable framing per space.
//
// Downstream effects:
//   • spaces.situation_frame stays unchanged (legacy contract).
//   • The just-approved row's frame_payload.options[chosen_rank-1] is
//     the canonical chosen framing for downstream consumers.
//   • Future: a loadChosenFramingForSpace helper used by
//     strategy-engine reads this row's chosen option to condition
//     the synthesis prompt.
//
// Auth: caller must own the space. 404 on cross-space attempts.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { FramingApprovedEvent } from "@/types/pipeline-events";
// Sprint W3.4 — materialize proto-entities on commit (proposed →
// approved). Mirrors the materialization in /framing/select so both
// commit paths produce the same downstream KG seed.
import { persistFramingProtos } from "@/lib/pipeline/persist-framing-protos";

export const dynamic = "force-dynamic";

interface ApproveBody {
  proposal_id?: string;
  run_id?: string;
}

interface FrameOption {
  framing_id?: string;
  chosen_approach?: string;
  [key: string]: unknown;
}

interface FramePayload {
  options: FrameOption[];
  chosen_rank: number;
  [key: string]: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body } = await safeJsonParse<ApproveBody>(request);
  const requestedProposalId =
    typeof body?.proposal_id === "string" ? body.proposal_id : null;
  const explicitRunId = typeof body?.run_id === "string" ? body.run_id : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Find the row to approve ──────────────────────────────────────
  //
  // When the caller provided proposal_id, look it up by ID (defensive
  // — guards against approving the wrong row from a stale browser
  // tab while a newer frame-panel run produced a fresher proposal).
  // Otherwise pick the latest 'proposed' row for this space.
  //
  // The idx_twin_proposals_pending_by_kind partial index makes the
  // unscoped lookup O(log n).
  let lookupBuilder = db
    .from("twin_proposals")
    .select("id, frame_payload, user_status, generated_at, approved_at")
    .eq("space_id", spaceId)
    .eq("kind", "problem_twin");

  if (requestedProposalId) {
    lookupBuilder = lookupBuilder.eq("id", requestedProposalId);
  } else {
    lookupBuilder = lookupBuilder
      .eq("user_status", "proposed")
      .order("generated_at", { ascending: false })
      .limit(1);
  }

  const { data: row, error: lookupErr } = await lookupBuilder.maybeSingle();

  if (lookupErr) {
    return NextResponse.json(
      {
        error: "Failed to look up framing proposal",
        detail: lookupErr.message,
      },
      { status: 500 },
    );
  }

  if (!row) {
    return NextResponse.json(
      {
        error: requestedProposalId
          ? "Framing proposal not found"
          : "No pending problem_twin found for this space",
      },
      { status: 404 },
    );
  }

  const proposal = row as {
    id: string;
    frame_payload: FramePayload | null;
    user_status: string;
    generated_at: string;
    approved_at: string | null;
  };

  // ── Idempotency / terminal-state guards ──────────────────────────
  if (proposal.user_status === "approved") {
    // Already approved — return the row as-is. Lets retried POSTs
    // settle without surprising the client. The chrome card listens
    // for framing_approved events; we DON'T re-emit on idempotent
    // calls so the banner doesn't fire twice.
    return NextResponse.json({
      ok: true,
      already_approved: true,
      proposalId: proposal.id,
      approved_at: proposal.approved_at,
    });
  }
  if (
    proposal.user_status === "superseded" ||
    proposal.user_status === "rejected"
  ) {
    return NextResponse.json(
      {
        error: `Cannot approve a ${proposal.user_status} framing — a newer frame-panel run is required to produce a fresh proposed row.`,
      },
      { status: 409 },
    );
  }

  // ── Compute the chosen framing's display info for the event ─────
  // Per the schema: options[chosen_rank - 1] is the canonical pick.
  // Defensive: if the payload is malformed (missing options or
  // chosen_rank out of bounds), still approve but emit a fallback
  // string so the chrome card doesn't crash.
  const payload = proposal.frame_payload;
  const chosenIndex =
    payload && typeof payload.chosen_rank === "number"
      ? Math.max(0, payload.chosen_rank - 1)
      : 0;
  const chosenOption: FrameOption | undefined = payload?.options?.[chosenIndex];
  const chosenApproach =
    typeof chosenOption?.chosen_approach === "string" &&
    chosenOption.chosen_approach.length > 0
      ? chosenOption.chosen_approach
      : "Problem framing approved";

  // ── Flip status to approved ──────────────────────────────────────
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await db
    .from("twin_proposals")
    .update({
      user_status: "approved",
      approved_at: nowIso,
    })
    .eq("id", proposal.id);

  if (updateErr) {
    return NextResponse.json(
      {
        error: "Failed to approve framing",
        detail: updateErr.message,
      },
      { status: 500 },
    );
  }

  // ── Supersede any other 'proposed' problem_twin rows ─────────────
  // The just-approved row is canonical. Lingering 'proposed' rows
  // (concurrent frame-panel runs, race conditions) get demoted so
  // the canvas + downstream queries see ONE actionable framing.
  await db
    .from("twin_proposals")
    .update({ user_status: "superseded" })
    .eq("space_id", spaceId)
    .eq("kind", "problem_twin")
    .eq("user_status", "proposed")
    .neq("id", proposal.id);

  // ── Resolve runId for emit (mirror Sprint A1 fallback pattern) ──
  let runIdForEmit: string | null = explicitRunId;
  if (!runIdForEmit) {
    const { data: latestRun } = await db
      .from("pipeline_runs")
      .select("id")
      .eq("space_id", spaceId)
      .eq("created_by", user.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestRun) runIdForEmit = (latestRun as { id: string }).id;
  }

  // ── Emit framing_approved ────────────────────────────────────────
  // Soft-fail: a failed emit doesn't undo the approval. The approval
  // is persisted; chrome will pick it up on next poll.
  const approvedEvent: FramingApprovedEvent = {
    type: "framing_approved",
    proposalId: proposal.id,
    spaceId,
    approvalMode: "user",
    chosenApproach,
  };
  await emitStructuralEvent(db, runIdForEmit, approvedEvent).catch(() => {
    // emit failed — non-fatal. Already-approved state is persisted.
  });

  // Sprint W3.4 — materialize proto-entities from the approved
  // framing. Soft-fail: a write failure here logs but doesn't roll
  // back the approval (the approval is the user's intent and must
  // persist regardless of derived-state write success). Returns the
  // insert count + error list to the caller for surfacing.
  //
  // The proto-extractor itself skips materialization when
  // smallest_first_step=true (single-option fallback path — nothing
  // meaningful to persist as graph nodes).
  let protoInsertedCount = 0;
  const protoErrors: string[] = [];
  if (payload) {
    const protoResult = await persistFramingProtos(db, {
      spaceId,
      userId: user.id,
      twinProposalId: proposal.id,
      // Cast: payload was validated as FramePayload above. The
      // generic FrameOption shape from persist-framing-protos is
      // compatible with the local one (it has fewer required
      // fields).
      framePayload: payload as unknown as Parameters<
        typeof persistFramingProtos
      >[1]["framePayload"],
    }).catch((err) => {
      console.warn(
        "[framing/approve] persistFramingProtos threw:",
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    if (protoResult) {
      protoInsertedCount = protoResult.inserted_entities;
      if (protoResult.errors.length > 0) {
        protoErrors.push(...protoResult.errors);
        console.warn(
          "[framing/approve] proto-entity materialization had errors:",
          protoResult.errors,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    proposalId: proposal.id,
    chosenApproach,
    approved_at: nowIso,
    proto_entities_inserted: protoInsertedCount,
    proto_entity_errors: protoErrors,
  });
}
