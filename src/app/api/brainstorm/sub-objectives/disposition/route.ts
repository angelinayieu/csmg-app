// ── PATCH /api/brainstorm/sub-objectives/disposition ──────────────
//
// Sets a single proposal's disposition ("elected" | "rejected" |
// "deferred" | null) inside the space's sub-objective block.
// Mirrors the variation-disposition pattern in
// /api/brainstorm/item/variation/disposition.
//
// Election state lives on the proposal itself + is mirrored across
// any batch it appears in. When the user later confirms, the confirm
// route picks elected proposals (falling back to picked_proposal_ids
// for backward compat).
//
// Body: { spaceId, proposalId, disposition: "elected" | "rejected" | "deferred" | null }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  readObjectiveCanvasState,
  writeSubObjectiveBlock,
  type SubObjectiveBlock,
  type SubObjectiveDisposition,
  type SubObjectiveProposal,
} from "@/lib/objective-canvas/sub-objective-state";
import { logDecision, type DecisionAction } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  proposalId?: string;
  disposition?: SubObjectiveDisposition;
}

const ALLOWED: ReadonlyArray<SubObjectiveDisposition> = [
  "elected",
  "rejected",
  "deferred",
  null,
];

export async function PATCH(req: NextRequest) {
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
  const disposition: SubObjectiveDisposition =
    body?.disposition === null ||
    ALLOWED.includes(body?.disposition ?? null)
      ? (body?.disposition ?? null)
      : null;

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
      { error: "no sub-objective block to update" },
      { status: 409 },
    );
  }

  // Find the proposal we're mutating + capture the prior disposition
  // so we can log the transition (preference-learning signal). Also
  // grab the proposal's batch lineage to tag the log row with the
  // intent the batch came from — that's the per-intent election
  // signal the variant-lab "suggested intent" reads.
  const targetProposal = block.proposals.find((p) => p.id === proposalId);
  const priorDisposition: SubObjectiveDisposition =
    targetProposal?.disposition ?? null;
  const proposalBatchId = targetProposal?.batch_id;
  const proposalBatch = block.batches?.find((b) => b.id === proposalBatchId);

  function apply(p: SubObjectiveProposal): SubObjectiveProposal {
    return p.id === proposalId ? { ...p, disposition } : p;
  }

  const nextProposals = block.proposals.map(apply);
  const nextBatches = block.batches
    ? block.batches.map((b) => ({
        ...b,
        proposals: b.proposals.map(apply),
      }))
    : undefined;

  const nextBlock: SubObjectiveBlock = {
    ...block,
    proposals: nextProposals,
    ...(nextBatches ? { batches: nextBatches } : {}),
  };

  const nextSynth = writeSubObjectiveBlock(space.synthesis_data, nextBlock);
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  // ── Telemetry: log the disposition transition ──
  // Map disposition → action. Setting null = "clear" so we have a
  // distinct event from "elect" / "reject" / "defer" in the log.
  const action: DecisionAction =
    disposition === "elected"
      ? "elect"
      : disposition === "rejected"
        ? "reject"
        : disposition === "deferred"
          ? "defer"
          : "clear";
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    proposalId,
    action,
    batchIntent: proposalBatch?.intent ?? null,
    metadata: {
      prior_disposition: priorDisposition,
      batch_id: proposalBatchId ?? null,
      lens_coverage: targetProposal?.lens_coverage ?? [],
    },
  });

  return NextResponse.json({ sub_objectives: nextBlock });
}
