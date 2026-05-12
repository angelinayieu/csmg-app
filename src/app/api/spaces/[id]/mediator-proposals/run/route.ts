// ── POST /api/spaces/[id]/mediator-proposals/run ─────────────────────
//
// Manual trigger for the Mediator Proposal Engine. Powers the M6
// "Bridge gaps" canvas chip. Runs the full M1→M4 pipeline synchronously
// and returns the result summary so the UI can render "added 3 new
// proposals" or "no clusters detected" feedback.
//
// Why synchronous (vs. fire-and-forget): the user clicked a button
// and is waiting; they want feedback. Auto-triggers (template-hook,
// future cron) call runMediatorProposalEngine directly inside an
// `after()` block instead.
//
// Auth: owner-only via safeAuth + verifySpaceOwnership. Matches the
// pattern used by the rest of /api/spaces/[id]/* routes.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  runMediatorProposalEngine,
  type RunMediatorEngineResult,
} from "@/lib/mediator-proposal/run-engine";

export const dynamic = "force-dynamic";

// LLM calls have wide variance — give the run plenty of headroom. At
// ~16 LLM calls × ~3s each upper bound, plus DB I/O, ~60s is a safe
// budget. Vercel's default limit on Hobby is 10s; on Pro/Enterprise
// it's higher. The route still runs to completion in dev.
export const maxDuration = 60;

interface RunResponse {
  ok: boolean;
  result: RunMediatorEngineResult;
  /** Human-readable summary the UI can display in a toast.
   *  Built from result counts so the UI doesn't need to interpret
   *  the structured fields. */
  summary: string;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const result = await runMediatorProposalEngine({
    spaceId,
    userId: user.id,
    db: supabase,
  });

  const summary = buildSummary(result);

  const payload: RunResponse = {
    ok: result.status !== "error",
    result,
    summary,
  };

  // 200 even when status === "no_clusters" — the run succeeded, there
  // just wasn't anything to propose. The UI can read result.status
  // for nuance.
  // 500 only when status === "error" (load context failed entirely).
  const statusCode = result.status === "error" ? 500 : 200;
  return NextResponse.json(payload, { status: statusCode });
}

// ── Summary builder ─────────────────────────────────────────────────

function buildSummary(result: RunMediatorEngineResult): string {
  if (result.status === "error") {
    return `Failed to run engine: ${result.fatal_error ?? "(unknown error)"}`;
  }
  if (result.status === "no_clusters") {
    return "No orphan clusters detected — your graph looks well-connected.";
  }

  const parts: string[] = [];

  // Lead with the most user-relevant outcome: how many new proposals
  // landed in the queue.
  if (result.inserted > 0) {
    parts.push(
      `${result.inserted} new ${result.inserted === 1 ? "proposal" : "proposals"} added to your queue`,
    );
  }
  if (result.skipped_idempotent > 0) {
    parts.push(
      `${result.skipped_idempotent} already in queue (unchanged)`,
    );
  }
  if (result.duplicates > 0) {
    parts.push(
      `${result.duplicates} flagged as duplicates of existing entities`,
    );
  }
  if (result.rejected > 0) {
    parts.push(`${result.rejected} rejected by validator`);
  }
  if (result.errors > 0) {
    parts.push(`${result.errors} failed to persist`);
  }

  if (parts.length === 0) {
    // E.g., 8 clusters detected but all proposed_entity were null
    // (proposer declined every one). Honest message.
    return `Detected ${result.clusters_detected} cluster${result.clusters_detected === 1 ? "" : "s"}; the proposer found no canonical bridges to suggest.`;
  }

  return parts.join(" · ");
}
