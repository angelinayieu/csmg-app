"use client";

// ── Force-directed layout relaxation for the main canvas (T2.1) ──
//
// Problem (per docs/KG_DEPTH_CRITIQUE.md §canvas-physics audit, score
// 3/10): the main whiteboard places kg-node-shapes via a deterministic
// 5-layer grid in `use-sync-entities.ts`, then never moves them.
// Connected nodes can sit on opposite ends of the canvas; clusters
// don't form visually; the canvas reads as a "frozen constellation"
// rather than a living network.
//
// The codebase already ships a working Eades-style spring layout
// (`src/lib/graph/force-layout.ts`) — designed for 4-12 node mini-
// graphs inside probability-space-shells, but the algorithm is
// scale-agnostic. This hook adapts it for the main canvas:
//
//   1. Snapshot all kg-node-shapes + arrow shapes from the editor
//   2. Run computeForceLayout with main-canvas-tuned params
//      (springLength scaled to actual node size, more iterations
//      for 20+ entity graphs)
//   3. Animate from current → target positions via rAF over 700ms
//      with a cubic-bezier ease so the reflow is gentle, not jarring
//   4. Wrap in editor.run() per frame to keep tldraw transactions
//      atomic and the animation smooth at 60fps
//
// User-triggered, NOT auto-fired on run completion. Auto-reflowing a
// canvas the user has been interacting with would be jarring; the
// "Relax layout" button gives explicit control. Once the user has
// dragged any node manually, the relaxation honors their position
// only as a starting point — not preserved on subsequent runs (i.e.
// re-clicking Relax is idempotent on the current state).
//
// Companion: src/components/canvas/chrome/relax-layout-button.tsx

import { useCallback, useRef } from "react";
import { useEditor, type Editor, type TLArrowShape, type TLShapeId } from "tldraw";
import {
  computeForceLayout,
  type ForceLayoutEdge,
  type ForceLayoutNode,
  type PositionedNode,
} from "@/lib/graph/force-layout";

// ── Tuning knobs ─────────────────────────────────────────────────────

const ANIMATION_DURATION_MS = 700;
/** Iterations for the simulation. Bumped from the mini-graph default
 *  (30) since the main canvas often has 20-50 nodes. */
const RELAX_ITERATIONS = 80;
/** Target distance between connected nodes (px). Sized to match the
 *  visual gap of "key"-tier kg-node cards (260px wide, with breathing
 *  room — 360px gap puts edge-sources and edge-targets one card-width
 *  apart with a small clear gap). */
const SPRING_LENGTH_PX = 360;
/** Padding from the simulation viewport edges. Generous so nodes near
 *  the edge of the layout don't end up partially off-canvas. */
const RELAX_PADDING_PX = 80;
/** Tier-aware node weight — hubs (hero / key) get more weight so they
 *  repel neighbors more strongly. Mirrors the visual reality that
 *  hero-tier nodes are 300px wide vs support-tier 220px. */
const TIER_WEIGHT: Record<string, number> = {
  hero: 0.95,
  key: 0.7,
  support: 0.5,
  peripheral: 0.3,
};

/** Painter shapes treated as fixed obstacles by the post-layout
 *  collision pass. Force layout doesn't know they exist (it only
 *  simulates kg-nodes), so a converged kg-node can land on top of a
 *  room header or a kg-formation card — exactly the "overlapping cards
 *  under Relax layout" complaint. After computing target positions we
 *  push any kg-node whose rect overlaps one of these out of the way. */
const OBSTACLE_SHAPE_TYPES = new Set([
  "room",
  "kg-formation",
  "situation-card",
  "asset-card",
  "origin-prompt",
  "taxonomy-card",
  "root-cause-tree",
  "synthesis-intersection-card",
  "probability-space-shell",
  "proposal-snapshot",
  "experiment-design-card",
  "variant-card",
  "iv-decomposition",
  "variant-carousel",
  "app-result",
  "strategy-hero",
]);

/** Extra clearance kept between a kg-node and an obstacle after the
 *  push-out pass. Small but non-zero so the node doesn't kiss the
 *  obstacle's edge. */
const OBSTACLE_CLEARANCE_PX = 6;

// ── Hook public API ──────────────────────────────────────────────────

export interface RelaxLayoutResult {
  /** Number of nodes that were repositioned. */
  nodesMoved: number;
  /** Number of edges considered in the simulation. */
  edgesConsidered: number;
  /** Wall-clock duration of the simulation step (animation excluded). */
  computeMs: number;
}

export interface UseForceRelaxationApi {
  /** Trigger a layout relaxation pass. Resolves once the animation
   *  finishes (so callers can chain UI feedback). Idempotent —
   *  calling while an animation is in flight cancels the prior
   *  animation and starts fresh from the current frame. */
  relax: () => Promise<RelaxLayoutResult | null>;
  /** True while the rAF interpolation is running. */
  isRelaxing: () => boolean;
}

export function useForceRelaxation(): UseForceRelaxationApi {
  const editor = useEditor();
  // rAF handle for cancellation when relax() is called mid-animation.
  const animFrameRef = useRef<number | null>(null);
  // Mirror so relax() can answer "is an animation running?" without a
  // re-render cycle.
  const isRelaxingRef = useRef(false);

  const relax = useCallback(async (): Promise<RelaxLayoutResult | null> => {
    if (!editor) return null;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const snapshot = snapshotKgGraph(editor);
      if (snapshot.nodes.length < 2) {
        resolve(null);
        return;
      }
      const result = computeForceLayout(
        snapshot.nodes,
        snapshot.edges,
        {
          width: snapshot.bboxWidth,
          height: snapshot.bboxHeight,
          springLength: SPRING_LENGTH_PX,
          iterations: RELAX_ITERATIONS,
          padding: RELAX_PADDING_PX,
        },
      );
      // Map id → target position. Force-layout returns positions in a
      // local viewport with origin at (0, 0); offset by the bounding-
      // box origin so the relaxed graph sits where the original graph
      // was anchored (no global teleport on click).
      const targetById = new Map<string, { x: number; y: number }>();
      for (const p of result.nodes) {
        targetById.set(p.id, {
          x: p.x + snapshot.bboxOriginX,
          y: p.y + snapshot.bboxOriginY,
        });
      }

      // Post-layout push-out: the simulation is unaware of rooms,
      // kg-formation cards, situation cards, etc. — so a converged
      // kg-node can land directly on top of one. Sweep target
      // positions and displace any node whose rect overlaps an
      // obstacle to the nearest non-overlapping spot. Resolves the
      // "overlapping cards under Relax layout" complaint.
      for (const [id, target] of targetById) {
        const node = snapshot.nodeRectsById.get(id);
        if (!node) continue;
        const cleared = pushOutOfObstacles(
          target.x,
          target.y,
          node.w,
          node.h,
          snapshot.obstacles,
        );
        if (cleared.x !== target.x || cleared.y !== target.y) {
          targetById.set(id, cleared);
        }
      }

      const fromById = new Map(snapshot.currentPositions);
      const computeMs = performance.now() - t0;

      // ── Animate from → target ──
      isRelaxingRef.current = true;
      const animStart = performance.now();
      const tick = (now: number) => {
        const elapsed = now - animStart;
        const t = Math.min(1, elapsed / ANIMATION_DURATION_MS);
        const eased = easeOutCubic(t);
        const updates: Array<{ id: TLShapeId; type: "kg-node"; x: number; y: number }> = [];
        for (const [id, target] of targetById) {
          const from = fromById.get(id);
          if (!from) continue;
          updates.push({
            id: id as TLShapeId,
            type: "kg-node",
            x: from.x + (target.x - from.x) * eased,
            y: from.y + (target.y - from.y) * eased,
          });
        }
        editor.run(() => {
          editor.updateShapes(updates);
        });
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          animFrameRef.current = null;
          isRelaxingRef.current = false;
          resolve({
            nodesMoved: targetById.size,
            edgesConsidered: snapshot.edges.length,
            computeMs,
          });
        }
      };
      animFrameRef.current = requestAnimationFrame(tick);
    });
  }, [editor]);

  const isRelaxing = useCallback(() => isRelaxingRef.current, []);

  return { relax, isRelaxing };
}

// ── Internals ────────────────────────────────────────────────────────

interface ObstacleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface NodeRect {
  w: number;
  h: number;
}

interface KgGraphSnapshot {
  nodes: ForceLayoutNode[];
  edges: ForceLayoutEdge[];
  /** Map of shape id → current (x, y). Used as the animation start. */
  currentPositions: Map<string, { x: number; y: number }>;
  /** Map of shape id → rendered (w, h). Needed by the post-layout
   *  collision pass to compute true rect overlap with obstacles. */
  nodeRectsById: Map<string, NodeRect>;
  /** Painter shape rects (rooms, kg-formation, situation-card, etc.)
   *  treated as fixed obstacles in the post-layout push-out pass. */
  obstacles: ObstacleRect[];
  /** Bounding box of the current node positions. We size the simulation
   *  viewport to this so the relaxed graph occupies roughly the same
   *  on-canvas region (no global teleport). */
  bboxWidth: number;
  bboxHeight: number;
  bboxOriginX: number;
  bboxOriginY: number;
}

function snapshotKgGraph(editor: Editor): KgGraphSnapshot {
  // 1. Pull all kg-node shapes — these are the canonical KG entities.
  //    Skip ghost shapes that are still mid-paint (rare; would only
  //    happen if the user clicks Relax during an active run).
  const allShapes = editor.getCurrentPageShapes();
  const kgNodes = allShapes.filter(
    (s) =>
      s.type === "kg-node" &&
      typeof (s.props as { isGhost?: unknown }).isGhost === "boolean" &&
      (s.props as { isGhost: boolean }).isGhost === false,
  );

  // Map from kg-node shape ID → entity ID (the value used by edges).
  // Edges use shape IDs as endpoints (tldraw bind structure), so we
  // keep our id space aligned with shape IDs.
  const nodeIds = new Set<string>();
  const currentPositions = new Map<string, { x: number; y: number }>();
  const nodeRectsById = new Map<string, NodeRect>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of kgNodes) {
    nodeIds.add(s.id);
    const props = s.props as {
      w?: number;
      h?: number;
      tier?: string;
    };
    currentPositions.set(s.id, { x: s.x, y: s.y });
    const w = typeof props.w === "number" ? props.w : 220;
    const h = typeof props.h === "number" ? props.h : 112;
    nodeRectsById.set(s.id, { w, h });
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x + w > maxX) maxX = s.x + w;
    if (s.y + h > maxY) maxY = s.y + h;
  }

  // Painter obstacles — read every non-kg-node shape with a known
  // obstacle type and capture its current rect. Done in the same pass
  // over allShapes so we don't walk the page twice.
  const obstacles: ObstacleRect[] = [];
  for (const s of allShapes) {
    if (!OBSTACLE_SHAPE_TYPES.has(s.type)) continue;
    const props = s.props as { w?: number; h?: number };
    const w = typeof props.w === "number" ? props.w : 0;
    const h = typeof props.h === "number" ? props.h : 0;
    if (w <= 0 || h <= 0) continue;
    obstacles.push({ x: s.x, y: s.y, w, h });
  }

  // 2. Build force-layout node array with tier-derived weights so hub
  //    shapes (hero/key tier) repel neighbors more strongly.
  const nodes: ForceLayoutNode[] = kgNodes.map((s) => {
    const tier = (s.props as { tier?: string }).tier ?? "support";
    return {
      id: s.id,
      weight: TIER_WEIGHT[tier] ?? 0.5,
    };
  });

  // 3. Pull all arrow shapes whose source AND target both bind to
  //    kg-node shapes in our snapshot. Arrow bindings live on
  //    editor.getBindingsFromShape — but a simpler approach is to read
  //    the arrow's start/end point bind targets via their props.
  const edges: ForceLayoutEdge[] = [];
  for (const s of allShapes) {
    if (s.type !== "arrow") continue;
    const arrow = s as TLArrowShape;
    const startBindings = editor.getBindingsFromShape(arrow.id, "arrow");
    if (!Array.isArray(startBindings) || startBindings.length === 0) continue;
    let startId: string | null = null;
    let endId: string | null = null;
    for (const b of startBindings) {
      const binding = b as { props?: { terminal?: string }; toId?: string };
      const terminal = binding.props?.terminal;
      const toId = binding.toId;
      if (typeof toId !== "string") continue;
      if (terminal === "start") startId = toId;
      else if (terminal === "end") endId = toId;
    }
    if (!startId || !endId) continue;
    if (!nodeIds.has(startId) || !nodeIds.has(endId)) continue;
    if (startId === endId) continue;
    edges.push({ source: startId, target: endId });
  }

  // 4. Bounding box. When fewer than 2 nodes were found, fallback to a
  //    neutral square so divisions further down don't blow up.
  if (!Number.isFinite(minX) || nodes.length < 2) {
    return {
      nodes,
      edges,
      currentPositions,
      nodeRectsById,
      obstacles,
      bboxWidth: 1600,
      bboxHeight: 1000,
      bboxOriginX: 0,
      bboxOriginY: 0,
    };
  }
  const bboxWidth = Math.max(800, maxX - minX);
  const bboxHeight = Math.max(600, maxY - minY);
  return {
    nodes,
    edges,
    currentPositions,
    nodeRectsById,
    obstacles,
    bboxWidth,
    bboxHeight,
    bboxOriginX: minX,
    bboxOriginY: minY,
  };
}

/**
 * Push a kg-node out of every obstacle it overlaps. For each
 * intersecting obstacle, computes the smallest displacement along an
 * axis-aligned direction and applies it. Cascading overlaps (push out
 * of A → land on B) are resolved by iterating until either the node
 * is clear or the cap is hit, since the algorithm doesn't guarantee
 * progress in pathological cases.
 *
 * Note: this is a best-effort de-overlap, not a constraint solver.
 * For a canvas with deeply stacked obstacles a node may end up beside
 * one but still touching another. Acceptable trade for the simplicity
 * — the user can always drag the node a few pixels manually.
 */
function pushOutOfObstacles(
  startX: number,
  startY: number,
  nodeW: number,
  nodeH: number,
  obstacles: ObstacleRect[],
): { x: number; y: number } {
  let x = startX;
  let y = startY;
  // Cap iterations to bound cost on dense canvases (rooms + many cards).
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (const obs of obstacles) {
      const nL = x;
      const nR = x + nodeW;
      const nT = y;
      const nB = y + nodeH;
      const oL = obs.x;
      const oR = obs.x + obs.w;
      const oT = obs.y;
      const oB = obs.y + obs.h;
      if (nR <= oL || nL >= oR || nB <= oT || nT >= oB) continue;
      // Overlapping. Compute push distances along each cardinal
      // direction and pick the smallest — that's the closest exit.
      const pushLeft = nR - oL;
      const pushRight = oR - nL;
      const pushUp = nB - oT;
      const pushDown = oB - nT;
      const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown);
      if (minPush === pushLeft) x -= pushLeft + OBSTACLE_CLEARANCE_PX;
      else if (minPush === pushRight) x += pushRight + OBSTACLE_CLEARANCE_PX;
      else if (minPush === pushUp) y -= pushUp + OBSTACLE_CLEARANCE_PX;
      else y += pushDown + OBSTACLE_CLEARANCE_PX;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, y };
}

// Cubic ease-out so the relaxation feels gentle at the end (the human
// eye is more sensitive to the final settle than the initial burst).
function easeOutCubic(t: number): number {
  const x = 1 - t;
  return 1 - x * x * x;
}

// Re-export PositionedNode so callers can introspect computeForceLayout
// results without importing from src/lib/graph/force-layout directly.
export type { PositionedNode };
