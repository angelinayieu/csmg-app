// ── POST /api/synergy/augment ──
//
// Single endpoint that dispatches all six AI augmentation modes for
// the Synergy whiteboard. The mode determines both the system prompt
// (src/lib/synergy/prompts.ts:systemForMode) and the OpenAI structured-
// output schema (schemaForMode), so callers always get a typed,
// shape-validated response without parser fallbacks.
//
// Body:
//   { transcript: string, mode: AugmentMode, context?: string, precision?: 1-5 }
//
// Response:
//   { mode, result }   // result shape depends on mode — see types.ts

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError, BEST_TUNABLE_CLAUDE_MODEL } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";
import { systemForMode, schemaForMode } from "@/lib/synergy/prompts";
import type { AugmentMode } from "@/lib/synergy/types";

export const maxDuration = 30;

const VALID_MODES: AugmentMode[] = [
  "augment",
  "decompose",
  "questions",
  "research",
  "variations",
  "rank",
  "clarify",
  "plan",
  "synthesize",
  "describe",
];

interface Body {
  transcript?: unknown;
  mode?: unknown;
  context?: unknown;
  precision?: unknown;
  /** 0–1 sampling temperature for the on-canvas "simple analysis" ops.
   *  Absent → the mode's default (rank stays deterministic). */
  temperature?: unknown;
  /** "anthropic" routes this call to the best Claude model — the canvas
   *  scanner opts in; other Synergy callers stay on the OpenAI default. */
  provider?: unknown;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  const mode = body.mode as AugmentMode;
  const context = typeof body.context === "string" ? body.context : undefined;
  const precisionRaw = typeof body.precision === "number" ? body.precision : 3;
  const precision = Math.min(5, Math.max(1, Math.round(precisionRaw)));
  const temperature =
    typeof body.temperature === "number"
      ? Math.min(1, Math.max(0, body.temperature))
      : null;
  const useClaude = body.provider === "anthropic";

  if (!transcript) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }
  if (transcript.length > 8000) {
    return NextResponse.json({ error: "transcript too long (max 8000)" }, { status: 400 });
  }
  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json(
      { error: `mode must be one of: ${VALID_MODES.join(", ")}` },
      { status: 400 },
    );
  }
  if (context && context.length > 4000) {
    return NextResponse.json({ error: "context too long (max 4000)" }, { status: 400 });
  }

  const system = systemForMode(mode, precision);
  const userMsg = context
    ? `Existing context:\n${context}\n\nNew thought:\n${transcript}`
    : transcript;
  const schema = schemaForMode(mode);

  try {
    const result = await withCharge(
      { db: supabase, userId: user.id, operation: "canvas_op", spaceId: null },
      () =>
        llmJSON({
      system,
      user: userMsg,
      maxTokens: 2048,
      // Honor the caller's slider; fall back to the mode default (rank stays
      // near-deterministic so its ordering is stable).
      temperature: temperature ?? (mode === "rank" ? 0.2 : 0.7),
      provider: useClaude ? "anthropic" : undefined,
      model: useClaude ? BEST_TUNABLE_CLAUDE_MODEL : undefined,
      responseSchema: schema as { name: string; schema: Record<string, unknown> },
        }),
    );
    return NextResponse.json({ mode, result });
  } catch (err) {
    const ce = creditErrorResponse(err);
    if (ce) return ce;
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/augment] mode=%s error:", mode, err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
