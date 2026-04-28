"use client";

// ── Outcome Distribution (bottom-center) ─────────────────────────
//
// 200-draw Monte Carlo sampling from the archetype distribution
// (perturbing K/τ/ρ/α by their σ each draw), evaluated through
// `predict()`. Results binned into a 22-bin histogram across K=0..7.
//
// Bars colored:
//   green  if bin center ≥ task.demand           (success region)
//   orange if bin center ≥ task.demand × 0.75    (borderline)
//   red    otherwise                              (failure region)
//
// Demand line drawn as a vertical dashed marker.

import { useMemo, useEffect, useState } from "react";
import type { Archetype, StateBag, Task } from "../lib/types";
import { predict, sampleFromArchetype } from "../lib/predict";

const N_DRAWS = 200;
const BINS = 22;
const K_MIN = 0;
const K_MAX = 7;

export interface OutcomeDistributionProps {
  subject: Archetype;
  state: StateBag;
  task: Task;
}

export function OutcomeDistribution({
  subject,
  state,
  task,
}: OutcomeDistributionProps) {
  // Re-sample whenever the configuration changes. Use a counter to
  // also let users force a resample (future "shuffle" affordance).
  const [shuffleSeed, setShuffleSeed] = useState(0);

  // Seed-bind so React re-runs the memo on dep change.
  useEffect(() => {
    setShuffleSeed((s) => s + 1);
  }, [subject.id, state.sleep, state.tot, state.stress, state.caffeine, state.timeOfDay, task.id]);

  const samples = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < N_DRAWS; i++) {
      const sample = sampleFromArchetype(subject);
      const p = predict(sample, state, task);
      out.push(p.K);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffleSeed]);

  const counts = useMemo(() => {
    const c = new Array(BINS).fill(0);
    for (const v of samples) {
      const idx = Math.max(
        0,
        Math.min(BINS - 1, Math.floor(((v - K_MIN) / (K_MAX - K_MIN)) * BINS)),
      );
      c[idx]++;
    }
    return c;
  }, [samples]);

  const maxCount = Math.max(...counts, 1);

  // SVG dimensions chosen so it scales fluidly inside the bot-section.
  const width = 460;
  const height = 130;
  const pad = { l: 28, r: 10, t: 14, b: 22 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const binWidth = iw / BINS;

  const demandX = pad.l + ((task.demand - K_MIN) / (K_MAX - K_MIN)) * iw;

  return (
    <div className="flex flex-col overflow-hidden bg-white p-3 px-4">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
          Outcome Distribution
        </div>
        <div className="text-[11px] font-medium text-[#86868b]">
          Monte Carlo · {N_DRAWS} draws
        </div>
      </div>

      <div className="flex-1 rounded-md border border-black/[0.05] bg-[#fbfbfd] p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-full w-full"
        >
          {/* Demand vertical dashed marker */}
          <line
            x1={demandX}
            y1={pad.t}
            x2={demandX}
            y2={pad.t + ih}
            stroke="#1d1d1f"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            opacity="0.6"
          />
          <text
            x={demandX}
            y={pad.t + 8}
            textAnchor="middle"
            fontFamily="Arial"
            fontSize="9"
            fill="#424245"
            fontWeight="600"
          >
            demand
          </text>

          {/* Bars */}
          {counts.map((cnt, i) => {
            const h = (cnt / maxCount) * ih;
            const x = pad.l + i * binWidth;
            const y = pad.t + ih - h;
            const binCenter =
              K_MIN + ((i + 0.5) / BINS) * (K_MAX - K_MIN);
            const color =
              binCenter >= task.demand
                ? "#34c759"
                : binCenter >= task.demand * 0.75
                  ? "#ff9500"
                  : "#ff375f";
            return (
              <rect
                key={i}
                x={x + 0.5}
                y={y}
                width={Math.max(0, binWidth - 1)}
                height={Math.max(0, h)}
                fill={color}
                opacity="0.85"
                rx="2"
              />
            );
          })}

          {/* X-axis K labels */}
          {[0, 2, 4, 6].map((v) => {
            const x = pad.l + (v / K_MAX) * iw;
            return (
              <text
                key={v}
                x={x}
                y={height - 6}
                textAnchor="middle"
                fontFamily="Arial"
                fontSize="9"
                fill="#86868b"
              >
                K={v}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
