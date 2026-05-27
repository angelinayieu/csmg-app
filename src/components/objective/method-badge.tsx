"use client";

// ── Method Badge ──────────────────────────────────────────────────
//
// Phase 11.1a — universal score-display component. Renders alongside
// every score on every surface (feature card, item drawer, notebook
// row, Lab page) so the user can ALWAYS see which evaluation tier
// produced the number they're looking at.
//
// Five tiers (per lock-in M10 in OBJECTIVE_CANVAS_OPERATION_MAP.md):
//   🧠 Heuristic   — quick LLM plausibility check, no rubric/sim
//   📋 Rubric      — explicit 5-criteria LLM grade (Tier 2 default)
//   📚 Evidence    — research-grounded scoring with citations
//   🎲 Simulated   — Monte Carlo + placebo refutation (Tier 4)
//   🧪 Tested      — real empirical outcome from prototype lifecycle
//
// Restrained visual: emoji + tier label + score. Optional ± band
// when distribution data is available (e.g., Monte Carlo lift_band).
// No color shouting — the emoji carries identity, the number carries
// information, the typography stays calm.
//
// Compact mode squashes to "📋 0.71" for tight spaces (card chips).
// Expanded mode shows "📋 Rubric · 0.71 ± 0.05" for surfaces with room.

import { appleVibe } from "@/lib/apple-vibe-tokens";

export type EvaluationMethod =
  | "heuristic"
  | "rubric"
  | "evidence"
  | "simulation"
  | "tested"
  | "ensemble";

interface Props {
  method: EvaluationMethod;
  /** 0..1 composite score the user is looking at. Optional — some
   *  surfaces want just the badge (e.g., as a chip beside a label). */
  score?: number;
  /** ± band when distribution data is available. Renders as
   *  "0.71 ± 0.05" — communicates uncertainty honestly. */
  band?: number;
  /** Compact mode hides the tier label, showing only emoji + score.
   *  Use on tight surfaces where space matters more than full clarity. */
  compact?: boolean;
  /** Optional title attribute override. Defaults to a tier explainer. */
  title?: string;
}

const TIER_VISUAL: Record<
  EvaluationMethod,
  { emoji: string; label: string; explainer: string }
> = {
  heuristic: {
    emoji: "🧠",
    label: "Heuristic",
    explainer: "Quick plausibility check — no rubric or simulation",
  },
  rubric: {
    emoji: "📋",
    label: "Rubric",
    explainer: "5-criteria LLM grade: plausibility · addresses pain · constraint fit · novelty · risk",
  },
  evidence: {
    emoji: "📚",
    label: "Evidence",
    explainer: "Research-grounded scoring with citations",
  },
  simulation: {
    emoji: "🎲",
    label: "Simulated",
    explainer: "Monte Carlo lift estimate + placebo refutation",
  },
  tested: {
    emoji: "🧪",
    label: "Tested",
    explainer: "Real empirical outcome from a prototype run",
  },
  ensemble: {
    emoji: "📊",
    label: "Ensemble",
    explainer:
      "5-lens grade (systems / skeptic / operator / engineer / historian) + REML τ² heterogeneity pool across variations + Prentice mediation + Goodhart risk + counter-indicator pairing",
  },
};

function formatScore(score: number): string {
  // Two-decimal for 0..1 scores reads cleanly without overstating
  // precision. Negative or >1 values (shouldn't happen) clamp.
  const clamped = Math.max(0, Math.min(1, score));
  return clamped.toFixed(2);
}

function formatBand(band: number): string {
  // Bands are ± deltas — same precision as scores.
  return Math.abs(band).toFixed(2);
}

export function MethodBadge({
  method,
  score,
  band,
  compact = false,
  title,
}: Props) {
  const v = TIER_VISUAL[method];
  const hasScore = typeof score === "number" && Number.isFinite(score);
  const hasBand = typeof band === "number" && Number.isFinite(band);

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        background: appleVibe.surface.chip,
        color: appleVibe.text.secondary,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        fontFamily: appleVibe.font.stack,
        letterSpacing: "0.01em",
        // Tabular-nums keeps the score digits aligned across rows in
        // a list. Critical when comparing variations at a glance.
        fontVariantNumeric: "tabular-nums",
      }}
      title={title ?? v.explainer}
    >
      <span aria-hidden style={{ fontSize: "11px", lineHeight: 1 }}>
        {v.emoji}
      </span>
      {!compact && (
        <span style={{ color: appleVibe.text.tertiary }}>{v.label}</span>
      )}
      {hasScore && (
        <span
          style={{
            color: appleVibe.text.primary,
            fontWeight: 600,
          }}
        >
          {!compact && "· "}
          {formatScore(score!)}
          {hasBand && (
            <span style={{ color: appleVibe.text.tertiary, fontWeight: 400 }}>
              {" "}± {formatBand(band!)}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
