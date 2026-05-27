// ── Compose per-indicator MC lift bands (Phase 11.5) ──────────────
//
// Bridges two existing subsystems that were previously disconnected:
//
//   1. Monte Carlo lift simulator (score-variation-effectiveness.ts)
//      — runs a structural-causal MC on the feature → target_pain
//      edge graph; returns lift_pct + lift_band {p10, p50, p90} for
//      the OUTCOME node.
//
//   2. Ensemble indicator scorer (score-indicator-ensemble.ts) —
//      grades each variation × each indicator from 5 lenses;
//      returns consensus_confidence per indicator (interpretation:
//      "how well does this proxy actually map to the parent outcome
//      we care about").
//
// The composition is principled: in the Prentice meta-analytic
// framework, an indicator's relationship to the true outcome is
// captured by its proportion-explained (R² in the trial-level
// surrogacy regression). When we don't have that empirical
// measurement, the ensemble's consensus_confidence is the best
// proxy — multiple independent lenses agreeing the indicator is
// well-formed maps onto "high proportion-explained."
//
// So: per-indicator lift = outcome_mc_lift × consensus_confidence
//
// This gives every indicator a statistically-defensible lift
// distribution rather than the single-target MC + ensemble grades
// living disconnected. Same propagation math, just per-indicator
// scaling.
//
// Caller pattern:
//   1. Run ensemble scorer
//   2. Run scoreVariationsForFeature (MC)
//   3. If both succeed: composeIndicatorLiftBands() before persist
//   4. The persisted indicator_scores carry lift_pct + lift_band
//
// Why a function (not inline in the route): keeps the scaling math
// in one place, lets tests verify it, makes future swap to mc_direct
// (true multi-target MC) a one-file change.

export interface MCLiftEnvelope {
  /** Signed % lift from MC. Null when MC didn't produce a usable
   *  signal (lever_unreachable, no_target, sim_failed, etc.). */
  lift_pct: number | null;
  /** Quantile band from the MC sample distribution. Null when
   *  lift_pct is. */
  lift_band: {
    p10: number;
    p50: number;
    p90: number;
  } | null;
  status: string;
}

export interface IndicatorScoreLike {
  indicator_text: string;
  outcome_id: string;
  /** 0..1 — proportion-explained proxy (typically
   *  consensus_confidence from the ensemble scorer or
   *  confidence from the rubric scorer). */
  confidence: number;
}

export interface IndicatorLiftOverlay {
  indicator_text: string;
  outcome_id: string;
  /** Scaled lift_pct = outcome_lift × confidence. */
  lift_pct: number;
  /** Each quantile is scaled by confidence. The width of the
   *  resulting band shrinks proportionally — the original MC
   *  band reflects uncertainty in the OUTCOME estimate; the
   *  scaled band reflects "how confident we are this proxy
   *  carries that uncertainty downstream." */
  lift_band: { p10: number; p50: number; p90: number };
  lift_band_method: "mc_scaled";
}

/** Compose per-indicator lift bands from one MC envelope + a set of
 *  indicator scores. Returns one overlay per indicator. Returns
 *  empty when MC didn't produce a usable lift (lever_unreachable,
 *  no_target, etc.) — caller should leave indicator_scores untouched
 *  in that case. */
export function composeIndicatorLiftBands(
  mc: MCLiftEnvelope,
  indicators: IndicatorScoreLike[],
): IndicatorLiftOverlay[] {
  if (
    mc.status !== "ok" ||
    mc.lift_pct === null ||
    mc.lift_band === null ||
    !Number.isFinite(mc.lift_pct)
  ) {
    return [];
  }
  const out: IndicatorLiftOverlay[] = [];
  for (const ind of indicators) {
    const conf = Number.isFinite(ind.confidence)
      ? Math.max(0, Math.min(1, ind.confidence))
      : 0.5;
    out.push({
      indicator_text: ind.indicator_text,
      outcome_id: ind.outcome_id,
      lift_pct: mc.lift_pct * conf,
      lift_band: {
        p10: mc.lift_band.p10 * conf,
        p50: mc.lift_band.p50 * conf,
        p90: mc.lift_band.p90 * conf,
      },
      lift_band_method: "mc_scaled",
    });
  }
  return out;
}

/** Convenience: index the overlays by (indicator_text, outcome_id)
 *  so caller can merge them into existing indicator_scores by
 *  composite key without an O(N²) loop. */
export function indexOverlays(
  overlays: IndicatorLiftOverlay[],
): Map<string, IndicatorLiftOverlay> {
  const map = new Map<string, IndicatorLiftOverlay>();
  for (const o of overlays) {
    map.set(`${o.outcome_id}::${o.indicator_text}`, o);
  }
  return map;
}
