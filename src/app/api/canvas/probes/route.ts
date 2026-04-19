// ── Canvas LLM probes ──
//
// POST /api/canvas/probes
//   body: { spaceId, text, nearby?: Array<{ name, description? }> }
//   → { questions: string[] }
//
// Generates 3-4 high-quality probing questions for the thought the user is
// typing or the entity they're looking at. Uses the cheap tier of the llm
// helper so latency stays below ~1.5s. Falls back to heuristic generator if
// the LLM call fails.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage, verifySpaceOwnership } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 20;

interface ProbesRequest {
  spaceId: string;
  text: string;
  nearby?: Array<{ name: string; description?: string }>;
}

interface ProbesResponse {
  questions: string[];
}

const SYSTEM_PROMPT = `You are a Socratic research partner sitting beside a user's knowledge canvas.

Given the user's current thought and a few nearby concepts from their existing knowledge graph, produce 3-4 SHARP probing questions that push their thinking forward.

Rules for the questions:
- Each question must be under 16 words.
- Prefer questions that reveal hidden assumptions, failure modes, boundary conditions, or unexpected interactions over the nearby concepts.
- Avoid generic prompts like "what if" or "why does this matter" — be domain-specific, using vocabulary from the user's thought.
- Do NOT ask questions that simply rephrase the user's thought.
- Do NOT include any preamble, numbering, or closing remarks. Return a strict JSON object only.

Return exactly:
{ "questions": ["…", "…", "…"] }`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<ProbesRequest>(request);
  if (parseError) return parseError;

  const { spaceId, text, nearby = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length < 3) {
    return NextResponse.json({ questions: [] });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const nearbyBlock =
    nearby.length > 0
      ? `Nearby concepts already in the graph:\n${nearby
          .slice(0, 6)
          .map((n) => `- ${n.name}${n.description ? `: ${n.description.slice(0, 80)}` : ""}`)
          .join("\n")}`
      : "(no nearby concepts)";

  const userPrompt = `User's current thought:
"${text.slice(0, 500)}"

${nearbyBlock}

Generate 3-4 probing questions.`;

  try {
    const result = await llmJSON<ProbesResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 400,
      temperature: 0.5,
      fallback: { questions: [] },
    });

    let questions = (result.questions ?? []).map((q) => String(q).trim()).filter((q) => q.length > 0);

    // Heuristic fallback if the LLM hiccups
    if (questions.length === 0) {
      const stem = text.slice(0, 48).trim();
      const top = nearby[0]?.name;
      questions = top
        ? [
            `What breaks if ${top} changes unexpectedly?`,
            `Under what condition does "${stem}" stop holding?`,
            `Which cluster in the graph most tensions with this?`,
          ]
        : [
            `Under what condition does "${stem}" stop holding?`,
            `What mechanism would produce this?`,
            `What evidence would falsify this?`,
          ];
    }

    return NextResponse.json({ questions: questions.slice(0, 4) });
  } catch (err) {
    console.warn("[canvas/probes]", err);
    return NextResponse.json(
      { error: `Probe generation failed: ${sanitizeErrorMessage(err)}`, questions: [] },
      { status: 500 },
    );
  }
}
