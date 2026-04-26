// POST /api/spaces/[id]/twin-proposal/approve
//   Marks the latest twin_proposal for this space as approved. Side-effect:
//   flips linked mechanisms.status from 'proposed' → 'approved' so the
//   downstream agent fleet can begin executing them.
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
//   cache; this is the authoritative check.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";

export const maxDuration = 15;

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

  // Resolve which proposal to approve.
  let targetId = explicitId;
  let mechanismIds: string[] = [];
  if (!targetId) {
    const { data: latest } = (await db
      .from("twin_proposals")
      .select("id, mechanism_ids")
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string; mechanism_ids: string[] } | null };
    if (!latest) {
      return NextResponse.json(
        { error: "No twin proposal exists yet to approve" },
        { status: 404 },
      );
    }
    targetId = latest.id;
    mechanismIds = latest.mechanism_ids ?? [];
  } else {
    const { data: row } = (await db
      .from("twin_proposals")
      .select("mechanism_ids")
      .eq("id", targetId)
      .eq("user_id", user.id)
      .maybeSingle()) as { data: { mechanism_ids: string[] } | null };
    mechanismIds = row?.mechanism_ids ?? [];
  }

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
