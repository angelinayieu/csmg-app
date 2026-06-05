// ── POST /api/canvas/idea-op ──
//
// Runs the non-augment, text-only canvas operations on a raw idea (a sticky
// note's text) — the ones the AI scanner offers beyond the synergy/augment
// modes. One endpoint, `kind`-dispatched, each returning a flat list of result
// rows the board renders as cards (CANVAS_AI_SCANNER_PLAN.md §2):
//   layers    — Type A: the conceptual causal-altitude stack (substrate → outcome)
//   data_flow — Type B: the practical upstream→downstream data-processing view
//   ("make_technical" routes to /api/canvas/idea-mechanism, the full spec.)

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError, BEST_TUNABLE_CLAUDE_MODEL } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";

export const maxDuration = 30;

type IdeaOpKind = "layers" | "data_flow";
const VALID_KINDS: IdeaOpKind[] = ["layers", "data_flow"];

interface Body {
  text?: unknown;
  kind?: unknown;
  /** 0–1 sampling temperature from the canvas scanner's slider. */
  temperature?: unknown;
}

const SYSTEM: Record<IdeaOpKind, string> = {
  layers:
    "You map an idea to its causal-altitude stack. Return 4-6 layers ordered " +
    "from the lowest substrate (raw inputs / data) UP to the highest outcome " +
    "(the change the user feels). Each layer: a short title (2-4 words) and a " +
    "one-sentence description of what lives at that altitude for THIS idea.",
  data_flow:
    "You map an idea's PRACTICAL data flow — the upstream→downstream " +
    "processing, NOT the conceptual depth. Return 4-6 stages ordered from raw " +
    "inputs (upstream) to final outputs (downstream). Each stage: a short " +
    "title (the processing step / data surface) and a one-sentence detail " +
    "naming the data type, where it comes from or goes, and rough scale.",
};

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const kind = body.kind as IdeaOpKind;
  const temperature =
    typeof body.temperature === "number"
      ? Math.min(1, Math.max(0, body.temperature))
      : 0.5;

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const items = await withCharge(
      { db: supabase, userId: user.id, operation: "canvas_op", spaceId: null },
      async () => {
    const result = await llmJSON({
      system: SYSTEM[kind],
      user: text.slice(0, 4000),
      maxTokens: 1024,
      // Canvas-only endpoint → always the best Claude model, slider-driven temp.
      temperature,
      provider: "anthropic",
      model: BEST_TUNABLE_CLAUDE_MODEL,
      responseSchema: {
        name: "idea_op_items",
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
                },
                required: ["title", "subtitle"],
              },
            },
          },
          required: ["items"],
        },
      },
    });

    const items = (
      (result as { items?: Array<{ title?: string; subtitle?: string }> })
        .items ?? []
    ).filter((it) => typeof it.title === "string" && it.title.trim().length > 0);

        return items;
      },
    );

    return NextResponse.json({ items });
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
    console.error("[/api/canvas/idea-op] kind=%s error:", kind, err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
