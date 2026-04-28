"use client";

// ── Composition (right rail) ──────────────────────────────────────
//
// 4 rows — Buffer (β₄), Decay (δ), Rehearsal (ρ), Attention (α) —
// each with a colored badge, name, weight bar, and 0–100 score.
// Weights come from prediction.compWeights.

import { COMPONENTS } from "../lib/components-defs";
import type { Prediction } from "../lib/types";

export interface CompositionPanelProps {
  prediction: Prediction;
}

export function CompositionPanel({ prediction }: CompositionPanelProps) {
  return (
    <div className="border-t border-black/[0.05] px-[18px] py-[14px]">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
          Composition
        </div>
        <div className="text-[11px] font-medium text-[#86868b]">4 parts</div>
      </div>

      <div className="divide-y divide-black/[0.05]">
        {COMPONENTS.map((c) => {
          const w = Math.round(prediction.compWeights[c.id]);
          const colorBg = `${c.color}20`;

          return (
            <div
              key={c.id}
              className="grid items-center gap-2.5 py-1.5 text-[12px]"
              style={{
                gridTemplateColumns: "22px 1fr 70px 28px",
              }}
              title={c.role}
            >
              {/* Greek-letter badge */}
              <div
                className="relative grid h-[22px] w-[22px] place-items-center rounded-[9px] text-[11px] font-bold leading-none tracking-[-0.02em]"
                style={{
                  background: colorBg,
                  color: c.color,
                }}
              >
                {c.sym}
                {c.sub && (
                  <span className="absolute -bottom-[1px] right-[2px] text-[7px] font-bold leading-none">
                    {c.sub}
                  </span>
                )}
              </div>

              {/* Name */}
              <div className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[#1d1d1f]">
                {c.name}
              </div>

              {/* Bar */}
              <div className="h-1 overflow-hidden rounded-[2px] bg-[#f2f2f4]">
                <div
                  className="h-full rounded-[2px] transition-[width] duration-300"
                  style={{
                    width: `${w}%`,
                    background: c.color,
                  }}
                />
              </div>

              {/* Value */}
              <div className="text-right text-[11px] font-semibold tabular-nums text-[#424245]">
                {w}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
