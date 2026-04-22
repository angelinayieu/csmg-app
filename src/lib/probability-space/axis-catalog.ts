// ── Probability space axis catalog (Phase 2E · Tier 2) ──
//
// Metadata for each of the 8 canonical probability-space axes.
// Centralized so the frame extractor, the space-shell UI, and any
// future per-axis generators all read from one source. Adding a new
// axis = one new entry here.
//
// The catalog is deliberately opinionated: each axis has a short
// tagline, a distinct accent color, and a prompting hint that tells
// the LLM what to focus on when generating entities for that space.

import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export interface AxisMeta {
  axis: ProbabilitySpaceAxis;
  label: string;
  tagline: string;
  accent: string;
  /**
   * Short description fed to the frame extractor so it can decide
   * whether this axis applies to a given input. Kept to one line
   * so prompt size stays manageable when all 8 are included.
   */
  applies_when: string;
  /**
   * Short description fed to the per-axis generator. Tells the LLM
   * what KIND of entities + claims to produce when this axis is the
   * active lens. Not shown in UI.
   */
  generator_focus: string;
}

export const AXIS_CATALOG: Record<ProbabilitySpaceAxis, AxisMeta> = {
  financial: {
    axis: "financial",
    label: "Financial",
    tagline: "Money in / money out / runway",
    accent: "#D97706", // amber
    applies_when:
      "Input involves revenue, cost, runway, pricing, unit economics, or capital decisions.",
    generator_focus:
      "Numeric drivers with distributions when possible. CAC, LTV, churn, burn, ARR, margin, runway months.",
  },
  timeline: {
    axis: "timeline",
    label: "Timeline",
    tagline: "Short / medium / long horizons",
    accent: "#0891B2", // cyan
    applies_when:
      "Input involves planning horizons, decision deadlines, phased rollouts, or horizon-sensitive outcomes.",
    generator_focus:
      "Phases, milestones, decision gates, time-to-X estimates with ranges. Distinguishes short-term vs long-term consequences.",
  },
  actors: {
    axis: "actors",
    label: "Actors",
    tagline: "People, teams, competitors, customers",
    accent: "#16A34A", // green
    applies_when:
      "Input involves specific people, teams, customer segments, competitors, or organizational roles.",
    generator_focus:
      "Named stakeholders + their incentives, influence, and relationships. Customer personas. Team composition.",
  },
  causal_scenarios: {
    axis: "causal_scenarios",
    label: "Scenarios",
    tagline: "Optimistic / base / pessimistic branches",
    accent: "#8B5CF6", // violet
    applies_when: "Input has uncertain outcomes with meaningfully different branches.",
    generator_focus:
      "Three scenarios minimum (optimistic / base / pessimistic). Mechanisms that differentiate each branch. Trigger conditions.",
  },
  evidence: {
    axis: "evidence",
    label: "Evidence",
    tagline: "Data, references, base rates",
    accent: "#0284C7", // blue
    applies_when:
      "Input is research-heavy, cites external claims, or benefits from reference-class calibration.",
    generator_focus:
      "Citable claims, data points, base rates from similar situations. Explicit sources when known. Gaps where evidence is missing.",
  },
  assumptions: {
    axis: "assumptions",
    label: "Assumptions",
    tagline: "Load-bearing beliefs pressure-tested",
    accent: "#EA580C", // orange-red
    applies_when: "Always applies — every situation has load-bearing assumptions.",
    generator_focus:
      "Explicit axioms: what we're taking for granted. For each: what changes if false? Load-bearing vs cosmetic.",
  },
  risk: {
    axis: "risk",
    label: "Risk",
    tagline: "Failure modes + downside exposure",
    accent: "#DC2626", // red
    applies_when:
      "Input involves consequential decisions with downside risk, irreversibility, or blast radius.",
    generator_focus:
      "Named failure modes with likelihood + severity. Mitigations. Black-swan possibilities flagged explicitly.",
  },
  cultural: {
    axis: "cultural",
    label: "Cultural",
    tagline: "Values, tensions, identity, norms",
    accent: "#EC4899", // pink
    applies_when:
      "Input involves personal values, team culture, relational dynamics, identity, or norm-laden choices.",
    generator_focus:
      "Named tensions + values. Identity-level concerns. Cultural / norm constraints. Not numeric.",
  },
};

/**
 * Axes that apply to every input regardless of content. Currently
 * just "assumptions" — surfacing load-bearing beliefs is valuable
 * for any question. The frame extractor always includes this.
 */
export const ALWAYS_APPLICABLE_AXES: ProbabilitySpaceAxis[] = [
  "assumptions",
];

/**
 * Convenience lookup — the full ordered list of axes as they'd
 * appear when all 8 are active. Used as a fallback layout order
 * when the frame extractor returns axes in a non-canonical order.
 */
export const AXIS_ORDER: ProbabilitySpaceAxis[] = [
  "financial",
  "timeline",
  "actors",
  "causal_scenarios",
  "evidence",
  "assumptions",
  "risk",
  "cultural",
];
