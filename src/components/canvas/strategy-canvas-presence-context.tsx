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
}

const empty: StrategyCanvasPresence = {
  objectiveIds: new Set(),
  zoomToObjective: () => {},
};

const StrategyCanvasPresenceContext = createContext<StrategyCanvasPresence>(empty);

export const StrategyCanvasPresenceProvider =
  StrategyCanvasPresenceContext.Provider;

export function useStrategyCanvasPresence(): StrategyCanvasPresence {
  return useContext(StrategyCanvasPresenceContext);
}
