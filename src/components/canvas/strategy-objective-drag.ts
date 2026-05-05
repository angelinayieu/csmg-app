// ── Strategy objective drag payload ──
//
// Shared MIME + payload used when the user drags a CascadeObjectiveCard
// out of the strategy drawer onto the canvas. Lives outside the shape
// file so the drawer (a non-tldraw component) can import it without
// pulling tldraw runtime into the strategy bundle.

import type { PaletteSlot } from "./strategy-objective-drag-types";

export type { PaletteSlot };

export const STRATEGY_OBJECTIVE_DRAG_MIME =
  "application/x-interaxis-strategy-objective";

export interface StrategyObjectiveDragPayload {
  spaceId: string;
  /** CascadeObjective.id — stable across renders, drives dedupe */
  objectiveId: string;
  title: string;
  description: string | null;
  /** 0–100 progress for the inline bar */
  progressPct: number;
  tag: "lead" | "lag";
  valueLabel: string | null;
  /** Drives accent color on the dropped card */
  paletteKey: PaletteSlot;
  /** KG entities the objective references — handy for future linking */
  sourceEntityIds: string[];
  /** Display label for the parent perspective ("Internal", etc.) */
  perspectiveLabel: string;
}

/** Stable shape id seed so re-dragging the same objective dedupes. */
export function strategyObjectiveShapeIdSeed(
  spaceId: string,
  objectiveId: string,
): string {
  return `strategy-objective-${spaceId}-${objectiveId}`;
}
