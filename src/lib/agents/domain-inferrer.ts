// ── Domain Inferrer agent (Phase 3 — VP Project report) ────────────
//
// Fires ONCE per pipeline run, at the tail of intake, right after
// the structurer has produced entities + the scope agent has set the
// space name. Asks the LLM: "what are the independent variables we
// would manipulate if we were to run rigorous experiments on this
// situation?"
//
// Output: a taxonomy row written to `experiment_taxonomies` that
// drives the decomposition widget + variant carousel downstream.
//
// Why this is its own agent (not a field in the decomposer):
//   • The decomposer's job is entities + edges — extra load here
//     degrades the main KG quality.
//   • Different domains need different slot schemas (prompt vs
//     recipe vs routine). Hardcoding them in every downstream widget
//     would mean adding widget code to ship every new domain.
//     Taxonomy-as-data = the widget is domain-agnostic forever.
//   • Confidence-gated: when the inferrer can't decide, it falls
//     back to `GENERIC_TAXONOMY`. Widgets still render.
//
// Runtime contract:
//   • Soft-fail: a failed call returns the generic taxonomy so
//     downstream agents never block on this.
//   • Token budget: 1200 max — this is a small classification call.
//   • Temperature: 0.25 — we want stable taxonomies across retries
//     on the same input so the user doesn't see the slots rearrange.

import { llmJSON } from "@/lib/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GENERIC_TAXONOMY,
  PROMPT_TAXONOMY_SLOTS,
  PROMPT_STATUS_VOCAB,
  PROMPT_OUTCOME_AXES,
  type TaxonomySlot,
  type TaxonomyStatus,
  type TaxonomyOutcomeAxis,
} from "@/types/experiment-taxonomy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface DomainInferenceInput {
  /** The user's raw input text — the primary signal. */
  inputText: string;
  /** Optional scope/space name for extra context. */
  spaceName?: string;
  /** Optional top-3 entity names from the structurer so the
   *  inferrer sees what the decomposer already identified. */
  topEntityNames?: string[];
}

export interface DomainInferenceResult {
  domain_key: string;
  artifact_noun: string;
  variant_noun: string;
  situation_noun: string;
  slots: TaxonomySlot[];
  status_vocabulary: TaxonomyStatus[];
  outcome_axes: TaxonomyOutcomeAxis[];
  confidence: number;
}

// ── Fast keyword pre-classifier ─────────────────────────────────────
//
// Before paying for an LLM call, check the input against strong
// domain signals. When the keyword hit is obvious ("prompt",
// "recipe", "routine") we can skip inference and use the seeded
// taxonomy directly. Raises confidence to 0.95 and saves 1200
// tokens + 2-3s per run.

interface DomainSignature {
  domain_key: string;
  artifact_noun: string;
  variant_noun: string;
  situation_noun: string;
  slots: TaxonomySlot[];
  status_vocabulary: TaxonomyStatus[];
  outcome_axes: TaxonomyOutcomeAxis[];
  /** Regexes — any match anchors this domain. */
  signals: RegExp[];
}

const DOMAIN_LIBRARY: DomainSignature[] = [
  {
    domain_key: "prompt",
    artifact_noun: "prompt",
    variant_noun: "variant",
    situation_noun: "situation",
    slots: PROMPT_TAXONOMY_SLOTS,
    status_vocabulary: PROMPT_STATUS_VOCAB,
    outcome_axes: PROMPT_OUTCOME_AXES,
    signals: [
      /\bprompt\b/i,
      /\bsystem message\b/i,
      /\bLLM\b/,
      /\bchatbot\b/i,
      /\bdecomposition prompt\b/i,
      /\bprompt engineering\b/i,
    ],
  },
  {
    domain_key: "recipe",
    artifact_noun: "recipe",
    variant_noun: "version",
    situation_noun: "occasion",
    slots: [
      { id: "ingredients", label: "Ingredients", color: "#1a7aff", ordering: 0,
        description: "The components — what goes in." },
      { id: "method",      label: "Method",      color: "#0a6aee", ordering: 1,
        description: "Preparation + cooking steps." },
      { id: "equipment",   label: "Equipment",   color: "#8a56cc", ordering: 2,
        description: "Pans, timers, tools required." },
      { id: "timing",      label: "Timing",      color: "#f5a623", ordering: 3,
        description: "Prep + cook durations, ordering." },
      { id: "tasting",     label: "Tasting",     color: "#10b981", ordering: 4,
        description: "Judgement criteria — salt, seasoning, doneness." },
    ],
    status_vocabulary: [
      { key: "WINNER",    label: "Winner",    accent: "#10b981", role: "primary"   },
      { key: "DRAFT",     label: "Draft",     accent: "#f5a623", role: "secondary" },
      { key: "SHELVED",   label: "Shelved",   accent: "#7a8698", role: "archived"  },
    ],
    outcome_axes: [
      { key: "taste",     label: "Taste",  format: "ratio",   higher_is_better: true  },
      { key: "cost",      label: "Cost",   unit: "$", format: "currency", higher_is_better: false },
      { key: "time",      label: "Time",   unit: "min", format: "duration", higher_is_better: false },
    ],
    signals: [
      /\brecipe\b/i,
      /\bdish\b/i,
      /\bingredient(s)?\b/i,
      /\bkitchen\b/i,
      /\bcook(ing)?\b/i,
      /\bbaking\b/i,
    ],
  },
  {
    domain_key: "routine",
    artifact_noun: "routine",
    variant_noun: "version",
    situation_noun: "context",
    slots: [
      { id: "trigger",   label: "Trigger",   color: "#1a7aff", ordering: 0,
        description: "The cue that starts the routine." },
      { id: "actions",   label: "Actions",   color: "#0a6aee", ordering: 1,
        description: "The sequence of behaviors performed." },
      { id: "duration",  label: "Duration",  color: "#8a56cc", ordering: 2,
        description: "How long each session runs." },
      { id: "measure",   label: "Measure",   color: "#f5a623", ordering: 3,
        description: "Tracking signal — what proves it worked." },
      { id: "adjustment",label: "Adjustment",color: "#10b981", ordering: 4,
        description: "How the routine is tuned between sessions." },
    ],
    status_vocabulary: [
      { key: "CHAMPION",  label: "Champion",  accent: "#10b981", role: "primary"   },
      { key: "CANDIDATE", label: "Candidate", accent: "#f5a623", role: "secondary" },
      { key: "ARCHIVED",  label: "Archived",  accent: "#7a8698", role: "archived"  },
    ],
    outcome_axes: [
      { key: "adherence", label: "Adherence", unit: "%", format: "percent", higher_is_better: true  },
      { key: "lift",      label: "Lift",       unit: "%", format: "percent", higher_is_better: true  },
      { key: "effort",    label: "Effort",     format: "ratio",               higher_is_better: false },
    ],
    signals: [
      /\broutine\b/i,
      /\bhabit\b/i,
      /\bdaily\s+practice\b/i,
      /\bmorning\s+routine\b/i,
      /\bworkout\b/i,
      /\bexercise\b/i,
    ],
  },
];

function keywordMatch(inputText: string): DomainSignature | null {
  for (const entry of DOMAIN_LIBRARY) {
    if (entry.signals.some((r) => r.test(inputText))) {
      return entry;
    }
  }
  return null;
}

// ── LLM-backed fallback ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a domain-inference engine for an experiment platform. Given a user's situation, you infer how an experimenter would decompose it into independent variables (IVs).

Your output seeds a UI that lets the user:
1) see their situation broken into 4-6 named SLOTS (the IVs that can be varied),
2) see multiple VARIANTS (configurations of those slots) scored across OUTCOME AXES,
3) see lifecycle STATUSES variants pass through.

Rules:
- 4-6 slots, each a concrete manipulable variable. NOT vague ("quality", "success"). YES specific ("role", "constraint", "ingredients", "trigger").
- Slots should be ORTHOGONAL — varying one shouldn't force varying another.
- 3-4 statuses forming a simple lifecycle: one "winning", one "candidate/draft", one "archived". A second "winning" state ("deployed"/"in production") is optional.
- 3 outcome axes. At least one "higher-is-better" AND one "lower-is-better" (costs/tokens/time).
- domain_key: short snake_case noun. Prefer known keys: "prompt", "recipe", "routine", "workout", "negotiation", "pitch", "plan", "script". Use "generic" only when nothing else fits.
- artifact_noun, variant_noun, situation_noun: singular nouns used in UI labels.
- confidence: 0..1 self-assessed.

Return ONLY valid JSON matching this schema:
{
  "domain_key": string,
  "artifact_noun": string,
  "variant_noun": string,
  "situation_noun": string,
  "slots": [
    { "id": string (snake_case), "label": string (Title Case), "color": string (hex), "description": string (<=80 chars), "ordering": number }
  ],
  "status_vocabulary": [
    { "key": string (UPPER_CASE), "label": string, "accent": string (hex), "role": "primary"|"secondary"|"archived" }
  ],
  "outcome_axes": [
    { "key": string (snake_case), "label": string, "unit": string|null, "format": "percent"|"count"|"currency"|"ratio"|"duration", "higher_is_better": boolean }
  ],
  "confidence": number
}`;

function buildUserPrompt(input: DomainInferenceInput): string {
  const entities = input.topEntityNames && input.topEntityNames.length > 0
    ? `\nTOP ENTITIES THE STRUCTURER ALREADY IDENTIFIED:\n${input.topEntityNames.slice(0, 6).map((e) => `- ${e}`).join("\n")}`
    : "";
  const scope = input.spaceName ? `\nSPACE NAME: ${input.spaceName}` : "";
  return `USER INPUT:
${input.inputText.slice(0, 2400)}
${scope}${entities}

Infer the experiment taxonomy for this situation.`;
}

function validateResult(raw: unknown): DomainInferenceResult {
  if (!raw || typeof raw !== "object") throw new Error("not an object");
  const r = raw as Record<string, unknown>;
  const slots = Array.isArray(r.slots) ? r.slots : [];
  const statuses = Array.isArray(r.status_vocabulary) ? r.status_vocabulary : [];
  const axes = Array.isArray(r.outcome_axes) ? r.outcome_axes : [];
  if (slots.length < 3) throw new Error("slots < 3");
  if (statuses.length < 2) throw new Error("status_vocabulary < 2");
  if (axes.length < 2) throw new Error("outcome_axes < 2");
  return {
    domain_key: typeof r.domain_key === "string" ? r.domain_key : "generic",
    artifact_noun: typeof r.artifact_noun === "string" ? r.artifact_noun : "artifact",
    variant_noun: typeof r.variant_noun === "string" ? r.variant_noun : "variant",
    situation_noun: typeof r.situation_noun === "string" ? r.situation_noun : "situation",
    slots: slots as TaxonomySlot[],
    status_vocabulary: statuses as TaxonomyStatus[],
    outcome_axes: axes as TaxonomyOutcomeAxis[],
    confidence: typeof r.confidence === "number" ? r.confidence : 0.6,
  };
}

/**
 * Main entry. Keyword-first, LLM-fallback, generic-last.
 *
 * Always resolves; never throws. The worst case returns the generic
 * taxonomy with confidence 0 so downstream wiring still works.
 */
export async function inferExperimentTaxonomy(
  input: DomainInferenceInput,
): Promise<DomainInferenceResult> {
  // 1) Fast keyword hit — skip the LLM call entirely.
  const kw = keywordMatch(input.inputText);
  if (kw) {
    return {
      domain_key: kw.domain_key,
      artifact_noun: kw.artifact_noun,
      variant_noun: kw.variant_noun,
      situation_noun: kw.situation_noun,
      slots: kw.slots,
      status_vocabulary: kw.status_vocabulary,
      outcome_axes: kw.outcome_axes,
      confidence: 0.95,
    };
  }

  // 2) LLM inference — soft-fail on any error.
  try {
    const result = await llmJSON<DomainInferenceResult>({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
      maxTokens: 1200,
      temperature: 0.25,
      validator: validateResult,
      fallback: genericFallback(),
    });
    return result;
  } catch (err) {
    console.warn("[domain-inferrer] LLM fallback failed:", err);
    return genericFallback();
  }
}

function genericFallback(): DomainInferenceResult {
  return {
    domain_key: GENERIC_TAXONOMY.domain_key,
    artifact_noun: GENERIC_TAXONOMY.artifact_noun,
    variant_noun: GENERIC_TAXONOMY.variant_noun,
    situation_noun: GENERIC_TAXONOMY.situation_noun,
    slots: GENERIC_TAXONOMY.slots,
    status_vocabulary: GENERIC_TAXONOMY.status_vocabulary,
    outcome_axes: GENERIC_TAXONOMY.outcome_axes,
    confidence: 0,
  };
}

/**
 * Persist an inferred taxonomy to the DB.
 *
 * One row per space (unique constraint on space_id). Re-running
 * intake on the same space UPSERTs the row so the user never sees
 * duplicate taxonomy cards on the canvas.
 *
 * Returns the persisted row id on success, null on soft-fail. The
 * caller passes that id through as `taxonomyId` on the emitted
 * TaxonomyInferredEvent so the painter can correlate.
 */
export async function persistTaxonomy(
  db: AnyDb,
  spaceId: string,
  result: DomainInferenceResult,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("experiment_taxonomies")
      .upsert(
        {
          space_id: spaceId,
          domain_key: result.domain_key,
          artifact_noun: result.artifact_noun,
          variant_noun: result.variant_noun,
          situation_noun: result.situation_noun,
          slots: result.slots,
          status_vocabulary: result.status_vocabulary,
          outcome_axes: result.outcome_axes,
          inferred_by: "domain_inferrer_v1",
          inference_confidence: result.confidence,
          inferred_at: new Date().toISOString(),
        },
        { onConflict: "space_id" },
      )
      .select("id")
      .single();
    if (error) {
      console.warn("[domain-inferrer] persist failed:", error);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn("[domain-inferrer] persist threw:", err);
    return null;
  }
}
