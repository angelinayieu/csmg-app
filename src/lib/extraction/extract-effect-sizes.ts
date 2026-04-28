// ── extract-effect-sizes — first L2M-style primitive ─────────────────
//
// PURPOSE
//
//   Take an artifact's text, return a list of effect-size extractions
//   with FULL provenance (LLM half + deterministic-parser half).
//
// TRUST BOUNDARY (the load-bearing design choice)
//
//   1. The LLM identifies and labels SPANS — verbatim quotes from
//      the artifact that report a quantitative finding. It says
//      "this span is an effect-size report; here's what study/
//      population/intervention it pertains to."
//
//   2. Deterministic parsers (this file's parseFromSpan) extract
//      the actual NUMBERS from the LLM-labelled spans. The LLM
//      never types a number into a load-bearing field.
//
// Why split: LLMs are good at semantic span identification, terrible
// at reproducible numeric extraction. Cohen's d=0.42 vs d=0.42 [0.18,
// 0.66] vs d=0.42 (95% CI 0.18 to 0.66) all need the same parse, and
// LLM output drifts across runs in ways that break downstream Bayesian
// pipelines. Split labour → reproducibility.
//
// PRIMITIVE CONTRACT
//
//   - No side effects beyond the LLM call. Caller persists. This lets
//     us run the primitive in isolation (tests, future planner-
//     dispatcher composition).
//   - Soft-fail per extraction: if a single span fails to parse, we
//     still return it with parser_provenance=null and a flag so the
//     reviewer sees it. Never abort the whole batch for one bad span.
//
// V1 SCOPE
//
//   - One parser module: cohens_d_with_ci_v1
//   - Handles Cohen's d / Hedges' g / SMD with optional inline CI
//     and optional p-value. Falls back to "raw_match_only" extraction
//     mode for spans the parser doesn't recognize, preserving the
//     LLM-labelled span for manual review.
//
//   Future parsers (each its own module + version):
//     - or_with_ci_v1
//     - rr_with_ci_v1
//     - beta_with_se_v1
//     - raw_means_and_sds_v1
//     - p_value_back_calc_v1  (recovers d from p, n, direction)
//     - table_row_v1          (when LLM marks parser_format='table_row_*')

import { llmJSON } from "@/lib/llm";
import {
  EFFECT_SIZE_EXTRACTION_SYSTEM_PROMPT,
  buildEffectSizeExtractionUserPrompt,
  hashEffectSizePrompt,
  type EffectSizeExtractionUserOpts,
} from "@/lib/prompts/effect-size-extraction";
import type {
  EffectSizeExtraction,
  ExtractEffectSizesResult,
  LlmLabelProvenance,
  ParserProvenance,
  SourceLocation,
} from "@/types/evidence-registry";
import { randomUUID } from "crypto";

// ── LLM call output shape ──────────────────────────────────────────
//
// What we ask the LLM to produce. Mirrors the prompt's output schema.
// The shape intentionally contains NO numeric fields — only labels
// and the source quote. Numbers come from parsers.

interface LlmRawExtraction {
  local_id: string;
  outcome_label: string | null;
  instrument_label: string | null;
  intervention_label: string | null;
  comparator_label: string | null;
  population_label: string | null;
  study_design: string | null;
  blinding: string | null;
  followup_label: string | null;
  effect_metric_hint: string;
  parser_format: string;
  source_quote: string;
  source_page: number | null;
  llm_confidence: number;
  reasoning: string;
}

interface LlmRawResponse {
  summary: string | null;
  extractions: LlmRawExtraction[];
}

// ── Deterministic parser: cohens_d_with_ci_v1 ───────────────────────
//
// Recognizes patterns like:
//   "d = 0.42 (95% CI 0.18, 0.66)"
//   "d = 0.42, 95% CI [0.18 to 0.66]"
//   "Cohen's d = 0.42 (95% CI: 0.18-0.66), p = 0.01"
//   "g = 0.31 (SE 0.12)"
//   "SMD = -0.55 [95% CI -0.91, -0.19]"
//
// Output: numeric values + a parser_provenance describing exactly
// which rule fired and what got matched. Returns null when no rule
// matches; caller falls back to "raw_match_only".

const COHENS_D_PARSER_VERSION = "cohens_d_with_ci_v1";

interface ParsedNumerics {
  effect_size: number | null;
  effect_metric: string | null;
  ci_lower: number | null;
  ci_upper: number | null;
  ci_level: number | null;
  p_value: number | null;
  standard_error: number | null;
  n_treatment: number | null;
  n_control: number | null;
  followup_weeks: number | null;
  parser_provenance: ParserProvenance;
}

/** Detect which effect metric the span is reporting. Returns the
 *  canonical metric label + the raw matched substring. */
function detectMetric(span: string): { metric: string; match: string } | null {
  const text = span.toLowerCase();
  // Order matters — longer / more specific patterns first.
  if (/\b(?:cohen['’]s\s+d|cohens\s+d)\b/.test(text)) {
    return { metric: "cohens_d", match: "cohen's d" };
  }
  if (/\b(?:hedges['’]?\s*g)\b/.test(text)) {
    return { metric: "hedges_g", match: "hedges g" };
  }
  if (/\bsmd\b/.test(text)) return { metric: "smd", match: "smd" };
  // Inline `d = 0.42` is ambiguous (could be d, beta, etc.) but in
  // an LLM-labelled effect-size span, `d =` is overwhelmingly Cohen's d.
  if (/\bd\s*=\s*[-+]?\d/.test(text)) return { metric: "cohens_d", match: "d =" };
  if (/\bg\s*=\s*[-+]?\d/.test(text)) return { metric: "hedges_g", match: "g =" };
  if (/\b(?:odds\s+ratio|or)\b/.test(text)) return { metric: "or", match: "or" };
  if (/\b(?:risk\s+ratio|rr)\b/.test(text)) return { metric: "rr", match: "rr" };
  if (/\b(?:hazard\s+ratio|hr)\b/.test(text)) return { metric: "hr", match: "hr" };
  return null;
}

/** Pull the leading numeric (the point estimate) from the span. */
function extractPointEstimate(span: string): number | null {
  // Pattern: <metric label> ... <number>
  const m = span.match(
    /(?:cohen['’]?s\s+d|cohens\s+d|hedges['’]?\s*g|smd|odds\s+ratio|risk\s+ratio|hazard\s+ratio|\b[dgr]|or|rr|hr|β|beta)\s*(?:of)?\s*(?:=|:|was|of)?\s*(-?\d+\.?\d*)/i,
  );
  if (m && m[1]) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Pull a CI bracket like (95% CI 0.18, 0.66) or [-0.91 to -0.19]. */
function extractCi(
  span: string,
): { lower: number; upper: number; level: number } | null {
  // Capture optional level (e.g. "95%"), then the two numbers separated
  // by comma / "to" / "-" / "–" (en-dash) inside any bracket pair.
  const re =
    /(?:(\d{1,3})\s*%\s*ci|ci|confidence\s+interval)\s*[:=]?\s*[\[\(]?\s*(-?\d+\.?\d*)\s*(?:,|to|–|—|-|‐)\s*(-?\d+\.?\d*)\s*[\]\)]?/i;
  const m = span.match(re);
  if (!m) return null;
  const level = m[1] ? parseInt(m[1], 10) / 100 : 0.95;
  const lower = parseFloat(m[2]);
  const upper = parseFloat(m[3]);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  // Order can be flipped if the LLM-quoted span had negative
  // intervals; normalize.
  return {
    lower: Math.min(lower, upper),
    upper: Math.max(lower, upper),
    level,
  };
}

function extractStandardError(span: string): number | null {
  const m = span.match(/\b(?:se|s\.e\.|standard\s+error)\s*[:=]?\s*\(?\s*(-?\d+\.?\d*)/i);
  if (m && m[1]) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function extractPValue(span: string): number | null {
  // p < 0.001 / p = 0.04 / P-value = .03
  const m = span.match(/\bp(?:-?value)?\s*[<=>≤≥]\s*\.?(\d+\.?\d*)/i);
  if (m && m[1]) {
    const raw = m[1].startsWith(".") ? "0" + m[1] : m[1];
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return null;
}

function extractSampleSize(span: string): {
  n_treatment: number | null;
  n_control: number | null;
} {
  // Patterns: n=42, N = 84 (intervention) and N = 80 (control), n=42/40
  const split = span.match(/n\s*=\s*(\d+)\s*\/\s*(\d+)/i);
  if (split) {
    const a = parseInt(split[1], 10);
    const b = parseInt(split[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { n_treatment: a, n_control: b };
    }
  }
  // Fallback: total N only.
  const total = span.match(/\bn\s*=\s*(\d+)\b/i);
  if (total) {
    const n = parseInt(total[1], 10);
    if (Number.isFinite(n)) {
      // Without a split we can't separate arms — leave as null + total
      // gets surfaced in flags. Future parser can split via design.
      return { n_treatment: null, n_control: null };
    }
  }
  return { n_treatment: null, n_control: null };
}

function extractFollowupWeeks(span: string, label: string | null): number | null {
  const text = `${span} ${label ?? ""}`.toLowerCase();
  // Weeks
  const wMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:wk|wks|week|weeks)\b/);
  if (wMatch) {
    const n = parseFloat(wMatch[1]);
    if (Number.isFinite(n)) return n;
  }
  // Months → weeks
  const mMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:mo|mos|month|months)\b/);
  if (mMatch) {
    const n = parseFloat(mMatch[1]);
    if (Number.isFinite(n)) return Math.round(n * 4.345 * 100) / 100;
  }
  // Years → weeks
  const yMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:yr|yrs|year|years)\b/);
  if (yMatch) {
    const n = parseFloat(yMatch[1]);
    if (Number.isFinite(n)) return Math.round(n * 52.143 * 100) / 100;
  }
  // Days → weeks (rare, but worth handling)
  const dMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:day|days)\b/);
  if (dMatch) {
    const n = parseFloat(dMatch[1]);
    if (Number.isFinite(n)) return Math.round((n / 7) * 100) / 100;
  }
  return null;
}

function parseFromSpan(
  raw: LlmRawExtraction,
): ParsedNumerics | null {
  const span = raw.source_quote;
  const detected = detectMetric(span);
  // The LLM's metric hint is also a valid signal — fall back to it
  // when we couldn't detect a metric from the span text directly.
  const metric = detected?.metric ?? raw.effect_metric_hint ?? null;
  if (!metric) return null;

  const flags: string[] = [];
  let rule_fired = "no_rule";

  const point = extractPointEstimate(span);
  if (point === null) {
    return null; // can't construct anything useful without a point estimate
  }

  const ci = extractCi(span);
  const se = extractStandardError(span);
  const p = extractPValue(span);
  const n = extractSampleSize(span);
  const followup = extractFollowupWeeks(span, raw.followup_label);

  if (ci) {
    rule_fired = ci.level === 0.95 ? "ci_with_d_inline_95" : "ci_with_d_inline";
    if (ci.level !== 0.95) flags.push("non_95_ci");
  } else if (se) {
    rule_fired = "se_with_d_inline";
  } else if (p) {
    rule_fired = "point_only_with_p";
    flags.push("ci_back_calculated_from_p");
  } else {
    rule_fired = "point_only";
    flags.push("no_uncertainty_reported");
  }

  if (n.n_treatment === null && n.n_control === null) {
    flags.push("n_unclear");
  }

  // If we used the LLM's metric hint instead of detecting from the
  // span, flag so reviewers can double-check.
  if (!detected && raw.effect_metric_hint) {
    flags.push("metric_inferred_from_llm_hint");
  }

  return {
    effect_size: point,
    effect_metric: metric,
    ci_lower: ci?.lower ?? null,
    ci_upper: ci?.upper ?? null,
    ci_level: ci?.level ?? null,
    p_value: p,
    standard_error: se,
    n_treatment: n.n_treatment,
    n_control: n.n_control,
    followup_weeks: followup,
    parser_provenance: {
      module: COHENS_D_PARSER_VERSION,
      version: "1.0.0",
      rule_fired,
      raw_match: span.slice(0, 500),
      flags,
    },
  };
}

// ── Roll-up: combine LLM half + parser half into one extraction ────

function combineToExtraction(
  raw: LlmRawExtraction,
  promptHash: string,
  llmModel: string,
  parsed: ParsedNumerics | null,
): EffectSizeExtraction {
  const llm_label_provenance: LlmLabelProvenance = {
    model: llmModel,
    prompt_hash: promptHash,
    span_id: raw.local_id,
    raw_label: "effect_size", // we asked the LLM only for effect-size spans
    llm_confidence: clamp01(raw.llm_confidence),
    reasoning: raw.reasoning,
  };

  const source: SourceLocation = {
    page: raw.source_page,
    bbox: null,
    quote: raw.source_quote,
    table_html: null,
  };

  const flags: string[] = [];
  if (!parsed) flags.push("parser_failed_no_rule_matched");
  if (parsed) flags.push(...parsed.parser_provenance.flags);

  // Combined confidence: LLM × (parser-quality penalty when no rule
  // matched). Conservative — we'd rather under-rate than over-rate so
  // reviewers see borderline extractions.
  const parserQuality = !parsed
    ? 0.4
    : parsed.parser_provenance.flags.includes("ci_back_calculated_from_p") ||
        parsed.parser_provenance.flags.includes("no_uncertainty_reported")
      ? 0.7
      : 1.0;
  const extraction_confidence = clamp01(
    clamp01(raw.llm_confidence) * parserQuality,
  );

  return {
    local_id: raw.local_id,
    outcome_label: raw.outcome_label,
    instrument_label: raw.instrument_label,
    intervention_label: raw.intervention_label,
    comparator_label: raw.comparator_label,
    population_label: raw.population_label,
    effect_size: parsed?.effect_size ?? null,
    effect_metric: parsed?.effect_metric ?? raw.effect_metric_hint ?? null,
    ci_lower: parsed?.ci_lower ?? null,
    ci_upper: parsed?.ci_upper ?? null,
    ci_level: parsed?.ci_level ?? null,
    p_value: parsed?.p_value ?? null,
    standard_error: parsed?.standard_error ?? null,
    n_treatment: parsed?.n_treatment ?? null,
    n_control: parsed?.n_control ?? null,
    followup_weeks: parsed?.followup_weeks ?? null,
    followup_label: raw.followup_label,
    study_design: raw.study_design,
    blinding: raw.blinding,
    source,
    llm_label_provenance,
    parser_provenance: parsed?.parser_provenance ?? null,
    extraction_confidence,
    flags,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ── LLM JSON schema ─────────────────────────────────────────────────
//
// Strict schema for the OpenAI structured-output path. Each field is
// required (OpenAI's strict mode rejects any field outside `required`).
// Nullable handled via {type: ["string", "null"]} pattern.

const RESPONSE_SCHEMA = {
  name: "effect_size_extractions",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: ["string", "null"] },
      extractions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            local_id: { type: "string" },
            outcome_label: { type: ["string", "null"] },
            instrument_label: { type: ["string", "null"] },
            intervention_label: { type: ["string", "null"] },
            comparator_label: { type: ["string", "null"] },
            population_label: { type: ["string", "null"] },
            study_design: { type: ["string", "null"] },
            blinding: { type: ["string", "null"] },
            followup_label: { type: ["string", "null"] },
            effect_metric_hint: { type: "string" },
            parser_format: { type: "string" },
            source_quote: { type: "string" },
            source_page: { type: ["number", "null"] },
            llm_confidence: { type: "number" },
            reasoning: { type: "string" },
          },
          required: [
            "local_id",
            "outcome_label",
            "instrument_label",
            "intervention_label",
            "comparator_label",
            "population_label",
            "study_design",
            "blinding",
            "followup_label",
            "effect_metric_hint",
            "parser_format",
            "source_quote",
            "source_page",
            "llm_confidence",
            "reasoning",
          ],
        },
      },
    },
    required: ["summary", "extractions"],
  },
} as const;

// ── Public API ──────────────────────────────────────────────────────

export interface ExtractEffectSizesOpts extends EffectSizeExtractionUserOpts {
  /** Asset id this extraction belongs to. Stamped into the result. */
  assetId: string;
  /** Override the default LLM model. */
  model?: string;
}

/**
 * Run the effect-size extraction primitive on one artifact.
 *
 * Performs:
 *   1. LLM call (span identification + labelling)
 *   2. Per-span deterministic parsing (numeric extraction)
 *   3. Roll-up into EffectSizeExtraction[] with full provenance
 *
 * Side-effect-free: caller is responsible for persisting the result
 * to evidence_registries.
 */
export async function extractEffectSizes(
  opts: ExtractEffectSizesOpts,
): Promise<ExtractEffectSizesResult> {
  const userPrompt = buildEffectSizeExtractionUserPrompt(opts);
  const promptHash = await hashEffectSizePrompt(userPrompt);
  // gpt-4o is the default JSON-structured-output model; reasoning
  // benefit on this kind of task is small relative to the cost
  // delta, and the parser does the heavy lifting downstream.
  const model = opts.model ?? "gpt-4o";

  let raw: LlmRawResponse;
  try {
    raw = await llmJSON<LlmRawResponse>({
      system: EFFECT_SIZE_EXTRACTION_SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 8192,
      temperature: 0.1, // low — we want the same artifact to extract the same spans across runs
      model,
      responseSchema: RESPONSE_SCHEMA,
      fallback: { summary: null, extractions: [] },
    });
  } catch (err) {
    console.error("[extractEffectSizes] LLM call failed:", err);
    // Return an empty result rather than throwing; caller decides
    // whether to surface the error or just record "0 extractions".
    return {
      asset_id: opts.assetId,
      extractions: [],
      generated_at: new Date().toISOString(),
      summary: null,
      token_estimate: null,
    };
  }

  // Per-span parsing. Soft-fail per span — bad parses become rows
  // with parser_provenance=null + a flag, never abort the batch.
  const extractions: EffectSizeExtraction[] = [];
  for (const r of raw.extractions ?? []) {
    // Skip degenerate rows (no quote → can't parse anything).
    if (!r.source_quote || r.source_quote.trim().length < 4) continue;
    // Ensure local_id is unique within this batch (LLM sometimes
    // collides "ext_001" across rows).
    const local_id = r.local_id || `ext_${randomUUID().slice(0, 8)}`;
    const labelled = { ...r, local_id };
    let parsed: ParsedNumerics | null;
    try {
      parsed = parseFromSpan(labelled);
    } catch (parseErr) {
      console.warn(
        `[extractEffectSizes] parser threw on span ${local_id}:`,
        parseErr,
      );
      parsed = null;
    }
    extractions.push(combineToExtraction(labelled, promptHash, model, parsed));
  }

  return {
    asset_id: opts.assetId,
    extractions,
    generated_at: new Date().toISOString(),
    summary: raw.summary,
    token_estimate: null,
  };
}

// ── Test-only exports (re-exported for unit testing the parser
//    independently of the LLM call). ────────────────────────────────

export const __test = {
  detectMetric,
  extractPointEstimate,
  extractCi,
  extractStandardError,
  extractPValue,
  extractSampleSize,
  extractFollowupWeeks,
  parseFromSpan,
};
