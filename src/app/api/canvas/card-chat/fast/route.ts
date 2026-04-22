// POST /api/canvas/card-chat/fast
//
// Arc 5C.2. Stage 1 of the two-stage chat pipeline. Single LLM call,
// target latency ≤1s. Returns a plain-text response to the user's
// message plus a `should_enrich` hint telling the client whether to
// fire the Stage 2 deep endpoint in the background.
//
// `should_enrich` decision rules (encoded in the prompt):
//   • The user asked to modify, improve, or critique something → YES
//   • The user asked a factual question whose answer benefits from
//     looking at the graph/axioms → YES
//   • The user asked for an opinion or brainstorm → NO
//   • Small talk / clarification / yes-no → NO
//
// Card context includes thread ancestors (conversation chain) and tags.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 20;

interface CardChatFastRequest {
  spaceId: string;
  card: {
    shape_id: string;
    shape_type: string;
    primary_text: string;
    thread_ancestors?: Array<{ author: string | null; text: string; depth: number }>;
    tags?: string[];
  };
  user_message: string;
  prior_turns?: Array<{ role: "user" | "assistant"; text: string }>;
}

interface CardChatFastResponse {
  response: string;
  should_enrich: boolean;
}

const SYSTEM_PROMPT = `You are a thinking partner embedded in a knowledge canvas. The user has selected a specific card and is chatting with you about it.

Respond in 2-5 sentences. Be substantive, not generic. Use vocabulary from the user's card and their thread.

After your response, set "should_enrich" to:
  • true  — if the user asked to modify, improve, critique, or propose changes to the underlying strategy, OR if answering well would require walking the knowledge graph (axioms, convergences) in depth
  • false — for casual brainstorm, clarification, small talk, or when your Stage 1 answer is already complete

Return strict JSON:
{ "response": "...", "should_enrich": true|false }

Never include markdown fences, preambles, or commentary outside the JSON.`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<CardChatFastRequest>(request);
  if (parseError) return parseError;

  const { spaceId, card, user_message, prior_turns = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  if (typeof user_message !== "string" || user_message.trim().length === 0) {
    return NextResponse.json({ error: "user_message required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const threadContext =
    (card.thread_ancestors?.length ?? 0) > 0
      ? `Thread history (oldest → most recent):\n${card.thread_ancestors!
          .map((a, i) => {
            const who = a.depth === -1 ? "[root subject]" : a.author ?? `turn ${i + 1}`;
            return `  ${who}: ${a.text.slice(0, 400)}`;
          })
          .join("\n")}\n`
      : "";

  const priorBlock =
    prior_turns.length > 0
      ? `Prior chat turns with you:\n${prior_turns
          .map((t) => `  ${t.role === "user" ? "USER" : "YOU"}: ${t.text.slice(0, 300)}`)
          .join("\n")}\n`
      : "";

  const tagBlock =
    (card.tags?.length ?? 0) > 0 ? `Card tags: ${card.tags!.join(", ")}\n` : "";

  const userPrompt = `Card type: ${card.shape_type}
${threadContext}Card content:
"${card.primary_text.slice(0, 800)}"

${tagBlock}${priorBlock}User's latest message:
"${user_message.slice(0, 800)}"

Respond and decide whether Stage 2 enrichment is warranted.`;

  try {
    const result = await llmJSON<CardChatFastResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 500,
      temperature: 0.6,
      fallback: {
        response: "I'm having trouble responding right now — try rephrasing your question.",
        should_enrich: false,
      },
    });

    const response =
      typeof result.response === "string" && result.response.trim().length > 0
        ? result.response.trim()
        : "I'm not sure how to respond to that — try rephrasing.";
    const shouldEnrich = result.should_enrich === true;

    const payload: CardChatFastResponse = { response, should_enrich: shouldEnrich };
    return NextResponse.json(payload);
  } catch (err) {
    console.warn("[canvas/card-chat/fast]", err);
    return NextResponse.json(
      { error: `Chat failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
