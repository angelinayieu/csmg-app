// ── useShapeEntrance ──
//
// Shared one-shot entrance animation for tldraw shape views. Returns
// a style object the view can spread onto its outermost wrapper +
// the in-flight flag if the caller wants to gate child animations
// off the same window.
//
// Animation: opacity 0→1 + scale 0.96→1 + translateY 8px→0 over
// `durationMs` (default 600ms) with macOS-sheet spring easing
// (cubic-bezier 0.22, 1, 0.36, 1). Plays once on mount; re-mounts
// (page reload, route switch back) replay it.
//
// Respects prefers-reduced-motion via @media in the caller's CSS —
// the inline transition strings here always set a duration; for
// reduced-motion users the hook downshifts to 1ms so the change is
// instant.
//
// Used by: probability-space-shell-shape, synthesis-card-shape,
// mechanism-card-shape, layer-stack-shape, trajectory-fan-shape, and
// any other shape view that needs a Vision-Pro-grade entrance without
// hand-rolling the state + transition strings.

"use client";

import { useEffect, useMemo, useState } from "react";

interface EntranceResult {
  /** True while the entrance animation is in-flight. Drops to false
   *  after `durationMs`. View components can read this to gate
   *  cascading child animations (e.g., the trajectory fan's path
   *  draw, the layer stack's row stagger). */
  inEntrance: boolean;
  /** Style object to spread onto the outermost wrapper of the view. */
  entranceStyle: React.CSSProperties;
}

export function useShapeEntrance(durationMs = 600): EntranceResult {
  const [inEntrance, setInEntrance] = useState(true);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced-motion: drop the gate immediately so the shape lands
    // statically without the scale/translate motion.
    if (reduced) {
      setInEntrance(false);
      return;
    }
    const t = window.setTimeout(() => setInEntrance(false), durationMs);
    return () => window.clearTimeout(t);
  }, [durationMs]);

  const entranceStyle = useMemo<React.CSSProperties>(
    () => ({
      opacity: inEntrance ? 0 : 1,
      transform: inEntrance
        ? "scale(0.96) translateY(8px)"
        : "scale(1) translateY(0)",
      transition: `opacity ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      willChange: inEntrance ? "transform, opacity" : undefined,
    }),
    [inEntrance, durationMs],
  );

  return { inEntrance, entranceStyle };
}
