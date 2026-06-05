// ── POST /api/canvas/specforge ──
//
// One engine of the SpecForge causal product-decision chain. The client runner
// (canvas-interactions/specforge-runner.ts) calls this once per stage, threading
// the accumulated context forward, and unfurls the returned JSON as decision
// cards below the source idea. Kept a thin, stateless dispatcher — same shape as
// /api/canvas/idea-op and /api/synergy/augment — so each call stays well under
// the serverless duration cap even though the full chain is ~9 calls.
//
// Body:    { engine: SpecForgeEngineId, idea: string, context?: string,
//            // Optional persistence — present once the runner has opened
//            // a pipeline_run via /run/start. Soft-fails through if any
//            // field is missing or persistence throws.
//            runId?: string, spaceId?: string, sequence?: number,
//            summaryForContext?: string }
// Returns: { engine, result, critic, engineRunId? }   // engineRunId echoed
//          back so the runner can attach it to the placed card.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { engineSpec, VALID_ENGINES } from "@/lib/objective-canvas/specforge/engines";
import {
  buildCriticRepairInstruction,
  evaluateSpecForgeQuality,
} from "@/lib/objective-canvas/specforge/quality-critic";
import type { SpecForgeEngineId } from "@/lib/objective-canvas/specforge/types";
import { SPECFORGE_CHAIN } from "@/lib/objective-canvas/specforge/types";
import { summarizeForContext } from "@/lib/objective-canvas/specforge/cards";
import {
  recordEngineStart,
  recordEngineComplete,
  recordEngineFailed,
} from "@/lib/objective-canvas/specforge/persist-run";

export const maxDuration = 90;

interface Body {
  engine?: unknown;
  idea?: unknown;
  context?: unknown;
  // Optional persistence handle — see header comment.
  runId?: unknown;
  spaceId?: unknown;
  sequence?: unknown;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const engine = body.engine as SpecForgeEngineId;
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  const context = typeof body.context === "string" ? body.context : "";
  // Persistence is opt-in — if any required field is missing we skip
  // the engine_run row + artifact write and behave like before. This
  // keeps the route safe to call from contexts that aren't a forge run
  // (manual replay tools, future ad-hoc engine invocations, etc.).
  const pipelineRunId = typeof body.runId === "string" ? body.runId : null;
  const persistSpaceId = typeof body.spaceId === "string" ? body.spaceId : null;
  const sequenceVal =
    typeof body.sequence === "number" && Number.isInteger(body.sequence)
      ? body.sequence
      : null;
  const persistEnabled =
    !!pipelineRunId && !!persistSpaceId && sequenceVal !== null;

  if (!idea) {
    return NextResponse.json({ error: "idea is required" }, { status: 400 });
  }
  if (idea.length > 6000) {
    return NextResponse.json({ error: "idea too long (max 6000)" }, { status: 400 });
  }
  if (!VALID_ENGINES.includes(engine)) {
    return NextResponse.json(
      { error: `engine must be one of: ${VALID_ENGINES.join(", ")}` },
      { status: 400 },
    );
  }
  if (context.length > 8000) {
    return NextResponse.json({ error: "context too long (max 8000)" }, { status: 400 });
  }

  const spec = engineSpec(engine);
  if (!spec) {
    return NextResponse.json({ error: "unknown engine" }, { status: 400 });
  }

  const userMsg = context
    ? `RAW IDEA:\n${idea}\n\nPRIOR-STAGE CONTEXT (already decided — build on it, don't repeat it):\n${context}`
    : `RAW IDEA:\n${idea}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Open the engine_run row BEFORE the LLM call so durations recorded
  // on the row reflect real wall time. Soft-fail: if recordEngineStart
  // returns null we proceed with engineRunId=null and skip persistence.
  let engineRunId: string | null = null;
  if (persistEnabled) {
    engineRunId = await recordEngineStart(db, {
      pipelineRunId: pipelineRunId!,
      spaceId: persistSpaceId!,
      userId: user.id,
      engine,
      sequence: sequenceVal!,
      total: SPECFORGE_CHAIN.length,
    });
  }

  try {
    let result = await llmJSON({
      system: spec.system,
      user: userMsg,
      maxTokens: spec.maxTokens ?? 1800,
      temperature: spec.temperature,
      responseSchema: spec.schema,
    });

    let critic = evaluateSpecForgeQuality(engine, result);
    let repaired = false;
    const repairInstruction = buildCriticRepairInstruction(critic);
    if (repairInstruction) {
      result = await llmJSON({
        system: `${spec.system}\n\n${repairInstruction}`,
        user: userMsg,
        maxTokens: spec.maxTokens ?? 1800,
        temperature: spec.temperature,
        responseSchema: spec.schema,
      });
      critic = evaluateSpecForgeQuality(engine, result, true);
      repaired = true;
    }

    if (engineRunId) {
      // Compute the context summary server-side — cards.ts is tldraw-free
      // and only consumes types, so it's safe to import here. This avoids
      // the runner having to compute summary client-side then POST it back
      // in a second call. Soft-fail (summary computation is pure).
      let summary: string | null = null;
      try {
        summary = summarizeForContext(engine, result);
      } catch (e) {
        console.warn("[/api/canvas/specforge] summarizeForContext threw:", e);
      }
      await recordEngineComplete(db, {
        pipelineRunId: pipelineRunId!,
        engineRunId,
        engine,
        sequence: sequenceVal!,
        result,
        summaryForContext: summary,
        critic,
        repaired,
        spaceId: persistSpaceId!,
        userId: user.id,
      });
    }

    return NextResponse.json({ engine, result, critic, engineRunId });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      // Mark the engine_run failed before responding so the durable
      // state matches the user-visible 402. Don't await failure paths
      // to slow the response on a hot error case.
      if (engineRunId) {
        await recordEngineFailed(db, {
          pipelineRunId: pipelineRunId!,
          engineRunId,
          engine,
          sequence: sequenceVal!,
          errorMessage: credit.message,
        });
      }
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    if (engineRunId) {
      await recordEngineFailed(db, {
        pipelineRunId: pipelineRunId!,
        engineRunId,
        engine,
        sequence: sequenceVal!,
        errorMessage: sanitizeErrorMessage(err) ?? "unknown error",
      });
    }
    console.error("[/api/canvas/specforge] engine=%s error:", engine, err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
