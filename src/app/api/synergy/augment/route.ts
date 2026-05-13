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
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
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
}

export async function POST(request: Request) {
  const { user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  const mode = body.mode as AugmentMode;
  const context = typeof body.context === "string" ? body.context : undefined;
  const precisionRaw = typeof body.precision === "number" ? body.precision : 3;
  const precision = Math.min(5, Math.max(1, Math.round(precisionRaw)));

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
    const result = await llmJSON({
      system,
      user: userMsg,
      maxTokens: 2048,
      temperature: mode === "rank" ? 0.2 : 0.7,
      responseSchema: schema as { name: string; schema: Record<string, unknown> },
    });
    void user; // user identity not required beyond auth check; kept for future audit logging
    return NextResponse.json({ mode, result });
  } catch (err) {
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
