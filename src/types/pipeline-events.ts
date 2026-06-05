// ── Structural event schema for the pipeline event bus ──
//
// Memory rule (locked 2026-04-20, feedback_structural_events_only):
// Only events that correspond to a persisted KG / prediction-ledger
// artifact render on the canvas. Free-form thinking / tool-calls /
// sub-queries / unconsolidated chains go to the audit drawer instead.
//
// Every event type here maps to an INSERT or meaningful UPDATE the
// user could click on later — a real node in the graph.

export type PipelineStage =
  | "intake"
  | "landscape"
  | "kg"
  | "proposal"
  | "twin"
  | "lab"
  | "reflexive"
  | "results";

export type StructuralEvent =
  | StageBoundaryEvent
  | EntityAddedEvent
  | EdgeAddedEvent
  | CycleDetectedEvent
  | BridgeFormedEvent
  | ProposalReadyEvent
  | SourceCitedEvent
  | PredictionRecordedEvent
  | ReasoningChunkEvent
  | SpaceOpenedEvent
  | SpaceEntityAddedEvent
  | SpaceEdgeAddedEvent
  | CrossSpaceLinkEvent
  | SpaceMergeBeginEvent
  | SpaceMergeCompleteEvent
  | AxisScoredEvent
  | AxisFailedEvent
  | TargetOutcomeIdentifiedEvent
  | StructuralAnalogFoundEvent
  | SignatureDeepenedEvent
  | TaxonomyInferredEvent
  | VariantProposedEvent
  | RootCauseIdentifiedEvent
  | WhyChainDeepenedEvent
  | StrategyConsensusReadyEvent
  | LayerCoverageGapEvent
  | MeasurementCoverageGapEvent
  | CommunityDetectedEvent
  // Sprint A — wrap-what-exists pass: downstream composite events that
  // the canvas painter uses to drop full widget-backed shapes during
  // the unfurl. Each maps 1-1 to a first-class tldraw shape and a DB
  // row (or row set) so the shape persists correctly across reloads.
  | AppResultReadyEvent
  | IVDecompositionReadyEvent
  | VariantDeckReadyEvent
  | CausalStageReadyEvent
  // Twin proposal materialized — fired by wireTwinProposalAndMechanisms
  // when a twin_proposals row is inserted at the end of strategy
  // generation. Painter spawns a `twin-snapshot` shape inside the Twin
  // room so users watching live see the committed twin land before the
  // run completes.
  | TwinProposalReadyEvent
  // Situation analyzer (post data-presence, pre frame-extractor) emits
  // a single summary event when it lands. The canvas painter uses it
  // to spawn the situation-card shape with the correct counts; the
  // full baseline lives on spaces.situation_baseline (too large for
  // the event payload).
  | SituationAnalyzedEvent
  // Asset upload — fires when /api/ingest persists a new asset row
  // tied to a space. Painter spawns an asset-card chip in the input
  // row at top-of-canvas. Run-scoped; cleared with the rest of the
  // painter's emission overlay on run completion.
  | AssetAddedEvent
  // Image extraction phase 2 (two-phase ingest, 2026-05-01) — fires
  // when /api/ingest/vision-extract finishes the structured Claude
  // vision pass on a previously-ingested image. Carries description,
  // entity count, and relationship count so the file-card can flip
  // from "Analyzing image…" to its ready state without a refetch.
  // Materialize-from-image consumes this event to bulk-create the
  // associated KG nodes + edges around the file-card.
  | ImageExtractedEvent
  // Memory context — emitted at decompose start when the user's
  // memory_items were queried and relevant prior context was injected
  // into the Pass 1 system prompt. Canvas HUD displays a subtle
  // "Drawing on N memories" chip while the LLM is reasoning.
  | MemoryContextLoadedEvent
  // ── KG Generation Plan events ──
  // The planner-agent stage (`plan_propose`) gates downstream
  // pipeline stages on user approval. These events drive the
  // Plan Review Card surface on the whiteboard. See
  // src/types/kg-generation-plan.ts + the 20260614 migration.
  | KgPlanProposedEvent
  | KgPlanEditedEvent
  | KgPlanApprovedEvent
  | KgPlanRejectedEvent
  | LayerOntologyMaterializedEvent
  // Cross-layer cascade prediction (D-track β) — fires when the
  // synthesize hop refreshes the layer_dependencies table for a
  // space. Canvas LayerStackShape arrows + variant ripple chips
  // listen for this and refetch.
  | LayerDependenciesMaterializedEvent
  // Phase 2 (research-strategy migration) — surface claims that don't
  // yet meet the triangulation bar (≥2 independent supporting sources)
  // so research can target them next pass, AND active contradiction
  // discoveries from the adversarial pass.
  | TriangulationGapEvent
  | ContradictionFoundEvent
  // Phase 6 (Insight Lab) — manual algorithm-stack experimentation. One
  // pipeline_run per stack run; events stream the per-step lifecycle so
  // the lab UI can render progress + ranked insights through the existing
  // event bus rather than a parallel channel. See 20260629_insight_lab.sql
  // for the matching DB CHECK and src/lib/insight-lab/ for the runtime.
  | LabStepStartedEvent
  | LabInsightEmittedEvent
  | LabScoreRecordedEvent
  // ── Problem-framing diverge-converge (Phase 1, 2026-05) ──
  // Events for the upstream diverge-converge cycle. The framing panel
  // produces N candidate problem framings; the user picks one via the
  // /app/space/[id]/framing gate. Today rank-1 is auto-approved
  // immediately so downstream (decompose, frame-extractor) keeps
  // working — framing_selected lets the user re-rank to a different
  // option at any time, which the audit trail records.
  // Persisted in twin_proposals(kind='problem_twin'); see
  // 20260715_twin_proposals_kind_and_frame.sql.
  | FramingProposedEvent
  | FramingApprovedEvent
  | FramingSelectedEvent
  // ── Phase 2 lab diverge-converge (Week 4, 2026-05) ──
  // Mirrors Phase 1's framing events. The lab-generation library
  // runs 5 stance-flavored lab-design proposals after the strategy
  // twin lands, persists them as twin_proposals(kind='lab_twin'),
  // and emits these events so the chrome banner + gate page can
  // render the divergence cloud. Lab pick cascade-supersedes apps
  // via apps.stale_reason='lab_regen' (see 20260717_apps_stale_
  // reason_lab_regen.sql).
  | LabProposedEvent
  | LabApprovedEvent
  | LabSelectedEvent
  // ── Sprint C — pipeline error/warning surfaces ──
  // Until 2026-05, silent failures in the strategy chain (no-trigger
  // chain decisions, simulation null returns, DoWhy non-fatal errors)
  // were swallowed by console.warn with NO user-visible signal. The
  // stabilization audit identified this as the cause of "the strategy
  // cards never appeared and I don't know why" UX. These two event
  // types surface failure modes through the SSE stream so the chrome
  // banner can render an accumulated error/warning trail during the
  // run. See DIVERGE_CONVERGE_ARCHITECTURE_PLAN.md §5 Sprint C.
  | PipelineWarningEvent
  | PipelineErrorEvent
  // ── Hidden signal detection (2026-05-19) ──
  // Surfaces structural-analysis findings from `extractSignals()` —
  // cascade vulnerabilities, structural holes, hidden mediating
  // variables, flip-prone loops — as live canvas shapes anchored to
  // the entities they reference. Up until now signals were computed
  // and persisted into `synthesis_data.signal_extraction` but never
  // surfaced anywhere except as tactic-chip slugs inside the strategy
  // hero card. The painter listens for these events and spawns
  // HiddenSignalShape near the primary anchor entity; the cluster
  // event aggregates the suppressed long tail into one shape so the
  // canvas stays scannable. See `src/lib/synthesis/emit-signal-events.ts`
  // for the filter + batch emit logic.
  | SignalDetectedEvent
  | SignalClusterEvent
  // Preliminary hypothesis — emitted by a fast Haiku preflight at the
  // start of decompose so the user sees substantive content within
  // 5-10s instead of waiting 60-90s for Pass 1 to finish. These are
  // shallow, fast guesses about what the question is asking, what
  // forces might be at play, and what the LLM expects to find. They
  // get superseded by the deeper synthesize-stage insights but
  // close the "is this working" gap during the long reasoning phase.
  | PreliminaryHypothesisEvent
  // ── SpecForge — engine lifecycle (Phase A KG state model) ──
  // Fired by the SpecForge persistence service around each engine call
  // inside a `pipeline=specforge` run, so a future SSE-driven progress
  // chip / side-panel timeline can subscribe through the existing event
  // bus instead of a parallel channel. Engine row + reasoning artifact
  // are durably persisted in specforge_engine_runs +
  // specforge_reasoning_artifacts (migration 20260924).
  | SpecForgeEngineStartedEvent
  | SpecForgeEngineCompletedEvent;

// ── Phase 2E · Tier 2 — probability space axes ──
//
// The canonical axes our frame extractor can identify in an input.
// Not every input warrants every axis — a casual personal-decision
// input may get 3-4 axes, a complex business pivot may get 6-7. The
// frame extractor decides per-input which subset applies.
//
// Each axis is a lens on the situation. A probability space is the
// set of entities + claims + distributions produced when the input
// is examined through that lens alone. Axes are orthogonal by
// design — the same entity may appear in multiple axes (a person
// named in both the Actors axis and the Cultural axis), and those
// cross-axis appearances are what make a node high-leverage.
export type ProbabilitySpaceAxis =
  | "financial"
  | "timeline"
  | "actors"
  | "causal_scenarios"
  | "evidence"
  | "assumptions"
  | "risk"
  | "cultural";

export interface StageBoundaryEvent {
  type: "stage_boundary";
  stage: PipelineStage;
  phase: "enter" | "exit";
  message?: string;
}

export interface EntityAddedEvent {
  type: "entity_added";
  entityId: string;
  entityCode: string | null; // semantic "C1", "X2"
  name: string;
  entityCategory: string | null;
  importance: string | null;
  parentEntityId: string | null;
  position?: { x: number; y: number } | null;
}

export interface EdgeAddedEvent {
  type: "edge_added";
  edgeId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  dimension: string;
  polarity: string | null;
  confidence: number;
}

export interface CycleDetectedEvent {
  type: "cycle_detected";
  cycleId: string;
  classification: string;
  entityIds: string[];
}

export interface BridgeFormedEvent {
  type: "bridge_formed";
  bridgeId: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  sourceEntityId: string;
  targetEntityId: string;
  bridgeType: string;
  confidence: number;
}

/**
 * Emitted at the end of strategy generation when a twin_proposals row is
 * inserted (see wire-twin-proposal.ts). Carries enough preview info for
 * the painter to render an instant twin-snapshot card; the shape itself
 * fetches full TwinMacroState on mount via /api/spaces/[id]/twin-state.
 */
export interface TwinProposalReadyEvent {
  type: "twin_proposal_ready";
  proposalId: string;
  spaceId: string;
  /** Number of mechanism rows the proposal commits to (justification.mechanism_ids.length). */
  mechanismCount: number;
  /** LLM-reported confidence 0-100, from justification.confidence. */
  confidence: number;
  /** One-line "what this twin is" — from justification.chosen_approach. */
  chosenApproach: string;
}

export interface ProposalReadyEvent {
  type: "proposal_ready";
  proposalId: string;
  kind: "strategy" | "experiment" | "variant";
  title: string;
  /**
   * Phase 1 Step 11 — plain-language action the user should take.
   * One short imperative sentence, no jargon, no entity codes. Renders
   * as the top line on the proposal card; card stays scannable.
   */
  headline?: string;
  /**
   * Phase 1 Step 11 — rigorous reasoning expansion. 2-4 sentences with
   * entity codes, edge dynamics, evidence confidence, simulation
   * context. Hidden behind an expand affordance on the proposal card
   * so the front of the card stays clean while the audit trail is
   * one click away.
   */
  reasoning?: string;
  rankedStrategyIds?: string[];
  /**
   * Sprint A3 — LLM self-reported confidence (0-100) for this
   * proposal. Emitted from `r.recommendation.confidence` in
   * strategy-refresh. The canvas's right-rail rings card uses this
   * as a fallback when `distribution` is absent (sparse KG / no
   * resolvable lever-target chain) — without this field, proposals
   * silently get filtered out, which is bug A3 in
   * DIVERGE_CONVERGE_ARCHITECTURE_PLAN.md §4.
   *
   * Provenance is always "llm_estimate" semantically — this is what
   * the strategy LLM self-reported, not a sample-derived number.
   * The ring card visually distinguishes it from MC-backed confidence
   * via an amber "Narrative grounding" badge.
   */
  confidence?: number;
  /**
   * Sample-derived distribution on the target outcome metric, produced
   * by running simulateEntityChain against the strategy's primary
   * causal chain. Absent when no target entity could be resolved or
   * simulation soft-failed — the canvas should fall back to the
   * LLM-reported confidence score in that case.
   */
  distribution?: {
    p10: number;
    p50: number;
    p90: number;
    mean?: number;
    stddev?: number;
    /**
     * Provenance tag — where these numbers came from. The UI must
     * render LLM-self-reported distributions differently from MC-backed
     * ones so users can tell trust-worthy uncertainty (`mc_simulation`,
     * `bootstrap`, or `ode_rk4`) from LLM estimation (`llm_estimate`).
     * Optional for pre-existing events in pipeline_run_events history;
     * consumers should default to `llm_estimate` (the conservative
     * assumption). See supabase/migrations/20260531_score_provenance.sql.
     *
     * Tier ladder (higher = more defensible):
     *   llm_estimate        — Tier 1 — LLM-self-reported distribution
     *   composite_computed  — Tier 3 — weighted signals, deterministic
     *   bootstrap           — Tier 4 — empirical resampling from history
     *   mc_simulation       — Tier 4 — Monte Carlo with seeded PRNG,
     *                         discrete timestep scalar dynamics
     *   ode_rk4             — Tier 5 — Monte Carlo where each sample
     *                         runs a continuous-time RK4 integration
     *                         over the same graph. Opt-in per caller
     *                         (see SimulationSpec.integrator).
     */
    provenance?:
      | "mc_simulation"
      | "bootstrap"
      | "llm_estimate"
      | "composite_computed"
      | "ode_rk4";
    /** Number of samples the distribution was computed from. Null when
     *  provenance is llm_estimate (no samples — pure LLM output). */
    sampleCount?: number | null;
  };
  /** Target entity UUID the distribution was measured on, when present. */
  targetEntityId?: string;
  /**
   * R5 Phase A · P4 — DoWhy 4-field causal contract.
   *
   * When the strategy-refresh pipeline's per-proposal computation
   * completed the full contract (model + identify + estimate + refute),
   * it rides on the event so the canvas can render it without a second
   * roundtrip. Optional for back-compat — events emitted before P4 or
   * via paths that don't compute a causal contract (synthesize's quick
   * path) omit the field. Consumers default to rendering the legacy
   * distribution view when absent.
   *
   * See src/types/dowhy.ts for the full shape. Key invariants:
   *   - `model.leverEntityId` is upstream of `targetEntityId` on the
   *     KG path.
   *   - `identify.kind` is derived from graph structure, not LLM.
   *   - `estimate` mirrors `distribution` above — kept here too so the
   *     DoWhy view is self-contained.
   *   - `refute.verdict` is a real pass/fail from placebo MC, not a
   *     qualitative assertion.
   */
  dowhy?: import("./dowhy").DoWhyContract;
  /**
   * Phase 2E · PR 5 — probability-space provenance.
   *
   * Which axes contributed entities that support this proposal. Computed
   * at emission time by `resolveAxesForProposal`: take the proposal's
   * supporting entity names (strategy → entity_references +
   * key_decision.supporting_entities; app → dominant_entity_codes), look
   * them up against every `space_entity_added` event in this run
   * (normalized-name match), and collect the axes of the matching axis
   * entities.
   *
   * Empty array ⇒ no axis coverage could be resolved (either the run
   * predates PR 1-2, or none of the supporting entities matched an axis
   * entity by name). UI renders NO axis badge row in that case rather
   * than "0 lenses" which would be misleading.
   *
   * Absent (undefined) ⇒ emitter predates this field. Treat same as
   * empty for rendering. Keeping it optional avoids breaking old events
   * in pipeline_run_events history.
   */
  axes_used?: ProbabilitySpaceAxis[];
  /**
   * Project-Overview design pass — reasoning chain summary for the
   * companion ribbon rendered below the proposal-snapshot card.
   *
   * The ribbon answers "HOW did we reach this proposal?" in one row:
   *   upstream_name → ... → target_name          +0.14
   *
   * Populated at emission time from data the emitter already had to
   * compute the proposal (entity_references / key_decision.supporting_
   * entities / dominant_entity_codes → uuid → name). Kept optional
   * so pre-existing events in pipeline_run_events keep replaying
   * without a migration, and so emitters that can't resolve a chain
   * (e.g. synthesize's quick path) can omit it instead of fabricating.
   */
  chain?: {
    /** Causal-order entity names, upstream → target. Painter caps
     *  rendering at 4-5 with "+N" overflow. Emit up to 6 for
     *  downstream consumers that may want more context. */
    nodeNames: string[];
    /** Compact human-readable identifier for the proposal — "S-1",
     *  "E-4.2", etc. Painter shows this on the ribbon's left badge
     *  so users can cross-reference multiple ribbons visually. */
    shortId: string;
    /** Signed p50 deviation from simulate-entity-chain. Absent when
     *  no simulation ran (target entity unresolved, MC soft-failed). */
    lift?: number;
    /** Optional one-word tag describing the primary constraint the
     *  proposal acts on — e.g. "throughput", "timeline", "latency". */
    constraintLabel?: string;
  };
}

export interface SourceCitedEvent {
  type: "source_cited";
  sourceUrl: string;
  title: string | null;
  authority: number; // 0..1
  publishedAt: string | null; // ISO
  boundToEntityId: string | null;
}

export interface PredictionRecordedEvent {
  type: "prediction_recorded";
  predictionId: string;
  entityId: string | null;
  horizonAt: string; // ISO
  distribution: { p10: number; p50: number; p90: number } | null;
  confidence: number;
}

/**
 * Phase 1 Step 19 — streaming reasoning trace.
 *
 * Emitted during long LLM passes (Pass 1 decomposition, synthesis, etc.)
 * so the user sees the model's actual reasoning as it generates rather
 * than staring at a silent spinner. Carries a chunk of accumulated
 * output text plus running counters.
 *
 * Intentionally NOT a structural artifact: does not correspond to a
 * persisted row, does not paint ghost shapes on the main canvas.
 * Consumed only by the dedicated reasoning-trace panel (honors the
 * structural-events-only rule — thinking traces stay in their own
 * drawer surface).
 *
 * Emission is throttled on the server side (~1s cadence) so a 60s
 * Pass 1 produces ~60 events, not one per token.
 */
export interface ReasoningChunkEvent {
  type: "reasoning_chunk";
  /** Which pipeline stage produced this chunk (for routing when multiple
   *  stages emit reasoning in the same run). */
  stage: PipelineStage;
  /**
   * The accumulated text so far — NOT the delta. Delta-based emission
   * would make the panel jittery when events arrive out of order; full-
   * snapshot updates let the panel render idempotently.
   */
  textSoFar: string;
  /** Token budget the LLM call was given (for progress bar math). */
  tokenBudget: number;
  /**
   * Approximate characters received so far. The real token count
   * requires a tokenizer; chars are a close-enough proxy for a
   * progress bar (~4 chars per token for English prose).
   */
  charsSoFar: number;
  /** "thinking" while streaming, "complete" on the final chunk. */
  phase: "thinking" | "complete";
}

// ── Phase 2E · Tier 2 — probability space events ──
//
// New event types emitted by the frame extractor + per-axis
// generators. These drive the "spaces fork out, fill in, link
// across, then merge into the unified KG" visual choreography
// without affecting the existing entity/edge/cycle structural
// stream. Painter + HUD subscribe to the same bus and render
// either flavor depending on the event type.

/**
 * Fires when the frame extractor decides that a given axis applies
 * to this input. Paints an empty glass "space shell" on the canvas
 * at a position relative to the origin card. Shell fills in as
 * `space_entity_added` events arrive for the same `spaceKey`.
 */
export interface SpaceOpenedEvent {
  type: "space_opened";
  /** Stable identifier unique within the run — usually `${runId}:${axis}`. */
  spaceKey: string;
  axis: ProbabilitySpaceAxis;
  /** User-facing label. Axis name title-cased with short tagline. */
  label: string;
  tagline: string;
  /** Hex accent color. Matches our design-system palette so each
   *  axis has a stable visual identity across sessions. */
  accent: string;
  /**
   * Ordinal position of this space around the origin card. Stable
   * within a run so layout is deterministic. Lower numbers paint
   * first and sit closer to the origin.
   */
  orderIndex: number;
  /**
   * Why the frame extractor chose this axis — one-sentence rationale
   * for the tooltip. Helps the user understand why the system is
   * modeling their situation this way.
   */
  rationale: string;
  /**
   * B3 — true when this space was minted by the framing panel as an
   * ad-hoc / custom axis (not one of the canonical 8). Drives the
   * shell shape's "custom" badge + dashed border treatment so the
   * user can see "this lens was created specifically for my
   * situation" vs "this is one of the standard 8 frames."
   * Optional for backward-compat with events emitted before B3.
   */
  isCustom?: boolean;
}

/**
 * Fires when a per-axis generator materializes an entity scoped to
 * a single probability space. Paints a mini-chip inside the
 * corresponding space shell (not the main canvas — that happens on
 * merge). Separate from `entity_added` so we can tell which
 * entities belong to the unified KG vs which are still local to
 * a single axis.
 */
export interface SpaceEntityAddedEvent {
  type: "space_entity_added";
  spaceKey: string;
  entityId: string;
  entityCode: string | null;
  name: string;
  /**
   * Role of this entity within its axis — "driver" / "constraint"
   * / "outcome" / "actor" / "evidence" / "assumption". Loose
   * classification; free-form strings allowed for evolving tags.
   */
  role: string | null;
  /**
   * 0..1 confidence the LLM assigned to this entity's relevance
   * within this axis. Lower values = more speculative inclusions.
   */
  weight: number;
  /**
   * Phase 2 §3.2 — richer payload mirroring the new validator fields.
   * All optional so older events in pipeline_run_events history keep
   * replaying without a migration; consumers should default
   * observables to [] and the rest to null.
   *
   *   • observables         — concrete leading indicators, ≥0 entries
   *   • failure_mode        — what would invalidate this entity
   *   • interventionHandle  — null for purely epistemic entities
   */
  observables?: string[];
  failureMode?: string | null;
  interventionHandle?: {
    lever: string;
    controllability: "direct" | "indirect" | "uncontrollable";
    cost: "low" | "med" | "high";
  } | null;
  /**
   * Phase 0 (research-strategy migration) — distinguishes how this
   * entity was generated, so the canvas can render speculative LLM
   * brainstorm differently from research-grounded entities. Today
   * the per-axis route is one LLM call without grounding, so every
   * catalog/ad-hoc axis emit lands as `llm_axis_brainstorm`.
   * Optional for backward compat with replayed historical events.
   *
   *   • llm_axis_brainstorm — single LLM call, no sources, no search
   *   • paper_extracted     — extracted from an uploaded paper
   *   • research_grounded   — backed by ≥1 evidence_items source URL
   *   • user_authored       — manually added or edited by the user
   */
  confidence_basis?:
    | "llm_axis_brainstorm"
    | "paper_extracted"
    | "research_grounded"
    | "user_authored";
}

/**
 * Phase 2E · PR 3 — intra-axis edge event.
 *
 * Fires for each validated relationship in a per-axis generator's
 * output. Carries the MECHANISM (how source produces target), the
 * structural dimension + polarity + dynamics, and a local
 * confidence. Painter renders edges inside the expanded shell's
 * relationships section.
 *
 * Separate from `edge_added` (which targets the unified KG on the
 * main canvas) because axis edges are transient — they only exist
 * until merge collapses the axis into the KG. Keeping them
 * distinct prevents the main-canvas painter from confusing the
 * two streams.
 */
export interface SpaceEdgeAddedEvent {
  type: "space_edge_added";
  spaceKey: string;
  /** Source entity id — same shape as SpaceEntityAddedEvent.entityId
   *  (`${runId}:${axis}:${localId}`). */
  sourceEntityId: string;
  /** Target entity id — same shape. */
  targetEntityId: string;
  /** LLM-generated mechanism string ≥40 chars describing HOW source
   *  produces target (tightened from ≥10 in Phase 2 §3.1). Validator
   *  gates anything shorter. */
  mechanism: string;
  /** Phase 2 §3.1 — gating condition for when this edge fires.
   *  Required non-empty when polarity === "conditional"; otherwise an
   *  empty string. Optional on the wire (older events emit before
   *  this field existed); consumers should default to "". */
  conditionText?: string;
  /** Structural dimension of the relationship. */
  dimension:
    | "structural"
    | "causal"
    | "temporal"
    | "logical"
    | "agentive";
  /** Direction of effect. */
  polarity: "positive" | "negative" | "conditional" | "neutral";
  /** Functional shape of the effect curve. */
  dynamics:
    | "linear"
    | "threshold"
    | "compounding"
    | "exponential"
    | "decay"
    | "delayed";
  /** 0..1 confidence on this relationship. LLM self-assessed —
   *  grounding badge = narrative. */
  confidence: number;
}

/**
 * Fires when an entity appears in two or more spaces. The painter
 * draws a thin dashed connector between its appearances in each
 * shell and stashes the entity's global id so it survives the
 * merge as a high-leverage node.
 */
export interface CrossSpaceLinkEvent {
  type: "cross_space_link";
  /** Global entity id that appears in multiple axes. */
  entityId: string;
  name: string;
  /** Axes this entity appears in. 2+. */
  axes: ProbabilitySpaceAxis[];
}

/**
 * Fires once when the merge phase begins. Canvas plays the merge
 * animation: shells lift toward center, mini-chips converge, cross-
 * space duplicates collapse. After this event no new
 * `space_entity_added` events are expected.
 */
export interface SpaceMergeBeginEvent {
  type: "space_merge_begin";
  spaceKeys: string[];
}

/**
 * Fires when the merge finishes — the unified KG now exists on the
 * main canvas and shells can be removed. Individual `entity_added`
 * events for the merged KG follow this event (the existing
 * structural stream continues as before).
 */
export interface SpaceMergeCompleteEvent {
  type: "space_merge_complete";
  /** Count of entities that were unique to a single axis. */
  soloEntityCount: number;
  /** Count of entities that appeared in 2+ axes — the leverage set. */
  leverageEntityCount: number;
}

// ── Phase 1.4 — Axis semantic score (live peer-review) ──
//
// Fires after the per-axis route's LLM-as-judge scorer finishes
// grading the just-generated axis output. Carries the weighted
// score + per-dimension breakdown so the rail can paint a "rigor"
// pill on the axis shell without an extra round-trip. NULL score
// happens when the axis output was thin or the scorer soft-failed;
// the event still fires so the UI can show "not scored" honestly
// rather than an indefinite loading state.
//
// Persisted to probability_space_runs.axis_semantic_score by the
// route handler; this event is the change-notification.
export interface AxisScoredEvent {
  type: "axis_scored";
  /** Same key the rail uses to find the shell (`${runId}:${axis}`). */
  spaceKey: string;
  axis: ProbabilitySpaceAxis | string; // string for ad-hoc axes
  /** Weighted [0,1]. Null when scoring was skipped / failed. */
  score: number | null;
  /** 5-dim breakdown when scoring ran. */
  breakdown: {
    specificity: number;
    mechanism_depth: number;
    distinctness: number;
    coverage: number;
    insight_density: number;
  } | null;
  /** Reviewer's 1-2 sentence comment. Empty string when none. */
  notes: string;
}

// ── Axis generator failure event ──
//
// Fires when a probability-space axis generator either hard-fails
// (LLM threw, no output) or returns thin output (below validator
// threshold). Before this event existed, a failed axis's shell sat
// in "opening…" state forever because no event ever marked it
// terminal. Shell reducer now flips to a visible "failed" state
// with the reason so the user knows what happened.
export interface AxisFailedEvent {
  type: "axis_failed";
  /** Same key the rail uses to find the shell (`${runId}:${axis}`). */
  spaceKey: string;
  axis: ProbabilitySpaceAxis | string;
  /** What kind of failure — drives the shell's error presentation. */
  reason: "thin_output" | "hard_fail" | "timeout";
  /** Operator-facing detail; safe to surface in tooltips. */
  errorMessage: string | null;
}

// ── Phase 3 §4.1 — target outcome identification ──
//
// Fires once per pipeline run, right after the target-outcome extractor
// runs (parallel to the question-type classifier in the frame
// extractor). Carries the full TargetOutcome payload so the rail UI
// can paint an "Outcome: <name>" pill on the origin card without an
// extra fetch, and so downstream stages (MC simulator, strategy
// ranker) can subscribe to the same change-notification.
//
// Persisted to pipeline_runs.target_outcome by the route handler
// (migration 20260424_target_outcome.sql); this event is the
// change-notification.
//
// Soft-emitted: when the extractor returns null (no extractable
// outcome), the event is NOT fired — silence means "outcome-agnostic
// run, downstream falls back to graph-only ranking."
export interface TargetOutcomeIdentifiedEvent {
  type: "target_outcome_identified";
  /** Run id this outcome belongs to. */
  runId: string;
  /** Human-readable label, 3-8 words. */
  name: string;
  /** Push the outcome up, down, or steady. */
  direction: "maximize" | "minimize" | "maintain";
  /** What kind of measurement the outcome is. */
  metricKind: "binary" | "continuous" | "distribution" | "qualitative";
  /** Time horizon hint; null when the input doesn't say. */
  horizon:
    | "immediate"
    | "short_term"
    | "medium_term"
    | "long_term"
    | null;
  /** Extractor self-confidence ∈ [0,1]. */
  confidence: number;
  /** One-sentence justification — surfaced as the pill tooltip. */
  rationale: string;
}

// ── Phase 2H · cross-domain analogy ──
//
// Fires when the analog-retrieval pipeline finds a structurally
// similar graph in another space (possibly another user, if that
// signature is anonymized-for-cross-user). Carries only labels +
// similarity, not descriptions or prompts — the privacy contract
// is enforced upstream in the retrieval RPC.
//
// Paints as a floating "analog found" card on the canvas. Clicking
// expands the entity pairings and insight; never auto-navigates to
// the source space (cross-user signatures don't expose their
// owner's graph).
export interface StructuralAnalogFoundEvent {
  type: "structural_analog_found";
  /** ID of the matched kg_signatures row. */
  signatureId: string;
  /** The matched space — may or may not be accessible to the user. */
  analogSpaceId: string;
  /** True when the match came from a different user's anonymized signature. */
  isCrossUser: boolean;
  /** Retrieval mode that produced this match. */
  mode: "structural" | "blended";
  /** Cosine similarity ∈ [0, 1]. */
  similarity: number;
  /** Short "shape tag" from the signature (e.g. "reinforcing-cycle / 12n 18e 1c — X → Y"). */
  analogSummary: string | null;
  /** LLM-generated headline describing the parallel. */
  headline: string;
  /** Source ↔ analog entity pairings. */
  entityPairings: Array<{
    sourceEntityName: string;
    analogEntityName: string;
    reason: string;
  }>;
  /** One-sentence actionable takeaway. */
  insight: string;
  /** Explainer confidence ∈ [0, 1]. */
  confidence: number;
}

// ── Batch 6 · canonical node signature deepening ──
//
// Fires every time the `signature_materializer` agent adds a ring to a
// node's signature. Each event maps to a `node_signatures` row UPDATE:
// basis array grew by one, canonical_code changed, version bumped.
//
// The canvas painter listens and animates a new ring layer onto the
// layered-circle visual — that's the whole point of the three-panel
// unravelling UI. Painter never synthesizes rings on its own; it paints
// only what the materializer persisted (structural-events-only rule).
//
// Separate from `entity_added` because the node already exists at this
// point — we're describing its refinement, not its creation. Painter
// draws nothing if no prior `entity_added` matched the entityId.
export interface SignatureDeepenedEvent {
  type: "signature_deepened";
  /** Which entity's signature grew. Matches `entity_added.entityId`. */
  entityId: string;
  /**
   * Full canonical code AFTER the deepen. Deterministic from the basis
   * list; painters should treat it as the stable key for the node across
   * synchronized panels (landscape ring / KG node / app result).
   */
  canonicalCode: string;
  /**
   * The basis element that was added in THIS event. Kept in one payload
   * so the painter can render the ring without a follow-up fetch.
   */
  addedRing: {
    index: number;
    code: string;
    label: string;
    sourceAxis: ProbabilitySpaceAxis | null;
    contribution: number;
    confidence: number;
    controllability: "direct" | "indirect" | "uncontrollable";
  };
  /** Total ring count after the deepen. Equals basis.length. */
  rings: number;
  /**
   * Residual uncertainty after this ring landed. 0..1. Drives the "fog"
   * opacity on the outermost ring. Monotonically non-increasing per
   * entity (deeper resolution = lower uncertainty) — painter can assert.
   */
  residualUncertainty: number;
  /** Schema version of the signature row after this update. */
  version: number;
}

// ── VP Project report — experiment taxonomy + variant events ──
//
// Two new structural events wired by the `domain_inferrer` agent
// (end of intake) and the `variant_factory` agent (proposal stage).
// The taxonomy event paints a taxonomy-card ghost shape on the
// canvas; the variant event animates a flashcard onto the carousel
// widget in any open App render.
//
// They are structural (not reasoning) because each corresponds to a
// persisted row: `experiment_taxonomies` / `experiment_variants`.
// The user can click the shape later to inspect that row.

/**
 * Fires once per run, at end of intake, after the domain-inferrer
 * agent picks a taxonomy schema for the space. Carries the full
 * slot list so the canvas painter can render an overview card
 * immediately (the DB write may still be in flight).
 */
export interface TaxonomyInferredEvent {
  type: "taxonomy_inferred";
  /** Row id from `experiment_taxonomies` — null when the DB write
   *  raced ahead of emission and the agent doesn't have the id yet;
   *  the painter falls back to `space_id` in that case. */
  taxonomyId: string | null;
  spaceId: string;
  /** Machine slug: "prompt" | "recipe" | "routine" | "generic" | … */
  domainKey: string;
  /** Display-noun bundle for the widgets' labels. */
  artifactNoun: string;
  variantNoun: string;
  situationNoun: string;
  /** Slot summaries — just id + label + color + ordering. Full slot
   *  details live on the DB row; this subset is enough for the
   *  canvas painter to draw the ring overview. */
  slots: Array<{
    id: string;
    label: string;
    color: string;
    ordering: number;
  }>;
  /** 0..1 inferrer confidence for the UI's "needs review" badge. */
  confidence: number;
}

/**
 * Fires once per materialized variant when the variant_factory agent
 * writes a new flashcard row. Carries card-header metadata so the
 * carousel can animate the card in immediately without waiting for
 * the detail fetch.
 */
export interface VariantProposedEvent {
  type: "variant_proposed";
  variantId: string;
  spaceId: string;
  appId: string | null;
  label: string;
  accentColor: string;
  status: string;              // matches taxonomy.status_vocabulary
  summary: string | null;
  shortId: string | null;
  situationKey: string | null;
  /** Denormalized aggregate scores known at creation time. May be
   *  null if the iv_scorer hasn't run yet; carousel shows a dash. */
  aggregateQuality: number | null;
  aggregateLift: number | null;
}

export type PipelineRunStatus = "running" | "completed" | "failed";

export interface PipelineRunRow {
  id: string;
  space_id: string;
  pipeline: string;
  status: PipelineRunStatus;
  started_at: string;
  completed_at: string | null;
  root_entity_id: string | null;
  initial_prompt: string | null;
  error_message: string | null;
  created_by: string;
}

// ── Root-Cause Trace — convergence-point identification ──
//
// Emitted by /api/pipeline/root-trace after backward-BFS from goals
// along the causal subgraph. Each event carries the N highest-scored
// root candidates for the trace cycle, so the canvas painter can
// animate the Problem→Root tree (or render callout fan-in markers
// for convergence points) without a follow-up fetch.
//
// Structural rule: only nodes the trace actually landed on get
// surfaced. We do NOT speculate about roots the trace couldn't
// reach; those stay invisible to the painter (residual epistemic
// honesty — if we didn't reach it, we don't claim it).
//
// Why one event instead of N per-root events:
//   The fan-in diagram is a gestalt — seeing "these 3 chains converge
//   on this one node" makes sense only when the renderer has all
//   three in hand. Emitting per-root would force the painter to
//   buffer + dedupe. Single event is simpler and matches the "one
//   trace = one event" semantic of a structural-event.
export interface RootCauseIdentifiedEvent {
  type: "root_cause_identified";
  /**
   * Goal entities traced in this cycle. The painter anchors the
   * fan-in tree at these nodes (Level 0 / "Problem" in Kaufman
   * terminology).
   */
  goalEntityIds: string[];
  /** Total entities reachable by backward BFS from at least one goal. */
  reachableCount: number;
  /**
   * How many reached entities have >= 2 goals converging on them.
   * convergencePoints > 0 is the signal that "multiple chains share
   * an upstream driver" — the whole point of the trace.
   */
  convergencePoints: number;
  /**
   * Entities that are leaves of the backward BFS (no further upstream
   * causal edges) AND reachable from >= 1 goal. Count, not list —
   * the list is in topRoots below, filtered by score.
   */
  rootCandidates: number;
  /**
   * Top-N roots by composite score. Painter renders these as the
   * keystone nodes in the fan-in tree.
   * root_score range [0,1]; depth is BFS hops from nearest goal.
   */
  topRoots: Array<{
    entityId: string;
    rootScore: number;
    causalDepth: number;
    convergesChains: string[]; // goal ids this root affects
  }>;
}

// ── Why-chain deepener — recursive causal decomposition ───────────────
//
// Emitted by /api/pipeline/decompose-why-chain after a batch of threads
// gets their 3-level causal driver trees generated. One event per batch
// (not per thread) because the front-end usually wants to render the
// summary card "N new causal drivers identified across M threads" in
// one paint, not a flood of per-thread updates.
//
// Structural rule holds: every driver referenced here corresponds to a
// row inserted into `entities`, every fan-in edge to a row in `edges`.
// Painter can click any entityId in topDriversByStopReason and drill
// into the real node.
export interface WhyChainDeepenedEvent {
  type: "why_chain_deepened";
  /** Threads that were deepened in this pass (display ids + names). */
  threads: Array<{ threadId: string; threadName: string }>;
  /** Total number of driver entities inserted across all threads. */
  driversAdded: number;
  /** Total number of causal edges inserted (primary + fan-in). */
  causalEdgesAdded: number;
  /** Drivers with stop_reason = "user_controllable" — future intervention points. */
  userControllableCount: number;
  /** Drivers with stop_reason = "external" — boundary of locus-of-control. */
  externalCount: number;
  /** Fan-in count: single driver causing multiple branches. This is the
   *  metric that tells the painter "real convergence is happening". */
  fanInEdgeCount: number;
  /** A small sample of the most-important drivers for UI preview. */
  topDrivers: Array<{
    entityId: string;
    name: string;
    stopReason: "external" | "user_controllable" | "continue" | "speculative";
    causeLevel: 1 | 2 | 3;
    threadId: string;
  }>;
}

// ── Multi-agent strategy consensus ───────────────────────────────────
//
// Emitted once per strategizer run, AFTER rankCandidates returns. Carries
// the multi-profile variance snapshot + the contentious-candidate set
// the ranker flagged (score_variance >= CONTENTIOUS_THRESHOLD).
//
// This is the "did the agents agree?" signal for the UI. A space where
// every profile picked the same top-5 paints green "consensus" chips;
// a space where profiles diverged paints orange "contested" chips and
// surfaces the variance breakdown so the user can see WHICH agents
// disagreed — the Kaufman "prioritization matrix + interrelationship
// diagram" result as a single event.
//
// Structural rule: every `contested_candidate_id` here corresponds to
// a candidate shortlisted by the strategizer, which itself corresponds
// to a real entity UUID. No speculation.
export interface StrategyConsensusReadyEvent {
  type: "strategy_consensus_ready";
  /** Plan id this consensus snapshot belongs to (FK into `space_plans`). */
  planId: string;
  /** Agent-profile ids that participated in this ranking (includes "default"). */
  profilesUsed: string[];
  /** Total candidates scored across all profiles. */
  candidatesScored: number;
  /** Candidates whose score_variance exceeds CONTENTIOUS_THRESHOLD. */
  contentedCandidateCount: number;
  /**
   * Top-N most-contentious candidates with per-profile breakdown so the UI
   * can render a mini matrix ("agent X ranked this #1, agent Y ranked it
   * #7"). Limited to 5 — anything further is noise in the UI.
   */
  topContentious: Array<{
    entityId: string;
    entityName: string;
    meanScore: number;
    scoreVariance: number;
    perAgent: Record<string, number>; // agent_id → score
  }>;
  /** Mean variance across ALL scored candidates. Surfaced as a single
   *  "consensus thermometer" reading on the space header. 0 = perfect
   *  consensus, 0.5+ = pervasive disagreement. */
  meanVariance: number;
}

// ── Piece 4 · Layer-coverage gate telemetry ──────────────────────────
//
// Emitted by synthesize / synthesize-layered whenever the layer-
// coverage gate detects at least one gap — either when we block the
// request (returned 409 to the caller) or when the caller forced
// through with `bypassLayerGate=true`. Giving the gap its own event
// type means:
//
//   - The auto-advance chain can always complete by passing
//     `bypassLayerGate=true`, yet the UI still learns the frame
//     declared layers the KG never populated. Without this event,
//     bypassing the gate would swallow the signal entirely.
//   - Manual callers hitting the 409 path can surface the gap on the
//     canvas even before the client parses the error body, since the
//     SSE stream delivers the event first.
//   - Downstream audit queries ("how often did we bypass?") become a
//     single event-type filter rather than log-mining.
//
// Soft-emit: gate passes with zero gaps → NO event (silence is the
// green path). Event only fires when the gate report has gaps OR a
// panel-block divergence.
export interface LayerCoverageGapEvent {
  type: "layer_coverage_gap";
  /** True iff the caller forced past a failing gate
   *  (bypassLayerGate=true). False when the gate blocked (caller
   *  received a 409). */
  bypassed: boolean;
  /** Space this gap report belongs to. Multi-space synthesize emits
   *  one event per space that has gaps; single-space synthesize-
   *  layered emits at most one. */
  spaceId: string;
  /** Human-readable summary the gate produced. UI may render as a
   *  warning banner verbatim. */
  message: string;
  /** Layer-level gap breakdown. `hard` means panel said required but
   *  KG empty (the blocking condition); `soft` means panel status was
   *  missing and KG also empty (a flag-not-block warning). */
  gaps: Array<{
    layer: "internal" | "conceptual" | "external" | "bridge";
    severity: "hard" | "soft";
    required_cell_count: number;
  }>;
  /** Topics of any panel block-severity divergences that contributed
   *  to the gate failing. Empty when the only cause was missing
   *  entities. */
  panel_block_divergences: string[];
}

// ── D1 · Measurement coverage gap event ───────────────────────────
//
// Companion to LayerCoverageGapEvent. Emitted when the measurement
// coverage gate finds fundamental/critical entities in measurable
// categories (concrete | abstract | process) lacking a unit + scale.
// Soft-emit: gate passing with zero gaps → no event.
//
// See src/lib/validation/measurement-coverage-gate.ts for gate logic
// and docs/KG_DEPTH_CRITIQUE.md §9 D1 for context.
export interface MeasurementCoverageGapEvent {
  type: "measurement_coverage_gap";
  /** True iff the caller forced past a failing gate
   *  (bypassMeasurementGate=true). */
  bypassed: boolean;
  spaceId: string;
  /** Human-readable summary; UI may render verbatim. */
  message: string;
  /** Aggregate stats for the UI to render coverage badges. */
  stats: {
    gated_count: number;
    measured_count: number;
    missing_count: number;
    coverage_ratio: number;
    threshold_applied: number;
  };
  /** Per-entity gaps, capped to the most relevant for event payload size.
   *  Full list available in the 409 response body when gate hard-blocks. */
  gaps: Array<{
    entity_id: string;
    entity_name: string;
    importance: "fundamental" | "critical";
    entity_category: "concrete" | "abstract" | "process";
    reason: "no_measurement_spec" | "partial_measurement_spec";
  }>;
}

// ── D8 · Community detection event ─────────────────────────────────
//
// Emitted once per detection run after kg_communities rows persist.
// Canvas listeners use this to render community boundaries + level
// indicators + an aggregate "structure detected: N communities at
// L levels, modularity X" badge. Soft-emit: a detection that found
// no meaningful communities (e.g. a single connected component with
// no internal density variation) emits the event with
// total_communities=0 so the UI can clear stale boundaries from
// previous runs.
//
// See src/lib/pipeline/community-detection.ts for the algorithm and
// docs/KG_DEPTH_CRITIQUE.md §9 D8 for the architectural context.
export interface CommunityDetectedEvent {
  type: "community_detected";
  spaceId: string;
  detection_run_id: string;
  /** Communities at every level. */
  total_communities: number;
  /** Maximum level depth reached. 0 = single-level partition only. */
  max_level: number;
  /** Aggregate modularity at level 0; 0..1 typical, < 0.3 = weak structure. */
  level_0_modularity: number;
  /** Per-level community counts for UI rendering. */
  level_breakdown: Array<{ level: number; count: number }>;
}

// ── Sprint A downstream composite events ───────────────────────────
//
// The Sprint A wrap-what-exists pass promotes four pre-built widgets
// to first-class tldraw shapes (downstream-reality, iv-decomposition,
// variant-carousel, stage-node). These events let the painter drop
// those shapes during the unfurl without needing to synthesize the
// data on the client — the producing agent packages everything the
// widget's standalone render needs into the event payload.
//
// Persistence rule: these events are structural (they correspond to
// rows in experiment_variants / experiment_variant_slots / variant_
// outcomes / causal_chains — tables that already exist). The event
// is persisted to pipeline_run_events verbatim and the canvas shape
// hydrates from the `*Json` fields. If the DB row is missing a score,
// the agent writes `null` into the event and the widget's empty
// branches render accordingly.

/**
 * Emitted when an App has enough scored variants + latent-finder
 * output to paint a downstream-reality heatmap. Source tables:
 * apps, experiment_variants, variant_outcomes (via the downstream_
 * reality resolver). One per app per run (later emissions for the
 * same appId upsert the existing canvas shape via version bump).
 */
export interface AppResultReadyEvent {
  type: "app_result_ready";
  spaceId: string;
  appId: string | null;
  /** Optional card title override; painter falls back to a default. */
  title: string | null;
  /** JSON.stringify(DownstreamReality) — opaque to the painter;
   *  parsed by the shape view. */
  realityJson: string;
  /** JSON.stringify(ExperimentVariant[]) */
  variantsJson: string;
  /** JSON.stringify(ExperimentTaxonomy) */
  taxonomyJson: string;
  accent: string;
  /** Painter-monotonic so upsert cycles re-render even when payload
   *  is identical. */
  version: number;
}

/**
 * Emitted when the active variant has been scored against the
 * inferred taxonomy's independent variables — so the rings in the
 * IV decomposition hero card have real numbers (not placeholders).
 * Source tables: experiment_variants, experiment_variant_slots,
 * experiment_taxonomies. Upserts on re-emission.
 */
export interface IVDecompositionReadyEvent {
  type: "iv_decomposition_ready";
  spaceId: string;
  appId: string | null;
  title: string | null;
  /** Prefer compact single-line layout on the canvas shape. */
  dense: boolean;
  /** JSON.stringify(VariantWithSlots | null) — null allowed when no
   *  active variant yet (shape renders an empty state). */
  variantJson: string;
  /** JSON.stringify(ExperimentTaxonomy) */
  taxonomyJson: string;
  accent: string;
  version: number;
}

/**
 * Emitted when the writer-path has materialized the full variant
 * deck and the carousel shape can be painted whole (as opposed to
 * the per-variant `variant_proposed` events which paint individual
 * flashcards during materialization). Typically fires after the
 * iv_scorer run so aggregate_quality / lift fields are filled.
 */
export interface VariantDeckReadyEvent {
  type: "variant_deck_ready";
  spaceId: string;
  appId: string | null;
  title: string | null;
  /** JSON.stringify(ExperimentVariant[]) — full deck. */
  variantsJson: string;
  /** JSON.stringify(ExperimentTaxonomy) */
  taxonomyJson: string;
  accent: string;
  version: number;
}

/**
 * Emitted once per stage when a causal chain crystallizes. The
 * painter drops a stage-node shape and wires an arrow to the
 * preceding stage (tracked by chainId + stageIndex). Terminal goal
 * stages share the same event shape — differentiated by isTerminal.
 */
export interface CausalStageReadyEvent {
  type: "causal_stage_ready";
  spaceId: string;
  chainId: string;
  chainName: string;
  chainRank: number;
  stageIndex: number;
  kind:
    | "concept"
    | "research"
    | "deliverable"
    | "application"
    | "outcome"
    | "goal";
  title: string;
  meta: string;
  confidence: number | null;
  verified: boolean;
  valueLabel: string | null;
  entityId: string | null;
  isTerminal: boolean;
  convergingCount: number | null;
}

// ── Situation analyzer + asset events ──────────────────────────────
//
// New layer between intake and landscape generation. Replaces the
// prior "all inputs flatten into intake_text" architecture with
// distinct asset cards + a dedicated baseline-twin card the canvas
// can render at top-of-flow.
//
// situation_analyzed fires once per space per run; asset_added fires
// once per uploaded file (typically only at intake time, but the
// route allows post-intake uploads too — they simply emit a stale
// asset_added under whatever run is active when the user uploads).

export interface SituationAnalyzedEvent {
  type: "situation_analyzed";
  spaceId: string;
  /** 0..1 — drives the situation-card's "uncertainty" pill color. */
  uncertaintyScore: number;
  inputsCount: number;
  processStepsCount: number;
  outputsCurrentCount: number;
  outputsTargetCount: number;
  knownsCount: number;
  unknownsCount: number;
  /** How many assets were attached at analysis time. The painter
   *  uses this to position the situation card relative to the asset
   *  row above it. */
  assetCount: number;
  /** When the analyzer skipped (vague intake / failure). null when
   *  the analyzer ran successfully. */
  skippedReason:
    | "twin_mode_structural"
    | "no_assets_no_richness"
    | "no_input_no_assets"
    | "analyzer_failed"
    | null;
}

export interface AssetAddedEvent {
  type: "asset_added";
  /** ingested_files.id — canonical handle. */
  assetId: string;
  spaceId: string;
  sourceName: string;
  /** From AssetClass enum in src/types/asset.ts. Painter uses this
   *  for icon + accent color selection. */
  assetClass:
    | "research_pdf"
    | "internal_doc"
    | "dataset"
    | "image_diagram"
    | "prior_analysis"
    | "spec_sheet"
    | "web_article"
    | "pasted_text";
  /** Character count of the normalized text — gives the user a
   *  rough sense of "how much content" the system absorbed. */
  charCount: number;
  /** When the file was uploaded — drives chronological ordering on
   *  the canvas asset row. */
  uploadedAt: string;
}

export interface MemoryContextLoadedEvent {
  type: "memory_context_loaded";
  /** Number of memory items retrieved and injected into the system prompt. */
  itemCount: number;
  /** Rough token estimate (chars / 4) of the injected context block. */
  tokenEstimate: number;
}

// ── Image extraction phase 2 (two-phase ingest, 2026-05-01) ────────
//
// /api/ingest now returns immediately for image MIME types — the file-
// card lands on canvas with status="analyzing". Phase 2 runs the
// Claude vision pass via /api/ingest/vision-extract. When that
// finishes, this event fires.
//
// Subscribers:
//   - file-card-shape: flip status badge to "ready" or "error"
//   - canvas painter: optionally call materialize-from-image to drop
//     the extracted entities + edges next to the file-card
//   - lasso-summarize / decompose: now safe to read the cached fields
//     off the ingested_files row when this image is in the selection
export interface ImageExtractedEvent {
  type: "image_extracted";
  /** ingested_files.id — canonical handle. */
  ingestedFileId: string;
  spaceId: string;
  /** How many entities the vision pass produced. Drives the file-
   *  card's "✦ N entities · M relationships" pill. */
  entityCount: number;
  relationshipCount: number;
  /** First ~120 chars of image_description so subscribers can update
   *  hover tooltips without a follow-up fetch. */
  description: string;
  /** Wall-clock ms for the vision call — surfaced in the run-events
   *  log for ad-hoc latency monitoring. */
  durationMs: number;
  /** Set when the vision pass failed; otherwise null. The file-card
   *  switches to its error badge when present. */
  error: string | null;
}

export interface PipelineRunEventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_type: StructuralEvent["type"];
  payload: StructuralEvent;
  emitted_at: string;
}

// ── KG Generation Plan events ────────────────────────────────────
//
// These five events drive the Plan Review Card surface on the
// whiteboard. The `plan_propose` pipeline stage emits
// kg_plan_proposed; user interaction emits kg_plan_edited /
// kg_plan_approved / kg_plan_rejected from the API routes; and
// layer_ontology_materialized fires once on approval as the
// per-space layer rows are inserted from the approved plan.
//
// The full plan body is too large for an event payload — these
// events carry just the planId + summary fields. Consumers fetch
// the full body via /api/spaces/[id]/kg-plans/[planId].

export interface KgPlanProposedEvent {
  type: "kg_plan_proposed";
  planId: string;
  /** Plan version. v1 is the initial proposal; iterative re-plans
   *  bump version + chain via supersedes_id. */
  version: number;
  /** Mode the plan was generated for ("consumer" | "clinician" |
   *  "researcher"). Drives which Plan Review Card sections render. */
  mode: string;
  /** 0..1 planner self-rating. UI surfaces this so users know
   *  whether to scrutinize the plan harder. */
  plannerConfidence: number | null;
  /** Summary counts for the Plan Review Card chip badges. */
  summary: {
    proposedLayerCount: number;
    proposedAxisCount: number;
    paperCount: number;
    coverageGapCount: number;
    estimatedNodeCount: number;
    estimatedEdgeCount: number;
    estimatedTokenCost: number;
    estimatedWallClockSeconds: number;
  };
}

export interface KgPlanEditedEvent {
  type: "kg_plan_edited";
  planId: string;
  /** Which section was edited. Drives the audit history list in
   *  the Plan Review Card. */
  section: string;
  /** Free-text reason the user gave for the edit (optional). */
  reason: string | null;
}

export interface KgPlanApprovedEvent {
  type: "kg_plan_approved";
  planId: string;
  approvedBy: string;
  /** Final plan body counts after any user edits. Lets downstream
   *  stages emit a "running plan vN with M layers, K axes" header. */
  summary: {
    layerCount: number;
    axisCount: number;
    paperCount: number;
  };
}

export interface KgPlanRejectedEvent {
  type: "kg_plan_rejected";
  planId: string;
  rejectionReason: string | null;
}

export interface LayerOntologyMaterializedEvent {
  type: "layer_ontology_materialized";
  /** The plan whose approval triggered the materialization. */
  planId: string;
  /** Number of layer_ontology rows inserted. */
  layerCount: number;
  /** Where the ontology came from — "starter" | "research_agent" |
   *  "user_authored" | "hybrid". */
  ontologySource: string;
  /** Slug of the starter template if ontologySource includes
   *  "starter"; null otherwise. */
  starterSlug: string | null;
}

// ── Cross-layer cascade prediction (D-track β) ────────────────────
//
// Emitted by the synthesize cascade-prediction hop when the
// `layer_dependencies` table has been refreshed for a space — i.e.
// after predictAndPersistLayerCascades() succeeds. Canvas surfaces
// (LayerStackShape inter-layer arrows, variant ripple chips) listen
// for this so they refetch the dependencies endpoint and repaint the
// inter-layer arrows live.
//
// Emit site: src/app/api/pipeline/synthesize/route.ts:2922
// Producer:  src/lib/pipeline/cross-layer-cascade-prediction.ts
// DDL:       supabase/migrations/20260620_layer_dependencies.sql
export interface LayerDependenciesMaterializedEvent {
  type: "layer_dependencies_materialized";
  /** How many cascade rows the LLM emitted (pre-validation). */
  emitted: number;
  /** How many rows actually got persisted after validation. */
  inserted: number;
  /** How many candidates were dropped by validation (invalid layer
   *  id, self-loop, bad enum, out-of-range strength/confidence,
   *  empty mechanism). */
  skipped: number;
}

// ── Phase 2 · Triangulation gap-flagging ──────────────────────────────
//
// Emitted by claim-producer (via triangulation-gap-detector) when a
// persisted claim has fewer than the required N independent supporting
// sources. Tells the research orchestrator: this claim is load-bearing
// but under-supported — target it next pass.
//
// Triangulation policy (default): require ≥2 distinct high-reliability
// supporters and zero high-reliability contradictors before promoting
// a claim to `status='supported'`. Anything below that threshold
// produces a gap event.
export interface TriangulationGapEvent {
  type: "triangulation_gap";
  /** The claim row that's under-supported. */
  claimId: string;
  /** Compact claim text — first ~200 chars, for log greppability + UI. */
  claimText: string;
  /** Distinct high-reliability supporting evidence sources today. */
  currentSupportCount: number;
  /** Triangulation threshold the orchestrator is configured to enforce. */
  requiredSupportCount: number;
  /** Whether at least one high-reliability contradictor is present —
   *  flips downstream policy from "find more support" to "investigate
   *  the contradiction first." */
  hasContradictor: boolean;
  /** Suggested follow-up search queries the orchestrator can fan out
   *  on the next pass. Built by the gap detector from the claim text
   *  + any related entity names. Empty array is fine — caller can
   *  freestyle queries from claimText. */
  suggestedQueries: string[];
}

// ── Phase 2 · Adversarial pass ───────────────────────────────────────
//
// Emitted by the adversarial route when an LLM-driven counter-evidence
// search produces a contradicting source for a previously-supported
// claim. Persistence happens via persistEvidenceBatch with
// support_type='contradicts'; the event is the canvas/log signal that
// a real contradiction landed (vs. a passive "could not find against").
export interface ContradictionFoundEvent {
  type: "contradiction_found";
  /** The original claim being challenged. */
  claimId: string;
  /** The new evidence_items row that contradicts it. */
  evidenceId: string;
  /** Source URL of the contradicting evidence — convenient for the
   *  canvas drawer + logs without an extra fetch. */
  sourceUrl: string;
  /** Reliability prior of the contradicting source (0..1). */
  sourceReliability: number;
  /** Claim's recomputed confidence after this contradiction landed —
   *  the Bayesian-ish posterior in claim-producer.ts demotes it
   *  automatically. UI can render the delta. */
  confidenceAfter: number;
}

// ── Phase 6 · Insight Lab events ─────────────────────────────────────
//
// Manual lab runs an algorithm "stack" (ordered list of registered
// algorithms) over a space's graph and emits ranked insights with
// provenance. These three events let the existing SSE infrastructure
// stream lab progress + results through pipeline_run_events instead of
// a parallel channel — the lab UI subscribes to the same /api/pipeline
// stream every other pipeline uses.
//
// Persistence target: lab_experiments + lab_insights tables (see
// 20260629_insight_lab.sql). Runtime: src/lib/insight-lab/.

/** Fired when a step in the stack starts executing. Stack composition
 *  is known up-front, so the UI can pre-render placeholder rows and
 *  fill them in as each step lands. */
export interface LabStepStartedEvent {
  type: "lab_step_started";
  /** lab_experiments.id — the experiment row this run is persisting to. */
  experimentId: string;
  /** Position in the stack (0-indexed). */
  stepIdx: number;
  /** Registered algorithm id (matches AlgoId in src/lib/insight-lab/types.ts). */
  algoId: string;
  /** Display name for the algorithm — denormalized so consumers don't
   *  need to round-trip to the registry. */
  algoName: string;
}

/** Fired once per insight emitted by a step. Carries enough payload
 *  for the canvas to render without a follow-up fetch — provenance is
 *  the algoId + stepIdx that produced it, raw native output is intentionally
 *  omitted from the event (it's persisted on the row). */
export interface LabInsightEmittedEvent {
  type: "lab_insight_emitted";
  experimentId: string;
  /** Stable insight key within the experiment (matches lab_insights.insight_key). */
  insightKey: string;
  kind:
    | "hub"
    | "bridge"
    | "cluster"
    | "cycle"
    | "community"
    | "cascade"
    | "pathway"
    | "tier";
  summary: string;
  /** Entities the insight references. Soft FK — may be deleted later. */
  entityIds: string[];
  /** Provenance — which step in the stack produced this insight. */
  algoId: string;
  stepIdx: number;
}

/** Fired once per scoring axis once all insights are scored. Lets the
 *  UI defer score rendering until the full distribution is known
 *  (perInsight ranges normalize per-axis, not per-insight). */
export interface LabScoreRecordedEvent {
  type: "lab_score_recorded";
  experimentId: string;
  /** Which scoring axis. v0 ships goal-match only; novelty +
   *  actionability arrive in Phase 6+. */
  axis: "goal_match" | "novelty" | "actionability";
  /** Aggregate score for the whole stack (0-1). */
  stackAvg: number;
  /** Number of insights that contributed to the stack average. */
  insightCount: number;
}

// ── SpecForge — engine lifecycle (KG state model Phase A) ──────────────
//
// Fired around each engine call inside a `pipeline=specforge` run so a
// future SSE-driven progress chip / side-panel timeline can subscribe to
// the existing event bus instead of a parallel channel. The durable
// rows live in specforge_engine_runs + specforge_reasoning_artifacts
// (migration 20260924). Payload is intentionally small: viewers fetch
// the artifact JSON on-demand when they need to render it.

export interface SpecForgeEngineStartedEvent {
  type: "specforge_engine_started";
  /** specforge_engine_runs.id — the row just inserted. */
  engineRunId: string;
  /** Engine id from SpecForgeEngineId (e.g. "problem_tree"). */
  engine: string;
  /** Position in the chain (0-indexed). */
  sequence: number;
  /** Total number of engines in the chain for the progress bar. */
  total: number;
}

export interface SpecForgeEngineCompletedEvent {
  type: "specforge_engine_completed";
  engineRunId: string;
  engine: string;
  sequence: number;
  status: "completed" | "failed" | "skipped";
  /** Whether the critic accepted the first pass. */
  criticPass: boolean | null;
  /** Whether a one-shot repair pass salvaged the output. */
  repaired: boolean;
}

// ── Problem-framing diverge-converge (Phase 1) ─────────────────────────
//
// The first diverge-converge cycle in the pipeline operates on PROBLEM
// FRAMINGS — multiple distinct ways to interpret what the user is
// actually trying to solve. Currently the framing panel runs 5 lenses
// in parallel and collapses their outputs into ONE merged
// SituationFrame; these events surface that work as a divergence cloud
// for downstream auditing + (future) user pick.
//
// Persistence: twin_proposals(kind='problem_twin'), frame_payload
// shape documented in 20260715_twin_proposals_kind_and_frame.sql.
//
// Today's emit pattern (smallest reversible first step):
//   1. frame-panel/route.ts emits framing_proposed when the merged
//      SituationFrame is persisted.
//   2. Same route auto-emits framing_approved immediately so
//      downstream stages (decompose, frame-extractor) keep their
//      contract on spaces.situation_frame.
//
// Future evolution: replace the auto-approve with a real gate page
// at /app/space/[id]/framing that lets the user re-rank options.
// The same framing_approved event fires when the user clicks
// Approve; the painter cares only about the event, not who emitted
// it.

/** Emitted when the framing panel has produced a SituationFrame and
 *  the corresponding twin_proposals(kind='problem_twin') row has been
 *  inserted. Carries enough preview info for the painter to render
 *  the framing-proposal card without a refetch; the shape itself can
 *  fetch the full frame_payload on mount via the GET endpoint. */
export interface FramingProposedEvent {
  type: "framing_proposed";
  /** twin_proposals.id of the inserted row. */
  proposalId: string;
  spaceId: string;
  /** How many candidate framings are in frame_payload.options[]. v0
   *  emits 1 (the merged SituationFrame as a single option) because
   *  the 5-lens panel doesn't yet diverge on whole framings. When
   *  the lens output schema is extended to emit per-lens framings,
   *  this rises to N. */
  optionCount: number;
  /** Currently chosen rank (1-indexed). v0 is always 1 since there's
   *  only one option; rises in meaning once the user can re-rank. */
  chosenRank: number;
  /** One-line "what this problem framing is" — derived from the
   *  merged frame's load-bearing assumption or the chosen option's
   *  framing_title. Renders on the card front. */
  chosenApproach: string;
  /** Lens IDs that participated (mirrors situation_frame.lenses_used).
   *  Surfaces "framed by N lenses" badge on the card. */
  supportingLenses: string[];
  /** Aggregate framing confidence 0..1, from situation_frame
   *  .framing_confidence. */
  framingConfidence: number;
}

/** Emitted when a problem_twin proposal is approved — either by the
 *  user via the /app/space/[id]/framing gate, or auto-approved by
 *  the frame-panel emitter so the downstream pipeline keeps working
 *  without a UI gate. Downstream stages (frame-extractor, decompose,
 *  propose-plan) can subscribe to this event to know "the chosen
 *  framing is now locked; condition your work on it."
 *
 *  Cascade behavior (future): a fresh framing_approved supersedes
 *  any prior strategy_twin / executable_twin rows for the same space
 *  via the existing twin_proposals.user_status='superseded' pattern. */
export interface FramingApprovedEvent {
  type: "framing_approved";
  /** twin_proposals.id of the approved row. */
  proposalId: string;
  spaceId: string;
  /** Whether this was a user-driven approval or an auto-approve.
   *  Today: "auto" on the frame-panel emit; flips to "user" when
   *  the framing gate page records a user pick. */
  approvalMode: "auto" | "user";
  /** Echo of the chosen framing's one-line description. Lets the
   *  painter close out the proposal card with a green "approved:
   *  {chosenApproach}" pill without a refetch. */
  chosenApproach: string;
}

/** Emitted when the user picks a different framing on the
 *  /app/space/[id]/framing gate page. Updates the audit trail without
 *  changing the row's approval lifecycle — the row stays 'approved',
 *  just with a different chosen_rank pointing at a different
 *  option in frame_payload.options[]. Downstream stages that have
 *  cached the prior chosen approach should refetch on this event.
 *
 *  This is distinct from framing_approved (which fires once when the
 *  row first lands as approved). framing_selected fires every time
 *  the user re-ranks AFTER the initial approval, giving us a clean
 *  per-pick audit log. */
export interface FramingSelectedEvent {
  type: "framing_selected";
  /** twin_proposals.id of the row whose chosen_rank changed. */
  proposalId: string;
  spaceId: string;
  /** The framing_id slug that was just promoted to chosen_rank=1. */
  chosenFramingId: string;
  /** Echo of the newly-chosen framing's one-line description. */
  chosenApproach: string;
  /** New chosen_rank (always 1 today — the picked option moves to
   *  rank 1 and the prior rank-1 demotes). Reserved for future
   *  paths that allow non-1 picks (e.g., explicit "ignore all,
   *  reject everything" surface). */
  chosenRank: number;
  /** Old chosen_rank that just got demoted. Lets the audit log
   *  read "rank 1 → rank 3 swap" instead of just "rank 1 now". */
  previousChosenRank: number;
  /** twin_proposals.id values of any strategy_twin / executable_twin
   *  rows that were cascade-superseded by this pick. Pessimistic
   *  policy: every re-pick supersedes ALL downstream twins because
   *  we don't currently track which framing a strategy was built
   *  against. UI consumers (chrome card / strategy gallery) read
   *  this list to show "your prior strategies were built against a
   *  different framing — regenerate?" Empty array when no downstream
   *  rows existed at pick time (first-time pick before strategy
   *  generation). */
  cascadeSupersededProposalIds: string[];
}

// ── Phase 2 lab diverge-converge events (Week 4, 2026-05) ─────────────
//
// Mirror the framing events. The lab-generation library produces 5
// stance-flavored lab-design proposals after the strategy_twin lands,
// persists as twin_proposals(kind='lab_twin'), emits these events.
//
// Persistence: twin_proposals.lab_payload (see
// 20260717_twin_proposals_lab_twin.sql). The detailed lab_payload
// shape + LabConfigOption type live in src/types/lab-options.ts so
// pipeline-events.ts stays focused on event surface only.

/** Lab-design stance — one of 5 epistemological stances that produce
 *  competing lab-design proposals. Mirrors LensId for framing. */
export type LabStanceLensId =
  | "tight_experimentalist"
  | "naturalistic_observer"
  | "adaptive_designer"
  | "pragmatist"
  | "mechanistic_prober";

/** Emitted when the lab-generation library has produced a set of
 *  options + persisted the lab_twin row. The painter dispatches a
 *  window CustomEvent (interaxis:lab-proposed) that
 *  lab-proposal-gate chrome consumes. */
export interface LabProposedEvent {
  type: "lab_proposed";
  /** twin_proposals.id of the inserted lab_twin row. */
  proposalId: string;
  spaceId: string;
  /** How many options landed in lab_payload.options[]. */
  optionCount: number;
  /** Currently chosen rank (1-based; initially highest-confidence). */
  chosenRank: number;
  /** One-line description of the chosen option's lab_title +
   *  chosen_approach prefix. Rendered on the chrome card. */
  chosenApproach: string;
  /** Which stance produced the chosen option. */
  chosenLens: LabStanceLensId;
  /** Aggregate confidence of the chosen option, 0..1. */
  confidence: number;
}

/** Emitted when a lab_twin row's user_status flips to 'approved'.
 *  Same dual-mode as framing_approved: 'auto' (no real divergence)
 *  or 'user' (gate page pick). */
export interface LabApprovedEvent {
  type: "lab_approved";
  proposalId: string;
  spaceId: string;
  approvalMode: "auto" | "user";
  /** Echo of the chosen lab's title + approach. */
  chosenApproach: string;
  /** Whether downstream apps were flagged stale (lab_regen) as a
   *  side effect of this approval. UI surfaces a banner
   *  "N apps flagged for regen against new lab." */
  flaggedAppsCount: number;
}

/** Emitted when the user re-ranks options on the gate page.
 *  Mirrors FramingSelectedEvent. */
export interface LabSelectedEvent {
  type: "lab_selected";
  proposalId: string;
  spaceId: string;
  chosenLabId: string;
  chosenApproach: string;
  chosenRank: number;
  previousChosenRank: number;
  /** Apps in this space that were marked 'lab_regen' as a result of
   *  the re-pick. Empty array when no apps existed at pick time. */
  cascadeAppIds: string[];
}

// ── Pipeline error/warning surfaces (Sprint C) ─────────────────────────
//
// Two event types that turn silent failures into observable signals.
// Until now, the strategy chain had ~5 silent-fail paths:
//   1. shouldAutoStrategyRefresh returns should_trigger_next=false
//      → no event, user waits forever
//   2. simulateEntityChain returns null distribution → silently
//      filtered out at canvas-proposal-rings.tsx (now fixed by A3,
//      but still worth emitting a warning so users know why a
//      proposal landed in "narrative grounding" mode)
//   3. DoWhy contract computation throws → console.warn only
//   4. wire-twin-proposal supersede/insert errors → console.warn
//   5. frame-panel persistAndEmitProblemTwin catch → console.warn
//
// All of these now emit through the SSE stream so the pipeline-error-
// banner chrome listener can render them. The events are persisted
// to pipeline_run_events like everything else; the banner subscribes
// via useRunEventStore and shows a dismissible accumulated trail.
//
// Discipline:
//   - WARNING = non-fatal, user can ignore (e.g., "narrative mode")
//   - ERROR = blocked path, user needs to know (e.g., "strategy
//     generation skipped: no trigger condition met")
//   - Both carry a `code` for programmatic categorization +
//     a `message` for direct display.

/** Non-fatal pipeline signal — the run continues but something
 *  degraded happened the user should know about. Examples:
 *   • Sparse KG meant simulation couldn't run → strategy got
 *     narrative-mode grounding instead of MC distribution
 *   • DoWhy contract failed → strategy renders without identification
 *     verdict (proposal still appears, just less rigorous)
 *   • Mediator-proposer skipped because no orphan clusters detected
 *
 *  Renders in chrome banner as amber chip. Auto-dismissed when the
 *  run completes successfully (no point camping warnings after the
 *  output landed). User can dismiss earlier. */
export interface PipelineWarningEvent {
  type: "pipeline_warning";
  /** Which pipeline stage produced the warning. Maps to the standard
   *  PipelineStage union when applicable; free-form for sub-stages
   *  (e.g. "synthesize.dowhy", "strategy-refresh.simulation"). */
  stage: string;
  /** Stable category code for programmatic handling. Examples:
   *   • "no_simulation_chain"
   *   • "dowhy_failed"
   *   • "no_strategy_trigger"
   *   • "sparse_kg"
   *   • "mediator_proposer_skipped"
   *  Keep snake_case. New codes are additive. */
  code: string;
  /** Human-readable one-liner for the chrome banner. ≤200 chars. */
  message: string;
  /** Optional structured details for debugging / future tooling.
   *  Kept generic (record) so the banner doesn't need to know the
   *  shape per code. */
  details?: Record<string, unknown>;
}

/** Fatal pipeline signal — a path the user expected to produce a
 *  visible artifact has failed. Examples:
 *   • Strategy generation returned no ranked_strategies (LLM exhausted
 *     retries)
 *   • Twin proposal persistence threw (DB error, RLS rejection)
 *   • Decompose Pass 2 produced 0 entities (extraction collapsed)
 *
 *  Renders in chrome banner as rose chip with "Investigate" CTA →
 *  opens the run context panel with the error pre-selected. Persists
 *  in the banner even after run completion until user dismisses. */
export interface PipelineErrorEvent {
  type: "pipeline_error";
  /** Which pipeline stage produced the error. See PipelineWarningEvent.stage. */
  stage: string;
  /** Stable category code. Examples:
   *   • "strategy_generation_empty"
   *   • "twin_proposal_insert_failed"
   *   • "decompose_zero_entities"
   *   • "llm_exhausted_retries"
   *  Keep snake_case. New codes are additive. */
  code: string;
  /** Human-readable one-liner. ≤200 chars. */
  message: string;
  /** Optional structured details. */
  details?: Record<string, unknown>;
  /** When the error is fatal-to-the-stage but the chain can continue
   *  (e.g. one proposal failed to compute its DoWhy but others
   *  succeeded), set to false so the banner shows a less-alarming
   *  tone. When the whole pipeline run is cancelled by this error,
   *  set to true so the banner blocks further pipeline progress
   *  perceptually. Defaults to false when omitted. */
  fatal?: boolean;
}

// ── Hidden signal detection events (2026-05-19) ──
//
// One structural-analysis finding from `extractSignals()` (in
// `src/lib/intelligence/signal-extraction.ts`). Fired by the
// `emitFilteredSignalEvents` helper invoked from synthesize/route.ts
// after each of the two extraction passes (pre-synthesis pass at
// line ~1031, post-synthesis pass at line ~2084).
//
// Deterministic `signalId` is a stable hash of signalType + the
// sorted primary entity IDs so Pass 2 re-emissions upsert the same
// canvas shape rather than stacking duplicates.
//
// Entity IDs use the display code form ("C7", "X3") to match the
// kg-node shape's `entityId` prop — the painter looks up the
// existing kg-node shape and anchors the signal shape adjacent.
export interface SignalDetectedEvent {
  type: "signal_detected";
  /** Stable hash of signalType + sorted primaryEntityIds — used as
   *  the tldraw shape id so re-emission updates in place. */
  signalId: string;
  signalType:
    | "structural_hole"
    | "hidden_variable"
    | "cascade_vulnerability"
    | "flip_prone_loop";
  /** One-line headline (e.g. "Single point of failure: User Trust"). */
  name: string;
  /** 1-2 sentence body explaining the finding. */
  description: string;
  /** 0-1 — how much this could change the trajectory if true. */
  trajectoryImpact: number;
  /** 0-1 — how confident the detector is that this signal exists. */
  confidence: number;
  /** Computed severity tier driving visual intensity. For
   *  cascade_vulnerability this mirrors the source's "critical | high
   *  | moderate" verbatim; for other types it's derived from
   *  trajectory_impact × confidence. */
  severity: "critical" | "moderate" | "low";
  /** Display entity codes (e.g. ["C7"]) the signal is primarily
   *  about. Cardinality varies by type:
   *    - cascade_vulnerability: 1 (the SPOF entity)
   *    - structural_hole: 2 (entity_a + entity_b)
   *    - hidden_variable: 2 (the two endpoints)
   *    - flip_prone_loop: 2 (the weakest edge's endpoints)
   *  The painter anchors the shape to the midpoint when 2, offset
   *  from the entity when 1. */
  primaryEntityIds: string[];
  /** Additional related entities (e.g. cascade's critical_downstream
   *  array or flip-prone-loop's full cycle membership). Used to
   *  light up adjacent kg-nodes on hover, NOT for positioning. */
  secondaryEntityIds: string[];
  /** Why this finding matters for the trajectory — surfaced in the
   *  expanded view inside the shape. */
  reasoning: string;
  /** What the user should do to validate/invalidate the signal —
   *  rendered as a CTA in the expanded view. */
  validationAction?: string;
}

// One aggregated event representing the long tail of lower-priority
// signals that were filtered out of the per-shape emission. Renders
// as a single HiddenSignalCluster shape (small chip in the canvas
// margin) showing the suppressed count + the type breakdown. Click
// expands a side-panel listing the suppressed signals individually.
//
// Emitted at most ONCE per extraction pass (so 0-2 per synthesize
// run). The painter upserts by clusterId so Pass 2's cluster
// replaces Pass 1's rather than stacking.
export interface SignalClusterEvent {
  type: "signal_cluster";
  /** Stable per-space cluster id (e.g. "signal-cluster-${spaceId}")
   *  so Pass 2 upserts the same shape. */
  clusterId: string;
  spaceId: string;
  /** Number of signals suppressed (not individually emitted). */
  suppressedCount: number;
  /** Type breakdown for the chip label ("12 signals: 4 holes, 5 vars,
   *  3 windows"). */
  topTypes: string[];
}

/**
 * Preliminary hypothesis — fast Haiku-class LLM call at the very
 * start of decompose. Produces 2-4 shallow hypotheses about what the
 * question is, what forces likely matter, what tensions to look for.
 * These exist purely to give the user something to react to within
 * 5-10s of clicking "Start", before the deep reasoning kicks in.
 *
 * Painter doesn't render these on the canvas (they're not structural
 * — too speculative). They surface ONLY in the middle insights feed
 * as low-confidence cards that get displaced when real
 * synthesis-stage insights land.
 */
export interface PreliminaryHypothesisEvent {
  type: "preliminary_hypothesis";
  /** Stable id — `hyp-${idx}` plus a millisecond suffix so re-emissions
   *  don't collide across runs of the same user input. */
  hypothesisId: string;
  /** What the LLM thinks the user is actually asking. Short headline. */
  headline: string;
  /** 1-2 sentence expansion of the headline. Treated as a hypothesis,
   *  not a finding — the UI marks it explicitly as "early guess." */
  body: string;
  /** Loose category for visual treatment: "framing" = how to read the
   *  question; "force" = a likely causal force at play; "tension" = a
   *  potential contradiction the LLM sniffed; "lever" = where the user
   *  might want to intervene. */
  category: "framing" | "force" | "tension" | "lever";
  /** Self-reported confidence 0..1. Always low (~0.3-0.5) — these are
   *  early guesses, not the deep-reasoning output. */
  confidence: number;
}
