"use client";

// ── Board panel signal ────────────────────────────────────────────
//
// Shared open/close state for the board's top-right launcher panels, so the
// unified BoardTopRightBar trigger buttons and the panels themselves
// (PowerupRail, LibraryLauncher, the style palette) stay in sync: the bar
// lights up whichever panel is live, and each panel's own close ✕ flips the
// SAME state.
//
// The two full-height rails (powerups / library) share the right-edge slot,
// so opening one closes the other. The small style popover is independent.

import { useSyncExternalStore } from "react";

export type BoardPanel = "powerups" | "library" | "style";

const state: Record<BoardPanel, boolean> = {
  powerups: false,
  library: false,
  style: false,
};
const subs = new Set<() => void>();

export function isPanelOpen(p: BoardPanel): boolean {
  return state[p];
}

export function setPanel(p: BoardPanel, open: boolean): void {
  if (state[p] === open) return;
  // All three anchor directly below the unified bar at the top-right, so only
  // one is live at a time — opening any closes the others (no overlap).
  if (open) {
    state.powerups = false;
    state.library = false;
    state.style = false;
  }
  state[p] = open;
  subs.forEach((f) => f());
}

export function togglePanel(p: BoardPanel): void {
  setPanel(p, !state[p]);
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Reactively read one panel's open state (re-renders on change). */
export function usePanel(p: BoardPanel): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state[p],
    () => false,
  );
}
