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
import { slugifyConcept } from "./normalize-annotations";
import type { StructuredImageExtraction } from "../ingest/extractors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

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

  // 4. Optional taste-prose pass — reads the structured extraction +
  //    objective + space glossary, writes back a narrative paragraph
  //    that bridges what the image shows and the user's taste.
  let narrativeWritten = false;
  if (args.runNarrativePass !== false) {
    try {
      const narrative = await composeImageNarrative(db, {
        spaceId: args.spaceId,
        objectiveText: args.objectiveText ?? null,
        extraction: args.extraction,
      });
      if (narrative) {
        await db
          .from("ingested_files")
          .update({
            image_narrative: narrative,
            image_concepts: conceptSlugs,
          })
          .eq("id", args.ingestedFileId);
        narrativeWritten = true;
      } else {
        // Even without a narrative, persist the slug list so
        // downstream consumers can join by concept_slug.
        await db
          .from("ingested_files")
          .update({ image_concepts: conceptSlugs })
          .eq("id", args.ingestedFileId);
      }
    } catch (err) {
      console.warn(
        "[materialize-image-context] narrative pass failed (soft):",
        err,
      );
      // Still persist concept slugs even if the prose pass fails.
      try {
        await db
          .from("ingested_files")
          .update({ image_concepts: conceptSlugs })
          .eq("id", args.ingestedFileId);
      } catch {
        /* soft-fail */
      }
    }
  } else {
    try {
      await db
        .from("ingested_files")
        .update({ image_concepts: conceptSlugs })
        .eq("id", args.ingestedFileId);
    } catch {
      /* soft-fail */
    }
  }

  return {
    anchorId,
    conceptIds,
    conceptSlugs,
    narrativeWritten,
  };
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

async function composeImageNarrative(
  db: AnyDb,
  args: NarrativeArgs,
): Promise<string | null> {
  // Pull the space's existing glossary terms (top ~30 by recency) to
  // anchor the narrative in the user's vocabulary.
  const glossaryTerms = await loadGlossaryTermsForTaste(db, args.spaceId);

  const { extraction } = args;
  const entityList = extraction.entities
    .slice(0, 12)
    .map((e) => `- ${e.name}${e.description ? `: ${e.description}` : ""}`)
    .join("\n");
  const relationshipList = extraction.relationships
    .slice(0, 12)
    .map((r) => `- ${r.fromName} → ${r.toName} (${r.label})`)
    .join("\n");
  const glossaryBlock = glossaryTerms.length
    ? glossaryTerms.map((t) => `- ${t}`).join("\n")
    : "(no glossary terms yet)";

  const system = `You write rich, taste-aware narratives that translate visual artifacts into prose anchored in a user's working vocabulary.

You will receive:
  - The user's OBJECTIVE (what they're working on).
  - GLOSSARY TERMS — the user's earned vocabulary for this objective.
  - A structured EXTRACTION from an image (description + entities + relationships).

Write 3-5 sentences of clean prose that:
  1. Names what the image is (don't restate the dry description).
  2. Connects what it shows to the objective — be specific about which entities matter for which part of the objective.
  3. WHERE NATURAL, uses the user's existing glossary vocabulary so the narrative reads as continuous with what the user already wrote. Don't shoehorn terms; only use them when they fit.
  4. If the image surfaces a tension, contradiction, or implication for the objective, name it.

Style:
  - Direct, declarative. No filler ("This image shows…", "We can see…").
  - No bullet lists. No headings.
  - Don't invent details not present in the extraction.
  - If the extraction is decorative / has no entities, return an empty string.

Return ONLY the prose. No JSON, no markdown fences, no preamble.`;

  const user = `OBJECTIVE:
${args.objectiveText?.trim() || "(no objective text supplied)"}

GLOSSARY TERMS:
${glossaryBlock}

IMAGE DESCRIPTION:
${extraction.description || "(none)"}

ENTITIES:
${entityList || "(none)"}

RELATIONSHIPS:
${relationshipList || "(none)"}

Write the narrative.`;

  try {
    const { llmGenerate, MODEL_DEFAULTS } = await import("../llm");
    const text = await llmGenerate({
      system,
      user,
      provider: "anthropic",
      model: MODEL_DEFAULTS.anthropic.fast,
      maxTokens: 600,
      temperature: 0.5,
    });
    const trimmed = text.trim();
    if (!trimmed) return null;
    // Soft cap so a runaway response doesn't bloat the row.
    return trimmed.slice(0, 1400);
  } catch (err) {
    console.warn(
      "[materialize-image-context] composeImageNarrative LLM call failed:",
      err,
    );
    return null;
  }
}

/** Pull glossary term labels from spaces.synthesis_data.glossary. Soft-fail. */
async function loadGlossaryTermsForTaste(
  db: AnyDb,
  spaceId: string,
): Promise<string[]> {
  try {
    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synth = (data as { synthesis_data?: unknown } | null)?.synthesis_data;
    if (!synth || typeof synth !== "object") return [];
    const glossary = (synth as Record<string, unknown>).glossary;
    if (!Array.isArray(glossary)) return [];
    const terms: string[] = [];
    for (const g of glossary.slice(0, 30)) {
      if (g && typeof g === "object") {
        const term = (g as Record<string, unknown>).term;
        if (typeof term === "string" && term.trim()) {
          terms.push(term.trim().slice(0, 60));
        }
      }
    }
    return terms;
  } catch {
    return [];
  }
}
