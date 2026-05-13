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

export interface FocusOpenOptions {
  // When set, Focus Mode scopes its convergence + canvas blur to this
  // node's thread (the node itself + ancestor chain to seed + all
  // descendants). When null/omitted, the full board is in scope.
  scopeNodeId?: string | null;
}

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
  // Thread-scoped focus: when non-null, only nodes whose id is in
  // `scopedIds` should remain sharp on the canvas; everything else
  // gets the blur+dim treatment. When null, the full board is in scope.
  scopeNodeId: string | null;
  scopedIds: Set<string> | null;
  // Actions
  open: (opts?: FocusOpenOptions) => void;
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
  const [scopeNodeId, setScopeNodeId] = useState<string | null>(null);

  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the thread scope into a closed set of node ids: the scope
  // root + its full ancestor chain (for orientation) + its full
  // descendant subtree (what the user actually wants to converge on).
  // Returns null when no scope is set — callers treat null as "full
  // board in scope".
  const scopedIds = useMemo(() => {
    if (!scopeNodeId) return null;
    const byId = new Map<string, ClientNode>();
    const childrenOf = new Map<string, string[]>();
    for (const n of nodes) {
      byId.set(n.id, n);
      if (n.parent) {
        const arr = childrenOf.get(n.parent) ?? [];
        arr.push(n.id);
        childrenOf.set(n.parent, arr);
      }
    }
    const out = new Set<string>();
    // Walk descendants (BFS) from the scope root.
    const queue: string[] = [scopeNodeId];
    while (queue.length) {
      const id = queue.shift()!;
      if (out.has(id)) continue;
      out.add(id);
      const kids = childrenOf.get(id);
      if (kids) queue.push(...kids);
    }
    // Walk ancestors up to root.
    let cursor: string | null = scopeNodeId;
    while (cursor) {
      const node = byId.get(cursor);
      if (!node) break;
      out.add(node.id);
      cursor = node.parent ?? null;
    }
    return out;
  }, [scopeNodeId, nodes]);

  // Recompute auto-mark whenever the node list changes. In practice
  // this is rare while Focus Mode is open (the user can't edit the
  // board), but if the underlying SynergyWhiteboard hot-reloads or
  // the user adds nodes between sessions, we want fresh marks.
  // When scoped, restrict auto-mark to the scoped subset so the kept
  // set + buckets only reflect the thread the user is converging on.
  const marks = useMemo(() => {
    const subset = scopedIds
      ? nodes.filter((n) => scopedIds.has(n.id))
      : nodes;
    return autoMarkBoard(subset);
  }, [nodes, scopedIds]);

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

  const open = useCallback(
    (opts?: FocusOpenOptions) => {
      if (phase !== "closed") return;
      setPhase("entering");
      setStage(1);
      setOverrides(new Map());
      setScopeNodeId(opts?.scopeNodeId ?? null);
      if (enterTimer.current) clearTimeout(enterTimer.current);
      enterTimer.current = setTimeout(() => setPhase("open"), 700);
    },
    [phase],
  );

  const close = useCallback(() => {
    if (phase === "closed" || phase === "exiting") return;
    setPhase("exiting");
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setPhase("closed");
      setHoveredNodeId(null);
      setScopeNodeId(null);
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
    scopeNodeId,
    scopedIds,
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
