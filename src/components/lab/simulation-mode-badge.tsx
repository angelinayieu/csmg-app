"use client";

// ── SimulationModeBadge ─────────────────────────────────────────────────
//
// Gap B surface: every prediction in the lab carries an unmissable chip
// saying which engine produced it. Same visual weight as the headline
// metric — the user should never wonder "is this number computed or is
// the LLM making it up?". Four tones, ordered by epistemic weight:
//
//   narrative walk (gray)     — LLM hypothesis, lowest trust
//   monte-carlo (blue)        — computed distribution under param noise
//   bootstrap (teal)          — distribution from historical replay
//   deterministic replay (emerald) — user's actual process executed
//
// The tagline is authoritative copy from SIMULATION_MODE_META; never
// write your own. Keeping the language canonical across surfaces means
// users learn the taxonomy once and carry it everywhere the lab renders.

import { Sparkles, BarChart3, History, PlayCircle, HelpCircle } from "lucide-react";
import type { SimulationMode } from "@/types/simulation-mode";
import { SIMULATION_MODE_META } from "@/types/simulation-mode";

const MODE_ICON: Record<SimulationMode, typeof Sparkles> = {
  narrative_walk: Sparkles,
  monte_carlo: BarChart3,
  bootstrap: History,
  deterministic_replay: PlayCircle,
};

export interface SimulationModeBadgeProps {
  mode: SimulationMode;
  /** Render the tagline inline (drawer-style) vs tooltip-only. Default false. */
  showTagline?: boolean;
  /** Compact pill for list rows; full card for result headers. Default "full". */
  size?: "compact" | "full";
}

export function SimulationModeBadge({
  mode,
  showTagline = false,
  size = "full",
}: SimulationModeBadgeProps) {
  const meta = SIMULATION_MODE_META[mode];
  const Icon = MODE_ICON[mode] ?? HelpCircle;

  if (size === "compact") {
    return (
      <span
        title={meta.tagline}
        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest"
        style={{
          borderColor: `${meta.accent}55`,
          background: `${meta.accent}18`,
          color: meta.accent,
        }}
      >
        <Icon className="h-2.5 w-2.5" />
        {meta.label}
      </span>
    );
  }

  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: `${meta.accent}55`,
        background: `${meta.accent}14`,
      }}
    >
      <div
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: meta.accent }}
      >
        <Icon className="h-3 w-3" />
        {meta.label}
      </div>
      {showTagline && (
        <p className="mt-1 text-[11px] leading-snug text-[var(--lab-text-mid)]">
          {meta.tagline}
        </p>
      )}
    </div>
  );
}
