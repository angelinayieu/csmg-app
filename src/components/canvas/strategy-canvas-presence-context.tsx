"use client";

// ── Strategy ↔ canvas presence context ──
//
// The strategy drawer mounts outside the tldraw editor's React context,
// so its nested cascade components (CascadeObjectiveCard, etc.) can't
// directly read shape state. This context bridges that gap: the canvas
// owns a `useValue` subscription to the editor and broadcasts down a
// `Set<string>` of objective IDs currently pinned on the page, plus a
// zoom-to helper for clicking the "live" pill.
//
// Provider is mounted in interaxis-canvas.tsx at the level that wraps
// the strategy drawer. Consumers call `useStrategyCanvasPresence()`.

import { createContext, useContext } from "react";

export interface StrategyCanvasPresence {
  /** Set of CascadeObjective.id values currently rendered as
   *  strategy-objective-card shapes on the active page. */
  objectiveIds: Set<string>;
  /** Pan + zoom the canvas to the dropped objective card, if present.
   *  No-op when the id isn't on the page. */
  zoomToObjective: (objectiveId: string) => void;
  /**
   * Phase E: focus the singleton forest-plot card on a specific edge —
   *   1. fetch `/api/spaces/[id]/forest-plot?edgeId=<id>`
   *   2. update the existing shape's findingsJson + highlightedFindingIds
   *      + focusedEdgeLabel
   *   3. pan + zoom the canvas to the shape
   *
   * Pass `null` to clear focus (resets the card back to space-wide top-N
   * with all rows opaque). No-op when the forest-plot shape isn't on the
   * current page yet — drawer link should be hidden in that case (the
   * caller already checks `nStudies > 0` so the situation is rare).
   */
  focusForestPlotOnEdge: (edgeId: string | null) => void;
}

const empty: StrategyCanvasPresence = {
  objectiveIds: new Set(),
  zoomToObjective: () => {},
  focusForestPlotOnEdge: () => {},
};

const StrategyCanvasPresenceContext = createContext<StrategyCanvasPresence>(empty);

export const StrategyCanvasPresenceProvider =
  StrategyCanvasPresenceContext.Provider;

export function useStrategyCanvasPresence(): StrategyCanvasPresence {
  return useContext(StrategyCanvasPresenceContext);
}
