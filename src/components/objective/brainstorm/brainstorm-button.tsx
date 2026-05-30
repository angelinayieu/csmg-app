"use client";

// ── Brainstorm Button ───────────────────────────────────────────────
//
// Press point that opens the BrainstormPanel. Mounts inside the
// sub-objective picker, above the existing VariantLabBar — the
// "Generate better" bar STAYS for power users who want one-intent-at-
// a-time manual control. This button is the autopilot version.

import { Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface Props {
  onClick: () => void;
  disabled?: boolean;
}

export function BrainstormButton({ onClick, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[12.5px] font-semibold transition hover:scale-[1.015]"
      style={{
        background: disabled
          ? appleVibe.surface.chip
          : "linear-gradient(135deg, rgba(59,130,246,0.95) 0%, rgba(168,85,247,0.95) 100%)",
        color: disabled ? appleVibe.text.faint : "white",
        boxShadow: disabled
          ? "none"
          : "0 4px 12px -3px rgba(59,130,246,0.4), 0 1px 0 0 rgba(255,255,255,0.15) inset",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      title="Auto-pilot the variant lab — 3 intents → cleanup → critique → ranked picks"
    >
      <Sparkles
        className="h-3.5 w-3.5 transition group-hover:rotate-12"
        strokeWidth={2.5}
      />
      Brainstorm
      <span
        className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] tabular-nums"
        title="Estimated runtime"
      >
        ~30s
      </span>
    </button>
  );
}
