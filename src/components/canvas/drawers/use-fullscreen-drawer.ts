"use client";

// ── useFullscreenDrawer ──
//
// Drop-in fullscreen toggle for right-side overlay drawers that don't
// use the shared `CanvasDrawer` shell (cycle / edge / node detail).
// Mirrors CanvasDrawer's behavior: Esc restores from fullscreen
// before any outer close handler fires, and fullscreen resets when
// the drawer is no longer active.

import { useCallback, useEffect, useState } from "react";

export function useFullscreenDrawer(active: boolean) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v);
  }, []);

  // Esc-to-restore. Capture-phase + stopPropagation so any outer
  // Esc-to-close handler doesn't also fire on the same keypress.
  useEffect(() => {
    if (!active || !isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [active, isFullscreen]);

  // Reset when drawer closes so reopening starts in restored width.
  useEffect(() => {
    if (!active) setIsFullscreen(false);
  }, [active]);

  return { isFullscreen, toggleFullscreen };
}
