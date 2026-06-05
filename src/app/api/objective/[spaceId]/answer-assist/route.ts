// POST /api/objective/[spaceId]/answer-assist
//   { phrase, question, candidateReadings?, transcript } →
//   { distilled, suggestions[] }
//
// Live support for the Resolution Studio's voice/type lane. As the user
// rambles an answer to "what do you mean by <phrase>", this returns ONE
// crisp first-person distillation of their intent + up to 2 short nudges.
// Small, fast, soft-fail — the studio degrades to raw text if it errors.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ spaceId: string }> };

const ASSIST_SCHEMA = {
  name: "answer_assist_v1",
  schema: {
    type: "object",
    properties: {
      distilled: { type: "string" },
      suggestions: { type: "array", items: { type: "string" } },
    },
    required: ["distilled", "suggestions"],
  },
} as const;

const ASSIST_SYSTEM = `You support a user clarifying ONE ambiguous phrase in their project objective. You are given the phrase, the question being asked, optional candidate interpretations, and what the user has said so far (often partial, spoken, or rambling).

Return:
- distilled — ONE crisp first-person sentence (≤22 words) capturing what they seem to mean. If they've said little, infer the most likely intent from the phrase + candidates. Never ask a question back; commit to a reading.
- suggestions — up to 2 SHORT (≤8 words) alternative angles or sharpenings they might not have considered. Distinct from the distilled answer. Omit if nothing genuinely adds value (return []).

Be specific to THIS objective. No preamble, no meta-commentary.`;

export async function POST(req: Request, ctx: Ctx) {
  const { supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;

  let phrase = "";
  let question = "";
  let transcript = "";
  let candidateReadings: string[] = [];
  try {
    const b = (await req.json()) as {
      phrase?: unknown;
      question?: unknown;
      transcript?: unknown;
      candidateReadings?: unknown;
    };
    phrase = typeof b.phrase === "string" ? b.phrase.trim() : "";
    question = typeof b.question === "string" ? b.question.trim() : "";
    transcript = typeof b.transcript === "string" ? b.transcript.trim() : "";
    candidateReadings = Array.isArray(b.candidateReadings)
      ? b.candidateReadings.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    /* invalid body */
  }
  // Need at least something to work with.
  if (!phrase && !transcript)
    return NextResponse.json({ distilled: "", suggestions: [] });

  // Shared context — keep the distilled answer consistent with terms the user
  // has already resolved (+ the re-framed objective).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sctx = await buildSpaceContext(supabase as any, spaceId);

  const userMsg = [
    sctx.preamble || "",
    `Phrase: "${phrase}"`,
    question ? `Question: ${question}` : "",
    candidateReadings.length
      ? `Candidate interpretations:\n${candidateReadings.map((c) => `- ${c}`).join("\n")}`
      : "",
    `What the user has said so far:\n"""\n${transcript || "(nothing yet)"}\n"""`,
    `Return the answer_assist JSON.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const out = await llmJSON<{ distilled?: string; suggestions?: string[] }>({
      system: ASSIST_SYSTEM,
      user: userMsg,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      maxTokens: 400,
      responseSchema: ASSIST_SCHEMA,
    });
    const distilled = typeof out?.distilled === "string" ? out.distilled.trim() : "";
    const suggestions = Array.isArray(out?.suggestions)
      ? out.suggestions
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 2)
      : [];
    return NextResponse.json({ distilled, suggestions });
  } catch {
    return NextResponse.json({ distilled: "", suggestions: [] });
  }
}
