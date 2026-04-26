import type { TLBaseShape } from "tldraw";
import type { LayerId } from "@/lib/whiteboard/layer-config";

export type StickyColor = "yellow" | "pink" | "blue" | "green" | "purple";

export type StickyDimension =
  | "problem"
  | "solution"
  | "question"
  | "insight"
  | "risk"
  | "evidence"
  | null;

export type StickyNoteShape = TLBaseShape<
  "sticky-note",
  {
    w: number;
    h: number;
    text: string;
    color: StickyColor;
    dimension: StickyDimension;
    aiTagged: boolean;
    entityId: string | null;
  }
>;

export type KGNodeShape = TLBaseShape<
  "kg-node",
  {
    w: number;
    h: number;
    entityId: string;
    name: string;
    description: string;
    layer: LayerId;
    category: string;
    tier: "hero" | "key" | "support" | "peripheral";
    weight: number;
    isLeverage: boolean;
    isRisk: boolean;
    isBottleneck: boolean;
    isConvergence: boolean;
    // Provisional state: entity exists in DB (source_tag="implicit") but user
    // hasn't confirmed it. Rendered translucent + dashed; an accept/reject
    // chip floats near the shape. On accept the flag flips to false + the
    // entity's source_tag is promoted to "confirmed".
    isGhost: boolean;
    // P0 #4 — monotonic counter, bumped by the painter when a preview
    // (Pass 1 speculative) kg-node is upgraded to a real entity (Pass 2
    // confirmed). The shape's view component plays a one-shot CSS
    // "identity-confirm" pulse when this increments, signaling the
    // moment the tentative card becomes real without moving it.
    confirmedPulse: number;
  }
>;

export type SynthesisCardShape = TLBaseShape<
  "synthesis-card",
  {
    w: number;
    h: number;
    kind: "leverage" | "risk" | "cycle" | "bridge" | "insight";
    title: string;
    body: string;
    sourceEntityIds: string[];
  }
>;

export type ClusterFrameShape = TLBaseShape<
  "cluster-frame",
  {
    w: number;
    h: number;
    title: string;
    collapsed: boolean;
    // tldraw shape ids (stringified) of child shapes that belong to this cluster
    childShapeIds: string[];
    // Stashed original positions so expand can restore them. Keyed by shape id.
    stashedPositions: Array<{ id: string; x: number; y: number }>;
    // Accent color derived from the dominant layer of children. Phase 5 keeps
    // this static; Phase 6 can recompute on child changes.
    accent: string;
    // Cached preview labels for the collapsed card (first 3 child names).
    previewLabels: string[];
  }
>;

// ── Strategy shape (Arc 4 Phase B) ─────────────────────────────────────
//
// Represents a strategy_snapshot as a draggable artifact on the canvas.
// Unlike KGNodeShape (which is a graph entity), this one is backed by a
// strategy_snapshots row. Users can drop v1 and v2 side-by-side, annotate
// with stickies, compare with the AI, and fork into a new variant.
//
// Props are a hydrated preview (title, composite score, version label) —
// NOT the full recommendation JSON. The shape fetches/caches the full
// strategy on expand. This keeps the tldraw document small and makes
// shapes cheap to duplicate on the canvas.

export type StrategyShapeStatus = "generated" | "reviewing" | "confirmed" | "superseded";

export type StrategyShape = TLBaseShape<
  "strategy-card",
  {
    w: number;
    h: number;
    /** strategy_snapshots.id — the canonical handle */
    snapshotId: string;
    /** strategy_snapshots.version — numeric */
    version: number;
    /** Resolved label (user_label ?? "v{version}") */
    label: string;
    /** Top-level summary title pulled from recommendation (core_move.name / title) */
    title: string;
    /** Lifecycle status — drives the status chip color */
    status: StrategyShapeStatus;
    /** Composite readiness 0–100 (matches Arc 1 ready-to-ship meter) — null when not computed */
    readyScore: number | null;
    /** Tactic count — preview metric on the compact card */
    tacticCount: number | null;
    /** LLM self-reported confidence 0–1 (pre-multiplied for display) — null if absent */
    confidence: number | null;
    /** When true, render the expanded cluster layout (tactics as child bullets); false = compact card */
    expanded: boolean;
  }
>;

// ── Thread note (Arc 5A — comment sub-branching) ──────────────────────
//
// Represents a single comment node in a tree rooted on some other shape
// (strategy card, sticky, KG node, another thread note). The shape props
// are kept minimal because content + authorship live in shape_threads
// table and are fetched via useThreadPersistence hook on mount.
//
// parentShapeId: immediate parent in the tree. null ⇒ root thread.
// rootShapeId: the top-level non-thread shape this tree is anchored on.
//              Denormalized here so we can find siblings without walking.
// depth: 0 = root, 1 = first reply, max 3 surfaced visually (deeper is
//        supported by DB but collapsed in UI to avoid noise).
// accentHex: parent's color snapshot at creation time — the tether +
//            accent bar inherit this so the thread feels visually bound
//            to its source. 7-char lowercase hex (#rrggbb).

export type ThreadNoteShape = TLBaseShape<
  "thread-note",
  {
    w: number;
    h: number;
    /** Row id in shape_threads table (uuid). Empty string during creation. */
    threadId: string;
    /** Content cached on the shape. Source of truth is shape_threads.content. */
    text: string;
    parentShapeId: string | null;
    rootShapeId: string;
    depth: number;
    accentHex: string;
    authorDisplay: string;
    createdAtIso: string;
    /** True while the server-side thread row hasn't been written yet (optimistic). */
    pending: boolean;
  }
>;

// ── Twin snapshot (Phase A1.4c — universal asset catalog) ───────────
//
// Frozen reading of a space's twin state at drop time. Unlike other
// asset classes, Twin is a per-space singleton — multiple drops
// produce multiple timestamped snapshots so users can compare
// trajectory over time. Each snapshot carries its own `snappedAt`
// which also differentiates shape ids (prevents collision when the
// same user drops "the twin" twice).
export type TwinSnapshotShape = TLBaseShape<
  "twin-snapshot",
  {
    w: number;
    h: number;
    spaceId: string;
    spaceName: string;
    /** ISO when the compute happened (also the tiebreaker in shape id). */
    snappedAt: string;
    /** 0..100 */
    healthScore: number;
    healthLabel: "strong" | "developing" | "fragile" | "critical";
    maturity:
      | "actionable_now"
      | "waiting_on_dependency"
      | "theoretical"
      | "blocked";
    entitiesCount: number;
    edgesCount: number;
    cyclesCount: number;
    leveragePoints: number;
    riskPoints: number;
    reinforcingPositive: number;
    reinforcingNegative: number;
    balancing: number;
    bottleneckName: string | null;
    /** 0..1 — bottleneck's blast_radius / entities_count */
    bottleneckShare: number | null;
  }
>;

// ── Convergent fan (Phase A1.4b — universal asset catalog) ───────────
//
// A convergent point (focal, interactors, conditions) → outcome.
// Polarity drives accent. Click → focal entity lab.
export type ConvergentFanShape = TLBaseShape<
  "convergent-fan",
  {
    w: number;
    h: number;
    pointId: string;
    spaceId: string;
    focalEntityId: string;
    focalName: string;
    interactorNames: string[];
    outcome: string;
    polarity: "positive" | "negative" | "neutral" | "conditional";
    probability: number;
    confidence: number;
  }
>;

// ── Signal flag (Phase A1.4b — universal asset catalog) ──────────────
//
// External intelligence signal from radar/weave. Severity drives
// accent + flag fill; high-urgency active signals get a stronger
// gradient + shadow treatment so they stand out.
export type SignalFlagShape = TLBaseShape<
  "signal-flag",
  {
    w: number;
    h: number;
    signalId: string;
    spaceId: string;
    signalType: string;
    category: string;
    description: string;
    severity: "high" | "medium" | "low";
    status: "active" | "dismissed" | "investigating" | "escalated" | "resolved";
    /** The external entity the signal is about (radar target). */
    entityName: string;
    relatedInternalIds: string[];
    detectedAt: string;
  }
>;

// ── Claim chip (Phase A1.4a — universal asset catalog) ──────────────
//
// Compact card for a Claim row — statement + status + confidence. Left
// rail color encodes status. Click → source entity lab when known.
export type ClaimChipShape = TLBaseShape<
  "claim-chip",
  {
    w: number;
    h: number;
    /** claims.id */
    claimId: string;
    spaceId: string;
    claimText: string;
    claimType:
      | "mechanism"
      | "assertion"
      | "prediction"
      | "assumption"
      | "finding";
    status: "proposed" | "supported" | "contested" | "refuted";
    /** 0..1 */
    confidence: number;
    sourceEntityId: string | null;
    sourceEntityName: string | null;
  }
>;

// ── Axiom stone (Phase A1.4a — universal asset catalog) ─────────────
//
// Load-bearing reasoning statement from synthesis. Monument-style
// typographic block so it feels foundational. No deep link — axioms
// live inside synthesis_data, so the shape renders a frozen copy of
// the full axiom content.
export type AxiomStoneShape = TLBaseShape<
  "axiom-stone",
  {
    w: number;
    h: number;
    /** Semantic id (e.g. "A2"); not a UUID. */
    axiomId: string;
    spaceId: string;
    claim: string;
    ifFalse: string;
    visibility: "EXPLICIT" | "IMPLICIT" | "HIDDEN";
    loadBearing: "critical" | "important" | "moderate";
    scope: "node" | "edge" | "chain" | "frame";
    confidence: "high" | "medium" | "low";
    restsOn: string[];
  }
>;

// ── Bridge link (Phase A1.3 — universal asset catalog) ───────────────
//
// Cross-space shared-variable link. Source/target labels rendered with
// a direction arrow encoding coupling_direction. Strength shown as a
// 3-bar indicator. Click → partner entity lab.
export type BridgeLinkShape = TLBaseShape<
  "bridge-link",
  {
    w: number;
    h: number;
    /** bridges.id */
    bridgeId: string;
    /** "this side" space id — where the bridge was dropped from */
    spaceId: string;
    sharedVariable: string;
    /** Pre-resolved display labels (this side vs partner side). */
    sourceLabel: string;
    targetLabel: string;
    couplingStrength: "strong" | "moderate" | "weak";
    couplingDirection: "source_to_target" | "target_to_source" | "bidirectional";
    /** 0..1 */
    confidence: number;
    partnerEntityId: string | null;
    partnerSpaceId: string | null;
  }
>;

// ── Cycle loop (Phase A1.3 — universal asset catalog) ────────────────
//
// Feedback loop. Classification drives visual accent and badge. Chain-
// preview cached at drop time so the shape renders without a fetch.
export type CycleLoopShape = TLBaseShape<
  "cycle-loop",
  {
    w: number;
    h: number;
    /** cycles.id */
    cycleId: string;
    spaceId: string;
    name: string;
    classification: "reinforcing_positive" | "reinforcing_negative" | "balancing";
    /** Up to ~5 entity names for the chain preview */
    entityNames: string[];
    /** Total node count in the cycle (may be > entityNames.length) */
    nodeCount: number;
    /** cycles.estimated_multiplier — null when not computed */
    multiplier: number | null;
    /** First entity id for click-through navigation */
    firstEntityId: string | null;
  }
>;

// ── App card (Phase A1.2 — universal asset catalog) ──────────────────
//
// Draggable representation of an App. Full App data (manifest/config/
// state) lives in the apps table — the shape holds only the preview
// props needed to render a card + click through to the app dashboard.
import type { AppType, AppStatus, AppStaleReason } from "@/types/app";

export type AppCardShape = TLBaseShape<
  "app-card",
  {
    w: number;
    h: number;
    /** apps.id */
    appId: string;
    /** Source space for the /app/space/<sid>/app/<aid> deep link */
    spaceId: string;
    /** Cached name for offline rendering */
    name: string;
    appType: AppType;
    status: AppStatus;
    /** 0..100 — null when not computed */
    healthScore: number | null;
    /** null = fresh; non-null = stale with reason */
    staleReason: AppStaleReason | null;
    hasInterventions: boolean;
    interventionCount: number;
    /** Hex — driven by app_type, cached at drop time */
    accent: string;
    /** Reserved for future expand/collapse; default false */
    expanded: boolean;
    /**
     * Monte Carlo distribution of this app's primary dominant entity's
     * outcome deviation. All three are null until simulate-entity-chain
     * runs (post-generate). When present, the card renders a compact
     * p10–p90 band below the title.
     */
    p10: number | null;
    p50: number | null;
    p90: number | null;
  }
>;

// ── Reaction card (Phase A1.1 — universal asset catalog) ─────────────
//
// Saved reaction surfaced as a draggable shape on the whiteboard. Like
// StrategyShape, only minimal preview props live on the shape; the full
// reaction (mechanism, implication, participants) hydrates via the
// canvas reactions context for hover preview. Click → opens the lab
// with the reaction pre-focused.
import type { ReactionType } from "@/types/reactions";

export type ReactionCardShape = TLBaseShape<
  "reaction-card",
  {
    w: number;
    h: number;
    /** reactions.id — the canonical handle */
    reactionId: string;
    /** Source space, kept for the lab deep-link */
    spaceId: string;
    /** Cached title for offline rendering */
    name: string;
    /** Reaction type drives left rail accent + chip color */
    reactionType: ReactionType;
    /** 0..1 cached at drop time */
    probability: number;
    /** Cached participant count for the footer line */
    entityCount: number;
    /** Hex color cached at drop time (matches reactionType color) */
    accent: string;
  }
>;

// ── Objective tree shape (Phase A1.7) ─────────────────────────────────
//
// Represents an entire objective tree (root + descendants) as a single
// draggable canvas shape. Collapsed view shows root title + progress
// ring + sub-count; expanded view renders the tree with per-node
// status dots, progress bars, and click-to-drill affordances.
//
// Props carry a JSON-serialized snapshot of the tree at drop time —
// NOT live state. A user who wants the latest can re-drag from the
// library (catalog refreshes lazily).

export type ObjectiveTreeShape = TLBaseShape<
  "objective-tree",
  {
    w: number;
    h: number;
    goalId: string;
    spaceId: string;
    title: string;
    status: string;
    objectiveType: string;
    /** 0–100 recursive progress at drop time. */
    progress: number;
    nodeCount: number;
    depth: number;
    proposedCount: number;
    /** Serialized GoalTreeNode — shape hydrates from this. */
    treeJson: string;
    /** Start collapsed; click expands to full tree. */
    expanded: boolean;
  }
>;

// ── File card shape (Phase 2D) ──
//
// Persisted ingest record — a file, URL, or pasted text that has
// been normalized via /api/ingest. Unlike source cards (which point
// to external research), file cards represent the user's own
// uploads + browse history.
export type FileCardShape = TLBaseShape<
  "file-card",
  {
    w: number;
    h: number;
    fileId: string;
    spaceId: string;
    sourceName: string;
    sourceType: "file" | "url" | "text";
    mimeType: string | null;
    sourceUrl: string | null;
    preview: string;
    charCount: number;
    analyzed: boolean;
    accent: string;
  }
>;

// ── Thread snapshot shape (Phase 2D) ──
//
// A frozen preview of a shape_threads conversation. Dropped on
// canvas so the user has a visible pointer to a discussion that
// lives on another shape. Click navigates to the source shape +
// highlights it on the canvas.
export type ThreadSnapshotShape = TLBaseShape<
  "thread-snapshot",
  {
    w: number;
    h: number;
    threadId: string;
    spaceId: string;
    rootShapeId: string;
    rootContent: string;
    authorDisplay: string;
    replyCount: number;
    latestReply: string | null;
    latestAt: string;
    accent: string;
  }
>;

// ── Proposal snapshot shape (Phase 2E · PR 4) ──
//
// Forked card emitted by the pipeline-event-painter when a
// `proposal_ready` event fires with a targetEntityId already
// rendered as a ghost on the canvas. Rendered to the left / right
// of its target entity with an animated connector arrow so the
// proposal visually "forks off" the entity it references.
export type ProposalSnapshotShape = TLBaseShape<
  "proposal-snapshot",
  {
    w: number;
    h: number;
    proposalId: string;
    kind: "strategy" | "experiment" | "variant";
    title: string;
    headline: string;
    targetEntityId: string | null;
    p10: number | null;
    p50: number | null;
    p90: number | null;
    /** Provenance of p10/p50/p90 — "mc_simulation" / "bootstrap" /
     *  "composite_computed" / "llm_estimate" / "". Empty string when
     *  pre-migration event replays without the field; UI treats empty
     *  same as llm_estimate. See pipeline-events.ts
     *  ProposalReadyEvent.distribution.provenance. */
    distributionProvenance: string;
    /** Samples backing the distribution (null for LLM estimates). */
    distributionSampleCount: number | null;
    accent: string;
    /**
     * Phase 2E · PR 5 — probability-space axes that contributed
     * supporting entities to this proposal. Rendered as a small row
     * of axis-colored chips below the title so the user can see
     * which lenses the proposal stands on before opening it.
     *
     * Stored as string[] (not the typed union) because tldraw shape
     * props need to round-trip through T.arrayOf(T.string); the
     * values themselves are always ProbabilitySpaceAxis at runtime.
     */
    axesUsed: string[];
  }
>;

// ── Source card shape (Phase 2D) ──
//
// External-input card — evidence, URL, file reference, or
// integration placeholder. Drag-from-Sources-folder lands as one
// of these. Unlike entity/claim cards (which reference a DB row),
// a source card can reference any of three backing records based
// on `sourceType`.
export type SourceCardShape = TLBaseShape<
  "source-card",
  {
    w: number;
    h: number;
    sourceId: string;
    spaceId: string;
    title: string;
    snippet: string;
    url: string | null;
    domain: string | null;
    sourceType:
      | "evidence"
      | "external_entity"
      | "file"
      | "url"
      | "integration_placeholder";
    provider: string | null;
    reliability: number | null;
    accent: string;
  }
>;

// ── KG Formation live overview (Project-Overview design pass) ──
//
// Live "landscape" card painted at the top of the canvas during an active
// pipeline run. Not a persisted artifact — the painter creates + mutates
// it as structural events arrive, then deletes it on run completion.
// Hubs carried as JSON (flat schema) — runtime shape is Array<{name, degree}>.
export type KGFormationShape = TLBaseShape<
  "kg-formation",
  {
    w: number;
    h: number;
    entityCount: number;
    edgeCount: number;
    hubCount: number;
    /** JSON-encoded Array<{ name: string; degree: number }>, max 6 entries. */
    hubsJson: string;
    /** JSON-encoded Array<{ a: string; b: string }> of REAL edges
     *  among the visible top hubs. Replaces the cosmetic all-pairs
     *  lines the renderer used to draw — only hubs actually
     *  connected by an edge get a connecting stroke now. Default
     *  "[]" for back-compat with persisted shapes from earlier
     *  builds; the renderer falls back gracefully when empty. */
    hubEdgesJson: string;
    /** Monotonic counter bumped each paint so React re-renders even when
     *  counts stayed same (e.g. edge added between existing hubs). */
    pulse: number;
    accent: string;
  }
>;

// ── Proposal chain ribbon (Project-Overview design pass) ──
//
// Thin companion card docked directly below a proposal-snapshot.
// Renders the reasoning chain that produced the proposal — a
// breadcrumb of upstream entity names → target, plus a signed lift
// chip (p50 deviation from simulate-entity-chain). Surfaces the
// "HOW did we get here?" answer the snapshot card alone can't fit.
//
// Not persisted. Painted by pipeline-event-painter on proposal_ready
// events that carry the optional `chain` field; cleaned up alongside
// the snapshot on run completion.
export type ProposalChainRibbonShape = TLBaseShape<
  "proposal-chain-ribbon",
  {
    w: number;
    h: number;
    proposalId: string;
    kind: "strategy" | "experiment" | "variant";
    /** Compact identifier like "S-1" / "E-4.2" — shown on the left
     *  badge so users can cross-reference ribbons. */
    shortId: string;
    /** Upstream → target entity names, in causal order. Max 4-5
     *  rendered; overflow collapses to "+N". */
    nodeNames: string[];
    /** Signed p50 deviation from the Monte Carlo chain simulation.
     *  null when no simulation was run for this proposal (legacy
     *  emits, or target entity couldn't be resolved). */
    lift: number | null;
    /** Optional one-word tag describing the primary constraint /
     *  lever the proposal acts on (e.g. "throughput", "timeline"). */
    constraintLabel: string | null;
    accent: string;
  }
>;

// ── Taxonomy Card (VP Project report — Phase 3) ─────────────────────
//
// Painted once per run at the tail of intake, right after the domain-
// inferrer emits `taxonomy_inferred`. A compact landscape of the
// independent variables the user's situation can be decomposed into —
// the same 4-6 rings that show up on the DecomposedPromptViz widget
// in the final report. Surfaces the inferrer's confidence + domain
// nickname ("prompt", "recipe", "routine") so the user can challenge
// the classification early.
//
// Not a persisted shape on the tldraw store — the painter creates +
// mutates it as the taxonomy stabilizes, then cleans up on run
// complete. The persisted truth lives in `experiment_taxonomies`.
export type TaxonomyCardShape = TLBaseShape<
  "taxonomy-card",
  {
    w: number;
    h: number;
    /** DB row id from experiment_taxonomies. Null when the DB write
     *  raced ahead of emission; painter falls back to spaceId. */
    taxonomyId: string | null;
    spaceId: string;
    domainKey: string;           // "prompt" / "recipe" / "routine"
    artifactNoun: string;        // "prompt"
    variantNoun: string;         // "variant"
    situationNoun: string;       // "situation"
    /** JSON-encoded slots Array<{id,label,color,ordering}>; kept as
     *  string to sidestep tldraw's flat prop schema. Ordering is the
     *  source of truth for ring order. */
    slotsJson: string;
    /** 0..1 inferrer self-confidence. UI renders a "needs review"
     *  badge when this is below 0.6. */
    confidence: number;
    accent: string;
  }
>;

// ── Variant card (VP Project report — Phase 3, Batch 2e) ───────────
//
// Painted live by the pipeline-event-painter when a `variant_proposed`
// event fires from the writer-path pipeline. Sits below the taxonomy
// card and fans out per-variant as the factory materializes them.
//
// Like the taxonomy card, this is run-scoped ghost geometry — the
// canonical variant row lives in `experiment_variants` and the
// definitive UI surface is the VariantCarouselWidget on the App page.
// Canvas presence is purely to give the "variants materializing" feel
// during the after()-fired writer-path run.
//
// Aggregate scores carry through when known at proposal time. The
// scorer re-emits the same variantId later with aggregate_quality /
// aggregate_lift filled in, so the painter upserts this shape.
export type VariantCardShape = TLBaseShape<
  "variant-card",
  {
    w: number;
    h: number;
    /** experiment_variants.id — canonical handle. */
    variantId: string;
    spaceId: string;
    /** apps.id or null for space-level variants. */
    appId: string | null;
    label: string;
    /** Status pill text — free-form (taxonomy.status_vocabulary). */
    status: string;
    summary: string | null;
    shortId: string | null;
    situationKey: string | null;
    /** 0..1; null until scorer runs. UI shows a dash when null. */
    aggregateQuality: number | null;
    /** -1..+1; null until scorer runs. */
    aggregateLift: number | null;
    /** Hex, seeded from taxonomy's palette. */
    accent: string;
  }
>;

// ── Root-cause tree shape (why-chain + root-trace visualization) ─────
//
// Kaufman-style fan-in diagram. Renders Goal(s) as the anchor column
// on the right, then columns of nodes arranged by BFS depth fanning
// leftward — the deeper upstream, the further left. Convergence
// points (nodes reached by >=2 chains) get a distinctive ring +
// counter chip; root candidates (BFS leaves) get a highlighted outline.
//
// Nodes are laid out DETERMINISTICALLY inside the shape's own SVG:
// we do NOT spawn individual tldraw shapes per driver because (a) the
// driver entities already exist as kg-node ghosts with their own
// spatial identity, and (b) the fan-in diagram is a GESTALT — it only
// reads as "three chains converge here" when rendered as one composed
// picture. Clicking a node inside the shape dispatches a pan/zoom to
// the corresponding kg-node ghost.
//
// Painted by pipeline-event-painter on `root_cause_identified` (creates
// or updates the tree) and `why_chain_deepened` (refreshes driver
// counts in the header). One shape per space — upserts on re-emission.
export type RootCauseTreeShape = TLBaseShape<
  "root-cause-tree",
  {
    w: number;
    h: number;
    /** Stable id — space_id for the space this tree summarizes. */
    spaceId: string;
    /** Display title rendered in the header. */
    title: string;
    /** Goal entity ids — anchor the rightmost column. */
    goalEntityIds: string[];
    /** Labels for the goal column (falls back to "Goal N" if lookup
     *  didn't resolve a name). Same length as goalEntityIds. */
    goalNames: string[];
    /** JSON-packed node records. Each:
     *  { id, name, depth, convergesCount, rootScore, isRoot, stopReason, causeLevel }
     *  Packed as JSON string so tldraw's prop validation stays flat —
     *  rich object shapes are painful to validate with T.object. */
    nodesJson: string;
    /** JSON-packed source→target pairs (both ids reference nodes
     *  inside nodesJson or goalEntityIds). */
    edgesJson: string;
    /** Total entities reached by the backward BFS. Rendered in header. */
    reachableCount: number;
    /** Entities hit by >=2 goal chains. */
    convergencePoints: number;
    /** BFS-leaf entities. */
    rootCandidates: number;
    /** Total drivers across all deepened threads — populated when a
     *  why_chain_deepened event arrives. 0 until then. */
    driversTotal: number;
    /** Drivers flagged as user-controllable (intervention candidates). */
    userControllableCount: number;
    /** Hex accent color — default deep plum so the shape reads as a
     *  distinct "analytical overlay" vs proposal/formation cards. */
    accent: string;
    /** Version counter incremented on upsert so React re-renders
     *  even when a prop mutation would otherwise be a no-op. */
    version: number;
  }
>;

// ── Downstream Reality shape (Sprint A — wrap-what-exists) ──────────
//
// Tldraw wrapper around the DownstreamReality widget. Renders the
// variant-landscape heatmap (variants × latent outcome dimensions) as
// a canvas-first artifact so the painter can drop it during the
// downstream band of the unfurl. Full resolved payloads are
// JSON-serialized onto the shape; the wrapper re-hydrates them inside
// a standalone widget context (no AppRenderer needed).
export type DownstreamRealityShape = TLBaseShape<
  "downstream-reality",
  {
    w: number;
    h: number;
    spaceId: string;
    /** Optional link to apps.id when this downstream view belongs to a
     *  specific App; null for space-level composites. */
    appId: string | null;
    /** Optional card title override (falls back to "Variant landscape"). */
    title: string | null;
    /** JSON-encoded DownstreamReality snapshot (latent_variables +
     *  scores_by_variant). Stored flat so tldraw prop validation stays
     *  simple; hydrated once per render via JSON.parse behind memo. */
    realityJson: string;
    /** JSON-encoded ExperimentVariant[]. */
    variantsJson: string;
    /** JSON-encoded ExperimentTaxonomy (nouns + outcome_axes +
     *  status_vocabulary). */
    taxonomyJson: string;
    accent: string;
    /** Bump on upsert so React re-renders when identical prop values
     *  would otherwise be elided. */
    version: number;
  }
>;

// ── IV Decomposition shape (Sprint A — wrap-what-exists) ────────────
//
// Wraps the IVDecomposition widget — the ring-per-independent-variable
// breakdown of the active variant. Same JSON-serialized hydration
// pattern as DownstreamRealityShape.
export type IVDecompositionShape = TLBaseShape<
  "iv-decomposition",
  {
    w: number;
    h: number;
    spaceId: string;
    appId: string | null;
    title: string | null;
    /** Compact single-line layout (matches widget's `dense` config). */
    dense: boolean;
    /** JSON-encoded VariantWithSlots — may be "null" when no active
     *  variant yet; widget renders an empty state in that case. */
    variantJson: string;
    /** JSON-encoded ExperimentTaxonomy. */
    taxonomyJson: string;
    accent: string;
    version: number;
  }
>;

// ── Variant Carousel shape (Sprint A — wrap-what-exists) ────────────
//
// Wraps the VariantCarousel widget — 3D coverflow of experiment
// variants. Activation / focus dispatches are no-ops in canvas
// context; the cinematic preview is what matters here, not the side
// effects.
export type VariantCarouselShape = TLBaseShape<
  "variant-carousel",
  {
    w: number;
    h: number;
    spaceId: string;
    appId: string | null;
    title: string | null;
    /** JSON-encoded ExperimentVariant[]. */
    variantsJson: string;
    /** JSON-encoded ExperimentTaxonomy. */
    taxonomyJson: string;
    accent: string;
    version: number;
  }
>;

// ── Stage node shape (Sprint A — wrap-what-exists) ──────────────────
//
// Canvas-native port of the causal-chains StageNode visual. Each
// stage of a causal chain becomes its own tldraw shape so the painter
// can unfurl them left-to-right in the root-cause band; arrows between
// stages are drawn as tldraw arrow shapes (bound via createBindings).
//
// The ReactFlow Handle + NodeProps machinery from the original
// component is replaced by plain HTMLContainer + tldraw arrows — same
// pixel-for-pixel visual, zero ReactFlow dependency inside tldraw.
export type StageNodeShape = TLBaseShape<
  "stage-node",
  {
    w: number;
    h: number;
    spaceId: string;
    chainId: string;
    chainName: string;
    /** 1-indexed rank of the parent chain (for the corner badge). */
    chainRank: number;
    /** 0..5 position along the 6-stage chain. */
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
    /** 0..1 — drives confidence dots when valueLabel absent. */
    confidence: number | null;
    verified: boolean;
    /** Short headline like "+23%" — takes precedence over dots. */
    valueLabel: string | null;
    /** Entity backing this stage, if any. */
    entityId: string | null;
    /** Marks the terminal goal node (shimmer + chains-count label). */
    isTerminal: boolean;
    /** How many chains converge on this terminal. Null when not terminal. */
    convergingCount: number | null;
  }
>;

// ── Asset card (ingested file chip in the input row) ──
//
// Painted by pipeline-event-painter on `asset_added` events fired
// from intake/bootstrap when one or more files were uploaded via
// /api/ingest before the user submitted the prompt. Sits in a
// horizontal row to the right of the origin-prompt card so the
// canvas reads as: prompt + the assets we have to work with.
//
// Run-scoped — cleaned up alongside the rest of the painter's
// emission overlay. The DB row in `ingested_files` is the canonical
// truth; the canvas chip is a runtime visualization.

export type AssetCardClass =
  | "research_pdf"
  | "internal_doc"
  | "dataset"
  | "image_diagram"
  | "prior_analysis"
  | "spec_sheet"
  | "web_article"
  | "pasted_text";

export type AssetCardShape = TLBaseShape<
  "asset-card",
  {
    w: number;
    h: number;
    /** ingested_files.id — canonical handle for click-through. */
    assetId: string;
    spaceId: string;
    sourceName: string;
    assetClass: AssetCardClass;
    /** Character count of normalized text — gives the user a rough
     *  sense of how much content the system absorbed. */
    charCount: number;
    accent: string;
    /** ISO timestamp when uploaded. Surfaces as relative time on the
     *  card ("2m ago" / "uploaded just now"). */
    uploadedAt: string;
  }
>;

// ── Situation card (current-state baseline) ──
//
// Painted by pipeline-event-painter on `situation_analyzed` events.
// Renders the SituationBaseline as a five-section "current state"
// card (inputs / process / outputs / knowns / unknowns) with an
// uncertainty pill in the header. Sits below the origin-prompt +
// asset row, above the probability-space-shells.
//
// Run-scoped. The full baseline lives on spaces.situation_baseline;
// the card stores summary counts so React doesn't re-parse a large
// JSON blob on every prop change.

/**
 * Allowed values: "" (analyzer ran successfully) or one of the
 * skipped_reason enum values from src/types/situation.ts. Stored
 * as plain string on the shape props so tldraw's prop validator
 * stays simple — the renderer narrows by string compare.
 */
export type SituationCardSkippedReason =
  | "twin_mode_structural"
  | "no_assets_no_richness"
  | "analyzer_failed"
  | "";

export type SituationCardShape = TLBaseShape<
  "situation-card",
  {
    w: number;
    h: number;
    spaceId: string;
    /** 0..1 — drives the uncertainty pill color (green low, amber
     *  mid, red high). */
    uncertaintyScore: number;
    inputsCount: number;
    processStepsCount: number;
    outputsCurrentCount: number;
    outputsTargetCount: number;
    knownsCount: number;
    unknownsCount: number;
    assetCount: number;
    /** Empty string when the analyzer ran successfully; one of the
     *  skipped_reason enum values from src/types/situation.ts when
     *  the analyzer skipped (vague intake, no assets, or LLM fail).
     *  Plain string for tldraw prop-validator simplicity. */
    skippedReason: string;
    accent: string;
    /** Bumped on each upsert so React re-renders even when prop
     *  values look identical. */
    version: number;
  }
>;

// ── Synthesis intersection card (cross-axis final ranking) ──
//
// Painted once per run after axes have finished + before proposals
// fork off. Renders a ranked table of entities that appear across
// 2+ probability-space axes — the "intersection" geometry the
// inspiration redesign called for. Top entities by cross-axis
// convergence are the canvas's final-output anchor; proposals fork
// off this card instead of off individual entity ghosts.
//
// Data is derived purely from the painter's `spaceShellState` map
// (axis → entities[] with weights) — no extra DB roundtrip. Each
// row carries: entity name, composite score, axis-coverage badges
// listing which axes this entity sits in, and a relative-score bar.
//
// Run-scoped — cleared on completePipelineRun alongside the rest
// of the painter's emission overlay.

export type SynthesisIntersectionCardShape = TLBaseShape<
  "synthesis-intersection-card",
  {
    w: number;
    h: number;
    spaceId: string;
    /** Title rendered in the header. Defaults to "Synthesis · final
     *  ranking" but can be overridden when a target outcome is
     *  known (e.g., "Toward: Audience engagement"). */
    title: string;
    /** Total axes considered for the ranking (drives the
     *  axis-coverage badge denominator: "3/4 axes"). */
    totalAxes: number;
    /** JSON-encoded array of ranked rows. Stored flat so tldraw's
     *  prop validation stays simple. Shape:
     *    Array<{
     *      entityId: string;
     *      name: string;
     *      compositeScore: number;     // 0..1
     *      convergenceCount: number;   // # axes this entity is in
     *      axes: Array<{ axis: string; accent: string; weight: number }>;
     *    }>
     *  Capped at 8 rows on the wire — the card renders the top 5–6
     *  comfortably; overflow gets a "+N more" footer. */
    rowsJson: string;
    /** Apps materialized off this synthesis (downstream proposals).
     *  Bumped each time a proposal_ready fires while this card is
     *  the run's anchor. Renders as a "Apps proposed: N" footer. */
    appsProposedCount: number;
    /** When true, the card is in "computing" state — axes still
     *  emitting; we render a skeleton instead of empty rows. */
    isComputing: boolean;
    accent: string;
    /** Bumped on each upsert so React re-renders even when prop
     *  values look identical (rare; mostly defensive). */
    version: number;
  }
>;

// ── Experiment design card (5-column hypothesis layout) ──
//
// Painted alongside a `proposal-snapshot` of kind="experiment" — sits
// below the chain ribbon and lays the proposal out in the language of
// experimental design: hypothesis (editable) on top, then five labeled
// columns: Independent Variables / Dependent Variables / Control /
// Process / Results.
//
// Closes the gap surfaced by the inventory pass: the codebase had IV
// (decomposition rings), DV (downstream-reality heatmap), process
// (chain ribbon), and results (distribution band) scattered across
// separate shapes/widgets but no cohesive surface that names what's
// being tested before the run produces it. This card IS that surface.
//
// Run-scoped ghost — cleaned up when the pipeline run completes,
// alongside the snapshot card and chain ribbon. Persisted artifacts
// (apps row, simulation_distribution on apps.state) are the
// post-run truth.
//
// Hypothesis text lives on the shape itself (editable via tldraw's
// standard canEdit + setEditingShape flow); v1 doesn't write it back
// to the DB. A future pass can persist it on a new column on
// `apps.state.hypothesis` once the framing settles.

export type ExperimentDesignCardShape = TLBaseShape<
  "experiment-design-card",
  {
    w: number;
    h: number;
    /** ProposalReadyEvent.proposalId — used by the painter to match
     *  cleanup + dedupe re-emits. For an experiment-kind proposal
     *  this is the apps.id. */
    proposalId: string;
    /** Optional apps.id when this card is for a per-app experiment;
     *  same value as proposalId in practice. Kept separate to make
     *  click-through to the app dashboard explicit. */
    appId: string | null;
    title: string;
    /** User-editable hypothesis statement. Empty by default; we render
     *  a structured placeholder ("If we change [IV] then [DV]…") to
     *  hint at the experimental-design framing without locking the
     *  user into a template. */
    hypothesis: string;
    /** Independent-variable column: the upstream lever entity name(s).
     *  Typically `chain.nodeNames[0..-1]` minus the target. Empty when
     *  the chain didn't resolve. */
    ivNames: string[];
    /** Dependent-variable column: the target outcome entity name. */
    dvName: string | null;
    /** Control column: 1-line baseline description. Empty string when
     *  no DoWhy refute landed and no scenario baseline is known. */
    controlLabel: string;
    /** Process column: causal-path breadcrumb (same nodeNames as the
     *  ribbon, capped). */
    processChain: string[];
    /** DoWhy `identify.kind` — drives a chip on the process column.
     *  Empty string when DoWhy didn't run for this proposal. */
    identifyKind: string;
    /** DoWhy `refute.verdict` — pass / fail / skip. Empty when no
     *  refutation was attempted. */
    refuteVerdict: string;
    /** Results column: Monte Carlo distribution. Nulls when sim didn't
     *  resolve (legacy events, missing target entity). */
    p10: number | null;
    p50: number | null;
    p90: number | null;
    /** "mc_simulation" / "llm_estimate" / "" — drives the provenance
     *  pill in the Results column. */
    distributionProvenance: string;
    distributionSampleCount: number | null;
    accent: string;
  }
>;

// ── Probability space shell (intake axis lens) ──
//
// One card per probability-space axis that the frame extractor
// opens. Previously a chrome overlay (`ProbabilitySpaceRail`) which
// couldn't be an arrow endpoint + dominated the viewport. As a real
// tldraw shape it pans/zooms with the canvas and tethers up to the
// origin-prompt so the user sees "my thought → these lenses".
//
// Entities + edges are stored as JSON strings (tldraw's flat-props
// schema doesn't support nested shapes). Runtime view parses them
// back out for rendering.
export type ProbabilitySpaceShellShape = TLBaseShape<
  "probability-space-shell",
  {
    w: number;
    h: number;
    spaceKey: string;
    /** Axis key (actors / timeline / cultural / assumptions / risk / …). */
    axis: string;
    label: string;
    tagline: string;
    accent: string;
    rationale: string;
    /** Render order — lower = painted first / sits to the left. */
    orderIndex: number;
    /** JSON-encoded Array<{ entityId, name, weight }>. Max 12 entries rendered. */
    entitiesJson: string;
    /** JSON-encoded Array<{ sourceEntityId, targetEntityId, mechanism, polarity, dynamics, confidence }>. */
    edgesJson: string;
    /** True once space_merge_begin has fired — styling goes quiet. */
    merging: boolean;
    /** Peer-review score from axis_scored. JSON of
     *  `{ weighted: number, breakdown: {…}, notes: string }` or empty
     *  string when not scored. */
    scoreJson: string;
    /** Populated when the axis generator failed. JSON of
     *  `{ reason: "thin_output" | "hard_fail" | "timeout",
     *  errorMessage: string | null }` or empty string when still
     *  generating / succeeded. */
    failureJson: string;
    /** Monotonic pulse so React re-renders even when counts don't
     *  visually change (new entity with same name, etc.). */
    pulse: number;
  }
>;

// ── Origin prompt card (lineage root) ──
//
// The user's intake text painted as a real tldraw shape at the top
// of the canvas during a run. Replaces the prior chrome-layer
// CanvasOriginCard so tldraw arrows can terminate on the prompt —
// every downstream painter shape (kg-formation, taxonomy, root-cause,
// variants, …) is tethered up to this card, giving the canvas a
// readable "thought → landscape → branches" spine.
//
// Single per-run card; upserted on prompt-text changes. Painter
// deletes it on run cleanup alongside kg-formation.
export type OriginPromptShape = TLBaseShape<
  "origin-prompt",
  {
    w: number;
    h: number;
    /** The user's original intake text (or whatever drove this run). */
    promptText: string;
    /** Whether the pipeline run is still live — drives pulse/accent. */
    runActive: boolean;
    accent: string;
  }
>;

export type CanvasCustomShape =
  | KGNodeShape
  | KGFormationShape
  | OriginPromptShape
  | ProbabilitySpaceShellShape
  | RootCauseTreeShape
  | ProposalChainRibbonShape
  | TaxonomyCardShape
  | VariantCardShape
  | StickyNoteShape
  | SynthesisCardShape
  | ClusterFrameShape
  | StrategyShape
  | ThreadNoteShape
  | ReactionCardShape
  | AppCardShape
  | BridgeLinkShape
  | CycleLoopShape
  | ClaimChipShape
  | AxiomStoneShape
  | ConvergentFanShape
  | SignalFlagShape
  | TwinSnapshotShape
  | ObjectiveTreeShape
  | SourceCardShape
  | FileCardShape
  | ThreadSnapshotShape
  | ProposalSnapshotShape
  | DownstreamRealityShape
  | IVDecompositionShape
  | VariantCarouselShape
  | StageNodeShape
  | ExperimentDesignCardShape
  | SynthesisIntersectionCardShape
  | AssetCardShape
  | SituationCardShape;
