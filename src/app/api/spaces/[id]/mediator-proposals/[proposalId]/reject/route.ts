// ── POST /api/spaces/[id]/mediator-proposals/[proposalId]/reject ─────
//
// Drops a proposed mediator entity + its accompanying proposed edges
// from the queue, marking them rejected_mediator + rejected for audit.
// Hidden from default queries by the partial index, so they don't
// clutter the canvas — but kept in place so we can:
//   1. Audit which proposals the user dismissed (useful for tuning M2)
//   2. Avoid re-proposing the same cluster's bridge by recognizing
//      cluster_id + rejected status in a future M5 enhancement
//
// Body (optional): { reason?: string }
//   When provided, the reason is appended to the entity's
//   proposal_evidence under `rejection_reason` so future audits can
//   read why the user rejected.
//
// Idempotent: rejecting an already-rejected proposal returns 200 with
// already_rejected: true. Rejecting an approved proposal returns 409
// (the user would have to delete it from the canvas instead, since
// it's now a canonical entity).
//
// Owner-only auth.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface RejectResponse {
  ok: boolean;
  proposal_id: string;
  entity_status: "rejected_mediator";
  edges_rejected: number;
  /** True when the proposal was already rejected before this call. */
  already_rejected: boolean;
}

interface RejectBody {
  reason?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; proposalId: string }> },
) {
  const { id: spaceId, proposalId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body } = await safeJsonParse(request);
  const reason = (body as RejectBody | null)?.reason?.trim() ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── 1. Load the proposal entity to validate state + capture audit ─
  const { data: proposal, error: loadErr } = await db
    .from("entities")
    .select("id, proposal_status, proposal_evidence, space_id, user_id")
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
    proposal_evidence: Record<string, unknown> | null;
  };

  // Idempotency: already rejected → no-op.
  if (proposalRow.proposal_status === "rejected_mediator") {
    return NextResponse.json({
      ok: true,
      proposal_id: proposalRow.id,
      entity_status: "rejected_mediator",
      edges_rejected: 0,
      already_rejected: true,
    } satisfies RejectResponse);
  }

  // Cannot reject an approved proposal — it's now a canonical entity;
  // the user would have to delete it via the normal entity-deletion flow.
  if (proposalRow.proposal_status === "approved") {
    return NextResponse.json(
      {
        error:
          "Proposal was already approved and is now part of your graph. Delete the entity from the canvas to remove it.",
        proposal_id: proposalRow.id,
      },
      { status: 409 },
    );
  }

  // Anything other than 'proposed_mediator' is unexpected.
  if (proposalRow.proposal_status !== "proposed_mediator") {
    return NextResponse.json(
      {
        error: `Cannot reject proposal in state "${proposalRow.proposal_status}"`,
      },
      { status: 409 },
    );
  }

  // ── 2. Build updated proposal_evidence with rejection metadata ────
  const updatedEvidence = {
    ...(proposalRow.proposal_evidence ?? {}),
    rejection_reason: reason,
    rejected_at: new Date().toISOString(),
    rejected_by: user.id,
  };

  // ── 3. Flip the entity to rejected ────────────────────────────────
  const { error: updEntityErr } = await db
    .from("entities")
    .update({
      proposal_status: "rejected_mediator",
      proposal_evidence: updatedEvidence,
    })
    .eq("id", proposalRow.id)
    .eq("user_id", user.id);

  if (updEntityErr) {
    return NextResponse.json(
      {
        error: "Failed to reject entity",
        detail: updEntityErr.message,
      },
      { status: 500 },
    );
  }

  // ── 4. Flip accompanying edges to rejected ────────────────────────
  const { data: updatedEdges, error: updEdgesErr } = await db
    .from("edges")
    .update({ proposal_status: "rejected" })
    .eq("proposed_by_entity_id", proposalRow.id)
    .eq("proposal_status", "proposed")
    .select("id");

  if (updEdgesErr) {
    // Non-fatal: entity is rejected even if edges flip failed. They'll
    // remain orphaned with proposal_status='proposed' but they reference
    // a rejected_mediator entity, so the queue's filter excludes them.
    console.warn(
      `[mediator-reject] entity rejected but edges flip failed for proposal ${proposalRow.id}:`,
      updEdgesErr,
    );
  }

  const edgesRejected =
    ((updatedEdges as Array<{ id: string }> | null) ?? []).length;

  return NextResponse.json({
    ok: true,
    proposal_id: proposalRow.id,
    entity_status: "rejected_mediator",
    edges_rejected: edgesRejected,
    already_rejected: false,
  } satisfies RejectResponse);
}
