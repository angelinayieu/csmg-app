// Painter state schema + initial-state constructor extracted from
// pipeline-event-painter.tsx. Keeping the shape in its own file means
// the painter component can read `import type { PainterState }`
// without dragging the rest of the painter into it, and other
// modules (camera orchestration, paint handlers) can depend on the
// state shape without circular imports.

import type { TLShapeId } from "tldraw";
import { HubTracker } from "@/lib/graph/hub-discovery";
import type { RoomCounts } from "@/lib/whiteboard/room-layout";
import type { StreamedEvent } from "./hooks/use-structural-event-stream";

export interface GhostPosition {
  x: number;
  y: number;
  depth: number;
}

/**
 * Painter state bundled into a single object so callbacks can share it
 * without a dozen separate refs. Kept inside a useRef() on the component.
 */
export interface PainterState {
  /** Highest sequence enqueued into the paint queue. */
  lastEnqueuedSeq: number;
  /**
   * Pending events waiting to be painted. Drained at `STAGGER_MS`
   * cadence by the drain timer so bulk-emitted batches animate.
   */
  queue: StreamedEvent[];
  /** Active setTimeout id for the drain loop; null when idle. */
  drainTimer: ReturnType<typeof setTimeout> | null;
  /** P0 #3 — count of events remaining to drain at the fast
   *  BURST_STAGGER_MS cadence. Set when a large batch (≥ BURST_THRESHOLD)
   *  enqueues in one commit (backlog replay); decrements on each drain.
   *  Live events land with this at 0 and use STAGGER_MS. */
  burstRemaining: number;
  /** entity UUID → ghost kg-node shape id */
  ghostsByEntity: Map<string, TLShapeId>;
  /**
   * Normalized entity name → shape id of a *preview* ghost painted from
   * Pass 1 streaming (synthetic `preview-*` UUID). When Pass 2's real
   * entity_added event lands with a matching name, the painter deletes
   * the preview shape and paints the real entity in its place so the
   * user keeps seeing continuous geometry instead of a flicker.
   */
  previewsByName: Map<string, { shapeId: TLShapeId; entityId: string }>;
  /** edge pair key "src→tgt" → ghost arrow shape id */
  ghostEdgesByPair: Map<string, TLShapeId>;
  /** bridge pair key "src→tgt" → ghost bridge-arrow shape id */
  ghostBridgesByPair: Map<string, TLShapeId>;
  /** entity UUID → computed tree position (for sibling math on children). */
  positionsByEntity: Map<string, GhostPosition>;
  /** parent UUID → how many children of that parent have been placed. */
  childCountByParent: Map<string, number>;
  /** Count of root-level (no parent) nodes placed so far. */
  rootCount: number;
  anchor: { x: number; y: number } | null;
  /** Phase 2E · PR 4 — proposal ID → painted snapshot shape id.
   *  Prevents duplicate paints when the same proposal re-broadcasts. */
  proposalsById: Map<string, TLShapeId>;
  /** Project-Overview design pass — proposal ID → painted chain
   *  ribbon shape id. Tracked separately from the snapshot so cleanup
   *  can delete both without having to walk the tldraw doc. Populated
   *  only when the emitter included a `chain` field on the event. */
  chainRibbonsByProposal: Map<string, TLShapeId>;
  /** 5-column experiment-design card painted alongside experiment-kind
   *  proposals only. Tracked here so cleanup deletes it with the rest
   *  of the run-scoped ghosts. */
  experimentDesignByProposal: Map<string, TLShapeId>;
  /** Synthesis intersection card — single per run, painted before the
   *  first proposal_ready so proposals can anchor to it instead of
   *  individual entity ghosts. */
  synthesisCardShapeId: TLShapeId | null;
  /** Counter incremented each time a proposal_ready paints; bumps the
   *  synthesis card's "apps materialized" footer so the user sees the
   *  number tick up as the canvas unfurls. */
  synthesisAppsCount: number;
  /** Asset chips painted in the input row at top of canvas. Keyed by
   *  ingested_files.id so re-emission of the same asset upserts. */
  assetCardShapeIds: Map<string, TLShapeId>;
  /** Situation card painted below the asset row + origin-prompt. One
   *  per run. */
  situationCardShapeId: TLShapeId | null;
  /** Counter used to alternate left/right side placement of
   *  proposals anchored to the same entity. */
  proposalCount: number;
  // ── Strategy hero card (Phase B intake redesign) ─────────────────
  /** tldraw id of the persistent strategy hero card. Spawned by the
   *  first proposal_ready event of the run, then updated in-place as
   *  subsequent ranks materialize. The shape's preview props live on
   *  the tldraw doc; the full StrategyBatch is fetched on-demand from
   *  /api/spaces/[id]/twin-proposal so deep details (mechanisms,
   *  causal chains, infra proposals) stay fresh. Null until first
   *  proposal_ready arrives. */
  strategyHeroShapeId: TLShapeId | null;
  /** Cached space id for the active hero; needed by the swap handler
   *  and the on-mount fetch URL. Captured from the first proposal's
   *  context (event.spaceId is not on every proposal_ready, so we
   *  derive from the painter's existing anchor logic). */
  strategyHeroSpaceId: string | null;
  // ── Cascade rooms (Phase C) ─────────────────────────────────────
  /** stage → room shape id. Spawned on stage_boundary(enter); kept
   *  pinned for the run; pulse-updated as artifact-count events
   *  arrive within that stage's band. */
  roomShapeIds: Map<string, TLShapeId>;
  /** stage → live counts. Drives the room subtitle (e.g.
   *  "23 entities · 45 edges so far"). Mirrored on the room shape's
   *  `subtitle` prop on every change so the canvas re-renders
   *  without an extra DB read. */
  roomCounts: Map<string, RoomCounts>;
  // ── Origin prompt (lineage root) ───────────────────────────────
  /** tldraw id of the origin-prompt card. Created on the first event
   *  once the anchor lands so every downstream painter shape can
   *  tether up to it. Null when the painter has no prompt text (runs
   *  kicked off outside intake, e.g., strategy-refresh). */
  originPromptShapeId: TLShapeId | null;
  // ── Probability space shells (intake axis lenses) ──────────────
  /** spaceKey → painted shell shape id. Upsert-by-key so repeat
   *  emissions update in place instead of stacking duplicates. */
  spaceShellShapeIds: Map<string, TLShapeId>;
  /** Mirror of the per-shell ShellState so event reducers (entity
   *  added, edge added, score landed, …) can update the shape's JSON
   *  props without re-parsing them on every tick. Keyed by spaceKey. */
  spaceShellState: Map<
    string,
    {
      axis: string;
      label: string;
      tagline: string;
      accent: string;
      rationale: string;
      orderIndex: number;
      entities: Array<{
        entityId: string;
        name: string;
        weight: number;
        // Phase 0 — origin tag mirrored from SpaceEntityAddedEvent.
        // Lets the shell render speculative entities (LLM brainstorm
        // with no source) visually distinct from research-grounded ones.
        confidenceBasis?:
          | "llm_axis_brainstorm"
          | "paper_extracted"
          | "research_grounded"
          | "user_authored";
      }>;
      edges: Array<{
        sourceEntityId: string;
        targetEntityId: string;
        mechanism: string;
        polarity: "positive" | "negative" | "conditional" | "neutral";
        dynamics: string;
        confidence: number;
      }>;
      merging: boolean;
      score: {
        weighted: number;
        breakdown: {
          specificity: number;
          mechanism_depth: number;
          distinctness: number;
          coverage: number;
          insight_density: number;
        } | null;
        notes: string;
      } | null;
      /** Populated when the axis generator failed (hard_fail or thin
       *  output). Presence flips the shell out of "opening…" into a
       *  real error state so the user knows what happened. */
      failure: {
        reason: "thin_output" | "hard_fail" | "timeout";
        errorMessage: string | null;
      } | null;
      pulse: number;
    }
  >;
  // ── Project-Overview design pass — live KG formation overview ──
  /** tldraw id of the live "Knowledge Graph formation" card, or null
   *  until the first entity lands. Painter creates lazily on first
   *  entity_added rather than up-front so empty runs don't paint an
   *  orphan card. */
  kgFormationShapeId: TLShapeId | null;
  /** Thin dashed connectors from the KG formation card to each
   *  proposal-snapshot. Gives the user a visible "forked out of the
   *  landscape" line per proposal — the origin-chain the design
   *  reference showed via the vertical stage timeline. */
  originArrowIds: TLShapeId[];
  /** Incremental hub tracker — one per run. Replaces the earlier
   *  separate degreesByEntity + namesByEntity Maps. Uses the same
   *  HUB_MIN_DEGREE / HUB_TOP_N / nameHashSlot definitions that
   *  computeHubsFromGraph uses for static post-run consumers, so
   *  "what counts as a hub" doesn't drift between the live card and
   *  the explorer screens. */
  hubTracker: HubTracker;
  /** Monotonic pulse counter written onto the KG formation shape so
   *  React re-renders even when counts don't visually change. */
  kgFormationPulse: number;
  // ── VP Project report (Phase 3) — taxonomy card ────────────────
  /** tldraw id of the independent-variable taxonomy overview card.
   *  Painted once per run on `taxonomy_inferred`; null until that
   *  event arrives. Cleared on run completion just like the KG
   *  formation ghost. */
  taxonomyCardShapeId: TLShapeId | null;
  // ── VP Project report (Phase 3, Batch 2e) — variant flashcards ─
  /** variantId → tldraw shape id of the painted variant-card. Keyed
   *  by variantId for idempotent upsert: the factory emits on
   *  create, and the scorer later re-emits the same variantId with
   *  aggregate_quality / aggregate_lift filled in. Re-emission
   *  updates the existing card rather than stacking duplicates.
   *  Cleared on run completion like the taxonomy card. */
  variantCardShapeIds: Map<string, TLShapeId>;
  /** Running count of variants painted this run — drives the
   *  alternating-fan layout below the taxonomy card so new
   *  variants don't drift rightward. */
  variantCount: number;
  // ── Batch 7 · canonical node signatures ──
  /**
   * entity UUID → accumulated signature state. Every
   * `signature_deepened` event appends one ring to this map's value
   * so Batch 8's ring painter can read the latest canonical_code +
   * ring list without re-querying the DB. Cleared on run completion
   * alongside the other per-run caches.
   *
   * Shape matches the event payload rather than the full NodeSignature
   * — the painter only needs the canonical_code + rings for visual
   * rendering; full signature details live on entities.node_signature
   * and stream to the detail drawer on demand.
   */
  signaturesByEntity: Map<
    string,
    {
      canonicalCode: string;
      rings: Array<{
        index: number;
        code: string;
        label: string;
        sourceAxis: string | null;
        contribution: number;
        confidence: number;
        controllability: "direct" | "indirect" | "uncontrollable";
      }>;
      residualUncertainty: number;
      version: number;
    }
  >;
  // ── Root-cause tree (why-chain + root-trace) ────────────────────
  /** tldraw id of the root-cause tree overlay — one per run. Created
   *  lazily on the first `root_cause_identified` event; updated in
   *  place on later emissions and on `why_chain_deepened`. */
  rootCauseTreeShapeId: TLShapeId | null;
  /** P0 #2 — debounce timer for the stage-boundary zoom-to-fit
   *  call. Multiple stage_boundary events in quick succession
   *  coalesce into one camera move. null when no fit pending. */
  cameraFitTimer: ReturnType<typeof setTimeout> | null;
  /** Sprint B.5 — follow-mode gate. When true (default), painter
   *  auto-fits the viewport to downstream shapes as they arrive.
   *  Flips false the moment the user pans/zooms during an active
   *  run so our animations don't fight their manual navigation.
   *  Re-enabled via the "Follow downstream" chip (see painter JSX). */
  followCamera: boolean;
  /** Sprint B.5 — epoch-ms timestamp until which camera mutations
   *  are treated as our own (zoomToBounds animation in flight).
   *  Prevents the detection heuristic from mistaking the animated
   *  camera frames we just triggered for user pan input. */
  programmaticCameraUntil: number;
  /** Sprint B.5 — last camera snapshot sampled by the user-input
   *  detector. Compared against the current camera each tick to
   *  decide whether a user-initiated pan/zoom has occurred. */
  lastSeenCamera: { x: number; y: number; z: number } | null;
  // ── Sprint B — row-banded Sprint A shapes ───────────────────────
  /** appId → painted downstream-reality shape id. One per app per
   *  run; upsert on version bump. */
  appResultShapesByAppId: Map<string, TLShapeId>;
  /** Singleton IV-decomposition hero card for the run. Lazily
   *  created on first `iv_decomposition_ready`; upserted thereafter. */
  ivDecompositionShapeId: TLShapeId | null;
  /** Singleton variant-carousel deck shape. Upserted on
   *  `variant_deck_ready`. Distinct from the per-variant flashcards
   *  painted by `variant_proposed` (those live in the intake band). */
  variantCarouselShapeId: TLShapeId | null;
  /** `${chainId}:${stageIndex}` → stage-node shape id. Lets repeat
   *  emissions upsert a stage instead of stacking duplicates. */
  stageNodeShapesByKey: Map<string, TLShapeId>;
  /** chainId → ordered list of stage-node shape ids (by stageIndex
   *  landing order). Used to wire arrows between successive stages
   *  without having to re-scan the map. */
  stageNodesByChain: Map<string, TLShapeId[]>;
  /** `${chainId}:${stageIndex-1}→${stageIndex}` → arrow shape id.
   *  Prevents duplicate connector paints when a stage re-emits. */
  stageArrowsByKey: Map<string, TLShapeId>;
  /** Cross-row tether arrows (app-result → iv-decomposition → deck
   *  → synthesis). Tracked so cleanup can delete them alongside the
   *  shapes they connect. */
  rowTetherArrowIds: TLShapeId[];
  rootCauseTreeState: {
    nodes: Array<{
      id: string;
      name: string;
      depth: number;
      convergesCount: number;
      rootScore: number;
      isRoot: boolean;
      stopReason?: "external" | "user_controllable" | "continue" | "speculative";
      causeLevel?: 1 | 2 | 3;
    }>;
    edges: Array<{ source: string; target: string }>;
    goalEntityIds: string[];
    goalNames: string[];
    reachableCount: number;
    convergencePoints: number;
    rootCandidates: number;
    driversTotal: number;
    userControllableCount: number;
    version: number;
  } | null;
}

export function makeInitialState(): PainterState {
  return {
    lastEnqueuedSeq: 0,
    queue: [],
    drainTimer: null,
    burstRemaining: 0,
    ghostsByEntity: new Map(),
    previewsByName: new Map(),
    ghostEdgesByPair: new Map(),
    ghostBridgesByPair: new Map(),
    positionsByEntity: new Map(),
    childCountByParent: new Map(),
    rootCount: 0,
    anchor: null,
    proposalsById: new Map(),
    chainRibbonsByProposal: new Map(),
    experimentDesignByProposal: new Map(),
    synthesisCardShapeId: null,
    synthesisAppsCount: 0,
    assetCardShapeIds: new Map(),
    situationCardShapeId: null,
    proposalCount: 0,
    strategyHeroShapeId: null,
    strategyHeroSpaceId: null,
    roomShapeIds: new Map(),
    roomCounts: new Map(),
    originPromptShapeId: null,
    spaceShellShapeIds: new Map(),
    spaceShellState: new Map(),
    kgFormationShapeId: null,
    originArrowIds: [],
    hubTracker: new HubTracker(),
    kgFormationPulse: 0,
    taxonomyCardShapeId: null,
    variantCardShapeIds: new Map(),
    variantCount: 0,
    signaturesByEntity: new Map(),
    cameraFitTimer: null,
    followCamera: true,
    programmaticCameraUntil: 0,
    lastSeenCamera: null,
    rootCauseTreeShapeId: null,
    rootCauseTreeState: null,
    appResultShapesByAppId: new Map(),
    ivDecompositionShapeId: null,
    variantCarouselShapeId: null,
    stageNodeShapesByKey: new Map(),
    stageNodesByChain: new Map(),
    stageArrowsByKey: new Map(),
    rowTetherArrowIds: [],
  };
}
