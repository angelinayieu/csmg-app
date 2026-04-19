"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { KGMetricsSnapshotRow } from "@/types/loop-metrics";

interface StackHealthChartProps {
  snapshots: KGMetricsSnapshotRow[];
}

const METRICS = [
  {
    key: "source_diversity",
    label: "Source Diversity",
    max: 10,
    good: 3,
    format: (v: number) => v.toFixed(1),
    color: "bg-blue-500",
    bgColor: "bg-blue-100",
  },
  {
    key: "avg_credibility",
    label: "Avg Credibility",
    max: 1,
    good: 0.5,
    format: (v: number) => `${Math.round(v * 100)}%`,
    color: "bg-green-500",
    bgColor: "bg-green-100",
  },
  {
    key: "connection_density",
    label: "Connection Density",
    max: 1,
    good: 0.3,
    format: (v: number) => `${Math.round(v * 100)}%`,
    color: "bg-amber-500",
    bgColor: "bg-amber-100",
  },
  {
    key: "insight_yield",
    label: "Insight Yield",
    max: 1,
    good: 0.15,
    format: (v: number) => v.toFixed(2),
    color: "bg-purple-500",
    bgColor: "bg-purple-100",
  },
] as const;

export function StackHealthChart({ snapshots }: StackHealthChartProps) {
  const latest = snapshots.length > 0
    ? snapshots[snapshots.length - 1].metrics.stack_health
    : null;

  // Compute sparkline data for each metric
  const sparklines = useMemo(() => {
    if (snapshots.length < 2) return null;
    const result: Record<string, number[]> = {};
    for (const m of METRICS) {
      result[m.key] = snapshots.map(
        (s) => (s.metrics.stack_health as unknown as Record<string, number>)?.[m.key] ?? 0
      );
    }
    return result;
  }, [snapshots]);

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
      <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 mb-1">
        Stack Health Trajectory
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Knowledge pipeline health dimensions over research cycles
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {METRICS.map((m) => {
          const value = latest
            ? (latest as unknown as Record<string, number>)[m.key] ?? 0
            : 0;
          const pct = Math.min(100, (value / m.max) * 100);
          const isGood = value >= m.good;
          const data = sparklines?.[m.key];

          return (
            <div
              key={m.key}
              className="rounded-xl border border-gray-100 bg-gray-50/50 p-3"
            >
              <div className="text-[11px] font-medium text-gray-500 mb-1">
                {m.label}
              </div>
              <div className="text-lg font-semibold text-gray-900 mb-2">
                {m.format(value)}
              </div>

              {/* Mini sparkline */}
              {data && data.length >= 2 && (
                <Sparkline data={data} max={m.max} color={m.color} />
              )}

              {/* Progress bar */}
              <div className={cn("mt-2 h-1.5 rounded-full", m.bgColor)}>
                <div
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    isGood ? m.color : "bg-gray-300"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 text-[9px] text-gray-400">
                {isGood ? "Good" : "Below threshold"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sparkline({
  data,
  max,
  color,
}: {
  data: number[];
  max: number;
  color: string;
}) {
  const w = 100;
  const h = 24;
  const points = data.map((v, i) => ({
    x: (i / Math.max(1, data.length - 1)) * w,
    y: h - (Math.min(v, max) / max) * h,
  }));
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  // Map Tailwind class to hex for SVG stroke
  const colorMap: Record<string, string> = {
    "bg-blue-500": "#3B82F6",
    "bg-green-500": "#22C55E",
    "bg-amber-500": "#F59E0B",
    "bg-purple-500": "#A855F7",
  };

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 24 }}>
      <path
        d={pathD}
        fill="none"
        stroke={colorMap[color] ?? "#6B7280"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
