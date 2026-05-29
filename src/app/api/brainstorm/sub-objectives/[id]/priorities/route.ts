// ── GET + POST /api/brainstorm/sub-objectives/[id]/priorities ─────
//
// Per-sub-objective priority vector. Distinct from
// /api/brainstorm/space/constraints (space-scoped hard gates).
//
// GET   — return the room's priority vector (auto-infers + persists
//         on first read so downstream prompts always see something).
// POST  — partial override; body = { tiers: Partial<PriorityTier map> }.
//         Marks source="user" and logs a `priorities_set` event so the
//         Lab Notebook reflects the touch.
//
// Storage: improvement_goals.priority_vector (jsonb column added in
// 20260904_priority_vector.sql).

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import {
  inferPriorityVector,
  readPriorityVector,
  PRIORITY_DIMENSIONS,
  summarizePriorityVector,
  type PriorityVector,
  type PriorityTier,
  type PriorityDimension,
} from "@/lib/objective-canvas/priority-vector";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PostBody {
  spaceId?: string;
  /** Partial tier override — only the dimensions the user touched
   *  are required. Unspecified dims keep their prior value. */
  tiers?: Partial<Record<PriorityDimension, PriorityTier>>;
}

function isValidTier(v: unknown): v is PriorityTier {
  return v === "low" || v === "medium" || v === "high";
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id: subObjectiveId } = await ctx.params;
  if (!subObjectiveId) {
    return NextResponse.json(
      { error: "sub-objective id required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership + fetch the row's existing vector. Same maybeSingle
  // pattern as the decisions/autopilot routes.
  const { data: sub, error: subError } = await db
    .from("improvement_goals")
    .select(
      "id, user_id, space_id, title, description, auto_detection_rationale, priority_vector",
    )
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (subError) {
    return NextResponse.json(
      { error: "DB error", detail: subError.message },
      { status: 500 },
    );
  }
  if (!sub || sub.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const existing = readPriorityVector(sub.priority_vector);
  if (existing) {
    return NextResponse.json({ vector: existing, cached: true });
  }

  // Auto-infer on first read. Pull the parent space's objective +
  // clarifying so the LLM has the macro context.
  const { data: space } = await db
    .from("spaces")
    .select("id, description, input_text, synthesis_data")
    .eq("id", sub.space_id)
    .maybeSingle();

  const objectiveText =
    (typeof space?.description === "string" && space.description.trim()) ||
    (typeof space?.input_text === "string" && space.input_text.trim()) ||
    "";

  const state = readObjectiveCanvasState(space?.synthesis_data);
  const clarifyingAnswers: Array<{ question: string; answer: string }> = [];
  if (state.clarifying) {
    for (const q of state.clarifying.questions) {
      const a = state.clarifying.answers[q.id];
      if (a?.status === "answered" && a.value) {
        clarifyingAnswers.push({ question: q.question, answer: a.value });
      }
    }
  }

  let inferred: PriorityVector;
  try {
    inferred = await inferPriorityVector({
      objectiveText,
      clarifyingAnswers,
      subObjective: {
        title: typeof sub.title === "string" ? sub.title : "",
        summary: typeof sub.description === "string" ? sub.description : null,
        rationale:
          typeof sub.auto_detection_rationale === "string"
            ? sub.auto_detection_rationale
            : null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "inference failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Persist so the next read short-circuits. Soft-fail: even if persist
  // fails, return the inferred vector so the UI isn't blank.
  const writeRes = await db
    .from("improvement_goals")
    .update({ priority_vector: inferred })
    .eq("id", subObjectiveId);
  if (writeRes.error) {
    console.warn(
      "[priorities GET] persist failed (non-fatal):",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ vector: inferred });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id: subObjectiveId } = await ctx.params;
  if (!subObjectiveId) {
    return NextResponse.json(
      { error: "sub-objective id required" },
      { status: 400 },
    );
  }

  const { data: body, error: parseError } = await safeJsonParse<PostBody>(req);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: sub, error: subError } = await db
    .from("improvement_goals")
    .select("id, user_id, space_id, priority_vector")
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (subError) {
    return NextResponse.json(
      { error: "DB error", detail: subError.message },
      { status: 500 },
    );
  }
  if (!sub || sub.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Prior vector — if absent, start from a uniform-medium baseline so
  // the partial-override merge has a complete shape to land on.
  const prior =
    readPriorityVector(sub.priority_vector) ?? {
      tiers: {
        speed: "medium" as PriorityTier,
        durability: "medium" as PriorityTier,
        reversibility: "medium" as PriorityTier,
        certainty: "medium" as PriorityTier,
        leverage: "medium" as PriorityTier,
      },
      source: "inferred" as const,
      generated_at: new Date().toISOString(),
    };

  // Merge: only validated dimensions in body.tiers override.
  const incoming = body?.tiers ?? {};
  const nextTiers = { ...prior.tiers };
  for (const dim of PRIORITY_DIMENSIONS) {
    const v = incoming[dim];
    if (isValidTier(v)) nextTiers[dim] = v;
  }

  const next: PriorityVector = {
    tiers: nextTiers,
    source: "user",
    generated_at: new Date().toISOString(),
  };

  const writeRes = await db
    .from("improvement_goals")
    .update({ priority_vector: next })
    .eq("id", subObjectiveId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  // Log so the Lab Notebook reflects the touch. Soft-fail per the
  // logDecision contract — telemetry must never block the user flow.
  void logDecision(db, {
    userId: auth.user.id,
    spaceId: sub.space_id,
    subObjectiveId,
    action: "priorities_set",
    metadata: {
      vector_summary: summarizePriorityVector(next),
      tiers: next.tiers,
      source: next.source,
    },
  });

  return NextResponse.json({ vector: next });
}
