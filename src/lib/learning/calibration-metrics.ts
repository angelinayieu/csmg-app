// ── Calibration metrics ──
//
// Honest measurement of how well stated confidence tracks realized
// outcomes on the prediction_ledger. Three quantities:
//
//   • Brier score — mean squared error between stated confidence (∈[0,1])
//     and realized hit (∈{0,1}). Lower is better. Range [0, 1]. A system
//     that always says 0.7 confidence and is right 70% of the time scores
//     ≈ 0.21.
//
//   • ECE (Expected Calibration Error) — weighted absolute gap between
//     stated confidence and realized hit rate, bucketed by confidence
//     decile. Lower is better. Range [0, 1]. A perfectly-calibrated
//     system scores 0; a system whose 0.9-confidence claims are right
//     50% of the time pays a heavy ECE penalty.
//
//   • Reliability bins — the per-bucket data points behind ECE, suitable
//     for rendering a reliability diagram. Each row carries the bin
//     center, the count of predictions in that bin, the mean stated
//     confidence in that bin, and the realized hit rate.
//
// "Hit" is defined by `deviation_tag === 'expected'` (within ±10% of
// predicted per the migration 20260518 comment). Tags 'regime_shift' and
// 'surprise' count as misses. Tags 'qualitative' and 'failed' are
// filtered out (the first is text-only and can't be bucketed as
// hit/miss; the second never executed and tells us nothing about the
// model's calibration). Predictions with null confidence are also
// dropped — calibration without a stated probability is undefined.
//
// MIN_SAMPLE: below this floor we return null for all three metrics
// rather than report a number we can't defend. 20 is small but enough
// to make at least 2 deciles non-empty in practice. Callers should
// surface "based on N predictions" alongside the numbers so users can
// discount tiny samples.

export const MIN_SAMPLE_FOR_CALIBRATION = 20;

export interface CalibrationDataPoint {
  /** Stated confidence at prediction time, ∈ [0, 1]. */
  confidence: number;
  /** 1 if deviation_tag === 'expected', 0 otherwise. */
  hit: 0 | 1;
}

export interface ReliabilityBin {
  /** Decile boundary midpoint (0.05, 0.15, …, 0.95). */
  bin_center: number;
  /** Predictions whose confidence fell in [bin_center − 0.05, bin_center + 0.05). */
  count: number;
  /** Mean stated confidence inside this bin (== bin_center only in the limit). */
  mean_confidence: number;
  /** Realized hit rate inside this bin (==mean_confidence iff perfectly calibrated). */
  hit_rate: number;
}

/**
 * Filter raw prediction_ledger rows to the subset that contributes to
 * confidence calibration. Returns a {confidence, hit} pair per usable row.
 */
export function toCalibrationPoints(
  rows: Array<{
    confidence: number | null;
    deviation_tag: string | null;
    status: string | null;
  }>,
): CalibrationDataPoint[] {
  const out: CalibrationDataPoint[] = [];
  for (const r of rows) {
    if (r.status !== "resolved") continue;
    if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence)) continue;
    if (r.confidence < 0 || r.confidence > 1) continue;
    const tag = r.deviation_tag;
    // Skip non-quantifiable resolutions. 'qualitative' is text-only;
    // 'failed' means the prediction never executed (network / access
    // error). Either polluting calibration would mislead.
    if (tag !== "expected" && tag !== "regime_shift" && tag !== "surprise") {
      continue;
    }
    out.push({
      confidence: r.confidence,
      hit: tag === "expected" ? 1 : 0,
    });
  }
  return out;
}

/**
 * Brier score: mean((confidence − hit)²). Returns null when sample is
 * below MIN_SAMPLE_FOR_CALIBRATION.
 */
export function computeBrier(points: CalibrationDataPoint[]): number | null {
  if (points.length < MIN_SAMPLE_FOR_CALIBRATION) return null;
  let sum = 0;
  for (const p of points) {
    const err = p.confidence - p.hit;
    sum += err * err;
  }
  return sum / points.length;
}

/**
 * Expected Calibration Error with 10 equal-width bins over [0, 1].
 * ECE = Σ (n_bin / N) × |mean(confidence_bin) − hit_rate_bin|.
 * Returns null when sample is below MIN_SAMPLE_FOR_CALIBRATION.
 */
export function computeECE(
  points: CalibrationDataPoint[],
  nBins = 10,
): number | null {
  if (points.length < MIN_SAMPLE_FOR_CALIBRATION) return null;
  if (nBins <= 0) return null;
  const bins = buildBins(points, nBins);
  const total = points.length;
  let ece = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    ece += (b.count / total) * Math.abs(b.mean_confidence - b.hit_rate);
  }
  return ece;
}

/**
 * Reliability bins (the reliability-diagram dataset). Always returns an
 * array (one row per bin, including empty bins with count=0) when the
 * sample meets MIN_SAMPLE_FOR_CALIBRATION; returns null otherwise so the
 * UI can hide the diagram cleanly.
 */
export function computeReliabilityBins(
  points: CalibrationDataPoint[],
  nBins = 10,
): ReliabilityBin[] | null {
  if (points.length < MIN_SAMPLE_FOR_CALIBRATION) return null;
  return buildBins(points, nBins);
}

function buildBins(
  points: CalibrationDataPoint[],
  nBins: number,
): ReliabilityBin[] {
  const width = 1 / nBins;
  const sumConf = new Array<number>(nBins).fill(0);
  const sumHit = new Array<number>(nBins).fill(0);
  const count = new Array<number>(nBins).fill(0);

  for (const p of points) {
    // confidence = 1.0 lands in the top bin (clamp the index).
    const raw = Math.floor(p.confidence / width);
    const idx = raw >= nBins ? nBins - 1 : raw;
    sumConf[idx] += p.confidence;
    sumHit[idx] += p.hit;
    count[idx] += 1;
  }

  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < nBins; i += 1) {
    const c = count[i];
    bins.push({
      bin_center: (i + 0.5) * width,
      count: c,
      mean_confidence: c > 0 ? sumConf[i] / c : (i + 0.5) * width,
      hit_rate: c > 0 ? sumHit[i] / c : 0,
    });
  }
  return bins;
}
