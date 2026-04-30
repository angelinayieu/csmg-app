// ── resolve-prediction (Phase 5) ──────────────────────────────────
//
// Closes the loop on a trajectory prediction: takes an
// `actual_trajectory` (per-week observations the user reported),
// compares it to the prediction's `predicted_trajectory`, computes
// per-week deviation + the temporal lag delta (when the actual peak
// landed vs when we predicted it), and emits edge_calibrations rows
// against the prediction's `predicted_basis_edge_ids`.
//
// PIPELINE
//
//   user reports outcomes (UI / agent / app state)
//     └─→ /api/predictions/[id]/resolve POST
//          └─→ THIS FILE (compute deltas + write audit rows)
//               ├─→ prediction_ledger.actual_trajectory + status
//               │     + deviation + deviation_tag
//               └─→ edge_calibrations rows (one per basis edge):
//                    delta_strength + delta_confidence (magnitude)
//                  + temporal_delta_days (Phase 5 — new)
//                  + method='path_aware_temporal_v1'
//
// ALGORITHM
//
//   1. Validate the actual_trajectory shape (sorted weeks, numeric
//      values).
//   2. Per-week residuals. For each week present in BOTH the
//      predicted and actual trajectories, compute |actual - p50| /
//      max(|p50|, ε). Aggregate to a magnitude_relative_error scalar
//      (max across observed weeks — the worst miss is the loudest
//      training signal).
//   3. Detect peaks. Peak_predicted_week = argmax_w |p50(w)|; peak
//      _actual_week = argmax_w |actual(w)|. Temporal delta =
//      actual_peak_week × 7 - predicted_peak_week × 7 (days).
//   4. Tag the prediction: 'expected' (relative error <0.10),
//      'regime_shift' (0.10..0.50, same direction), or 'surprise'
//      (>0.50 OR wrong direction OR temporal delta > 50% of horizon).
//   5. Emit one edge_calibrations row per basis edge with deltas
//      scaled by relative error + the new temporal_delta_days. The
//      Phase 6A edge-strength calibrator's path-aware delta math is
//      reused for the magnitude half; temporal_delta_days is the new
//      field this resolver populates.
//
// SOFT-FAIL DISCIPLINE
//
//   Per-edge calibration insert errors are logged and surfaced in
//   the result summary; they do not abort the resolution. The
//   prediction itself flips to status='resolved' regardless of
//   whether all calibration rows succeeded — the user's report is
//   the user's report.

import type { Database } from "@/types/database.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

type PredictionRow = Database["public"]["Tables"]["prediction_ledger"]["Row"];

const EPS = 0.01;

// ── Input shape ──

export interface ActualTrajectoryEntry {
  /** 1-indexed week (matches predicted_trajectory.week). */
  week: number;
  /** Measured value at that week. Same metric as the prediction's
   *  predicted_trajectory[w].p50 — caller is responsible for unit
   *  consistency. */
  value: number;
  /** Sample size at this timepoint when the user can report it. */
  n_observed?: number | null;
  /** Free-form note (e.g. "patient reported via app on 2026-05-14"). */
  source_quote?: string | null;
}

export interface ResolvePredictionInput {
  /** Reviewer-supplied per-week actuals. Sorted ascending by week.
   *  At least one entry required; can be sparse (missing weeks are
   *  treated as "not observed" rather than zero). */
  actualTrajectory: ActualTrajectoryEntry[];
  /** Optional reviewer note carried into prediction_ledger
   *  resolution_notes. */
  reviewerNotes?: string | null;
  /** Optional override of automatic deviation tag. Use when the
   *  reviewer has more context than the resolver (e.g. "regime shift
   *  due to known context change", not just numeric distance). */
  overrideDeviationTag?:
    | "expected"
    | "regime_shift"
    | "surprise"
    | "qualitative"
    | null;
}

// ── Output shape ──

export interface ResolvePredictionResult {
  prediction_id: string;
  status: "resolved" | "abandoned";
  deviation_tag: "expected" | "regime_shift" | "surprise" | "qualitative";
  magnitude_relative_error: number;
  temporal_delta_days: number;
  predicted_peak_week: number;
  actual_peak_week: number;
  calibrations_emitted: number;
  errors: Array<{ edge_id: string; message: string }>;
}

// ── Implementation ──

interface PredictedPoint {
  week: number;
  p10: number;
  p50: number;
  p90: number;
}

function isPredictedPointArray(v: unknown): v is PredictedPoint[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as Record<string, unknown>).week === "number" &&
      typeof (e as Record<string, unknown>).p50 === "number",
  );
}

/** Argmax of absolute value across a numeric trajectory. Returns
 *  null when the trajectory is empty. */
function peakWeek<T extends { week: number }>(
  trajectory: T[],
  valueOf: (entry: T) => number,
): number | null {
  if (trajectory.length === 0) return null;
  let bestWeek = trajectory[0].week;
  let bestMag = Math.abs(valueOf(trajectory[0]));
  for (let i = 1; i < trajectory.length; i++) {
    const v = Math.abs(valueOf(trajectory[i]));
    if (v > bestMag) {
      bestMag = v;
      bestWeek = trajectory[i].week;
    }
  }
  return bestWeek;
}

/** Tag the deviation. Same thresholds as the existing point-value
 *  resolver in src/lib/cron/resolve-predictions.ts: <10% relative
 *  error = expected, 10-50% = regime_shift, >50% = surprise.
 *  Trajectory adds a temporal-lag escalator: when the temporal
 *  delta exceeds 50% of the horizon, the tag escalates to 'surprise'
 *  even if the magnitude was within bounds (the model got the SHAPE
 *  right but the TIMING badly wrong, which is still a surprise). */
function tagDeviation(
  magnitudeRelativeError: number,
  temporalDeltaDays: number,
  horizonDays: number,
  signFlipped: boolean,
): "expected" | "regime_shift" | "surprise" {
  if (signFlipped) return "surprise";
  const temporalShare =
    horizonDays > 0 ? Math.abs(temporalDeltaDays) / horizonDays : 0;
  if (magnitudeRelativeError > 0.5 || temporalShare > 0.5) return "surprise";
  if (magnitudeRelativeError > 0.1 || temporalShare > 0.25)
    return "regime_shift";
  return "expected";
}

/** Map a deviation tag + relative error to per-edge magnitude
 *  deltas. Same shape as the Phase 6A path-aware calibrator
 *  (delta_strength + delta_confidence, path-position-weighted —
 *  closer to outcome = larger delta). For the resolver's path-
 *  aware-temporal mode we treat all basis edges as path_position=1
 *  since we don't carry the full path; the dedicated path-aware
 *  calibrator can re-emit if a finer breakdown is needed. */
function deltasForCalibration(
  deviationTag: "expected" | "regime_shift" | "surprise" | "qualitative",
  magnitudeRelativeError: number,
): { delta_strength: number; delta_confidence: number } {
  switch (deviationTag) {
    case "expected":
      // Mild reinforcement.
      return { delta_strength: 0.02, delta_confidence: 0.02 };
    case "regime_shift":
      // Moderate reinforcement of confidence direction; mild
      // strength shift in the OBSERVED direction (caller's
      // actual_trajectory determines sign).
      return {
        delta_strength: 0.05 * Math.min(1, magnitudeRelativeError),
        delta_confidence: -0.03,
      };
    case "surprise":
      // Bigger downward push on confidence; magnitude shift
      // proportional to the miss.
      return {
        delta_strength: -0.08 * Math.min(1, magnitudeRelativeError),
        delta_confidence: -0.1,
      };
    case "qualitative":
    default:
      return { delta_strength: 0, delta_confidence: 0 };
  }
}

export async function resolveTrajectoryPrediction(
  db: AnyDb,
  predictionId: string,
  input: ResolvePredictionInput,
): Promise<ResolvePredictionResult | { error: string }> {
  // 1. Load + validate the prediction.
  const { data: predData, error: predErr } = await db
    .from("prediction_ledger")
    .select("*")
    .eq("id", predictionId)
    .maybeSingle();
  if (predErr || !predData) {
    return { error: "prediction_not_found" };
  }
  const pred = predData as PredictionRow;
  if (pred.prediction_kind !== "trajectory") {
    return {
      error: "wrong_kind: this resolver handles trajectory predictions only",
    };
  }
  if (pred.status === "resolved") {
    return { error: "already_resolved" };
  }
  if (!isPredictedPointArray(pred.predicted_trajectory)) {
    return { error: "missing_predicted_trajectory" };
  }
  const predictedTrajectory = pred.predicted_trajectory;

  // 2. Validate input.
  if (
    !Array.isArray(input.actualTrajectory) ||
    input.actualTrajectory.length === 0
  ) {
    return { error: "empty_actual_trajectory" };
  }
  const sortedActual = [...input.actualTrajectory]
    .filter((e) => Number.isFinite(e.week) && Number.isFinite(e.value))
    .sort((a, b) => a.week - b.week);
  if (sortedActual.length === 0) {
    return { error: "no_valid_observations" };
  }

  // 3. Per-week residuals. Match weeks; require at least one shared
  //    timepoint or the comparison is meaningless.
  const predByWeek = new Map<number, PredictedPoint>();
  for (const p of predictedTrajectory) predByWeek.set(p.week, p);
  let maxRelErr = 0;
  let signFlipped = false;
  let observedWeeks = 0;
  for (const obs of sortedActual) {
    const p = predByWeek.get(obs.week);
    if (!p) continue;
    const denom = Math.max(Math.abs(p.p50), EPS);
    const relErr = Math.abs(obs.value - p.p50) / denom;
    if (relErr > maxRelErr) maxRelErr = relErr;
    // Sign flip: predicted positive but observed negative (or vice
    // versa). Counts only when both are non-trivially nonzero.
    if (
      Math.abs(p.p50) > 0.05 &&
      Math.abs(obs.value) > 0.05 &&
      Math.sign(p.p50) !== Math.sign(obs.value)
    ) {
      signFlipped = true;
    }
    observedWeeks++;
  }
  if (observedWeeks === 0) {
    return { error: "no_overlap_between_predicted_and_actual_weeks" };
  }

  // 4. Peak detection + temporal delta.
  const predictedPeak = peakWeek(predictedTrajectory, (p) => p.p50) ?? 0;
  const actualPeak = peakWeek(sortedActual, (o) => o.value) ?? predictedPeak;
  const temporalDeltaDays = (actualPeak - predictedPeak) * 7;

  const horizonDays = predictedTrajectory.length * 7;
  const tag =
    input.overrideDeviationTag ??
    tagDeviation(maxRelErr, temporalDeltaDays, horizonDays, signFlipped);

  // 5. Update prediction_ledger.
  const resolutionNotes =
    [
      input.reviewerNotes,
      `peak_pred=${predictedPeak} peak_actual=${actualPeak} Δdays=${temporalDeltaDays} relErr=${maxRelErr.toFixed(2)}`,
    ]
      .filter(Boolean)
      .join("\n") || null;

  // Compute a scalar 'deviation' for back-compat with point-value
  // resolver consumers. We use the relative error of the value at
  // the actual peak week (or predicted peak week if actual peak
  // falls outside the predicted weeks) as the headline number.
  const peakObs = sortedActual.find((o) => o.week === actualPeak);
  const peakPred =
    predByWeek.get(actualPeak) ?? predByWeek.get(predictedPeak) ?? null;
  const headlineDeviation =
    peakObs && peakPred ? peakObs.value - peakPred.p50 : null;

  const { error: updErr } = await db
    .from("prediction_ledger")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_actual: peakObs?.value ?? null,
      actual_trajectory: sortedActual,
      deviation: headlineDeviation,
      deviation_tag: tag,
      resolution_notes: resolutionNotes,
    })
    .eq("id", predictionId);
  if (updErr) {
    return {
      error: `prediction_update_failed: ${updErr.message ?? "unknown"}`,
    };
  }

  // 6. Emit edge_calibrations rows.
  const errors: Array<{ edge_id: string; message: string }> = [];
  let calibrationsEmitted = 0;
  const basisEdgeIds = (pred.predicted_basis_edge_ids ?? []) as string[];
  if (basisEdgeIds.length > 0) {
    const deltas = deltasForCalibration(tag, maxRelErr);
    // Load basis edges to snapshot pre values + cite their evidence.
    const { data: basisEdges } = (await db
      .from("edges")
      .select(
        "id, strength, confidence, temporal_evidence_ids",
      )
      .in("id", basisEdgeIds)) as {
      data: Array<{
        id: string;
        strength: number | null;
        confidence: number | null;
        temporal_evidence_ids: string[] | null;
      }> | null;
    };
    const edgeById = new Map((basisEdges ?? []).map((e) => [e.id, e]));

    for (const edgeId of basisEdgeIds) {
      const edge = edgeById.get(edgeId);
      const insert = {
        space_id: pred.space_id,
        edge_id: edgeId,
        prediction_id: pred.id,
        strategy_snapshot_id: pred.strategy_snapshot_id,
        delta_strength: deltas.delta_strength,
        delta_confidence: deltas.delta_confidence,
        pre_strength: edge?.strength ?? null,
        pre_confidence: edge?.confidence ?? null,
        deviation_tag: tag,
        relative_error: maxRelErr,
        path_position: 1,
        rationale:
          tag === "surprise"
            ? `surprise: peak Δ=${temporalDeltaDays}d relErr=${maxRelErr.toFixed(2)}`
            : `${tag}: peak Δ=${temporalDeltaDays}d relErr=${maxRelErr.toFixed(2)}`,
        method: "path_aware_temporal_v1" as const,
        temporal_delta_days: temporalDeltaDays,
        temporal_basis_evidence_ids: edge?.temporal_evidence_ids ?? [],
      };
      const { error: insErr } = await db
        .from("edge_calibrations")
        .insert(insert);
      if (insErr) {
        errors.push({
          edge_id: edgeId,
          message: insErr.message ?? "unknown insert error",
        });
        continue;
      }
      calibrationsEmitted++;
    }
  }

  return {
    prediction_id: pred.id,
    status: "resolved",
    deviation_tag: tag,
    magnitude_relative_error: maxRelErr,
    temporal_delta_days: temporalDeltaDays,
    predicted_peak_week: predictedPeak,
    actual_peak_week: actualPeak,
    calibrations_emitted: calibrationsEmitted,
    errors,
  };
}
