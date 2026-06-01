// ── Build Situation Model ──────────────────────────────────────────
//
// Pure transform: objective + sub-objectives → a radial problem→solution
// knowledge graph. Mirrors the existing build-*-props libs
// (build-macro-summary-props, build-data-lineage-props) so the
// SituationModelView stays a thin renderer.
//
// Structure follows the "eco-innovation" KG principle the user shared:
// INNER = general/abstract, OUTER = concrete. Each node spawns spin-offs.
//
//   tier 0 (center) — the Objective (macro intent)
//   tier 1 (ring 1) — Sub-objectives (macro-objectives / "capabilities")
//   tier 2 (ring 2) — Features (core / micro) under each sub-objective
//   tier 3 (ring 3) — Mechanisms (concrete) — the OUTER ring that fills
//                     in as the Deepen → v2 autopilot runs. Not emitted
//                     yet at the canvas altitude (features carry a count
//                     badge instead); deepening grows this ring, which
//                     is exactly the "sophistication grows outward" idea.
//
// Layout is a deterministic radial tidy-tree (not a force sim): each
// sub-objective owns an angular sector; its features fan out inside that
// sector. Deterministic = stable, clean, and matches the reference KG
// aesthetic without a finicky simulation.

import type { MainCanvasSub } from "@/components/objective/main-canvas-view";

/** Stable node-id scheme — shared with consumers. The time-scrub
 *  (situation-view) maps snapshot entity/room ids back to these so it can
 *  filter the live radial to what existed at a past iteration. */
export const OBJECTIVE_NODE_ID = "objective";
export const subNodeId = (id: string) => `sub:${id}`;
export const featureNodeId = (id: string) => `feat:${id}`;

export type SituationNodeKind = "objective" | "sub" | "feature";
/** Which face of the problem↔solution duality a node represents. Drives
 *  the dashed (problem/tension) vs solid (solution/build) edge styling. */
export type SituationFace = "problem" | "solution" | "neutral";

export interface SituationNode {
  id: string;
  kind: SituationNodeKind;
  tier: 0 | 1 | 2;
  label: string;
  /** The negative outcome / pain this node counters — the "problem face"
   *  surfaced in the node tooltip + index sidebar. */
  problem?: string | null;
  face: SituationFace;
  parentId: string | null;
  /** Count of children one tier out (features under a sub, etc.). When
   *  the children aren't materialized as nodes yet, this is the "depth
   *  not yet expanded" badge — it grows as deepening fills the outer ring. */
  childCount?: number;
  layerLabel?: string | null;
  // ── radial layout (viewBox coords) ──
  x: number;
  y: number;
  angleDeg: number;
  radius: number;
}

export interface SituationEdge {
  id: string;
  source: string;
  target: string;
  /** dashed = problem/tension link · solid = solution/build link */
  kind: "solution" | "problem";
}

export interface SituationModel {
  nodes: SituationNode[];
  edges: SituationEdge[];
  /** viewBox dims — wider than tall so radial labels get horizontal gutters. */
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Ring radii by tier index. */
  ringRadius: [number, number, number];
  tierCounts: { subs: number; features: number };
}

// Geometry — viewBox is wider than tall so the left/right labels (which
// extend horizontally) get gutters instead of clipping. Rings kept modest
// so labels don't collide with the center objective.
const WIDTH = 1240;
const HEIGHT = 980;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const RING: [number, number, number] = [0, 200, 320];
// Fraction of a sub-objective's angular sector its features may occupy.
const FEATURE_WEDGE_FILL = 0.72;
// Cap materialized feature nodes per sub so a dense room stays legible;
// overflow is reflected in the sub's childCount badge.
const MAX_FEATURES_PER_SUB = 10;

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(rad),
    y: CY + radius * Math.sin(rad),
  };
}

export function buildSituationModel({
  objective,
  subs,
}: {
  objective: string;
  subs: MainCanvasSub[];
}): SituationModel {
  const nodes: SituationNode[] = [];
  const edges: SituationEdge[] = [];

  // ── tier 0 — the objective at the center ──
  nodes.push({
    id: OBJECTIVE_NODE_ID,
    kind: "objective",
    tier: 0,
    label: truncate(objective, 30),
    face: "neutral",
    parentId: null,
    childCount: subs.length,
    x: CX,
    y: CY,
    angleDeg: 0,
    radius: 0,
  });

  const n = Math.max(subs.length, 1);
  const sector = 360 / n;

  subs.forEach((sub, i) => {
    // Start at -90° (top, clock-style) and walk clockwise.
    const angleDeg = -90 + sector * i;
    const { x: sx, y: sy } = polar(angleDeg, RING[1]);
    const subId = subNodeId(sub.id);

    // Prefer the dense feature/pain set (all room entities); fall back to
    // the sparse approved-edge endpoints when the dense set isn't present.
    const featureItems = (
      sub.featureItems && sub.featureItems.length > 0
        ? sub.featureItems
        : sub.approvedItems ?? []
    ).slice(0, MAX_FEATURES_PER_SUB);
    const laneTotal =
      (sub.laneTotalCounts?.friction ?? 0) +
      (sub.laneTotalCounts?.mechanism ?? 0) +
      (sub.laneTotalCounts?.result ?? 0);

    nodes.push({
      id: subId,
      kind: "sub",
      tier: 1,
      label: truncate(sub.title, 32),
      problem: sub.topNegativeOutcome ?? null,
      face: "solution",
      parentId: "objective",
      // Prefer the real lane total (true breadth of the room) for the
      // badge; fall back to the materialized count.
      childCount: laneTotal || featureItems.length,
      layerLabel: sub.layerPositionLabel ?? null,
      x: sx,
      y: sy,
      angleDeg,
      radius: RING[1],
    });
    edges.push({
      id: `e:obj>${subId}`,
      source: OBJECTIVE_NODE_ID,
      target: subId,
      kind: "solution",
    });

    // ── tier 2 — features fan out inside this sub's sector ──
    const fcount = featureItems.length;
    if (fcount > 0) {
      const wedge = sector * FEATURE_WEDGE_FILL;
      const start = angleDeg - wedge / 2;
      const step = fcount > 1 ? wedge / (fcount - 1) : 0;
      featureItems.forEach((f, j) => {
        // A lone feature is nudged off its sub's exact axis so its label
        // doesn't stack on top of the sub's label (worst on the left/right
        // cardinal nodes, where both labels extend the same direction).
        const fAngleDeg = fcount > 1 ? start + step * j : angleDeg - 13;
        const { x: fx, y: fy } = polar(fAngleDeg, RING[2]);
        const fId = featureNodeId(f.id);
        const isProblem = f.layer === "pain";
        nodes.push({
          id: fId,
          kind: "feature",
          tier: 2,
          label: truncate(f.name, 24),
          face: isProblem ? "problem" : "solution",
          parentId: subId,
          layerLabel: f.layer,
          x: fx,
          y: fy,
          angleDeg: fAngleDeg,
          radius: RING[2],
        });
        edges.push({
          id: `e:${subId}>${fId}`,
          source: subId,
          target: fId,
          kind: isProblem ? "problem" : "solution",
        });
      });
    }
  });

  return {
    nodes,
    edges,
    width: WIDTH,
    height: HEIGHT,
    cx: CX,
    cy: CY,
    ringRadius: RING,
    tierCounts: {
      subs: subs.length,
      features: nodes.filter((nd) => nd.kind === "feature").length,
    },
  };
}
