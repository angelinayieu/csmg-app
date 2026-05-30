"use client";

// ── syncCanvasUnfurl ──
//
// Lays out a `CanvasGraph` (from buildCanvasGraph — objective → layer
// bands → sub-objective nodes + cross-room edges) onto a tldraw board as
// real shapes, gated by the depth dial:
//
//   depth 0 (Seed)    → just the objective hero card
//   depth 1 (Anatomy) → + the layer bands
//   depth ≥2 (Bets)   → + sub-objective cards (in their layer) + edges
//
// Idempotent: every shape has a stable id + meta.unfurl, so re-running on
// a depth change diffs (creates the newly-revealed, deletes the hidden)
// rather than churning the whole board. Reuses the existing `room-card`
// shape for the objective + sub-objective nodes (so a sub-objective's
// Expand button opens its room) and `layer-band` for the backdrops.

import {
  type Editor,
  type TLShapeId,
  type TLShapePartial,
  type TLArrowShape,
  type TLDefaultColorStyle,
} from "tldraw";
import type {
  CanvasGraph,
  CausalMapNode,
  EdgePolarity,
} from "@/components/objective/causal-map/lib/types";
import type { RoomCardShape } from "@/components/objective/shapes/room-card-shape";
import type { LayerBandShape } from "@/components/objective/shapes/layer-band-shape";
import { bandAccentFor } from "@/components/objective/shapes/layer-band-shape";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// ── layout constants ──
const BOARD_W = 1320;
const CARD_W = 268;
const CARD_H = 184;
const OBJ_Y = 0;
const BAND_H = 248;
const BAND_GAP = 28;
const BANDS_TOP = CARD_H + 80;
const NODE_GAP = 34;

// ── stable ids ──
function sid(s: string): TLShapeId {
  return `shape:unfurl-${s.replace(/[^a-zA-Z0-9_-]/g, "_")}` as TLShapeId;
}
const OBJ_ID = sid("obj");
const bandId = (ord: number) => sid(`band-${ord}`);
const nodeId = (raw: string) => sid(`node-${raw}`);
const edgeId = (raw: string) => sid(`edge-${raw}`);

function isUnfurl(s: { meta?: Record<string, unknown> }): boolean {
  return !!s.meta?.unfurl;
}

/** Primary layer ordinal a node lands on (max of its ordinals), falling
 *  back to the lowest band when the node has no layer tags. */
function primaryOrdinal(n: CausalMapNode, fallback: number): number {
  const ords = n.data.layerOrdinals;
  return Array.isArray(ords) && ords.length > 0 ? Math.max(...ords) : fallback;
}

function polarityColor(p: EdgePolarity): TLDefaultColorStyle {
  return p === "positive" ? "green" : p === "negative" ? "red" : "grey";
}

/** Pick the facing edge-anchors for an arrow between two shapes so it flows
 *  along the dominant axis — top↔bottom for a vertical (up-the-stack)
 *  relationship, left↔right for a horizontal (pain→mechanism→outcome) one —
 *  instead of stabbing card centers. This is what makes the unfurl read as a
 *  sequential causal cascade rather than a hairball. */
function facingAnchors(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const fb = editor.getShapePageBounds(fromId);
  const tb = editor.getShapePageBounds(toId);
  if (!fb || !tb) {
    return { start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 } };
  }
  const dx = tb.x + tb.w / 2 - (fb.x + fb.w / 2);
  const dy = tb.y + tb.h / 2 - (fb.y + fb.h / 2);
  if (Math.abs(dy) >= Math.abs(dx)) {
    // Vertical relationship — dock at the top & bottom edges.
    return dy < 0
      ? { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } } // target above
      : { start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0 } }; // target below
  }
  // Horizontal relationship — dock at the left & right edges.
  return dx > 0
    ? { start: { x: 1, y: 0.5 }, end: { x: 0, y: 0.5 } } // target to the right
    : { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } }; // target to the left
}

/** Create a polarity-colored arrow bound between two existing unfurl
 *  shapes. Shared by the canvas + room phases. The endpoints must already
 *  exist on the board (bindings resolve against them). Docks at the facing
 *  edges (see facingAnchors) so edges flow in sequence, not center-to-center. */
export function createUnfurlArrow(
  editor: Editor,
  id: TLShapeId,
  fromId: TLShapeId,
  toId: TLShapeId,
  polarity: EdgePolarity,
): void {
  const { start, end } = facingAnchors(editor, fromId, toId);
  const arrow: TLShapePartial<TLArrowShape> = {
    id,
    type: "arrow",
    props: {
      color: polarityColor(polarity),
      size: "s",
      dash: "solid",
      arrowheadEnd: "arrow",
    },
    meta: { unfurl: true },
  };
  editor.createShapes([arrow]);
  editor.createBindings([
    {
      fromId: id,
      toId: fromId,
      type: "arrow",
      props: {
        terminal: "start",
        normalizedAnchor: start,
        isExact: false,
        isPrecise: true,
      },
      meta: {},
    },
    {
      fromId: id,
      toId: toId,
      type: "arrow",
      props: {
        terminal: "end",
        normalizedAnchor: end,
        isExact: false,
        isPrecise: true,
      },
      meta: {},
    },
  ]);
}

const SUB_COLORS = [
  appleVibe.stage.pain,
  appleVibe.stage.features,
  appleVibe.stage.outcomes,
];

export interface UnfurlOpts {
  objectiveTitle?: string;
}

/**
 * Reconcile the board's unfurl shapes to `graph` at the given `depth`.
 * Pure side-effect on the editor; safe to call on every depth change.
 */
export function syncCanvasUnfurl(
  editor: Editor,
  graph: CanvasGraph,
  depth: number,
  opts: UnfurlOpts = {},
): void {
  // Bands sorted highest-ordinal (outcome) at top → lowest (substrate) bottom.
  const bands = [...graph.bands].sort((a, b) => b.ordinal - a.ordinal);
  const bandIndex = new Map(bands.map((b, i) => [b.ordinal, i] as const));
  const lowestOrdinal = bands.length
    ? bands[bands.length - 1].ordinal
    : 1;
  const bandTopY = (ord: number) =>
    BANDS_TOP + (bandIndex.get(ord) ?? 0) * (BAND_H + BAND_GAP);

  // Group nodes by their primary layer.
  const byOrd = new Map<number, CausalMapNode[]>();
  for (const n of graph.nodes) {
    const o = primaryOrdinal(n, lowestOrdinal);
    const arr = byOrd.get(o) ?? [];
    arr.push(n);
    byOrd.set(o, arr);
  }

  // ── Crossing-minimization (barycenter sweeps). Order each band's nodes by
  //    the mean x of their graph neighbors so connected cards line up across
  //    layers and the arrows read as a sequence, not a hairball. A few passes
  //    converge for the small graphs here; bands are laid out centered.
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of graph.edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const provX = new Map<string, number>();
  const layoutBand = (ns: CausalMapNode[]) => {
    const totalW = ns.length * CARD_W + (ns.length - 1) * NODE_GAP;
    const startX = Math.max(24, (BOARD_W - totalW) / 2);
    ns.forEach((n, j) => provX.set(n.id, startX + j * (CARD_W + NODE_GAP)));
  };
  for (const ns of byOrd.values()) layoutBand(ns);
  for (let pass = 0; pass < 4; pass++) {
    for (const ns of byOrd.values()) {
      const bary = new Map<string, number>();
      for (const n of ns) {
        const xs = [...(adj.get(n.id) ?? [])]
          .map((m) => provX.get(m))
          .filter((v): v is number => v !== undefined);
        bary.set(
          n.id,
          xs.length
            ? xs.reduce((a, b) => a + b, 0) / xs.length
            : provX.get(n.id)!,
        );
      }
      ns.sort((a, b) => bary.get(a.id)! - bary.get(b.id)!);
      layoutBand(ns);
    }
  }

  const nodePos = new Map<string, { x: number; y: number }>();
  for (const [ord, ns] of byOrd) {
    const top = bandTopY(ord) + (BAND_H - CARD_H) / 2;
    for (const n of ns) {
      nodePos.set(n.id, {
        x: provX.get(n.id) ?? Math.max(24, (BOARD_W - CARD_W) / 2),
        y: top,
      });
    }
  }

  // ── desired shape ids at this depth ──
  const desired = new Set<TLShapeId>([OBJ_ID]);
  if (depth >= 1) for (const b of bands) desired.add(bandId(b.ordinal));
  if (depth >= 2) {
    for (const n of graph.nodes) desired.add(nodeId(n.id));
    for (const e of graph.edges) desired.add(edgeId(e.id));
  }

  // ── delete what's no longer wanted ──
  const existing = editor.getCurrentPageShapes().filter(isUnfurl);
  const toDelete = existing.filter((s) => !desired.has(s.id)).map((s) => s.id);
  if (toDelete.length) editor.deleteShapes(toDelete);

  const present = new Set(
    editor.getCurrentPageShapes().filter(isUnfurl).map((s) => s.id),
  );
  const has = (id: TLShapeId) => present.has(id) || !!editor.getShape(id);

  // ── objective hero (always) ──
  if (!has(OBJ_ID)) {
    const objShape: TLShapePartial<RoomCardShape> = {
      id: OBJ_ID,
      type: "room-card",
      x: (BOARD_W - CARD_W) / 2,
      y: OBJ_Y,
      props: {
        w: CARD_W,
        h: CARD_H,
        title: opts.objectiveTitle?.trim() || "Objective",
        subtitle: "The objective — scroll to unfurl its anatomy.",
        color: appleVibe.stage.objective,
        roomId: "__obj",
        chips: [
          `${graph.nodes.length} bet${graph.nodes.length === 1 ? "" : "s"}`,
          `${graph.bands.length} layers`,
        ],
      },
      meta: { unfurl: true, compact: true },
    };
    editor.createShape(objShape);
  }

  // ── layer bands (depth ≥ 1) ──
  if (depth >= 1) {
    for (const b of bands) {
      const id = bandId(b.ordinal);
      if (has(id)) continue;
      const accent = bandAccentFor(b.archetype);
      const bandShape: TLShapePartial<LayerBandShape> = {
        id,
        type: "layer-band",
        x: (BOARD_W - BOARD_W) / 2,
        y: bandTopY(b.ordinal),
        props: {
          w: BOARD_W,
          h: BAND_H,
          ordinal: b.ordinal,
          name: b.name,
          archetype: b.archetype,
          uncovered: !byOrd.has(b.ordinal),
          accent,
        },
        meta: { unfurl: true, compact: true },
      };
      editor.createShape(bandShape);
    }
  }

  // ── sub-objective nodes + edges (depth ≥ 2) ──
  if (depth >= 2) {
    for (const n of graph.nodes) {
      const id = nodeId(n.id);
      if (has(id)) continue;
      const pos = nodePos.get(n.id) ?? { x: 24, y: BANDS_TOP };
      const ord = primaryOrdinal(n, lowestOrdinal);
      const color = SUB_COLORS[(ord - 1 + SUB_COLORS.length) % SUB_COLORS.length];
      const chips: string[] = [];
      if (n.data.layerPositionLabel) chips.push(n.data.layerPositionLabel);
      if (n.data.healthBand && n.data.healthBand !== "unknown")
        chips.push(n.data.healthBand);
      if (n.data.approvedCount > 0)
        chips.push(
          `${n.data.approvedCount} play${n.data.approvedCount === 1 ? "" : "s"}`,
        );
      const nodeShape: TLShapePartial<RoomCardShape> = {
        id,
        type: "room-card",
        x: pos.x,
        y: pos.y,
        props: {
          w: CARD_W,
          h: CARD_H,
          title: n.data.title,
          subtitle: n.data.subtitle ?? "Sub-objective",
          color,
          roomId: n.id,
          chips,
        },
        meta: { unfurl: true, compact: true },
      };
      editor.createShape(nodeShape);
    }

    // Edges as arrows — created after the node shapes exist so bindings
    // resolve. Skip any whose endpoints aren't both on the board.
    for (const e of graph.edges) {
      const id = edgeId(e.id);
      if (has(id)) continue;
      const fromId = nodeId(e.source);
      const toId = nodeId(e.target);
      if (!editor.getShape(fromId) || !editor.getShape(toId)) continue;
      const polarity: EdgePolarity = e.data?.polarity ?? "neutral";
      createUnfurlArrow(editor, id, fromId, toId, polarity);
    }
  }
}

// ── Mock graph (preflight verification only) ──────────────────────
// A small, realistic CanvasGraph so the unfurl renderer can be verified
// on a board without real data/auth. Mirrors buildCanvasGraph's output.
export function mockCanvasGraph(): CanvasGraph {
  const node = (
    id: string,
    title: string,
    ordinals: number[],
    health: number,
    plays: number,
  ): CausalMapNode => ({
    id,
    type: "subObjective",
    position: { x: 0, y: 0 },
    data: {
      kind: "sub_objective",
      title,
      subtitle: null,
      layerOrdinals: ordinals,
      layerPositionLabel: `L${Math.max(...ordinals)}`,
      health,
      healthBand: health > 0.66 ? "strong" : health > 0.33 ? "moderate" : "weak",
      approvedCount: plays,
      methodTier: null,
      href: `/preview/${id}`,
    },
  });

  const nodes: CausalMapNode[] = [
    node("s1", "Reduce afternoon energy crashes", [2], 0.72, 3),
    node("s2", "Reward-streak engagement loop", [2], 0.41, 1),
    node("s3", "Goal-aligned feedback system", [3], 0.83, 4),
  ];

  const edge = (
    id: string,
    source: string,
    target: string,
    polarity: EdgePolarity,
    strength: number,
  ) => ({
    id,
    source,
    target,
    data: {
      kind: "cross_room" as const,
      polarity,
      strength,
      source: "local" as const,
    },
  });

  return {
    nodes,
    edges: [
      edge("e1", "s1", "s3", "positive", 0.7),
      edge("e2", "s2", "s3", "positive", 0.5),
      edge("e3", "s1", "s2", "neutral", 0.3),
    ],
    bands: [
      { ordinal: 3, id: "L3", name: "Outcomes", archetype: "outcome", y: 0, height: 0, uncovered: false },
      { ordinal: 2, id: "L2", name: "Mechanisms", archetype: "mechanism", y: 0, height: 0, uncovered: false },
      { ordinal: 1, id: "L1", name: "Foundations", archetype: "substrate", y: 0, height: 0, uncovered: true },
    ],
    hasLayerStack: true,
  };
}
