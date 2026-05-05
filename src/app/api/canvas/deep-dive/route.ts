// POST /api/canvas/deep-dive
//
// User clicked a probe question from the sidebar and wants to go deeper.
// Given the question + sticky context, returns:
//   - answer: a 2-4 sentence focused response
//   - subQuestions: 4 follow-up branches to explore next
//
// Called for both the root question AND each expanded sub-question
// (same endpoint, same contract — depth is handled client-side).

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 25;

interface DeepDiveRequest {
  spaceId: string;
  question: string;
  context: string;
  relatedEntityNames?: string[];
}

interface DeepDiveResponse {
  answer: string;
  subQuestions: string[];
}

const SYSTEM_PROMPT = `You are a Socratic research partner on a knowledge canvas. The user has selected a probing question from their sticky note and wants to go deeper.

Given the question, the original note context, and any related graph concepts:
1. Write a focused, insightful answer in 2-4 sentences. Be specific—use vocabulary from the user's context. Reveal a non-obvious insight.
2. Generate exactly 4 follow-up sub-questions that branch from the answer in different directions.

Sub-question rules:
- Each must be under 20 words
- Cover different angles: mechanisms, failure modes, hidden assumptions, edge cases, or counter-examples
- Never rephrase the parent question
- Be domain-specific using terms from the context

Return exactly:
{ "answer": "...", "subQuestions": ["...", "...", "...", "..."] }

Never include markdown, preambles, or commentary outside the JSON.`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<DeepDiveRequest>(request);
  if (parseError) return parseError;

  const { spaceId, question, context, relatedEntityNames = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  if (typeof question !== "string" || question.trim().length < 4) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const relatedBlock =
    relatedEntityNames.length > 0
      ? `\nRelated concepts in graph: ${relatedEntityNames.slice(0, 6).join(", ")}`
      : "";

  const userPrompt = `Question to explore: "${question.slice(0, 200)}"

Original note context:
"${context.slice(0, 600)}"${relatedBlock}

Generate the answer and 4 sub-questions.`;

  try {
    const result = await llmJSON<DeepDiveResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 600,
      temperature: 0.6,
      fallback: {
        answer:
          "This question touches on a core tension in the system. Consider which mechanisms produce this pattern and what evidence would support or challenge it.",
        subQuestions: [
          "What mechanism produces this relationship?",
          "Under what condition does this pattern break down?",
          "What evidence would falsify this claim?",
          "Which actor in the system has the most leverage here?",
        ],
      },
    });

    return NextResponse.json({
      answer: String(result.answer ?? ""),
      subQuestions: (Array.isArray(result.subQuestions) ? result.subQuestions : [])
        .map((q) => String(q).trim())
        .filter((q) => q.length > 0)
        .slice(0, 5),
    });
  } catch (err) {
    console.warn("[canvas/deep-dive]", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
