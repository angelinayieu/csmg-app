// ── /api/objective/[spaceId]/taste-profile ──────────────────────────
//
// The first-class taste profile for an objective. One library_objects
// row per space (object_type='taste_profile'), content_snapshot
// carrying the structured profile. See lib/taste-profile.ts.
//
//   GET    → persisted snapshot (or null with thin_signal flag)
//   POST   → regenerate from substrate (preserves pinned sections)
//   PATCH  → edit a single section + auto-pin OR toggle pinned flag
//
// All routes are owner-scoped + soft-fail.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  getTasteProfile,
  saveTasteProfile,
  normalizeSnapshot,
  synthesizeTasteSections,
  bucketVocabulary,
  readSources,
  aggregateStyleSynthesisForSpace,
  EMPTY_STYLE_SYNTHESIS,
  type TasteProfileSnapshot,
  type TasteSection,
  type TasteVoice,
} from "@/lib/objective-canvas/taste-profile";
import { ensureImageSource } from "@/lib/objective-canvas/materialize-image-context";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ spaceId: string }>;
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

async function hydrateSourceObjects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  snapshot: TasteProfileSnapshot,
): Promise<TasteProfileSnapshot> {
  const ids = snapshot.sources
    .map((s) => s.ingestedFileId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return snapshot;

  try {
    const [{ data: imageRows }, { data: imageObjects }] = await Promise.all([
      db
        .from("ingested_files")
        .select(
          "id, source_type, source_url, image_object_id, image_description, image_narrative, image_concepts",
        )
        .eq("space_id", spaceId)
        .in("id", ids),
      db
        .from("library_objects")
        .select("id, source_ref, content_snapshot")
        .eq("space_id", spaceId)
        .eq("object_type", "image_source")
        .in(
          "source_ref",
          ids.map((id) => `img:${id}`),
        ),
    ]);

    const rowsById = new Map<
      string,
      {
        image_object_id?: string | null;
        source_type?: string | null;
        source_url?: string | null;
        image_description?: string | null;
        image_narrative?: string | null;
        image_concepts?: unknown;
      }
    >();
    for (const row of (imageRows ?? []) as Array<{
      id: string;
      image_object_id?: string | null;
      source_type?: string | null;
      source_url?: string | null;
      image_description?: string | null;
      image_narrative?: string | null;
      image_concepts?: unknown;
    }>) {
      rowsById.set(row.id, row);
    }

    const objectsByIngestedId = new Map<
      string,
      { id: string; content_snapshot?: unknown }
    >();
    for (const obj of (imageObjects ?? []) as Array<{
      id: string;
      source_ref: string | null;
      content_snapshot?: unknown;
    }>) {
      const ingestedId =
        typeof obj.source_ref === "string" && obj.source_ref.startsWith("img:")
          ? obj.source_ref.slice(4)
          : "";
      if (ingestedId) objectsByIngestedId.set(ingestedId, obj);
    }

    const createdObjectIds = new Map<string, string>();
    for (const source of snapshot.sources) {
      if (source.objectId || objectsByIngestedId.has(source.ingestedFileId)) {
        continue;
      }
      const row = rowsById.get(source.ingestedFileId);
      if (row?.image_object_id) continue;
      try {
        const conceptSlugs = Array.isArray(row?.image_concepts)
          ? row.image_concepts.filter(
              (v): v is string => typeof v === "string" && v.trim().length > 0,
            )
          : source.conceptSlugs;
        const objectId = await ensureImageSource(db, {
          spaceId,
          userId,
          ingestedFileId: source.ingestedFileId,
          narrative: row?.image_narrative ?? null,
          description: row?.image_description ?? null,
          conceptSlugs,
        });
        if (objectId) {
          createdObjectIds.set(source.ingestedFileId, objectId);
          await db
            .from("ingested_files")
            .update({ image_object_id: objectId })
            .eq("id", source.ingestedFileId);
        }
      } catch {
        /* soft — tile will stay read-only until the normal image backfill runs */
      }
    }

    return {
      ...snapshot,
      sources: snapshot.sources.map((source) => {
        const row = rowsById.get(source.ingestedFileId);
        const obj = objectsByIngestedId.get(source.ingestedFileId);
        const createdObjectId = createdObjectIds.get(source.ingestedFileId) ?? null;
        const snap =
          obj?.content_snapshot && typeof obj.content_snapshot === "object"
            ? (obj.content_snapshot as Record<string, unknown>)
            : null;
        const styleAnalysis =
          snap?.style_analysis && typeof snap.style_analysis === "object"
            ? (snap.style_analysis as {
                palette?: { dominant?: unknown; accent?: unknown };
                patterns?: unknown;
              })
            : null;
        const dominant = Array.isArray(styleAnalysis?.palette?.dominant)
          ? styleAnalysis.palette.dominant
          : [];
        const accent = Array.isArray(styleAnalysis?.palette?.accent)
          ? styleAnalysis.palette.accent
          : [];
        const palette = [...dominant, ...accent]
          .filter((v): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v))
          .slice(0, 4);
        const patterns = Array.isArray(styleAnalysis?.patterns)
          ? styleAnalysis.patterns
              .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
              .slice(0, 4)
          : [];

        return {
          ...source,
          objectId: source.objectId ?? row?.image_object_id ?? obj?.id ?? createdObjectId,
          sourceType: source.sourceType ?? row?.source_type ?? null,
          sourceUrl: source.sourceUrl ?? row?.source_url ?? null,
          palette: source.palette.length ? source.palette : palette,
          patterns: source.patterns.length ? source.patterns : patterns,
        };
      }),
    };
  } catch {
    return snapshot;
  }
}

// ── GET ─────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { spaceId } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const space = await loadSpace(db, spaceId, auth.user.id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });

  const found = await getTasteProfile(db, spaceId);
  if (!found) {
    return NextResponse.json({ snapshot: null });
  }
  const snapshot = await hydrateSourceObjects(db, spaceId, auth.user.id, found.snapshot);
  return NextResponse.json({ snapshot, objectId: found.row.id });
}

// ── POST (regenerate) ───────────────────────────────────────────────

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { spaceId } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const space = await loadSpace(db, spaceId, auth.user.id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });

  // ── Substrate reads ──
  // 1. Objective text (root goal description → title fallback)
  let objectiveText = "";
  const { data: rootGoal } = await db
    .from("improvement_goals")
    .select("title, description")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .maybeSingle();
  objectiveText =
    (typeof rootGoal?.description === "string" && rootGoal.description.trim()) ||
    (typeof rootGoal?.title === "string" && rootGoal.title.trim()) ||
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // 2. Glossary (synthesis_data)
  const synth =
    (space.synthesis_data as Record<string, unknown> | null) ?? {};
  const glossary = Array.isArray(synth.glossary)
    ? (synth.glossary as Array<Record<string, unknown>>).map((t) => ({
        term: typeof t.term === "string" ? t.term : "",
        source: typeof t.source === "string" ? t.source : undefined,
        pinned: t.pinned === true,
        concept_slug:
          typeof t.concept_slug === "string" ? t.concept_slug : undefined,
        // Pass kind through so bucketVocabulary can preserve it on each
        // entry. Validation happens inside via asGlossaryKind.
        kind: t.kind,
      }))
    : [];

  // 3. Analyzed images (the sources)
  const { data: imageRows } = await db
    .from("ingested_files")
    .select(
      "id, source_name, source_type, source_url, image_url, image_concepts, image_narrative, image_object_id",
    )
    .eq("space_id", spaceId)
    .like("mime_type", "image/%")
    .not("vision_completed_at", "is", null)
    .order("vision_completed_at", { ascending: false });
  const images = (imageRows ?? []) as Array<{
    id: string;
    source_name: string | null;
    source_type: string | null;
    source_url: string | null;
    image_url: string | null;
    image_concepts: unknown;
    image_narrative: string | null;
    image_object_id: string | null;
    style_analysis?: unknown;
  }>;

  // Pull the backing image_source rows so the profile's source tiles can
  // open the object drawer and show per-image visual cues. This is keyed by
  // source_ref rather than relying only on ingested_files.image_object_id so
  // older rows still hydrate correctly after lazy backfills.
  if (images.length > 0) {
    try {
      const sourceRefs = images.map((img) => `img:${img.id}`);
      const { data: imageObjects } = await db
        .from("library_objects")
        .select("id, source_ref, content_snapshot")
        .eq("space_id", spaceId)
        .eq("object_type", "image_source")
        .in("source_ref", sourceRefs);
      const byIngestedId = new Map<
        string,
        { id: string; content_snapshot?: unknown }
      >();
      for (const obj of (imageObjects ?? []) as Array<{
        id: string;
        source_ref: string | null;
        content_snapshot?: unknown;
      }>) {
        const ingestedId =
          typeof obj.source_ref === "string" && obj.source_ref.startsWith("img:")
            ? obj.source_ref.slice(4)
            : "";
        if (ingestedId) byIngestedId.set(ingestedId, obj);
      }
      for (const img of images) {
        const obj = byIngestedId.get(img.id);
        if (!obj) continue;
        img.image_object_id = img.image_object_id ?? obj.id;
        const snap =
          obj.content_snapshot && typeof obj.content_snapshot === "object"
            ? (obj.content_snapshot as Record<string, unknown>)
            : null;
        img.style_analysis = snap?.style_analysis;
      }
    } catch {
      /* soft — sources still render without tile-level style cues */
    }
  }

  // 4. User notes (intentions + taste) on the context anchor
  let intentionNotes: string[] = [];
  let tasteNotes: string[] = [];
  try {
    const { data: anchor } = await db
      .from("library_objects")
      .select("id")
      .eq("space_id", spaceId)
      .eq("object_type", "context_anchor")
      .maybeSingle();
    if (anchor?.id) {
      const { data: notes } = await db
        .from("library_object_notes")
        .select("kind, text")
        .eq("object_id", anchor.id);
      for (const n of (notes ?? []) as Array<{ kind: string; text: string }>) {
        if (typeof n.text !== "string") continue;
        if (n.kind === "intention") intentionNotes.push(n.text);
        else if (n.kind === "taste") tasteNotes.push(n.text);
      }
    }
  } catch {
    /* soft */
  }

  // ── Deterministic readouts ──
  // groundedSlugs: any glossary slug that's referenced by an image's
  // image_concepts list. That's the "grounded by your sources" bucket.
  const groundedSlugs = new Set<string>();
  for (const img of images) {
    if (Array.isArray(img.image_concepts)) {
      for (const s of img.image_concepts as unknown[]) {
        if (typeof s === "string") groundedSlugs.add(s);
      }
    }
  }
  const vocabulary = bucketVocabulary(glossary, groundedSlugs);
  const sources = readSources(images);

  // ── Pinned-section preservation ──
  // Reload the existing snapshot so the user's pinned voice / tensions /
  // no_gos survive regeneration. The deterministic sections
  // (vocabulary, sources) always refresh.
  const existing = await getTasteProfile(db, spaceId);
  const prevSnap = existing?.snapshot ?? null;
  const prevPinned = prevSnap?.pinned ?? {};

  // ── Synthesis (LLM) ──
  // Skip the LLM entirely if voice/tensions/no_gos are all pinned —
  // saves a Sonnet call when the user has finalized their taste.
  const needSynthesis =
    !prevPinned.voice || !prevPinned.tensions || !prevPinned.no_gos;
  const synthesized = needSynthesis
    ? await synthesizeTasteSections({
        objectiveText,
        glossary,
        imageNarratives: images
          .map((i) => i.image_narrative ?? "")
          .filter((s) => s.length > 0),
        intentionNotes,
        tasteNotes,
      })
    : {
        voice: prevSnap?.voice ?? { tone: "", style: "" },
        tensions: prevSnap?.tensions ?? [],
        no_gos: prevSnap?.no_gos ?? [],
      };

  // Pinned sections always win.
  const voice: TasteVoice =
    prevPinned.voice && prevSnap ? prevSnap.voice : synthesized.voice;
  const tensions =
    prevPinned.tensions && prevSnap ? prevSnap.tensions : synthesized.tensions;
  const no_gos =
    prevPinned.no_gos && prevSnap ? prevSnap.no_gos : synthesized.no_gos;

  // Thin signal = nothing to anchor on. Surfaced in the UI.
  const thin_signal =
    !objectiveText &&
    glossary.length === 0 &&
    sources.length === 0 &&
    intentionNotes.length === 0 &&
    tasteNotes.length === 0;

  // Visual-style aggregation across the space's image_source rows. Pure
  // rollup — no LLM cost. If the user pinned this section, preserve the
  // previous value instead of re-aggregating.
  const style_synthesis =
    prevPinned.style_synthesis && prevSnap
      ? prevSnap.style_synthesis ?? EMPTY_STYLE_SYNTHESIS
      : await aggregateStyleSynthesisForSpace(db, spaceId);

  const snapshot: TasteProfileSnapshot = {
    voice,
    vocabulary,
    tensions,
    sources,
    no_gos,
    style_synthesis,
    pinned: prevPinned,
    generated_at: new Date().toISOString(),
    thin_signal,
  };

  const objectId = await saveTasteProfile(db, {
    spaceId,
    userId: auth.user.id,
    snapshot,
  });

  return NextResponse.json({ snapshot, objectId });
}

// ── PATCH (edit a section / toggle pin) ─────────────────────────────

interface PatchBody {
  section?: TasteSection;
  /** Toggle pinned for the section. */
  pinned?: boolean;
  /** Replace the section content. For voice: { tone, style }. For
   *  tensions/no_gos: string[]. For vocabulary/sources: not editable
   *  via PATCH (deterministic). */
  value?: unknown;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { spaceId } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const space = await loadSpace(db, spaceId, auth.user.id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: body, error: parseErr } = await safeJsonParse<PatchBody>(req);
  if (parseErr) return parseErr;
  const section = body?.section;
  if (!section) {
    return NextResponse.json({ error: "section required" }, { status: 400 });
  }

  const found = await getTasteProfile(db, spaceId);
  const current = found?.snapshot ?? normalizeSnapshot(null);
  const next: TasteProfileSnapshot = {
    ...current,
    pinned: { ...current.pinned },
  };

  // Apply value change first (so the saved row reflects the user's edit).
  if (body?.value !== undefined) {
    if (section === "voice" && body.value && typeof body.value === "object") {
      const v = body.value as Record<string, unknown>;
      next.voice = {
        tone: typeof v.tone === "string" ? v.tone.slice(0, 80) : next.voice.tone,
        style:
          typeof v.style === "string"
            ? v.style.slice(0, 280)
            : next.voice.style,
      };
    } else if (section === "tensions" && Array.isArray(body.value)) {
      next.tensions = (body.value as unknown[])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.slice(0, 80))
        .slice(0, 8);
    } else if (section === "no_gos" && Array.isArray(body.value)) {
      next.no_gos = (body.value as unknown[])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.slice(0, 120))
        .slice(0, 8);
    } else {
      return NextResponse.json(
        { error: `section "${section}" is not editable via PATCH` },
        { status: 400 },
      );
    }
    // Editing a section pins it by default — same discipline as the
    // glossary PATCH path. The user can explicitly unpin if they want
    // the next regenerate to overwrite.
    next.pinned[section] = true;
  }

  if (typeof body?.pinned === "boolean") {
    next.pinned[section] = body.pinned;
  }

  next.generated_at = new Date().toISOString();

  const objectId = await saveTasteProfile(db, {
    spaceId,
    userId: auth.user.id,
    snapshot: next,
  });

  return NextResponse.json({ snapshot: next, objectId });
}
