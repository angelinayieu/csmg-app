// ── Variation precision slider (Lv 1-5) ──
//
// Native HTML range input — we don't need Radix for a 5-step slider.
// The level/label/blurb come from PRECISION_LEVELS in prompts.ts so a
// single source of truth shapes both the prompt guidance and the UI.

"use client";

import { PRECISION_LEVELS } from "@/lib/synergy/prompts";

interface Props {
  value: number;
  onChange: (next: number) => void;
}

export function SynergyPrecisionSlider({ value, onChange }: Props) {
  const level = PRECISION_LEVELS[value - 1];
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-900">
          Variation precision
        </span>
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
    </div>
  );
}
