// Public surface of the probe-trail primitives package.
//
// The orchestrator that drives the rabbit hole imports from here.
// Composition rules:
//   • Every step is a TrailNode, even sub-questions and result terminals
//   • Edges are always TrailEdge (no plain SVG lines outside this file)
//   • Collapsed badges on source cards are TrailBadge
//
// Layout math (where to place each node) is the orchestrator's job —
// these primitives are pure presentational.

export { TrailNode } from "./trail-node";
export { TrailEdge } from "./trail-edge";
export { TrailBadge } from "./trail-badge";

export type { TrailNodeProps, TrailNodePhase, TrailNodeIcon } from "./trail-node";
export type { TrailEdgeProps, TrailEdgePhase } from "./trail-edge";
export type { TrailBadgeProps } from "./trail-badge";
