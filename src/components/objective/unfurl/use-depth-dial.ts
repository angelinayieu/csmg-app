"use client";

// ── useDepthDial ──
//
// The headless "depth scrubber" reducer for the objective unfurl. Salvaged
// from the depth-unfurl prototype's interaction core (its renderer was a
// throwaway DOM mock; this logic is the keeper). Board-agnostic: returns
// depth + setters + a wheel handler; the consumer (the on-board unfurl)
// decides what each depth reveals.
//
// The 6-level ladder maps onto the objective's real layer hierarchy and
// the existing graph builders:
//   0 Seed     — the objective + its readiness
//   1 Anatomy  — the ObjectiveStack layers           (buildCanvasGraph bands)
//   2 Bets     — sub-objectives on their layers       (buildCanvasGraph nodes/edges)
//   3 Levers   — a room's pains · mechanisms · outcomes (buildRoomGraph nodes)
//   4 Plays    — causal chains + loops                (buildRoomGraph edges + loops)
//   5 Proof    — rigor / evidence tiers               (methodTier on nodes)

import { useCallback, useEffect, useRef, useState } from "react";

export interface DepthLevel {
  d: number;
  label: string;
  hint: string;
}

export const DEPTH_LEVELS: readonly DepthLevel[] = [
  { d: 0, label: "Seed", hint: "The objective + its readiness" },
  { d: 1, label: "Anatomy", hint: "The layer stack" },
  { d: 2, label: "Bets", hint: "Sub-objectives, placed on their layers" },
  { d: 3, label: "Levers", hint: "A room's pains · mechanisms · outcomes" },
  { d: 4, label: "Plays", hint: "Causal chains + reinforcing loops" },
  { d: 5, label: "Proof", hint: "Rigor + evidence tiers" },
] as const;

export const MAX_DEPTH = DEPTH_LEVELS.length - 1;

/** Pixels of wheel travel per depth step (matches the prototype's feel). */
const WHEEL_STEP = 60;

export interface DepthDial {
  depth: number;
  setDepth: (d: number) => void;
  inc: () => void;
  dec: () => void;
  /** Attach to the unfurl surface's onWheel to scrub depth by scrolling. */
  onWheel: (e: { deltaY: number }) => void;
}

export function useDepthDial(initial = 0): DepthDial {
  const [depth, setDepthState] = useState(
    Math.max(0, Math.min(MAX_DEPTH, initial)),
  );
  // Ref mirror so the wheel/keyboard closures always see the latest depth
  // without re-binding listeners.
  const depthRef = useRef(depth);
  useEffect(() => {
    depthRef.current = depth;
  }, [depth]);
  const wheelAcc = useRef(0);

  const setDepth = useCallback(
    (next: number) => setDepthState(Math.max(0, Math.min(MAX_DEPTH, next))),
    [],
  );
  const inc = useCallback(
    () => setDepth(depthRef.current + 1),
    [setDepth],
  );
  const dec = useCallback(
    () => setDepth(depthRef.current - 1),
    [setDepth],
  );

  const onWheel = useCallback(
    (e: { deltaY: number }) => {
      wheelAcc.current += e.deltaY;
      if (wheelAcc.current > WHEEL_STEP) {
        wheelAcc.current = 0;
        inc();
      } else if (wheelAcc.current < -WHEEL_STEP) {
        wheelAcc.current = 0;
        dec();
      }
    },
    [inc, dec],
  );

  return { depth, setDepth, inc, dec, onWheel };
}
