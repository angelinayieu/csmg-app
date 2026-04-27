// POST /api/spaces/[id]/twin-proposal/approve
//   Marks the latest twin_proposal for this space as approved. Two
//   side-effect modes selected by the proposal's `discovery_source` column:
//
//   • Strategy proposals (discovery_source IS NULL — the original path):
//     flip linked mechanisms.status from 'proposed' → 'approved' so the
//     downstream agent fleet can begin executing them.
//
//   • Discovery proposals (discovery_source IS NOT NULL — D2 phase 2,
//     docs/KG_DEPTH_CRITIQUE.md §9 D2): take the
//     justification.proposed_action_list (a list of ScenarioActions
//     produced by discovery-materializer.ts), capture a pre-commit
//     snapshot, insert a `scenarios` row, run commitScenarioToLiveKG()
//     to write the actions onto the live `entities`/`edges` tables,
//     and mark the proposal approved. This closes the simulation→KG
//     feedback loop: high-confidence convergent points discovered by
//     the probability-space engine now actually become live KG edges
//     after explicit user approval.
//
// Body (optional): { proposal_id?: string, force?: boolean }
//   - proposal_id: explicit proposal to approve; omit for latest.
//   - force: bypass the reality-calibration gate. Only honored when the
//     gate is `partial` or `uncalibrated` — there's nothing to bypass on
//     `calibrated`, and `unknown` doesn't block. The bypass is NOT
//     persisted to reality_calibrations.bypassed_at here — that stays
//     the explicit user action via /api/lab/calibration. This flag is
//     just "I saw the warning, ship it anyway for this approval."
//
// Gap B gate:
//   We re-query reality_calibrations (rather than trusting
//   justification.calibration_gate) so a stale snapshot can't sneak
//   through after a failed re-capture. The snapshot remains the UI
//   cache; this is the authoritative check. The gate fires uniformly
//   for both strategy AND discovery proposals — if the KG can't
//   reproduce reality, neither writing-back discovered edges nor
//   firing mechanisms is trustworthy.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import { captureSnapshot } from "@/lib/twin/snapshot-capture";
import { commitScenarioToLiveKG } from "@/lib/twin/commit-scenario";
import {
  isDiscoverySource,
  type DiscoveryProposalJustification,
} from "@/types/discovery-proposal";
import type { ScenarioAction } from "@/types/scenario";

export const maxDuration = 30;

type CalibrationGateRow = {
  status: "unknown" | "uncalibrated" | "partial" | "calibrated" | "bypassed";
  reproduced_count: number;
  total_count: number;
  bypassed_at: string | null;
};

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

  const { data: body } = await safeJsonParse(request);
  const explicitId = (body as { proposal_id?: string } | null)?.proposal_id;
  const force = (body as { force?: boolean } | null)?.force === true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Gap B gate ────────────────────────────────────────────────────────
  // Block approval when the KG can't reproduce the user's stated reality.
  // Soft-fail: missing row → treat as "unknown" (no baselines to prove) and
  // allow through. Only `uncalibrated` and `partial` block, and both can
  // be overridden with `force: true` so the user has an escape hatch.
  const { data: calRow } = (await db
    .from("reality_calibrations")
    .select("status, reproduced_count, total_count, bypassed_at")
    .eq("space_id", spaceId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: CalibrationGateRow | null };

  if (calRow && !calRow.bypassed_at && !force) {
    if (calRow.status === "uncalibrated" || calRow.status === "partial") {
      return NextResponse.json(
        {
          error: "calibration_gate",
          message:
            calRow.status === "uncalibrated"
              ? `Reality calibration failed: 0 of ${calRow.total_count} baselines reproduced. Approving would materialize mechanisms against a graph that doesn't match your stated reality.`
              : `Reality calibration is partial: ${calRow.reproduced_count} of ${calRow.total_count} baselines reproduced. Review the gaps before approving, or approve with force=true to override.`,
          gate: {
            status: calRow.status,
            reproduced_count: calRow.reproduced_count,
            total_count: calRow.total_count,
          },
          /** Client should surface a "Review gaps" CTA and a "Run anyway" override. */
          actions: ["review_gaps", "force_approve"],
        },
        { status: 409 },
      );
    }
  }

  // Resolve which proposal to approve. Pull the discovery columns +
  // justification so we can branch by discovery_source.
  type ResolvedProposal = {
    id: string;
    mechanism_ids: string[] | null;
    discovery_source: string | null;
    convergent_point_id: string | null;
    justification: unknown;
    user_status: "proposed" | "refined" | "approved" | "rejected";
  };

  let resolved: ResolvedProposal | null = null;
  if (!explicitId) {
    const { data: latest } = (await db
      .from("twin_proposals")
      .select(
        "id, mechanism_ids, discovery_source, convergent_point_id, justification, user_status",
      )
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: ResolvedProposal | null };
    resolved = latest;
  } else {
    const { data: row } = (await db
      .from("twin_proposals")
      .select(
        "id, mechanism_ids, discovery_source, convergent_point_id, justification, user_status",
      )
      .eq("id", explicitId)
      .eq("user_id", user.id)
      .maybeSingle()) as { data: ResolvedProposal | null };
    resolved = row;
  }

  if (!resolved) {
    return NextResponse.json(
      { error: "No twin proposal exists yet to approve" },
      { status: 404 },
    );
  }

  // Idempotency — already-approved or already-rejected rows return
  // their current state without doing the work twice.
  if (resolved.user_status === "approved") {
    return NextResponse.json({
      approved: true,
      proposal_id: resolved.id,
      already_approved: true,
    });
  }
  if (resolved.user_status === "rejected") {
    return NextResponse.json(
      { error: "Proposal was rejected; cannot approve", proposal_id: resolved.id },
      { status: 409 },
    );
  }

  const targetId = resolved.id;
  const mechanismIds = resolved.mechanism_ids ?? [];

  // ── Branch: discovery vs. strategy ─────────────────────────────────
  //
  // Discovery proposals (D2 phase 2): action_list is in
  // justification.proposed_action_list. Approval means
  // capture-snapshot → insert scenario → commit to live KG → flip
  // user_status. Mechanism flipping is irrelevant (these proposals
  // don't carry mechanism_ids).
  //
  // Strategy proposals (legacy): just flip user_status + mechanisms.
  // Live-KG writes happen elsewhere (the agent fleet executes
  // mechanisms; that's the historical commit path).
  if (isDiscoverySource(resolved.discovery_source)) {
    const justification =
      typeof resolved.justification === "object" && resolved.justification !== null
        ? (resolved.justification as Partial<DiscoveryProposalJustification>)
        : null;
    const proposedActionList =
      justification && Array.isArray(justification.proposed_action_list)
        ? (justification.proposed_action_list as ScenarioAction[])
        : [];

    if (proposedActionList.length === 0) {
      return NextResponse.json(
        {
          error:
            "Discovery proposal has no proposed_action_list — nothing to commit",
          proposal_id: targetId,
        },
        { status: 422 },
      );
    }

    // 1. Capture a pre-commit snapshot. parent_snapshot_id on the
    //    scenario row is `not null`, so we always need one. The
    //    snapshot reason "pre_strategy" is the closest semantic
    //    match in the SnapshotReason enum (we're freezing the KG
    //    state right before applying a structural change).
    let parentSnapshotId: string;
    try {
      const snap = await captureSnapshot(db, {
        spaceId,
        userId: user.id,
        reason: "pre_strategy",
      });
      parentSnapshotId = snap.snapshotId;
    } catch (snapErr) {
      console.error(
        "[twin-proposal approve] pre-commit snapshot failed:",
        snapErr,
      );
      return NextResponse.json(
        {
          error:
            "Failed to capture pre-commit snapshot; discovery not applied",
          detail:
            snapErr instanceof Error ? snapErr.message : String(snapErr),
        },
        { status: 500 },
      );
    }

    // 2. Insert a scenarios row carrying the action_list. Status
    //    'draft' so commitScenarioToLiveKG accepts it (it refuses
    //    'applied' / 'rejected' / 'superseded').
    const label =
      typeof resolved.discovery_source === "string"
        ? `Discovery: ${resolved.discovery_source} ${targetId.slice(0, 8)}`
        : `Discovery commit ${targetId.slice(0, 8)}`;
    const { data: scenarioRow, error: scenarioErr } = await db
      .from("scenarios")
      .insert({
        space_id: spaceId,
        user_id: user.id,
        parent_snapshot_id: parentSnapshotId,
        status: "draft",
        label,
        description: `Auto-created from twin_proposal ${targetId} on user approval. Source: ${resolved.discovery_source}.`,
        action_list: proposedActionList,
        action_count: proposedActionList.length,
        delta_count: 0,
      })
      .select("id")
      .single();
    if (scenarioErr || !scenarioRow) {
      console.error(
        "[twin-proposal approve] scenario insert failed:",
        scenarioErr,
      );
      return NextResponse.json(
        {
          error: "Failed to materialize scenario for discovery commit",
          detail: scenarioErr?.message ?? "unknown",
        },
        { status: 500 },
      );
    }
    const scenarioId = (scenarioRow as { id: string }).id;

    // 3. Run the commit. This applies each ScenarioAction against
    //    live entities/edges, flips scenario.status='applied', and
    //    captures a post-intervention snapshot.
    const commitResult = await commitScenarioToLiveKG(db, {
      scenarioId,
      userId: user.id,
    });
    if (!commitResult.ok) {
      // commit refused — leave the scenario in 'draft' (or whatever
      // state it ended up in) and DON'T mark the twin_proposal
      // approved. The user can retry after fixing whatever blocked
      // the commit.
      return NextResponse.json(
        {
          error:
            "Discovery commit refused; proposal NOT marked approved",
          scenario_id: scenarioId,
          detail: commitResult.error,
        },
        { status: 500 },
      );
    }

    // 4. Mark the twin_proposal approved. Non-fatal if this update
    //    fails — the live KG writes already landed; we just lose
    //    the audit link. Log loudly.
    const { error: approveErr } = await db
      .from("twin_proposals")
      .update({
        user_status: "approved",
        approved_at: new Date().toISOString(),
      })
      .eq("id", targetId)
      .eq("user_id", user.id);
    if (approveErr) {
      console.warn(
        `[twin-proposal approve] discovery commit succeeded for ${targetId} but user_status flip failed:`,
        approveErr,
      );
    }

    return NextResponse.json({
      approved: true,
      proposal_id: targetId,
      discovery_source: resolved.discovery_source,
      scenario_id: scenarioId,
      parent_snapshot_id: parentSnapshotId,
      post_snapshot_id: commitResult.postSnapshotId,
      actions_applied: commitResult.actionsApplied,
      actions_skipped: commitResult.actionsSkipped,
    });
  }

  // ── Strategy proposal path (existing behavior) ─────────────────────

  // Approve the proposal.
  const { error: updErr } = await db
    .from("twin_proposals")
    .update({ user_status: "approved", approved_at: new Date().toISOString() })
    .eq("id", targetId)
    .eq("user_id", user.id);
  if (updErr) {
    console.error("[twin-proposal approve] update failed:", updErr);
    return NextResponse.json({ error: "Failed to approve" }, { status: 500 });
  }

  // Flip linked mechanisms to approved so the agent fleet can pick them up.
  if (mechanismIds.length > 0) {
    const { error: mechErr } = await db
      .from("mechanisms")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .in("id", mechanismIds)
      .eq("user_id", user.id)
      .eq("status", "proposed");
    if (mechErr) {
      // Non-fatal — proposal is approved even if mechanism flips failed; caller
      // can retry. Surface the warning in the response so the UI knows.
      console.error("[twin-proposal approve] mechanism update failed:", mechErr);
      return NextResponse.json({
        approved: true,
        proposal_id: targetId,
        mechanisms_updated: 0,
        warning: "Proposal approved but failed to flip mechanism statuses",
      });
    }
  }

  return NextResponse.json({
    approved: true,
    proposal_id: targetId,
    mechanisms_updated: mechanismIds.length,
  });
}
