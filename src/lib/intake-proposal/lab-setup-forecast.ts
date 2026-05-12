// buildLabSetupForecast — derives the Lab Setup pane payload purely
// from the kg_generation_plan + the space's research-template (B1/B4).
//
// Design rule: NO LLM CALLS at intake-proposal time. The pane shows
// what KIND of lab the user is about to commission — which is fully
// determined by:
//   - the template's preferred_mechanism_kinds (B4) — universe of
//     widgets the lab will support
//   - the template's preferred_probability_space_axes (B1) — universe
//     of axes the frame extractor may select from
//   - the plan's conceptual_skeleton.anticipated_clusters — count of
//     expected entity clusters
//   - the plan's research_plan.papers + coverage_gaps — what evidence
//     base the lab will be calibrated against
//
// Specific apps + mechanisms + agent_specs aren't yet known (they
// emerge from the strategy LLM AFTER decompose / synthesize / strategize
// runs). The forecast is honest about that: "≥N apps will be auto-
// generated based on strategy synthesis", not "you'll get exactly these
// apps." See MECHANISM_KIND_DESCRIPTORS for the kind-level copy.

import type { KgGenerationPlan } from "@/types/kg-generation-plan";
import type { ResearchTemplate } from "@/types/research-template";
import type { MechanismHint } from "@/types/strategy";
import {
  MECHANISM_KIND_DESCRIPTORS,
  ALL_MECHANISM_KINDS,
  type MechanismKindDescriptor,
} from "./mechanism-kind-descriptors";

export type ProbabilitySpaceAxisSlug =
  | "financial"
  | "timeline"
  | "actors"
  | "causal_scenarios"
  | "evidence"
  | "assumptions"
  | "risk"
  | "cultural";

const AXIS_LABELS: Record<ProbabilitySpaceAxisSlug, string> = {
  financial: "Financial",
  timeline: "Timeline",
  actors: "Actors",
  causal_scenarios: "Causal scenarios",
  evidence: "Evidence base",
  assumptions: "Assumptions",
  risk: "Risk surface",
  cultural: "Cultural",
};

const AXIS_DESCRIPTIONS: Record<ProbabilitySpaceAxisSlug, string> = {
  financial: "Cost, ROI, budget constraints framing every decision.",
  timeline: "When effects land, persistence, and onset profile.",
  actors: "Who's involved, their motivations, and decision authority.",
  causal_scenarios: "Possible cause-effect chains and their branchings.",
  evidence: "Strength + provenance of supporting data.",
  assumptions: "Unstated premises the model is conditioned on.",
  risk: "Failure modes, side effects, and worst-case branches.",
  cultural: "Norms, identity, and contextual meaning.",
};

const ALL_AXES: ReadonlyArray<ProbabilitySpaceAxisSlug> = [
  "financial",
  "timeline",
  "actors",
  "causal_scenarios",
  "evidence",
  "assumptions",
  "risk",
  "cultural",
];

export interface LabSetupForecastAxisCard {
  slug: ProbabilitySpaceAxisSlug;
  label: string;
  description: string;
}

export interface LabSetupForecast {
  /** Mechanism kinds the lab will support (filtered by template if any). */
  mechanism_cards: MechanismKindDescriptor[];
  /** Probability-space axes the frame extractor may populate. */
  axis_cards: LabSetupForecastAxisCard[];
  /** Lower bound on app count: at least one per anticipated cluster. */
  expected_app_count_min: number;
  /** Upper bound: clusters * 2 (one app per cluster + an instrument
   *  app per outcome cluster, give or take). Intentionally loose so
   *  copy reads honest. */
  expected_app_count_max: number;
  /** How many papers will feed the calibration baseline. */
  paper_count: number;
  /** How many gap-areas the planner flagged that lack paper coverage. */
  coverage_gap_count: number;
  /** True when the template restricted the mechanism universe. */
  filtered_by_template: boolean;
  /** Template slug (for debug + UI footer). */
  template_slug: string | null;
}

interface BuildArgs {
  plan: KgGenerationPlan;
  template: ResearchTemplate | null;
}

export function buildLabSetupForecast({
  plan,
  template,
}: BuildArgs): LabSetupForecast {
  const preferredKinds = template?.preferred_mechanism_kinds ?? null;
  const filteredByTemplate =
    Array.isArray(preferredKinds) && preferredKinds.length > 0;

  const kinds: ReadonlyArray<MechanismHint> = filteredByTemplate
    ? (preferredKinds as MechanismHint[])
    : ALL_MECHANISM_KINDS;

  const mechanism_cards = kinds
    .map((k) => MECHANISM_KIND_DESCRIPTORS[k])
    .filter((d): d is MechanismKindDescriptor => Boolean(d));

  const preferredAxes = template?.preferred_probability_space_axes ?? null;
  const axes: ReadonlyArray<ProbabilitySpaceAxisSlug> =
    preferredAxes && preferredAxes.length > 0
      ? (preferredAxes as ProbabilitySpaceAxisSlug[])
      : ALL_AXES;

  const axis_cards: LabSetupForecastAxisCard[] = axes.map((slug) => ({
    slug,
    label: AXIS_LABELS[slug],
    description: AXIS_DESCRIPTIONS[slug],
  }));

  const clusters = plan.conceptual_skeleton?.anticipated_clusters ?? [];
  const expected_app_count_min = clusters.length;
  // 1 app per cluster + 1 instrument-app per outcome-bearing cluster
  // (heuristic) — capped at 12 so the upper bound stays sane.
  const outcomeClusters = clusters.filter((c) =>
    c.expected_node_kinds?.some((k) =>
      /outcome|symptom|composite|cognitive/i.test(k),
    ),
  );
  const expected_app_count_max = Math.min(
    12,
    clusters.length + outcomeClusters.length,
  );

  const paper_count = plan.research_plan?.papers?.length ?? 0;
  const coverage_gap_count = plan.research_plan?.coverage_gaps?.length ?? 0;

  return {
    mechanism_cards,
    axis_cards,
    expected_app_count_min,
    expected_app_count_max,
    paper_count,
    coverage_gap_count,
    filtered_by_template: filteredByTemplate,
    template_slug: template?.slug ?? null,
  };
}
