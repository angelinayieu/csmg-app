// ── Domain auto-detection (Phase 2A) ──
//
// The library's behavior should adapt to the kind of space the user
// is working in — WITHOUT asking them to declare it. Research spaces
// care about evidence density + concept diversity; operations spaces
// care about metrics + goal proximity; dev spaces care about
// tool/artifact chains.
//
// This module inspects a space's entity composition, synthesis state,
// and goal structure to classify it into one of 6 domains, then
// exposes a weights profile that the dominance scorer uses to rank
// items appropriately.
//
// The detection is DETERMINISTIC — same inputs always produce the
// same domain. No AI calls, no surprise. If the classifier is wrong,
// the user overrides it once in settings and future catalog loads
// respect the override (override storage is Phase 2B).

import type { Entity } from "@/types";
import type { ImprovementGoal } from "@/types/goals";
import {
  classifyEntityKind,
  kindDistribution,
  type EntityKind,
} from "./kind-classifier";

export type SpaceDomain =
  | "research"     // Evidence-heavy. Scientific, academic, literature review.
  | "operations"   // Metric-heavy. KPIs, monitoring, SLOs, dashboards.
  | "development"  // Tool + artifact heavy. CS dev, engineering systems.
  | "planning"    // Actor + goal focused. Personal life, team planning.
  | "strategy"    // Balanced concept + observation. Business strategy.
  | "general";    // No dominant signal — ship neutral defaults.

export interface DomainWeightProfile {
  centrality: number;
  intersections: number;
  leverage: number;
  goal_proximity: number;
}

export interface DomainProfile {
  /** Human-readable label surfaced in the drawer header. Quiet, not loud. */
  label: string;
  /** 1-sentence description — shown on hover of the domain badge. */
  description: string;
  /** Dominance weighting calibrated for this domain. */
  weights: DomainWeightProfile;
  /** Preferred filter kinds for this domain (surfaced as "starter filter" chip). */
  priority_kinds: EntityKind[];
  /** Default sort column in the Table view. */
  default_sort: "dominance" | "name" | "kind" | "upstream" | "downstream" | "chains" | "cost";
}

// ── Per-domain profiles ───────────────────────────────────────────────
//
// Weights are calibrated so the TOP of the ranked list matches the
// user's expectation in each domain:
//
//   research     → high intersections (cross-disciplinary findings matter)
//                  + modest leverage (AI flags are often noise for scientists)
//   operations   → high goal_proximity (what's driving the metric?)
//                  + high leverage (synthesis is trustworthy for ops)
//   development  → high centrality (core tools > peripheral)
//                  + high goal_proximity (what's blocking the sprint?)
//   planning     → high goal_proximity by far (actions should flow to goals)
//                  + modest centrality (not every idea is central)
//   strategy     → balanced
//   general      → even split (default weights)

export const DOMAIN_PROFILES: Record<SpaceDomain, DomainProfile> = {
  research: {
    label: "Research",
    description: "Evidence-heavy space. Ranking favors cross-disciplinary findings over AI leverage flags.",
    weights: {
      centrality: 0.2,
      intersections: 0.4,
      leverage: 0.15,
      goal_proximity: 0.25,
    },
    priority_kinds: ["evidence", "concept", "metric"],
    default_sort: "dominance",
  },
  operations: {
    label: "Operations",
    description: "Metric + monitoring space. Ranking favors goal-driving signals.",
    weights: {
      centrality: 0.2,
      intersections: 0.2,
      leverage: 0.3,
      goal_proximity: 0.3,
    },
    priority_kinds: ["metric", "tool", "observation"],
    default_sort: "dominance",
  },
  development: {
    label: "Development",
    description: "Tools + artifacts. Ranking favors core systems and sprint-blocking items.",
    weights: {
      centrality: 0.35,
      intersections: 0.2,
      leverage: 0.15,
      goal_proximity: 0.3,
    },
    priority_kinds: ["tool", "artifact", "concept"],
    default_sort: "downstream",
  },
  planning: {
    label: "Planning",
    description: "Goal-centric space. Ranking favors items closest to your intentions.",
    weights: {
      centrality: 0.2,
      intersections: 0.15,
      leverage: 0.2,
      goal_proximity: 0.45,
    },
    priority_kinds: ["observation", "actor", "concept"],
    default_sort: "dominance",
  },
  strategy: {
    label: "Strategy",
    description: "Balanced concepts + observations. Ranking balances all signals equally.",
    weights: {
      centrality: 0.3,
      intersections: 0.25,
      leverage: 0.25,
      goal_proximity: 0.2,
    },
    priority_kinds: ["concept", "observation", "metric"],
    default_sort: "dominance",
  },
  general: {
    label: "General",
    description: "No dominant domain detected. Using balanced default ranking.",
    weights: {
      centrality: 0.3,
      intersections: 0.25,
      leverage: 0.25,
      goal_proximity: 0.2,
    },
    priority_kinds: [],
    default_sort: "dominance",
  },
};

export interface DomainDetectionInputs {
  entities: readonly Entity[];
  goals: readonly ImprovementGoal[];
  /** Whether the space has run at least one synthesis pass. */
  synthesis_available: boolean;
}

export interface DomainDetectionResult {
  domain: SpaceDomain;
  profile: DomainProfile;
  /** Distribution used for the decision — exposed for UI debugging. */
  distribution: Record<EntityKind, number>;
  /** Normalized ratios (each / total). */
  ratios: Record<EntityKind, number>;
  /** Confidence in the detection (0–1). <0.4 = fall back to general. */
  confidence: number;
}

/**
 * Classify a space into one of 6 domains based on its entity
 * composition, goal structure, and synthesis state.
 *
 * Rules run in priority order. First match wins. The thresholds
 * below were tuned against sample spaces — may need calibration as
 * the dataset grows.
 */
export function detectDomain(
  inputs: DomainDetectionInputs,
): DomainDetectionResult {
  const { entities, goals, synthesis_available } = inputs;
  const total = Math.max(1, entities.length);
  const distribution = kindDistribution(entities);

  const ratios: Record<EntityKind, number> = {
    tool: distribution.tool / total,
    evidence: distribution.evidence / total,
    metric: distribution.metric / total,
    observation: distribution.observation / total,
    concept: distribution.concept / total,
    actor: distribution.actor / total,
    artifact: distribution.artifact / total,
  };

  const activeGoals = goals.filter(
    (g) => (g.status as string) === "active" || (g.status as string) === "proposed",
  ).length;

  // ── Rule chain (priority order) ────────────────────────────────────
  let domain: SpaceDomain = "general";
  let confidence = 0;

  // 1. Research — evidence dominant (>35%) or evidence + concept heavy
  if (ratios.evidence >= 0.35) {
    domain = "research";
    confidence = Math.min(1, 0.6 + (ratios.evidence - 0.35) * 2);
  } else if (ratios.evidence >= 0.2 && ratios.concept >= 0.2) {
    domain = "research";
    confidence = 0.55;
  }
  // 2. Development — tools + artifacts dominant
  else if (ratios.tool + ratios.artifact >= 0.5) {
    domain = "development";
    confidence = Math.min(1, 0.6 + (ratios.tool + ratios.artifact - 0.5) * 1.5);
  } else if (ratios.artifact >= 0.3) {
    domain = "development";
    confidence = 0.55;
  }
  // 3. Operations — metrics heavy + goals present + synthesis run
  else if (ratios.metric >= 0.35 && activeGoals > 0 && synthesis_available) {
    domain = "operations";
    confidence = Math.min(1, 0.65 + (ratios.metric - 0.35) * 2);
  } else if (ratios.metric >= 0.45) {
    domain = "operations";
    confidence = 0.55;
  }
  // 4. Planning — actor + multi-goal
  else if (ratios.actor >= 0.15 && activeGoals >= 2) {
    domain = "planning";
    confidence = Math.min(1, 0.6 + Math.min(0.2, (activeGoals - 2) * 0.05));
  } else if (activeGoals >= 3 && ratios.observation >= 0.25) {
    domain = "planning";
    confidence = 0.55;
  }
  // 5. Strategy — balanced concept + observation
  else if (ratios.concept >= 0.25 && ratios.observation >= 0.25) {
    domain = "strategy";
    confidence = 0.5;
  }

  // Low-confidence → fall back to general
  if (confidence < 0.4) {
    domain = "general";
    confidence = 0;
  }

  return {
    domain,
    profile: DOMAIN_PROFILES[domain],
    distribution,
    ratios,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Given distribution ratios, return the top-N priority kinds — useful
 * for auto-applying a starter filter when the drawer opens. Ranks by
 * the profile's priority_kinds order, filtered to kinds that exist
 * in the space with non-trivial share (>10%).
 */
export function pickStarterKinds(
  profile: DomainProfile,
  ratios: Record<EntityKind, number>,
  maxKinds = 2,
): EntityKind[] {
  return profile.priority_kinds
    .filter((k) => ratios[k] >= 0.1)
    .slice(0, maxKinds);
}
