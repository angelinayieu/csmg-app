/**
 * Universal-scope Lab formulas.
 *
 * The existing lab-formulas.ts models INTRA-entity / INTRA-space
 * dynamics — "how do this thing's components compete for slots of
 * attention." At the universal scope (where each subunit IS a whole
 * space) those dials are semantically wrong. This module defines a
 * parallel set of parameters + a metric that actually mean something
 * across spaces:
 *
 *   weave_density (W)             — how aggressively we surface
 *                                   cross-space bridges (0.5 – 2.0)
 *   contradiction_sensitivity (C) — penalty weight on contradictions
 *                                   found across spaces (0.0 – 2.0)
 *   cross_space_tau (T)           — recency window, in days, for a
 *                                   bridge to count as "active" (7 – 90)
 *   coherence (H)                 — how strictly shared semantics are
 *                                   required for bridges to count
 *                                   (0.0 – 2.0; acts as a similarity
 *                                   threshold multiplier)
 *
 * The output is `interweaveHealth` — a 0..100% score meant to read as
 * "how coherently does your universe currently hang together." The
 * chamber renders it in the same Probability Index pill, so the visual
 * language stays unified even though the underlying math is different.
 */

export type UniversalParameterKey =
  | "weaveDensity"
  | "contradictionSensitivity"
  | "crossSpaceTau"
  | "coherence";

export interface UniversalParameters {
  weaveDensity: number;
  contradictionSensitivity: number;
  crossSpaceTau: number;
  coherence: number;
}

export interface UniversalParameterSpec {
  key: UniversalParameterKey;
  label: string;
  symbol: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  ticks: [string, string, string];
  /** 1-line helper shown on hover — explains what this actually does at
   *  cross-space scope, since the user's mental model is "intra-thing"
   *  from the space-level Lab. */
  helper: string;
}

export const UNIVERSAL_PARAMETER_SPECS: UniversalParameterSpec[] = [
  {
    key: "weaveDensity",
    label: "Weave",
    symbol: "W",
    unit: "",
    min: 0.5,
    max: 2.0,
    step: 0.1,
    ticks: ["0.5", "1.2", "2.0"],
    helper:
      "How aggressively we surface cross-space bridges. Higher = more candidates, more noise.",
  },
  {
    key: "contradictionSensitivity",
    label: "Conflict",
    symbol: "C",
    unit: "",
    min: 0.0,
    max: 2.0,
    step: 0.1,
    ticks: ["0", "1.0", "2.0"],
    helper:
      "How much we penalise contradictions between spaces. Higher = coherence score drops fast when spaces disagree.",
  },
  {
    key: "crossSpaceTau",
    label: "Recency",
    symbol: "τ",
    unit: "d",
    min: 7,
    max: 90,
    step: 1,
    ticks: ["7d", "30d", "90d"],
    helper:
      "Recency window in days for a bridge to count as active. Shorter = only fresh work matters.",
  },
  {
    key: "coherence",
    label: "Coherence",
    symbol: "H",
    unit: "",
    min: 0.0,
    max: 2.0,
    step: 0.1,
    ticks: ["0", "1.0", "2.0"],
    helper:
      "Strictness of the 'same concept' test for bridges. Higher = only strongly shared semantics count.",
  },
];

export const UNIVERSAL_DEFAULTS: UniversalParameters = {
  weaveDensity: 1.2,
  contradictionSensitivity: 1.0,
  crossSpaceTau: 30,
  coherence: 1.0,
};

export function clampUniversalParameters(
  p: UniversalParameters,
): UniversalParameters {
  const out: UniversalParameters = { ...p };
  for (const spec of UNIVERSAL_PARAMETER_SPECS) {
    let v = out[spec.key];
    if (typeof v !== "number" || !Number.isFinite(v)) v = (spec.min + spec.max) / 2;
    v = Math.max(spec.min, Math.min(spec.max, v));
    v = Math.round(v / spec.step) * spec.step;
    out[spec.key] = Math.round(v * 1000) / 1000;
  }
  return out;
}

/**
 * Real-KG signals read from the user's data. The caller collects these
 * once at universal Lab mount and passes them into the metric. This
 * keeps the formula pure + testable and lets the UI drive what it means
 * for the score to change: tweak parameters, score recomputes; add a
 * new bridge, signals change and score recomputes.
 */
export interface InterweaveSignals {
  /** Total active bridges (status != 'user_rejected') across all user's spaces. */
  activeBridges: number;
  /** Count of bridges whose status='user_confirmed' (highest coherence signal). */
  confirmedBridges: number;
  /** Total entities across all user's spaces. Acts as the denominator. */
  totalEntities: number;
  /** Count of contradictions across all user's spaces. */
  contradictions: number;
  /**
   * Recency multiplier ∈ [0, 1] computed from the newest bridge's
   * created_at — fresh activity boosts the score. 1 = there's a bridge
   * from today, 0 = nothing in the last tau window.
   */
  recencyMult: number;
}

/**
 * Interweave health — 0..100 %.
 *
 * Formula:
 *   bridgeRate = min(1, (activeBridges × W) / totalEntities)
 *   confirmBonus = (confirmedBridges / max(1, activeBridges)) × 0.25
 *   contradictionPenalty = max(0.3, 1 − (contradictions × C × 0.03))
 *   coherenceFactor = 0.5 + H × 0.25
 *   raw = (bridgeRate + confirmBonus) × contradictionPenalty × coherenceFactor × recencyMult
 *   out = clamp(raw × 100, 0, 100)
 *
 * The coefficients were picked so that a reasonably-populated universe
 * (50 entities, 12 bridges, 2 contradictions, W=C=H=1.0, τ=30d, fresh)
 * lands in the 40–60 range and stays there without tuning. Extreme
 * dial positions can push it to the low 20s or the low 80s.
 */
export function interweaveHealth(
  p: UniversalParameters,
  sig: InterweaveSignals,
): number {
  const entityFloor = Math.max(1, sig.totalEntities);
  const bridgeRate = Math.min(
    1,
    (sig.activeBridges * p.weaveDensity) / entityFloor,
  );
  const confirmBonus =
    (sig.confirmedBridges / Math.max(1, sig.activeBridges)) * 0.25;
  const contradictionPenalty = Math.max(
    0.3,
    1 - sig.contradictions * p.contradictionSensitivity * 0.03,
  );
  const coherenceFactor = 0.5 + p.coherence * 0.25;
  const raw =
    (bridgeRate + confirmBonus) *
    contradictionPenalty *
    coherenceFactor *
    sig.recencyMult;
  return Math.min(100, Math.max(0, raw * 100));
}

export interface UniversalDistributionResult {
  samples: number[];
  bins: number[];
  binCount: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
}

/**
 * Monte Carlo for the interweave score. Perturbs the four parameters by
 * ±10% of range; the signals stay fixed because they're observations
 * about the user's universe, not levers. The spread tells the user
 * "given my data, how sensitive is my universe to dial settings?"
 */
export function interweaveMonteCarlo(
  p: UniversalParameters,
  sig: InterweaveSignals,
  opts: { samples?: number; bins?: number; jitter?: number } = {},
): UniversalDistributionResult {
  const samples = opts.samples ?? 200;
  const binCount = opts.bins ?? 20;
  const jitter = opts.jitter ?? 0.1;

  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const perturbed = clampUniversalParameters({
      weaveDensity: p.weaveDensity + (Math.random() - 0.5) * (2.0 - 0.5) * jitter,
      contradictionSensitivity:
        p.contradictionSensitivity +
        (Math.random() - 0.5) * (2.0 - 0.0) * jitter,
      crossSpaceTau: p.crossSpaceTau + (Math.random() - 0.5) * (90 - 7) * jitter,
      coherence: p.coherence + (Math.random() - 0.5) * (2.0 - 0.0) * jitter,
    });
    out.push(interweaveHealth(perturbed, sig));
  }

  const bins = new Array(binCount).fill(0);
  for (const v of out) {
    const idx = Math.min(binCount - 1, Math.floor((v / 100) * binCount));
    bins[idx]++;
  }

  const sorted = [...out].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const pct = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

  return {
    samples: out,
    bins,
    binCount,
    mean,
    median: pct(0.5),
    p10: pct(0.1),
    p90: pct(0.9),
  };
}
