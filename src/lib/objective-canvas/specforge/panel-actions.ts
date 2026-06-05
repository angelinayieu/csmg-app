// ── SpecForge · Side Panel action registry (tldraw-free) ─────────────
//
// Per specforge_side_panel_interaction_system.md §12–§23: each engine's
// reasoning card gets its OWN action set in the side panel — not the same
// generic buttons everywhere. This module is the single source of truth
// for which actions appear per node type, and which existing system event
// each one dispatches.
//
// Hard rule from the spec's §12 ("Do not show the same actions everywhere"):
// the registry is exhaustive over SpecForgeEngineId so TypeScript refuses to
// compile if a new engine is added without action assignments. No silent
// "no actions defined" rows.
//
// HONESTY POLICY (locked):
// Every action in this registry is marked `enabled: false` UNTIL a real
// handler is wired. The panel surfaces every action with a "next" pill so
// the user sees the roadmap without ever clicking a button that does
// nothing. When a handler ships, flip `enabled: false` here AND add the
// listener at the same time — don't separate the two.
//
// Wiring philosophy (when handlers do ship):
//   - "emit" actions dispatch a CustomEvent on window; the existing canvas
//     ops (converge/diverge, decompose, etc.) listen on their own events
//     and pick up the selected shape. Reuses, doesn't fork.
//   - "compare" / "show-related" actions are panel-local (no LLM cost) —
//     they navigate the existing graph data the runner already accumulated.
//   - "regenerate" actions reuse the existing FORGE_REQUEST_EVENT path so
//     no parallel re-run subsystem is created.

import type { SpecForgeEngineId } from "./types";

/** Action verbs split into UX intent — drives the icon + grouping. */
export type ActionKind =
  | "brainstorm" // Generate more / alternatives / variants
  | "compare" // Show side-by-side, against alternative
  | "deepen" // Go deeper / make more specific / repair
  | "navigate" // Show how this affects X / send downstream
  | "evaluate" // Re-score, run gate, mark hard/soft
  | "edit" // Direct user edit (opens inline editor)
  | "delete"; // Remove / reject

export interface PanelAction {
  id: string;
  label: string;
  /** Short helper that appears under the label as faint copy. */
  hint?: string;
  kind: ActionKind;
  /** Window event to dispatch on click. The detail carries
   *  { shapeId, engine, engineRunId } so any listener has full context. */
  eventName: string;
  /** Whether this action ships in MVP v1. Off-MVP actions render disabled
   *  with a subtle "soon" pill — gives the spec coverage without false
   *  positives. */
  enabled?: boolean;
}

/** Custom event names used by panel actions. Each one is namespaced so
 *  it can't collide with other board events. Listeners are added in a
 *  follow-up — this turn just emits them. */
export const SPECFORGE_PANEL_ACTION_EVENT = "objective-board:specforge-panel-action";
export const OPEN_SPECFORGE_DETAIL_EVENT = "objective-board:open-specforge-detail";

/** The event detail carried by every panel action firing. */
export interface PanelActionDetail {
  /** The card the user clicked the action on. */
  shapeId: string;
  /** Which engine produced the card — drives the action handler. */
  engine: SpecForgeEngineId;
  /** Phase A engine-run row id (when present) so the handler can read
   *  the persisted artifact rather than re-deriving it from the shape. */
  engineRunId: string | null;
  /** Action verb the user clicked. Free-form so handlers can dispatch
   *  on it without a giant central switch. */
  actionId: string;
}

// ── Action registry per engine ────────────────────────────────────────
// Each engine gets 4–6 actions max — the spec lists more (§13–§23) but
// going wider buries the high-leverage ones. The MVP cut surfaces the
// most-asked actions per node type; the rest stay in the spec for later.

const TARGET_USER: PanelAction[] = [
  { id: "brainstorm-segments", label: "Brainstorm more segments", hint: "Generate alternative user types", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "make-specific", label: "Make user more specific", hint: "Narrow to a sharper segment", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "compare-variants", label: "Compare user variants", hint: "Side-by-side of alt segments", kind: "compare", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-downstream", label: "Show how this changes MVP", hint: "Trace the impact down the chain", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const PROBLEM_TREE: PanelAction[] = [
  { id: "go-deeper", label: "Go deeper", hint: "Generate more causal variables + loops", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "find-contradictions", label: "Identify contradictions", hint: "Surface forces pulling apart", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "find-leverage", label: "Find leverage points", hint: "Where small change yields big shift", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-downstream", label: "Show downstream effects", hint: "What this cause model enables", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "repair-shallow", label: "Repair shallow model", hint: "Re-run with stricter quality gate", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const DESIRED_RESULT: PanelAction[] = [
  { id: "make-measurable", label: "Make result more measurable", hint: "Force a unit + threshold", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "generate-metrics", label: "Generate success metrics", hint: "Concrete signals we hit it", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "generate-failures", label: "Generate failure conditions", hint: "What proves we didn't", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "connect-to-causes", label: "Show blocking causes", hint: "Trace which problem nodes block this", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const CONVERGENCE: PanelAction[] = [
  { id: "challenge-constraint", label: "Challenge root constraint", hint: "Stress-test the selected pick", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-why-won", label: "Show why this thesis won", hint: "Surface the selection rationale", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-rules-out", label: "Show what this rules out", hint: "Make the excluded space explicit", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "alt-thesis", label: "Generate alternative thesis", hint: "Run convergence again with stricter filter", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const DIFFERENTIATION: PanelAction[] = [
  { id: "add-alternative", label: "Add alternative", hint: "Compare against another competitor", kind: "compare", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "deeper-gap", label: "Generate deeper gap", hint: "Surface a stronger differentiation", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "stronger-positioning", label: "Generate stronger positioning", hint: "Rewrite the thesis sharper", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "research", label: "Run research", hint: "Web-search to validate the gap", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const SOLUTION_FAMILIES: PanelAction[] = [
  { id: "compare-families", label: "Compare families", hint: "Side-by-side mechanism comparison", kind: "compare", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "merge-families", label: "Merge two families", hint: "Combine the strongest threads", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "reject-family", label: "Reject family", hint: "Mark as not viable + why", kind: "delete", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-causes", label: "Show root cause attacked", hint: "Trace upward to problem tree", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const MVP_VARIATIONS: PanelAction[] = [
  { id: "compare-mvps", label: "Compare MVP directions", hint: "Side-by-side feature + risk diff", kind: "compare", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "make-simpler", label: "Make MVP simpler", hint: "Cut to the smallest valuable form", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "make-ambitious", label: "Make MVP more ambitious", hint: "Add the next layer of value", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "rescore", label: "Re-score with different criteria", hint: "Run evaluation again with new weights", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "to-features", label: "Turn into Feature Cards", hint: "Decompose this MVP into features", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const RECOMMENDATION: PanelAction[] = [
  { id: "show-why-won", label: "Show why this won", hint: "Surface the rubric winner rationale", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-why-others-lost", label: "Show why others lost", hint: "Per-candidate rejection reasons", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "first-build-scope", label: "Define first-build scope", hint: "Pin the must-build features", kind: "edit", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "to-tech-spec", label: "Send to Tech Spec", hint: "Build the engineering-grade artifact", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const FEATURE_CARDS: PanelAction[] = [
  { id: "explain-mechanism", label: "Explain mechanism", hint: "Show the inner process in detail", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "alt-mechanisms", label: "Generate mechanism alternatives", hint: "Compare 2–3 ways to build it", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-failure-modes", label: "Find failure modes", hint: "Surface what breaks under load", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "to-impl-tasks", label: "Convert to implementation tasks", hint: "Send to the Spec Exporter", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const FEATURE_MECHANISMS: PanelAction[] = [
  { id: "simplify-mech", label: "Simplify mechanism", hint: "Cut steps that don't earn user value", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "more-technical", label: "Make more technical", hint: "Add architecture + data flow", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-inputs", label: "Show upstream inputs", hint: "Trace data dependencies upward", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "alt-mechs", label: "Generate alternatives", hint: "Compare 2–3 mechanism designs", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const DATA_POINTS: PanelAction[] = [
  { id: "evaluate-friction", label: "Evaluate collection friction", hint: "Cost-of-data audit", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "evaluate-privacy", label: "Evaluate privacy risk", hint: "Sensitivity + consent audit", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "find-proxies", label: "Generate lower-friction proxies", hint: "Cheaper substitutes that still work", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "replace-point", label: "Replace data point", hint: "Swap for a different signal", kind: "edit", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const EVALUATION: PanelAction[] = [
  { id: "show-criteria", label: "Show criteria + weights", hint: "Inspect the rubric breakdown", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "change-weights", label: "Change criterion weights", hint: "Re-rank with different priorities", kind: "edit", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "stricter-eval", label: "Run stricter evaluation", hint: "Tighten gates + re-score", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "buildability-first", label: "Buildability-first re-score", hint: "Emphasize ease-to-ship", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "diff-first", label: "Differentiation-first re-score", hint: "Emphasize being meaningfully better", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

const VALIDATION: PanelAction[] = [
  { id: "explain-experiment", label: "Explain experiment", hint: "How this test isolates the question", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "alt-experiments", label: "Generate alternatives", hint: "Other ways to test the same assumption", kind: "brainstorm", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "make-cheaper", label: "Make experiment cheaper", hint: "Lower cost / faster signal", kind: "deepen", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-assumptions", label: "Show assumptions tested", hint: "Trace upward to risky beliefs", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

// Fallback set for engines without bespoke actions in the MVP — every
// reasoning card gets at least these so the panel is never empty.
const GENERIC: PanelAction[] = [
  { id: "explain", label: "Explain this in plain English", hint: "Walk through the reasoning", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-upstream", label: "Show upstream inputs", hint: "What this card depends on", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "show-downstream", label: "Show downstream effects", hint: "What this card enables", kind: "navigate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
  { id: "regenerate", label: "Re-run this engine", hint: "Generate a fresh artifact", kind: "evaluate", eventName: SPECFORGE_PANEL_ACTION_EVENT, enabled: false },
];

/** Exhaustive registry — TypeScript refuses to compile if a new engine
 *  is added without an entry. Keeps the panel honest as the chain grows. */
export const PANEL_ACTIONS: Record<SpecForgeEngineId, PanelAction[]> = {
  power_up: GENERIC,
  target_user: TARGET_USER,
  problem_tree: PROBLEM_TREE,
  desired_result: DESIRED_RESULT,
  cross_analysis: GENERIC,
  question_expansion: GENERIC,
  convergence: CONVERGENCE,
  differentiation: DIFFERENTIATION,
  solution_families: SOLUTION_FAMILIES,
  mvp_variations: MVP_VARIATIONS,
  evaluation: EVALUATION,
  recommendation: RECOMMENDATION,
  complexity_allocation: GENERIC,
  feature_cards: FEATURE_CARDS,
  feature_mechanisms: FEATURE_MECHANISMS,
  data_points: DATA_POINTS,
  layer_optimization: GENERIC,
  validation: VALIDATION,
  deepening: GENERIC,
  spec_export: GENERIC,
};

/** Static "why it matters" copy per engine (§7 of the spec). Single-line,
 *  reads as the panel's first body paragraph. Kept short so the panel
 *  doesn't bury the actions. */
export const WHY_IT_MATTERS: Record<SpecForgeEngineId, string> = {
  power_up:
    "Cleaning the raw idea sets the frame for every downstream engine — wrong-here means wrong-everywhere.",
  target_user:
    "Changing the target user changes the problem model, desired result, differentiation, MVP direction, and feature priorities.",
  problem_tree:
    "The causal model determines which root constraint matters, which leverage points unlock the result, and which solution families are viable.",
  desired_result:
    "If the desired result isn't measurable, MVP selection becomes vibes — no other downstream engine can recover.",
  cross_analysis:
    "If user × problem × result don't fit together, every later decision optimizes for a misaligned target.",
  question_expansion:
    "Decision-changing questions reduce hidden uncertainty before it propagates into recommendation rejection.",
  convergence:
    "The product thesis is the constraint every downstream engine inherits — alternatives, differentiation, MVPs, and features all must serve it.",
  differentiation:
    "If the product isn't meaningfully better than what exists, MVP value collapses regardless of how well it's built.",
  solution_families:
    "Solution families are the lens through which MVP candidates are generated — narrow families = narrow imagination.",
  mvp_variations:
    "Each MVP direction commits the build to a different mechanism and risk profile — comparison matters more than ranking.",
  evaluation:
    "Without explicit weights and per-candidate scores, the recommendation is a vibe-pick. Evaluation locks the rubric.",
  recommendation:
    "This is the build the rest of SpecForge is asking you to commit to. Override only with explicit reasoning, not gut.",
  complexity_allocation:
    "Build effort is finite — under-building reasoning kills quality; over-building UI burns the runway.",
  feature_cards:
    "Each feature is only valid if its mechanism satisfies the micro-objective and traces back to the root constraint.",
  feature_mechanisms:
    "A feature name is not buildable. The mechanism is the input → process → output that creates user value.",
  data_points:
    "Data without a downstream consumer is friction without payoff. Each data point must earn its collection cost.",
  layer_optimization:
    "Each layer must still serve the one above. Drift between macro → micro → mechanism breaks coherence silently.",
  validation:
    "Reasoning is not proof. Every risky assumption needs a cheap, decisive experiment before commit.",
  deepening:
    "The iteration snapshot is what makes the model improvable over time — without it every run starts from scratch.",
  spec_export:
    "The exported build instruction is what a designer / engineer / coding agent actually executes against.",
};
