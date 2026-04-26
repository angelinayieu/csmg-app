// ── Probability space axis catalog (Phase 2E · Tier 2) ──
//
// Metadata for each of the 8 canonical probability-space axes.
// Centralized so the frame extractor, the space-shell UI, and all
// per-axis generators read from one source. Adding a new canonical
// axis = one new entry here.
//
// Phase 2E · Axis Richness (2026-04-24):
//   • `AxisMeta` now extends `AxisSpec` (src/lib/probability-space/
//     axis-spec.ts) to carry dimension, instrument_kind, output_shape,
//     preconditions, prompt_variants, failure_mode, degrade_to, and
//     cost_profile in addition to the legacy UI shell metadata.
//   • Ad-hoc axes (minted by the framing panel) use the same
//     `AxisSpec` shape so the generator route can handle catalog +
//     ad-hoc uniformly via a single well-typed payload.
//   • Variant hints (e.g. financial / unit_economics vs runway) are
//     picked up by the generator from `AxisProposal.prompt_variant`
//     in the SituationFrame and cross-referenced against
//     `prompt_variants` here.

import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type { AxisSpec } from "./axis-spec";

/**
 * Catalog-only metadata. Carries everything AxisSpec does + narrows
 * `axis` to the canonical 8-member union. Legacy consumers that
 * imported the old flat shape continue to compile (all prior fields
 * are still present).
 */
export interface AxisMeta extends AxisSpec {
  axis: ProbabilitySpaceAxis;
}

export const AXIS_CATALOG: Record<ProbabilitySpaceAxis, AxisMeta> = {
  financial: {
    axis: "financial",
    axis_id: "financial",
    label: "Financial",
    tagline: "Money in / money out / runway",
    accent: "#D97706", // amber
    applies_when:
      "Input involves revenue, cost, runway, pricing, unit economics, or capital decisions.",
    generator_focus:
      "Numeric drivers with distributions when possible. CAC, LTV, churn, burn, ARR, margin, runway months.",
    dimension: "money",
    instrument_kind: "calibration",
    output_shape: "numeric_with_distribution",
    hard_preconditions: [
      "Input contains at least one explicit number or monetary unit (price, cost, revenue, margin, burn).",
      "OR upstream data_presence tagged `has_telemetry`, `has_historical_output`, or `has_baseline`.",
    ],
    soft_preconditions: [
      "Input mentions a market, customer segment, or pricing posture.",
      "User intent classified as decision or evaluation.",
    ],
    prompt_variants: {
      payback_period: {
        id: "payback_period",
        label: "Payback period",
        focus_delta:
          "Focus on cash-out vs cash-in timing: upfront cost, monthly cash flow, breakeven month, sensitivity to volume or price. Phase-map the capital recovery curve.",
        output_shape_override: "temporal_phase_map",
      },
      unit_economics: {
        id: "unit_economics",
        label: "Unit economics",
        focus_delta:
          "Focus on per-unit / per-customer economics: CAC, LTV, LTV:CAC, gross margin per unit, contribution margin, payback per cohort. Flag the unit whose variance matters most.",
      },
      runway_pressure: {
        id: "runway_pressure",
        label: "Runway pressure",
        focus_delta:
          "Focus on burn, cash on hand, months of runway, decision deadlines imposed by runway, and which levers (price, cost, fundraising) can extend it.",
      },
      opportunity_cost: {
        id: "opportunity_cost",
        label: "Opportunity cost",
        focus_delta:
          "Focus on what capital / time / attention this choice forecloses. Name the explicit alternative use and its expected return. Frame as comparative, not absolute.",
      },
    },
    failure_mode:
      "Financial without numeric input degenerates into generic cost/revenue platitudes ('watch CAC', 'grow margin') with no mechanism tied to the situation.",
    degrade_to: "assumptions",
    cost_profile: { tokens_estimate: 5500, seconds_estimate: 30 },
  },
  timeline: {
    axis: "timeline",
    axis_id: "timeline",
    label: "Timeline",
    tagline: "Short / medium / long horizons",
    accent: "#0891B2", // cyan
    applies_when:
      "Input involves planning horizons, decision deadlines, phased rollouts, or horizon-sensitive outcomes.",
    generator_focus:
      "Phases, milestones, decision gates, time-to-X estimates with ranges. Distinguishes short-term vs long-term consequences.",
    dimension: "time",
    instrument_kind: "stratification",
    output_shape: "temporal_phase_map",
    hard_preconditions: [
      "Input references a time horizon, deadline, phase, or sequencing.",
      "OR the question type is decision or design and the outcome unfolds over time.",
    ],
    soft_preconditions: [
      "Input mentions irreversibility, optionality windows, or dependencies.",
    ],
    prompt_variants: {
      phase_gates: {
        id: "phase_gates",
        label: "Phase gates",
        focus_delta:
          "Focus on discrete gates: what signal must land to unlock phase N+1, what happens if it doesn't arrive by when. Milestones and their prerequisites.",
      },
      leading_lagging: {
        id: "leading_lagging",
        label: "Leading vs lagging",
        focus_delta:
          "Focus on leading indicators that predict outcomes vs lagging indicators that confirm them. By the time the lagging signal is visible, what was already set N quarters ago?",
      },
      irreversibility_map: {
        id: "irreversibility_map",
        label: "Irreversibility map",
        focus_delta:
          "Focus on decisions that close options. For each: the point of no return, the cost of reversal, the earliest detectable regret signal.",
      },
    },
    failure_mode:
      "Timeline without horizon-sensitive content produces vague 'short/medium/long-term' buckets with no differentiated mechanism per horizon.",
    degrade_to: "causal_scenarios",
    cost_profile: { tokens_estimate: 4500, seconds_estimate: 25 },
  },
  actors: {
    axis: "actors",
    axis_id: "actors",
    label: "Actors",
    tagline: "People, teams, competitors, customers",
    accent: "#16A34A", // green
    applies_when:
      "Input involves specific people, teams, customer segments, competitors, or organizational roles.",
    generator_focus:
      "Named stakeholders + their incentives, influence, and relationships. Customer personas. Team composition.",
    dimension: "people",
    instrument_kind: "stratification",
    output_shape: "named_stakeholder_set",
    hard_preconditions: [
      "Input names at least one actor, role, segment, or organization.",
      "OR the situation obviously involves multiple parties (markets, coalitions, teams).",
    ],
    soft_preconditions: [
      "Input suggests coordination problems, misaligned incentives, or information asymmetry.",
    ],
    prompt_variants: {
      incentive_map: {
        id: "incentive_map",
        label: "Incentive map",
        focus_delta:
          "Focus on what each actor optimizes for, where their incentives pull AGAINST the nominal goal of the situation, and what would shift them.",
      },
      veto_players: {
        id: "veto_players",
        label: "Veto players",
        focus_delta:
          "Focus on actors whose consent is REQUIRED for the outcome to occur. For each: what they'd block on, what would satisfy them, secured vs unsecured.",
      },
      segmentation: {
        id: "segmentation",
        label: "Segmentation",
        focus_delta:
          "Decompose broad labels (e.g. 'customers', 'users') into sub-segments with distinct mental models, switching costs, and default actions.",
      },
    },
    failure_mode:
      "Actors without specific named parties produces generic personas ('the user', 'the team') with no decision-relevant differentiation.",
    degrade_to: "cultural",
    cost_profile: { tokens_estimate: 5500, seconds_estimate: 30 },
  },
  causal_scenarios: {
    axis: "causal_scenarios",
    axis_id: "causal_scenarios",
    label: "Scenarios",
    tagline: "Optimistic / base / pessimistic branches",
    accent: "#8B5CF6", // violet
    applies_when: "Input has uncertain outcomes with meaningfully different branches.",
    generator_focus:
      "Three scenarios minimum (optimistic / base / pessimistic). Mechanisms that differentiate each branch. Trigger conditions.",
    dimension: "causation",
    instrument_kind: "counterfactual",
    output_shape: "scenario_tree",
    hard_preconditions: [
      "Outcome is not fully determined by input — there are meaningfully different futures worth naming.",
    ],
    soft_preconditions: [
      "Input references uncertainty, probability, or multiple possible outcomes.",
      "Question type is prediction, decision, or exploration.",
    ],
    prompt_variants: {
      optimistic_base_pessimistic: {
        id: "optimistic_base_pessimistic",
        label: "Opt / base / pess",
        focus_delta:
          "Three canonical branches with DIFFERENT causal mechanisms — not just 'better' or 'worse' versions of the same story.",
      },
      fork_point_trace: {
        id: "fork_point_trace",
        label: "Fork-point trace",
        focus_delta:
          "Focus on the SPECIFIC variable or event whose value sends the system down one branch vs another. Name the fork, the threshold, the earliest observable of each side.",
      },
      feedback_loop_dynamics: {
        id: "feedback_loop_dynamics",
        label: "Feedback loops",
        focus_delta:
          "Focus on the reinforcing + balancing loops that amplify or dampen each scenario. Name the loop, its gain, and the conditions that activate it.",
      },
    },
    failure_mode:
      "Causal scenarios without mechanism degenerate into three-adjective branches ('things go well / okay / badly') with no differentiating causal chain.",
    degrade_to: "risk",
    cost_profile: { tokens_estimate: 7500, seconds_estimate: 40 },
  },
  evidence: {
    axis: "evidence",
    axis_id: "evidence",
    label: "Evidence",
    tagline: "Data, references, base rates",
    accent: "#0284C7", // blue
    applies_when:
      "Input is research-heavy, cites external claims, or benefits from reference-class calibration.",
    generator_focus:
      "Citable claims, data points, base rates from similar situations. Explicit sources when known. Gaps where evidence is missing.",
    dimension: "truth",
    instrument_kind: "evidentiary",
    output_shape: "claim_ledger",
    hard_preconditions: [
      "Input makes at least one factual claim or references external data.",
      "OR the question type is analysis, diagnosis, or evaluation.",
    ],
    soft_preconditions: [
      "Input gestures at references, data, studies, or historical analogs.",
    ],
    prompt_variants: {
      claim_audit: {
        id: "claim_audit",
        label: "Claim audit",
        focus_delta:
          "Walk every claim in the input: empirical / theoretical / anecdotal / assumed. For each: source quality, load-bearing vs cosmetic, what would flip it.",
      },
      base_rate_reference: {
        id: "base_rate_reference",
        label: "Base-rate reference",
        focus_delta:
          "Focus on reference classes: what historical analogs exist for this situation, what's their outcome distribution, where does this case sit in it.",
      },
      falsifiability_probe: {
        id: "falsifiability_probe",
        label: "Falsifiability probe",
        focus_delta:
          "For each claim in the input: what observation would disconfirm it? If no observation could, flag the claim as non-falsifiable.",
      },
    },
    failure_mode:
      "Evidence without claims to audit produces a list of 'things to research' rather than an epistemic audit of what's already asserted.",
    degrade_to: "assumptions",
    cost_profile: { tokens_estimate: 4500, seconds_estimate: 25 },
  },
  assumptions: {
    axis: "assumptions",
    axis_id: "assumptions",
    label: "Assumptions",
    tagline: "Load-bearing beliefs pressure-tested",
    accent: "#EA580C", // orange-red
    applies_when: "Always applies — every situation has load-bearing assumptions.",
    generator_focus:
      "Explicit axioms: what we're taking for granted. For each: what changes if false? Load-bearing vs cosmetic.",
    dimension: "truth",
    instrument_kind: "decomposition",
    output_shape: "assumption_ledger",
    hard_preconditions: [
      "Always — every situation rests on beliefs worth surfacing.",
    ],
    soft_preconditions: [],
    prompt_variants: {
      hidden_axioms: {
        id: "hidden_axioms",
        label: "Hidden axioms",
        focus_delta:
          "Surface assumptions NOT stated but required for the situation to cohere ('this market exists', 'users want this', 'regulators will allow this').",
      },
      if_false_counterfactual: {
        id: "if_false_counterfactual",
        label: "If-false counterfactual",
        focus_delta:
          "For each load-bearing assumption: what specifically breaks if it's wrong? Rank by blast radius.",
      },
      cheap_test: {
        id: "cheap_test",
        label: "Cheap tests",
        focus_delta:
          "For each assumption: what's the cheapest experiment or observation that would invalidate it? Prefer tests decidable within one week.",
      },
    },
    failure_mode:
      "Assumptions restated from the input's stated premises = zero information. Must surface what's silent but load-bearing.",
    degrade_to: null,
    cost_profile: { tokens_estimate: 4000, seconds_estimate: 22 },
  },
  risk: {
    axis: "risk",
    axis_id: "risk",
    label: "Risk",
    tagline: "Failure modes + downside exposure",
    accent: "#DC2626", // red
    applies_when:
      "Input involves consequential decisions with downside risk, irreversibility, or blast radius.",
    generator_focus:
      "Named failure modes with likelihood + severity. Mitigations. Black-swan possibilities flagged explicitly.",
    dimension: "risk",
    instrument_kind: "constraint",
    output_shape: "failure_mode_catalog",
    hard_preconditions: [
      "Outcome carries downside exposure — consequential decision, irreversible commitment, or non-trivial blast radius.",
    ],
    soft_preconditions: [
      "Input mentions adversaries, competitors, regulators, or dependency risk.",
    ],
    prompt_variants: {
      reversibility: {
        id: "reversibility",
        label: "Reversibility",
        focus_delta:
          "For each failure mode: is the damage reversible? What's the exit cost? Rank by irreversibility, not likelihood.",
      },
      cascading_failure: {
        id: "cascading_failure",
        label: "Cascading failure",
        focus_delta:
          "Focus on how primary failures propagate: secondary + tertiary effects, correlated failure modes, feedback amplification.",
      },
      tail_risk: {
        id: "tail_risk",
        label: "Tail risk",
        focus_delta:
          "Focus on rare-but-catastrophic outcomes the base-rate analysis would ignore. Low frequency × high severity = the risk that matters.",
      },
      early_warning: {
        id: "early_warning",
        label: "Early warning",
        focus_delta:
          "For each failure mode: earliest observable signal it's starting. Focus on leading indicators the user could actually monitor.",
      },
    },
    failure_mode:
      "Risk without a specific failure path produces generic hedges ('market might shift', 'execution risk') instead of named mechanisms.",
    degrade_to: "assumptions",
    cost_profile: { tokens_estimate: 5500, seconds_estimate: 30 },
  },
  cultural: {
    axis: "cultural",
    axis_id: "cultural",
    label: "Cultural",
    tagline: "Values, tensions, identity, norms",
    accent: "#EC4899", // pink
    applies_when:
      "Input involves personal values, team culture, relational dynamics, identity, or norm-laden choices.",
    generator_focus:
      "Named tensions + values. Identity-level concerns. Cultural / norm constraints. Not numeric.",
    dimension: "meaning",
    instrument_kind: "enumeration",
    output_shape: "norm_and_identity_map",
    hard_preconditions: [
      "Input involves values, identity, relationships, norms, or sociotechnical dynamics.",
    ],
    soft_preconditions: [
      "Input mentions 'feel', meaning, legitimacy, taboo, or status.",
    ],
    prompt_variants: {
      norm_enforcement: {
        id: "norm_enforcement",
        label: "Norm enforcement",
        focus_delta:
          "For each norm: who enforces it, through what mechanism, what breaks it. Concrete behaviors, not abstract values.",
      },
      identity_stakes: {
        id: "identity_stakes",
        label: "Identity stakes",
        focus_delta:
          "Focus on what's at stake for the actors' identities. Which actions would violate self-image? Which would reinforce it?",
      },
      memetic_dynamics: {
        id: "memetic_dynamics",
        label: "Memetic dynamics",
        focus_delta:
          "Focus on narrative, framing, and how ideas spread in this context. What's the dominant frame? What's taboo to name?",
      },
    },
    failure_mode:
      "Cultural without concrete mechanism becomes vibes-talk ('team culture matters') with no behavior, no enforcer, no consequence.",
    degrade_to: "actors",
    cost_profile: { tokens_estimate: 4500, seconds_estimate: 25 },
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
