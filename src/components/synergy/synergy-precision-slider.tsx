// ── Variation precision slider (Lv 1-5) ──
//
// Native HTML range input — we don't need Radix for a 5-step slider.
// The level/label/blurb come from PRECISION_LEVELS in prompts.ts so a
// single source of truth shapes both the prompt guidance and the UI.
//
// A "?" affordance opens an inline legend explaining all five levels
// at once. This is the UX users keep asking for ("how does Lv 1 differ
// from Lv 3?") — surface the spectrum, not just the current value.

"use client";

import { useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { PRECISION_LEVELS } from "@/lib/synergy/prompts";

interface Props {
  value: number;
  onChange: (next: number) => void;
}

// One-line descriptions per level (kept tighter than the prompt
// guidance — that's the formal definition, this is the at-a-glance
// reference for the user). Mirrors the spirit of the prompt without
// quoting it verbatim.
const LEVEL_HINTS: Record<number, string> = {
  1: "Wild, cross-domain. Labels are evocative, even metaphorical.",
  2: "Imaginative but recognizable. Pushes past the obvious.",
  3: "Distinct yet plausible. Each variation shifts mechanism, audience, or scope.",
  4: "Concrete. Names a specific tool, mechanism, or population per variation.",
  5: "Surgical. Who + how + a measurable target (%, $, count, duration).",
};

export function SynergyPrecisionSlider({ value, onChange }: Props) {
  const [legendOpen, setLegendOpen] = useState(false);
  const level = PRECISION_LEVELS[value - 1];

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-900">
            Variation precision
          </span>
          <button
            onClick={() => setLegendOpen((v) => !v)}
            aria-label="Explain precision levels"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-200 hover:text-gray-700"
            title="What does each level mean?"
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
