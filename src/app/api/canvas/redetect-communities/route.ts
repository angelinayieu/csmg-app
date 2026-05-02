// ── /api/canvas/redetect-communities ─────────────────────────────
//
// Manual trigger for the community-detection + community-summarize
// pipeline. The same orchestrator that decompose's tail runs
// (runCommunityDetectionAndSummarize), exposed as a stand-alone POST
// for two use cases:
//
//   1. Backfill: spaces that decomposed before D8 shipped have no
//      kg_communities rows. Their KG context layer (Phase 1) goes
//      without GraphRAG-style cluster summaries — the most valuable
//      compression we have. One-click backfill fixes that.
//   2. Refresh: a user has added a chunk of new entities/edges since
//      the last detection (manual extraction, accepted research
//      proposals). Communities go stale; "↻ Re-detect" rebuilds.
//
// Cost: roughly $0.05–0.30 per re-detect depending on space size
// (each leaf community + each rollup is one Claude Sonnet call;
// MAX_SUMMARY_CALLS=30 caps the upper bound).
//
// Response shape mirrors the decompose-tail's RunCommunityTailResult
// so the caller can show what happened.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { runCommunityDetectionAndSummarize } from "@/lib/pipeline/community-tail";

// Worst-case ~30 LLM calls × ~3s each = 90s. Add slack for the
// detection algorithm + DB inserts. Stays well below Vercel pro's
// 300s ceiling.
export const maxDuration = 180;
export const runtime = "nodejs";

interface IncomingBody {
  space_id?: string;
  /** Optional pipeline run id to attach the community_detected SSE
   *  event to. When omitted (the common case from the chip button),
   *  detection still runs but no event fires — the UI re-fetches
   *  /api/spaces/[id]/communities after the response lands. */
  run_id?: string | null;
}

export async function POST(request: Request) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const parsed = await safeJsonParse<IncomingBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;
  const spaceId = body.space_id;
  if (typeof spaceId !== "string" || !spaceId) {
    return NextResponse.json(
      { error: "space_id required" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const result = await runCommunityDetectionAndSummarize({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: supabase as any,
      spaceId,
      runId: body.run_id ?? null,
    });
    if (!result) {
      // Detection no-op: under MIN_ENTITIES_FOR_DETECTION (8). Give
      // the user a clear message so the UI can show "graph too small
      // — add more entities first" instead of a generic empty state.
      return NextResponse.json({
        ok: false,
        skipped: "graph_too_small",
        message:
          "Not enough entities for community detection (minimum 8). Add more entities or run the decompose pipeline.",
      });
    }
    return NextResponse.json({
      ok: true,
      detection_run_id: result.detection_run_id,
      total_communities: result.total_communities,
      level_breakdown: result.level_breakdown,
      level_0_modularity: result.level_0_modularity,
      llm_calls: result.llm_calls,
      persisted: result.persisted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[redetect-communities] failed:", message);
    return NextResponse.json(
      { error: `Re-detection failed: ${message.slice(0, 240)}` },
      { status: 500 },
    );
  }
}
