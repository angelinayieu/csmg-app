// ── POST /api/spaces/[id]/mediator-proposals/[proposalId]/approve ────
//
// Promotes a proposed mediator entity + its accompanying proposed
// edges from the queue into the canonical graph:
//   entities.proposal_status: 'proposed_mediator' → 'approved'
//   edges.proposal_status:    'proposed'         → 'confirmed'
//
// After this fires, the entity + edges become indistinguishable from
// any other canonical graph row — they participate in queries,
// downstream pipelines, the simulator, etc. Just like any
// user-authored entity.
//
// Idempotent: approving an already-approved proposal returns 200 with
// no-op markers. Approving a rejected proposal returns 409 (the user
// can't unreject from this endpoint; they'd have to re-run the
// engine).
//
// Owner-only auth via safeAuth + verifySpaceOwnership.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface ApproveResponse {
  ok: boolean;
  proposal_id: string;
  entity_status: "approved";
  edges_confirmed: number;
  /** True when the proposal was already approved before this call. */
  already_approved: boolean;
}

export async function POST(
  _request: Request,
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

  // ── 1. Load the proposal entity to validate state ─────────────────
  const { data: proposal, error: loadErr } = await db
    .from("entities")
    .select("id, proposal_status, space_id, user_id")
    .eq("id", proposalId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json(
      { error: "Failed to load proposal", detail: loadErr.message },
      { status: 500 },
    );
  }

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const proposalRow = proposal as {
    id: string;
    proposal_status: string;
  };

  // Idempotency: already approved → no-op.
  if (proposalRow.proposal_status === "approved") {
    return NextResponse.json({
      ok: true,
      proposal_id: proposalRow.id,
      entity_status: "approved",
      edges_confirmed: 0,
      already_approved: true,
    } satisfies ApproveResponse);
  }

  // Cannot approve a previously-rejected proposal — user would need
  // to re-run the engine to surface it again.
  if (proposalRow.proposal_status === "rejected_mediator") {
    return NextResponse.json(
      {
        error:
          "Proposal was previously rejected; cannot approve. Re-run the engine to surface a fresh proposal.",
        proposal_id: proposalRow.id,
      },
      { status: 409 },
    );
  }

  // Anything other than 'proposed_mediator' is an unexpected state.
  if (proposalRow.proposal_status !== "proposed_mediator") {
    return NextResponse.json(
      {
        error: `Cannot approve proposal in state "${proposalRow.proposal_status}"`,
      },
      { status: 409 },
    );
  }

  // ── 2. Flip the entity to approved ────────────────────────────────
  const { error: updEntityErr } = await db
    .from("entities")
    .update({ proposal_status: "approved" })
    .eq("id", proposalRow.id)
    .eq("user_id", user.id);

  if (updEntityErr) {
    return NextResponse.json(
      {
        error: "Failed to approve entity",
        detail: updEntityErr.message,
      },
      { status: 500 },
    );
  }

  // ── 3. Flip accompanying edges to confirmed ───────────────────────
  // proposed_by_entity_id was set on every edge during persist,
  // so we can find them all without re-reading proposal_evidence.
  const { data: updatedEdges, error: updEdgesErr } = await db
    .from("edges")
    .update({ proposal_status: "confirmed" })
    .eq("proposed_by_entity_id", proposalRow.id)
    .eq("proposal_status", "proposed")
    .select("id");

  // Non-fatal: entity is approved even if edges fail. The user can
  // surface the partial-success in the UI and re-attempt.
  if (updEdgesErr) {
    console.warn(
      `[mediator-approve] entity approved but edges flip failed for proposal ${proposalRow.id}:`,
      updEdgesErr,
    );
  }

  const edgesConfirmed =
    ((updatedEdges as Array<{ id: string }> | null) ?? []).length;

  return NextResponse.json({
    ok: true,
    proposal_id: proposalRow.id,
    entity_status: "approved",
    edges_confirmed: edgesConfirmed,
    already_approved: false,
  } satisfies ApproveResponse);
}
