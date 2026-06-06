// GET  /api/objective/[spaceId]/resolutions → { resolutions: Resolution[] }
// POST /api/objective/[spaceId]/resolutions { resolutions } → merge + save
//
// The Resolution Studio persists the user's answers here. They live on the
// SAME prompt_sharpening artifact (`.resolutions[]`, keyed by concept_slug,
// last-write-wins) so there's one source of truth; Phase 3 (glossary /
// variable write-back) consumes them. Soft-fail; never blocks the studio.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { patchObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import type {
  PromptSharpeningArtifact,
  Resolution,
} from "@/lib/objective-canvas/prompt-sharpening-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ spaceId: string }> };

function readArtifact(
  synthesisData: unknown,
): PromptSharpeningArtifact | null {
  const oc = (synthesisData as { objective_canvas?: unknown } | null)
    ?.objective_canvas as
    | { prompt_sharpening?: PromptSharpeningArtifact }
    | undefined;
  return oc?.prompt_sharpening ?? null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Coerce one untrusted resolution from the request body. AI-source rows
 *  preserve `confidence` + `needs_review` so the goal rail's activity strip
 *  can flag low-confidence commits; manual/voice rows ignore those fields
 *  (the user IS the confidence). */
function normalizeResolution(v: unknown): Resolution | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const phrase = asString(o.phrase).trim();
  const concept_slug = asString(o.concept_slug).trim() || slugify(phrase);
  if (!concept_slug) return null;
  const src = o.source;
  const source: Resolution["source"] =
    src === "voice" || src === "ai" ? src : "manual";
  const base: Resolution = {
    concept_slug,
    phrase,
    kind: asString(o.kind) || "concept",
    chosen_readings: Array.isArray(o.chosen_readings)
      ? o.chosen_readings.filter((x): x is string => typeof x === "string")
      : [],
    answer_text: asString(o.answer_text).trim(),
    source,
    resolved_at: asString(o.resolved_at) || new Date().toISOString(),
  };
  if (source === "ai") {
    const rawConf = o.confidence;
    if (typeof rawConf === "number" && isFinite(rawConf)) {
      base.confidence = Math.max(0, Math.min(1, rawConf));
    }
    if (typeof o.needs_review === "boolean") {
      base.needs_review = o.needs_review;
    } else if (typeof base.confidence === "number") {
      // Derive when the caller forgot to set it — keeps the rule (conf<0.7
      // OR no candidate matched) consistent with the auto-resolve route.
      base.needs_review =
        base.confidence < 0.7 || base.chosen_readings.length === 0;
    }
  }
  return base;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space)
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const artifact = readArtifact(space.synthesis_data);
  return NextResponse.json({ resolutions: artifact?.resolutions ?? [] });
}

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let incoming: Resolution[] = [];
  try {
    const body = (await req.json()) as { resolutions?: unknown };
    if (Array.isArray(body?.resolutions)) {
      incoming = body.resolutions
        .map(normalizeResolution)
        .filter((r): r is Resolution => r !== null);
    }
  } catch {
    /* invalid body */
  }
  if (!incoming.length)
    return NextResponse.json({ error: "No resolutions" }, { status: 400 });

  const { data: space } = await db
    .from("spaces")
    .select("user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space)
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const artifact = readArtifact(space.synthesis_data);
  if (!artifact)
    return NextResponse.json(
      { error: "No sharpening artifact" },
      { status: 409 },
    );

  // Merge by concept_slug — a re-answer overwrites the prior answer.
  const bySlug = new Map<string, Resolution>();
  for (const r of artifact.resolutions ?? []) bySlug.set(r.concept_slug, r);
  for (const r of incoming) bySlug.set(r.concept_slug, r);
  const merged = [...bySlug.values()];

  // Durable AI-activity audit (append-only, capped). resolutions[] is
  // last-write-wins by slug; this keeps the FULL history of what the AI
  // committed + when + its confidence — the agent's activity trail.
  const prevActivity = Array.isArray(artifact.activity) ? artifact.activity : [];
  const newActivity = incoming
    .filter((r) => r.source === "ai")
    .map((r) => ({
      concept_slug: r.concept_slug,
      phrase: r.phrase,
      kind: r.kind,
      answer_text: r.answer_text,
      confidence: r.confidence,
      needs_review: r.needs_review,
      at: r.resolved_at,
    }));
  const activity = [...prevActivity, ...newActivity].slice(-50);

  const patched = patchObjectiveCanvasState(space.synthesis_data, {
    prompt_sharpening: { ...artifact, resolutions: merged, activity },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: patched })
    .eq("id", spaceId);
  if (writeRes.error) {
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return NextResponse.json({ status: "ok", resolutions: merged });
}
