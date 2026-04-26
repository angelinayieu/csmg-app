// ── Widget registry bootstrap ──────────────────────────────────────────
//
// Importing this module once (e.g. at the top of AppRenderer) registers
// every starter widget. Add new widgets here alongside their contract.
//
// A widget contract is the validator's source of truth — it lists which
// named bindings + actions are required/accepted. Keep these tight; the
// manifest validator rejects missing required bindings at write time
// and renders placeholders for unknown types at read time.

import { registerWidget } from "@/lib/apps/widget-registry";
import {
  MetricCard,
  HeroStat,
  ProgressTracker,
} from "./metric-widgets";
import {
  InterventionCard,
  InterventionList,
} from "./intervention-widgets";
import {
  EntityCallout,
  LeverageCallout,
  RiskCallout,
  ActionList,
  TimelineView,
  ScenarioComparator,
  RecentSignalsBanner,
} from "./insight-widgets";
import {
  ExternalSignalBanner,
  KGTopInsights,
  ContributorsStrip,
} from "./space-insights-widgets";
import { AgentWorkflowGraph } from "./agent-workflow-widget";
import { TextBlock, Divider, UnknownWidget } from "./layout-widgets";
import {
  BaselineDeviationTracker,
  PredictionPanel,
  ValidationLab,
  SimulationLab,
  DeviationSignalFeed,
} from "./lab-widgets";
import { IVDecomposition } from "./iv-decomposition-widget";
import { VariantCarousel } from "./variant-carousel-widget";
import { DownstreamReality } from "./downstream-reality-widget";
import { ChainDiscoveries } from "./chain-discoveries-widget";
import { SignatureConstellation } from "./signature-constellation-widget";
import { StrategyCarousel } from "./strategy-carousel-widget";
import { ObjectiveTree } from "./objective-tree-widget";

let booted = false;

/**
 * Idempotent bootstrap — safe to call from multiple entry points. HMR
 * also lands here, overwriting the prior registrations (the registry
 * emits a dev-only warning).
 */
export function bootstrapWidgetRegistry(): void {
  if (booted) return;
  booted = true;

  // ── Metric widgets ──
  registerWidget(
    {
      type: "metric_card",
      description: "Labelled numeric metric with optional target and ring.",
      category: "core",
      optional_bindings: ["value", "target"],
      accepted_sources: {
        value: ["metric_series", "app_state_field", "literal"],
        target: ["app_config_field", "literal"],
      },
    },
    MetricCard
  );

  registerWidget(
    {
      type: "hero_stat",
      description: "Oversized headline number for monitor layouts.",
      category: "core",
      optional_bindings: ["value"],
      accepted_sources: {
        value: ["metric_series", "app_state_field", "literal"],
      },
    },
    HeroStat
  );

  registerWidget(
    {
      type: "progress_tracker",
      description: "Current vs baseline vs target progress bar.",
      category: "core",
      // Reads baseline + current to show delta — this is baseline-aware, so
      // it qualifies under baseline_tracking for mechanism_hints injection.
      capabilities: ["baseline_tracking"],
      required_bindings: ["current"],
      optional_bindings: ["baseline", "target"],
      accepted_sources: {
        current: ["goal", "metric_series", "literal"],
        baseline: ["goal", "literal", "strategy_baseline"],
        target: ["goal", "literal"],
      },
    },
    ProgressTracker
  );

  // ── Intervention widgets ──
  registerWidget(
    {
      type: "intervention_card",
      description: "Single intervention with status + primary action.",
      category: "core",
      required_bindings: ["intervention"],
      accepted_sources: { intervention: ["intervention"] },
    },
    InterventionCard
  );

  registerWidget(
    {
      type: "intervention_list",
      description: "Stacked list of interventions; one action per row.",
      category: "core",
      required_bindings: ["items"],
      accepted_sources: { items: ["interventions"] },
    },
    InterventionList
  );

  // ── Insight widgets ──
  registerWidget(
    {
      type: "entity_callout",
      description: "Dominant factor / entity badge.",
      category: "core",
      required_bindings: ["entity"],
      accepted_sources: { entity: ["entity"] },
    },
    EntityCallout
  );

  registerWidget(
    {
      type: "leverage_callout",
      description: "Leverage point extracted from synthesis.",
      category: "core",
      required_bindings: ["leverage"],
      accepted_sources: { leverage: ["synthesis_leverage", "literal"] },
    },
    LeverageCallout
  );

  registerWidget(
    {
      type: "risk_callout",
      description: "Risk point extracted from synthesis.",
      category: "core",
      required_bindings: ["risk"],
      accepted_sources: { risk: ["synthesis_risks", "literal"] },
    },
    RiskCallout
  );

  registerWidget(
    {
      type: "action_list",
      description: "Checklist-style action items.",
      category: "core",
      required_bindings: ["items"],
      accepted_sources: { items: ["action_plan", "literal"] },
    },
    ActionList
  );

  registerWidget(
    {
      type: "timeline_view",
      description: "Dated events / milestones in an ordered timeline.",
      category: "core",
      required_bindings: ["items"],
      accepted_sources: { items: ["literal", "action_plan"] },
    },
    TimelineView
  );

  registerWidget(
    {
      type: "scenario_comparator",
      description: "Side-by-side scenario comparison.",
      category: "core",
      // Scenario comparison is a sibling to simulation — it displays
      // pre-generated synthesis scenarios rather than running fresh ones,
      // so it doesn't declare "simulation" (that belongs to simulation_lab).
      required_bindings: ["scenarios"],
      accepted_sources: { scenarios: ["synthesis_scenarios", "literal"] },
    },
    ScenarioComparator
  );

  registerWidget(
    {
      type: "recent_signals_banner",
      description:
        "Horizontally-scrolling strip of recent agent signals from AppState.recent_signals.",
      category: "core",
      optional_bindings: ["signals"],
      accepted_sources: {
        signals: ["app_state_field", "literal"],
      },
    },
    RecentSignalsBanner
  );

  // ── Space-level insight widgets ──
  registerWidget(
    {
      type: "external_signal_banner",
      description:
        "Stacked chips surfacing recent intelligence_radar signals — external-world events worth user attention.",
      category: "core",
      required_bindings: ["signals"],
      accepted_sources: { signals: ["intelligence_signals", "literal"] },
    },
    ExternalSignalBanner
  );

  registerWidget(
    {
      type: "kg_top_insights",
      description:
        "Summary card with KG quality score, top leverage, top risks, and master bottleneck.",
      category: "core",
      required_bindings: ["insights"],
      accepted_sources: { insights: ["kg_top_insights", "literal"] },
    },
    KGTopInsights
  );

  registerWidget(
    {
      type: "contributors_strip",
      description:
        "Avatar strip of agents + human collaborators active on this space, with hover popover.",
      category: "core",
      required_bindings: ["contributors"],
      accepted_sources: { contributors: ["contributors", "literal"] },
    },
    ContributorsStrip
  );

  registerWidget(
    {
      type: "agent_workflow_graph",
      description:
        "Experiment Digital Twin — agent orchestration DAG with live agent_runs status join.",
      category: "core",
      required_bindings: ["workflow"],
      accepted_sources: { workflow: ["agent_workflow", "literal"] },
    },
    AgentWorkflowGraph
  );

  // ── Item 4 lab widgets (stub implementations — see lab-widgets.tsx) ──
  // These declare capabilities so the manifest builder can inject them
  // for proposals with matching mechanism_hints. Item 4 will re-register
  // the same widget types with real components via HMR-safe overwrite.
  registerWidget(
    {
      type: "baseline_deviation_tracker",
      description:
        "Predicted-vs-actual grid for tracked metrics, grouped by deviation_tag. Reads strategy_baseline + deviation_ledger.",
      category: "lab",
      capabilities: ["baseline_tracking", "deviation_capture"],
      // Tier 3.6: bind to app_strategy to annotate rows with
      // learning_loop.leading_indicators thresholds (green/yellow/red).
      // Without this, the tracker shows raw values; with it, it shows
      // whether each metric is "on track" according to the sub-strategy's
      // own definition of success.
      optional_bindings: ["baseline", "deviations", "spec"],
      accepted_sources: {
        baseline: ["strategy_baseline", "literal"],
        deviations: ["deviation_ledger", "literal"],
        spec: ["app_strategy", "literal"],
      },
    },
    BaselineDeviationTracker
  );

  registerWidget(
    {
      type: "prediction_panel",
      description:
        "Open predictions for this app — metric, horizon, predicted value, confidence. Supports log_prediction + adjust_horizon actions.",
      category: "lab",
      capabilities: ["prediction"],
      // Tier 3.5: optionally bind to app_strategy to pull sub-strategy
      // defaults (default_horizon_days, default_confidence). When present,
      // the widget pre-fills the log-prediction form with these defaults
      // instead of generic 30d / 0.6.
      optional_bindings: ["predictions", "spec"],
      accepted_sources: {
        predictions: ["prediction_ledger", "literal"],
        spec: ["app_strategy", "literal"],
      },
    },
    PredictionPanel
  );

  registerWidget(
    {
      type: "validation_lab",
      description:
        "Run hypothesis tests against open predictions. start_experiment seeds a prediction; end_experiment writes the resolved actual.",
      category: "lab",
      capabilities: ["validation", "prediction"],
      // Tier 3.5: bind to app_strategy.spec.validation_spec.hypothesis_bank
      // when present so the user gets an inline picker of pre-formulated
      // hypotheses instead of having to author every experiment from
      // scratch. Falls back to free-form when no sub-strategy exists.
      optional_bindings: ["experiments", "interventions", "predictions", "spec"],
      accepted_sources: {
        experiments: ["prediction_ledger", "literal"],
        interventions: ["interventions"],
        predictions: ["prediction_ledger"],
        spec: ["app_strategy", "literal"],
      },
    },
    ValidationLab
  );

  registerWidget(
    {
      type: "simulation_lab",
      description:
        "What-if scenarios against the current TwinState. Saved scenarios can be promoted into a strategy regen.",
      category: "lab",
      capabilities: ["simulation"],
      // Tier 3.6: bind to app_strategy to pull perturbation_profiles +
      // scenario_seeds from the sub-strategy spec. When present, the
      // widget surfaces one-click pre-canned scenarios instead of
      // requiring the user to author every perturbation from scratch.
      optional_bindings: ["twin", "entities", "scenarios", "spec"],
      accepted_sources: {
        twin: ["twin_state"],
        entities: ["entities"],
        scenarios: ["simulation_result", "literal"],
        spec: ["app_strategy", "literal"],
      },
    },
    SimulationLab
  );

  registerWidget(
    {
      type: "deviation_signal_feed",
      description:
        "Resolved predictions tagged as surprise — the highest-value training data. Each row surfaces escalate_to_research.",
      category: "lab",
      capabilities: ["deviation_capture"],
      // Tier 4.5: bind to app_strategy to know whether a sub-strategy
      // exists. When present, the widget surfaces an extra "Add
      // hypothesis" action that re-triggers sub-strategy generation
      // with the surprise as focus hint — turning surprises into
      // testable validation_spec.hypothesis_bank entries on next regen.
      optional_bindings: ["signals", "spec"],
      accepted_sources: {
        signals: ["deviation_ledger", "literal"],
        spec: ["app_strategy", "literal"],
      },
    },
    DeviationSignalFeed
  );

  // ── Experiment taxonomy widgets (Phase 3 — VP Project report) ──
  //
  // iv_decomposition reads one active variant + the taxonomy schema to
  // paint the per-slot ring row ("decomposed prompt" in the VP Project
  // design). variant_carousel reads the full variant list + taxonomy
  // and renders the coverflow flashcards. Both are driven by
  // taxonomy-as-data so they work identically for prompt / recipe /
  // routine / any domain the inferrer classifies.
  registerWidget(
    {
      type: "iv_decomposition",
      description:
        "Independent-variable decomposition — per-slot rings with score, sparkline, and value preview for the active variant.",
      category: "core",
      required_bindings: ["variant", "taxonomy"],
      accepted_sources: {
        variant: ["experiment_active_variant", "literal"],
        taxonomy: ["experiment_taxonomy", "literal"],
      },
    },
    IVDecomposition
  );

  registerWidget(
    {
      type: "variant_carousel",
      description:
        "Coverflow of experiment variants — one flashcard per variant, with status pill, outcome KPI pills, and click-to-focus / double-click-to-activate.",
      category: "core",
      required_bindings: ["variants", "taxonomy"],
      accepted_sources: {
        variants: ["experiment_variants", "literal"],
        taxonomy: ["experiment_taxonomy", "literal"],
      },
    },
    VariantCarousel
  );

  // downstream_reality reads the DownstreamReality shape (latent
  // dimensions + scores_by_variant map) and renders the variant ×
  // latent heatmap — the "what actually happened when we varied the
  // IVs" answer that the taxonomy's pre-declared outcome_axes can't
  // give. Needs the variant list + taxonomy for row labels/ordering.
  registerWidget(
    {
      type: "downstream_reality",
      description:
        "Variant × latent-dimension heatmap — surfaces outcome dimensions discovered after variants were materialized.",
      category: "core",
      required_bindings: ["reality", "variants", "taxonomy"],
      accepted_sources: {
        reality: ["downstream_reality", "literal"],
        variants: ["experiment_variants", "literal"],
        taxonomy: ["experiment_taxonomy", "literal"],
      },
    },
    DownstreamReality
  );

  // ── Explanatory widgets (Phase 3 — VP Project report, Batch 4) ──
  //
  // chain_discoveries renders the 6-stage causal chains from synthesis
  // (concept → research → deliverable → application → outcome → goal),
  // so the user can trace *why* a strategy contributes to the goal.
  //
  // strategy_carousel renders ranked strategies with ranking_rationale
  // and tradeoff_vs_top — "here's the chosen path and what we considered
  // and passed on."
  //
  // objective_tree renders the ultimate goal + sub-objective hierarchy
  // with per-node status and progress — "what we're steering toward."
  registerWidget(
    {
      type: "chain_discoveries",
      description:
        "Provenance-linked causal chains from synthesis — concept → research → deliverable → application → outcome → goal, one mini-timeline per chain.",
      category: "core",
      required_bindings: ["chains"],
      accepted_sources: { chains: ["causal_chains", "literal"] },
    },
    ChainDiscoveries
  );

  registerWidget(
    {
      type: "strategy_carousel",
      description:
        "Ranked strategies coverflow — headline, posture, ranking_rationale, and tradeoff_vs_top for each alternative.",
      category: "core",
      required_bindings: ["strategies"],
      accepted_sources: { strategies: ["ranked_strategies", "literal"] },
    },
    StrategyCarousel
  );

  registerWidget(
    {
      type: "objective_tree",
      description:
        "Recursive improvement_goals tree with per-node status dots, objective_type glyphs, and baseline→target progress.",
      category: "core",
      required_bindings: ["tree"],
      accepted_sources: { tree: ["goal_tree", "literal"] },
    },
    ObjectiveTree
  );

  // ── Batch 8 · canonical signature UX ──
  //
  // signature_constellation renders a grid of layered-ring visuals, one
  // per entity that has a materialized NodeSignature. Clicking a ring
  // opens the detail drawer (basis + evidence + resolution plane +
  // consequence surface). Data source is the `node_signatures` resolver
  // which the page/report wires up to read from entities.node_signature.
  registerWidget(
    {
      type: "signature_constellation",
      description:
        "Grid of layered-ring visuals — one ring layer per variable/basis element in each entity's canonical NodeSignature. Click a ring to open the detail drawer.",
      category: "core",
      required_bindings: ["signatures"],
      accepted_sources: { signatures: ["node_signatures", "literal"] },
    },
    SignatureConstellation
  );

  // ── Layout widgets ──
  registerWidget(
    {
      type: "text_block",
      description: "Prose block — markdown-light title + body.",
      category: "layout",
    },
    TextBlock
  );

  registerWidget(
    {
      type: "divider",
      description: "Horizontal rule with optional caption.",
      category: "layout",
    },
    Divider
  );

  // Fallback for unknown types — rendered by the AppRenderer when it
  // encounters a widget it can't resolve.
  registerWidget(
    {
      type: "__unknown__",
      description: "Placeholder for an unknown widget type.",
      category: "layout",
    },
    UnknownWidget
  );
}

// Auto-bootstrap on import. Module-scoped flag above makes it idempotent.
bootstrapWidgetRegistry();
