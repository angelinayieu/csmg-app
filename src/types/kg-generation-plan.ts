// ── KG Generation Plan types ─────────────────────────────────────
//
// The user-reviewable PLAN that describes everything the pipeline is
// about to do BEFORE it runs. See:
//   - supabase/migrations/20260614_kg_generation_plans.sql (DDL)
//   - src/lib/pipeline/plan-generator.ts (planner agent)
//   - src/components/canvas/chrome/kg-plan-review-card.tsx (UI)
//
// The plan is a CONTRACT — user approves and downstream stages read
// their config from the approved plan rather than silent defaults.
// This is the answer to "the pipeline auto-fires with 12 silent
// decisions" — the plan surfaces every decision for review.
//
// The plan WRAPS but does not duplicate the existing SituationFrame
// (src/types/situation-frame.ts). Pre-approval the planner-agent's
// draft frame lives in `situation_frame_draft`; on approval it's
// copied to `resolved_situation_frame` and to spaces.situation_frame.

import type { SituationFrame } from "./situation-frame";
import type { OntologyLayerDefinition } from "./layer-ontology";

// ── Lifecycle ────────────────────────────────────────────────────

export type KgPlanStatus =
  | "draft"
  | "proposed"
  | "edited"
  | "approved"
  | "rejected"
  | "superseded";

/** The mode the plan was generated for. Drives which sections render
 *  in the Plan Review Card — consumer hides methodology disclosure;
 *  researcher shows everything. */
export type KgPlanMode = "consumer" | "clinician" | "researcher";

// ── Section A: Scope & objectives ────────────────────────────────

export interface KgPlanScope {
  /** User's prompt text, verbatim. */
  goal_verbatim: string;
  goal_parsed: {
    primary_objective: string;
    target_outcomes: string[];
    constraints: string[];
    domain_classification: {
      label: string;
      /** 0..1 */
      confidence: number;
      /** Other domain candidates the planner considered. */
      alternatives: Array<{ label: string; confidence: number }>;
    };
  };
  success_criteria: string[];
}

// ── Section B: Layer ontology proposal ───────────────────────────

export interface KgPlanLayerOntologyProposal {
  layers: Array<
    OntologyLayerDefinition & {
      /** Why the planner included this specific layer for this topic. */
      why_included: string;
    }
  >;
  ontology_source: "starter" | "research_agent" | "user_authored" | "hybrid";
  source_metadata: {
    /** When ontology_source = "starter", the template slug. */
    starter_slug?: string;
    /** When ontology_source = "research_agent", the research trace. */
    research_trace?: {
      agent_model: string;
      sources_consulted: string[];
      reasoning_summary: string;
      planner_confidence: number;
    };
  };
}

// ── Section C: Custom axes (replaces hardcoded catalog defaults) ──

export interface KgPlanAxisProposal {
  name: string;
  slug: string;
  definition: string;
  rationale: string;
  /** Which (layer_slug, entity_category) cells this axis is intended
   *  to populate. Note: layer_slug is the per-space ontology slug,
   *  not the legacy KnowledgeLayer enum. */
  target_cells: Array<{ layer_slug: string; category: string }>;
  /** How the axis generator should approach this axis (e.g.
   *  "enumerate cognitive domains × measurement instruments"). */
  generator_strategy: string;
  dimension_hint?: string;
  instrument_kind_hint?: string;
  output_shape_hint?: string;
  estimated_token_cost: number;
}

export interface KgPlanAxisProposals {
  axes: KgPlanAxisProposal[];
  axis_source: "plan_generated" | "catalog_extension" | "hybrid";
}

// ── Section D: Conceptual skeleton ───────────────────────────────

export interface KgPlanConceptualCluster {
  layer_slug: string;
  label: string;
  expected_node_count: number;
  expected_node_kinds: string[];
  example_nodes: string[];
}

export interface KgPlanConceptualSkeleton {
  anticipated_clusters: KgPlanConceptualCluster[];
  estimated_total_nodes: number;
  estimated_total_edges: number;
  estimated_cycles: number;
  estimated_communities: number;
}

// ── Section E: Research plan ─────────────────────────────────────

export interface KgPlanPaperCoverage {
  ingested_file_id: string;
  title: string;
  /** Layer slugs from the proposed ontology this paper is expected
   *  to populate. */
  anticipated_coverage_layers: string[];
  /** Axis slugs from the proposed axes this paper is expected to
   *  populate. */
  anticipated_coverage_axes: string[];
  expected_effect_size_count: number;
  /** True when the paper's reported metrics fit at least one
   *  currently-shipped extraction primitive (e.g. cohens_d_with_ci_v1). */
  extractable_with_current_parsers: boolean;
  parser_match_reasoning: string;
  flagged_for_manual_review: boolean;
  /** 1 = extract first; higher = later. */
  extraction_priority: number;
}

export interface KgPlanCoverageGap {
  layer_slug: string;
  axis_slug: string;
  why_uncovered: string;
  /** Free-text suggestions like "cognitive training meta-analyses
   *  for older adults" the user could go fetch. */
  suggested_paper_kinds: string[];
}

export interface KgPlanResearchPlan {
  papers: KgPlanPaperCoverage[];
  coverage_gaps: KgPlanCoverageGap[];
  extraction_order_rationale: string;
}

// ── Section F: Methodology disclosure ────────────────────────────

export interface KgPlanMethodologyDisclosure {
  active_parsers: Array<{
    module: string;
    version: string;
    /** Effect metrics the parser handles, e.g. ["cohens_d", "hedges_g", "smd"]. */
    handles_metrics: string[];
    known_limits: string[];
  }>;
  trust_boundary_explanation: string;
  prior_selection_strategy: {
    /** Default prior tier ("robust_map" | "commensurate" | "power" |
     *  "mechanistic_synthesis" | "uniform"). */
    default_tier: string;
    per_node_overrides: Array<{ node_pattern: string; tier: string; reason: string }>;
  };
  /** Default response model per edge kind. */
  dose_response_defaults: Record<string, string>;
  heterogeneity_handling: {
    layers_active: string[];
    pooling_method: string;
    tau_squared_estimator: string;
  };
  consensus_profile_selection: {
    profiles_used: string[];
    disagreement_handling: string;
  };
}

// ── Section G: Limitations ───────────────────────────────────────

export interface KgPlanLimitations {
  known_weak_parsers: string[];
  coverage_gaps_acknowledged: string[];
  /** Free-text array of effect metrics / data formats the current
   *  parser library cannot extract. Surfaces honestly so professors
   *  trust what they see. */
  what_wont_be_extractable: string[];
  planner_uncertainties: string[];
  downstream_stage_caveats: Record<string, string>;
}

// ── Cost estimate ────────────────────────────────────────────────

export interface KgPlanCostEstimate {
  tokens_estimate: number;
  wall_clock_seconds_estimate: number;
  credits_estimate: number;
  parallelizable_stages: string[];
  expensive_stages_flagged: Array<{ stage: string; reason: string }>;
}

// ── Reasoning settings proposed by the plan ──────────────────────
// Mirrors src/types/reasoning-settings.ts but is the *plan's
// proposal*; on approval, merged into spaces.reasoning_settings.

export interface KgPlanReasoningSettingsProposed {
  generateApps?: boolean;
  runLab?: boolean;
  showAlternatives?: boolean;
  askClarifyingQuestions?: boolean;
  buildBaselineFirst?: boolean;
  depth?: "quick" | "standard" | "deep";
  lenses?: string[];
  costBudget?: number;
  costBudgetStrictness?: "soft" | "hard";
  solveBy?: string;
  bypassLayerGate?: boolean;
  bypassMeasurementGate?: boolean;
  deferApps?: boolean;
}

// ── The full plan ────────────────────────────────────────────────

export interface KgGenerationPlan {
  id: string;
  space_id: string;
  user_id: string;

  version: number;
  supersedes_id: string | null;

  status: KgPlanStatus;
  mode: KgPlanMode;

  proposed_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;

  scope_and_objectives: KgPlanScope | null;
  layer_ontology_proposal: KgPlanLayerOntologyProposal | null;
  axis_proposals: KgPlanAxisProposals | null;
  conceptual_skeleton: KgPlanConceptualSkeleton | null;
  research_plan: KgPlanResearchPlan | null;
  methodology_disclosure: KgPlanMethodologyDisclosure | null;
  limitations: KgPlanLimitations | null;

  situation_frame_draft: SituationFrame | null;
  resolved_situation_frame: SituationFrame | null;

  reasoning_settings_proposed: KgPlanReasoningSettingsProposed | null;
  cost_estimate: KgPlanCostEstimate | null;

  /** 0..1 planner self-rating. Surfaced in the Review Card so users
   *  know whether to scrutinize harder. */
  planner_confidence: number | null;

  /** Pipeline handoff context — when the bootstrap intake created
   *  this plan + holds a credit reservation open while the user
   *  reviews, this captures everything the approve route needs to
   *  fire downstream decompose. Null when the plan was created
   *  outside the bootstrap chain. */
  pipeline_handoff_context: KgPlanHandoffContext | null;

  created_at: string;
  updated_at: string;
}

export interface KgPlanHandoffContext {
  /** Credit reservation held open across the plan review. Cancelled
   *  on reject; consumed by decompose on approve. */
  reservation_id: string;
  /** The intake_bootstrap pipeline_run.id that started this whole
   *  flow. Used so decompose can rehydrate onto the same run instead
   *  of creating a duplicate. */
  intake_run_id: string;
  /** The exact inputs to fire decompose with on approval. */
  decompose_input: {
    text: string;
    reasoningDepth: "quick" | "standard" | "deep";
    autoAdvance: boolean;
  };
}

// ── Decision audit log ───────────────────────────────────────────

export type KgPlanSection =
  | "scope_and_objectives"
  | "layer_ontology_proposal"
  | "axis_proposals"
  | "conceptual_skeleton"
  | "research_plan"
  | "methodology_disclosure"
  | "limitations"
  | "situation_frame_draft"
  | "reasoning_settings_proposed"
  | "mode"
  | "cost_estimate"
  | "other";

export interface KgPlanDecision {
  id: string;
  plan_id: string;
  section: KgPlanSection;
  field_path: string | null;
  before_value: unknown;
  after_value: unknown;
  reason: string | null;
  changed_by: string;
  changed_at: string;
}

// ── Inputs to the planner agent ──────────────────────────────────

/** Inputs the plan-generator consumes. The planner reads these +
 *  optionally calls a research-agent helper for ontology generation. */
export interface PlanGeneratorInput {
  space_id: string;
  user_id: string;
  /** Verbatim prompt text from the whiteboard intake. */
  prompt: string;
  /** Mode controls what sections to populate + the planner's
   *  audience-aware tone. */
  mode: KgPlanMode;
  /** Already-uploaded papers / assets in this space. The research
   *  plan section enumerates per-paper coverage. */
  ingested_file_ids: string[];
  /** Whether to use a starter ontology if one matches the topic
   *  (the user said: "make a few starter ontologies but deploy a
   *  research agent to make a highly educated well-researched
   *  precise and well-covered one on top"). */
  prefer_starter_when_match: boolean;
  /** Existing reasoning_settings on the space (the planner uses
   *  these as defaults but proposes overrides per the plan). */
  existing_reasoning_settings?: KgPlanReasoningSettingsProposed;
  /** Optional version for iterative re-planning. */
  superseded_plan_id?: string;
}
