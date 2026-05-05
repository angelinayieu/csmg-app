"use client";

// ── DrawerFullscreenButton ──
//
// Header-corner toggle that mirrors the one inside `CanvasDrawer`.
// Used by the custom detail drawers (cycle / edge / node) so every
// right-side panel exposes the same maximize/restore affordance.

import { Maximize2, Minimize2 } from "lucide-react";

interface DrawerFullscreenButtonProps {
  isFullscreen: boolean;
  onToggle: () => void;
}

export function DrawerFullscreenButton({
  isFullscreen,
  onToggle,
}: DrawerFullscreenButtonProps) {
  return (
    <button
      onClick={onToggle}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-700"
      title={isFullscreen ? "Restore (Esc)" : "Maximize"}
      aria-label={isFullscreen ? "Restore drawer" : "Maximize drawer"}
    >
      {isFullscreen ? (
        <Minimize2 className="h-3.5 w-3.5" />
      ) : (
        <Maximize2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
