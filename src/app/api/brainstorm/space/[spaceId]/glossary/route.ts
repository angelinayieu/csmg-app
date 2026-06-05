// ── /api/brainstorm/space/[spaceId]/glossary ──────────────────────
//
// Arc 3.5 — the context glossary for a space.
//   GET   → returns the persisted glossary (or []).
//   POST  → (re)generates from the objective + entities, persists to
//           spaces.synthesis_data.glossary (JSONB, no migration),
//           returns it.
//
// The glossary is the readability layer: key domain terms with
// context-specific definitions, surfaced as hover-definitions in the
// drawer + a definition page. See generate-glossary.ts.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  generateGlossary,
  type GlossaryTerm,
  type GlossarySource,
  type AnnotationSeed,
} from "@/lib/objective-canvas/generate-glossary";
import {
  enrichGlossaryWithEvidence,
  termSlug,
  loadCrossSpaceGlossary,
  applyCrossSpaceSeeds,
} from "@/lib/objective-canvas/taste-glossary";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

const VALID_SOURCES: GlossarySource[] = ["annotation", "entity", "llm", "user"];

/** Read the persisted glossary, preserving v2 provenance fields so a
 *  merge / edit round-trips without losing source / pinned state. */
function readGlossary(synthesisData: unknown): GlossaryTerm[] {
  if (!synthesisData || typeof synthesisData !== "object") return [];
  const g = (synthesisData as Record<string, unknown>).glossary;
  if (!Array.isArray(g)) return [];
  return (g as unknown[])
    .map((t): GlossaryTerm | null => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      const term = typeof o.term === "string" ? o.term : "";
      const definition = typeof o.definition === "string" ? o.definition : "";
      if (!term || !definition) return null;
      const aliases = Array.isArray(o.aliases)
        ? (o.aliases as unknown[]).filter(
            (a): a is string => typeof a === "string",
          )
        : [];
      const source: GlossarySource = VALID_SOURCES.includes(
        o.source as GlossarySource,
      )
        ? (o.source as GlossarySource)
        : "llm"; // legacy rows (pre-v2) had no source
      const out: GlossaryTerm = {
        term,
        definition,
        aliases,
        source,
        layer_tag: typeof o.layer_tag === "string" ? o.layer_tag : null,
        pinned: o.pinned === true,
        updated_at:
          typeof o.updated_at === "string"
            ? o.updated_at
            : new Date(0).toISOString(),
      };
      // Only set optional fields when actually present (keeps the type
      // clean under exactOptionalPropertyTypes).
      if (typeof o.annotation_phrase === "string")
        out.annotation_phrase = o.annotation_phrase;
      if (typeof o.weight === "number") out.weight = o.weight;
      return out;
    })
    .filter((t): t is GlossaryTerm => t !== null);
}

/** Extract authoritative glossary seeds from a raw annotations blob
 *  (improvement_goals.annotations). */
function seedsFromAnnotations(raw: unknown): AnnotationSeed[] {
  return normalizeAnnotations(raw)
    .filter((a) => a.phrase && a.reading)
    .map((a) => ({
      phrase: a.phrase,
      reading: a.reading,
      weight: typeof a.weight === "number" ? a.weight : undefined,
      layer_tag: a.layer_tag ?? null,
      // Phase 2 — pass through the normalizer-derived concept + slug so
      // the glossary merges/dedupes by stable identity (not text). When
      // the annotation is pre-Phase-2 (concept === null) the slug is
      // derived from the phrase, preserving the old text-match behavior.
      concept: a.concept,
      concept_slug: a.concept_slug,
    }));
}

async function loadSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
) {
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== userId) return null;
  return space;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const space = await loadSpace(db, spaceId, auth.user.id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Enrich each term with provenance (whose taste shaped it), the references
  // that ground it, and a cross-space usage count — so the reader SEES that
  // their definitions are theirs and reused, not re-entered. All additive +
  // soft-fail: legacy consumers still read { term, definition, ... }.
  const terms = readGlossary(space.synthesis_data);
  const enriched = await enrichGlossaryWithEvidence(db, spaceId, terms);
  // Cross-space reuse count — how many of the user's OTHER spaces define the
  // same concept as their taste, by concept_slug (NEW object layer). Replaces
  // the legacy entities-based stat (P3.1) so the count reflects the current
  // build, and reuses the same scan that powers inheritance seeding.
  let crossSpace: Awaited<
    ReturnType<typeof loadCrossSpaceGlossary>
  > | null = null;
  try {
    crossSpace = await loadCrossSpaceGlossary(
      db,
      auth.user.id,
      spaceId,
      enriched.map((t) => termSlug(t)),
    );
  } catch {
    /* cross-space pill is best-effort */
  }
  const glossary = enriched.map((t) => ({
    ...t,
    crossSpaceCount: crossSpace?.get(termSlug(t))?.spaceCount ?? 0,
  }));
  return NextResponse.json({ glossary });
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const space = await loadSpace(db, spaceId, auth.user.id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });

  // ── Objective text: prefer the root goal's description, fall back
  //    to the space text. ──
  let coreObjectiveText = "";
  const { data: rootGoal } = await db
    .from("improvement_goals")
    .select("title, description, annotations")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .maybeSingle();
  coreObjectiveText =
    (typeof rootGoal?.description === "string" && rootGoal.description.trim()) ||
    (typeof rootGoal?.title === "string" && rootGoal.title.trim()) ||
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // ── Sub-objective titles + annotations + entity names ──
  const { data: subs } = await db
    .from("improvement_goals")
    .select("title, annotations")
    .eq("space_id", spaceId)
    .not("parent_goal_id", "is", null);
  const subRows = (subs ?? []) as Array<{
    title?: unknown;
    annotations?: unknown;
  }>;
  const subObjectiveTitles = subRows
    .map((s) => (typeof s.title === "string" ? s.title : ""))
    .filter((s) => s.length > 0);

  // ── Authoritative seeds from the Annotation Lens (parent + subs) ──
  // These are the vetted, generation-steering readings — the glossary's
  // highest-authority definitions. Deduped by phrase in the generator.
  const annotationSeeds: AnnotationSeed[] = [
    ...seedsFromAnnotations(rootGoal?.annotations),
    ...subRows.flatMap((s) => seedsFromAnnotations(s.annotations)),
  ];

  // ── SOURCE OF TRUTH (LOCKED): the glossary derives ONLY from the objective
  //    lens (annotations, above) + the LIBRARY_OBJECTS CARDS (the new object
  //    layer — feature/variable/etc. from decompose-cards + converge/publish).
  //    The deprecated `entities`/rooms path is intentionally NO LONGER read.
  //    Cards are the cards we read from: title → term, summary → definition,
  //    object_type → layer_tag; the same vocabulary also feeds jargon-mining
  //    (entityNames) and the consistency anchor (entityDefinitions) that the
  //    rooms layer used to provide. ──
  const { data: objs } = await db
    .from("library_objects")
    .select("title, summary, object_type")
    .eq("space_id", spaceId);
  const cardRows = (
    (objs ?? []) as Array<{ title?: unknown; summary?: unknown; object_type?: unknown }>
  )
    .map((o) => ({
      title: typeof o.title === "string" ? o.title.trim() : "",
      summary: typeof o.summary === "string" ? o.summary.trim() : "",
      object_type: typeof o.object_type === "string" ? o.object_type : null,
    }))
    .filter((o) => o.title.length > 0);

  // Card titles → authoritative term seeds (summary = definition).
  const objectSeeds: AnnotationSeed[] = cardRows
    .filter((o) => o.summary.length > 0)
    .map((o) => ({
      phrase: o.title,
      reading: o.summary,
      layer_tag: o.object_type,
      weight: 3,
    }));
  // Card vocabulary = the jargon-mining hint + the consistency anchor (replaces
  // what entities/rooms supplied), so coincident terms stay true to the card.
  const entityNames = cardRows.map((o) => o.title);
  const entityDefinitions = cardRows
    .filter((o) => o.summary.length > 0)
    .map((o) => ({ name: o.title, definition: o.summary }));

  if (
    !coreObjectiveText &&
    entityNames.length === 0 &&
    annotationSeeds.length === 0 &&
    objectSeeds.length === 0
  ) {
    return NextResponse.json(
      { error: "Nothing to build a glossary from yet — add objects or an objective first." },
      { status: 409 },
    );
  }

  // generateGlossary seeds from the annotation readings, mines new
  // entity jargon, and ACCUMULATE-MERGES into the existing glossary
  // (authority + pinned rules inside). It returns the final list.
  const glossary = await generateGlossary({
    coreObjectiveText,
    subObjectiveTitles,
    entityNames,
    entityDefinitions,
    annotations: [...annotationSeeds, ...objectSeeds],
    existing: readGlossary(space.synthesis_data),
  });

  // ── Cross-space taste (P3.0, CROSS_SPACE_TASTE_SPEC.md): inherit the user's
  //    PINNED meaning for any term they've already authored in ANOTHER space
  //    (matched by concept_slug), upgrading weak terms here so they never
  //    re-define what they've defined elsewhere. Same-space pinned always wins;
  //    soft-fails to the un-seeded glossary. Persisted, so buildSpaceContext +
  //    the GET read the inherited meaning for free. ──
  const crossSpace = await loadCrossSpaceGlossary(
    db,
    space.user_id,
    spaceId,
    glossary.map((t) => termSlug(t)),
  );
  const seeded = applyCrossSpaceSeeds(glossary, crossSpace);

  // ── Persist into synthesis_data.glossary (merge, don't clobber). ──
  const nextSynthesis: Record<string, unknown> = {
    ...((space.synthesis_data as Record<string, unknown> | null) ?? {}),
    glossary: seeded,
  };
  const { error: updateErr } = await db
    .from("spaces")
    .update({ synthesis_data: nextSynthesis })
    .eq("id", spaceId);
  if (updateErr) {
    return NextResponse.json(
      { error: "persist failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ glossary: seeded });
}

// ── PATCH — edit / pin a single term ──────────────────────────────
// A user-edited definition becomes source:"user" + pinned:true, so
// future regenerations never overwrite it. Body: { term, definition?,
// pinned? }. Matches case-insensitively on the term.
interface PatchBody {
  term?: string;
  definition?: string;
  pinned?: boolean;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: body, error: parseError } = await safeJsonParse<PatchBody>(req);
  if (parseError) return parseError;
  const term = typeof body?.term === "string" ? body.term.trim() : "";
  if (!term) {
    return NextResponse.json({ error: "term required" }, { status: 400 });
  }

  const space = await loadSpace(db, spaceId, auth.user.id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });

  const glossary = readGlossary(space.synthesis_data);
  const idx = glossary.findIndex(
    (t) => t.term.toLowerCase() === term.toLowerCase(),
  );
  if (idx < 0) {
    return NextResponse.json(
      { error: `term "${term}" not in glossary` },
      { status: 404 },
    );
  }

  const now = new Date().toISOString();
  const next = { ...glossary[idx] };
  if (typeof body?.definition === "string" && body.definition.trim()) {
    next.definition = body.definition.trim().slice(0, 320);
    next.source = "user";
    next.pinned = true; // editing the text pins it by default
  }
  if (typeof body?.pinned === "boolean") {
    next.pinned = body.pinned;
    if (body.pinned) next.source = "user";
  }
  // A definition edit or explicit pin makes the term the user's OWN — shed any
  // cross-space inheritance so it stops reading as "inherited from <App>" and
  // travels as their authored taste (P3.0).
  const becameOwn =
    (typeof body?.definition === "string" && body.definition.trim().length > 0) ||
    body?.pinned === true;
  if (becameOwn) {
    delete next.cross_space_origin;
    delete next.cross_space_origin_title;
  }
  next.updated_at = now;
  glossary[idx] = next;

  const nextSynthesis: Record<string, unknown> = {
    ...((space.synthesis_data as Record<string, unknown> | null) ?? {}),
    glossary,
  };
  const { error: updateErr } = await db
    .from("spaces")
    .update({ synthesis_data: nextSynthesis })
    .eq("id", spaceId);
  if (updateErr) {
    return NextResponse.json(
      { error: "persist failed", detail: updateErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ term: next });
}
