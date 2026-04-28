"use client";

// ── Effect Breakdown (right rail) ────────────────────────────────
//
// One row per active effect from `prediction.effects`. Each row:
//   [name + target chip]  [centered ± bar]  [signed value]
//
// Bar is centered on a vertical divider — green right for positive,
// red left for negative. Width scales to the largest absolute effect.
//
// Empty state when no state effects are active (baseline conditions).

import type { ActiveEffect } from "../lib/types";

export interface EffectBreakdownProps {
  effects: ActiveEffect[];
}

export function EffectBreakdown({ effects }: EffectBreakdownProps) {
  return (
    <div className="border-t border-black/[0.05] px-[18px] py-[14px]">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
          Effect Breakdown
        </div>
        <div className="text-[11px] font-medium text-[#86868b]">
          {effects.length} active
        </div>
      </div>

      {effects.length === 0 ? (
        <div className="py-2.5 text-center text-[11px] text-[#86868b]">
          No active state effects · baseline conditions
        </div>
      ) : (
        <EffectList effects={effects} />
      )}
    </div>
  );
}

function EffectList({ effects }: { effects: ActiveEffect[] }) {
  const maxAbs = Math.max(...effects.map((e) => Math.abs(e.value)), 0.5);

  return (
    <div className="divide-y divide-black/[0.05]">
      {effects.map((e, idx) => {
        const negative = e.value < 0;
        const widthPct = (Math.abs(e.value) / maxAbs) * 50;
        const fillColor = negative ? "#ff3b30" : "#34c759";

        return (
          <div
            key={`${e.name}-${idx}`}
            className="grid grid-cols-[1fr_auto] items-center gap-2.5 py-1.5 text-[12px]"
            title={e.note}
          >
            <div className="font-medium text-[#424245]">
              {e.name}
              <span
                className="ml-1.5 inline-block rounded-md px-[5px] py-px text-[8px] font-bold uppercase tracking-[0.04em]"
                style={{ background: "#f2f2f4", color: "#6e6e73" }}
              >
                {e.target}
              </span>
            </div>
            <div className="flex min-w-[72px] items-center justify-end gap-1.5 text-[12px] font-bold tabular-nums">
              {/* Centered ± bar */}
              <div className="relative h-1 w-10 overflow-hidden rounded-[2px] bg-[#f2f2f4]">
                <div className="absolute -top-px -bottom-px left-1/2 w-px bg-[#86868b]" />
                <div
                  className="absolute top-0 bottom-0"
                  style={{
                    width: `${widthPct}%`,
                    background: fillColor,
                    [negative ? "right" : "left"]: "50%",
                  }}
                />
              </div>
              <span style={{ color: fillColor }}>
                {e.value > 0 ? "+" : ""}
                {e.value.toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
