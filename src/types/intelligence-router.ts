// ── Intelligence Router types ──
//
// The router sits between any "new content arrives" event and the downstream
// pipelines. It classifies the content, decides how deep to process it,
// checks it against objectives, and schedules background work.
//
// This is not another pipeline — it's the *dispatcher* that picks which
// pipelines to run with what settings. One LLM call + deterministic routing.

// ── Input to the router ──

export type ContentSource =
  | "journal_entry"       // journaling surface
  | "playground_text"     // whiteboard playground submit
  | "whiteboard_decompose" // decompose button on a node
  | "brainstorm"          // freestyle brainstorm zone (Phase X3)
  | "direct_intake"       // primary decompose pipeline (large input)
  | "manual";             // user-triggered

export interface RouterInput {
  // If content belongs to a space, provide it. Absent = cross-space / brainstorm.
  space_id?: string;

  // The content itself — always text at this layer. Structured content gets
  // serialized upstream.
  text: string;

  // Where the content came from (determines defaults + routing)
  source: ContentSource;

  // Optional hints the caller can pass in
  context?: {
    // If the caller knows this is a template-driven space
    use_case_template_id?: string;
    // The focal entity (if relevant, e.g. decompose clicked on entity X)
    focal_entity_id?: string;
    // Recent entry texts for journaling context
    recent_context?: string[];
  };

  // Caller's preference — if they know they want light vs heavy processing
  processing_preference?: "auto" | "light" | "deep";
}

// ── Classification ──

export type DetectedContentType =
  | "journal_entry"
  | "strategic_memo"
  | "research_note"
  | "relationship_note"
  | "decision_analysis"
  | "brainstorm_idea"
  | "reading_note"
  | "task_or_todo"
  | "event_reflection"
  | "other";

export type StrategicSignificance = "high" | "moderate" | "low";

export type SuggestedLens =
  | "journal_self_discovery"
  | "startup_strategy"
  | "research_project"
  | "career_pivot"
  | "reading_synthesis"
  | "relationship_dynamics"
  | "team_retro"
  | "none"; // no template fits; use default decomposition

export interface ContentClassification {
  content_type: DetectedContentType;
  strategic_significance: StrategicSignificance;
  suggested_lens: SuggestedLens;
  confidence: number;                // 0..1
  // Emotional / strategic signals the router detected
  positive_signal: boolean;          // "this felt great", flow, breakthrough
  negative_signal: boolean;          // tension, friction, frustration
  recurring_theme_signal: boolean;   // suggests user has touched this before
}

// ── Objective signals ──

export interface ExistingObjectiveMatch {
  objective_id: string;
  title: string;
  relevance: number;                 // 0..1
  evidence_for: boolean;             // does this content support the objective?
  evidence_against: boolean;         // does this content undermine the objective?
  reasoning: string;
}

export interface ProposedSubObjective {
  parent_objective_id: string;
  suggested_title: string;
  rationale: string;
  confidence: number;
}

export interface ProposedObjective {
  suggested_title: string;
  objective_type: "maximize" | "minimize" | "maintain" | "avoid";
  rationale: string;
  // Which content this was triggered by — for user review
  triggering_excerpt: string;
  confidence: number;
}

export interface ObjectiveSignals {
  relates_to_existing: ExistingObjectiveMatch[];
  proposes_new_sub_objective: ProposedSubObjective | null;
  proposes_new_objective: ProposedObjective | null;
}

// ── Processing depth recommendation ──

export type ProcessingDepth =
  | "single_pass"      // one LLM call, extract entities, no deeper analysis
  | "cluster_local"    // extract + critique the local cluster + update synthesis for that cluster
  | "full_pipeline";   // full decompose equivalent — use for large / significant content

export interface ProcessingRecommendation {
  recommended_depth: ProcessingDepth;
  reasoning: string;
  // Lens overrides to pass into the decomposition prompts
  lens_addenda?: string;
}

// ── Proposed actions (NOT auto-fired — user approves via UI) ──
//
// Heavy pipelines cost LLM credits and time. The router proposes them; the
// user decides whether to run. This avoids auto-burning credits on every
// journal entry / playground submit.
//
// ONLY "extract_entities" and similar cheap per-content operations may be
// auto-fired by callers. Anything that rescans the whole graph (critique,
// synthesis, strategy) goes through proposal + explicit approval.

export type ProposedActionKind =
  | "critique"              // re-run critique on the space
  | "synthesis_refresh"     // refresh synthesis (layered or flat)
  | "strategy_regen"        // regenerate strategy layer
  | "objective_accept"      // accept a proposed new objective
  | "sub_objective_accept"  // accept a proposed sub-objective
  | "probability_space"     // generate probability space for focal node
  | "pattern_aggregation";  // aggregate patterns

export type ActionCostEstimate = "low" | "medium" | "high";

export interface ProposedAction {
  kind: ProposedActionKind;
  reason: string;                     // why the router proposed this
  confidence: number;                 // 0..1
  cost_estimate: ActionCostEstimate;  // rough LLM call burden
  // Optional: extra context the executor needs (e.g. objective details)
  payload?: Record<string, unknown>;
}

// Cheap operations that the caller can auto-fire without user approval.
// Examples: extracting entities from one content item (1 LLM call).
export type AutoFiredActionKind = "extract_entities" | "save_content" | "update_counts";

export interface AutoFiredAction {
  kind: AutoFiredActionKind;
  outcome: "success" | "failed" | "skipped";
  detail?: string;
}

// ── Full router result ──

export interface RouterResult {
  classification: ContentClassification;
  objective_signals: ObjectiveSignals;
  processing: ProcessingRecommendation;
  // PROPOSALS — not auto-executed. Surface these to the user with a button.
  proposed_actions: ProposedAction[];
  // Cheap actions that already ran (for audit / debug)
  auto_fired: AutoFiredAction[];
  // For logging / instrumentation
  llm_call_ms: number;
  decided_at: string;
  // Opaque id for tracing proposals back to their trigger content
  router_trace_id: string;
}
