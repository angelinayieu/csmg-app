// POST /api/spaces/[id]/variable-proposals/[proposalId]/reject
//
// Marks a proposed variable as rejected (user audit). Does NOT delete the
// row — kept for telemetry + so the user can see "rejected proposals" in
// the panel and reverse the decision later. Idempotent on already-rejected
// proposals.
//
// Body: optional { reason?: string } — surfaced as the rejection_reason
// audit string in the proposal row.
//
// Returns: { proposal: VariableProposal }

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import type { VariableProposal } from "@/types/variable-proposals";

export const runtime = "nodejs";

interface RequestBody {
  reason?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> },
) {
  const { id: spaceId, proposalId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body } = await safeJsonParse<RequestBody>(request);
  const reason =
    body?.reason && typeof body.reason === "string"
      ? body.reason.trim().slice(0, 500)
      : null;

  // Fetch first to verify ownership + handle idempotency.
  const { data: proposal, error: fetchErr } = (await db
    .from("variable_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: VariableProposal | null;
    error: { message: string } | null;
  };

  if (fetchErr) {
    return NextResponse.json(
      { error: `Failed to load proposal: ${fetchErr.message}` },
      { status: 500 },
    );
  }
  if (!proposal) {
    return NextResponse.json(
      { error: "Proposal not found" },
      { status: 404 },
    );
  }

  if (proposal.user_status === "rejected") {
    return NextResponse.json({ proposal, already_rejected: true });
  }
  if (proposal.user_status === "approved") {
    return NextResponse.json(
      {
        error:
          "Proposal already approved; un-approval requires deleting the materialized entity (not supported here)",
      },
      { status: 409 },
    );
  }

  const { data: updated, error: updateErr } = (await db
    .from("variable_proposals")
    .update({
      user_status: "rejected",
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", proposalId)
    .eq("user_id", user.id)
    .select("*")
    .single()) as {
    data: VariableProposal | null;
    error: { message: string } | null;
  };

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: `Failed to reject: ${updateErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ proposal: updated });
}
