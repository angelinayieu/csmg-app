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
  | StructuralAnalogFoundEvent;

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
  };
  /** Target entity UUID the distribution was measured on, when present. */
  targetEntityId?: string;
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
  /** LLM-generated mechanism string ≥10 chars describing HOW source
   *  produces target. Validator gates anything shorter. */
  mechanism: string;
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

export interface PipelineRunEventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_type: StructuralEvent["type"];
  payload: StructuralEvent;
  emitted_at: string;
}
