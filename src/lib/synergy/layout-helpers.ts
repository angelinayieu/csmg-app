// ── Synergy whiteboard layout helpers ──
//
// Pure functions used by the scoped-action spawners (Decompose,
// Variations, Questions, Research, Describe) to keep the board
// readable as it grows:
//
//   collectDescendantIds   — gather every node downstream of one or
//                            more roots (used by "replace existing
//                            decomposition" and "tidy this subtree")
//   computeSubtreeBbox     — bounding box of a set of nodes; accounts
//                            for the approximate card render size so
//                            collisions are pixel-aware
//   findCollisionShift     — given a candidate subtree bbox and the
//                            other nodes on the board, return the
//                            (dx, dy) offset that pushes the subtree
//                            clear of any overlap
//   structuredGridLayout   — generates positions for a Decompose
//                            result: categories in a horizontal row
//                            below the target, items stacked
//                            vertically under each category
//   subtreeRadialLayout    — radial-tree layout scoped to a single
//                            subtree, centered on the target node's
//                            current position (the basis for the
//                            "Tidy this subtree" action)
//   computeFitToContent    — derive { pan, zoom } so a given bbox
//                            fits the viewport with padding

import { radialTreeLayout } from "./radial-layout";
import type { ClientNode } from "./types";

// Approximate render size of a card. Used for collision math.
// Actual cards can be 180-320 wide and 60-220 tall — these averages
// keep the math simple without significantly under- or over-shooting.
export const CARD_HALF_W = 160;
export const CARD_HALF_H = 60;

// ── collectDescendantIds ──
//
// Walks the parent → child tree downward, collecting every id
// reachable from any of the given root ids (not including the roots
// themselves unless `includeRoots` is true). Safe against cycles via
// a visited set.
export function collectDescendantIds(
  rootIds: Iterable<string>,
  nodes: ClientNode[],
  options: { includeRoots?: boolean } = {},
): Set<string> {
  // Build a parent → children adjacency map once.
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parent) {
      const list = childrenOf.get(n.parent) ?? [];
      list.push(n.id);
      childrenOf.set(n.parent, list);
    }
  }
  const collected = new Set<string>();
  const stack: string[] = [];
  for (const r of rootIds) {
    if (options.includeRoots) collected.add(r);
    stack.push(r);
  }
  while (stack.length > 0) {
    const id = stack.pop()!;
    const kids = childrenOf.get(id);
    if (!kids) continue;
    for (const k of kids) {
      if (collected.has(k)) continue;
      collected.add(k);
      stack.push(k);
    }
  }
  return collected;
}

export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ── computeSubtreeBbox ──
//
// Bounding box of a set of nodes treated as cards. Returns null when
// the set is empty.
export function computeSubtreeBbox(nodes: ClientNode[]): Bbox | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - CARD_HALF_W);
    maxX = Math.max(maxX, n.x + CARD_HALF_W);
    minY = Math.min(minY, n.y - CARD_HALF_H);
    maxY = Math.max(maxY, n.y + CARD_HALF_H);
  }
  return { minX, minY, maxX, maxY };
}

function bboxesOverlap(a: Bbox, b: Bbox, margin = 0): boolean {
  return (
    a.minX < b.maxX + margin &&
    a.maxX > b.minX - margin &&
    a.minY < b.maxY + margin &&
    a.maxY > b.minY - margin
  );
}

// ── findCollisionShift ──
//
// Returns the (dx, dy) to apply to every node in `subtree` so the
// resulting bbox stops overlapping ANY node in `others`. Strategy:
// 1. Try shifting right by escalating amounts (200px increments) up
//    to 5 attempts; if it clears all overlaps, return.
// 2. If right is hopeless (right side of board is dense), try
//    shifting down.
// 3. Cap total displacement at 2000px so we never silently teleport
//    a subtree off the edge of the world — better to leave a small
//    overlap than to lose the user.
//
// The margin parameter is the visual padding to leave between
// subtrees so they don't share an edge.
export function findCollisionShift(
  subtree: ClientNode[],
  others: ClientNode[],
  margin = 60,
): { dx: number; dy: number } {
  const subBbox = computeSubtreeBbox(subtree);
  if (!subBbox) return { dx: 0, dy: 0 };
  // Compute every other node's bbox once.
  const otherBboxes = others.map((n) => ({
    minX: n.x - CARD_HALF_W,
    maxX: n.x + CARD_HALF_W,
    minY: n.y - CARD_HALF_H,
    maxY: n.y + CARD_HALF_H,
  }));
  const hasCollision = (test: Bbox) =>
    otherBboxes.some((b) => bboxesOverlap(test, b, margin));

  if (!hasCollision(subBbox)) return { dx: 0, dy: 0 };

  // Try shifting right.
  for (let step = 1; step <= 10; step++) {
    const dx = step * 240;
    const shifted: Bbox = {
      minX: subBbox.minX + dx,
      maxX: subBbox.maxX + dx,
      minY: subBbox.minY,
      maxY: subBbox.maxY,
    };
    if (!hasCollision(shifted)) return { dx, dy: 0 };
  }
  // Try shifting down.
  for (let step = 1; step <= 10; step++) {
    const dy = step * 180;
    const shifted: Bbox = {
      minX: subBbox.minX,
      maxX: subBbox.maxX,
      minY: subBbox.minY + dy,
      maxY: subBbox.maxY + dy,
    };
    if (!hasCollision(shifted)) return { dx: 0, dy };
  }
  // Best effort — cap the shift so we don't yeet the user offscreen.
  return { dx: 1600, dy: 0 };
}

// ── structuredGridLayout ──
//
// Produces a clean, predictable layout for the four Decompose
// categories: row of category folders directly below the target,
// items stacked vertically under each category. Replaces the prior
// radial-fan placement which was collision-blind and stacked
// folder regions on top of each other.
//
//                [Target]
//                 /  |  |  \
//              ┌──┐ ┌──┐┌──┐┌──┐
//              │U │ │D │ FP │V │
//              └──┘ └──┘└──┘└──┘
//               •    •  •    •
//               •    •  •    •
//
// Returns positions for the four category folder nodes plus a
// per-category list of item positions.
export interface StructuredCategoryPlacement {
  catId: string;
  catX: number;
  catY: number;
  itemPositions: Array<{ x: number; y: number }>;
}

export function structuredGridLayout(
  target: ClientNode,
  categories: Array<{ catId: string; itemCount: number }>,
  opts: {
    columnGap?: number; // horizontal between category centers
    rowGap?: number; // vertical between item centers
    topGap?: number; // vertical between target and category row
  } = {},
): StructuredCategoryPlacement[] {
  const columnGap = opts.columnGap ?? 380;
  const rowGap = opts.rowGap ?? 130;
  const topGap = opts.topGap ?? 240;

  const nonEmpty = categories.filter((c) => c.itemCount > 0);
  if (nonEmpty.length === 0) return [];

  // Center the row horizontally on the target.
  const totalWidth = (nonEmpty.length - 1) * columnGap;
  const startX = target.x - totalWidth / 2;
  const catY = target.y + topGap;

  return nonEmpty.map((c, i) => {
    const catX = startX + i * columnGap;
    // Items start one rowGap below the category center, then stack.
    const itemPositions = Array.from({ length: c.itemCount }, (_, k) => ({
      x: catX,
      y: catY + rowGap + k * rowGap,
    }));
    return { catId: c.catId, catX, catY, itemPositions };
  });
}

// ── subtreeRadialLayout ──
//
// Re-applies the radialTreeLayout algorithm to a subtree only,
// centered at the target's current position. Other nodes are left
// alone. Returns a Map of nodeId → {x, y} for the subtree.
export function subtreeRadialLayout(
  targetId: string,
  nodes: ClientNode[],
): Map<string, { x: number; y: number }> {
  const target = nodes.find((n) => n.id === targetId);
  if (!target) return new Map();

  // Collect target + all descendants.
  const descIds = collectDescendantIds([targetId], nodes, { includeRoots: true });
  const subtree = nodes.filter((n) => descIds.has(n.id));
  if (subtree.length <= 1) return new Map(); // nothing to lay out

  // radialTreeLayout treats a "core" kind node as the seed, falling
  // back to nodes[0]. To anchor it on the target, temporarily
  // reframe the subtree with the target masquerading as the root.
  // Easiest: pass a clone where target.kind = "core" and parent = null.
  const cloned: ClientNode[] = subtree.map((n) =>
    n.id === targetId ? { ...n, kind: "core" as const, parent: null } : n,
  );
  const positions = radialTreeLayout(cloned, target.x, target.y);
  return positions;
}

// ── computeFitToContent ──
//
// Given a bbox + viewport metrics + current zoom range, return the
// pan + zoom that fits the bbox with padding. The viewport metrics
// account for the synergy whiteboard's left toolbar (64px) and
// right AI rail (320px) so content centers in the actual canvas
// area, not behind the rails.
export interface FitMetrics {
  viewportWidth: number;
  viewportHeight: number;
  leftRail: number;
  rightRail: number;
  topInset: number;
  bottomInset: number;
}

export function computeFitToContent(
  bbox: Bbox,
  metrics: FitMetrics,
  options: { padding?: number; minZoom?: number; maxZoom?: number } = {},
): { pan: { x: number; y: number }; zoom: number } {
  const padding = options.padding ?? 100;
  const minZoom = options.minZoom ?? 0.35;
  const maxZoom = options.maxZoom ?? 1.1;

  const availableW = metrics.viewportWidth - metrics.leftRail - metrics.rightRail;
  const availableH = metrics.viewportHeight - metrics.topInset - metrics.bottomInset;
  const contentW = bbox.maxX - bbox.minX + padding * 2;
  const contentH = bbox.maxY - bbox.minY + padding * 2;

  const zoomX = availableW / contentW;
  const zoomY = availableH / contentH;
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(zoomX, zoomY)));

  // Center the bbox in the available area.
  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;
  // pan such that `world(centerX) → screen(leftRail + availableW/2)`.
  const pan = {
    x: metrics.leftRail + availableW / 2 - centerX * zoom,
    y: metrics.topInset + availableH / 2 - centerY * zoom,
  };
  return { pan, zoom };
}
