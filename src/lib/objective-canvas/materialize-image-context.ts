// ── materialize-image-context ──────────────────────────────────────
//
// Closes the seam between image vision extraction and the context/taste
// layer. Per CONTEXT_FRONTIER_PLAN.md §3.3, image extractions are
// supposed to feed `getObjectiveContextScope` as `context_concept` rows
// — this module is the writer that was never built.
//
// Pipeline (called from /api/ingest/vision-extract after the UPDATE):
//   1. Ensure the per-space context anchor exists.
//   2. Attach the ingested_file to the anchor as a `reference` source
//      (a dropped image is reference material, not a "prior idea the
//      user wants to surpass").
//   3. For each ExtractedEntity, slugify the name → concept_slug,
//      upsert one `context_concept` library_object, linked
//      derived_from the anchor. Idempotent per slug — re-running the
//      extraction updates rather than duplicates.
//   4. Optional: a taste-prose Claude pass that reads the structured
//      extraction + objective + current glossary and writes back
//      ingested_files.image_narrative — the seam that lets the
//      brainstorm seed / prompt-sharpening / brief use the image
//      without re-running vision.
//   5. Persist the slug list on ingested_files.image_concepts so
//      consumers don't need to re-derive.
//
// Soft-fail throughout — if any sub-step throws, the route still
// returns 200 with the structured payload. We are decorating the
// substrate, not gating it.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureContextAnchor,
  addContextSource,
  recordContextConcept,
  type ContextConcept,
} from "./context-frontier";
import {
  upsertLibraryObject,
  linkObjects,
  mergeObjectContentSnapshot,
} from "./library-objects";
import { slugifyConcept } from "./normalize-annotations";
import type { StructuredImageExtraction } from "../ingest/extractors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

interface TasteQualityRaw {
  term?: unknown;
  evidence_phrase?: unknown;
}
interface TasteQuality {
  term: string;
  slug: string;
  evidence_phrase: string;
}

interface ExtractedEntityShape {
  name?: unknown;
  type?: unknown;
  description?: unknown;
  rolePosition?: unknown;
}

export interface MaterializeImageContextArgs {
  spaceId: string;
  userId: string;
  ingestedFileId: string;
  extraction: StructuredImageExtraction;
  /** Objective text — used to seed the taste-prose pass. Optional. */
  objectiveText?: string | null;
  /** When true, runs the second Claude pass that writes image_narrative.
   *  Default true; the caller can disable for cheap/silent re-runs. */
  runNarrativePass?: boolean;
}

export interface MaterializeImageContextResult {
  anchorId: string | null;
  conceptIds: string[];
  conceptSlugs: string[];
  narrativeWritten: boolean;
  imageObjectId: string | null;
  tasteSlugs: string[];
}

/**
 * The primary entry point. Idempotent — safe to re-run after re-extract.
 *
 * Returns the materialized identifiers so the route can include them in
 * its response if it wants (currently the route doesn't, but exposing
 * them keeps the seam testable).
 */
export async function materializeImageContext(
  db: AnyDb,
  args: MaterializeImageContextArgs,
): Promise<MaterializeImageContextResult> {
  const empty: MaterializeImageContextResult = {
    anchorId: null,
    conceptIds: [],
    conceptSlugs: [],
    narrativeWritten: false,
    imageObjectId: null,
    tasteSlugs: [],
  };

  // 1. Ensure the context anchor for this space. Idempotent.
  const anchorId = await ensureContextAnchor(db, {
    spaceId: args.spaceId,
    userId: args.userId,
  });
  if (!anchorId) return empty;

  // 2. Attach the image as a reference source on the anchor. Idempotent
  //    on UNIQUE(object_id, ingested_file_id).
  await addContextSource(db, {
    anchorId,
    userId: args.userId,
    ingestedFileId: args.ingestedFileId,
    role: "reference",
  });

  // 3. Slugify + materialize one context_concept per extracted entity.
  //    Names empty after slug collapse (pure punctuation / emoji) are
  //    dropped silently — they wouldn't dedupe sensibly anyway.
  const seen = new Set<string>();
  const conceptIds: string[] = [];
  const conceptSlugs: string[] = [];

  const entities = Array.isArray(args.extraction.entities)
    ? args.extraction.entities
    : [];
  for (const raw of entities as ExtractedEntityShape[]) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!name) continue;
    const slug = slugifyConcept(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const description =
      typeof raw?.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : "";

    // Source phrase = the entity's own description (the verbatim span
    // analog for an image — the model's narration of the visible thing).
    const concept: ContextConcept = {
      concept: name.slice(0, 80),
      concept_slug: slug,
      kind: "fact",
      role: "reference",
      summary: description.slice(0, 280),
      source_ingested_file_id: args.ingestedFileId,
      source_phrase: description.slice(0, 240),
    };

    const objectId = await recordContextConcept(db, {
      spaceId: args.spaceId,
      userId: args.userId,
      anchorId,
      concept,
    });
    if (objectId) {
      conceptIds.push(objectId);
      conceptSlugs.push(slug);
    }
  }

  // 4. Optional narrative + taste-tokens pass. Returns prose + 0-6
  //    aesthetic quality tokens the image embodies ("cute","minimal",…)
  //    which we persist as their OWN context_concept rows so the same
  //    slug across multiple images accumulates evidence.
  let narrative: string | null = null;
  let taste: TasteQuality[] = [];
  if (args.runNarrativePass !== false) {
    try {
      const result = await composeImageNarrative(db, {
        spaceId: args.spaceId,
        objectiveText: args.objectiveText ?? null,
        extraction: args.extraction,
      });
      narrative = result.narrative;
      taste = result.taste;
    } catch (err) {
      console.warn(
        "[materialize-image-context] narrative pass failed (soft):",
        err,
      );
    }
  }

  // 4a. Persist each taste-quality as a context_concept whose source_ref
  //     is unique per (slug, image). Two images both reading "cute" thus
  //     produce TWO rows with the same slug — enrichGlossaryWithEvidence
  //     groups by slug and surfaces both as evidence chips on the term.
  const tasteSlugs: string[] = [];
  for (const q of taste) {
    try {
      const objectId = await upsertLibraryObject(db, {
        spaceId: args.spaceId,
        userId: args.userId,
        objectType: "context_concept",
        title: q.term,
        summary: q.evidence_phrase.slice(0, 280),
        sourceRef: `ctx:taste:${q.slug}:img:${args.ingestedFileId}`,
        contentSnapshot: {
          concept_slug: q.slug,
          kind: "fact",
          role: "reference",
          source_phrase: q.evidence_phrase.slice(0, 240),
          source_ingested_file_id: args.ingestedFileId,
          taste_quality: true,
        },
      });
      if (objectId) {
        await linkObjects(db, {
          spaceId: args.spaceId,
          fromObjectId: objectId,
          toObjectId: anchorId,
          relation: "derived_from",
        });
        tasteSlugs.push(q.slug);
      }
    } catch (err) {
      console.warn(
        "[materialize-image-context] taste-quality persist failed (soft):",
        err,
      );
    }
  }

  // 4b. Persist narrative + the union of entity + taste slugs on the
  //     ingested_files row so downstream consumers see one slug list.
  const allSlugs = Array.from(new Set([...conceptSlugs, ...tasteSlugs]));
  const narrativeWritten = Boolean(narrative);
  try {
    const patch: Record<string, unknown> = { image_concepts: allSlugs };
    if (narrative) patch.image_narrative = narrative.slice(0, 1400);
    await db.from("ingested_files").update(patch).eq("id", args.ingestedFileId);
  } catch {
    /* soft-fail */
  }

  // 5. Upsert the image_source library_object — the addressable handle
  //    a board image card stamps onto its props.objectId so the drag
  //    connector + object_links work. Patches ingested_files.image_object_id.
  let imageObjectId: string | null = null;
  try {
    imageObjectId = await ensureImageSource(db, {
      spaceId: args.spaceId,
      userId: args.userId,
      ingestedFileId: args.ingestedFileId,
      narrative,
      description: args.extraction.description ?? null,
      conceptSlugs: allSlugs,
      // Carry the style lens through — the vision extractor now returns
      // this field (extractors.ts:StructuredImageExtraction).
      styleAnalysis: args.extraction.style_analysis ?? null,
    });
    if (imageObjectId) {
      await linkObjects(db, {
        spaceId: args.spaceId,
        fromObjectId: imageObjectId,
        toObjectId: anchorId,
        relation: "derived_from",
      });
      try {
        await db
          .from("ingested_files")
          .update({ image_object_id: imageObjectId })
          .eq("id", args.ingestedFileId);
      } catch {
        /* soft-fail */
      }
    }
  } catch (err) {
    console.warn(
      "[materialize-image-context] ensureImageSource failed (soft):",
      err,
    );
  }

  return {
    anchorId,
    conceptIds,
    conceptSlugs,
    narrativeWritten,
    imageObjectId,
    tasteSlugs,
  };
}

// ── ensureImageSource ───────────────────────────────────────────────
//
// First writer for the `image_source` LibraryObjectType. One row per
// ingested image (idempotent on source_ref='img:'||fileId).

export interface EnsureImageSourceArgs {
  spaceId: string;
  userId: string;
  ingestedFileId: string;
  narrative: string | null;
  description: string | null;
  conceptSlugs: string[];
  /** Visual grammar from the vision pass — palette / typography /
   *  composition / patterns / motion. Carried as opaque JSON; the
   *  taste-profile aggregator + drawer renderer parse it on read.
   *  null when this image hasn't been style-analyzed (legacy rows
   *  or future cheap re-runs). */
  styleAnalysis?: unknown | null;
}

export async function ensureImageSource(
  db: AnyDb,
  args: EnsureImageSourceArgs,
): Promise<string | null> {
  let imageUrl: string | null = null;
  let title = "Image";
  try {
    const { data } = await db
      .from("ingested_files")
      .select("image_url, source_name")
      .eq("id", args.ingestedFileId)
      .maybeSingle();
    const row = data as {
      image_url?: string | null;
      source_name?: string | null;
    } | null;
    if (row?.image_url) imageUrl = row.image_url;
    if (row?.source_name && row.source_name.trim()) {
      title = row.source_name.trim().slice(0, 80);
    }
  } catch {
    /* soft-fail */
  }

  const summary =
    (args.narrative && args.narrative.trim()) ||
    (args.description && args.description.trim()) ||
    "Image reference";

  // Base snapshot — fields we ALWAYS know how to refresh. style_analysis
  // is intentionally NOT in here: we don't want the lazy /images backfill
  // path (which has no style data) to wipe out a real extraction.
  const baseSnapshot: Record<string, unknown> = {
    image_url: imageUrl,
    narrative: args.narrative,
    description: args.description,
    concept_slugs: args.conceptSlugs,
    source_ingested_file_id: args.ingestedFileId,
  };

  const objectId = await upsertLibraryObject(db, {
    spaceId: args.spaceId,
    userId: args.userId,
    objectType: "image_source",
    title,
    summary: summary.slice(0, 280),
    sourceRef: `img:${args.ingestedFileId}`,
    contentSnapshot: baseSnapshot,
  });

  // Only patch style_analysis when the caller actually has one — keeps the
  // backfill path (description-only) from clobbering a prior real
  // extraction. mergeObjectContentSnapshot does a shallow read-merge-write
  // on content_snapshot.
  if (objectId && args.styleAnalysis !== undefined && args.styleAnalysis !== null) {
    await mergeObjectContentSnapshot(db, objectId, {
      style_analysis: args.styleAnalysis,
    });
  }

  return objectId;
}

// ── taste-prose pass ─────────────────────────────────────────────────
//
// Second LLM call. Cheap (Sonnet, ~200-400 tokens). Reads:
//   - structured extraction (description, entities, relationships)
//   - the objective text (so the narrative is for-this-objective, not generic)
//   - current glossary terms (so it leans on the user's vocabulary)
// Returns a 3-5 sentence narrative paragraph or null on soft-fail.

interface NarrativeArgs {
  spaceId: string;
  objectiveText: string | null;
  extraction: StructuredImageExtraction;
}

interface NarrativeResult {
  narrative: string | null;
  taste: TasteQuality[];
}

async function composeImageNarrative(
  db: AnyDb,
  args: NarrativeArgs,
): Promise<NarrativeResult> {
  const { tasteTerms, otherTerms } = await loadGlossaryTermsForTaste(
    db,
    args.spaceId,
  );

  const { extraction } = args;
  const entityList = extraction.entities
    .slice(0, 12)
    .map((e) => `- ${e.name}${e.description ? `: ${e.description}` : ""}`)
    .join("\n");
  const relationshipList = extraction.relationships
    .slice(0, 12)
    .map((r) => `- ${r.fromName} → ${r.toName} (${r.label})`)
    .join("\n");
  const tasteBlock = tasteTerms.length
    ? tasteTerms.map((t) => `- ${t}`).join("\n")
    : "(no taste words yet — propose 1-3 if the image clearly embodies any aesthetic)";
  const otherBlock = otherTerms.length
    ? otherTerms.map((t) => `- ${t}`).join("\n")
    : "(none)";

  const system = `You translate visual references into BOTH (a) rich prose that ties what's shown back to the user's objective, AND (b) a small set of TASTE QUALITIES the image embodies — the aesthetic / texture adjectives that would re-weight a taste glossary term like "cute" or "minimal".

You will receive:
  - The user's OBJECTIVE.
  - TASTE WORDS — quality-kind glossary terms the user already cares about. PREFER reusing these when the image embodies them.
  - OTHER GLOSSARY — the rest of the user's working vocabulary, for prose continuity.
  - A structured EXTRACTION from an image (description + entities + relationships).

Return strict JSON with two fields:

1) "narrative" — 3-5 sentences of clean prose that:
   - Names what the image is (don't restate the dry description).
   - Connects what it shows to the objective — be specific about which entities matter for which part of the objective.
   - WHERE NATURAL, uses the user's existing glossary vocabulary so the narrative reads as continuous with what the user already wrote. Don't shoehorn terms.
   - If the image surfaces a tension, contradiction, or implication for the objective, name it.
   - If the extraction is decorative / has no entities, return an empty string here.
   - Direct, declarative. No filler ("This image shows…", "We can see…"). No bullet lists, no headings, no markdown.

2) "taste_qualities" — 0 to 6 entries. Each is an aesthetic / texture / mood word the image EMBODIES (not what's depicted: "cute", "dense", "minimal", "warm", "playful", "spare" — NOT "card", "icon", "dashboard"). PREFER words from the TASTE WORDS list when they fit; propose new ones only when the image clearly embodies a quality not on the list. For each entry:
   - "term": single lowercased word or 2-word phrase. ≤20 chars.
   - "evidence_phrase": 6-15 words naming the visible cues that read as that quality ("rounded forms, soft pastel palette, friendly weight"). This phrase becomes the grounding line behind that taste word in the user's glossary.
   Return [] if the image is purely informational / has no aesthetic signal.

Return ONLY the JSON object. No prose outside it.`;

  const user = `OBJECTIVE:
${args.objectiveText?.trim() || "(no objective text supplied)"}

TASTE WORDS (quality kind):
${tasteBlock}

OTHER GLOSSARY:
${otherBlock}

IMAGE DESCRIPTION:
${extraction.description || "(none)"}

ENTITIES:
${entityList || "(none)"}

RELATIONSHIPS:
${relationshipList || "(none)"}

Return the JSON.`;

  const schema = {
    name: "image_narrative_and_taste",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        narrative: { type: "string" },
        taste_qualities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              term: { type: "string" },
              evidence_phrase: { type: "string" },
            },
            required: ["term", "evidence_phrase"],
          },
        },
      },
      required: ["narrative", "taste_qualities"],
    },
  };

  try {
    const { llmJSON } = await import("../llm");
    const raw = await llmJSON<{
      narrative?: unknown;
      taste_qualities?: TasteQualityRaw[];
    }>({
      system,
      user,
      responseSchema: schema,
      temperature: 0.5,
      maxTokens: 900,
    });
    const narrative =
      typeof raw?.narrative === "string" && raw.narrative.trim()
        ? raw.narrative.trim().slice(0, 1400)
        : null;
    const taste: TasteQuality[] = [];
    const seen = new Set<string>();
    for (const t of Array.isArray(raw?.taste_qualities) ? raw.taste_qualities : []) {
      const term =
        typeof t?.term === "string" ? t.term.trim().toLowerCase().slice(0, 20) : "";
      const evidence_phrase =
        typeof t?.evidence_phrase === "string"
          ? t.evidence_phrase.trim().slice(0, 200)
          : "";
      if (!term || !evidence_phrase) continue;
      const slug = slugifyConcept(term);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      taste.push({ term, slug, evidence_phrase });
      if (taste.length >= 6) break;
    }
    return { narrative, taste };
  } catch (err) {
    console.warn(
      "[materialize-image-context] composeImageNarrative LLM call failed:",
      err,
    );
    return { narrative: null, taste: [] };
  }
}

/** Pull glossary terms from spaces.synthesis_data.glossary, partitioned
 *  into TASTE words (kind==='quality') vs everything else. Soft-fail. */
async function loadGlossaryTermsForTaste(
  db: AnyDb,
  spaceId: string,
): Promise<{ tasteTerms: string[]; otherTerms: string[] }> {
  try {
    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synth = (data as { synthesis_data?: unknown } | null)?.synthesis_data;
    if (!synth || typeof synth !== "object") {
      return { tasteTerms: [], otherTerms: [] };
    }
    const glossary = (synth as Record<string, unknown>).glossary;
    if (!Array.isArray(glossary)) return { tasteTerms: [], otherTerms: [] };
    const tasteTerms: string[] = [];
    const otherTerms: string[] = [];
    for (const g of glossary.slice(0, 60)) {
      if (!g || typeof g !== "object") continue;
      const row = g as Record<string, unknown>;
      const term = typeof row.term === "string" ? row.term.trim() : "";
      if (!term) continue;
      const trimmed = term.slice(0, 60);
      if (row.kind === "quality") tasteTerms.push(trimmed);
      else otherTerms.push(trimmed);
      if (tasteTerms.length + otherTerms.length >= 40) break;
    }
    return { tasteTerms, otherTerms };
  } catch {
    return { tasteTerms: [], otherTerms: [] };
  }
}
