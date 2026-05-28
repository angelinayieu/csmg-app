// ── useLayoutAlgorithm — the swappable layout registry ────────────
//
// Phase 12.A (N2 + KG seam #3). The map's layout engine lives behind a
// NAMED registry keyed by LayoutAlgorithm, NOT a hardcoded if/else, so a
// future "semantic" (pgvector cosine) layout drops in as one entry
// without touching the renderer.
//
//   • "layered" — canvas altitude. Nodes banded by their primary layer
//                 ordinal (outcome at top, substrate at bottom); bands
//                 sized to fit their members. Deterministic — the layer
//                 stack demands stable Y, NOT force jitter (anti-pattern).
//   • "lr"      — room altitude. Dagre left-to-right (pain→feature→
//                 outcome flow). Reuses the project's dagre dependency.
//   • "force"   — fallback for spaces without a layer stack. Dagre TB.

import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import { primaryOrdinalOf } from "../lib/graph-build";
import {
  NODE_W,
  NODE_H,
  BAND_MIN_H,
  NODE_COL_GAP,
  BAND_LABEL_W,
} from "../lib/visual-grammar";
import type {
  CausalMapNode,
  CausalMapEdge,
  LayerBandSpec,
  LayoutAlgorithm,
} from "../lib/types";

export interface LayoutResult {
  nodes: CausalMapNode[];
  bands: LayerBandSpec[];
  width: number;
  height: number;
}

const BAND_PAD = 22;
const ROW_GAP = 16;
const MAX_PER_ROW = 5;

// ── Layered (canvas altitude) ────────────────────────────────────────────

function layeredLayout(
  nodes: CausalMapNode[],
  bands: LayerBandSpec[],
): LayoutResult {
  if (bands.length === 0) {
    // No stack → caller should have picked "force"; degrade to a grid.
    return gridFallback(nodes);
  }

  // Group node indices by primary ordinal.
  const byOrdinal = new Map<number, CausalMapNode[]>();
  for (const n of nodes) {
    const ord = primaryOrdinalOf(n.data.layerOrdinals);
    const arr = byOrdinal.get(ord) ?? [];
    arr.push(n);
    byOrdinal.set(ord, arr);
  }

  // Band stacking order: highest ordinal (outcome) at TOP (smallest Y),
  // ordinal 1 (substrate) below it, synthetic ordinal 0 (Unplaced) last.
  const ordered = [...bands].sort((a, b) => {
    const ka = a.ordinal === 0 ? -Infinity : a.ordinal;
    const kb = b.ordinal === 0 ? -Infinity : b.ordinal;
    return kb - ka;
  });

  const positioned: CausalMapNode[] = [];
  const finalizedBands: LayerBandSpec[] = [];
  let cursorY = 0;
  let maxWidth = 0;

  for (const band of ordered) {
    const members = byOrdinal.get(band.ordinal) ?? [];
    const perRow = Math.min(Math.max(members.length, 1), MAX_PER_ROW);
    const rows = Math.max(1, Math.ceil(members.length / perRow));
    const contentH = rows * NODE_H + (rows - 1) * ROW_GAP;
    const bandH = Math.max(BAND_MIN_H, contentH + BAND_PAD * 2);

    const startX = BAND_LABEL_W + 24;
    members.forEach((node, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      // Center each row horizontally within the band's used columns.
      const rowCount = Math.min(perRow, members.length - row * perRow);
      const rowWidth = rowCount * NODE_W + (rowCount - 1) * NODE_COL_GAP;
      const rowStart = startX;
      const x = rowStart + col * (NODE_W + NODE_COL_GAP);
      const y =
        cursorY + (bandH - contentH) / 2 + row * (NODE_H + ROW_GAP);
      positioned.push({ ...node, position: { x, y } });
      maxWidth = Math.max(maxWidth, rowStart + rowWidth);
    });

    finalizedBands.push({ ...band, y: cursorY, height: bandH });
    cursorY += bandH;
  }

  return {
    nodes: positioned,
    bands: finalizedBands,
    width: Math.max(maxWidth + 48, 960),
    height: cursorY,
  };
}

// ── Dagre layouts (room / fallback) ──────────────────────────────────────

function dagreLayout(
  nodes: CausalMapNode[],
  edges: CausalMapEdge[],
  rankdir: "LR" | "TB",
): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir,
    ranksep: rankdir === "LR" ? 110 : 90,
    nodesep: 48,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  const positioned = nodes.map((n) => {
    const p = g.node(n.id);
    // Dagre returns centers; React Flow wants top-left.
    return p
      ? { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } }
      : n;
  });

  const info = g.graph();
  return {
    nodes: positioned,
    bands: [],
    width: (info.width ?? 960) + 80,
    height: (info.height ?? 600) + 80,
  };
}

// ── Grid fallback (auto-layout failure / empty stack) ────────────────────

function gridFallback(nodes: CausalMapNode[]): LayoutResult {
  const perRow = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const positioned = nodes.map((n, i) => ({
    ...n,
    position: {
      x: (i % perRow) * (NODE_W + NODE_COL_GAP),
      y: Math.floor(i / perRow) * (NODE_H + 40),
    },
  }));
  const rows = Math.ceil(nodes.length / perRow);
  return {
    nodes: positioned,
    bands: [],
    width: perRow * (NODE_W + NODE_COL_GAP) + 48,
    height: rows * (NODE_H + 40) + 48,
  };
}

// ── Registry + hook ──────────────────────────────────────────────────────

type LayoutFn = (
  nodes: CausalMapNode[],
  edges: CausalMapEdge[],
  bands: LayerBandSpec[],
) => LayoutResult;

const LAYOUT_REGISTRY: Record<LayoutAlgorithm, LayoutFn> = {
  layered: (nodes, _edges, bands) => layeredLayout(nodes, bands),
  lr: (nodes, edges) => dagreLayout(nodes, edges, "LR"),
  force: (nodes, edges) => dagreLayout(nodes, edges, "TB"),
};

/**
 * Compute positioned nodes + finalized bands for the given algorithm.
 * Memoized on the node/edge identities so panning doesn't recompute.
 */
export function useLayoutAlgorithm(
  algorithm: LayoutAlgorithm,
  nodes: CausalMapNode[],
  edges: CausalMapEdge[],
  bands: LayerBandSpec[],
): LayoutResult {
  return useMemo(() => {
    try {
      const fn = LAYOUT_REGISTRY[algorithm] ?? LAYOUT_REGISTRY.force;
      return fn(nodes, edges, bands);
    } catch (err) {
      // Auto-layout failed → grid fallback (edge case in the spec).
      console.error("[causal-map] layout failed, using grid fallback", err);
      return gridFallback(nodes);
    }
  }, [algorithm, nodes, edges, bands]);
}
