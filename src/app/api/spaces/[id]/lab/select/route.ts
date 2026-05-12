// ── POST /api/spaces/[id]/lab/select ─────────────────────────────────
//
// Phase 2 / Week 4 / W4.10. User-driven re-rank + commit of a
// lab_twin proposal. The lab pick page (/app/space/[id]/lab/pick)
// calls this when the user clicks "Pick this lab" or "Confirm this
// lab" on an option.
//
// Effect (mirrors framing/select route):
//   1. Update lab_payload.chosen_rank to point at the picked option
//   2. Append the previously-chosen option_id to rejected_options[]
//      so the audit log shows what was demoted
//   3. Flip user_status: proposed → approved (when picked from
//      proposed state); a same-rank re-click on a 'proposed' row
//      acts as a confirm
//   4. Cascade-supersede downstream apps via flagAllAppsInSpace with
//      reason='lab_regen' — the prior chosen lab determined the
//      execution_brief + variants for those apps, and a different
//      lab invalidates that alignment
//   5. Emit lab_selected event (for the re-rank) AND lab_approved
//      event (for the status flip) — chrome card animates the
//      transitions in order
//
// Body:
//   {
//     proposal_id: string,   // twin_proposals.id (defensive — must
//                            // match the latest lab_twin for the
//                            // space; prevents stale-tab writes)
//     lab_id: string,        // the option's lab_id slug to promote
//     run_id?: string,       // optional SSE run context
//   }
//
// Response:
//   {
//     ok: true,
//     proposal_id: string,
//     lab_payload: LabPayload,
//     user_status: 'approved',
//     approved_at: string,
//     cascade_flagged_app_ids: string[],
//     no_op: boolean,
//     confirmed_existing: boolean,
//   }

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type {
  LabApprovedEvent,
  LabSelectedEvent,
} from "@/types/pipeline-events";
import { flagAllAppsInSpace } from "@/lib/apps/staleness-triggers";
import { persistLabScaffold } from "@/lib/pipeline/lab-scaffold-bridge";
import type { LabPayload, LabConfigOption } from "@/types/lab-options";
// Sprint W5.7c — re-derive each app's variable contract against the
// newly-chosen lab. Without this, flagAllAppsInSpace marks apps stale
// but the app's config.variables (IV/DV/mediator role assignments)
// stay frozen with the old lab's IV/DV, so "Tune variable" surfaces
// stale roles until the user triggers a full strategy regen.
import { redriveAppVariablesForSpace } from "@/lib/pipeline/redrive-app-variables-for-space";

export const dynamic = "force-dynamic";

interface SelectBody {
  proposal_id?: string;
  lab_id?: string;
  run_id?: string | null;
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
  const labId = typeof body?.lab_id === "string" ? body.lab_id : null;
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
  if (!labId) {
    return NextResponse.json(
      { error: "lab_id is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load the lab_twin row ────────────────────────────────────────
  const { data: rawRow, error: loadErr } = await db
    .from("twin_proposals")
    .select("id, space_id, user_id, kind, user_status, lab_payload")
    .eq("id", proposalId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("kind", "lab_twin")
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json(
      { error: "Failed to load proposal", detail: loadErr.message },
      { status: 500 },
    );
  }
  if (!rawRow) {
    return NextResponse.json(
      { error: "Lab-twin proposal not found for this space" },
      { status: 404 },
    );
  }

  const row = rawRow as {
    id: string;
    user_status: string;
    lab_payload: LabPayload | null;
  };

  const labPayload = row.lab_payload;
  if (!labPayload || !Array.isArray(labPayload.options)) {
    return NextResponse.json(
      { error: "Proposal has no lab_payload.options to re-rank" },
      { status: 400 },
    );
  }

  // ── Find the new chosen option ───────────────────────────────────
  const newChosenIndex = labPayload.options.findIndex(
    (o) => o.lab_id === labId,
  );
  if (newChosenIndex < 0) {
    return NextResponse.json(
      {
        error: `lab_id "${labId}" not found in this proposal's options`,
      },
      { status: 400 },
    );
  }

  const previousChosenRank = labPayload.chosen_rank ?? 1;
  const newChosenRank = newChosenIndex + 1;
  const nowIso = new Date().toISOString();

  // ── Confirm-existing path ────────────────────────────────────────
  // User re-clicked the rank-1 option on a 'proposed' row to commit.
  // Same shape as framing/select's confirm path.
  if (newChosenRank === previousChosenRank) {
    if (row.user_status === "proposed") {
      // Flip status without re-rank
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
            error: "Failed to confirm current lab",
            detail: confirmErr.message,
          },
          { status: 500 },
        );
      }

      // Cascade-supersede apps. No prior approved lab existed, so
      // this is the FIRST commitment — any pre-existing apps in this
      // space were built against the strategy alone (no lab context).
      // Flag them so they regenerate against the now-approved lab.
      let cascadeAppIds: string[] = [];
      try {
        const result = await flagAllAppsInSpace(
          db,
          spaceId,
          "lab_regen",
          `pipeline:lab-select-confirm`,
          `Lab "${labPayload.options[previousChosenRank - 1]?.lab_title ?? "(unnamed)"}" confirmed — apps invalidated against new lab context.`,
        );
        cascadeAppIds = result.flagged_app_ids;
      } catch (cascadeErr) {
        console.warn(
          "[lab/select] cascade flagAllAppsInSpace failed (confirm path):",
          cascadeErr instanceof Error ? cascadeErr.message : cascadeErr,
        );
      }

      // Sprint W5.7c — actually mutate each app's variable contract.
      // The staleness flag above is signal only; without this call,
      // apps.config.variables still reflects the OLD lab's role
      // assignments. Soft-fails per app inside the helper; we log the
      // tally and move on.
      try {
        const redrive = await redriveAppVariablesForSpace(db, spaceId, user.id);
        if (redrive.updated > 0 || redrive.errors.length > 0) {
          console.log(
            `[lab/select:confirm] redrive variables updated=${redrive.updated} skipped=${redrive.skipped} errors=${redrive.errors.length} space=${spaceId}`,
          );
        }
      } catch (redriveErr) {
        console.warn(
          "[lab/select] redriveAppVariablesForSpace failed (confirm path):",
          redriveErr instanceof Error ? redriveErr.message : redriveErr,
        );
      }

      // Emit lab_approved (chrome flips to "approved" state).
      if (runId) {
        const approvedEv: LabApprovedEvent = {
          type: "lab_approved",
          proposalId: row.id,
          spaceId,
          approvalMode: "user",
          chosenApproach:
            labPayload.options[previousChosenRank - 1]?.chosen_approach ??
            "Lab approved",
          flaggedAppsCount: cascadeAppIds.length,
        };
        await emitStructuralEvent(db, runId, approvedEv).catch((emitErr) => {
          console.warn(
            "[lab/select] lab_approved emit (confirm path) failed:",
            emitErr instanceof Error ? emitErr.message : emitErr,
          );
        });
      }

      // Sprint W4.11 — lab_scaffolds materialization bridge.
      // Derives a lab_scaffolds row pre-filled from the chosen
      // LabConfigOption so the existing canvas-lab-proposal-chip +
      // LabProposalWizard pipeline keeps working. Soft-fail.
      const chosenForBridge = labPayload.options[previousChosenRank - 1];
      let scaffoldId: string | null = null;
      if (chosenForBridge) {
        const bridgeResult = await persistLabScaffold(db, {
          spaceId,
          userId: user.id,
          twinProposalId: row.id,
          chosenOption: chosenForBridge,
          pipelineRunId: runId,
        });
        scaffoldId = bridgeResult.scaffoldId;
        if (bridgeResult.errors.length > 0) {
          console.warn(
            "[lab/select] lab_scaffolds bridge errors (confirm path):",
            bridgeResult.errors,
          );
        }
      }

      return NextResponse.json({
        ok: true,
        proposal_id: row.id,
        lab_payload: labPayload,
        user_status: "approved",
        approved_at: nowIso,
        no_op: false,
        confirmed_existing: true,
        cascade_flagged_app_count: cascadeAppIds.length,
        cascade_flagged_app_ids: cascadeAppIds,
        lab_scaffold_id: scaffoldId,
      });
    }
    // Already approved + same pick = pure no-op
    return NextResponse.json({
      ok: true,
      proposal_id: row.id,
      lab_payload: labPayload,
      user_status: row.user_status,
      approved_at: nowIso,
      no_op: true,
    });
  }

  // ── Re-rank path ─────────────────────────────────────────────────
  // Promote the picked option to chosen_rank; append the prior pick
  // to rejected_options[] for audit. Mirrors framing/select's pattern.
  const previousChosen = labPayload.options[previousChosenRank - 1];
  const updatedRejected = [
    ...(labPayload.rejected_options ?? []),
    {
      lab_id: previousChosen?.lab_id ?? "",
      lab_title: previousChosen?.lab_title ?? "",
      rejected_at: nowIso,
      why_rejected:
        "User selected an alternative lab design on the gate page.",
      previous_rank: previousChosenRank,
    },
  ];

  const updatedPayload: LabPayload = {
    ...labPayload,
    chosen_rank: newChosenRank,
    rejected_options: updatedRejected,
  };

  // Flip status proposed → approved on the re-rank (same as framing
  // select). When already approved, just update payload + approved_at.
  const willFlipStatus = row.user_status === "proposed";

  const { error: updateErr } = await db
    .from("twin_proposals")
    .update({
      lab_payload: updatedPayload,
      approved_at: nowIso,
      ...(willFlipStatus ? { user_status: "approved" } : {}),
    })
    .eq("id", row.id)
    .eq("space_id", spaceId)
    .eq("user_id", user.id);

  if (updateErr) {
    return NextResponse.json(
      {
        error: "Failed to update lab proposal",
        detail: updateErr.message,
      },
      { status: 500 },
    );
  }

  // ── Cascade-supersede apps ───────────────────────────────────────
  // A change in lab design invalidates execution briefs + variants
  // for apps built against the prior chosen lab. Pessimistic policy:
  // flag ALL non-retired apps for this space.
  //
  // Soft-fail: a cascade failure does NOT roll back the lab pick.
  let cascadeAppIds: string[] = [];
  try {
    const newChosen = updatedPayload.options[newChosenIndex] as LabConfigOption;
    const result = await flagAllAppsInSpace(
      db,
      spaceId,
      "lab_regen",
      `pipeline:lab-select`,
      `Lab swapped to "${newChosen.lab_title}" (rank ${previousChosenRank} → 1) — apps invalidated against the new lab context.`,
    );
    cascadeAppIds = result.flagged_app_ids;
    if (cascadeAppIds.length > 0) {
      console.log(
        `[lab/select] cascade-flagged ${cascadeAppIds.length} apps (lab_regen) space=${spaceId}`,
      );
    }
  } catch (cascadeErr) {
    console.warn(
      "[lab/select] cascade flagAllAppsInSpace failed (re-rank path):",
      cascadeErr instanceof Error ? cascadeErr.message : cascadeErr,
    );
  }

  // Sprint W5.7c — re-derive each app's variable contract against the
  // newly-ranked-#1 lab. Mirrors the confirm-path call above; without
  // it, the variable contract surface keeps the prior lab's IV/DV
  // until the user triggers a full strategy regen.
  try {
    const redrive = await redriveAppVariablesForSpace(db, spaceId, user.id);
    if (redrive.updated > 0 || redrive.errors.length > 0) {
      console.log(
        `[lab/select:rerank] redrive variables updated=${redrive.updated} skipped=${redrive.skipped} errors=${redrive.errors.length} space=${spaceId}`,
      );
    }
  } catch (redriveErr) {
    console.warn(
      "[lab/select] redriveAppVariablesForSpace failed (re-rank path):",
      redriveErr instanceof Error ? redriveErr.message : redriveErr,
    );
  }

  // ── Emit lab_selected event ──────────────────────────────────────
  // Only when we have a runId. Pure UI re-ranks without run context
  // don't pollute the event bus.
  if (runId) {
    const newChosen = updatedPayload.options[newChosenIndex]!;
    const selectedEv: LabSelectedEvent = {
      type: "lab_selected",
      proposalId: row.id,
      spaceId,
      chosenLabId: newChosen.lab_id,
      chosenApproach: newChosen.chosen_approach,
      chosenRank: newChosenRank,
      previousChosenRank,
      cascadeAppIds,
    };
    await emitStructuralEvent(db, runId, selectedEv).catch((emitErr) => {
      console.warn(
        "[lab/select] lab_selected emit failed (non-fatal):",
        emitErr instanceof Error ? emitErr.message : emitErr,
      );
    });

    // Emit lab_approved when status just flipped. Order matches the
    // chrome card's state machine: selected (re-rank animation) →
    // approved (commit transition + cascade notice).
    if (willFlipStatus) {
      const approvedEv: LabApprovedEvent = {
        type: "lab_approved",
        proposalId: row.id,
        spaceId,
        approvalMode: "user",
        chosenApproach: newChosen.chosen_approach,
        flaggedAppsCount: cascadeAppIds.length,
      };
      await emitStructuralEvent(db, runId, approvedEv).catch((emitErr) => {
        console.warn(
          "[lab/select] lab_approved emit (re-rank path) failed:",
          emitErr instanceof Error ? emitErr.message : emitErr,
        );
      });
    }
  }

  // Sprint W4.11 — lab_scaffolds bridge for re-rank path. Only fires
  // when the status just flipped proposed → approved (a re-rank on
  // an already-approved row doesn't need a new scaffold; the prior
  // scaffold remains valid because the wizard hasn't materialized
  // subjects yet OR the user is reviewing alternatives without
  // committing yet).
  let scaffoldId: string | null = null;
  if (willFlipStatus) {
    const chosenForBridge = updatedPayload.options[newChosenIndex] as
      | LabConfigOption
      | undefined;
    if (chosenForBridge) {
      const bridgeResult = await persistLabScaffold(db, {
        spaceId,
        userId: user.id,
        twinProposalId: row.id,
        chosenOption: chosenForBridge,
        pipelineRunId: runId,
      });
      scaffoldId = bridgeResult.scaffoldId;
      if (bridgeResult.errors.length > 0) {
        console.warn(
          "[lab/select] lab_scaffolds bridge errors (re-rank path):",
          bridgeResult.errors,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    proposal_id: row.id,
    lab_payload: updatedPayload,
    user_status: willFlipStatus ? "approved" : row.user_status,
    approved_at: nowIso,
    no_op: false,
    confirmed_existing: false,
    cascade_flagged_app_count: cascadeAppIds.length,
    cascade_flagged_app_ids: cascadeAppIds,
    lab_scaffold_id: scaffoldId,
  });
}
