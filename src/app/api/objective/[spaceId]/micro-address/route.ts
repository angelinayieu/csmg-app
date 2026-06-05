// POST /api/objective/[spaceId]/micro-address
//
// Tier-0 deterministic addressing pass. Takes a snapshot of the board's cards
// (caller enumerates) + reads pinned glossary terms from the space, matches
// them against every OPEN micro_question on the prompt-sharpening artifact,
// and persists `addressed_by[]` deltas back to the JSONB.
//
// Pure heuristic — no LLM, no network beyond Supabase. Idempotent and soft-
// fail: existing refs are deduped; if nothing matches, the artifact is left
// untouched. Returns the updated micros (per-macro) so the rail can render
// the new dot state without a second GET.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  matchMicros,
  applyMicroAddressing,
  type AddressCandidate,
} from "@/lib/objective-canvas/micro-matcher";
import { patchObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import type {
  PromptSharpeningArtifact,
  SalienceAnnotation,
} from "@/lib/objective-canvas/prompt-sharpening-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ spaceId: string }> };

interface CardInput {
  id: string;
  text: string;
}

const MAX_CARDS = 80;
const MAX_TEXT = 600;

export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let cards: CardInput[] = [];
  try {
    const body = (await req.json()) as { cards?: unknown };
    if (Array.isArray(body?.cards)) {
      cards = (body.cards as unknown[])
        .map((c) => {
          const o = (c && typeof c === "object" ? c : {}) as Record<
            string,
            unknown
          >;
          const id = typeof o.id === "string" ? o.id : "";
          const text = typeof o.text === "string" ? o.text : "";
          return id && text ? { id, text: text.slice(0, MAX_TEXT) } : null;
        })
        .filter((c): c is CardInput => c !== null)
        .slice(0, MAX_CARDS);
    }
  } catch {
    /* bare body — treat as no cards (we'll still consider glossary). */
  }

  const { data: space } = await db
    .from("spaces")
    .select("user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space)
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const synthesis = (space.synthesis_data as Record<string, unknown> | null) ?? {};
  const oc = (synthesis as { objective_canvas?: unknown }).objective_canvas as
    | { prompt_sharpening?: PromptSharpeningArtifact }
    | undefined;
  const artifact = oc?.prompt_sharpening;
  if (!artifact || !artifact.salience?.annotations?.length) {
    return NextResponse.json({ status: "no-artifact", deltas: 0 });
  }
  const anns = artifact.salience.annotations as SalienceAnnotation[];
  // Skip the whole pass if no annotation has micros yet (legacy artifact).
  if (!anns.some((a) => (a.micro_questions?.length ?? 0) > 0)) {
    return NextResponse.json({ status: "no-micros", deltas: 0 });
  }

  // Pinned glossary terms become addressing candidates too: a pinned term
  // whose definition overlaps with a micro's distinctive vocabulary counts
  // as "taste captured for this sub-question" even without an explicit Studio
  // resolution. (Source of the "addressing != resolving" gradient.)
  const glossary = Array.isArray((synthesis as { glossary?: unknown }).glossary)
    ? ((synthesis as { glossary: unknown[] }).glossary as Array<{
        term?: unknown;
        definition?: unknown;
        concept_slug?: unknown;
        pinned?: unknown;
      }>)
    : [];

  const candidates: AddressCandidate[] = [];
  for (const c of cards) {
    candidates.push({ kind: "card", ref: c.id, text: c.text });
  }
  for (const g of glossary) {
    if (!g || g.pinned !== true) continue;
    const term = typeof g.term === "string" ? g.term : "";
    const def = typeof g.definition === "string" ? g.definition : "";
    const slug =
      typeof g.concept_slug === "string" && g.concept_slug
        ? g.concept_slug
        : term;
    if (!slug || (!term && !def)) continue;
    candidates.push({
      kind: "glossary",
      ref: slug,
      text: `${term} ${def}`.slice(0, MAX_TEXT),
    });
  }

  const now = new Date().toISOString();
  const deltas = matchMicros(anns, candidates, now);
  if (deltas.length === 0) {
    return NextResponse.json({
      status: "ok",
      deltas: 0,
      annotations: anns,
    });
  }

  // Re-read fresh to minimise races with concurrent writers (apply-resolutions
  // / depth pass). If the freshest artifact diverged structurally — different
  // annotation set — skip the write rather than clobber it; the next call
  // re-matches against the new shape.
  const { data: fresh } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  const freshSynthesis =
    (fresh?.synthesis_data as Record<string, unknown> | null) ?? {};
  const freshArtifact = (
    (freshSynthesis as { objective_canvas?: unknown }).objective_canvas as
      | { prompt_sharpening?: PromptSharpeningArtifact }
      | undefined
  )?.prompt_sharpening;
  const freshAnns = freshArtifact?.salience?.annotations as
    | SalienceAnnotation[]
    | undefined;
  if (!freshArtifact || !freshAnns || freshAnns.length !== anns.length) {
    return NextResponse.json({
      status: "skipped-race",
      deltas: 0,
      annotations: anns,
    });
  }

  const nextAnns = applyMicroAddressing(freshAnns, deltas);
  const patched = patchObjectiveCanvasState(freshSynthesis, {
    prompt_sharpening: {
      ...freshArtifact,
      salience: { ...freshArtifact.salience!, annotations: nextAnns },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: patched })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[micro-address] persist failed:",
      writeRes.error.message,
    );
    return NextResponse.json({
      status: "persist-failed",
      deltas: 0,
      annotations: anns,
    });
  }

  return NextResponse.json({
    status: "ok",
    deltas: deltas.reduce((s, d) => s + d.newRefs.length, 0),
    annotations: nextAnns,
  });
}
