// POST /api/spaces/[id]/twin-proposal/approve
//   Marks the latest twin_proposal for this space as approved. Side-effect:
//   flips linked mechanisms.status from 'proposed' → 'approved' so the
//   downstream agent fleet can begin executing them.
//
// Body (optional): { proposal_id?: string }  — when omitted, latest is used.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";

export const maxDuration = 15;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

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
