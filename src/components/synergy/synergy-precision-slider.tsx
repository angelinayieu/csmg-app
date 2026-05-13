// ── AI precision — inline thin slider ──
//
// Apple-style restraint: no boxed card chrome. Just a small mono-cap
// label, the current level value, a "?" affordance that pops the 5-
// level legend, and a thin native range input below. Fits cleanly
// at the top of the AI rail above the command bar.
//
// Universal scope — drives every augment mode (decompose / questions
// / research / variations / rank / synthesize / voice augment).
// Clarify + plan are precision-agnostic by design.

"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { PRECISION_LEVELS } from "@/lib/synergy/prompts";

interface Props {
  value: number;
  onChange: (next: number) => void;
}

const LEVEL_HINTS: Record<number, string> = {
  1: "Wild, cross-domain. Evocative or metaphorical.",
  2: "Imaginative but recognizable. Pushes past the obvious.",
  3: "Distinct yet plausible. Shifts mechanism, audience, or scope.",
  4: "Concrete. Names a specific tool, mechanism, or population.",
  5: "Surgical. Who + how + a measurable target.",
};

export function SynergyPrecisionSlider({ value, onChange }: Props) {
  const [legendOpen, setLegendOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const level = PRECISION_LEVELS[value - 1];

  // Click-outside closes the legend
  useEffect(() => {
    if (!legendOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setLegendOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [legendOpen]);

  return (
    <div className="relative" ref={popoverRef}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
            Precision
          </span>
          <button
            onClick={() => setLegendOpen((v) => !v)}
            aria-label="Explain precision levels"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            title="What does each level mean?"
          >
            <HelpCircle className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-700">
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
        aria-label="AI precision"
        className="mt-1.5 w-full accent-gray-900"
        style={{ height: 2 }}
      />

      {legendOpen && (
        <div
          className="absolute right-0 z-30 mt-2 w-[280px] rounded-2xl border border-gray-200 bg-white p-3"
          style={{
            boxShadow:
              "0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -8px rgba(15,23,42,0.16)",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
              Precision spectrum
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-gray-400">
              Wild → Quantified
            </span>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-gray-600">
            Applies to every AI action — Decompose, Questions, Research,
            Variations, Rank, Synthesize, and voice augment. Clarify and
            Plan use it as tone context only.
          </p>
          <ul className="space-y-0.5">
            {PRECISION_LEVELS.map((lvl, i) => {
              const lv = i + 1;
              const active = lv === value;
              return (
                <li
                  key={lv}
                  className={[
                    "flex cursor-pointer gap-2 rounded-md px-2 py-1.5 transition",
                    active ? "bg-gray-50" : "hover:bg-gray-50/60",
                  ].join(" ")}
                  onClick={() => {
                    onChange(lv);
                    setLegendOpen(false);
                  }}
                >
                  <span
                    className={[
                      "shrink-0 font-mono text-[9px] font-semibold",
                      active ? "text-gray-900" : "text-gray-400",
                    ].join(" ")}
                  >
                    Lv {lv}
                  </span>
                  <div className="min-w-0">
                    <div
                      className={[
                        "text-[12px] font-semibold tracking-tight",
                        active ? "text-gray-900" : "text-gray-700",
                      ].join(" ")}
                    >
                      {lvl.label}
                    </div>
                    <div className="text-[11px] leading-snug text-gray-500">
                      {LEVEL_HINTS[lv]}
                    </div>
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
