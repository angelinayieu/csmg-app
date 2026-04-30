// ── POST /api/pipeline/research/round ──
//
// Phase 5 — outcome-anchored modular round entry point. Runs the full
// pass sequence (outcome_breadth → triangulation → adversarial →
// cycle_close → boundary_condition) for a single declared outcome
// variable, persists per-pass + per-round metrics into the new
// research_rounds table.
//
// Body:
//   {
//     spaceId: string,
//     outcomeVariable: ResearchTargetOutcome,    // required
//     researchDepth?: ResearchDepth,             // default "standard"
//     maxLlmCalls?: number,                      // default 30
//     existingRunId?: string                     // optional rehydrate
//   }
//
// Response:
//   {
//     roundId: string,
//     status: "completed" | "failed",
//     metrics: RoundMetrics,
//     passes: PassResultRow[],
//     terminationReason: string | null
//   }
//
// Auth: user must own the space.
//
// Cost: bounded by maxLlmCalls (default 30). Worst-case ~10 minutes
// of wall time at deep depth — keeps under the 15-minute Lambda cap.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { startPipelineRun, completePipelineRun } from "@/lib/events/structural-event-bus";
import { runResearchRound } from "@/lib/pipeline/round-orchestrator";
import type { ResearchTargetOutcome } from "@/lib/prompts/domain-expert";
import type { ResearchDepth } from "@/lib/web-search";

export const runtime = "nodejs";
export const maxDuration = 900; // 15 min ceiling — single Lambda invocation owns the whole round

interface RequestBody {
  spaceId?: string;
  outcomeVariable?: ResearchTargetOutcome;
  researchDepth?: ResearchDepth;
  maxLlmCalls?: number;
  existingRunId?: string;
}

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } = await safeJsonParse<RequestBody>(request);
    if (parseError) return parseError;

    const {
      spaceId,
      outcomeVariable,
      researchDepth,
      maxLlmCalls,
      existingRunId,
    } = body ?? {};

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }
    if (!outcomeVariable || typeof outcomeVariable.name !== "string" || !outcomeVariable.name.trim()) {
      return NextResponse.json(
        { error: "outcomeVariable.name required (and non-empty)" },
        { status: 400 },
      );
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // ── Resolve / open the pipeline_run ─────────────────────────────
    // Either the caller threaded an existing run (chained from another
    // pipeline that wants the round to run on the same SSE stream), or
    // we open a fresh one with pipeline='research_round' so the round
    // owns its own subscription.
    let runId: string | null = existingRunId ?? null;
    if (!runId) {
      runId = await startPipelineRun(db, {
        spaceId,
        userId: user.id,
        pipeline: "research_round",
        initialPrompt: `Round: ${outcomeVariable.name}`,
      });
      if (!runId) {
        return NextResponse.json(
          { error: "failed to start pipeline_run for round" },
          { status: 500 },
        );
      }
    }

    // ── Run the round (single-shot in this Lambda) ──────────────────
    // Soft-fail per pass is handled inside the orchestrator. Anything
    // that bubbles up from runResearchRound is a hard failure — mark
    // the run failed before returning so the SSE stream gets a
    // terminal event.
    let result;
    try {
      result = await runResearchRound({
        db,
        spaceId,
        runId,
        outcomeVariable,
        origin: new URL(request.url).origin,
        cookieHeader: request.headers.get("cookie") ?? "",
        researchDepth,
        maxLlmCalls,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await completePipelineRun(db, runId, "failed", message).catch(() => {});
      return NextResponse.json(
        {
          error: `round orchestrator failed: ${message}`,
          runId,
        },
        { status: 500 },
      );
    }

    // Round-orchestrator-level outcome maps to pipeline_run status —
    // round=completed → run='completed'; round=failed → run='failed'.
    // Only mark the run terminal when WE opened it (existingRunId
    // means the caller owns the run lifecycle).
    if (!existingRunId) {
      await completePipelineRun(
        db,
        runId,
        result.status === "completed" ? "completed" : "failed",
        result.terminationReason ?? undefined,
      ).catch(() => {});
    }

    return NextResponse.json({
      runId,
      ...result,
    });
  } catch (outerErr) {
    console.error("[research/round] unhandled:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Round entry failed unexpectedly",
      },
      { status: 500 },
    );
  }
}
