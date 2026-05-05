// POST /api/canvas/lasso-chat
//
// Chat endpoint scoped to a lasso selection. The client sends the
// extracted items (one-liner + content snapshot) plus a user message
// and optional prior turns. Returns a focused AI response grounded
// in the selected shapes — patterns, gaps, hypotheses, next steps.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 25;

interface LassoChatItem {
  oneLiner: string;
  content: string;
}

interface LassoChatRequest {
  spaceId: string;
  items: LassoChatItem[];
  message: string;
  priorTurns?: Array<{ role: "user" | "assistant"; text: string }>;
}

interface LassoChatResponse {
  response: string;
}

const SYSTEM_PROMPT = `You are an analytical thinking partner embedded in a knowledge canvas. The user has lasso-selected a cluster of shapes and is asking you about them.

Analyze the provided selection concretely — don't be generic. Use the exact names, concepts, and vocabulary from the selected items in your response.

Response rules:
- 2-5 sentences, direct and substantive
- If asked to find patterns: name them with specific references to the items
- If asked to find connections or gaps: be explicit about which items and why
- If asked to generate hypotheses or next steps: make them specific to this selection, not generic advice
- Avoid phrases like "great question" or "certainly"

Return strict JSON: { "response": "..." }`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<LassoChatRequest>(request);
  if (parseError) return parseError;

  const { spaceId, items, message, priorTurns = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const validItems = Array.isArray(items) ? items.slice(0, 12) : [];
  const selectionBlock =
    validItems.length > 0
      ? validItems.map((it, i) => `${i + 1}. ${it.oneLiner}`).join("\n")
      : "(no items extracted)";

  const historyBlock =
    priorTurns.length > 0
      ? `\nConversation so far:\n${priorTurns
          .slice(-6)
          .map((t) => `${t.role === "user" ? "User" : "AI"}: ${t.text}`)
          .join("\n")}\n`
      : "";

  const userPrompt = `Selected shapes on canvas (${validItems.length} total):
${selectionBlock}
${historyBlock}
User: "${message.slice(0, 500)}"

Respond helpfully and specifically to the selection.`;

  try {
    const result = await llmJSON<LassoChatResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 400,
      temperature: 0.55,
      fallback: {
        response:
          "I can see your selection. Could you be more specific about what you'd like to explore — patterns, gaps, hypotheses, or next steps?",
      },
    });

    return NextResponse.json({
      response: String(result.response ?? ""),
    });
  } catch (err) {
    console.warn("[canvas/lasso-chat]", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
