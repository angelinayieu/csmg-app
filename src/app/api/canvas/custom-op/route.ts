// ── POST /api/canvas/custom-op ──
//
// The "Custom" synthesizing op: run the user's OWN instruction over a selected
// region (the combined text of the lasso/multi-selection) and return a tight
// set of result cards. Same {text, …} → {items} contract as idea-op, so the
// canvas operation executor renders the cards below the source with no
// special-casing — the only extra field is `prompt` (the user's instruction).
// Soft-fails like its siblings.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError, BEST_TUNABLE_CLAUDE_MODEL } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 45;

interface Body {
  text?: unknown;
  prompt?: unknown;
  temperature?: unknown;
}

const SYSTEM =
  "You run the USER'S OWN instruction over the provided content and return a " +
  "tight, distilled set of result cards (4-8). Follow the instruction " +
  "faithfully — it is the task. Each card: a short title (2-6 words) and a " +
  "one-sentence subtitle. Make the cards concrete, distinct, and directly " +
  "useful; do not restate the content verbatim. For EACH card set \"type\": " +
  "\"feature\" (a capability to build), \"variable\" (a measurable quantity), " +
  "\"factor\" (a dimension / consideration), \"decision\" (a commitment / " +
  "constraint), or \"question\" (an open question).";

const RESPONSE_SCHEMA = {
  name: "custom_op_items",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            subtitle: { type: "string" },
            type: {
              type: "string",
              enum: ["feature", "variable", "factor", "decision", "question"],
            },
          },
          required: ["title", "subtitle", "type"],
        },
      },
    },
    required: ["items"],
  },
} as const;

export async function POST(request: Request) {
  const { error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const temperature =
    typeof body.temperature === "number"
      ? Math.min(1, Math.max(0, body.temperature))
      : 0.5;

  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const result = await llmJSON({
      system: SYSTEM,
      user: `Instruction:\n${prompt}\n\nContent:\n${text.slice(0, 6000)}`,
      maxTokens: 1400,
      temperature,
      provider: "anthropic",
      model: BEST_TUNABLE_CLAUDE_MODEL,
      responseSchema: RESPONSE_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });

    const items = (
      (result as {
        items?: Array<{ title?: string; subtitle?: string; type?: string }>;
      }).items ?? []
    )
      .filter((it) => typeof it.title === "string" && it.title.trim().length > 0)
      .map((it) => ({
        title: (it.title as string).trim(),
        subtitle: typeof it.subtitle === "string" ? it.subtitle.trim() : "",
        type: typeof it.type === "string" ? it.type : "factor",
      }));

    return NextResponse.json({ items });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/canvas/custom-op] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
