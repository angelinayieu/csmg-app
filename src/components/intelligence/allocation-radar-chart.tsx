"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { KnowledgeStackCounts } from "@/types/intelligence-v2";
import type { CoverageBreakdown } from "@/lib/hooks/use-intelligence-radar";

export interface RadarAxis {
  key: string;
  label: string;
  /** 0-1 current value */
  current: number;
  /** 0-1 target value (dashed target polygon) */
  target?: number;
  /** 0-1 agent-proposed value (dashed proposed polygon) */
  proposed?: number;
}

export type RadarMode = "allocation" | "uncertainty" | "coverage";

interface AllocationRadarChartProps {
  /** Legacy props — used when `axes` is not provided */
  counts?: KnowledgeStackCounts;
  coverageBreakdown?: CoverageBreakdown;
  /** New dynamic axes — overrides legacy derivation when provided */
  axes?: RadarAxis[];
  /** Show mode tabs: Allocation | Uncertainty | Coverage */
  showModeTabs?: boolean;
  /** Per-mode axes (overrides `axes` for each tab) */
  axesByMode?: Record<RadarMode, RadarAxis[]>;
  /** Custom title; defaults to "Allocation map" */
  title?: string;
  /** Optional subtitle */
  subtitle?: string;
  className?: string;
}

function polarToXY(angle: number, radius: number, cx: number, cy: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

// Angle-aware text anchor to prevent label collisions
function anchorForAngle(angle: number): "start" | "middle" | "end" {
  const a = ((angle % 360) + 360) % 360;
  if (a > 10 && a < 170) return "start";
  if (a > 190 && a < 350) return "end";
  return "middle";
}

export function AllocationRadarChart({
  counts,
  coverageBreakdown,
  axes,
  showModeTabs = false,
  axesByMode,
  title = "Allocation Radar",
  subtitle,
  className,
}: AllocationRadarChartProps) {
  const [mode, setMode] = useState<RadarMode>("allocation");

  // Derive axes: prefer explicit axesByMode, then axes prop, then fallback to legacy counts
  const effectiveAxes: RadarAxis[] = useMemo(() => {
    if (axesByMode?.[mode]) return axesByMode[mode];
    if (axes) return axes;

    // Legacy fallback — 6 hardcoded axes from counts + coverageBreakdown
    if (counts && coverageBreakdown) {
      const values = {
        sources: Math.min(1, counts.sources.total / 50),
        atoms: Math.min(1, counts.atoms.total / 100),
        connections: Math.min(1, counts.connections.typed / 50),
        insights: Math.min(1, counts.insights.total / 20),
        bridges: coverageBreakdown.bridge_coverage,
        diversity: coverageBreakdown.category_diversity,
      };
      return [
        { key: "sources",     label: "Sources",     current: values.sources,     target: Math.min(1, values.sources * 1.3 + 0.1) },
        { key: "atoms",       label: "Atoms",       current: values.atoms,       target: Math.min(1, values.atoms * 1.2 + 0.1) },
        { key: "connections", label: "Connections", current: values.connections, target: Math.min(1, values.connections * 1.4 + 0.15) },
        { key: "insights",    label: "Insights",    current: values.insights,    target: Math.min(1, values.insights * 1.5 + 0.1) },
        { key: "bridges",     label: "Bridges",     current: values.bridges,     target: Math.min(1, values.bridges * 1.3 + 0.1) },
        { key: "diversity",   label: "Diversity",   current: values.diversity,   target: Math.min(1, values.diversity * 1.2 + 0.1) },
      ];
    }

    return [];
  }, [axes, axesByMode, mode, counts, coverageBreakdown]);

  const n = Math.max(3, effectiveAxes.length);
  const angleStep = 360 / n;

  // Auto-size viewBox to prevent label crowding
  const size = Math.max(220, 140 + n * 14);
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.36;
  const labelR = maxR + Math.max(18, n * 2);

  const rings = [0.25, 0.5, 0.75, 1.0];

  // Build polygon paths
  const currentPoints = effectiveAxes.map((axis, i) =>
    polarToXY(i * angleStep, Math.max(0, Math.min(1, axis.current)) * maxR, cx, cy),
  );
  const targetPoints = effectiveAxes.map((axis, i) =>
    polarToXY(i * angleStep, Math.max(0, Math.min(1, axis.target ?? 0)) * maxR, cx, cy),
  );
  const proposedPoints = effectiveAxes.map((axis, i) =>
    polarToXY(i * angleStep, Math.max(0, Math.min(1, axis.proposed ?? 0)) * maxR, cx, cy),
  );

  const hasTarget = effectiveAxes.some((a) => a.target !== undefined);
  const hasProposed = effectiveAxes.some((a) => a.proposed !== undefined);

  const currentPath = currentPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const targetPath = targetPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const proposedPath = proposedPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header + mode tabs */}
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-[13px] font-semibold text-gray-900">
              {subtitle}
            </div>
          )}
        </div>
        {showModeTabs && (
          <div className="flex gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {(["allocation", "uncertainty", "coverage"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[10px] font-semibold capitalize transition-all",
                  mode === m
                    ? "bg-white text-[#007AFF] shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {effectiveAxes.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center text-xs text-gray-400">
          No data to render radar
        </div>
      ) : (
        <>
          <div className="flex items-center justify-center">
            <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-md">
              {/* Background rings */}
              {rings.map((ring) => (
                <polygon
                  key={ring}
                  points={effectiveAxes
                    .map((_, i) => {
                      const p = polarToXY(i * angleStep, ring * maxR, cx, cy);
                      return `${p.x},${p.y}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="#E5E7EB"
                  strokeWidth="0.5"
                />
              ))}

              {/* Axis lines */}
              {effectiveAxes.map((_, i) => {
                const end = polarToXY(i * angleStep, maxR, cx, cy);
                return (
                  <line
                    key={i}
                    x1={cx}
                    y1={cy}
                    x2={end.x}
                    y2={end.y}
                    stroke="#E5E7EB"
                    strokeWidth="0.5"
                  />
                );
              })}

              {/* Target polygon (dashed) */}
              {hasTarget && (
                <polygon
                  points={targetPath}
                  fill="rgba(0, 122, 255, 0.04)"
                  stroke="#93C5FD"
                  strokeWidth="1"
                  strokeDasharray="3 2"
                />
              )}

              {/* Proposed polygon (agent-proposed, dashed in a different blue) */}
              {hasProposed && (
                <polygon
                  points={proposedPath}
                  fill="rgba(0, 122, 255, 0.08)"
                  stroke="#007AFF"
                  strokeWidth="1.3"
                  strokeDasharray="5 3"
                  opacity={0.8}
                />
              )}

              {/* Current polygon */}
              <polygon
                points={currentPath}
                fill="rgba(0, 122, 255, 0.18)"
                stroke="#007AFF"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />

              {/* Data points */}
              {currentPoints.map((p, i) => (
                <circle
                  key={effectiveAxes[i].key}
                  cx={p.x}
                  cy={p.y}
                  r="2.5"
                  fill="#007AFF"
                  stroke="white"
                  strokeWidth="1"
                />
              ))}

              {/* Axis labels */}
              {effectiveAxes.map((axis, i) => {
                const angle = i * angleStep;
                const p = polarToXY(angle, labelR, cx, cy);
                const val = axis.current;
                return (
                  <text
                    key={axis.key}
                    x={p.x}
                    y={p.y}
                    textAnchor={anchorForAngle(angle)}
                    dominantBaseline="middle"
                    className="text-[10px] font-medium"
                    fill={val < 0.3 ? "#F59E0B" : "#6B7280"}
                  >
                    {axis.label}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* Legend */}
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-gray-500">
            <LegendItem color="#007AFF" label="Current" />
            {hasProposed && (
              <LegendItem color="#007AFF" dashed label="Agent-proposed" />
            )}
            {hasTarget && (
              <LegendItem color="#93C5FD" dashed label="Target" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LegendItem({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "h-0.5 w-5 rounded",
          dashed && "border-b border-dashed bg-transparent",
        )}
        style={dashed ? { borderColor: color, borderWidth: 1 } : { background: color }}
      />
      <span>{label}</span>
    </div>
  );
}
