// ── IV Extractor agent (Phase 3 — VP Project report, writer path) ────
//
// Given a full artifact (a whole prompt, a whole recipe, a whole
// routine script…) + the space's taxonomy schema, decomposes the
// text into slot-by-slot values.
//
// When does this run?
//   A) Fallback path inside the pipeline: if variant_factory produces
//      a variant with fewer than half its slots filled (LLM dropped
//      the ball), the extractor runs on the combined text to recover.
//   B) Direct user path: when someone pastes a full prompt into the
//      App's "Analyze existing prompt" box, the extractor is what
//      converts the paste into a scored, flashcard-shaped variant.
//   C) Re-decomposition on edit: if the user rewrites the full text
//      of a variant, the extractor is how we re-populate the slot
//      grid so the rings update.
//
// This is strictly a READ agent — it doesn't score or propose or
// name variants. Its output is the `slotFills` sub-shape only.
//
// Soft-fail + empty-on-error mirrors the rest of the writer path.
// Token budget: 2000 max (one variant, N slots, preview+full each).

import { llmJSON } from "@/lib/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExperimentTaxonomy } from "@/types/experiment-taxonomy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface IVExtractorInput {
  taxonomy: ExperimentTaxonomy;
  /** The full artifact text to decompose. Can span multiple lines. */
  artifactText: string;
  /** Optional: short context hint — what domain/use-case this artifact
   *  is for. Helps when the text itself is ambiguous. */
  context?: string;
}

export interface ExtractedSlotFill {
  slotId: string;
  preview: string;
  full: string;
}

export interface IVExtractorResult {
  slotFills: ExtractedSlotFill[];
  /** Slots the extractor couldn't find evidence for in the text.
   *  The UI dims these rings ("slot is present in taxonomy but
   *  inactive on this variant"). */
  absentSlots: string[];
  confidence: number;
}

// ── Prompt construction ──────────────────────────────────────────────

function buildSystemPrompt(taxonomy: ExperimentTaxonomy): string {
  const slotLines = taxonomy.slots
    .slice()
    .sort((a, b) => a.ordering - b.ordering)
    .map(
      (s) => `  - ${s.id} ("${s.label}"): ${s.description ?? s.label}`,
    )
    .join("\n");

  return `You are a decomposition agent for a ${taxonomy.domain_key} experiment.

Your job: given ONE artifact (a ${taxonomy.artifact_noun}), split it into its component SLOTS.

SLOTS (this domain's independent-variable schema):
${slotLines}

Rules:
- For each slot, extract the VERBATIM fragment of the input that fills it. Do not invent.
- If a slot is legitimately absent from the input, list it in absentSlots and skip it in slotFills.
- preview is a ≤ 120-char distillation of the extracted fragment (imperative voice).
- full is the extracted fragment itself, lightly normalized for whitespace.
- Do NOT add slots not in the schema above.
- Do NOT merge two slots into one. If two parts of the text map to the same slot, join them with "; ".

Return ONLY valid JSON:
{
  "slotFills": [
    { "slotId": string, "preview": string, "full": string }
  ],
  "absentSlots": [string],
  "confidence": number
}`;
}

function buildUserPrompt(input: IVExtractorInput): string {
  const ctx = input.context ? `\nCONTEXT: ${input.context}\n` : "";
  return `ARTIFACT TO DECOMPOSE:
<<<
${input.artifactText.slice(0, 3000)}
>>>
${ctx}
Extract one entry per present slot following the schema.`;
}

function validateResult(
  raw: unknown,
  taxonomy: ExperimentTaxonomy,
): IVExtractorResult {
  if (!raw || typeof raw !== "object") throw new Error("not an object");
  const r = raw as Record<string, unknown>;
  const fills = Array.isArray(r.slotFills) ? r.slotFills : [];
  const absents = Array.isArray(r.absentSlots) ? r.absentSlots : [];

  const validSlotIds = new Set(taxonomy.slots.map((s) => s.id));
  const parsedFills: ExtractedSlotFill[] = [];
  const seenSlots = new Set<string>();
  for (const f of fills) {
    if (!f || typeof f !== "object") continue;
    const fo = f as Record<string, unknown>;
    if (typeof fo.slotId !== "string") continue;
    if (!validSlotIds.has(fo.slotId)) continue;
    if (seenSlots.has(fo.slotId)) continue; // de-dup if model double-emits
    seenSlots.add(fo.slotId);
    parsedFills.push({
      slotId: fo.slotId,
      preview: trimTo(
        typeof fo.preview === "string" ? fo.preview : "",
        120,
      ),
      full: typeof fo.full === "string" ? fo.full : "",
    });
  }

  const parsedAbsents: string[] = [];
  for (const a of absents) {
    if (typeof a === "string" && validSlotIds.has(a) && !seenSlots.has(a)) {
      parsedAbsents.push(a);
    }
  }

  if (parsedFills.length === 0 && parsedAbsents.length === 0) {
    throw new Error("no slots extracted");
  }

  return {
    slotFills: parsedFills,
    absentSlots: parsedAbsents,
    confidence:
      typeof r.confidence === "number" ? clamp(r.confidence, 0, 1) : 0.6,
  };
}

// ── Public entry ─────────────────────────────────────────────────────

/**
 * Extract slot fills from a full artifact. Always resolves; never
 * throws. Empty slotFills + empty absentSlots + confidence:0 signals
 * a failed extraction — caller should skip the persist step.
 */
export async function runIVExtractor(
  input: IVExtractorInput,
): Promise<IVExtractorResult> {
  // Quick no-op when there's nothing to decompose.
  if (!input.artifactText || input.artifactText.trim().length < 10) {
    return { slotFills: [], absentSlots: [], confidence: 0 };
  }
  try {
    return await llmJSON<IVExtractorResult>({
      system: buildSystemPrompt(input.taxonomy),
      user: buildUserPrompt(input),
      maxTokens: 2000,
      temperature: 0.2, // extraction is grounded — stay tight
      validator: (raw) => validateResult(raw, input.taxonomy),
      fallback: { slotFills: [], absentSlots: [], confidence: 0 },
    });
  } catch (err) {
    console.warn("[iv-extractor] extraction failed:", err);
    return { slotFills: [], absentSlots: [], confidence: 0 };
  }
}

// ── Persistence helper ───────────────────────────────────────────────

/**
 * Upsert the extracted slots onto a variant.
 *
 * Behavior:
 *   - slotFills rows become `experiment_variant_slots` with
 *     is_active=true + extracted preview/full. Unique (variant_id,
 *     slot_id) drives the upsert.
 *   - absentSlots rows become rows with is_active=false and
 *     null preview/full — the widget uses this to dim rings.
 *   - All rows preserve any existing `score`/`lift`/`spark_points` —
 *     we only overwrite content, not scoring. The iv_scorer owns
 *     those columns.
 *
 * Returns count of slots written on success, 0 on failure.
 */
export async function persistExtractedSlots(
  db: AnyDb,
  variantId: string,
  result: IVExtractorResult,
): Promise<number> {
  if (result.slotFills.length === 0 && result.absentSlots.length === 0) {
    return 0;
  }
  try {
    const rows: Array<Record<string, unknown>> = [];
    for (const fill of result.slotFills) {
      rows.push({
        variant_id: variantId,
        slot_id: fill.slotId,
        value_preview: fill.preview,
        value_full: fill.full,
        token_count: estimateTokens(fill.full),
        is_active: true,
      });
    }
    for (const slotId of result.absentSlots) {
      rows.push({
        variant_id: variantId,
        slot_id: slotId,
        value_preview: null,
        value_full: null,
        token_count: 0,
        is_active: false,
      });
    }
    const { error } = await db
      .from("experiment_variant_slots")
      .upsert(rows, { onConflict: "variant_id,slot_id" });
    if (error) {
      console.warn("[iv-extractor] upsert failed:", error);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn("[iv-extractor] persist threw:", err);
    return 0;
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function trimTo(s: string, max: number): string {
  const clean = s.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

function estimateTokens(s: string): number {
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}
