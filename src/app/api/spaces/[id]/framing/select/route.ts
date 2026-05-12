// ── POST /api/spaces/[id]/framing/select ─────────────────────────────
//
// User-driven re-rank of a problem_twin proposal. The framing gate
// page (/app/space/[id]/framing) calls this when the user clicks
// "Pick this framing" on a non-rank-1 option.
//
// Effect:
//   1. Update frame_payload.chosen_rank to point at the picked option
//   2. Append the previously-chosen option_id to rejected_options[]
//      so the audit log shows what was demoted (and why)
//   3. Bump approved_at to now (the user's pick re-anchors the
//      approval moment)
//   4. Emit framing_selected event so downstream stages can refetch
//      and the chrome card can update
//
// What this does NOT do (deferred to a future supersede route):
//   - Cascade-supersede any downstream strategy_twin / executable_twin
//     rows. A different framing means a different strategy, but the
//     supersede sweep is non-trivial (need to re-fire decompose) and
//     belongs in its own endpoint. For now, the user picks; the user
//     also manually re-triggers downstream if they want it regenerated
//     against the new framing.
//
// Body:
//   {
//     proposal_id: string,   // twin_proposals.id (defensive — must
//                            // match the latest problem_twin for the
//                            // space; prevents stale tab writes)
//     framing_id: string,    // the option's framing_id slug to promote
//   }
//
// Response:
//   {
//     ok: true,
//     proposal_id: string,
//     frame_payload: FramePayload,  // updated payload for client to refresh from
//     user_status: string,           // unchanged ('approved')
//     approved_at: string,            // bumped to now
//   }

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { FramingSelectedEvent } from "@/types/pipeline-events";
// Sprint W3.4 — materialize proto-entities AT THE MOMENT user_status
// flips proposed → approved. Single materialization point per
// twin_proposal (the route's idempotency guards prevent double-fires).
import { persistFramingProtos } from "@/lib/pipeline/persist-framing-protos";

export const dynamic = "force-dynamic";

interface SelectBody {
  proposal_id?: string;
  framing_id?: string;
  /** Optional run_id for event correlation. When omitted, the
   *  framing_selected event is persisted at runId=null (which the
   *  event bus drops with a warning — acceptable for a pure UI
   *  re-rank that doesn't have a run context). Pass through from
   *  the client if the framing-pick page is launched with a run_id
   *  query param. */
  run_id?: string | null;
}

interface FramingOption {
  framing_id: string;
  framing_title: string;
  chosen_approach: string;
  load_bearing_assumption: string;
  proposed_axes: unknown[];
  supporting_lenses: string[];
  why_this_framing: string;
  when_it_wins: string;
  when_it_fails: string;
  sub_objectives: string[];
  confidence: number;
}

interface FramePayload {
  options: FramingOption[];
  chosen_rank: number;
  rejected_options: unknown[];
  framed_at: string;
  smallest_first_step: boolean;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body, error: parseErr } =
    await safeJsonParse<SelectBody>(request);
  if (parseErr) return parseErr;

  const proposalId =
    typeof body?.proposal_id === "string" ? body.proposal_id : null;
  const framingId =
    typeof body?.framing_id === "string" ? body.framing_id : null;
  const runId =
    typeof body?.run_id === "string" && body.run_id.length > 0
      ? body.run_id
      : null;

  if (!proposalId) {
    return NextResponse.json(
      { error: "proposal_id is required" },
      { status: 400 },
    );
  }
  if (!framingId) {
    return NextResponse.json(
      { error: "framing_id is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load the proposal row ──────────────────────────────────────────
  // Verify it belongs to this space + this user + is a problem_twin.
  // Prevents cross-space writes, cross-user writes, and accidentally
  // mutating a strategy_twin via the wrong endpoint.
  const { data: rawRow, error: loadErr } = await db
    .from("twin_proposals")
    .select("id, space_id, user_id, kind, user_status, frame_payload")
    .eq("id", proposalId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("kind", "problem_twin")
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json(
      { error: "Failed to load proposal", detail: loadErr.message },
      { status: 500 },
    );
  }
  if (!rawRow) {
    return NextResponse.json(
      { error: "Problem-twin proposal not found for this space" },
      { status: 404 },
    );
  }

  const row = rawRow as {
    id: string;
    user_status: string;
    frame_payload: FramePayload | null;
  };

  const framePayload = row.frame_payload;
  if (!framePayload || !Array.isArray(framePayload.options)) {
    return NextResponse.json(
      { error: "Proposal has no frame_payload.options to re-rank" },
      { status: 400 },
    );
  }

  // ── Find the new chosen option ─────────────────────────────────────
  const newChosenIndex = framePayload.options.findIndex(
    (o) => o.framing_id === framingId,
  );
  if (newChosenIndex < 0) {
    return NextResponse.json(
      {
        error: `framing_id "${framingId}" not found in this proposal's options`,
      },
      { status: 400 },
    );
  }

  const previousChosenRank = framePayload.chosen_rank ?? 1;
  const newChosenRank = newChosenIndex + 1;

  // Sprint W2.1 — treat re-selecting the current pick as "user
  // confirms" when the row is still 'proposed'. The user opened the
  // gate, saw the auto-pick, and clicked to commit. Without this,
  // 'proposed' rows would stay proposed forever (the client only
  // calls /select, not /approve). Mirrors the same flip behavior in
  // the re-rank path below.
  if (newChosenRank === previousChosenRank) {
    if (row.user_status === "proposed") {
      // Confirm the current pick: flip to 'approved', stamp
      // approved_at, emit framing_approved event.
      const nowIso = new Date().toISOString();
      const { error: confirmErr } = await db
        .from("twin_proposals")
        .update({
          user_status: "approved",
          approved_at: nowIso,
        })
        .eq("id", row.id);
      if (confirmErr) {
        return NextResponse.json(
          {
            error: "Failed to confirm current framing",
            detail: confirmErr.message,
          },
          { status: 500 },
        );
      }
      // Emit framing_approved with approvalMode: 'user' so the
      // chrome card flips to the green approved state.
      if (runId) {
        await emitStructuralEvent(db, runId, {
          type: "framing_approved",
          proposalId: row.id,
          spaceId,
          approvalMode: "user",
          chosenApproach:
            framePayload.options[previousChosenRank - 1]?.chosen_approach ??
            "Framing approved",
        }).catch((emitErr) => {
          console.warn(
            "[framing/select] framing_approved emit (confirm path) failed:",
            emitErr instanceof Error ? emitErr.message : emitErr,
          );
        });
      }

      // Sprint W3.4 — materialize proto-entities at this approval
      // moment. Soft-fail: a write failure here logs but doesn't
      // roll back the approval (the approval is the user's intent).
      const protoResult = await persistFramingProtos(db, {
        spaceId,
        userId: user.id,
        twinProposalId: row.id,
        framePayload,
      }).catch((err) => {
        console.warn(
          "[framing/select] persistFramingProtos threw (confirm path):",
          err instanceof Error ? err.message : err,
        );
        return null;
      });
      if (protoResult && protoResult.errors.length > 0) {
        console.warn(
          "[framing/select] proto-entity materialization had errors:",
          protoResult.errors,
        );
      }

      return NextResponse.json({
        ok: true,
        proposal_id: row.id,
        frame_payload: framePayload,
        user_status: "approved",
        approved_at: nowIso,
        no_op: false,
        confirmed_existing: true,
        proto_entities_inserted: protoResult?.inserted_entities ?? 0,
      });
    }
    // Already approved + same pick = pure no-op.
    return NextResponse.json({
      ok: true,
      proposal_id: row.id,
      frame_payload: framePayload,
      user_status: row.user_status,
      approved_at: new Date().toISOString(),
      no_op: true,
    });
  }

  // ── Build the updated payload ──────────────────────────────────────
  // Append the previously-chosen option's framing_id to rejected_options
  // with a reason so the audit log captures "user demoted X in favor of
  // Y." Don't remove it from options[] — that's destructive; the user
  // may want to re-pick the prior choice later.
  const previousChosen = framePayload.options[previousChosenRank - 1];
  const updatedRejected = [
    ...(framePayload.rejected_options ?? []),
    {
      framing_id: previousChosen?.framing_id ?? null,
      framing_title: previousChosen?.framing_title ?? null,
      rejected_at: new Date().toISOString(),
      why_rejected: "User selected an alternative framing on the gate page.",
      previous_rank: previousChosenRank,
    },
  ];

  const updatedPayload: FramePayload = {
    ...framePayload,
    chosen_rank: newChosenRank,
    rejected_options: updatedRejected,
  };

  const nowIso = new Date().toISOString();

  // Sprint W2.1 — flip user_status to 'approved' when transitioning
  // from 'proposed'. The user picking a different framing IS the
  // commit signal — separating /select (re-rank only) from /approve
  // (commit) would force two clicks for what's conceptually one
  // user action ("I chose this framing"). Keeps the existing client
  // UX intact: one "Pick this framing" button per card commits.
  const willFlipStatus = row.user_status === "proposed";

  // ── Persist the update ─────────────────────────────────────────────
  const { error: updateErr } = await db
    .from("twin_proposals")
    .update({
      frame_payload: updatedPayload,
      approved_at: nowIso,
      ...(willFlipStatus ? { user_status: "approved" } : {}),
    })
    .eq("id", row.id)
    .eq("space_id", spaceId)
    .eq("user_id", user.id);

  if (updateErr) {
    return NextResponse.json(
      { error: "Failed to update proposal", detail: updateErr.message },
      { status: 500 },
    );
  }

  // Sprint W2.1 — emit framing_approved when status just flipped.
  // Goes after the framing_selected emit below so the chrome card
  // animates "selected" → "approved" → dismiss in the natural order.
  // Captured here for emission after the framing_selected emit.
  const newChosenForApproval = updatedPayload.options[newChosenIndex]!;

  // ── Cascade-supersede downstream twins ─────────────────────────────
  //
  // A change in problem framing invalidates any downstream strategy /
  // executable commitments — they were built against a problem the
  // user has now demoted. Pessimistic policy: supersede EVERY
  // currently-pending strategy_twin and executable_twin for this
  // space, regardless of which framing they were built against. We
  // don't currently track source_framing_proposal_id on strategy
  // rows, so we can't disambiguate "built against A" vs "built
  // against B"; the safe default is to invalidate all and let the
  // user regenerate.
  //
  // Status filter: only flip 'proposed' or 'approved' rows. Already-
  // rejected / already-superseded rows stay in their terminal state.
  //
  // Soft-fail: a cascade failure does NOT roll back the framing
  // pick. The pick is the user's intent; cascade is a UI hint.
  // Worst case the downstream rows stay 'approved' and the user
  // sees the regenerate hint on next strategy run instead of here.
  let cascadeSupersededIds: string[] = [];
  try {
    const { data: cascadeRows, error: cascadeErr } = await db
      .from("twin_proposals")
      .update({ user_status: "superseded" })
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .in("kind", ["strategy_twin", "executable_twin"])
      .in("user_status", ["proposed", "approved"])
      .select("id, kind");

    if (cascadeErr) {
      console.warn(
        "[framing/select] cascade-supersede failed (non-fatal):",
        cascadeErr.message ?? cascadeErr,
      );
    } else if (Array.isArray(cascadeRows)) {
      cascadeSupersededIds = (cascadeRows as Array<{ id: string }>).map(
        (r) => r.id,
      );
      if (cascadeSupersededIds.length > 0) {
        const byKind = (cascadeRows as Array<{ kind: string }>).reduce<
          Record<string, number>
        >((acc, r) => {
          acc[r.kind] = (acc[r.kind] ?? 0) + 1;
          return acc;
        }, {});
        console.log(
          `[framing/select] cascade-superseded ${cascadeSupersededIds.length} downstream twins (${Object.entries(
            byKind,
          )
            .map(([k, c]) => `${k}:${c}`)
            .join(", ")}) space=${spaceId}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[framing/select] cascade-supersede threw (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Emit framing_selected event (soft-fail) ────────────────────────
  // Only emits when we have a runId. Pure UI re-ranks without a run
  // context don't pollute the event bus.
  if (runId) {
    const newChosen = updatedPayload.options[newChosenIndex]!;
    const event: FramingSelectedEvent = {
      type: "framing_selected",
      proposalId: row.id,
      spaceId,
      chosenFramingId: newChosen.framing_id,
      chosenApproach: newChosen.chosen_approach,
      chosenRank: newChosenRank,
      previousChosenRank,
      cascadeSupersededProposalIds: cascadeSupersededIds,
    };
    await emitStructuralEvent(db, runId, event).catch((emitErr) => {
      console.warn(
        "[framing/select] event emit failed (non-fatal):",
        emitErr instanceof Error ? emitErr.message : emitErr,
      );
    });

    // Sprint W2.1 — also emit framing_approved when status just
    // flipped proposed → approved. Order: framing_selected first
    // (re-rank animation), then framing_approved (commit transition).
    if (willFlipStatus) {
      await emitStructuralEvent(db, runId, {
        type: "framing_approved",
        proposalId: row.id,
        spaceId,
        approvalMode: "user",
        chosenApproach: newChosenForApproval.chosen_approach,
      }).catch((emitErr) => {
        console.warn(
          "[framing/select] framing_approved emit (re-rank path) failed:",
          emitErr instanceof Error ? emitErr.message : emitErr,
        );
      });
    }
  }

  // Sprint W3.4 — materialize proto-entities on the re-rank path
  // when status flipped proposed → approved. Same discipline as the
  // confirm-existing path above: soft-fail, log errors, surface
  // count in the response. Skips when willFlipStatus is false
  // (already-approved row re-rank — protos were materialized at
  // the prior approval moment, no need to do it again).
  let protoInsertedCount = 0;
  if (willFlipStatus) {
    const protoResult = await persistFramingProtos(db, {
      spaceId,
      userId: user.id,
      twinProposalId: row.id,
      framePayload: updatedPayload,
    }).catch((err) => {
      console.warn(
        "[framing/select] persistFramingProtos threw (re-rank path):",
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    if (protoResult) {
      protoInsertedCount = protoResult.inserted_entities;
      if (protoResult.errors.length > 0) {
        console.warn(
          "[framing/select] proto-entity materialization had errors (re-rank path):",
          protoResult.errors,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    proposal_id: row.id,
    frame_payload: updatedPayload,
    user_status: willFlipStatus ? "approved" : row.user_status,
    approved_at: nowIso,
    no_op: false,
    cascade_superseded_count: cascadeSupersededIds.length,
    cascade_superseded_ids: cascadeSupersededIds,
    proto_entities_inserted: protoInsertedCount,
  });
}
