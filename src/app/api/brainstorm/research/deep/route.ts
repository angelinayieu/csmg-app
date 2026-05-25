// ── POST /api/brainstorm/research/deep ────────────────────────────
//
// Targeted research pass — fires when the user completes the
// clarifying loop (called from /api/brainstorm/clarify/complete in
// the same request flow). 3-5 lens-specific queries parallelized
// via Tavily. Bundle becomes RAG context for every downstream
// generation: decompose, room stages, correlations.
//
// Body: { spaceId, mode?: "default" | "force" }
//
// Like the surface route, idempotent — short-circuits on cached
// completed bundles unless mode=force.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  runDeepPass,
  type DeepBundle,
  type SurfaceBundle,
} from "@/lib/research/research-service";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  spaceId?: string;
  mode?: "default" | "force";
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space, error: fetchError } = await db
    .from("spaces")
    .select(
      "id, user_id, description, input_text, synthesis_data, surface_research, deep_research",
    )
    .eq("id", spaceId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: "DB error", detail: fetchError.message },
      { status: 500 },
    );
  }
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Idempotent short-circuit.
  const existing = space.deep_research as DeepBundle | null;
  if (!force && existing && (existing as { status?: string }).status === "complete") {
    return NextResponse.json({ deep_research: existing, cached: true });
  }

  const objective: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // Pull clarifying answers from the canvas state.
  const state = readObjectiveCanvasState(space.synthesis_data);
  const clarifyingAnswers: Array<{ question: string; answer: string }> = [];
  if (state.clarifying) {
    for (const q of state.clarifying.questions) {
      const a = state.clarifying.answers[q.id];
      if (a?.status === "answered" && a.value) {
        clarifyingAnswers.push({ question: q.question, answer: a.value });
      }
    }
  }

  const surface = (space.surface_research as SurfaceBundle | null) ?? null;

  // Mark pending.
  await db
    .from("spaces")
    .update({
      deep_research: {
        status: "pending",
        started_at: new Date().toISOString(),
      },
    })
    .eq("id", spaceId);

  let bundle: DeepBundle;
  try {
    bundle = await runDeepPass({
      objective,
      clarifyingAnswers,
      surface: surface ?? undefined,
    });
  } catch (err) {
    bundle = {
      status: "error",
      all_sources: [],
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
    console.warn(
      "[research/deep] runDeepPass threw:",
      sanitizeErrorMessage(err),
    );
  }

  const writeRes = await db
    .from("spaces")
    .update({ deep_research: bundle })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[research/deep] failed to persist bundle:",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ deep_research: bundle });
}
