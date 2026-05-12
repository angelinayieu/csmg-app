// Descriptor catalog for the 7 MechanismHint kinds, used by the
// proposal page's Lab Setup pane to render a forecast of WHAT KIND OF
// LAB the user is about to build before they approve the plan.
//
// These descriptors mirror the in-pipeline rationales in
// src/lib/pipeline/materialize-mechanisms.ts so the user sees the same
// language pre- and post-approval — no rebranding mid-flow.
//
// "Forecast" is the right word: at intake time we don't yet know which
// specific mechanisms will materialize (that depends on the strategy
// LLM, which runs after KG analysis). What we DO know is the universe
// of mechanism KINDS that this template permits, so we render those
// kinds with honest "you'll get a {kind} surface for each strategy
// proposal of {kind} type" copy.

import type { MechanismHint } from "@/types/strategy";

export interface MechanismKindDescriptor {
  kind: MechanismHint;
  /** Short user-facing title (rendered as the card heading). */
  title: string;
  /** One-sentence what-it-does (rendered under the title). */
  one_liner: string;
  /** "What you'll be able to do" — outcome-focused, max ~140 chars. */
  capability: string;
  /** Hex accent for the card chip. */
  accent: string;
  /** Lucide icon name (matched by the pane component to a static map). */
  icon:
    | "Beaker"
    | "TrendingUp"
    | "ShieldCheck"
    | "Activity"
    | "AlertTriangle"
    | "Gamepad2"
    | "Sparkles";
}

export const MECHANISM_KIND_DESCRIPTORS: Record<
  MechanismHint,
  MechanismKindDescriptor
> = {
  simulation: {
    kind: "simulation",
    title: "Simulation lab",
    one_liner:
      "Run what-if scenarios on the knowledge graph using a Monte-Carlo engine.",
    capability:
      "Sweep an intervention dose, perturb a driver, see the distribution of downstream effects play out.",
    accent: "#6366F1",
    icon: "Beaker",
  },
  prediction: {
    kind: "prediction",
    title: "Prediction panel",
    one_liner:
      "Agents place forecasts with a resolution horizon and confidence band.",
    capability:
      "Every forecast lands in the prediction ledger so accuracy can be scored when the horizon arrives.",
    accent: "#0EA5E9",
    icon: "TrendingUp",
  },
  validation: {
    kind: "validation",
    title: "Validation lab",
    one_liner:
      "Test hypotheses against the KG's reality-calibration baseline.",
    capability:
      "Pose a falsifiable claim, run it past the calibration gate, see whether the data supports or contradicts it.",
    accent: "#10B981",
    icon: "ShieldCheck",
  },
  baseline_tracking: {
    kind: "baseline_tracking",
    title: "Baseline tracker",
    one_liner:
      "Anchor every metric to a measured starting state, not absolute numbers.",
    capability:
      "Progress is reported as deltas from a snapshot taken at the start, so improvements are honest.",
    accent: "#A855F7",
    icon: "Activity",
  },
  deviation_capture: {
    kind: "deviation_capture",
    title: "Deviation feed",
    one_liner:
      "Surface surprises — actuals that fall outside the predicted band.",
    capability:
      "Each deviation becomes a high-value learning signal that re-trains predictions and exposes broken priors.",
    accent: "#F59E0B",
    icon: "AlertTriangle",
  },
  game: {
    kind: "game",
    title: "Engagement loop",
    one_liner:
      "Compose engagement loops from behavioral game-mechanic primitives.",
    capability:
      "Combine streaks, prompts, and reward schedules to drive sustained user behavior on top of the model.",
    accent: "#EC4899",
    icon: "Gamepad2",
  },
  ml_personalization: {
    kind: "ml_personalization",
    title: "Personalization layer",
    one_liner:
      "Learn per-user behavior from prior interactions and adapt outputs.",
    capability:
      "Personalize prompts, dosing, and prediction weights so the experience tightens around the individual user over time.",
    accent: "#14B8A6",
    icon: "Sparkles",
  },
};

/** Default kind set used when a space has no template_id (full universe). */
export const ALL_MECHANISM_KINDS: ReadonlyArray<MechanismHint> = [
  "simulation",
  "prediction",
  "validation",
  "baseline_tracking",
  "deviation_capture",
  "game",
  "ml_personalization",
];
