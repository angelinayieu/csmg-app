// ── POST /api/canvas/idea-op ──
//
// Runs the non-augment, text-only canvas operations on a raw idea (a sticky
// note's text) — the ones the AI scanner offers beyond the synergy/augment
// modes. One endpoint, `kind`-dispatched, each returning a flat list of result
// rows the board renders as cards (CANVAS_AI_SCANNER_PLAN.md §2):
//   layers        — the causal-altitude stack (substrate → outcome)
//   make_technical — concrete technical components (the light, entity-free
//                    cousin of the full MechanismSpec, which stays room-scoped)

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 30;

type IdeaOpKind = "layers" | "make_technical";
const VALID_KINDS: IdeaOpKind[] = ["layers", "make_technical"];

interface Body {
  text?: unknown;
  kind?: unknown;
}

const SYSTEM: Record<IdeaOpKind, string> = {
  layers:
    "You map an idea to its causal-altitude stack. Return 4-6 layers ordered " +
    "from the lowest substrate (raw inputs / data) UP to the highest outcome " +
    "(the change the user feels). Each layer: a short title (2-4 words) and a " +
    "one-sentence description of what lives at that altitude for THIS idea.",
  make_technical:
    "You make a vague idea concrete and technical. Return 4-6 specific " +
    "technical components this idea needs — data structures, algorithms, " +
    "interfaces, services, or methods. Each: a short title (2-5 words) and a " +
    "one-sentence detail grounded in THIS idea (no generic boilerplate).",
};

export async function POST(request: Request) {
  const { error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const kind = body.kind as IdeaOpKind;

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
    const result = await llmJSON({
      system: SYSTEM[kind],
      user: text.slice(0, 4000),
      maxTokens: 1024,
      temperature: 0.5,
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

    return NextResponse.json({ items });
  } catch (err) {
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
