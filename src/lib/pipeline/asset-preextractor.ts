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

  // ── P3 · Cross-paper dedup ──────────────────────────────────────
  //
  // Two-tier match:
  //   Tier 1 — exact: load EVERY entity in the space (regardless of
  //     source_tag) and match by lowercased + trimmed name. If a
  //     candidate matches an existing entity by name, reuse that id
  //     and append THIS asset to its literature_sources (de-duped).
  //   Tier 2 — fresh insert: only candidates that didn't match any
  //     existing name get inserted as new rows, with literature_sources
  //     seeded as [assetId] from the start.
  //
  // Why space-wide (not just asset-tagged): the WHOLE point of P3 is
  // that paper B's "working memory" should reuse paper A's entity, NOT
  // create a duplicate. Limiting dedup to a single source_tag (the
  // pre-P3 behavior) is exactly what fragments the KG.
  const sourceTag = `asset:${opts.assetId}`;
  const { data: spaceEntities } = await db
    .from("entities")
    .select("id, name, literature_sources")
    .eq("space_id", opts.spaceId);

  type ExistingEntity = {
    id: string;
    name: string;
    literature_sources: string[] | null;
  };

  const byNormalizedName = new Map<string, ExistingEntity>();
  for (const e of (spaceEntities ?? []) as ExistingEntity[]) {
    byNormalizedName.set(e.name.toLowerCase().trim(), e);
  }

  const toInsert: typeof opts.extracted = [];
  const toAppendSource: Array<{ id: string; nextSources: string[] }> = [];
  const reusedIds: string[] = [];

  for (const candidate of opts.extracted) {
    const key = candidate.name.toLowerCase().trim();
    const matched = byNormalizedName.get(key);
    if (matched) {
      reusedIds.push(matched.id);
      const current = Array.isArray(matched.literature_sources)
        ? matched.literature_sources
        : [];
      if (!current.includes(opts.assetId)) {
        toAppendSource.push({
          id: matched.id,
          nextSources: [...current, opts.assetId],
        });
      }
    } else {
      toInsert.push(candidate);
    }
  }

  // Patch reused entities' literature_sources so paper B is on record
  // even though its candidate didn't create a fresh row.
  for (const patch of toAppendSource) {
    try {
      await db
        .from("entities")
        .update({ literature_sources: patch.nextSources })
        .eq("id", patch.id);
    } catch (err) {
      console.warn(
        `[asset-preextractor] entity literature_sources append failed for ${patch.id}:`,
        err,
      );
    }
  }

  if (toInsert.length === 0) {
    // Every candidate matched an existing entity. We've appended this
    // asset to all of their literature_sources; just sync the asset's
    // preextracted_entity_ids and return.
    if (reusedIds.length > 0) {
      try {
        await db
          .from("ingested_files")
          .update({ preextracted_entity_ids: reusedIds })
          .eq("id", opts.assetId);
      } catch (err) {
        console.warn(
          `[asset-preextractor] preextracted_entity_ids update failed for ${opts.assetId}:`,
          err,
        );
      }
    }
    return reusedIds;
  }

  // Insert genuinely new entities. literature_sources starts as
  // [assetId] so future passes find them via the GIN index.
  const rows = toInsert.map((e) => ({
    space_id: opts.spaceId,
    user_id: opts.userId,
    name: e.name.slice(0, 200),
    description: e.description?.slice(0, 1000) ?? null,
    entity_category: e.entity_category,
    confidence: e.confidence,
    source_tag: sourceTag,
    literature_sources: [opts.assetId],
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
    // Fresh inserts failed but the reuse-path patches already
    // succeeded. Return the reused ids so the asset's
    // preextracted_entity_ids still records the partial result.
    return reusedIds;
  }

  const newIds = ((inserted ?? []) as Array<{ id: string }>).map((e) => e.id);
  const allIds = [...reusedIds, ...newIds];

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

  // Return ALL ids associated with this asset (reused + freshly
  // inserted), not just newly inserted, so callers see the full
  // "entities this asset contributed to" set. Pre-P3 callers got
  // newly-inserted only — but with cross-paper dedup, "reused" is now
  // a first-class outcome that should count toward asset.preextracted
  // and the commit's reported insertedIds.length.
  return allIds;
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

7. paper_metadata: when the asset reads like a research paper (has
   abstract, citations, an authors line, etc.), extract structured
   bibliographic info: title, authors, year, doi. Otherwise emit nulls
   / empty arrays. Don't fabricate — if you can't find a year, set it
   to null. Authors should be the surnames or "Last, F." form, not
   full first+last names.

Output strict JSON:
{
  "summary": "string — 1-2 sentences describing what this asset is and why it matters to the user's task. ≤500 chars. Surfaced at top of review drawer.",
  "paper_metadata": {
    "title": "string or null — paper/work title, ≤240 chars",
    "authors": ["string", ...] (surnames or 'Last, F.', ≤12 entries; empty if not a paper),
    "year": number or null,
    "doi": "string or null — verbatim DOI as it appears in the asset"
  },
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
      paper_metadata: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          title: { type: ["string", "null"] },
          authors: { type: "array", items: { type: "string" } },
          year: { type: ["number", "null"] },
          doi: { type: ["string", "null"] },
        },
        required: ["title", "authors", "year", "doi"],
      },
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
    required: ["summary", "paper_metadata", "candidates"],
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

  // P6 · validate paper_metadata. Soft-fails: missing/malformed →
  // null. Each field individually defensive so a flaky LLM that gives
  // us authors but no year still yields useful partial metadata.
  const metadataRaw = r.paper_metadata;
  let paperMetadata: ExtractionPreview["paper_metadata"] = null;
  if (metadataRaw && typeof metadataRaw === "object") {
    const m = metadataRaw as Record<string, unknown>;
    const titleStr =
      typeof m.title === "string" && m.title.trim().length > 0
        ? m.title.trim().slice(0, 240)
        : null;
    const authorsArr = Array.isArray(m.authors)
      ? m.authors
          .filter((a): a is string => typeof a === "string")
          .map((a) => a.trim().slice(0, 80))
          .filter((a) => a.length > 0)
          .slice(0, 12)
      : [];
    const yearNum =
      typeof m.year === "number" && Number.isFinite(m.year) && m.year > 1500
        ? Math.floor(m.year)
        : null;
    const doiStr =
      typeof m.doi === "string" && m.doi.trim().length > 0
        ? m.doi.trim().slice(0, 200)
        : null;
    // Don't bother attaching paper_metadata if EVERY field is empty —
    // saves bytes in the JSONB and lets UI use simple truthy checks.
    if (titleStr || authorsArr.length > 0 || yearNum !== null || doiStr) {
      paperMetadata = {
        title: titleStr,
        authors: authorsArr,
        year: yearNum,
        doi: doiStr,
      };
    }
  }

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
    paper_metadata: paperMetadata,
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
): Promise<{
  insertedIds: string[];
  skippedCount: number;
  edgeInsertedCount?: number;
  edgeSkippedCount?: number;
}> {
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

  // ── P2 follow-through: edge extraction with literature_sources ──
  // After entities land, run an additional LLM pass to identify
  // causal/correlational/composition relationships between them and
  // persist as edges with literature_sources=[assetId]. This is what
  // populates the 📚 N badge in the entity-detail drawer.
  //
  // Soft-fail: if anything goes wrong (no entities to relate, LLM
  // error, dedup empty), the entity-only commit still succeeds.
  const edgesResult = await runAssetEdgeExtraction(db, {
    spaceId: opts.spaceId,
    userId: opts.userId,
    assetId: opts.assetId,
    chosen,
  }).catch((err) => {
    console.warn(
      `[asset-preextractor:edges] extraction failed for ${opts.assetId}:`,
      err,
    );
    return { insertedCount: 0, skippedCount: 0 };
  });

  return {
    insertedIds,
    skippedCount,
    edgeInsertedCount: edgesResult.insertedCount,
    edgeSkippedCount: edgesResult.skippedCount,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Asset edge extraction (P2 / D14 follow-up — populates literature_sources)
// ─────────────────────────────────────────────────────────────────────
//
// After entities are committed, this pass asks the LLM to identify
// edges between them grounded in the paper's evidence_quotes. It then
// persists those edges with `literature_sources=[assetId]`, which is
// what makes the 📚 N badge in the drawer light up.
//
// Why a separate stage from entity extraction:
//   - Entity extraction is naming. Edge extraction is relationship.
//     The two tasks have different prompts and different failure
//     modes (entities are nouns; edges are verbs+modifiers).
//   - We can skip edge extraction cheaply if <2 entities landed.
//   - Soft-failable independently.
//
// Why use evidence_quotes as the corpus (not normalized_text):
//   - The quotes are already the load-bearing snippets of the paper
//     (they're what justified each entity's existence).
//   - Cheaper: 15-30 quotes × ~150 chars each ≈ 3-5kb prompt vs
//     20-50kb for full text.
//   - The LLM is grounded by definition: every edge it proposes can
//     be tied back to a quote.

interface ProposedAssetEdge {
  source_name: string;
  target_name: string;
  relation_type: AssetEdgeRelation;
  polarity: "positive" | "negative" | "neutral" | "conditional";
  confidence: number;
  rationale: string | null;
}

const ASSET_EDGE_RELATIONS = [
  "causes",
  "enables",
  "inhibits",
  "moderates",
  "mediates",
  "constrains",
  "composes",
  "competes",
  "temporally_precedes",
  "relates_to",
] as const;
type AssetEdgeRelation = (typeof ASSET_EDGE_RELATIONS)[number];

const EDGE_SYSTEM_PROMPT = `You are a relationship extractor. You are given:
  - A paper's evidence quotes (load-bearing snippets)
  - A list of named entities the paper mentions

Your job: identify causal/correlational/compositional relationships
BETWEEN those entities, GROUNDED in the quotes.

Discipline:
1. Only emit edges where the source AND target are BOTH in the entity
   list. No invented entities.
2. Every edge must be supported by at least one quote. If you can't
   ground an edge, don't emit it.
3. Choose the most specific relation_type:
   - causes: A directly produces B
   - enables: A is required for B (necessary condition)
   - inhibits: A reduces or blocks B
   - moderates: A changes the strength of another relationship
   - mediates: A is the mechanism connecting other entities
   - constrains: A limits the range of B
   - composes: B is built from A (part-of)
   - competes: A and B trade off / are alternatives
   - temporally_precedes: A happens before B (no causal claim)
   - relates_to: weak association, prefer a more specific type
4. Polarity:
   - positive: A increases B (or A→B is reinforcing)
   - negative: A decreases B (or A→B is opposing)
   - neutral: structural/temporal without sign
   - conditional: depends on context the paper specifies
5. Confidence: 0.7+ for explicit claims; 0.4-0.6 for inferred/implied;
   below 0.4 → skip.
6. Be GENEROUS but DISCIPLINED. Aim for 3-12 edges per paper. Skip
   edges that would just clutter the graph.

Output strict JSON:
{
  "edges": [
    {
      "source_name": "string (must match an entity name verbatim)",
      "target_name": "string (must match an entity name verbatim)",
      "relation_type": "causes|enables|inhibits|moderates|mediates|constrains|composes|competes|temporally_precedes|relates_to",
      "polarity": "positive|negative|neutral|conditional",
      "confidence": 0.0..1.0,
      "rationale": "string (≤200 chars) — short one-liner referencing the quote(s)"
    }
  ]
}`;

const EDGE_RESPONSE_SCHEMA = {
  name: "asset_extracted_edges",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      edges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source_name: { type: "string" },
            target_name: { type: "string" },
            relation_type: { type: "string", enum: [...ASSET_EDGE_RELATIONS] },
            polarity: {
              type: "string",
              enum: ["positive", "negative", "neutral", "conditional"],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: ["string", "null"] },
          },
          required: [
            "source_name",
            "target_name",
            "relation_type",
            "polarity",
            "confidence",
            "rationale",
          ],
        },
      },
    },
    required: ["edges"],
  },
} as const;

async function extractEdgesFromAssetEntities(opts: {
  entities: Array<{ name: string; description: string | null }>;
  evidenceQuotes: Array<{ entityName: string; quote: string }>;
}): Promise<ProposedAssetEdge[]> {
  if (opts.entities.length < 2) return [];
  if (opts.evidenceQuotes.length === 0) return [];

  const userLines: string[] = [];
  userLines.push("ENTITIES (your relationship endpoints — use names verbatim):");
  for (const e of opts.entities) {
    const desc = e.description ? ` — ${e.description.slice(0, 120)}` : "";
    userLines.push(`- ${e.name}${desc}`);
  }
  userLines.push("");
  userLines.push("EVIDENCE QUOTES (ground each edge here):");
  for (const q of opts.evidenceQuotes.slice(0, 30)) {
    userLines.push(`- [${q.entityName}] "${q.quote.slice(0, 220)}"`);
  }
  userLines.push("");
  userLines.push(
    "Identify 3-12 causal/correlational/compositional edges per the system instructions.",
  );

  let raw: unknown;
  try {
    raw = await llmJSON<unknown>({
      system: EDGE_SYSTEM_PROMPT,
      user: userLines.join("\n"),
      responseSchema: EDGE_RESPONSE_SCHEMA,
      temperature: 0.2,
      maxTokens: 1500,
    });
  } catch (err) {
    console.warn("[asset-preextractor:edges] LLM call failed:", err);
    return [];
  }

  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.edges)) return [];

  const validNames = new Set(
    opts.entities.map((e) => e.name.toLowerCase().trim()),
  );

  return (r.edges as Array<Record<string, unknown>>)
    .map((e): ProposedAssetEdge | null => {
      const sName = String(e.source_name ?? "").trim();
      const tName = String(e.target_name ?? "").trim();
      if (!sName || !tName) return null;
      if (sName.toLowerCase() === tName.toLowerCase()) return null;
      if (!validNames.has(sName.toLowerCase())) return null;
      if (!validNames.has(tName.toLowerCase())) return null;

      const rel = e.relation_type;
      if (
        typeof rel !== "string" ||
        !(ASSET_EDGE_RELATIONS as readonly string[]).includes(rel)
      ) {
        return null;
      }

      const pol = e.polarity;
      const polarity: ProposedAssetEdge["polarity"] =
        pol === "positive" ||
        pol === "negative" ||
        pol === "neutral" ||
        pol === "conditional"
          ? pol
          : "neutral";

      const conf =
        typeof e.confidence === "number" && Number.isFinite(e.confidence)
          ? Math.max(0, Math.min(1, e.confidence))
          : 0.5;
      if (conf < 0.4) return null;

      const rationale =
        e.rationale == null ? null : String(e.rationale).trim().slice(0, 200);

      return {
        source_name: sName,
        target_name: tName,
        relation_type: rel as AssetEdgeRelation,
        polarity,
        confidence: conf,
        rationale: rationale && rationale.length > 0 ? rationale : null,
      };
    })
    .filter((e): e is ProposedAssetEdge => e !== null);
}

/**
 * Persist asset-extracted edges. Resolves entity names → ids using the
 * provided map, dedups against existing edges in the space (same
 * source+target+relation_type), and inserts with
 * `literature_sources=[assetId]`. If an existing edge matches but its
 * `literature_sources` doesn't yet include this asset, append it
 * rather than insert a duplicate edge — multiple papers commonly
 * support the same edge.
 */
async function persistAssetEdges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  opts: {
    spaceId: string;
    assetId: string;
    proposed: ProposedAssetEdge[];
    nameToEntityId: Map<string, string>;
  },
): Promise<{ insertedCount: number; skippedCount: number }> {
  if (opts.proposed.length === 0) {
    return { insertedCount: 0, skippedCount: 0 };
  }

  // Resolve names → ids. Anything that doesn't resolve is skipped.
  const resolved = opts.proposed
    .map((p) => {
      const sId = opts.nameToEntityId.get(p.source_name.toLowerCase().trim());
      const tId = opts.nameToEntityId.get(p.target_name.toLowerCase().trim());
      if (!sId || !tId || sId === tId) return null;
      return { ...p, source_id: sId, target_id: tId };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (resolved.length === 0) {
    return { insertedCount: 0, skippedCount: opts.proposed.length };
  }

  // Pull existing edges between any of these resolved pairs in this
  // space. Used both to avoid duplicate inserts AND to append the new
  // assetId to literature_sources of any matching existing edge.
  const allIds = new Set<string>();
  for (const r of resolved) {
    allIds.add(r.source_id);
    allIds.add(r.target_id);
  }
  const idArr = Array.from(allIds);
  const { data: existingRows } = await db
    .from("edges")
    .select("id, source_entity_id, target_entity_id, relation_type, literature_sources")
    .eq("space_id", opts.spaceId)
    .in("source_entity_id", idArr)
    .in("target_entity_id", idArr);

  const existingByKey = new Map<
    string,
    {
      id: string;
      literature_sources: string[] | null;
    }
  >();
  for (const r of (existingRows ?? []) as Array<{
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    relation_type: string | null;
    literature_sources: string[] | null;
  }>) {
    const key = `${r.source_entity_id}|${r.target_entity_id}|${r.relation_type ?? ""}`;
    existingByKey.set(key, {
      id: r.id,
      literature_sources: r.literature_sources,
    });
  }

  let insertedCount = 0;
  let skippedCount = 0;
  const toInsert: Array<Record<string, unknown>> = [];
  const toAppendSource: Array<{ id: string; nextSources: string[] }> = [];

  for (const r of resolved) {
    const key = `${r.source_id}|${r.target_id}|${r.relation_type}`;
    const existing = existingByKey.get(key);
    if (existing) {
      const current = Array.isArray(existing.literature_sources)
        ? existing.literature_sources
        : [];
      if (current.includes(opts.assetId)) {
        // already attributed to this paper; nothing to do.
        skippedCount += 1;
        continue;
      }
      toAppendSource.push({
        id: existing.id,
        nextSources: [...current, opts.assetId],
      });
      skippedCount += 1; // counted as "skipped insert" — we patched instead
      continue;
    }
    toInsert.push({
      space_id: opts.spaceId,
      source_entity_id: r.source_id,
      target_entity_id: r.target_id,
      relationship_type: r.relation_type,
      relation_type: r.relation_type,
      dimension: "causal",
      source_tag: "inferred",
      polarity: r.polarity,
      confidence: r.confidence,
      strength: r.confidence,
      knowledge_layer: "external",
      conditions: r.rationale,
      literature_sources: [opts.assetId],
    });
  }

  if (toInsert.length > 0) {
    const { error } = await db.from("edges").insert(toInsert);
    if (error) {
      console.warn(
        `[asset-preextractor:edges] insert failed for ${opts.assetId}:`,
        error,
      );
    } else {
      insertedCount = toInsert.length;
    }
  }

  // Append assetId to existing edges' literature_sources. Done one at
  // a time because each row needs its own merged array — Supabase
  // doesn't expose a native array_append in update().
  for (const patch of toAppendSource) {
    try {
      await db
        .from("edges")
        .update({ literature_sources: patch.nextSources })
        .eq("id", patch.id);
    } catch (err) {
      console.warn(
        `[asset-preextractor:edges] literature_sources append failed for edge ${patch.id}:`,
        err,
      );
    }
  }

  return { insertedCount, skippedCount };
}

/**
 * Orchestrator for the full edge-extraction step. Pulled into its own
 * function so commitSelectedCandidates() can call it with a single
 * await + soft-fail wrapper.
 *
 * Steps:
 *   1. Pull all asset-tagged entities for this space (including ones
 *      from prior commits — edges can connect today's entity to a
 *      previously-extracted entity from the same paper).
 *   2. Build evidence_quotes corpus from chosen candidates (only ones
 *      we just committed have fresh quotes).
 *   3. LLM call → ProposedAssetEdge[]
 *   4. Resolve names → ids using the asset's full entity set.
 *   5. Persist via persistAssetEdges.
 */
async function runAssetEdgeExtraction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  opts: {
    spaceId: string;
    userId: string;
    assetId: string;
    chosen: ExtractionCandidate[];
  },
): Promise<{ insertedCount: number; skippedCount: number }> {
  // P3 · query by literature_sources contains assetId (not source_tag)
  // so reused-from-prior-paper entities are included. The edge extractor
  // needs to see ALL entities this paper contributed to or referenced,
  // even if their primary source_tag is a different asset.
  const { data: assetEntities } = await db
    .from("entities")
    .select("id, name, description")
    .eq("space_id", opts.spaceId)
    .contains("literature_sources", [opts.assetId]);

  const entities =
    ((assetEntities ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
    }>) ?? [];

  if (entities.length < 2) {
    return { insertedCount: 0, skippedCount: 0 };
  }

  // evidence_quotes corpus — only chosen candidates have fresh quotes
  // attached. We keep ones that match a real entity.
  const entityNames = new Set(entities.map((e) => e.name.toLowerCase().trim()));
  const evidenceQuotes = opts.chosen
    .filter(
      (c) =>
        typeof c.evidence_quote === "string" &&
        c.evidence_quote.trim().length > 0 &&
        entityNames.has(c.name.toLowerCase().trim()),
    )
    .map((c) => ({ entityName: c.name, quote: c.evidence_quote as string }));

  if (evidenceQuotes.length === 0) {
    return { insertedCount: 0, skippedCount: 0 };
  }

  const proposed = await extractEdgesFromAssetEntities({
    entities: entities.map((e) => ({ name: e.name, description: e.description })),
    evidenceQuotes,
  });

  if (proposed.length === 0) {
    return { insertedCount: 0, skippedCount: 0 };
  }

  const nameToEntityId = new Map<string, string>();
  for (const e of entities) {
    nameToEntityId.set(e.name.toLowerCase().trim(), e.id);
  }

  return persistAssetEdges(db, {
    spaceId: opts.spaceId,
    assetId: opts.assetId,
    proposed,
    nameToEntityId,
  });
}
