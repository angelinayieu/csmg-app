// ── Simulation mode taxonomy (Gap B honesty) ────────────────────────────
//
// Today the "simulation labs" UI is a category error: it renders LLM
// narrative with the visual grammar of a quantitative simulation. Users
// see p10/p50/p90 and confidence scores that look computed but are
// actually emitted strings. This module carves the space into four
// epistemically-distinct modes so every prediction carries its own
// provenance chip.
//
// Every engine that emits a prediction MUST tag it with a
// SimulationMode. The UI reads that tag to decide:
//   - which badge to render,
//   - whether p-bands are drawn as numerics or qualitative bands,
//   - what the provenance footer says,
//   - whether the prediction can graduate into a committed proposal.
//
// The modes are ordered by epistemic weight, lowest → highest:
//   narrative_walk < monte_carlo < bootstrap < deterministic_replay
//
// A deterministic replay of the user's actual artifact (code / SQL /
// SOP) is the highest-trust prediction the system can produce. A
// narrative walk is the lowest. Nothing in between is ever presented
// with the chrome of the mode above it.

export type SimulationMode =
  | "narrative_walk"
  | "monte_carlo"
  | "bootstrap"
  | "deterministic_replay";

export interface SimulationModeMeta {
  /** Short label for the badge chip. */
  label: string;
  /** One-line epistemic framing shown under the badge on hover / details. */
  tagline: string;
  /** Accent color — drives the chip, the result-card border, the provenance footer. */
  accent: string;
  /** Relative trust weight (0..1). Used to sort + gate "promote to proposal". */
  weight: number;
  /** Which kind of UI chrome is honest for this mode. */
  chrome: "prose_first" | "distribution_first" | "backtest_first" | "replay_log";
}

export const SIMULATION_MODE_META: Record<SimulationMode, SimulationModeMeta> = {
  narrative_walk: {
    label: "narrative walk",
    tagline:
      "LLM walked your graph and guessed. This is a hypothesis, not a measurement.",
    accent: "#9ca3af", // gray-400
    weight: 0.2,
    chrome: "prose_first",
  },
  monte_carlo: {
    label: "monte-carlo",
    tagline:
      "Distribution from N iterations under parameter uncertainty. Honest ranges; no historical replay.",
    accent: "#3b82f6", // blue-500
    weight: 0.5,
    chrome: "distribution_first",
  },
  bootstrap: {
    label: "bootstrap",
    tagline:
      "Distribution from resampling your history. Backtested against what actually happened.",
    accent: "#14b8a6", // teal-500
    weight: 0.75,
    chrome: "backtest_first",
  },
  deterministic_replay: {
    label: "deterministic replay",
    tagline:
      "Your actual process, executed step-by-step in a sandbox. The highest-trust prediction.",
    accent: "#10b981", // emerald-500
    weight: 1.0,
    chrome: "replay_log",
  },
};

// ── Calibration state ───────────────────────────────────────────────────
//
// Gap B's second half: simulating current reality is calibration. The
// lab should refuse to simulate a proposal until the KG can reproduce
// the user's stated baselines within tolerance. This enum drives the
// `CalibrationStatusStrip` at the top of the lab page.
//
//   unknown    — user hasn't declared baselines yet (no gate)
//   uncalibrated — baselines declared, model can't reproduce them
//   partial    — some baselines reproduce, others don't
//   calibrated — all declared baselines reproduce within tolerance
//   bypassed   — user clicked "run lab anyway" past a failing gate
//
// The strip renders a different tone per state. `calibrated` unlocks
// the "promote to proposal" action on any simulation result.

export type CalibrationStatus =
  | "unknown"
  | "uncalibrated"
  | "partial"
  | "calibrated"
  | "bypassed";

export interface CalibrationSummary {
  status: CalibrationStatus;
  /** How many declared baselines the model reproduces within tolerance. */
  reproducedCount: number;
  /** Total declared baselines. When 0, status === "unknown". */
  totalCount: number;
  /** Entities the user would need more information on to close the gap. */
  blockerEntityIds?: string[];
  /** Short explainer rendered in the strip. */
  headline?: string;
}

export function summarizeCalibration(
  reproduced: number,
  total: number,
  bypassed = false,
): CalibrationSummary {
  if (total === 0) {
    return {
      status: "unknown",
      reproducedCount: 0,
      totalCount: 0,
      headline: "No baselines declared — lab predictions are unverified against reality.",
    };
  }
  if (bypassed) {
    return {
      status: "bypassed",
      reproducedCount: reproduced,
      totalCount: total,
      headline: `Proceeding without calibration (${reproduced}/${total} baselines reproduced).`,
    };
  }
  if (reproduced === total) {
    return {
      status: "calibrated",
      reproducedCount: reproduced,
      totalCount: total,
      headline: `All ${total} baselines reproduce within tolerance. Lab unlocked.`,
    };
  }
  if (reproduced === 0) {
    return {
      status: "uncalibrated",
      reproducedCount: 0,
      totalCount: total,
      headline: `Model cannot reproduce any of the ${total} stated baselines. Proposals built on this would be unverified.`,
    };
  }
  return {
    status: "partial",
    reproducedCount: reproduced,
    totalCount: total,
    headline: `${reproduced} of ${total} baselines reproduce. Remaining gaps may undermine proposal predictions.`,
  };
}

// ── Qualitative bands (narrative mode) ──────────────────────────────────
//
// When mode === "narrative_walk", we SHOULD NOT render numeric p-bands.
// The LLM emitted those numbers by pattern-matching, not by sampling a
// distribution. This helper collapses a {p10,p50,p90} triple into a
// qualitative label the panel can show instead — reserving numerics
// for modes that earned them.

export function qualitativeBandFor(p50: number): {
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative";
} {
  if (p50 >= 70) return { label: "Likely meaningful lift", tone: "positive" };
  if (p50 >= 50) return { label: "Possible effect, weakly supported", tone: "neutral" };
  if (p50 >= 30) return { label: "Uncertain — graph doesn't strongly endorse", tone: "caution" };
  return { label: "Unlikely under graph topology", tone: "negative" };
}
