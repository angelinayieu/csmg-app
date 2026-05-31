// ── POST /api/canvas/specforge ──
//
// One engine of the SpecForge causal product-decision chain. The client runner
// (canvas-interactions/specforge-runner.ts) calls this once per stage, threading
// the accumulated context forward, and unfurls the returned JSON as decision
// cards below the source idea. Kept a thin, stateless dispatcher — same shape as
// /api/canvas/idea-op and /api/synergy/augment — so each call stays well under
// the serverless duration cap even though the full chain is ~9 calls.
//
// Body:    { engine: SpecForgeEngineId, idea: string, context?: string }
// Returns: { engine, result }   // result shape = engines.ts schema for `engine`

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { engineSpec, VALID_ENGINES } from "@/lib/objective-canvas/specforge/engines";
import type { SpecForgeEngineId } from "@/lib/objective-canvas/specforge/types";

export const maxDuration = 60;

interface Body {
  engine?: unknown;
  idea?: unknown;
  context?: unknown;
}

export async function POST(request: Request) {
  const { error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const engine = body.engine as SpecForgeEngineId;
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  const context = typeof body.context === "string" ? body.context : "";

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

  try {
    const result = await llmJSON({
      system: spec.system,
      user: userMsg,
      maxTokens: 1800,
      temperature: spec.temperature,
      responseSchema: spec.schema,
    });
    return NextResponse.json({ engine, result });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/canvas/specforge] engine=%s error:", engine, err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
