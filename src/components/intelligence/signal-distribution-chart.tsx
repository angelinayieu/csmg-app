"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { LandscapeCluster } from "@/types/intelligence-v2";
import type { ExternalCategory } from "@/types/intelligence";
import { CATEGORY_CONFIG } from "@/types/intelligence";

// ── Default cluster colors (used when LLM clusters don't specify color) ──

const CLUSTER_COLORS = [
  "#007AFF", // blue
  "#5856D6", // indigo
  "#AF52DE", // purple
  "#FF9500", // orange
  "#34C759", // green
  "#FF3B30", // red
  "#0D9488", // teal
  "#E24B4A", // coral
];

// ── Chart data item ──

export interface ChartDataItem {
  key: string;
  label: string;
  value: number;      // normalized 0-1 for polygon
  count: number;      // raw count for legend
  percentage: number;  // display percentage
  color: string;
}

export interface SignalDistributionChartProps {
  /** Primary: LLM-generated semantic clusters */
  clusters?: LandscapeCluster[];
  /** Fallback: entity category counts */
  categoryBreakdown?: Record<string, number>;
  totalExternal?: number;
  size?: number;
  className?: string;
}

export function SignalDistributionChart({
  clusters,
  categoryBreakdown,
  totalExternal = 0,
  size = 280,
  className,
}: SignalDistributionChartProps) {
  const data: ChartDataItem[] = useMemo(() => {
    // Primary: use landscape clusters
    if (clusters && clusters.length >= 3) {
      return clusters.map((c, i) => ({
        key: c.id,
        label: c.label,
        value: c.signal_strength,
        count: c.entity_ids.length,
        percentage: Math.round(c.signal_strength * 100),
        color: c.color || CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      }));
    }

    // Fallback: use category breakdown
    if (categoryBreakdown) {
      const entries = Object.entries(categoryBreakdown)
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a);
      const maxCount = Math.max(...entries.map(([, c]) => c), 1);
      return entries.map(([cat, count], i) => {
        const config = CATEGORY_CONFIG[cat as ExternalCategory];
        return {
          key: cat,
          label: config?.label.split(" ")[0] ?? cat,
          value: count / maxCount,
          count,
          percentage:
            totalExternal > 0 ? Math.round((count / totalExternal) * 100) : 0,
          color: config?.stroke ?? CLUSTER_COLORS[i % CLUSTER_COLORS.length],
        };
      });
    }

    return [];
  }, [clusters, categoryBreakdown, totalExternal]);

  if (data.length < 3) return null;

  const n = data.length;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.38;
  const labelR = maxR + 20;
  const rings = 4;

  // Compute vertex positions for each ring level
  const getVertex = (index: number, radius: number) => {
    const angle = (2 * Math.PI * index) / n - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  };

  // Build polygon points string
  const polygonPoints = (radius: number) =>
    Array.from({ length: n }, (_, i) => getVertex(i, radius))
      .map((p) => `${p.x},${p.y}`)
      .join(" ");

  // Data polygon
  const dataPoints = data.map((d, i) => getVertex(i, d.value * maxR));
  const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">
            Signal distribution
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Coverage across intelligence clusters
          </p>
        </div>
      </div>

      {/* Chart + Legend layout */}
      <div className="flex items-center gap-6">
        {/* SVG Radar */}
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          className="flex-shrink-0"
          style={{ fontFamily: "-apple-system, system-ui, sans-serif" }}
        >
          <defs>
            <radialGradient id="radarDataFill" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#007AFF" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#007AFF" stopOpacity={0.08} />
            </radialGradient>
          </defs>

          {/* Grid rings */}
          {Array.from({ length: rings }, (_, i) => {
            const r = (maxR * (i + 1)) / rings;
            return (
              <polygon
                key={`ring-${i}`}
                points={polygonPoints(r)}
                fill="none"
                stroke="rgba(0,0,0,0.06)"
                strokeWidth={0.8}
              />
            );
          })}

          {/* Axis lines */}
          {Array.from({ length: n }, (_, i) => {
            const v = getVertex(i, maxR);
            return (
              <line
                key={`axis-${i}`}
                x1={cx}
                y1={cy}
                x2={v.x}
                y2={v.y}
                stroke="rgba(0,0,0,0.06)"
                strokeWidth={0.8}
              />
            );
          })}

          {/* Data polygon */}
          <polygon
            points={dataPolygon}
            fill="url(#radarDataFill)"
            stroke="#007AFF"
            strokeWidth={1.8}
            strokeLinejoin="round"
          />

          {/* Data points */}
          {dataPoints.map((p, i) => (
            <circle
              key={`point-${i}`}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={data[i].color}
              stroke="#fff"
              strokeWidth={2}
            />
          ))}

          {/* Axis labels */}
          {data.map((d, i) => {
            const lp = getVertex(i, labelR);
            const angle = (2 * Math.PI * i) / n - Math.PI / 2;
            const isLeft = Math.cos(angle) < -0.1;
            const isRight = Math.cos(angle) > 0.1;
            return (
              <text
                key={`label-${i}`}
                x={lp.x}
                y={lp.y}
                textAnchor={isLeft ? "end" : isRight ? "start" : "middle"}
                dominantBaseline={
                  Math.sin(angle) < -0.5 ? "auto" : "hanging"
                }
                fontSize={11}
                fontWeight={600}
                fill="#1d1d1f"
              >
                {d.label}
              </text>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="flex flex-col gap-2.5 min-w-[200px]">
          {data.map((d) => (
            <div
              key={d.key}
              className="flex items-center justify-between gap-3 rounded-xl bg-gray-50/60 px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ background: d.color }}
                />
                <span className="text-xs font-medium text-gray-900">
                  {d.label}
                </span>
              </div>
              <span className="text-xs font-semibold text-gray-500">
                {d.count}{" "}
                <span
                  className={cn(
                    "ml-0.5",
                    d.percentage >= 60
                      ? "text-green-600"
                      : d.percentage >= 40
                        ? "text-amber-600"
                        : "text-red-500"
                  )}
                >
                  {d.percentage}%
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
