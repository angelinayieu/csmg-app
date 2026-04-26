// ── Space Plan — output contract for the adaptive strategizer ─────────
//
// The strategizer answers a single question: "given the current KG + goals
// + coverage state, what is the SMALLEST set of probability-space work
// items that will raise reasoning density the most per token?"
//
// Its output — a SpacePlan — is a declarative, auditable specification
// of what to generate next. It is never executed inline by the
// strategizer itself; executors (per-axis generator, edge-space
// builder, convergent-point enumerator) read from the plan and carry
// out the work. This separation is what lets us:
//   - A/B the planner without touching execution
//   - Replay a plan deterministically
//   - Reject a plan before spending tokens on it (human-in-the-loop)
//   - Calibrate signal weights against which plan items actually paid off
//
// "Rigorous" here means: every decision in a SpacePlan carries its
// reasoning, its signal profile, and the candidates it beat. A plan
// with no skip_list is a plan we can't critique — so empty skip_lists
// are a code smell, not an accomplishment.

import type { ProbabilitySpaceAxis } from "./pipeline-events";

// ── Candidate kinds ────────────────────────────────────────────────────
//
// The strategizer unifies three historically-separate generation paths
// (axes, edges, nodes) into one ranking space so they compete for the
// same token budget. Without unification, each path over-invests in
// itself regardless of which would actually move insight.

export type SpaceWorkKind =
  | "axis"              // generate an axis-scoped probability space (one of 8+ axes)
  | "edge_space"        // build per-edge ProbabilitySpace (mediators/conditions/pathways)
  | "convergent_point"  // enumerate outcome matrix for a focal node × interactor set
  | "signature_deepen"  // add one basis ring to a node's canonical signature
  | "intersection_probe" // deliberately generate work to test a suspected intersection
  | "intervention_combination"; // Phase 4 §5.3: pair two user-controllable levers and ask "what if both pulled?"

// ── Signal profile — the evidence behind each candidate ────────────────
//
// These are all computed by deterministic signal extractors (no LLM).
// The LLM planner sees the profile for every candidate but does NOT
// recompute it — this is what gives the planner a small, reliable
// input space to reason over. Each field is 0..1 and directly
// interpretable (higher = stronger signal).
//
// NULL fields are meaningful: "this signal doesn't apply to this
// candidate kind" (e.g. axis candidates have no graph centrality).
// The ranker treats null as "not a reason to pick or reject."

export interface SignalProfile {
  /** Graph centrality of the target (betweenness approximation, 0..1). */
  centrality: number | null;
  /** Goal proximity — 1 if target IS a goal entity, 1/(hops+1) otherwise. */
  goal_proximity: number | null;
  /** How many existing intersections touch the target. Normalized by
   *  max(intersection_count) in the space. */
  intersection_density: number | null;
  /** Residual uncertainty at the target node (from its signature). High
   *  uncertainty → deepening is likely to reduce it. */
  uncertainty: number | null;
  /** Layer-crossing — 1 when source/target live in different knowledge
   *  layers, else 0. Cross-layer bridges carry disproportionate signal. */
  layer_crossing: number | null;
  /** Coverage gap — membership in `high_value_uncovered_pairs` RPC
   *  output. Binary 0/1 but ranker gives it heavy weight. */
  coverage_gap: number | null;
  /** Novelty — graph distance between candidate's endpoints, normalized.
   *  Distant endpoints → higher novelty if they connect. */
  novelty: number | null;
  /** Axis calibration — historical prospector acceptance rate for this
   *  axis. Only populated for axis candidates. */
  axis_calibration: number | null;
  /** Controllability spread — 0..1, where 1 = candidate touches all three
   *  controllability tiers (direct/indirect/uncontrollable). Diversity
   *  signal: a high spread means the plan isn't concentrated in one
   *  manifold region. */
  controllability_spread: number | null;
  /** Causal depth — BFS hops back from the nearest goal along the
   *  causal subgraph, normalized by CAP_DEPTH=6. 0 means the target IS
   *  the goal (too proximal to be a root). Higher = deeper upstream =
   *  more root-cause-like. Null when the target isn't on any backward
   *  trace or root-trace hasn't run yet. */
  causal_depth_normalized: number | null;
  /** Convergence count — fraction of space goals whose backward trace
   *  passes through this target. 1.0 means this node is upstream of
   *  every goal (keystone). Null when root-trace hasn't run or target
   *  isn't reachable. This is the single strongest signal for
   *  "Kaufman-style root cause" — higher convergence = more chains
   *  fanning-in to this one node. */
  convergence_count: number | null;
  /** Agent convergence count — fraction of DISTINCT canonical agents
   *  (see src/lib/agents/registry.ts) that independently proposed this
   *  target entity, normalized by the ensemble size considered for the
   *  plan. Measures CONSENSUS OF OPINION rather than causal fan-in:
   *  an entity five different agents converged on is structurally
   *  distinct from one a single agent produced, even when the
   *  topo-merged graph shows them identically. Null for candidate kinds
   *  that don't attach to an entity (axis-level), or when the entity
   *  has no extractable proposing-agent metadata. */
  agent_convergence_count: number | null;
  /** User-controllable lever — 1 when the target entity was identified
   *  by the why-chain deepener as `entity_type="causal_driver"` with
   *  `provenance.stop_reason="user_controllable"` (an actionable
   *  intervention point inside the user's locus of action), 0 when the
   *  driver exists but is external/continue/speculative, null for non-
   *  driver entities or axis-level candidates.
   *
   *  This signal is NOT redundant with controllability_spread (which
   *  measures diversity across controllability tiers in a candidate's
   *  neighborhood). This one asks the pointed question: "is the single
   *  target entity something the user can actually move?" Weighted
   *  heavily in the strategy_engine profile (intervention-planner lens)
   *  and moderately in causal_auditor (root-cause-first lens). */
  user_controllable_lever: number | null;
  /** Phase 3 §4.3 — proximity to the focal target outcome.
   *
   *  1 when the candidate IS the resolved outcome entity. 1/(hops+1)
   *  when the candidate is N causal hops upstream of the outcome.
   *  Null when no target_outcome was extracted, no entity in the KG
   *  resolves to the outcome, or the candidate isn't on a path to it.
   *
   *  Distinct from `goal_proximity` — goal_proximity ranks against the
   *  user-flagged improvement_goals (multiple, often broad), while
   *  outcome_alignment ranks against the SINGLE focal outcome the
   *  target-outcome extractor identified at frame-extractor time. The
   *  two can disagree (an improvement_goal is a long-term metric;
   *  the focal outcome is the run-specific lever) — and when they do,
   *  outcome_alignment wins for THIS run because it reflects what the
   *  user actually asked about. */
  outcome_alignment: number | null;
}

// ── One ranked candidate (pre-LLM) ────────────────────────────────────
//
// The ranker emits a CandidateScore per potential work item. The planner
// LLM sees the TOP-K and must either accept (and justify) or skip (and
// justify). The skip rationale is the audit trail: "we DIDN'T generate
// X because Y."

export interface CandidateScore {
  /** Opaque id — the executor decodes based on `kind`. Format:
   *  axis:{axis} | edge:{edgeId} | node:{entityId} | sig:{entityId} |
   *  inter:{aId}:{bId} | combo:{aId}+{bId} (intervention_combination,
   *  ids sorted lexicographically so the same pair always hashes the
   *  same direction) */
  candidate_id: string;
  kind: SpaceWorkKind;
  /** Composite score [0..1] from weighted signal aggregation. */
  score: number;
  /** Per-signal breakdown so the planner can see WHY a candidate ranks
   *  where it does — not just that it's #3. Critical for rigor. */
  signals: SignalProfile;
  /** Human-readable pre-reasoning the ranker attaches. One short
   *  sentence. The planner may override with richer reasoning. */
  ranker_note: string;
  /** Estimated token cost to carry this candidate out. Hard cap in the
   *  planner — sum(selected.est_tokens) must fit budget. */
  est_tokens: number;
  /** Expected reduction in residual uncertainty across the KG if this
   *  candidate lands [0..1]. This is the "reasoning density" proxy
   *  the planner optimizes for. */
  expected_insight_yield: number;
  /**
   * Per-agent scoring breakdown. When the ranker runs with the multi-
   * perspective profile ensemble (see src/lib/agents/registry.ts), each
   * profile produces its own composite score under its own weight
   * vector. `score` above is the MEAN across profiles; this map holds
   * the individual per-agent scores so UIs can show disagreement
   * ("causal_auditor ranks this 0.72, critic ranks it 0.31").
   *
   * Optional for backward compat: older plans and single-perspective
   * runs may omit this field entirely. Consumers must treat absence
   * as "no multi-agent data available", not as an error.
   */
  per_agent_breakdown?: Record<string, number>;
  /**
   * Score variance across agent profiles — standard deviation of the
   * per_agent_breakdown values. Zero means every profile agreed exactly
   * (unanimous); high values flag contentious candidates the planner
   * should treat cautiously. The planner prompt surfaces items with
   * `score_variance` above a threshold as "disputed" so the LLM can
   * reason about the disagreement rather than blindly averaging it.
   *
   * Range: [0, ~0.5] in practice. Absent when no per-agent breakdown
   * was computed.
   */
  score_variance?: number;
}

// ── Selected work item (post-LLM) ─────────────────────────────────────
//
// What the strategizer commits to. Carries forward the CandidateScore
// plus the planner's own justification + execution hints.

export interface SelectedWorkItem {
  candidate_id: string;
  kind: SpaceWorkKind;
  /** The planner's reason for picking this. Must be ≥1 substantive
   *  sentence that cites signals or relationships — not a tautology. */
  selection_reason: string;
  /** What insight type the planner expects this to surface. Feeds
   *  calibration — if the actual surface differs, the signal weights
   *  get adjusted. */
  expected_insight_type:
    | "leverage_point"       // high-centrality or bottleneck
    | "mechanism_clarity"    // resolves ambiguous causal path
    | "intervention_target"  // actionable (high controllability, direct)
    | "risk_disclosure"      // surfaces failure mode or fragility
    | "cross_domain_bridge"  // links previously-disconnected regions
    | "uncertainty_reduction" // deepens a foggy node
    | "goal_alignment";      // pulls structure toward an improvement_goal
  /** Resolution level the executor should target. For edge_space /
   *  signature_deepen: 1–5. For axis: always 1 (axis spaces are flat).
   *  null = executor default. */
  target_resolution: number | null;
  /** Token budget allocated TO this item. Sum over all items must
   *  equal or undershoot `SpacePlan.budget_tokens`. */
  allocated_tokens: number;
  /** Copied from the score for audit. Planner may NOT modify these. */
  signals: SignalProfile;
  score: number;
}

// ── A skip — why a candidate ranked high but didn't make the plan ─────
//
// The most rigor-critical field in the whole contract. Every candidate
// in the top-K that the planner did NOT select must appear here with
// a reason. "Out of budget" is valid; "redundant with item X" is valid;
// "not aligned with stated goals" is valid; "no reason provided" is
// rejected downstream.

export interface SkipReason {
  candidate_id: string;
  kind: SpaceWorkKind;
  score: number;
  reason:
    | "out_of_budget"          // would exceed budget_tokens
    | "redundant_with_selected" // overlaps semantically with chosen item
    | "goal_misaligned"         // no path to improvement_goals
    | "low_expected_yield"      // rank high but insight_yield low
    | "awaiting_upstream"       // blocked on another candidate's completion
    | "insufficient_evidence"   // signals present but shaky
    | "manifold_collision";     // would not broaden controllability spread
  /** 1–2 sentence narrative. If reason is "redundant_with_selected",
   *  must cite the candidate_id of the item it overlaps with. */
  rationale: string;
  /** For "redundant_with_selected" — the dominating item. */
  dominated_by?: string;
}

// ── The plan itself ────────────────────────────────────────────────────

export interface SpacePlan {
  /** Stable id — survives re-generation of the plan document. */
  id: string;
  space_id: string;
  /** The run this plan was produced for. */
  run_id: string | null;
  /** ISO timestamp. */
  generated_at: string;
  /** Total token budget the plan commits to. Hard ceiling. */
  budget_tokens: number;
  /** Budget remaining after all selected.allocated_tokens sum. Emitted
   *  for audit — if strategizer picked < budget, user sees "we stopped
   *  picking at X because no further candidate passed the bar." */
  budget_headroom: number;
  /** Items chosen for execution, in intended execution order. Order
   *  matters: later items may cite earlier items as prerequisites via
   *  `selection_reason`. */
  selected: SelectedWorkItem[];
  /** Candidates considered but not chosen. MUST be non-empty if
   *  candidates_considered > selected.length. Empty list is an audit
   *  smell — it means the planner picked everything it saw, which is
   *  rarely optimal. */
  skipped: SkipReason[];
  /** Raw ranker output for the full candidate set (pre-LLM). The LLM
   *  saw only top-K from this list. Kept for audit + for the calibration
   *  loop. */
  candidates_considered: CandidateScore[];
  /** Diversity check — distribution of selected items across kinds.
   *  If all selected are "edge_space" the plan is concentrated; the
   *  diversity guard rejects and re-plans with penalties. */
  diversity_profile: {
    by_kind: Partial<Record<SpaceWorkKind, number>>;
    by_expected_insight_type: Record<string, number>;
    controllability_spread: number; // 0..1 across selected items
  };
  /** Planner's overall narrative — 2-4 sentences. "Here's what we're
   *  prioritizing this cycle and why." User-facing. */
  headline_rationale: string;
  /** Planner's stated STOP condition — what would make us stop planning
   *  further items. e.g. "residual uncertainty across top-5 bottlenecks
   *  drops below 0.25." Enables the next cycle to know when it's done. */
  stop_condition: string;
  /** Signal weights USED by this plan's ranker. Snapshotted so future
   *  calibration sees what weights produced what yield. */
  ranker_weights_snapshot: Record<keyof SignalProfile, number>;
  /** Model + temp used for the planning LLM call. Provenance for repro. */
  planner_model: string;
  planner_temperature: number;
  /** Phase 4 §5.1 — horizon-aware modulation context. Populated when the
   *  target outcome carried a `horizon` and the ranker applied
   *  multiplicative overrides on top of the base weights. Surfacing this
   *  in the plan document lets the drawer explain WHY the weights
   *  shifted from default ("ranking biased toward immediate levers
   *  because the goal horizon was 'immediate'"). Optional: omitted when
   *  no horizon was detected (medium_term or null treated as no-op).
   *
   *  `applied_overrides` mirrors the multiplicative map produced by
   *  deriveHorizonOverrides — each key is a SignalProfile field, each
   *  value is the multiplier applied to the base weight (e.g.
   *  `user_controllable_lever: 1.5` for an immediate-horizon plan).
   *
   *  `outcome_direction` carries the maximize/minimize/maintain framing
   *  from the target-outcome extractor — useful context next to the
   *  horizon for the user to understand "we are biasing toward levers
   *  that increase X over the next few weeks." */
  horizon_context?: {
    horizon: "immediate" | "short_term" | "medium_term" | "long_term" | null;
    outcome_direction: "maximize" | "minimize" | "maintain" | null;
    applied_overrides: Partial<Record<keyof SignalProfile, number>>;
  };
}

// ── Plan request shape ─────────────────────────────────────────────────

export interface SpacePlanRequest {
  space_id: string;
  run_id?: string | null;
  /** Hard token budget for the whole plan. Required — strategizer
   *  refuses to run without one. */
  budget_tokens: number;
  /** Maximum number of items in the plan. Prevents the planner from
   *  fragmenting the budget across too many cheap items. Default: 8. */
  max_items?: number;
  /** How many top candidates to feed the LLM. Default: 20. Higher
   *  = more options but more tokens burned on planning itself. */
  shortlist_size?: number;
  /** Minimum composite score a candidate needs to enter the shortlist.
   *  Default: 0.35. Raise to prune more aggressively. */
  score_floor?: number;
  /** Diversity constraint — minimum kind count. Default 2 (must select
   *  across at least 2 kinds). */
  min_kind_diversity?: number;
  /** Bias weights — callers can temporarily skew the ranker for this
   *  plan only (e.g. a "derisk mode" that doubles `uncertainty`
   *  weight). Applied multiplicatively on top of the calibrated
   *  weights. Optional. */
  weight_overrides?: Partial<Record<keyof SignalProfile, number>>;
  /** Focus on a specific improvement goal (optional). Raises
   *  `goal_proximity` weight for this plan and filters candidates to
   *  those within N hops of the focal goal. */
  focal_goal_entity_id?: string | null;
}

// ── Calibration feedback ──────────────────────────────────────────────
//
// Post-hoc: after a plan's items have been executed and some time has
// passed, we check which items actually produced insight that got
// consumed (shown in a widget, cited in a proposal, led to an
// intervention). That signal trains the ranker weights.
//
// A plan item is "paid off" if it appears in:
//   - an intervention's evidence/rationale
//   - an accepted proposal's supporting_entities
//   - a variant's decomposition
//   - a report's consequence_surface
//
// The calibration loop fits weights such that high-score items correlate
// with paid-off items. Plan items that scored high but never paid off
// DOWNWEIGHT the signals that drove them.

export interface PlanCalibrationEvent {
  plan_id: string;
  candidate_id: string;
  kind: SpaceWorkKind;
  /** Raw signals at planning time — kept for the regression. */
  signals: SignalProfile;
  /** Composite score at planning time. */
  score: number;
  /** Paid off: was this item actually used downstream? */
  paid_off: boolean;
  /** How — concrete surface that consumed it. null if paid_off=false. */
  paid_off_surface:
    | "intervention"
    | "proposal"
    | "variant_decomposition"
    | "report_consequence"
    | "widget_render"
    | null;
  /** Latency from plan generation to payoff (or to calibration sweep if
   *  no payoff). Seconds. */
  latency_seconds: number;
  observed_at: string;
}
