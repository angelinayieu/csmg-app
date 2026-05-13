// ── POST /api/synergy/rooms/[id]/infer-objective ──
//
// LLM-infers the "intersection objective" for a shared room — the
// one-sentence answer to "what are we collaborating on together?"
// Inputs: both anchor components + (where available) the
// directionality (a_needs_b / parallel) from the original match row.
//
// Lazy + idempotent — only runs when the column is null OR the
// caller passes `?force=1`. Cheap: one short LLM call.
//
// Both members can trigger this; the result is shared. RLS gates
// membership at the synergy_rooms select.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const SYSTEM = `You are framing two collaborators' shared focus. They've matched on two complementary brainstorm components — one from each user. Your job: write ONE sentence (under 200 chars) that captures what they're collaborating on TOGETHER.

The sentence must:
- Use "we" or imperative voice (NOT "they could explore")
- Name the concrete intersection — what one produces + the other consumes, or the shared concept they're co-ideating
- Avoid generic verbs (explore, discuss, learn about) — prefer concrete ones (validate, build, exchange, integrate, test)

Return JSON with one field: { "intersection_objective": "..." }`;

const SCHEMA = {
  name: "synergy_intersection_objective",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intersection_objective: { type: "string" },
    },
    required: ["intersection_objective"],
  },
} as const;

interface ComponentRow {
  id: string;
  kind: string;
  label_public: string;
  description_public: string;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: room, error: roomErr } = await db
    .from("synergy_rooms")
    .select("id, component_a, component_b, intersection_objective, match_request_id")
    .eq("id", roomId)
    .single();
  if (roomErr || !room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Idempotent short-circuit
  if (!force && room.intersection_objective) {
    return NextResponse.json({
      intersection_objective: room.intersection_objective,
      cached: true,
    });
  }

  const { data: comps } = await db
    .from("brainstorm_components")
    .select("id, kind, label_public, description_public")
    .in("id", [room.component_a, room.component_b]);
  const list = (comps ?? []) as ComponentRow[];
  if (list.length < 2) {
    return NextResponse.json(
      { error: "Anchor components missing — cannot infer" },
      { status: 409 },
    );
  }
  const a = list.find((c) => c.id === room.component_a);
  const b = list.find((c) => c.id === room.component_b);
  if (!a || !b) {
    return NextResponse.json(
      { error: "Anchor components missing — cannot infer" },
      { status: 409 },
    );
  }

  // Pull the match row's rationale + direction (when match_request_id
  // is set, follow it to the source match for context).
  let matchContext = "";
  if (room.match_request_id) {
    const { data: req } = await db
      .from("match_requests")
      .select("match_id")
      .eq("id", room.match_request_id)
      .maybeSingle();
    if (req?.match_id) {
      const { data: match } = await db
        .from("component_matches")
        .select("match_kind, rationale")
        .eq("id", req.match_id)
        .maybeSingle();
      if (match) {
        matchContext = `\nMatch direction: ${match.match_kind}\nWhy they matched: ${match.rationale}`;
      }
    }
  }

  const userMsg = `Component A:
  kind: ${a.kind}
  label: ${a.label_public}
  description: ${a.description_public}

Component B:
  kind: ${b.kind}
  label: ${b.label_public}
  description: ${b.description_public}${matchContext}`;

  let parsed: { intersection_objective: string };
  try {
    parsed = await llmJSON<{ intersection_objective: string }>({
      system: SYSTEM,
      user: userMsg,
      maxTokens: 256,
      temperature: 0.4,
      responseSchema: SCHEMA as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/rooms/.../infer-objective] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  const objective = parsed.intersection_objective.trim().slice(0, 400);
  const { error: updateErr } = await db
    .from("synergy_rooms")
    .update({ intersection_objective: objective })
    .eq("id", roomId);
  if (updateErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(updateErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({ intersection_objective: objective, cached: false });
}
