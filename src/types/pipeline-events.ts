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
  | "lab"
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
  // Sprint A — wrap-what-exists pass: downstream composite events that
  // the canvas painter uses to drop full widget-backed shapes during
  // the unfurl. Each maps 1-1 to a first-class tldraw shape and a DB
  // row (or row set) so the shape persists correctly across reloads.
  | AppResultReadyEvent
  | IVDecompositionReadyEvent
  | VariantDeckReadyEvent
  | CausalStageReadyEvent
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
  // Memory context — emitted at decompose start when the user's
  // memory_items were queried and relevant prior context was injected
  // into the Pass 1 system prompt. Canvas HUD displays a subtle
  // "Drawing on N memories" chip while the LLM is reasoning.
  | MemoryContextLoadedEvent;

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

export interface PipelineRunEventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_type: StructuralEvent["type"];
  payload: StructuralEvent;
  emitted_at: string;
}
