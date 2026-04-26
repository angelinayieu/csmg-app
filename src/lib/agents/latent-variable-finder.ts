// ── Latent Variable Finder agent (Phase 3 — downstream reality) ──────
//
// Runs AFTER the writer-path has materialized a batch of variants.
// Looks across the variant set and asks: "what hidden dimensions
// differentiate these variants?". Proposes 3-5 latent variables
// (e.g., "specificity", "emotional_tone") + scores each variant on
// each discovered dimension.
//
// Why latent variables at all? The taxonomy's outcome_axes are chosen
// at intake — quality/lift/tokens. They measure how GOOD a variant
// is. Latent variables measure how it's DIFFERENT. They're how the
// downstream-reality panel answers "what's the spread across the
// variant landscape?" — showing the user that, say, variant V-2 is
// "high specificity + low emotional" while V-4 is the inverse.
//
// Token budget: bigger than other writer-path agents because the
// input is the concatenation of all variants' summaries/slots.
// maxTokens: 3000. temperature: 0.35 — enough diversity to discover
// non-obvious dimensions but stable across reruns.
//
// Soft-fail pattern mirrors the rest of the writer path.

import { llmJSON } from "@/lib/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExperimentTaxonomy,
  ExperimentVariant,
  ExperimentVariantSlot,
} from "@/types/experiment-taxonomy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** Minimal variant shape the finder needs — label, summary, slot
 *  fills, aggregate scores. Passed this way so the caller can assemble
 *  from whatever columns it has without the agent needing the full row. */
export interface FinderVariantInput {
  id: string;
  label: string;
  summary: string | null;
  shortId: string | null;
  slots: Array<
    Pick<ExperimentVariantSlot, "slot_id" | "value_preview" | "is_active">
  >;
}

export interface LatentVariableFinderInput {
  taxonomy: ExperimentTaxonomy;
  variants: FinderVariantInput[];
  /** Existing latent variables for this space — on re-run the finder
   *  should prefer extending / refining rather than wholesale replacing,
   *  so old scores remain comparable. */
  existingLatents?: Array<{ key: string; label: string; description: string }>;
}

export interface DiscoveredLatentVariable {
  key: string;
  label: string;
  description: string;
  color: string;
}

export interface VariantScore {
  variantId: string;
  latentKey: string;
  score: number; // 0..1
  evidence: string; // ≤ 160 chars
}

export interface LatentVariableFinderResult {
  latents: DiscoveredLatentVariable[];
  scores: VariantScore[];
  confidence: number;
}

// Diverse palette so the heatmap column headers are visually distinct
// even when the finder returns 5 dimensions. Cycled based on the
// agent's ordering so the first dimension gets the primary blue.
const LATENT_PALETTE = [
  "#6366f1", // indigo — "primary dimension"
  "#0891b2", // cyan
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#8b5cf6", // violet
];

function colorForIndex(i: number): string {
  return LATENT_PALETTE[i % LATENT_PALETTE.length];
}

// ── Prompt construction ──────────────────────────────────────────────

function buildSystemPrompt(taxonomy: ExperimentTaxonomy): string {
  return `You are a discovery agent for a ${taxonomy.domain_key} experiment.

Given a set of ${taxonomy.variant_noun}s that were generated to explore the same situation, your job is to propose 3-5 LATENT VARIABLES — hidden outcome dimensions that DIFFERENTIATE the variants.

IMPORTANT distinction:
- Outcome axes (already defined by the taxonomy) measure how GOOD a variant is: quality, lift, cost.
- Latent variables measure how variants DIFFER from each other: "specificity", "emotional_tone", "structural_rigor", "novelty", "risk_appetite".

For each latent variable, then score EVERY variant on a 0..1 scale where 0 = strongly low on this dimension and 1 = strongly high.

Rules:
- 3-5 dimensions max. Fewer is fine if the variants don't really spread on more.
- Dimensions must SEPARATE the variants — don't propose a dimension where all variants would score 0.5.
- label is Title Case human-readable. key is snake_case slug.
- description is one sentence: "Captures X — high = Y, low = Z."
- evidence is ≤ 160 chars: a specific phrase from the variant that justifies the score.

Return ONLY valid JSON:
{
  "latents": [
    { "key": string, "label": string, "description": string }
  ],
  "scores": [
    { "variantId": string, "latentKey": string, "score": number, "evidence": string }
  ],
  "confidence": number
}`;
}

function buildUserPrompt(input: LatentVariableFinderInput): string {
  const variantBlocks = input.variants
    .map((v) => {
      const slotLines = v.slots
        .filter((s) => s.is_active && s.value_preview)
        .map((s) => `    - ${s.slot_id}: ${s.value_preview}`)
        .join("\n");
      return `Variant ${v.shortId ?? v.id} (id: ${v.id})
  label: ${v.label}
  summary: ${v.summary ?? "(no summary)"}
  slots:
${slotLines || "    (no active slots)"}`;
    })
    .join("\n\n");

  const existingBlock =
    input.existingLatents && input.existingLatents.length > 0
      ? `\n\nPREVIOUSLY DISCOVERED DIMENSIONS (prefer extending/refining these keys so old scores stay comparable):
${input.existingLatents.map((l) => `  - ${l.key} (${l.label}): ${l.description}`).join("\n")}\n`
      : "";

  return `VARIANTS UNDER ANALYSIS:

${variantBlocks}
${existingBlock}
Propose 3-5 latent variables that DIFFERENTIATE these variants and score every variant on every dimension.`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function trimTo(s: string, max: number): string {
  const clean = s.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

function validateResult(
  raw: unknown,
  input: LatentVariableFinderInput,
): LatentVariableFinderResult {
  if (!raw || typeof raw !== "object") throw new Error("not an object");
  const r = raw as Record<string, unknown>;

  const latentsRaw = Array.isArray(r.latents) ? r.latents : [];
  const scoresRaw = Array.isArray(r.scores) ? r.scores : [];

  // Validate latents — dedup by key, cap at 5.
  const latents: DiscoveredLatentVariable[] = [];
  const seenKeys = new Set<string>();
  for (const l of latentsRaw) {
    if (!l || typeof l !== "object") continue;
    const lo = l as Record<string, unknown>;
    const key = typeof lo.key === "string" ? lo.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") : "";
    if (!key || seenKeys.has(key)) continue;
    const label = typeof lo.label === "string" && lo.label.trim() ? lo.label.trim() : key;
    const description =
      typeof lo.description === "string" ? trimTo(lo.description, 240) : "";
    seenKeys.add(key);
    latents.push({
      key,
      label: trimTo(label, 60),
      description,
      color: colorForIndex(latents.length),
    });
    if (latents.length >= 5) break;
  }

  if (latents.length === 0) {
    throw new Error("no latent variables proposed");
  }

  // Validate scores — keep only those whose (variantId, latentKey) pair
  // references a known variant + a proposed latent.
  const validVariantIds = new Set(input.variants.map((v) => v.id));
  const validLatentKeys = new Set(latents.map((l) => l.key));
  const scores: VariantScore[] = [];
  const seenPairs = new Set<string>();
  for (const s of scoresRaw) {
    if (!s || typeof s !== "object") continue;
    const so = s as Record<string, unknown>;
    const variantId = typeof so.variantId === "string" ? so.variantId : "";
    const latentKey = typeof so.latentKey === "string" ? so.latentKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") : "";
    if (!validVariantIds.has(variantId)) continue;
    if (!validLatentKeys.has(latentKey)) continue;
    const pairKey = `${variantId}::${latentKey}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const score = typeof so.score === "number" ? clamp(so.score, 0, 1) : 0.5;
    const evidence =
      typeof so.evidence === "string" ? trimTo(so.evidence, 160) : "";
    scores.push({ variantId, latentKey, score, evidence });
  }

  return {
    latents,
    scores,
    confidence:
      typeof r.confidence === "number" ? clamp(r.confidence, 0, 1) : 0.6,
  };
}

// ── Public entry ─────────────────────────────────────────────────────

const EMPTY_RESULT: LatentVariableFinderResult = {
  latents: [],
  scores: [],
  confidence: 0,
};

/**
 * Discover latent outcome dimensions + score every variant against them.
 * Always resolves; never throws. Empty result on any failure.
 */
export async function runLatentVariableFinder(
  input: LatentVariableFinderInput,
): Promise<LatentVariableFinderResult> {
  // Need at least 2 variants to find dimensions that DIFFERENTIATE —
  // a single variant gives the LLM nothing to compare against.
  if (input.variants.length < 2) return EMPTY_RESULT;

  try {
    return await llmJSON<LatentVariableFinderResult>({
      system: buildSystemPrompt(input.taxonomy),
      user: buildUserPrompt(input),
      maxTokens: 3000,
      temperature: 0.35,
      validator: (raw) => validateResult(raw, input),
      fallback: EMPTY_RESULT,
    });
  } catch (err) {
    console.warn("[latent-variable-finder] discovery failed:", err);
    return EMPTY_RESULT;
  }
}

// ── Persistence helper ───────────────────────────────────────────────

export interface PersistLatentsOutcome {
  /** Number of latent_variables rows written (insert + update). */
  latentsWritten: number;
  /** Number of variant_outcome_scores rows written. */
  scoresWritten: number;
  /** latentKey → latent_variables.id map, for downstream event emission. */
  latentIdsByKey: Record<string, string>;
}

/**
 * Upsert latent_variables rows + variant_outcome_scores rows based on
 * the finder's output. Upserts on (space_id, key) for latents and on
 * (variant_id, latent_variable_id) for scores, so re-running is safe
 * and keeps old scores refreshed rather than duplicated.
 *
 * Returns counts + the key→id map (used by the pipeline to emit
 * downstream events once we wire them).
 */
export async function persistLatentDiscovery(
  db: AnyDb,
  spaceId: string,
  result: LatentVariableFinderResult,
): Promise<PersistLatentsOutcome> {
  const outcome: PersistLatentsOutcome = {
    latentsWritten: 0,
    scoresWritten: 0,
    latentIdsByKey: {},
  };
  if (result.latents.length === 0) return outcome;

  // ── Upsert latent_variables ─────────────────────────────────────
  try {
    const latentRows = result.latents.map((l) => ({
      space_id: spaceId,
      key: l.key,
      label: l.label,
      description: l.description,
      color: l.color,
      confidence: result.confidence,
    }));
    const { data: writtenLatents, error: latentsErr } = await db
      .from("latent_variables")
      .upsert(latentRows, { onConflict: "space_id,key" })
      .select("id, key");
    if (latentsErr) {
      console.warn("[latent-variable-finder] latent upsert failed:", latentsErr);
      return outcome;
    }
    const rows = (writtenLatents ?? []) as Array<{ id: string; key: string }>;
    for (const r of rows) outcome.latentIdsByKey[r.key] = r.id;
    outcome.latentsWritten = rows.length;
  } catch (err) {
    console.warn("[latent-variable-finder] latent persist threw:", err);
    return outcome;
  }

  // ── Upsert variant_outcome_scores ───────────────────────────────
  // Keyed on (variant_id, latent_variable_id); drop score rows whose
  // latentKey failed to resolve to an id (shouldn't happen but stays
  // defensive — a missing FK would otherwise poison the batch).
  const scoreRows: Array<Record<string, unknown>> = [];
  for (const s of result.scores) {
    const latentId = outcome.latentIdsByKey[s.latentKey];
    if (!latentId) continue;
    scoreRows.push({
      variant_id: s.variantId,
      space_id: spaceId,
      latent_variable_id: latentId,
      score: s.score,
      evidence: s.evidence || null,
      scored_at: new Date().toISOString(),
    });
  }
  if (scoreRows.length === 0) return outcome;

  try {
    const { error: scoresErr } = await db
      .from("variant_outcome_scores")
      .upsert(scoreRows, { onConflict: "variant_id,latent_variable_id" });
    if (scoresErr) {
      console.warn("[latent-variable-finder] score upsert failed:", scoresErr);
      return outcome;
    }
    outcome.scoresWritten = scoreRows.length;
  } catch (err) {
    console.warn("[latent-variable-finder] score persist threw:", err);
  }

  return outcome;
}
