"use client";

// ── Risk quadrant ──────────────────────────────────────────────────────
//
// Likelihood × Impact 2×2 chart. Every risk is placed by:
//   • X (likelihood) — normalized count of KG connections (proxy: more
//     connected = more likely to trigger).
//   • Y (impact)     — blast_radius from synthesis.
// Quadrants labelled Critical / Chronic / Black Swan / Minor so the reader
// can immediately separate "watch closely" from "just monitor."
//
// Pure SVG — simple scales, hover tooltip, click to select. No d3 runtime.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import type { RichRiskPoint } from "@/types/synthesis";
import { VizContainer } from "@/components/viz/viz-container";
import { DataStateLayer } from "@/components/viz/data-state";
import { CHART } from "@/components/viz/chart-theme";

interface Props {
  risks: RichRiskPoint[];
}

interface RiskPoint extends RichRiskPoint {
  likelihood: number; // 0..1
  impact: number;     // 0..1
}

const QUADRANT_META = {
  critical:  { label: "Critical",   color: "#DC2626", bg: "rgba(220,38,38,0.05)" },
  chronic:   { label: "Chronic",    color: "#D97706", bg: "rgba(217,119,6,0.05)" },
  blackSwan: { label: "Black Swan", color: "#7C3AED", bg: "rgba(124,58,237,0.05)" },
  minor:     { label: "Minor",      color: "#6B7280", bg: "rgba(107,114,128,0.04)" },
};

export function RiskQuadrant({ risks }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  // Normalize connections + blast_radius into 0..1 for plotting.
  const points = useMemo<RiskPoint[]>(() => {
    if (risks.length === 0) return [];
    const maxConnections = Math.max(1, ...risks.map((r) => (r.connections?.length ?? 0) || 0));
    const maxBlast = Math.max(1, ...risks.map((r) => r.blast_radius ?? 0));
    return risks.map((r) => ({
      ...r,
      likelihood: (r.connections?.length ?? 0) / maxConnections,
      impact: (r.blast_radius ?? 0) / maxBlast,
    }));
  }, [risks]);

  // Counts per quadrant — shown in the corner labels.
  const counts = useMemo(() => {
    const c = { critical: 0, chronic: 0, blackSwan: 0, minor: 0 };
    for (const p of points) {
      if (p.likelihood >= 0.5 && p.impact >= 0.5) c.critical++;
      else if (p.likelihood >= 0.5) c.chronic++;
      else if (p.impact >= 0.5) c.blackSwan++;
      else c.minor++;
    }
    return c;
  }, [points]);

  // Layout
  const W = 560;
  const H = 440;
  const PAD = { top: 28, right: 24, bottom: 44, left: 56 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xScale = (x: number) => PAD.left + x * plotW;
  const yScale = (y: number) => PAD.top + (1 - y) * plotH;

  const selectedPoint = points.find((p) => p.entity_id === selected) ?? null;

  return (
    <VizContainer
      icon={AlertTriangle}
      title="Risk landscape"
      subtitle={
        risks.length === 0
          ? "Risks show up here once synthesis identifies them."
          : `${risks.length} risk${risks.length === 1 ? "" : "s"} plotted by likelihood × impact. ${counts.critical} critical, ${counts.blackSwan} black-swan.`
      }
      minBodyHeight={460}
    >
      <DataStateLayer
        empty={risks.length === 0}
        emptyHint="No risks detected yet. Run synthesis to surface them."
      >
        <div className="flex flex-col lg:flex-row gap-4">
          <svg width={W} height={H} role="img" aria-label="Risk quadrant">
            {/* Quadrant backgrounds */}
            <rect
              x={xScale(0.5)} y={yScale(1)} width={plotW / 2} height={plotH / 2}
              fill={QUADRANT_META.critical.bg}
            />
            <rect
              x={xScale(0.5)} y={yScale(0.5)} width={plotW / 2} height={plotH / 2}
              fill={QUADRANT_META.chronic.bg}
            />
            <rect
              x={xScale(0)} y={yScale(1)} width={plotW / 2} height={plotH / 2}
              fill={QUADRANT_META.blackSwan.bg}
            />
            <rect
              x={xScale(0)} y={yScale(0.5)} width={plotW / 2} height={plotH / 2}
              fill={QUADRANT_META.minor.bg}
            />

            {/* Quadrant divider lines */}
            <line
              x1={xScale(0.5)} y1={PAD.top}
              x2={xScale(0.5)} y2={PAD.top + plotH}
              stroke="#D1D5DB" strokeDasharray="3 3" strokeWidth={1}
            />
            <line
              x1={PAD.left} y1={yScale(0.5)}
              x2={PAD.left + plotW} y2={yScale(0.5)}
              stroke="#D1D5DB" strokeDasharray="3 3" strokeWidth={1}
            />

            {/* Quadrant labels (corner badges) */}
            {[
              { key: "blackSwan", x: xScale(0.02), y: yScale(0.98), anchor: "start" as const },
              { key: "critical",  x: xScale(0.98), y: yScale(0.98), anchor: "end"   as const },
              { key: "minor",     x: xScale(0.02), y: yScale(0.02) + 10, anchor: "start" as const },
              { key: "chronic",   x: xScale(0.98), y: yScale(0.02) + 10, anchor: "end"   as const },
            ].map((q) => {
              const meta = QUADRANT_META[q.key as keyof typeof QUADRANT_META];
              const count = counts[q.key as keyof typeof counts];
              return (
                <g key={q.key}>
                  <text
                    x={q.x} y={q.y}
                    textAnchor={q.anchor}
                    fontSize={10}
                    fontWeight={700}
                    fill={meta.color}
                    opacity={0.7}
                    style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}
                  >
                    {meta.label} {count > 0 ? `· ${count}` : ""}
                  </text>
                </g>
              );
            })}

            {/* Plot frame */}
            <rect
              x={PAD.left} y={PAD.top}
              width={plotW} height={plotH}
              fill="none" stroke="#E5E7EB" strokeWidth={1}
            />

            {/* Axis labels */}
            <text
              x={PAD.left + plotW / 2} y={H - 12}
              textAnchor="middle" fontSize={11}
              fontWeight={600} fill={CHART.font.label.color}
            >
              Likelihood →
            </text>
            <text
              transform={`rotate(-90 16 ${PAD.top + plotH / 2})`}
              x={16} y={PAD.top + plotH / 2}
              textAnchor="middle" fontSize={11}
              fontWeight={600} fill={CHART.font.label.color}
            >
              Impact →
            </text>

            {/* Points — soft translucent fill with crisp ring, stagger-entrance */}
            {points.map((p, i) => {
              const isSel = selected === p.entity_id;
              const radius = 6 + p.impact * 8;
              const fill =
                p.likelihood >= 0.5 && p.impact >= 0.5 ? QUADRANT_META.critical.color
                : p.likelihood >= 0.5 ? QUADRANT_META.chronic.color
                : p.impact >= 0.5 ? QUADRANT_META.blackSwan.color
                : QUADRANT_META.minor.color;
              return (
                <motion.g
                  key={p.entity_id}
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    duration: 0.4,
                    delay: Math.min(i, 20) * 0.025,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  style={{ cursor: "pointer", transformBox: "fill-box", transformOrigin: "center" }}
                  onClick={() => setSelected(isSel ? null : p.entity_id)}
                >
                  {/* Outer halo on selection for depth */}
                  {isSel && (
                    <circle
                      cx={xScale(p.likelihood)} cy={yScale(p.impact)}
                      r={radius + 6}
                      fill={fill} fillOpacity={0.08}
                    />
                  )}
                  <circle
                    cx={xScale(p.likelihood)} cy={yScale(p.impact)}
                    r={radius}
                    fill={fill} fillOpacity={isSel ? 0.55 : 0.22}
                    stroke={fill}
                    strokeWidth={isSel ? 2 : 1.5}
                  >
                    <title>
                      {`${p.entity_name ?? p.entity_id}\nLikelihood ${Math.round(p.likelihood * 100)}% · Impact ${Math.round(p.impact * 100)}%\nBlast radius: ${p.blast_radius}`}
                    </title>
                  </circle>
                  {/* Label — only show on selection to avoid clutter. */}
                  {isSel && (
                    <text
                      x={xScale(p.likelihood)}
                      y={yScale(p.impact) - radius - 6}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      fill={fill}
                    >
                      {p.entity_name ?? p.entity_id}
                    </text>
                  )}
                </motion.g>
              );
            })}
          </svg>

          <aside className="flex-1 min-w-[240px] rounded-lg bg-white/60 ring-1 ring-black/5 p-3">
            {selectedPoint ? (
              <RiskDetail risk={selectedPoint} />
            ) : (
              <div className="text-[11px] text-gray-400 italic">
                Click a risk to inspect its failure modes and mitigation.
              </div>
            )}
          </aside>
        </div>
      </DataStateLayer>
    </VizContainer>
  );
}

function RiskDetail({ risk }: { risk: RiskPoint }) {
  return (
    <div className="space-y-2">
      <header>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
          Risk
        </p>
        <p className="text-[13px] font-semibold text-gray-900 leading-tight">
          {risk.entity_name ?? risk.entity_id}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Likelihood" value={`${Math.round(risk.likelihood * 100)}%`} />
        <Stat label="Impact" value={`${Math.round(risk.impact * 100)}%`} />
      </div>

      {risk.summary ? (
        <p className="text-[11.5px] text-gray-700 leading-relaxed">{risk.summary}</p>
      ) : null}

      {risk.how_it_fails?.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
            How it fails
          </p>
          <ul className="space-y-0.5">
            {risk.how_it_fails.slice(0, 4).map((f, i) => (
              <li key={i} className="text-[11px] text-gray-700 leading-snug">
                • {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {risk.mitigation?.primary && (
        <div className="rounded-md bg-emerald-50 ring-1 ring-emerald-100 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">
            Mitigation
          </p>
          <p className="text-[11px] text-emerald-900 leading-snug mt-0.5">
            {risk.mitigation.primary}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 px-2 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="text-[13px] font-mono text-gray-800 tabular-nums">{value}</p>
    </div>
  );
}
