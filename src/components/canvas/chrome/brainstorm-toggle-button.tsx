"use client";

// ── BrainstormToggleButton (Phase 2D) ──
//
// Floating entry affordance for the brainstorm panel. Sits in the
// top-right of the canvas chrome area (below the TopBar). Click to
// open/close the panel. Reflects current state via color + subtle
// pulse when features are actively influencing canvas behavior.

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrainstormSettings } from "@/lib/brainstorm/brainstorm-settings";

export interface BrainstormToggleButtonProps {
  open: boolean;
  onToggle: () => void;
  settings: BrainstormSettings;
  /** Has any feature currently active? Drives the pulse. */
  active: boolean;
}

const ACCENT = "#8B5CF6";

export function BrainstormToggleButton({
  open,
  onToggle,
  settings,
  active,
}: BrainstormToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "pointer-events-auto absolute right-4 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold backdrop-blur-sm transition-all",
        open && "shadow-md",
      )}
      style={{
        // Sits below the topbar AND below the CanvasLayerToggle (which
        // anchors at top:68, right-4). Stacking vertically at the right
        // edge keeps both visible without depending on either's width.
        top: 112,
        background: active
          ? `color-mix(in srgb, ${ACCENT} 14%, rgba(255,255,255,0.9))`
          : "rgba(255,255,255,0.85)",
        border: active
          ? `1px solid color-mix(in srgb, ${ACCENT} 32%, transparent)`
          : "1px solid rgba(15,23,42,0.1)",
        color: active ? ACCENT : "#475569",
        boxShadow: active
          ? `0 0 0 4px color-mix(in srgb, ${ACCENT} 6%, transparent)`
          : undefined,
      }}
      title={
        settings.enabled
          ? open
            ? "Close brainstorm panel"
            : "Open brainstorm panel"
          : "Enable brainstorm mode"
      }
    >
      <Sparkles
        className={cn("h-3 w-3", active && "animate-pulse")}
        strokeWidth={1.75}
      />
      <span>Brainstorm</span>
      {active && (
        <span
          className="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{
            background: ACCENT,
            boxShadow: `0 0 6px ${ACCENT}`,
          }}
          aria-label="Brainstorm features are active"
        />
      )}
    </button>
  );
}
