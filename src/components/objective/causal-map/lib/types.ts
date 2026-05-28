// ── Causal System Map — data model ────────────────────────────────
//
// Phase 12.A. The shared vocabulary for the multi-altitude causal map.
// These types are the contract between the server-side graph builders,
// the layout hooks, and the React Flow renderer.
//
// Design note — the THREE KG extension seams (§17.17). The MVP renders
// the within-space entity/edge graph, but we bake in three cheap seams
// now so the KG-native layers (canonical overlay, cross-space bridges,
// semantic layout) drop in later WITHOUT a data-model refactor:
//
//   1. `canonicalConceptId` on node data — populated even though the
//      MVP doesn't render the canonical overlay. When KG-1 ships, the
//      data already flows.
//   2. `source` discriminator on edge data ("local" | "cross_space" |
//      "semantic") — always "local" in MVP; the renderer branches on it
//      so cross-space + semantic edges style differently later.
//   3. The layout registry (see useLayoutAlgorithm) returns from a NAMED
//      map keyed by `LayoutAlgorithm`, not a hardcoded if/else, so adding
//      "semantic" later is one entry.

import type { Node, Edge } from "@xyflow/react";

// ── Altitude (C4-inspired zoom levels) ───────────────────────────────

/** Which zoom level the map is rendering. URL-driven (N3), not a store. */
export type Altitude = "canvas" | "room" | "item" | "variation";

// ── Node model ───────────────────────────────────────────────────────

/** What kind of entity a node represents. Canvas altitude is all
 *  `sub_objective`; room altitude uses pain/feature/outcome/mediator. */
export type CausalMapNodeKind =
  | "sub_objective"
  | "pain"
  | "feature"
  | "outcome"
  | "mediator"
  | "variation";

/** Aggregate health bucket for a node, from chain strength + coverage +
 *  approved-play volume. Drives the traffic-light border (Axis 3). */
export type HealthBand = "strong" | "moderate" | "weak" | "unknown";

/** Evaluation tier badge — mirrors the existing MethodBadge tiers so the
 *  map and the cards agree on the symbol. */
export type MethodTier =
  | "heuristic"
  | "rubric"
  | "evidence"
  | "ensemble"
  | "simulated"
  | "tested"
  | null;

/** The data payload carried on a canvas/room node. Kept React-Flow
 *  agnostic (a plain object) so graph-build.ts stays a pure transform;
 *  the renderer bridges it onto a React Flow `Node` via `toFlowNodes`. */
export interface CausalMapNodeData extends Record<string, unknown> {
  kind: CausalMapNodeKind;
  /** Display title (sub-objective title / pain phrase / etc.). */
  title: string;
  /** Optional one-line subtitle (e.g. "Counters: …" or a definition). */
  subtitle?: string | null;

  // ── Layer positioning (canvas altitude) ──
  /** 1-based ObjectiveStack ordinals this node touches. Empty when the
   *  node predates layer tagging. Drives Y-band placement. */
  layerOrdinals: number[];
  /** Pre-computed chip, e.g. "L3 · Direct" / "L2→L3 · Bridge". */
  layerPositionLabel?: string | null;

  // ── Health signal (Axis 3) ──
  /** 0..1 aggregate health. Undefined → band "unknown". */
  health?: number;
  healthBand: HealthBand;
  /** Count of approved chains / plays — surfaces as a pip. */
  approvedCount: number;
  /** Highest-tier evaluation method observed on this node's work. */
  methodTier: MethodTier;
  /** 0..1 score paired with the method tier (for the "📋 0.71" chip). */
  methodScore?: number | null;

  // ── Navigation ──
  /** Route target when the node is clicked (drill into the room). */
  href?: string | null;

  // ── KG seam #1 (canonical overlay, KG-1) ──
  /** Canonical concept this node resolves to, when known. NOT rendered
   *  in MVP — populated so the canonical overlay can light up later. */
  canonicalConceptId?: string | null;

  // ── Transient view flags (set by the renderer, not graph data) ──
  /** Loop ring tint when this node participates in the highlighted loop. */
  loopRing?: "reinforcing" | "balancing" | null;
  /** Dimmed because another loop / node is focused. */
  faded?: boolean;
  /** Whether the health overlay is on (border traffic-light visible). */
  showHealth?: boolean;
}

// ── Edge model ─────────────────────────────────────────────────────────

/** Sign of a causal influence (CLD polarity). Neutral = unknown sign,
 *  treated as "+" for loop classification but rendered gray. */
export type EdgePolarity = "positive" | "negative" | "neutral";

/** What produced this edge. KG seam #2 — always "local" in MVP. */
export type EdgeSource = "local" | "cross_space" | "semantic";

/** What relationship the edge encodes. */
export type CausalMapEdgeKind =
  | "cross_room" // two sub-objectives share a mechanism / root cause / lens
  | "layer_influence" // ObjectiveStack cross-layer arrow
  | "causal_chain"; // pain → feature → outcome within a room

export interface CausalMapEdgeData extends Record<string, unknown> {
  kind: CausalMapEdgeKind;
  polarity: EdgePolarity;
  /** 0..1 — drives stroke width (1–4px). */
  strength: number;
  /** Optional edge label (verb / shared-concept phrase). */
  label?: string | null;
  /** Mediator pill text rendered on the edge midpoint, when present. */
  mediator?: string | null;
  /** Temporal-lag marker. */
  delayed?: boolean;
  /** KG seam #2 — provenance discriminator. */
  source: EdgeSource;
  /** When part of a detected loop, the loop id (drives ring styling). */
  loopId?: string | null;

  // ── Transient view flags (set by the renderer, not graph data) ──
  /** Part of the currently-highlighted loop → emphasized stroke. */
  loopActive?: boolean;
  /** Loop kind of the highlighted loop this edge belongs to. */
  loopKind?: "reinforcing" | "balancing" | null;
  /** Dimmed because another loop / node is focused. */
  faded?: boolean;
}

// ── React Flow specializations ──────────────────────────────────────────

export type CausalMapNode = Node<CausalMapNodeData>;
export type CausalMapEdge = Edge<CausalMapEdgeData>;

// ── Layer bands (canvas altitude background) ─────────────────────────────

/** A horizontal band behind the nodes representing one ObjectiveStack
 *  layer. Y/height computed by the layout pass. */
export interface LayerBandSpec {
  ordinal: number;
  /** Layer id, e.g. "L3". */
  id: string;
  /** Domain-specific layer name, e.g. "Cognitive States". */
  name: string;
  archetype: string;
  /** Top edge of the band, in flow coords. */
  y: number;
  height: number;
  /** True when NO node sits in this layer — drives the "⚠ uncovered"
   *  pulsing affordance. */
  uncovered: boolean;
}

// ── Loop detection output ────────────────────────────────────────────────

/** A feedback loop detected via Tarjan's SCC + polarity classification. */
export interface DetectedLoop {
  id: string;
  /** Node ids participating in the loop (the SCC membership). */
  nodeIds: string[];
  /** Ordered node ids of one representative simple cycle (for narration). */
  cycle: string[];
  /** Edge ids traversed by the representative cycle. */
  edgeIds: string[];
  /** R = reinforcing (even # of negatives), B = balancing (odd). */
  kind: "reinforcing" | "balancing";
  /** Number of negative links in the representative cycle. */
  negativeCount: number;
  /** Human-readable label, e.g. "Attention Reg ⇌ Goal Track". */
  label: string;
}

// ── Layout ───────────────────────────────────────────────────────────────

/** Registry key for the layout engine (KG seam #3). "layered" = banded
 *  by layer ordinal (canvas default); "force" = dagre network fallback
 *  for spaces without a layer stack; "lr" = left-to-right (room CLD).
 *  Adding "semantic" (pgvector cosine) later = one registry entry. */
export type LayoutAlgorithm = "layered" | "force" | "lr";

/** The complete buildable canvas graph — what graph-build.ts emits and
 *  the altitude component consumes. */
export interface CanvasGraph {
  nodes: CausalMapNode[];
  edges: CausalMapEdge[];
  bands: LayerBandSpec[];
  /** True when an ObjectiveStack was present, so the layered layout is
   *  meaningful. False → caller should fall back to "force". */
  hasLayerStack: boolean;
}
