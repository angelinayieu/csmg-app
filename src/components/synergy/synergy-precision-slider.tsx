// ── AI precision slider (Lv 1-5) ──
//
// Universal precision control for ALL AI augmentation modes —
// decompose, questions, research, variations, rank, synthesize, and
// board-wide augment. (Clarify + plan have their own structural
// rigor and are precision-agnostic by design.)
//
// Native HTML range input — no Radix dep for a 5-step slider. The
// PRECISION_LEVELS list in prompts.ts is the single source of truth
// for the label + blurb shown here.
//
// A "?" affordance opens an inline legend explaining all five levels
// + which actions the slider affects. This is the UX users keep
// asking for ("how does Lv 1 differ from Lv 3?", "does this apply
// to Decompose too?") — surface the spectrum and the scope.

"use client";

import { useState } from "react";
import { HelpCircle, Sparkles, X } from "lucide-react";
import { PRECISION_LEVELS } from "@/lib/synergy/prompts";

interface Props {
  value: number;
  onChange: (next: number) => void;
}

// One-line descriptions per level. Mode-agnostic now that precision
// drives every augment mode — the user sets the rigor; each mode
// translates it to its own specifics (decompose item granularity,
// question demands, search query precision, variation rigor, rank
// scoring justification depth, etc).
const LEVEL_HINTS: Record<number, string> = {
  1: "Wild, cross-domain. Evocative or metaphorical phrasing.",
  2: "Imaginative but recognizable. Pushes past the obvious.",
  3: "Distinct yet plausible. Each output shifts mechanism, audience, or scope.",
  4: "Concrete. Names a specific tool, mechanism, or population.",
  5: "Surgical. Who + how + a measurable target (%, $, count, duration).",
};

export function SynergyPrecisionSlider({ value, onChange }: Props) {
  const [legendOpen, setLegendOpen] = useState(false);
  const level = PRECISION_LEVELS[value - 1];

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-blue-600" />
          <span className="text-xs font-semibold text-gray-900">
            AI precision
          </span>
          <button
            onClick={() => setLegendOpen((v) => !v)}
            aria-label="Explain precision levels"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-200 hover:text-gray-700"
            title="What does each level mean? What does it apply to?"
          >
            <HelpCircle className="h-3 w-3" />
          </button>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-blue-600">
          Lv {value} · {level.label}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Variation precision"
        className="w-full accent-blue-600"
      />
      <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-wider text-gray-500">
        <span>Wild</span>
        <span>Quantified</span>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-gray-600">
        {level.blurb}
      </p>

      {legendOpen && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-2.5 text-[10px] leading-snug">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
              Precision spectrum
            </span>
            <button
              onClick={() => setLegendOpen(false)}
              aria-label="Close legend"
              className="inline-flex h-4 w-4 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="mb-2 rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1.5 text-blue-900">
            <span className="font-mono text-[8.5px] uppercase tracking-wider text-blue-700">
              Applies to →
            </span>{" "}
            Decompose · Questions · Research · Variations · Rank · Synthesize
            · auto-augment from voice. Clarify and Plan use the slider as
            tone-only context.
          </div>
          <ul className="space-y-1.5">
            {PRECISION_LEVELS.map((lvl, i) => {
              const lv = i + 1;
              const active = lv === value;
              return (
                <li
                  key={lv}
                  className={[
                    "flex gap-2 rounded-md px-2 py-1.5 transition cursor-pointer",
                    active
                      ? "bg-blue-50 ring-1 ring-blue-200"
                      : "hover:bg-gray-50",
                  ].join(" ")}
                  onClick={() => onChange(lv)}
                >
                  <span
                    className={[
                      "shrink-0 font-mono text-[9px] font-semibold",
                      active ? "text-blue-700" : "text-gray-500",
                    ].join(" ")}
                  >
                    Lv {lv}
                  </span>
                  <div className="min-w-0">
                    <div
                      className={[
                        "font-semibold",
                        active ? "text-blue-900" : "text-gray-800",
                      ].join(" ")}
                    >
                      {lvl.label}
                    </div>
                    <div className="text-gray-600">{LEVEL_HINTS[lv]}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
