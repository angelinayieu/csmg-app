"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Entity, Edge } from "@/types";

export interface LabChamberSpectrumProps {
  focal: Entity;
  subunits: Entity[];
  /** All edges touching the focal (already filtered by the loader) */
  edges: Edge[];
}

// A synthetic emission spectrum derived from the entity's internal
// structure + bond network. Each element (subunit or bond) contributes a
// Gaussian peak at a frequency that encodes its depth/dimension and an
// intensity that encodes its weight/strength. This is a visual signature,
// not a physical measurement — but it gives the user a glanceable way to
// compare "how does this entity's spectral fingerprint differ from its
// siblings?"

interface Peak {
  freq: number; // Hz
  intensity: number; // 0..1
  label: string;
  color: string;
}

const CATEGORY_COLOR: Record<string, string> = {
  concrete: "#4ade80",
  abstract: "#a78bfa",
  process: "#fbbf24",
  relational: "#22d3ee",
  epistemic: "#f472b6",
  fault: "#ef4444",
};

const DIMENSION_FREQ: Record<string, number> = {
  structural: 3,
  functional: 6,
  temporal: 9,
  causal: 12,
  correlational: 15,
  logical: 18,
  epistemic: 21,
  comparative: 24,
  agentive: 27,
};

const DIMENSION_COLOR: Record<string, string> = {
  structural: "#4ade80",
  functional: "#22d3ee",
  temporal: "#a78bfa",
  causal: "#ef4444",
  correlational: "#fbbf24",
  logical: "#94a3b8",
  epistemic: "#f472b6",
  comparative: "#60a5fa",
  agentive: "#fb923c",
};

function peaksFromSubunits(subunits: Entity[]): Peak[] {
  // Each subunit → a peak at freq = 4 + i*2.5 (subunits cluster in the
  // 4-16Hz band). Intensity = confidence.
  return subunits.slice(0, 8).map((s, i) => {
    const cat = (s.entity_category as string) ?? "concrete";
    return {
      freq: 4 + i * 2.5,
      intensity: Math.min(1, (s.confidence as number | null) ?? 0.7),
      label: s.name.length > 16 ? s.name.slice(0, 16) + "…" : s.name,
      color: CATEGORY_COLOR[cat] ?? "#4ade80",
    };
  });
}

function peaksFromEdges(edges: Edge[]): Peak[] {
  // Each edge contributes a peak at dimension-specific freq. Intensity
  // scales with strength.
  return edges.slice(0, 12).map((e) => {
    const dim = (e.dimension as string) ?? "functional";
    return {
      freq: DIMENSION_FREQ[dim] ?? 10,
      intensity: Math.max(0.15, Math.min(1, (e.strength as number | null) ?? 0.5)),
      label: dim,
      color: DIMENSION_COLOR[dim] ?? "#94a3b8",
    };
  });
}

export function LabChamberSpectrum({ focal, subunits, edges }: LabChamberSpectrumProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setDims({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const peaks = useMemo<Peak[]>(() => {
    return [...peaksFromSubunits(subunits), ...peaksFromEdges(edges)].sort(
      (a, b) => a.freq - b.freq,
    );
  }, [subunits, edges]);

  const W = dims.w;
  const H = dims.h;
  const pad = { l: 80, r: 48, t: 60, b: 72 };
  const iw = Math.max(100, W - pad.l - pad.r);
  const ih = Math.max(100, H - pad.t - pad.b);
  const MAX_FREQ = 32;

  // Composite envelope = sum of gaussians
  const envelopePath = useMemo(() => {
    if (peaks.length === 0 || iw <= 0) return "";
    const samples = Math.max(200, Math.floor(iw / 2));
    const pts: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const f = (i / samples) * MAX_FREQ;
      let y = 0;
      for (const p of peaks) {
        const sigma = 1.2;
        y += p.intensity * Math.exp(-Math.pow(f - p.freq, 2) / (2 * sigma * sigma));
      }
      y = Math.min(1, y);
      const px = pad.l + (f / MAX_FREQ) * iw;
      const py = pad.t + ih - y * ih;
      pts.push((i === 0 ? "M" : "L") + px.toFixed(2) + "," + py.toFixed(2));
    }
    return pts.join(" ");
  }, [peaks, iw, ih, pad.l, pad.t]);

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden bg-[var(--lab-bg)]"
    >
      {/* HUD */}
      <div className="pointer-events-none absolute left-5 top-5 text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        <div className="mb-1 flex gap-2.5">
          <span>VIEW</span>
          <b className="font-medium text-[var(--lab-text)]">SPECTRUM</b>
        </div>
        <div className="mb-1 flex gap-2.5">
          <span>MODE</span>
          <b className="font-medium text-[var(--lab-text)]">SPECTRUM</b>
        </div>
        <div className="flex gap-2.5">
          <span>PEAKS</span>
          <b className="font-medium text-[var(--lab-text)]">{peaks.length}</b>
        </div>
      </div>

      <div className="pointer-events-none absolute right-5 top-5 text-right text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        <div className="text-[var(--lab-text-mid)]">
          FREQ (Hz) → STRENGTH (%) · <span className="text-[var(--lab-text)]">{focal.name.length > 32 ? focal.name.slice(0, 32) + "…" : focal.name}</span>
        </div>
      </div>

      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          <linearGradient id="spec-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Vertical grid + freq labels */}
        {Array.from({ length: MAX_FREQ / 2 + 1 }, (_, i) => i * 2).map((f) => {
          const x = pad.l + (f / MAX_FREQ) * iw;
          const major = f % 4 === 0;
          return (
            <g key={`vgrid-${f}`}>
              <line
                x1={x}
                y1={pad.t}
                x2={x}
                y2={pad.t + ih}
                stroke="#94a3b8"
                strokeOpacity={major ? 0.08 : 0.04}
                strokeWidth={0.5}
              />
              {major && (
                <text
                  x={x}
                  y={pad.t + ih + 18}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {f}
                </text>
              )}
            </g>
          );
        })}

        {/* Horizontal grid + %-labels */}
        {[0, 20, 40, 60, 80, 100].map((v) => {
          const y = pad.t + ih - (v / 100) * ih;
          return (
            <g key={`hgrid-${v}`}>
              <line
                x1={pad.l}
                y1={y}
                x2={pad.l + iw}
                y2={y}
                stroke="#94a3b8"
                strokeOpacity={0.06}
                strokeWidth={0.5}
              />
              <text
                x={pad.l - 10}
                y={y + 4}
                textAnchor="end"
                fill="#64748b"
                fontSize="10"
                fontFamily="monospace"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Frame */}
        <rect
          x={pad.l}
          y={pad.t}
          width={iw}
          height={ih}
          fill="none"
          stroke="#94a3b8"
          strokeOpacity={0.15}
          strokeWidth={1}
        />

        {/* Envelope fill */}
        {envelopePath && (
          <>
            <path
              d={`${envelopePath} L${pad.l + iw},${pad.t + ih} L${pad.l},${pad.t + ih} Z`}
              fill="url(#spec-fill)"
            />
            <path
              d={envelopePath}
              fill="none"
              stroke="#4ade80"
              strokeWidth={1.8}
              style={{ filter: "drop-shadow(0 0 6px rgba(74,222,128,0.55))" }}
            />
          </>
        )}

        {/* Peak markers — stagger labels up/down to avoid collisions */}
        {peaks.map((p, i) => {
          const x = pad.l + (p.freq / MAX_FREQ) * iw;
          const y = pad.t + ih - p.intensity * ih;
          const labelDy = i % 2 === 0 ? -14 : -26;
          return (
            <g key={`peak-${i}`}>
              <line
                x1={x}
                y1={y - 3}
                x2={x}
                y2={pad.t + ih}
                stroke={p.color}
                strokeOpacity={0.45}
                strokeDasharray="2 3"
                strokeWidth={0.8}
              />
              <circle cx={x} cy={y} r={4} fill={p.color} stroke="#02050a" strokeWidth={1.5} />
              <text
                x={x}
                y={y + labelDy}
                textAnchor="middle"
                fill={p.color}
                fontSize="10"
                fontWeight="700"
                style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
              >
                {p.label}
              </text>
              <text
                x={x}
                y={y + labelDy + 12}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="9"
                style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
              >
                {p.freq.toFixed(0)}Hz · {(p.intensity * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* Axis titles */}
        <text
          x={pad.l + iw / 2}
          y={H - 12}
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="10"
          fontWeight="700"
          letterSpacing="0.14em"
        >
          FREQUENCY · Hz
        </text>
        <text
          x={16}
          y={pad.t + ih / 2}
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="10"
          fontWeight="700"
          letterSpacing="0.14em"
          transform={`rotate(-90, 16, ${pad.t + ih / 2})`}
        >
          EMISSION · %
        </text>
      </svg>

      {peaks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-[3px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-bg)] px-4 py-3 text-center text-[11px] text-[var(--lab-text-mid)]">
            No peaks yet — decompose this entity (add subunits) or connect it via bonds to synthesize a signature.
          </div>
        </div>
      )}
    </div>
  );
}
