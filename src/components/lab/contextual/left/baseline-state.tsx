"use client";

// ── Baseline State (left rail) ────────────────────────────────────
//
// 5 sliders — Sleep, Time on task, Stress, Caffeine, Time of day.
// Color-tinted thumb when a slider crosses its warn / alert thresholds
// (e.g. sleep < 6h → orange, < 4h → red).

import { STATE_DEFS } from "../lib/state-defs";
import type { StateBag, StateKey } from "../lib/types";

export interface BaselineStateProps {
  stateBag: StateBag;
  onChange: (key: StateKey, value: number) => void;
}

export function BaselineState({ stateBag, onChange }: BaselineStateProps) {
  return (
    <div className="border-b border-black/[0.05] p-4">
      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
        State
      </div>
      <div className="space-y-1">
        {STATE_DEFS.map((def) => {
          const v = stateBag[def.id];
          const isAlert = def.alert?.(v) ?? false;
          const isWarn = def.warn?.(v) ?? false;
          const tone: "alert" | "warn" | "" = isAlert
            ? "alert"
            : isWarn
              ? "warn"
              : "";
          const valueColor =
            tone === "alert"
              ? "#ff3b30"
              : tone === "warn"
                ? "#ff9500"
                : "#1d1d1f";
          const thumbBorder =
            tone === "alert"
              ? "#ff3b30"
              : tone === "warn"
                ? "#ff9500"
                : "#86868b";

          return (
            <div
              key={def.id}
              className="grid items-center gap-2.5 py-1 text-[12px]"
              style={{ gridTemplateColumns: "80px 1fr 48px" }}
            >
              <div className="flex flex-col leading-[1.2]">
                <span className="text-[11px] font-semibold text-[#424245]">
                  {def.label}
                </span>
                <span className="mt-px text-[9px] font-medium uppercase tracking-[0.04em] text-[#86868b]">
                  {def.sub}
                </span>
              </div>
              <input
                type="range"
                min={def.min}
                max={def.max}
                step={def.step}
                value={v}
                onChange={(e) => onChange(def.id, parseFloat(e.target.value))}
                className="contextual-lab-range"
                style={
                  {
                    // CSS variable consumed by the global range thumb style.
                    // We emit it via a data attribute style override below.
                    "--thumb-border": thumbBorder,
                  } as React.CSSProperties
                }
              />
              <div
                className="text-right text-[12px] font-bold tabular-nums"
                style={{ color: valueColor }}
              >
                {def.fmt(v)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Range thumb styling — the reference uses a clean
          minimal-thumb look; we approximate with a global style block
          scoped to .contextual-lab-range. */}
      <style jsx>{`
        .contextual-lab-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          background: #f2f2f4;
          border-radius: 2px;
          outline: none;
        }
        .contextual-lab-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ffffff;
          border: 1px solid var(--thumb-border, #86868b);
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.04),
            0 1px 3px rgba(0, 0, 0, 0.05);
          cursor: pointer;
        }
        .contextual-lab-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ffffff;
          border: 1px solid var(--thumb-border, #86868b);
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.04),
            0 1px 3px rgba(0, 0, 0, 0.05);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
