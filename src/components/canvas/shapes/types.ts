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
    /** Monotonic counter bumped each paint so React re-renders even when
     *  counts stayed same (e.g. edge added between existing hubs). */
    pulse: number;
    accent: string;
  }
>;

export type CanvasCustomShape =
  | KGNodeShape
  | KGFormationShape
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
  | ProposalSnapshotShape;
