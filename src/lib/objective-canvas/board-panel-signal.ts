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

// `techSpec` is the floating Tech Spec document. Unlike the three top-right
// launcher panels (powerups/library/style) it does NOT share their slot — it
// floats centered and coexists with the library rail (which pushes it aside),
// so opening it must not close the others.
export type BoardPanel =
  | "powerups"
  | "library"
  | "style"
  | "techSpec"
  // Unpack reasoning sidebar (UNPACK_PLAN Phase 3). Right-edge slot — joins
  // the mutex with powerups/library/style so opening it closes those (and
  // vice versa). techSpec stays out of the mutex and floats centered.
  | "unpack";

const state: Record<BoardPanel, boolean> = {
  powerups: false,
  library: false,
  style: false,
  techSpec: false,
  unpack: false,
};
const subs = new Set<() => void>();

export function isPanelOpen(p: BoardPanel): boolean {
  return state[p];
}

export function setPanel(p: BoardPanel, open: boolean): void {
  if (state[p] === open) return;
  // The right-edge launcher panels share a slot — opening one closes the
  // others. Tech Spec floats independently and stays out of that mutex.
  if (open && p !== "techSpec") {
    state.powerups = false;
    state.library = false;
    state.style = false;
    state.unpack = false;
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
