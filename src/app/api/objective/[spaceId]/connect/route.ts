// ── POST /api/objective/[spaceId]/connect ─────────────────────────
//
// On-demand AI for the objective whiteboard. The user selects cards and
// presses Connect (exactly 2 → name the relationship) or Synthesize
// (3+ → name the unifying insight). Returns a normalized
// `{ headline, body }` the board renders as a *proposed* insight card.
//
// Reuses the canonical structured LLM call (`llmJSON`, OpenAI json_schema
// strict mode) + the shared telemetry wrapper (`instrumentedLLMCall`) —
// NOT a parallel pipeline. Board-only by product decision: the result is
// not written into cross_room_analysis; it lives on the board (persisted
// later via the board snapshot).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface CardPayload {
  title: string;
  chips?: string[];
  roomId?: string;
}

interface ConnectBody {
  mode?: "connect" | "synthesize";
  cards?: CardPayload[];
}

// Strict json_schema: every property is required + additionalProperties
// false (OpenAI strict mode requirement; see llmJSON).
const CONNECT_SCHEMA = {
  name: "board_connection",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: {
        type: "string",
        description:
          "The relationship in 2-4 lowercase words (e.g. 'reinforces', 'trades off against', 'feeds into', 'bottlenecks').",
      },
      body: {
        type: "string",
        description:
          "One or two sentences explaining HOW the two relate and why it matters for the objective. Concrete, specific to the content.",
      },
    },
    required: ["headline", "body"],
  },
};

const SYNTHESIZE_SCHEMA = {
  name: "board_synthesis",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: {
        type: "string",
        description: "The unifying insight in 6 words or fewer.",
      },
      body: {
        type: "string",
        description:
          "One to three sentences naming what these cards share and the practical 'so what'. Concrete, specific.",
      },
    },
    required: ["headline", "body"],
  },
};

function cardBlock(cards: CardPayload[]): string {
  return cards
    .map((c, i) => {
      const chips =
        c.chips && c.chips.length ? ` — ${c.chips.join(" · ")}` : "";
      return `${i + 1}. ${c.title}${chips}`;
    })
    .join("\n");
}

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // Ownership — match the explicit user_id check the analysis routes use.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: ConnectBody;
  try {
    body = (await req.json()) as ConnectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode = body.mode === "synthesize" ? "synthesize" : "connect";
  const cards = Array.isArray(body.cards)
    ? body.cards.filter(
        (c): c is CardPayload => !!c && typeof c.title === "string",
      )
    : [];
  if (cards.length < 2) {
    return NextResponse.json(
      { error: "Select at least two cards." },
      { status: 400 },
    );
  }

  const isConnect = mode === "connect";
  const system = isConnect
    ? "You are a systems strategist helping a user see how two parts of their strategy relate. Given two cards from their strategy board, name the single most important relationship between them. Be concrete and specific to the content — never generic boilerplate. headline = the relationship in 2-4 lowercase words. body = 1-2 sentences on how they relate and why it matters."
    : "You are a systems strategist helping a user find the throughline across several parts of their strategy. Given the cards from their strategy board, name the single most important insight that unifies them. Be concrete and specific — never generic. headline = 6 words or fewer. body = 1-3 sentences naming what they share and the practical 'so what'.";

  const user = `${
    isConnect ? "These two cards are" : "These cards are"
  } on the user's strategy board:\n\n${cardBlock(cards)}\n\n${
    isConnect
      ? "Name the relationship between them."
      : "Name the insight that unifies them."
  }`;

  try {
    const result = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: isConnect
          ? "objective:board_connect"
          : "objective:board_synthesize",
        modelHint: "gpt-4o",
        metadata: { mode, cardCount: cards.length },
      },
      () =>
        llmJSON<{ headline: string; body: string }>({
          system,
          user,
          responseSchema: isConnect ? CONNECT_SCHEMA : SYNTHESIZE_SCHEMA,
          temperature: 0.4,
          maxTokens: 400,
        }),
    );
    return NextResponse.json({
      headline: String(result.headline ?? "").trim() || "Related",
      body: String(result.body ?? "").trim(),
    });
  } catch (err) {
    console.error("[objective/connect] generation failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
