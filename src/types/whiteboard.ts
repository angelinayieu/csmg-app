export type WhiteboardLayer =
  | "inputs"
  | "scope"
  | "objectives"
  | "kg"
  | "strategy"
  | "tracking"
  | "feedback";

export type WhiteboardSourceType =
  | "input"
  | "entity"
  | "goal"
  | "leverage"
  | "risk"
  | "bottleneck"
  | "cycle"
  | "perspective"
  | "tactic"
  | "indicator"
  | "proposal";

export interface WhiteboardNode {
  id: string;
  layer: WhiteboardLayer;
  label: string;
  subtitle?: string;
  sourceType: WhiteboardSourceType;
  sourceId?: string;
  // Physics state (mutated by d3-force)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export type WhiteboardEdgeKind = "system" | "user";
export type WhiteboardEdgeDimension =
  | "causal"
  | "temporal"
  | "feedback"
  | "support";

export interface WhiteboardEdge {
  id: string;
  source: string;
  target: string;
  kind: WhiteboardEdgeKind;
  label?: string;
  dimension?: WhiteboardEdgeDimension;
}

export type PostItColor = "yellow" | "pink" | "blue" | "green";

export interface PostItNote {
  id: string;
  x: number;
  y: number;
  text: string;
  color: PostItColor;
  createdAt: number;
}

export interface WhiteboardModel {
  nodes: WhiteboardNode[];
  edges: WhiteboardEdge[];
}

export interface PinnedPosition {
  x: number;
  y: number;
}
