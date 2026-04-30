// ── Temporal pooler (Phase 3) ────────────────────────────────────
//
// Peer of edge-strength-pooler.ts. Pools temporal claims (onset,
// peak, persistence) from evidence_registries rows into precision-
// weighted estimates with heterogeneity, so the strategizer +
// trajectory simulator can read live timing data off `edges`
// without re-pooling per query.
//
// PIPELINE
//
//   evidence_registries (per-row temporal claims)
//     ├─ effect_size half  → edge-strength-pooler (existing)
//     └─ temporal half     → THIS FILE
//
//   For each (edge, timing-component) pair:
//     1. Filter rows attached to either endpoint that carry the
//        component (e.g. peak_days != null).
//     2. Compute within-study variance from the row's CI when
//        present; fall back to a heterogeneity-aware default SE
//        when only a point estimate exists.
//     3. REML τ² random-effects pool (same algorithm as
//        edge-strength-pooler so the math + audit story are
//        consistent).
//     4. Output p10/p50/p90 (matches subject_experiments.outcome_summary
//        format the simulator already speaks) plus I² heterogeneity.
//
// MATH
//
// Same REML estimator as edge-strength-pooler. The only differences:
//
//   - Three independent pools per edge (onset / peak / persistence)
//     because they're separate quantities with their own evidence.
//   - Default SE for point-only rows: a row reporting "peaked at
//     week 6" with no CI gets SE = 0.25 × value (i.e. ±25% of the
//     point). Heuristic, not derived — but the pooler exposes the
//     assumed SE in dynamics_properties.temporal_pooling_metadata so
//     a reviewer can audit it. Stricter mode (requirePointWithCI)
//     drops point-only rows entirely.
//   - Output as percentile triple (p10/p50/p90) instead of CI bounds
//     because the simulator's Monte Carlo expects p10/p50/p90.
//
// I² formula (Higgins & Thompson 2002):
//
//   I² = max(0, (Q - (k-1)) / Q)   where Q is the heterogeneity
//                                   sum-of-squares from REML.
//
// Returns I² normalized to [0, 1].
//
// STRICT MODE
//
// Pass `requireStatedExplicitly: true` to filter rows to those with
// `temporal_extraction_method === 'stated_explicitly'`. Used when
// the consumer cares more about rigor than coverage (e.g. trial
// design, regulatory context). Default mode includes back_calculated
// + inferred_from_design rows but flags them in the metadata.

import type {
  DecayKinetics,
  EvidenceRegistryRow,
  TemporalExtractionMethod,
} from "@/types/evidence-registry";

// p10/p90 z-multipliers: ±1.281552 ≈ Φ⁻¹(0.9). Matches what
// subject_experiments.outcome_summary uses.
const Z_P10_P90 = 1.2815515655446004;
const REML_MAX_ITER = 50;
const REML_TOL = 1e-7;

// Default SE when only a point estimate is reported. 25% of the
// value is conservative — a study reporting "peaked at week 6" with
// no CI still informs the pool but with ±1.5-week 80% bounds at the
// mean. Tweakable per timing component if needed; we keep one ratio
// to avoid hand-tuning that drifts from review.
const POINT_ONLY_DEFAULT_SE_RATIO = 0.25;
// Floor on default SE so a "0 days" point doesn't get SE=0 (which
// would be infinite precision). 1 day floor.
const POINT_ONLY_DEFAULT_SE_FLOOR = 1;

export type TimingComponent = "onset" | "peak" | "persistence";

export interface TemporalPoolingInput {
  /** Days. */
  value: number;
  /** Standard error in days. Derived from CI when present, defaulted
   *  via POINT_ONLY_DEFAULT_SE_RATIO when only a point estimate. */
  standard_error: number;
  /** Was the SE derived from an explicit CI, or defaulted? Drives a
   *  flag in the pool metadata. */
  se_source: "ci" | "default";
  evidence_id: string;
  /** Provenance of the original timing claim. Strict pooling filters
   *  this; permissive pooling includes everything but flags below
   *  stated_explicitly rows. */
  extraction_method: TemporalExtractionMethod;
}

export interface TemporalPoolingResult {
  /** Pooled point estimate (REML mean). */
  p50: number;
  /** μ - 1.282·SE under normality. */
  p10: number;
  /** μ + 1.282·SE under normality. */
  p90: number;
  /** Pooled SE of the mean (1 / sqrt(Σ w_i)). */
  pooled_se: number;
  /** Heterogeneity variance estimate. */
  tau_squared: number;
  /** I² statistic, [0, 1]. */
  i_squared: number;
  /** Number of rows that contributed. */
  n_studies: number;
  evidence_row_ids: string[];
  /** REML iterations until convergence. */
  reml_iterations: number;
  /** "all_ci" | "all_default" | "mixed" — describes input quality. */
  weighting_method: "all_ci" | "all_default" | "mixed";
  /** Count of rows whose extraction_method != stated_explicitly. */
  non_explicit_count: number;
}

// ── SE derivation per timing component ───────────────────────────

/** Derive SE from per-component CI bounds. Returns null when no CI
 *  is present and the caller didn't allow a default. */
function deriveSeForComponent(
  row: EvidenceRegistryRow,
  component: TimingComponent,
  options: { allowDefault: boolean },
): { se: number; source: "ci" | "default" } | null {
  let value: number | null;
  let lower: number | null;
  let upper: number | null;

  if (component === "onset") {
    value = row.onset_days;
    lower = row.onset_days_ci_lower;
    upper = row.onset_days_ci_upper;
  } else if (component === "peak") {
    value = row.peak_days;
    lower = row.peak_days_ci_lower;
    upper = row.peak_days_ci_upper;
  } else {
    value = row.persistence_days;
    lower = row.persistence_days_ci_lower;
    upper = row.persistence_days_ci_upper;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return null;
  }

  // CI present → derive SE assuming p10/p90 representation (which is
  // how the temporal extractor stores ranges from a single study).
  // For onset, the CI is from a "between weeks 4 and 8" range; for
  // peak from a midpoint range; for persistence from a sustained-at
  // range. We treat all as 80% bounds (1.282·SE) since temporal
  // claims rarely come with explicit 95% CI.
  if (
    typeof lower === "number" &&
    typeof upper === "number" &&
    upper > lower &&
    Number.isFinite(lower) &&
    Number.isFinite(upper)
  ) {
    return {
      se: (upper - lower) / (2 * Z_P10_P90),
      source: "ci",
    };
  }

  // Point-only — apply default SE if allowed.
  if (options.allowDefault) {
    const seRaw = value * POINT_ONLY_DEFAULT_SE_RATIO;
    const se = Math.max(seRaw, POINT_ONLY_DEFAULT_SE_FLOOR);
    return { se, source: "default" };
  }

  return null;
}

// ── Build pooling inputs from evidence rows ──────────────────────

export interface BuildInputsOptions {
  /** Strict mode — drop rows with extraction_method != stated_explicitly. */
  requireStatedExplicitly?: boolean;
  /** Drop rows that lack an explicit CI (no defaulted SE). */
  requirePointWithCi?: boolean;
  /** Reviewer gate — only include status='reviewed'. Default: include
   *  'extracted' too so the lab updates immediately after auto-attach
   *  (mirrors edge-strength-pooler behavior). */
  requireReviewed?: boolean;
}

export function evidenceToTemporalInputs(
  rows: EvidenceRegistryRow[],
  component: TimingComponent,
  options: BuildInputsOptions = {},
): TemporalPoolingInput[] {
  const out: TemporalPoolingInput[] = [];
  const allowDefault = !options.requirePointWithCi;
  for (const r of rows) {
    if (options.requireReviewed && r.status !== "reviewed") continue;
    if (
      options.requireStatedExplicitly &&
      r.temporal_extraction_method !== "stated_explicitly"
    )
      continue;
    const derived = deriveSeForComponent(r, component, { allowDefault });
    if (!derived) continue;

    let value: number;
    if (component === "onset") value = r.onset_days as number;
    else if (component === "peak") value = r.peak_days as number;
    else value = r.persistence_days as number;

    out.push({
      value,
      standard_error: derived.se,
      se_source: derived.source,
      evidence_id: r.id,
      // Default to stated_explicitly if missing (defensive — schema
      // doesn't force the column non-null).
      extraction_method: r.temporal_extraction_method ?? "stated_explicitly",
    });
  }
  return out;
}

// ── REML τ² + I² pooling ─────────────────────────────────────────

export function poolTemporal(
  inputs: TemporalPoolingInput[],
): TemporalPoolingResult | null {
  if (inputs.length === 0) return null;
  const valid = inputs.filter(
    (i) =>
      Number.isFinite(i.value) &&
      Number.isFinite(i.standard_error) &&
      i.standard_error > 0,
  );
  if (valid.length === 0) return null;

  const seSources = new Set(valid.map((v) => v.se_source));
  const weighting_method: "all_ci" | "all_default" | "mixed" =
    seSources.size === 1
      ? seSources.has("ci")
        ? "all_ci"
        : "all_default"
      : "mixed";
  const non_explicit_count = valid.filter(
    (v) => v.extraction_method !== "stated_explicitly",
  ).length;

  // Single study — return as-is (τ²=0, I²=0 by definition).
  if (valid.length === 1) {
    const s = valid[0];
    return {
      p50: r4(s.value),
      p10: r4(s.value - Z_P10_P90 * s.standard_error),
      p90: r4(s.value + Z_P10_P90 * s.standard_error),
      pooled_se: r4(s.standard_error),
      tau_squared: 0,
      i_squared: 0,
      n_studies: 1,
      evidence_row_ids: [s.evidence_id],
      reml_iterations: 0,
      weighting_method,
      non_explicit_count,
    };
  }

  const y = valid.map((i) => i.value);
  const v = valid.map((i) => i.standard_error * i.standard_error);
  const k = valid.length;

  // REML iteration. Mirrors edge-strength-pooler.
  let tau2 = 0;
  let iter = 0;
  let lastQ = 0;
  let lastSumW = 0;
  for (; iter < REML_MAX_ITER; iter++) {
    const wList = v.map((vi) => 1 / (vi + tau2));
    const sumW = wList.reduce((a, b) => a + b, 0);
    const sumW2 = wList.reduce((a, b) => a + b * b, 0);
    const sumWY = wList.reduce((a, b, idx) => a + b * y[idx], 0);
    const muHat = sumWY / sumW;
    const Q = wList.reduce(
      (a, wi, idx) => a + wi * (y[idx] - muHat) * (y[idx] - muHat),
      0,
    );
    const denom = sumW - sumW2 / sumW;
    const tau2New = denom > 0 ? Math.max(0, (Q - (k - 1)) / denom) : 0;
    lastQ = Q;
    lastSumW = sumW;
    if (Math.abs(tau2New - tau2) < REML_TOL) {
      tau2 = tau2New;
      iter++;
      break;
    }
    tau2 = tau2New;
  }

  // Final pool at converged τ².
  const wFinal = v.map((vi) => 1 / (vi + tau2));
  const sumWFinal = wFinal.reduce((a, b) => a + b, 0);
  const sumWYFinal = wFinal.reduce((a, b, idx) => a + b * y[idx], 0);
  const pooledEffect = sumWYFinal / sumWFinal;
  const pooledSe = Math.sqrt(1 / sumWFinal);

  // Higgins-Thompson I² from Q-statistic.
  // I² = max(0, (Q - df) / Q)  where df = k - 1
  // Cap at 1 (denominator-of-zero edge case).
  const df = k - 1;
  const i2Raw = lastQ > 0 ? Math.max(0, (lastQ - df) / lastQ) : 0;
  const i_squared = Math.min(1, Math.max(0, i2Raw));
  // Suppress lint warning on lastSumW (kept for future diagnostics).
  void lastSumW;

  return {
    p50: r4(pooledEffect),
    p10: r4(Math.max(0, pooledEffect - Z_P10_P90 * pooledSe)),
    p90: r4(pooledEffect + Z_P10_P90 * pooledSe),
    pooled_se: r4(pooledSe),
    tau_squared: r4(tau2),
    i_squared: r4(i_squared),
    n_studies: k,
    evidence_row_ids: valid.map((i) => i.evidence_id),
    reml_iterations: iter,
    weighting_method,
    non_explicit_count,
  };
}

// ── Decay kinetics modal aggregation ──────────────────────────────

export interface DecayModalResult {
  modal: DecayKinetics | null;
  /** True when two or more shapes tied for the most-common count. */
  tied: boolean;
  /** Tally of each shape across rows. */
  counts: Record<DecayKinetics, number>;
}

/** Pick the most-common decay shape from a batch of evidence rows.
 *  Ties broken alphabetically with `tied: true` flagged in metadata
 *  so the reviewer surface knows to disclose the tie. */
export function modalDecayKinetics(
  rows: EvidenceRegistryRow[],
): DecayModalResult {
  const counts: Record<DecayKinetics, number> = {
    linear: 0,
    exponential: 0,
    sustained: 0,
    biphasic: 0,
    unknown: 0,
  };
  let totalNonNull = 0;
  for (const r of rows) {
    if (!r.decay_kinetics) continue;
    counts[r.decay_kinetics] = (counts[r.decay_kinetics] ?? 0) + 1;
    totalNonNull++;
  }
  if (totalNonNull === 0) {
    return { modal: null, tied: false, counts };
  }
  const sorted = (Object.entries(counts) as [DecayKinetics, number][])
    .filter(([, n]) => n > 0)
    .sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b));
  const top = sorted[0];
  if (!top) return { modal: null, tied: false, counts };
  const tied = sorted.length > 1 && sorted[1][1] === top[1];
  return { modal: top[0], tied, counts };
}

// ── Decay kinetics → temporal_validity.decay_rate (back-compat) ──

/** Map the new decay_kinetics vocabulary to the legacy
 *  edges.temporal_validity.decay_rate enum so existing readers
 *  (critic prompt, node-detail UI, edge-explanation-popover) see
 *  live data once the pooler runs. Conservative mapping; the
 *  recompute service writes both the new scalar columns AND the
 *  legacy JSONB key for backward compatibility. */
export function decayKineticsToLegacyDecayRate(
  kinetics: DecayKinetics | null,
): "none" | "slow" | "moderate" | "fast" | "immediate" | null {
  if (!kinetics) return null;
  switch (kinetics) {
    case "sustained":
      return "none";
    case "linear":
      return "slow";
    case "exponential":
      return "moderate";
    case "biphasic":
      return "fast";
    case "unknown":
      return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function r4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

// ── Test-only exports ────────────────────────────────────────────

export const __test = {
  deriveSeForComponent,
  POINT_ONLY_DEFAULT_SE_RATIO,
  POINT_ONLY_DEFAULT_SE_FLOOR,
  Z_P10_P90,
};
