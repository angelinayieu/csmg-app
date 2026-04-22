// POST /api/canvas/card-insights
//
// Arc 5B.3. Thread-aware probing questions for the selected canvas card.
// When the card is a thread note, the ancestor chain is included in the
// prompt so the AI understands the conversation history before probing.
//
// Returns 3-5 Socratic questions specific to the card's content + its
// context. Falls back to a heuristic generator if the LLM hiccups (same
// pattern as /api/canvas/probes).

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 25;

interface CardInsightsRequest {
  spaceId: string;
  shape_id: string;
  shape_type: string;
  primary_text: string;
  thread_ancestors?: Array<{ author: string | null; text: string; depth: number }>;
  tags?: string[];
}

interface CardInsightsResponse {
  questions: string[];
}

const SYSTEM_PROMPT = `You are a Socratic thinking partner embedded in a knowledge canvas.

A user has selected a card and wants you to sharpen their thinking about it. Given the card's content + any conversation history leading up to it, generate 3-5 PRECISE probing questions that push their analysis forward.

Rules:
- Each question under 18 words.
- Prefer questions that reveal hidden assumptions, boundary conditions, causal mechanisms, or unexpected interactions.
- Use vocabulary from the user's content — don't generalise.
- If the card is a reply in a conversation, build on the thread — don't restart the conversation.
- Do NOT include preamble, numbering, or closing remarks.

Return exactly: { "questions": ["…", "…", "…"] }`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<CardInsightsRequest>(request);
  if (parseError) return parseError;

  const { spaceId, shape_type, primary_text, thread_ancestors = [], tags = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  if (typeof primary_text !== "string" || primary_text.trim().length < 3) {
    return NextResponse.json({ questions: [] });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Format ancestor chain as conversational context. Root subject gets a
  // distinctive "[ROOT]" marker so the LLM knows where the thread started.
  const ancestorBlock =
    thread_ancestors.length > 0
      ? `Conversation so far (oldest → most recent):\n${thread_ancestors
          .map((a, i) => {
            const who = a.depth === -1 ? "[ROOT SUBJECT]" : a.author ? `${a.author}` : `Reply ${i + 1}`;
            return `  ${who}: ${a.text.slice(0, 400)}`;
          })
          .join("\n")}`
      : "";

  const tagBlock = tags.length > 0 ? `Card tags: ${tags.join(", ")}` : "";

  const userPrompt = `Card type: ${shape_type}
${ancestorBlock}

Current card content:
"${primary_text.slice(0, 800)}"

${tagBlock}

Generate 3-5 probing questions.`;

  try {
    const result = await llmJSON<CardInsightsResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 500,
      temperature: 0.55,
      fallback: { questions: [] },
    });

    let questions = (result.questions ?? [])
      .map((q) => String(q).trim())
      .filter((q) => q.length > 0);

    if (questions.length === 0) {
      const stem = primary_text.slice(0, 48).trim();
      questions = [
        `Under what condition does "${stem}" stop holding?`,
        `What mechanism would produce this effect?`,
        `Which part of the graph most tensions with this?`,
      ];
    }

    return NextResponse.json({ questions: questions.slice(0, 5) });
  } catch (err) {
    console.warn("[canvas/card-insights]", err);
    return NextResponse.json(
      { error: `Insights failed: ${sanitizeErrorMessage(err)}`, questions: [] },
      { status: 500 },
    );
  }
}
