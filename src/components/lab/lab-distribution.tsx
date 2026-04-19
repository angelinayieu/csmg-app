"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  monteCarlo,
  throughput,
  type InstrumentParameters,
} from "@/lib/lab-formulas";

export interface LabDistributionProps {
  parameters: InstrumentParameters;
  /** Override sample count (default 200) */
  samples?: number;
}

// Monte Carlo throughput histogram. Re-samples whenever parameters change
// (debounced via a brief timer to avoid thrashing on slider drag).
export function LabDistribution({ parameters, samples = 200 }: LabDistributionProps) {
  const [stable, setStable] = useState<InstrumentParameters>(parameters);

  // Debounce parameter changes — gives slider drag a chance to settle
  // before recomputing 200 samples.
  useEffect(() => {
    const t = setTimeout(() => setStable(parameters), 120);
    return () => clearTimeout(t);
  }, [parameters]);

  const dist = useMemo(() => monteCarlo(stable, { samples }), [stable, samples]);
  const cur = useMemo(() => throughput(parameters), [parameters]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 320, h: 130 });
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = dims.w;
  const H = dims.h;
  const pad = { l: 26, r: 8, t: 10, b: 22 };
  const iw = Math.max(40, W - pad.l - pad.r);
  const ih = Math.max(40, H - pad.t - pad.b);
  const maxC = Math.max(1, ...dist.bins);
  const bw = iw / dist.binCount;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#10161f] px-3.5 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
          ◢ Outcome Distribution
        </span>
        <span className="text-[9px] text-[#475569]">
          MONTE CARLO · n={samples}
        </span>
      </div>

      <div
        ref={hostRef}
        className="flex-1 rounded-[2px] border border-[#94a3b8]/[0.08] bg-[#141b26]"
      >
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Vertical grid */}
          {[25, 50, 75].map((pct) => {
            const x = pad.l + (pct / 100) * iw;
            return (
              <line
                key={`vg-${pct}`}
                x1={x}
                y1={pad.t}
                x2={x}
                y2={pad.t + ih}
                stroke="#94a3b8"
                strokeOpacity={0.08}
                strokeWidth={0.5}
                strokeDasharray="2 3"
              />
            );
          })}

          {/* Bars */}
          {dist.bins.map((c, i) => {
            const h = (c / maxC) * ih;
            const x = pad.l + i * bw;
            const y = pad.t + ih - h;
            const pct = (i * 100) / dist.binCount;
            const col = pct < 33 ? "#f472b6" : pct < 66 ? "#fbbf24" : "#4ade80";
            return (
              <g key={`b-${i}`}>
                <rect
                  x={x + 0.5}
                  y={y}
                  width={Math.max(0, bw - 1)}
                  height={h}
                  fill={col}
                  opacity={0.75}
                  rx={1}
                />
                <rect
                  x={x + 0.5}
                  y={Math.max(pad.t, y - 0.5)}
                  width={Math.max(0, bw - 1)}
                  height={1}
                  fill={col}
                />
              </g>
            );
          })}

          {/* Current value marker */}
          {(() => {
            const cx = pad.l + (cur / 100) * iw;
            return (
              <g>
                <line
                  x1={cx}
                  y1={pad.t - 2}
                  x2={cx}
                  y2={pad.t + ih + 2}
                  stroke="#4ade80"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
                <polygon
                  points={`${cx - 3},${pad.t - 2} ${cx + 3},${pad.t - 2} ${cx},${pad.t + 2}`}
                  fill="#4ade80"
                />
              </g>
            );
          })()}

          {/* X axis labels */}
          {[0, 25, 50, 75, 100].map((v) => {
            const x = pad.l + (v / 100) * iw;
            return (
              <text
                key={`xl-${v}`}
                x={x}
                y={H - 6}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize="8"
                fill="#64748b"
              >
                {v}
              </text>
            );
          })}
          <text
            x={pad.l - 4}
            y={pad.t + 6}
            textAnchor="end"
            fontFamily="monospace"
            fontSize="8"
            fill="#64748b"
          >
            n
          </text>
        </svg>
      </div>

      {/* Stats row */}
      <div className="mt-2 grid grid-cols-4 gap-2 font-mono text-[9px]">
        <Stat k="μ" v={dist.mean.toFixed(0)} u="%" />
        <Stat k="med" v={dist.median.toFixed(0)} u="%" />
        <Stat k="p10" v={dist.p10.toFixed(0)} u="%" accent="#f472b6" />
        <Stat k="p90" v={dist.p90.toFixed(0)} u="%" accent="#4ade80" />
      </div>
    </div>
  );
}

function Stat({
  k,
  v,
  u,
  accent,
}: {
  k: string;
  v: string;
  u: string;
  accent?: string;
}) {
  return (
    <div className="rounded-[1px] border border-[#94a3b8]/[0.08] bg-[#141b26] px-1.5 py-1 text-center">
      <div className="text-[8px] uppercase tracking-widest text-[#64748b]">{k}</div>
      <div className="text-[12px] font-semibold tabular-nums" style={{ color: accent ?? "#e8edf4" }}>
        {v}
        <span className="ml-0.5 text-[8px] text-[#64748b]">{u}</span>
      </div>
    </div>
  );
}
