// ── Asset pre-extractor ──────────────────────────────────────────────
//
// Walks each ingested file attached to a space and pre-populates the
// KG with a small set of entities derived directly from the asset's
// content. Runs INSIDE the situation analyzer so the conceptual KG
// produced by decompose downstream sees them as already-existing
// structure (decompose joins on space_id; pre-extracted rows show up
// in its `existing_entities` context).
//
// Why a separate stage: decompose's prompt is tuned for prose-style
// inputs. Asset content (PDF abstracts, spec-sheet bullets, dataset
// column headers) has different shape and needs a tighter,
// extraction-only prompt that doesn't try to invent causal links —
// just lists named entities the user is likely already thinking about.
//
// Per-asset budget: ~600 tokens, ~3-5s. Three assets = ~12-15s
// before frame-extractor fires. We run sequentially because the
// situation analyzer's own LLM call already started; spawning N
// parallel calls would multiply cost and rate-limit risk.
//
// Soft-fails throughout: if extraction fails for an asset, the
// situation analyzer still completes and frame-extractor proceeds.
// The asset just contributes to intake_text only (legacy behavior)
// instead of also feeding entities. preextracted_entity_ids stays
// empty for that asset.

import { llmJSON } from "@/lib/llm";
import type { AssetClass } from "@/types/asset";
import { randomUUID } from "crypto";
import {
  CATEGORY_TO_ENTITY_CATEGORY,
  EXTRACTION_CATEGORIES,
  FOCUS_LEVEL_TARGETS,
  type ExtractionCandidate,
  type ExtractionCategory,
  type ExtractionPreview,
  type FocusLevel,
} from "@/types/extraction-preview";

export interface PreExtractedEntity {
  name: string;
  description: string | null;
  /** entity_category column expects one of: "concrete" | "abstract" |
   *  "process" | "outcome" | "constraint" | null. The extractor only
   *  emits these five values. */
  entity_category:
    | "concrete"
    | "abstract"
    | "process"
    | "outcome"
    | "constraint"
    | null;
  /** 0..1 self-rated confidence the LLM assigns to this entity being
   *  meaningfully present in the asset (vs incidental mention). */
  confidence: number;
}

export interface PreExtractAssetOpts {
  assetId: string;
  sourceName: string;
  assetClass: AssetClass;
  contentSnippet: string;
  /** When provided, included in the prompt to anchor the LLM in the
   *  user's overall task (so it doesn't extract every named noun in
   *  a research paper, just ones relevant to the user's situation). */
  intakeText?: string;
}

const SYSTEM_PROMPT = `You are an entity extractor. Read the asset content + user's
intake context and extract 3-8 named entities the user is most likely
to want represented in their knowledge graph.

Discipline:
1. Extract NOUNS the asset names directly — components, actors,
   constraints, outcomes, processes. Skip adjectives, verbs, and
   abstract concepts unless they're load-bearing.
2. Each entity must be GROUNDED in the asset content. If you can't
   point to the sentence in the asset where it appears, don't extract.
3. Categorize each:
   - concrete: physical or specific things (a person, a tool, a file)
   - abstract: conceptual entities (a strategy, a principle)
   - process: an action or workflow step
   - outcome: a measurable result or target
   - constraint: a hard limit or boundary condition
4. Confidence: 0.7+ for entities the asset explicitly defines /
   measures / specifies; 0.4-0.6 for entities the asset references
   without depth; below 0.4 → skip entirely.
5. Description: ONE short sentence per entity, drawn from the asset.

Output strict JSON in this shape:
{
  "entities": [
    { "name": "...", "description": "...", "entity_category": "...", "confidence": 0.0..1.0 }
  ]
}`;

const RESPONSE_SCHEMA = {
  name: "asset_preextracted_entities",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            description: { type: ["string", "null"] },
            entity_category: {
              type: ["string", "null"],
              enum: [
                "concrete",
                "abstract",
                "process",
                "outcome",
                "constraint",
                null,
              ],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["name", "description", "entity_category", "confidence"],
        },
      },
    },
    required: ["entities"],
  },
} as const;

function buildPrompt(opts: PreExtractAssetOpts): string {
  const lines: string[] = [];
  if (opts.intakeText) {
    lines.push("USER INTAKE CONTEXT (so you anchor extraction in the user's actual task):");
    lines.push(opts.intakeText.slice(0, 600));
    lines.push("");
  }
  lines.push(`ASSET TYPE: ${opts.assetClass}`);
  lines.push(`ASSET NAME: ${opts.sourceName}`);
  lines.push("");
  lines.push("ASSET CONTENT:");
  // Cap at 1800 chars so multiple assets fit within a reasonable
  // call budget. Full normalized_text remains in DB if a future pass
  // wants to re-extract.
  const trimmed =
    opts.contentSnippet.length > 1800
      ? opts.contentSnippet.slice(0, 1800) + "\n[truncated]"
      : opts.contentSnippet;
  lines.push(trimmed);
  lines.push("");
  lines.push("Extract entities per the system instructions.");
  return lines.join("\n");
}

/**
 * Run the LLM extractor against one asset. Returns 0–8 entities;
 * [] on any error. Caller is responsible for persisting the rows.
 */
export async function extractEntitiesFromAsset(
  opts: PreExtractAssetOpts,
): Promise<PreExtractedEntity[]> {
  if (!opts.contentSnippet || opts.contentSnippet.length < 80) {
    // Too short to extract anything meaningful (e.g., a 2-line URL
    // article that failed to fetch). Return empty silently.
    return [];
  }
  try {
    const raw = await llmJSON<unknown>({
      system: SYSTEM_PROMPT,
      user: buildPrompt(opts),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      maxTokens: 1000,
    });
    return validateExtraction(raw);
  } catch (err) {
    console.warn(
      `[asset-preextractor] LLM extraction failed for ${opts.sourceName}:`,
      err,
    );
    return [];
  }
}

function validateExtraction(raw: unknown): PreExtractedEntity[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.entities)) return [];
  return (r.entities as Array<Record<string, unknown>>)
    .map((e): PreExtractedEntity => {
      const name = String(e.name ?? "").trim();
      const desc = e.description == null ? null : String(e.description).trim();
      const cat = e.entity_category;
      const validCat: PreExtractedEntity["entity_category"] =
        cat === "concrete" ||
        cat === "abstract" ||
        cat === "process" ||
        cat === "outcome" ||
        cat === "constraint"
          ? cat
          : null;
      const conf =
        typeof e.confidence === "number" && Number.isFinite(e.confidence)
          ? Math.max(0, Math.min(1, e.confidence))
          : 0.5;
      return {
        name,
        description: desc,
        entity_category: validCat,
        confidence: conf,
      };
    })
    .filter((e) => e.name && e.confidence >= 0.4);
}

/**
 * Persist a batch of pre-extracted entities for one asset.
 * - Inserts rows into `entities` with source_tag = "asset:<assetId>"
 *   so downstream consumers can trace where they came from.
 * - Updates `ingested_files.preextracted_entity_ids` with the new
 *   row ids so the asset's contribution is queryable later.
 * - Idempotent at the row level: if the same name already exists in
 *   this space + asset combo, skip silently (deduped client-side).
 *
 * Returns the array of inserted entity ids.
 */
export async function persistPreExtractedEntities(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  opts: {
    spaceId: string;
    userId: string;
    assetId: string;
    extracted: PreExtractedEntity[];
  },
): Promise<string[]> {
  if (opts.extracted.length === 0) return [];

  // Dedupe against existing entities tagged for this asset (idempotent
  // re-runs of the analyzer don't multiply rows).
  const sourceTag = `asset:${opts.assetId}`;
  const { data: existing } = await db
    .from("entities")
    .select("id, name")
    .eq("space_id", opts.spaceId)
    .eq("source_tag", sourceTag);
  const existingNames = new Set(
    ((existing ?? []) as Array<{ name: string }>).map((e) =>
      e.name.toLowerCase().trim(),
    ),
  );

  const toInsert = opts.extracted.filter(
    (e) => !existingNames.has(e.name.toLowerCase().trim()),
  );

  if (toInsert.length === 0) {
    // All extracted entities were already persisted in a prior run.
    // Return their ids so the caller can still update
    // preextracted_entity_ids with a fresh write.
    const existingIds = ((existing ?? []) as Array<{ id: string }>).map(
      (e) => e.id,
    );
    return existingIds;
  }

  // Insert and pull back the ids.
  const rows = toInsert.map((e) => ({
    space_id: opts.spaceId,
    user_id: opts.userId,
    name: e.name.slice(0, 200),
    description: e.description?.slice(0, 1000) ?? null,
    entity_category: e.entity_category,
    confidence: e.confidence,
    source_tag: sourceTag,
  }));
  const { data: inserted, error } = await db
    .from("entities")
    .insert(rows)
    .select("id");
  if (error) {
    console.warn(
      `[asset-preextractor] insert failed for asset ${opts.assetId}:`,
      error,
    );
    return [];
  }

  const newIds = ((inserted ?? []) as Array<{ id: string }>).map((e) => e.id);
  const allIds = [
    ...((existing ?? []) as Array<{ id: string }>).map((e) => e.id),
    ...newIds,
  ];

  // Update the asset row so its preextracted_entity_ids stays in sync.
  try {
    await db
      .from("ingested_files")
      .update({ preextracted_entity_ids: allIds })
      .eq("id", opts.assetId);
  } catch (err) {
    console.warn(
      `[asset-preextractor] preextracted_entity_ids update failed for ${opts.assetId}:`,
      err,
    );
  }

  return newIds;
}

// ─────────────────────────────────────────────────────────────────────
// HITL extraction-checklist flow (docs/KG_DEPTH_CRITIQUE.md input-side)
// ─────────────────────────────────────────────────────────────────────
//
// Two-phase variant of the auto-extract flow above. Insert a user
// review step between "ingest succeeded" and "entities live in the KG":
//
//   Phase 1: previewCandidatesFromAsset()
//     Calls the LLM with a RICHER prompt — 15-30 candidates with
//     ExtractionCategory tags + evidence quotes + suggested flags.
//     Returns ExtractionPreview WITHOUT writing to the entities table.
//     The caller persists the preview JSONB to
//     ingested_files.extraction_preview so the drawer can be reopened
//     without re-paying the LLM cost.
//
//   Phase 2: commitSelectedCandidates()
//     Takes the preview JSONB + the user's selected_candidate_ids[],
//     filters to the chosen subset, and reuses
//     persistPreExtractedEntities() to write to entities.
//
// Honest defaults: when the user just hits "Extract" without filtering,
// the suggested=true subset is auto-selected (matches the
// auto-extract behavior the system had before the HITL flow).

const PREVIEW_SYSTEM_PROMPT = `You are an entity extractor producing a candidate
list for HUMAN REVIEW. Read the asset content + user's intake context
and propose 15-30 candidate entities the user MIGHT want represented in
their knowledge graph. The user will then check off the ones they
actually want and discard the rest.

Discipline:
1. Be GENEROUS but GROUNDED. Propose more than auto-extract would —
   the user is the filter, not you. But every candidate must be
   anchored in a sentence you can quote from the asset. No
   fabrication.
2. Categorize each candidate using this rich taxonomy:
   - concept       — theory, framework, principle, abstract idea
   - effect_size   — quantitative finding with magnitude
                     (e.g. "intervention raised retention 12pp")
   - method        — methodology, technique, approach, protocol
   - finding       — qualitative observation/claim without specific magnitude
   - actor         — person, organization, role, team
   - metric        — measurable variable / KPI (the THING measured)
   - mechanism     — causal explanation ("X causes Y because Z mediates")
   - condition     — boundary condition, qualifier, when applies
   - outcome       — goal, target, desired result
   - tool          — concrete artifact, instrument, dataset reference
3. Confidence: 0.7+ for entities the asset explicitly defines /
   measures / specifies; 0.4-0.6 for entities the asset references
   without depth; below 0.4 → skip entirely.
4. evidence_quote: a verbatim short quote (≤200 chars) from the
   asset content that grounds the candidate. If you can't point to
   one, set evidence_quote: null and lower confidence.
5. suggested: TRUE for candidates that meet ALL of:
   - confidence ≥ 0.7
   - clearly relevant to the user's intake_text (when provided)
   - load-bearing (the asset would lose meaning without this entity)
   FALSE otherwise. Aim for ~30-50% of candidates marked suggested
   so "Select suggested" is a meaningful default.
6. description: ONE short sentence per candidate, in your own words,
   summarizing what the entity IS as evidenced by the asset. Distinct
   from evidence_quote (which is verbatim).

Output strict JSON:
{
  "summary": "string — 1-2 sentences describing what this asset is and why it matters to the user's task. ≤500 chars. Surfaced at top of review drawer.",
  "candidates": [
    {
      "name": "string",
      "description": "string",
      "category": "concept|effect_size|method|finding|actor|metric|mechanism|condition|outcome|tool",
      "confidence": 0.0..1.0,
      "evidence_quote": "string or null",
      "suggested": true|false
    }
  ]
}`;

const PREVIEW_RESPONSE_SCHEMA = {
  name: "asset_extraction_preview",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: ["string", "null"] },
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            description: { type: ["string", "null"] },
            category: {
              type: "string",
              enum: [...EXTRACTION_CATEGORIES],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidence_quote: { type: ["string", "null"] },
            suggested: { type: "boolean" },
          },
          required: [
            "name",
            "description",
            "category",
            "confidence",
            "evidence_quote",
            "suggested",
          ],
        },
      },
    },
    required: ["summary", "candidates"],
  },
} as const;

function buildPreviewPrompt(opts: PreExtractAssetOpts): string {
  const lines: string[] = [];
  if (opts.intakeText) {
    lines.push(
      "USER INTAKE CONTEXT (so you anchor extraction in the user's task — and so 'suggested' candidates are the ones that connect to this context):",
    );
    lines.push(opts.intakeText.slice(0, 800));
    lines.push("");
  }
  lines.push(`ASSET TYPE: ${opts.assetClass}`);
  lines.push(`ASSET NAME: ${opts.sourceName}`);
  lines.push("");
  lines.push("ASSET CONTENT:");
  // Wider window than auto-extract — preview gets the user's
  // attention, so the LLM can afford to scan more text. Cap at 4000
  // chars (vs 1800 for auto-extract). The full normalized_text
  // remains in DB if a future re-preview needs more.
  const trimmed =
    opts.contentSnippet.length > 4000
      ? opts.contentSnippet.slice(0, 4000) + "\n[truncated]"
      : opts.contentSnippet;
  lines.push(trimmed);
  lines.push("");
  lines.push(
    "Propose 15-30 candidate entities per the system instructions. The user will review and check off which to keep.",
  );
  return lines.join("\n");
}

/**
 * Phase 1 — preview pass. Generates 15-30 candidates with rich
 * categories + evidence quotes + suggested flags, but DOES NOT write
 * to the entities table. Caller persists the result to
 * ingested_files.extraction_preview so the drawer can be reopened
 * idempotently. Soft-fails: returns a minimal-empty preview on any
 * LLM error (caller can surface this as "preview unavailable" and
 * fall back to auto-extract).
 */
export async function previewCandidatesFromAsset(
  opts: PreExtractAssetOpts,
): Promise<ExtractionPreview> {
  const generatedAt = new Date().toISOString();
  const emptyPreview: ExtractionPreview = {
    asset_id: opts.assetId,
    candidates: [],
    category_counts: {},
    suggested_count: 0,
    total_count: 0,
    generated_at: generatedAt,
    summary: null,
  };

  if (!opts.contentSnippet || opts.contentSnippet.length < 80) {
    // Too short to extract anything meaningful — return empty
    // preview. The drawer will show "no candidates found; this
    // asset may be too short to extract from."
    return emptyPreview;
  }

  let raw: unknown;
  try {
    raw = await llmJSON<unknown>({
      system: PREVIEW_SYSTEM_PROMPT,
      user: buildPreviewPrompt(opts),
      responseSchema: PREVIEW_RESPONSE_SCHEMA,
      temperature: 0.2,
      maxTokens: 3500,
    });
  } catch (err) {
    console.warn(
      `[asset-preextractor:preview] LLM call failed for ${opts.sourceName}:`,
      err,
    );
    return emptyPreview;
  }

  if (!raw || typeof raw !== "object") return emptyPreview;
  const r = raw as Record<string, unknown>;
  const summaryRaw = r.summary;
  const summary =
    typeof summaryRaw === "string" && summaryRaw.trim().length > 0
      ? summaryRaw.trim().slice(0, 500)
      : null;

  const rawCandidates = Array.isArray(r.candidates) ? r.candidates : [];
  const candidates: ExtractionCandidate[] = [];
  const categoryCounts: Partial<Record<ExtractionCategory, number>> = {};
  let suggestedCount = 0;

  for (const item of rawCandidates as Array<Record<string, unknown>>) {
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    const conf =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.max(0, Math.min(1, item.confidence))
        : 0.5;
    if (conf < 0.4) continue; // discipline rule from prompt

    const categoryRaw = item.category;
    if (
      typeof categoryRaw !== "string" ||
      !(EXTRACTION_CATEGORIES as readonly string[]).includes(categoryRaw)
    ) {
      continue;
    }
    const category = categoryRaw as ExtractionCategory;

    const desc =
      item.description == null
        ? null
        : String(item.description).trim().slice(0, 1000);
    const evidence =
      item.evidence_quote == null
        ? null
        : String(item.evidence_quote).trim().slice(0, 200);
    const suggested = item.suggested === true;
    if (suggested) suggestedCount += 1;
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;

    candidates.push({
      id: randomUUID(),
      name: name.slice(0, 200),
      description: desc,
      category,
      confidence: conf,
      evidence_quote: evidence,
      suggested,
    });
  }

  return {
    asset_id: opts.assetId,
    candidates,
    category_counts: categoryCounts,
    suggested_count: suggestedCount,
    total_count: candidates.length,
    generated_at: generatedAt,
    summary,
  };
}

/**
 * Phase 2 — commit pass. Takes a previously-cached ExtractionPreview
 * and the user's selected_candidate_ids[], filters to the chosen
 * subset, and writes them to the entities table via the existing
 * persistPreExtractedEntities() path. Returns the inserted entity
 * ids + a skipped count (candidates that deduped against existing
 * entities in the same space + asset combo).
 *
 * Selection precedence:
 *   1. If selectedCandidateIds is non-empty: use exactly those
 *      candidates, ignoring focusLevel.
 *   2. If selectedCandidateIds is empty AND focusLevel is set:
 *      auto-select top-N suggested candidates where N =
 *      FOCUS_LEVEL_TARGETS[focusLevel].
 *   3. If both are empty: fall back to all suggested candidates
 *      (matches auto-extract behavior).
 */
export async function commitSelectedCandidates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  opts: {
    spaceId: string;
    userId: string;
    assetId: string;
    preview: ExtractionPreview;
    selectedCandidateIds: string[];
    focusLevel?: FocusLevel;
  },
): Promise<{ insertedIds: string[]; skippedCount: number }> {
  const { preview, selectedCandidateIds, focusLevel } = opts;

  // Pick the candidates to commit per the selection precedence above.
  let chosen: ExtractionCandidate[];
  if (selectedCandidateIds.length > 0) {
    const idSet = new Set(selectedCandidateIds);
    chosen = preview.candidates.filter((c) => idSet.has(c.id));
  } else if (focusLevel) {
    const target = FOCUS_LEVEL_TARGETS[focusLevel];
    chosen = preview.candidates
      .filter((c) => c.suggested)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, target);
  } else {
    chosen = preview.candidates.filter((c) => c.suggested);
  }

  if (chosen.length === 0) {
    return { insertedIds: [], skippedCount: 0 };
  }

  // Collapse rich category back onto the coarser entity_category enum
  // the entities table accepts. Reuses the existing
  // persistPreExtractedEntities() path so dedup + source_tag
  // ("asset:<assetId>") + preextracted_entity_ids update all work
  // unchanged.
  const asEntities = chosen.map((c) => ({
    name: c.name,
    description: c.description,
    entity_category: CATEGORY_TO_ENTITY_CATEGORY[c.category],
    confidence: c.confidence,
  }));

  const insertedIds = await persistPreExtractedEntities(db, {
    spaceId: opts.spaceId,
    userId: opts.userId,
    assetId: opts.assetId,
    extracted: asEntities,
  });

  // skipped = chosen we asked to commit minus those that actually
  // landed (the rest were deduped by name against existing entities).
  const skippedCount = Math.max(0, chosen.length - insertedIds.length);
  return { insertedIds, skippedCount };
}
