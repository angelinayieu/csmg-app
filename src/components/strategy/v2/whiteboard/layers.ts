import type { WhiteboardLayer } from "@/types/whiteboard";

/**
 * Target Y for each layer's center line.
 * Wider spacing (220px) so nodes in adjacent layers don't collide.
 */
export const LAYER_Y: Record<WhiteboardLayer, number> = {
  inputs:     100,
  scope:      320,
  objectives: 540,
  kg:         800,
  strategy:   1120,
  tracking:   1400,
  feedback:   1620,
};

export const LAYER_ORDER: WhiteboardLayer[] = [
  "inputs",
  "scope",
  "objectives",
  "kg",
  "strategy",
  "tracking",
  "feedback",
];

/** Height of the colored background band drawn per layer (centered on LAYER_Y). */
export const LAYER_BAND_HEIGHT = 180;

/** Full canvas dimensions. Chosen to fit feedback layer + padding. */
export const CANVAS_WIDTH = 1500;
export const CANVAS_HEIGHT = 1800;

/** Layer band fill colors (very pale). */
export const LAYER_BAND_FILL: Record<WhiteboardLayer, string> = {
  inputs:     "rgba(100, 116, 139, 0.04)",
  scope:      "rgba(79, 70, 229, 0.04)",
  objectives: "rgba(5, 150, 105, 0.05)",
  kg:         "rgba(var(--accent-rgb), 0.06)",
  strategy:   "rgba(234, 88, 12, 0.04)",
  tracking:   "rgba(8, 145, 178, 0.04)",
  feedback:   "rgba(147, 51, 234, 0.04)",
};

export const LAYER_LABELS: Record<WhiteboardLayer, string> = {
  inputs: "Inputs",
  scope: "Scope",
  objectives: "Objectives",
  kg: "Knowledge Graph",
  strategy: "Strategy",
  tracking: "Tracking",
  feedback: "Self-Improve",
};

export const LAYER_DOT_COLOR: Record<WhiteboardLayer, string> = {
  inputs:     "#64748B",
  scope:      "#4F46E5",
  objectives: "#059669",
  kg:         "rgb(var(--accent-rgb))",
  strategy:   "#EA580C",
  tracking:   "#0891B2",
  feedback:   "#9333EA",
};
