// ── extract-temporal — temporal claim primitive ──────────────────────
//
// PURPOSE
//
//   Take an artifact's text, return a list of temporal-extraction rows
//   with FULL provenance (LLM half + deterministic-parser half).
//   Companion to extract-effect-sizes.ts; both write to
//   evidence_registries with the same trust discipline.
//
// TRUST BOUNDARY (the load-bearing design choice — same as effect-size)
//
//   1. The LLM identifies and labels SPANS — verbatim quotes that
//      report mechanism timing (onset, peak, persistence, decay,
//      trajectory). It says "this span is a peak-timing claim
//      pertaining to intervention X / outcome Y".
//
//   2. Deterministic parsers (this file's parseFromSpan) extract the
//      actual day/week numbers from the LLM-labelled spans. The LLM
//      never types a number into a load-bearing field.
//
// MECHANISM TIMING vs MEASUREMENT TIMING
//
//   The effect-size extractor already captures `followup_weeks` (when
//   the study LOOKED). The temporal extractor captures `onset_days`,
//   `peak_days`, `persistence_days` (when the body RESPONDS). They
//   live in different columns on evidence_registries and are
//   extracted by different prompts. A single artifact can yield both
//   kinds of rows.
//
// PRIMITIVE CONTRACT
//
//   - No side effects beyond the LLM call. Caller persists. Lets us
//     run the primitive in isolation (tests, future planner-
//     dispatcher composition).
//   - Soft-fail per extraction: if a single span fails to parse, we
//     still return it with parser_provenance=null and a flag so the
//     reviewer sees it. Never abort the whole batch for one bad span.
//
// V1 SCOPE
//
//   - Parser modules (one per parser_format hint):
//       * week_inline_v1
//       * month_inline_v1
//       * day_inline_v1
//       * half_life_v1
//       * trajectory_table_v1
//       * range_inline_v1
//       * qualitative_only_v1   (no number; sets a flag)
//   - Recognizes the seven LLM-labelled timing components: onset,
//     peak, persistence, decay_kinetics, trajectory.
//
//   Future parsers (each its own module + version):
//     - kaplan_meier_curve_v1   (parses survival/persistence curves)
//     - dose_response_time_v1   (interaction of dose × time)
//     - hysteresis_v1            (chronic vs acute timing differences)

import { llmJSON } from "@/lib/llm";
import {
  TEMPORAL_EXTRACTION_SYSTEM_PROMPT,
  buildTemporalExtractionUserPrompt,
  hashTemporalPrompt,
  type TemporalExtractionUserOpts,
} from "@/lib/prompts/temporal-extraction";
import type {
  DecayKinetics,
  ExtractTemporalResult,
  LlmLabelProvenance,
  ParserProvenance,
  SourceLocation,
  TemporalExtraction,
  TemporalExtractionMethod,
  TimePointObservation,
} from "@/types/evidence-registry";
import { randomUUID } from "crypto";

// ── LLM call output shape ──────────────────────────────────────────
//
// What we ask the LLM to produce. Mirrors the prompt's output schema.
// Intentionally contains NO numeric day/week fields — only labels and
// the source quote. Numbers come from parsers.

type TimingComponent =
  | "onset"
  | "peak"
  | "persistence"
  | "trajectory"
  | "decay_kinetics";

interface LlmRawTemporalExtraction {
  local_id: string;
  outcome_label: string | null;
  instrument_label: string | null;
  intervention_label: string | null;
  comparator_label: string | null;
  population_label: string | null;
  study_design: string | null;

  timing_component: string; // one of TimingComponent at runtime
  decay_shape: string | null; // one of DecayKinetics at runtime, only for decay/persistence
  parser_format: string;

  source_quote: string;
  source_page: number | null;

  timepoints_table_present: boolean;

  extraction_method: string; // one of TemporalExtractionMethod at runtime
  method_justification: string;

  llm_confidence: number;
  reasoning: string;
}

interface LlmRawResponse {
  summary: string | null;
  extractions: LlmRawTemporalExtraction[];
}

// ── Unit conversions ───────────────────────────────────────────────

const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30.437; // average Gregorian month length
const DAYS_PER_YEAR = 365.25;

/** Round to 2 decimal places. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convert a number + unit phrase to days. Unit recognized loosely
 *  ("d", "day", "days", "wk", "week", …). Returns null on no match. */
function toDays(value: number, unit: string): number | null {
  const u = unit.toLowerCase().trim();
  if (/^(?:d|day|days)$/.test(u)) return r2(value);
  if (/^(?:wk|wks|week|weeks)$/.test(u)) return r2(value * DAYS_PER_WEEK);
  if (/^(?:mo|mos|month|months)$/.test(u)) return r2(value * DAYS_PER_MONTH);
  if (/^(?:yr|yrs|year|years)$/.test(u)) return r2(value * DAYS_PER_YEAR);
  if (/^(?:hr|hrs|hour|hours)$/.test(u)) return r2(value / 24);
  return null;
}

// ── Generic numeric extractors ─────────────────────────────────────

/** Extract a single timing value + unit from a span. Returns days. */
function extractSingleDuration(span: string): {
  days: number;
  raw_match: string;
  unit: string;
  raw_value: number;
} | null {
  // Patterns like "week 6", "at week 6", "6 weeks", "6-week", "30 days",
  // "approximately 6 weeks", "~6 weeks".
  // Order: number-then-unit ("6 weeks") OR unit-then-number ("week 6").
  // Decimal allowed.
  const numFirst = span.match(
    /(?:approximately|approx\.?|about|~)?\s*(\d+(?:\.\d+)?)\s*[-–\s]?\s*(d|day|days|wk|wks|week|weeks|mo|mos|month|months|yr|yrs|year|years|hr|hrs|hour|hours)\b/i,
  );
  if (numFirst) {
    const value = parseFloat(numFirst[1]);
    const unit = numFirst[2];
    const days = toDays(value, unit);
    if (days !== null && Number.isFinite(days)) {
      return { days, raw_match: numFirst[0], unit, raw_value: value };
    }
  }
  const unitFirst = span.match(
    /\b(week|weeks|wk|month|months|mo|day|days|d|year|years|yr)\s+(\d+(?:\.\d+)?)\b/i,
  );
  if (unitFirst) {
    const value = parseFloat(unitFirst[2]);
    const unit = unitFirst[1];
    const days = toDays(value, unit);
    if (days !== null && Number.isFinite(days)) {
      return { days, raw_match: unitFirst[0], unit, raw_value: value };
    }
  }
  return null;
}

/** Extract a duration RANGE: "between weeks 4 and 8", "4-8 weeks",
 *  "from 2 to 6 weeks". Returns the lower/upper in days. */
function extractRange(span: string): {
  lower_days: number;
  upper_days: number;
  raw_match: string;
} | null {
  // Pattern: "<num> [unit?] (-|to|–|—|and) <num> <unit>"
  const m = span.match(
    /(\d+(?:\.\d+)?)\s*(?:[-–—]|to|and|through)\s*(\d+(?:\.\d+)?)\s*(d|day|days|wk|wks|week|weeks|mo|mos|month|months|yr|yrs|year|years)\b/i,
  );
  if (m) {
    const lower = parseFloat(m[1]);
    const upper = parseFloat(m[2]);
    const unit = m[3];
    const lowerDays = toDays(lower, unit);
    const upperDays = toDays(upper, unit);
    if (
      lowerDays !== null &&
      upperDays !== null &&
      Number.isFinite(lowerDays) &&
      Number.isFinite(upperDays)
    ) {
      return {
        lower_days: Math.min(lowerDays, upperDays),
        upper_days: Math.max(lowerDays, upperDays),
        raw_match: m[0],
      };
    }
  }
  return null;
}

/** Half-life pattern: "T½ = 30 days", "half-life of 30 days",
 *  "half life ≈ 30 d". */
function extractHalfLife(span: string): {
  days: number;
  raw_match: string;
} | null {
  // Match "half-life", "half life", "T½", "T1/2".
  const m = span.match(
    /(?:half[-\s]?life|t\s*½|t\s*1\s*\/\s*2)\s*(?:was|of|=|:|≈|~)?\s*(?:approximately\s+)?(\d+(?:\.\d+)?)\s*(d|day|days|wk|wks|week|weeks|mo|mos|month|months|yr|yrs|year|years|hr|hrs|hour|hours)\b/i,
  );
  if (m) {
    const value = parseFloat(m[1]);
    const unit = m[2];
    const days = toDays(value, unit);
    if (days !== null && Number.isFinite(days)) {
      return { days, raw_match: m[0] };
    }
  }
  return null;
}

/** Trajectory parser: extracts a series of {week, effect_size}
 *  observations from a quote that reports outcomes at multiple
 *  timepoints.
 *
 *  Recognized shapes:
 *    "at weeks 0, 4, 8, and 12 were 0, 0.21, 0.42, and 0.51"
 *    "Cohen's d at week 4 = 0.21, week 8 = 0.42, week 12 = 0.51"
 *
 *  Returns an empty array when no trajectory can be parsed (caller
 *  flags trajectory_parse_failed). */
function extractTrajectory(span: string): TimePointObservation[] {
  const out: TimePointObservation[] = [];

  // Shape A: parallel lists. "at weeks <list> were <list>"
  // We grab everything after "were" or ":" up to the next sentence.
  const parallel = span.match(
    /(?:at|over)\s+(?:weeks?|months?|days?)\s+([\d.,\s\-andtorthugh]+?)(?:were|=|:)\s+([\-\d.,\s]+)/i,
  );
  if (parallel) {
    const weeksRaw = parallel[1];
    const valuesRaw = parallel[2];
    const weeks = weeksRaw
      .split(/[,\s]+|and/i)
      .map((s) => s.trim())
      .filter((s) => /^\d+(?:\.\d+)?$/.test(s))
      .map((s) => parseFloat(s));
    const values = valuesRaw
      .split(/[,\s]+|and/i)
      .map((s) => s.trim())
      .filter((s) => /^-?\d+(?:\.\d+)?$/.test(s))
      .map((s) => parseFloat(s));
    if (weeks.length >= 2 && weeks.length === values.length) {
      for (let i = 0; i < weeks.length; i++) {
        out.push({
          week: r2(weeks[i]),
          effect_size: Number.isFinite(values[i]) ? values[i] : null,
          ci_lower: null,
          ci_upper: null,
          n_observed: null,
          source_quote: null,
        });
      }
      return out;
    }
  }

  // Shape B: "week 4 = 0.21, week 8 = 0.42, …"
  const re = /(?:weeks?|months?|days?)\s+(\d+(?:\.\d+)?)\s*[=:]\s*(-?\d+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(span)) !== null) {
    out.push({
      week: r2(parseFloat(match[1])),
      effect_size: parseFloat(match[2]),
      ci_lower: null,
      ci_upper: null,
      n_observed: null,
      source_quote: null,
    });
  }
  return out;
}

/** Back-calculate peak_days from a trajectory by picking the
 *  timepoint with the maximum effect_size (or minimum when negative
 *  is "better" — we use absolute magnitude). Returns null on empty
 *  or all-null. */
function peakFromTrajectory(points: TimePointObservation[]): number | null {
  let best: TimePointObservation | null = null;
  let bestMag = -Infinity;
  for (const p of points) {
    if (p.effect_size === null || !Number.isFinite(p.effect_size)) continue;
    const mag = Math.abs(p.effect_size);
    if (mag > bestMag) {
      bestMag = mag;
      best = p;
    }
  }
  if (!best) return null;
  return r2(best.week * DAYS_PER_WEEK);
}

// ── Parser dispatcher ──────────────────────────────────────────────

const TEMPORAL_PARSER_VERSION = "1.0.0";

/** Map a parser_format hint from the LLM to the rule that should fire.
 *  Falls back to "auto" — we'll try each rule until one matches. */
function pickRule(parser_format: string): string {
  const f = parser_format.toLowerCase();
  if (f.includes("trajectory")) return "trajectory_table_v1";
  if (f.includes("half_life") || f.includes("halflife")) return "half_life_v1";
  if (f.includes("range")) return "range_inline_v1";
  if (f.includes("week")) return "week_inline_v1";
  if (f.includes("month")) return "month_inline_v1";
  if (f.includes("day")) return "day_inline_v1";
  if (f.includes("qualitative")) return "qualitative_only_v1";
  return "auto";
}

interface ParsedTemporal {
  onset_days: number | null;
  onset_days_ci_lower: number | null;
  onset_days_ci_upper: number | null;
  peak_days: number | null;
  peak_days_ci_lower: number | null;
  peak_days_ci_upper: number | null;
  persistence_days: number | null;
  persistence_days_ci_lower: number | null;
  persistence_days_ci_upper: number | null;
  decay_kinetics: DecayKinetics | null;
  time_points: TimePointObservation[] | null;
  parser_provenance: ParserProvenance;
}

function emptyParsed(rule: string, raw_match: string, flags: string[]): ParsedTemporal {
  return {
    onset_days: null,
    onset_days_ci_lower: null,
    onset_days_ci_upper: null,
    peak_days: null,
    peak_days_ci_lower: null,
    peak_days_ci_upper: null,
    persistence_days: null,
    persistence_days_ci_lower: null,
    persistence_days_ci_upper: null,
    decay_kinetics: null,
    time_points: null,
    parser_provenance: {
      module: "temporal_parser",
      version: TEMPORAL_PARSER_VERSION,
      rule_fired: rule,
      raw_match,
      flags,
    },
  };
}

function asDecayKinetics(s: string | null): DecayKinetics | null {
  if (!s) return null;
  const v = s.toLowerCase().trim();
  if (
    v === "linear" ||
    v === "exponential" ||
    v === "sustained" ||
    v === "biphasic" ||
    v === "unknown"
  )
    return v;
  return null;
}

function asTimingComponent(s: string): TimingComponent | null {
  const v = s.toLowerCase().trim();
  if (
    v === "onset" ||
    v === "peak" ||
    v === "persistence" ||
    v === "trajectory" ||
    v === "decay_kinetics"
  )
    return v;
  return null;
}

function asExtractionMethod(s: string): TemporalExtractionMethod | null {
  const v = s.toLowerCase().trim();
  if (
    v === "stated_explicitly" ||
    v === "back_calculated" ||
    v === "inferred_from_design" ||
    v === "inferred_from_class"
  )
    return v;
  return null;
}

function parseFromSpan(raw: LlmRawTemporalExtraction): ParsedTemporal | null {
  const span = raw.source_quote;
  const component = asTimingComponent(raw.timing_component);
  if (!component) return null;

  const flags: string[] = [];
  const rule = pickRule(raw.parser_format);

  // ── Trajectory branch ──
  if (component === "trajectory" || raw.timepoints_table_present) {
    const points = extractTrajectory(span);
    if (points.length === 0) {
      flags.push("trajectory_parse_failed");
      return emptyParsed("trajectory_table_v1", span.slice(0, 500), flags);
    }
    // Back-calculate peak_days from the trajectory's argmax.
    const peak = peakFromTrajectory(points);
    if (peak !== null) {
      flags.push("peak_back_calculated_from_trajectory");
    }
    return {
      onset_days: null,
      onset_days_ci_lower: null,
      onset_days_ci_upper: null,
      peak_days: peak,
      peak_days_ci_lower: null,
      peak_days_ci_upper: null,
      persistence_days: null,
      persistence_days_ci_lower: null,
      persistence_days_ci_upper: null,
      decay_kinetics: null,
      time_points: points,
      parser_provenance: {
        module: "temporal_parser",
        version: TEMPORAL_PARSER_VERSION,
        rule_fired: "trajectory_table_v1",
        raw_match: span.slice(0, 500),
        flags,
      },
    };
  }

  // ── Decay-kinetics branch (half-life or qualitative shape) ──
  if (component === "decay_kinetics") {
    const halfLife = extractHalfLife(span);
    const decay = asDecayKinetics(raw.decay_shape);
    if (halfLife) {
      return {
        onset_days: null,
        onset_days_ci_lower: null,
        onset_days_ci_upper: null,
        peak_days: null,
        peak_days_ci_lower: null,
        peak_days_ci_upper: null,
        persistence_days: halfLife.days,
        persistence_days_ci_lower: null,
        persistence_days_ci_upper: null,
        decay_kinetics: decay ?? "exponential",
        time_points: null,
        parser_provenance: {
          module: "temporal_parser",
          version: TEMPORAL_PARSER_VERSION,
          rule_fired: "half_life_v1",
          raw_match: halfLife.raw_match,
          flags,
        },
      };
    }
    // Qualitative shape only — no number to parse.
    if (decay) {
      flags.push("qualitative_decay_only");
      return {
        onset_days: null,
        onset_days_ci_lower: null,
        onset_days_ci_upper: null,
        peak_days: null,
        peak_days_ci_lower: null,
        peak_days_ci_upper: null,
        persistence_days: null,
        persistence_days_ci_lower: null,
        persistence_days_ci_upper: null,
        decay_kinetics: decay,
        time_points: null,
        parser_provenance: {
          module: "temporal_parser",
          version: TEMPORAL_PARSER_VERSION,
          rule_fired: "qualitative_only_v1",
          raw_match: span.slice(0, 500),
          flags,
        },
      };
    }
    flags.push("decay_unparseable");
    return emptyParsed("qualitative_only_v1", span.slice(0, 500), flags);
  }

  // ── Onset / peak / persistence branches ──
  // Try range first, then single duration. Half-life is uncommon
  // here but possible (e.g. "persistence T½ = 14 days").
  const range = extractRange(span);
  const singleDur = extractSingleDuration(span);
  const halfLife = extractHalfLife(span);

  // Default null skeleton to fill component-specifically.
  const result: ParsedTemporal = emptyParsed(
    rule === "auto"
      ? range
        ? "range_inline_v1"
        : singleDur
          ? `${singleDur.unit.toLowerCase()}_inline_v1`.replace(/^(\w+)s?_/, (_, u) => `${u.replace(/s$/, "")}_`)
          : "no_rule"
      : rule,
    range?.raw_match ?? singleDur?.raw_match ?? span.slice(0, 500),
    flags,
  );

  if (range) {
    result.parser_provenance.rule_fired = "range_inline_v1";
    if (component === "onset") {
      result.onset_days = range.lower_days;
      result.onset_days_ci_lower = range.lower_days;
      result.onset_days_ci_upper = range.upper_days;
    } else if (component === "peak") {
      // For a peak range, the midpoint is the most defensible point
      // estimate; flag so reviewer can replace with a reported peak
      // if available.
      const mid = r2((range.lower_days + range.upper_days) / 2);
      result.peak_days = mid;
      result.peak_days_ci_lower = range.lower_days;
      result.peak_days_ci_upper = range.upper_days;
      flags.push("peak_midpoint_of_range");
    } else if (component === "persistence") {
      result.persistence_days = range.upper_days;
      result.persistence_days_ci_lower = range.lower_days;
      result.persistence_days_ci_upper = range.upper_days;
    }
  } else if (singleDur) {
    if (component === "onset") result.onset_days = singleDur.days;
    else if (component === "peak") result.peak_days = singleDur.days;
    else if (component === "persistence") {
      result.persistence_days = singleDur.days;
      result.decay_kinetics = asDecayKinetics(raw.decay_shape) ?? "sustained";
    }
  } else if (halfLife && component === "persistence") {
    result.persistence_days = halfLife.days;
    result.decay_kinetics = "exponential";
    result.parser_provenance.rule_fired = "half_life_v1";
    result.parser_provenance.raw_match = halfLife.raw_match;
  } else {
    flags.push("no_numeric_rule_matched");
    return result;
  }

  // Strict-mode flag: if the LLM said inferred_from_design, the
  // aggregator should know to filter this row out of strict pooling.
  const method = asExtractionMethod(raw.extraction_method);
  if (method === "inferred_from_design") flags.push("inferred_from_design");
  if (method === "back_calculated") flags.push("back_calculated_from_curve");

  return result;
}

// ── Roll-up: combine LLM half + parser half into one extraction ────

function combineToExtraction(
  raw: LlmRawTemporalExtraction,
  promptHash: string,
  llmModel: string,
  parsed: ParsedTemporal | null,
): TemporalExtraction {
  const llm_provenance: LlmLabelProvenance = {
    model: llmModel,
    prompt_hash: promptHash,
    span_id: raw.local_id,
    raw_label: raw.timing_component,
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

  // Conservative parser-quality penalty for low-rigor extraction
  // methods. Strict-mode aggregator filters on flags AND on the
  // method column, so this is just a UI badge signal.
  const method = asExtractionMethod(raw.extraction_method) ?? "stated_explicitly";
  const methodPenalty =
    method === "stated_explicitly"
      ? 1.0
      : method === "back_calculated"
        ? 0.85
        : method === "inferred_from_design"
          ? 0.6
          : 0.4; // inferred_from_class
  const parserQuality = !parsed
    ? 0.4
    : parsed.parser_provenance.flags.some(
          (f) =>
            f === "trajectory_parse_failed" ||
            f === "no_numeric_rule_matched" ||
            f === "decay_unparseable",
        )
      ? 0.5
      : 1.0;
  const extraction_confidence = clamp01(
    clamp01(raw.llm_confidence) * methodPenalty * parserQuality,
  );

  return {
    local_id: raw.local_id,
    outcome_label: raw.outcome_label,
    instrument_label: raw.instrument_label,
    intervention_label: raw.intervention_label,
    comparator_label: raw.comparator_label,
    population_label: raw.population_label,
    study_design: raw.study_design,

    onset_days: parsed?.onset_days ?? null,
    onset_days_ci_lower: parsed?.onset_days_ci_lower ?? null,
    onset_days_ci_upper: parsed?.onset_days_ci_upper ?? null,
    peak_days: parsed?.peak_days ?? null,
    peak_days_ci_lower: parsed?.peak_days_ci_lower ?? null,
    peak_days_ci_upper: parsed?.peak_days_ci_upper ?? null,
    persistence_days: parsed?.persistence_days ?? null,
    persistence_days_ci_lower: parsed?.persistence_days_ci_lower ?? null,
    persistence_days_ci_upper: parsed?.persistence_days_ci_upper ?? null,
    decay_kinetics: parsed?.decay_kinetics ?? null,
    time_points: parsed?.time_points ?? null,

    temporal_evidence_quote: raw.source_quote,
    temporal_extraction_method: method,

    source,
    llm_provenance,
    parser_provenance: parsed?.parser_provenance ?? null,
    extraction_confidence,
    flags,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ── LLM JSON schema ────────────────────────────────────────────────

const RESPONSE_SCHEMA = {
  name: "temporal_extractions",
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
            timing_component: { type: "string" },
            decay_shape: { type: ["string", "null"] },
            parser_format: { type: "string" },
            source_quote: { type: "string" },
            source_page: { type: ["number", "null"] },
            timepoints_table_present: { type: "boolean" },
            extraction_method: { type: "string" },
            method_justification: { type: "string" },
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
            "timing_component",
            "decay_shape",
            "parser_format",
            "source_quote",
            "source_page",
            "timepoints_table_present",
            "extraction_method",
            "method_justification",
            "llm_confidence",
            "reasoning",
          ],
        },
      },
    },
    required: ["summary", "extractions"],
  },
} as const;

// ── Public API ─────────────────────────────────────────────────────

export interface ExtractTemporalOpts extends TemporalExtractionUserOpts {
  /** Asset id this extraction belongs to. Stamped into the result. */
  assetId: string;
  /** Override the default LLM model. */
  model?: string;
}

/**
 * Run the temporal extraction primitive on one artifact.
 *
 * Performs:
 *   1. LLM call (span identification + timing-component labelling)
 *   2. Per-span deterministic parsing (numeric extraction → days)
 *   3. Roll-up into TemporalExtraction[] with full provenance
 *
 * Side-effect-free: caller is responsible for persisting the result
 * to evidence_registries.
 */
export async function extractTemporal(
  opts: ExtractTemporalOpts,
): Promise<ExtractTemporalResult> {
  const userPrompt = buildTemporalExtractionUserPrompt(opts);
  const promptHash = await hashTemporalPrompt(userPrompt);
  const model = opts.model ?? "gpt-4o";

  let raw: LlmRawResponse;
  try {
    raw = await llmJSON<LlmRawResponse>({
      system: TEMPORAL_EXTRACTION_SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 8192,
      // Low temperature: temporal claims are factual and we want the
      // same artifact to extract the same spans across runs.
      temperature: 0.1,
      model,
      responseSchema: RESPONSE_SCHEMA,
      fallback: { summary: null, extractions: [] },
    });
  } catch (err) {
    console.error("[extractTemporal] LLM call failed:", err);
    return {
      asset_id: opts.assetId,
      extractions: [],
      generated_at: new Date().toISOString(),
      summary: null,
      token_estimate: null,
    };
  }

  const extractions: TemporalExtraction[] = [];
  for (const r of raw.extractions ?? []) {
    if (!r.source_quote || r.source_quote.trim().length < 4) continue;
    const local_id = r.local_id || `temp_${randomUUID().slice(0, 8)}`;
    const labelled = { ...r, local_id };
    let parsed: ParsedTemporal | null;
    try {
      parsed = parseFromSpan(labelled);
    } catch (parseErr) {
      console.warn(
        `[extractTemporal] parser threw on span ${local_id}:`,
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

// ── Test-only exports ──────────────────────────────────────────────

export const __test = {
  toDays,
  extractSingleDuration,
  extractRange,
  extractHalfLife,
  extractTrajectory,
  peakFromTrajectory,
  parseFromSpan,
  pickRule,
};
