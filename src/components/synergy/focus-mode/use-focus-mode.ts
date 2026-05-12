// ── useFocusMode — orchestrates the immersive Focus Mode overlay ──
//
// Owns:
//   - `phase` — closed | entering | open | publishing | exiting
//   - `stage` — 1 | 2 | 3 | 4 (only meaningful when phase === "open")
//   - `overrides` — per-node user toggles (keep / exclude) layered on
//     top of the auto-mark defaults
//   - `hoveredNodeId` — bridge between the pane and the canvas; either
//     surface sets it on hover and both react
//
// Animation phase machine:
//
//   closed  ──open──▶  entering  ──t=700ms──▶  open
//   open    ──nextStage/prevStage──▶  open (different stage)
//   open    ──publish──▶  publishing  ──t=2600ms──▶  (consumer navigates)
//   open    ──close──▶  exiting  ──t=400ms──▶  closed
//
// Consumers should read `phase` to render the right shell visibility +
// transition classes; read `stage` for the active content.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  autoMarkBoard,
  computeKeptIds,
  type FocusOverrides,
} from "@/lib/synergy/focus-mode";
import type { ClientNode } from "@/lib/synergy/types";

export type FocusPhase =
  | "closed"
  | "entering"
  | "open"
  | "publishing"
  | "exiting";

export type FocusStage = 1 | 2 | 3 | 4;

export interface UseFocusModeReturn {
  phase: FocusPhase;
  stage: FocusStage;
  overrides: FocusOverrides;
  hoveredNodeId: string | null;
  // Set of node ids the system considers "in" the converged set,
  // accounting for user overrides. Useful for canvas dimming.
  keptIds: Set<string>;
  // Set of node ids the user has actively excluded (their canvas
  // representation should fade more than the default-not-kept set).
  excludedIds: Set<string>;
  // Node ids that are kind === 'plan' — used by the canvas to apply
  // the persistent cyan glow ring.
  planIds: Set<string>;
  // Actions
  open: () => void;
  close: () => void;
  goToStage: (next: FocusStage) => void;
  next: () => void;
  prev: () => void;
  setOverride: (nodeId: string, value: "keep" | "exclude" | null) => void;
  setHoveredNodeId: (id: string | null) => void;
  beginPublishing: () => void;
  endPublishing: () => void;
}

export function useFocusMode(nodes: ClientNode[]): UseFocusModeReturn {
  const [phase, setPhase] = useState<FocusPhase>("closed");
  const [stage, setStage] = useState<FocusStage>(1);
  const [overrides, setOverrides] = useState<FocusOverrides>(new Map());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recompute auto-mark whenever the node list changes. In practice
  // this is rare while Focus Mode is open (the user can't edit the
  // board), but if the underlying SynergyWhiteboard hot-reloads or
  // the user adds nodes between sessions, we want fresh marks.
  const marks = useMemo(() => autoMarkBoard(nodes), [nodes]);

  const keptIds = useMemo(
    () => computeKeptIds(marks, overrides),
    [marks, overrides],
  );

  const excludedIds = useMemo(() => {
    const out = new Set<string>();
    for (const [id, val] of overrides) {
      if (val === "exclude") out.add(id);
    }
    return out;
  }, [overrides]);

  const planIds = useMemo(() => {
    const out = new Set<string>();
    for (const [id, mark] of marks) {
      if (mark.bucket === "plan") out.add(id);
    }
    return out;
  }, [marks]);

  const open = useCallback(() => {
    if (phase !== "closed") return;
    setPhase("entering");
    setStage(1);
    setOverrides(new Map());
    if (enterTimer.current) clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => setPhase("open"), 700);
  }, [phase]);

  const close = useCallback(() => {
    if (phase === "closed" || phase === "exiting") return;
    setPhase("exiting");
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setPhase("closed");
      setHoveredNodeId(null);
    }, 400);
  }, [phase]);

  const goToStage = useCallback((next: FocusStage) => {
    setStage(next);
  }, []);

  const next = useCallback(() => {
    setStage((s) => (s < 4 ? ((s + 1) as FocusStage) : s));
  }, []);
  const prev = useCallback(() => {
    setStage((s) => (s > 1 ? ((s - 1) as FocusStage) : s));
  }, []);

  const setOverride = useCallback(
    (nodeId: string, value: "keep" | "exclude" | null) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        if (value === null) {
          next.delete(nodeId);
        } else {
          next.set(nodeId, value);
        }
        return next;
      });
    },
    [],
  );

  const beginPublishing = useCallback(() => {
    setPhase("publishing");
  }, []);
  const endPublishing = useCallback(() => {
    // Caller usually navigates away; keep phase at "publishing" until
    // unmount to suppress the close animation flash.
    setPhase("closed");
  }, []);

  // ESC key closes (only when fully open or entering — not during
  // publishing or exit transitions, which would race).
  useEffect(() => {
    if (phase !== "open" && phase !== "entering") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only fire on the document — not when inside an input/textarea
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, close]);

  // Cleanup any pending timers on unmount
  useEffect(() => {
    return () => {
      if (enterTimer.current) clearTimeout(enterTimer.current);
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  return {
    phase,
    stage,
    overrides,
    hoveredNodeId,
    keptIds,
    excludedIds,
    planIds,
    open,
    close,
    goToStage,
    next,
    prev,
    setOverride,
    setHoveredNodeId,
    beginPublishing,
    endPublishing,
  };
}
