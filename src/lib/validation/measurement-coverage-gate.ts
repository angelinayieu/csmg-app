// ── Measurement Coverage Gate ────────────────────────────────────────
//
// D1 follow-up of docs/KG_DEPTH_CRITIQUE.md: promotes the per-entity
// measurement spec from a soft warning (the validator just `console.warn`s
// when a fundamental/critical quantifiable entity lacks a unit + scale)
// into a hard pre-synthesis gate.
//
// Rationale: D1's prompt + validator + sanitizer wires the spec through
// the pipeline, but if the LLM silently omits measurement metadata on
// most fundamental/critical entities, the system would still reach
// synthesis on a folk-vocabulary KG. The gate is the structural
// commitment that downstream stages can ASSUME measurement exists for
// every entity that's supposed to carry it — or that a bypass was
// explicit.
//
// Companion to `src/lib/situation-frame/layer-coverage-gate.ts` —
// same shape, same pass/fail/bypass conventions, called from the same
// synthesize route boundaries:
//
//   - PASS  — every fundamental/critical entity in a measurable
//             category (concrete | abstract | process) has a
//             non-null measurement_unit + measurement_scale, OR the
//             coverage ratio is above the configured threshold.
//
//   - FAIL  — too many fundamental/critical quantifiable entities
//             lack a measurement spec. Synthesis returns 409 with the
//             gap report; client may re-POST with
//             `bypassMeasurementGate: true`.
//
// Soft-fail edge: a space with ZERO fundamental/critical quantifiable
// entities (all entities are relational/epistemic, or all are merely
// "important" or "moderate") passes vacuously with reason
// "no_measurable_entities" — there's nothing to gate against. This
// preserves backward compatibility for spaces that legitimately don't
// need measurement (pure framing analyses, philosophical decompositions,
// etc.).
//
// Pure function. No I/O, no globals.

import type {
  MeasurableEntityCategory,
  MeasurementRequiredImportance,
} from "@/types/measurement";
import {
  MEASURABLE_ENTITY_CATEGORIES,
  MEASUREMENT_REQUIRED_IMPORTANCE,
  isMeasurableCategory,
  requiresMeasurement,
} from "@/types/measurement";

// ── Tunables ─────────────────────────────────────────────────────────

/**
 * Default minimum fraction of gated entities that must carry a
 * measurement spec for the gate to pass. 0.7 = "at least 70% of
 * fundamental/critical concrete/abstract/process entities must be
 * measured". Tunable per call site via input.threshold.
 */
export const DEFAULT_MEASUREMENT_COVERAGE_THRESHOLD = 0.7;

/**
 * Minimum gated-entity count for the gate to actually fire. Below this,
 * the sample size is too small for a ratio threshold to be meaningful
 * (a space with 1 fundamental entity would either be 100% covered or
 * 0% covered — neither is a useful gate signal). With < this many
 * gated entities, the gate falls back to "all-or-nothing" — every
 * gated entity must be measured.
 */
export const MIN_GATED_ENTITIES_FOR_RATIO_GATE = 4;

// ── Input / output shapes ────────────────────────────────────────────

/**
 * Subset of the entity row required to evaluate the gate. Typed loosely
 * so callers can pass their existing Entity[] without narrowing —
 * matches the layer-coverage-gate convention.
 */
export interface MeasurementGateEntity {
  entity_id?: string | null;
  name?: string | null;
  importance?: string | null;
  entity_category?: string | null;
  measurement_unit?: string | null;
  measurement_scale?: string | null;
  /** Optional fallback — if scale is missing but observability is set,
   *  we treat the entity as partially specified rather than missing. */
  measurement_observability?: string | null;
}

export interface MeasurementCoverageGateInput {
  entities: ReadonlyArray<MeasurementGateEntity>;
  /** Optional override for the default coverage threshold. */
  threshold?: number;
  /** Echoed in the report for telemetry; useful in multi-space rollups. */
  spaceId?: string;
}

export type MeasurementGapReason =
  /** Fundamental/critical entity in a measurable category has neither
   *  unit nor scale. The hard signal — completely unmeasured. */
  | "no_measurement_spec"
  /** Has unit but no scale (or vice versa) — half-spec. The validator
   *  drops half-specs to null, so this should be rare in practice;
   *  surfaces it for callers that pre-write to the columns directly. */
  | "partial_measurement_spec";

export interface MeasurementCoverageGap {
  entity_id: string;
  entity_name: string;
  importance: MeasurementRequiredImportance;
  entity_category: MeasurableEntityCategory;
  reason: MeasurementGapReason;
  has_unit: boolean;
  has_scale: boolean;
  has_observability_fallback: boolean;
}

export type MeasurementCoverageGateStatus =
  | "pass"
  | "fail"
  | "no_measurable_entities"
  | "below_min_sample";

export interface MeasurementCoverageGateReport {
  pass: boolean;
  status: MeasurementCoverageGateStatus;
  /** Per-entity gaps. Empty iff pass=true with status="pass" or
   *  "no_measurable_entities". */
  gaps: MeasurementCoverageGap[];
  /** Aggregate counts surfaced for UI rendering + telemetry. */
  stats: {
    /** Total entities seen (any importance / category). */
    total_entities: number;
    /** Entities the gate applies to: fundamental/critical AND
     *  category in {concrete, abstract, process}. */
    gated_count: number;
    /** Of `gated_count`, how many have non-null unit + scale. */
    measured_count: number;
    /** gated_count - measured_count. */
    missing_count: number;
    /** measured_count / gated_count, or 1.0 when gated_count=0. */
    coverage_ratio: number;
    /** The threshold actually applied (input.threshold ?? default). */
    threshold_applied: number;
  };
  /** Human-readable explanation; clients may forward to UI verbatim. */
  message: string;
  space_id?: string;
}

// ── Public entry ─────────────────────────────────────────────────────

export function checkMeasurementCoverageGate(
  input: MeasurementCoverageGateInput,
): MeasurementCoverageGateReport {
  const threshold =
    typeof input.threshold === "number" &&
    input.threshold >= 0 &&
    input.threshold <= 1
      ? input.threshold
      : DEFAULT_MEASUREMENT_COVERAGE_THRESHOLD;

  const total = input.entities.length;

  // Identify gated entities (the ones that SHOULD have a spec).
  const gated = input.entities.filter((e) =>
    requiresMeasurement(e.importance ?? null, e.entity_category ?? null),
  );

  // Degenerate: no entities the gate applies to. Pass vacuously.
  if (gated.length === 0) {
    return {
      pass: true,
      status: "no_measurable_entities",
      gaps: [],
      stats: {
        total_entities: total,
        gated_count: 0,
        measured_count: 0,
        missing_count: 0,
        coverage_ratio: 1,
        threshold_applied: threshold,
      },
      message:
        "No fundamental/critical entities in measurable categories — measurement gate not applicable.",
      space_id: input.spaceId,
    };
  }

  // Measure each gated entity; collect gaps for the unmeasured.
  const gaps: MeasurementCoverageGap[] = [];
  let measured = 0;

  for (const e of gated) {
    const hasUnit =
      typeof e.measurement_unit === "string" &&
      e.measurement_unit.trim().length > 0;
    const hasScale =
      typeof e.measurement_scale === "string" &&
      e.measurement_scale.trim().length > 0;
    const hasObs =
      typeof e.measurement_observability === "string" &&
      e.measurement_observability.trim().length > 0;

    if (hasUnit && hasScale) {
      measured += 1;
      continue;
    }

    const importance = e.importance as MeasurementRequiredImportance;
    const category = e.entity_category as MeasurableEntityCategory;

    gaps.push({
      entity_id: typeof e.entity_id === "string" ? e.entity_id : "",
      entity_name: typeof e.name === "string" ? e.name : "",
      importance,
      entity_category: category,
      reason:
        hasUnit || hasScale
          ? "partial_measurement_spec"
          : "no_measurement_spec",
      has_unit: hasUnit,
      has_scale: hasScale,
      has_observability_fallback: hasObs,
    });
  }

  const gatedCount = gated.length;
  const missing = gatedCount - measured;
  const coverage = gatedCount > 0 ? measured / gatedCount : 1;

  // Below-minimum-sample fallback: with too few gated entities the
  // ratio threshold is noisy, so we require all-or-nothing instead.
  if (gatedCount < MIN_GATED_ENTITIES_FOR_RATIO_GATE) {
    const pass = missing === 0;
    return {
      pass,
      status: pass ? "pass" : "below_min_sample",
      gaps,
      stats: {
        total_entities: total,
        gated_count: gatedCount,
        measured_count: measured,
        missing_count: missing,
        coverage_ratio: coverage,
        threshold_applied: threshold,
      },
      message: buildMessage(pass, "below_min_sample", gaps, coverage, threshold),
      space_id: input.spaceId,
    };
  }

  const pass = coverage >= threshold;
  return {
    pass,
    status: pass ? "pass" : "fail",
    gaps,
    stats: {
      total_entities: total,
      gated_count: gatedCount,
      measured_count: measured,
      missing_count: missing,
      coverage_ratio: coverage,
      threshold_applied: threshold,
    },
    message: buildMessage(
      pass,
      pass ? "pass" : "fail",
      gaps,
      coverage,
      threshold,
    ),
    space_id: input.spaceId,
  };
}

// ── Multi-space rollup ───────────────────────────────────────────────
//
// Mirrors rollupLayerCoverageGates: run per-space, return
// `{ pass: every space passes, reports: [...] }`. Used by the
// multi-space /api/pipeline/synthesize route which fans in from N
// spaces.

export interface MeasurementCoverageGateRollup {
  pass: boolean;
  reports: MeasurementCoverageGateReport[];
}

export function rollupMeasurementCoverageGates(
  inputs: MeasurementCoverageGateInput[],
): MeasurementCoverageGateRollup {
  const reports = inputs.map(checkMeasurementCoverageGate);
  return {
    pass: reports.every((r) => r.pass),
    reports,
  };
}

// ── Internals ────────────────────────────────────────────────────────

function buildMessage(
  pass: boolean,
  status: MeasurementCoverageGateStatus,
  gaps: MeasurementCoverageGap[],
  coverage: number,
  threshold: number,
): string {
  if (status === "no_measurable_entities") {
    return "No fundamental/critical entities in measurable categories — measurement gate not applicable.";
  }

  if (pass) {
    if (gaps.length === 0) return "Measurement coverage gate passed.";
    return `Gate passed at ${(coverage * 100).toFixed(0)}% coverage (${
      gaps.length
    } gap${gaps.length === 1 ? "" : "s"} remaining, but above ${(
      threshold * 100
    ).toFixed(0)}% threshold).`;
  }

  if (status === "below_min_sample") {
    return `Synthesis blocked — small-sample mode requires every gated entity to be measured. ${gaps.length} of ${
      gaps.length + Math.max(0, gaps.length === 0 ? 0 : 0)
    } missing: ${gaps
      .slice(0, 3)
      .map((g) => g.entity_name || g.entity_id)
      .filter(Boolean)
      .join(", ")}${gaps.length > 3 ? `, +${gaps.length - 3} more` : ""}.`;
  }

  // status === "fail"
  const top = gaps
    .slice(0, 5)
    .map((g) => g.entity_name || g.entity_id)
    .filter(Boolean)
    .join(", ");
  return `Synthesis blocked — measurement coverage ${(coverage * 100).toFixed(
    0,
  )}% is below the ${(threshold * 100).toFixed(0)}% threshold. Missing on ${
    gaps.length
  } gated entit${gaps.length === 1 ? "y" : "ies"}${top ? ` (${top}${gaps.length > 5 ? `, +${gaps.length - 5} more` : ""})` : ""}.`;
}

// ── Re-exports for convenience ──────────────────────────────────────

export { isMeasurableCategory, requiresMeasurement };
export {
  MEASURABLE_ENTITY_CATEGORIES,
  MEASUREMENT_REQUIRED_IMPORTANCE,
};
