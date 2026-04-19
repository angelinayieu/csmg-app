"use client";

import { cn } from "@/lib/utils";
import type { StackHealth, KnowledgeStackCounts } from "@/types/intelligence-v2";
import type { CoverageBreakdown } from "@/lib/hooks/use-intelligence-radar";
import { AllocationRadarChart } from "./allocation-radar-chart";

interface StackHealthPanelProps {
  health: StackHealth;
  counts: KnowledgeStackCounts;
  coverageBreakdown: CoverageBreakdown;
}

interface HealthCell {
  label: string;
  value: string;
  subtitle: string;
  ratio: number; // 0-1 for progress bar
  status: "good" | "warning" | "info";
}

function getStatus(value: number, thresholds: { good: number; warning: number }): "good" | "warning" | "info" {
  if (value >= thresholds.good) return "good";
  if (value >= thresholds.warning) return "warning";
  return "info";
}

const STATUS_COLORS = {
  good: "bg-green-400",
  warning: "bg-amber-400",
  info: "bg-blue-400",
};

const STATUS_TEXT = {
  good: "text-green-600",
  warning: "text-amber-600",
  info: "text-blue-600",
};

export function StackHealthPanel({ health, counts, coverageBreakdown }: StackHealthPanelProps) {
  const cells: HealthCell[] = [
    {
      label: "Source Diversity",
      value: health.source_diversity.toFixed(1),
      subtitle: `${counts.sources.total} unique sources across ${(coverageBreakdown.category_diversity * 7).toFixed(0)}/7 categories`,
      ratio: health.source_diversity / 10,
      status: getStatus(health.source_diversity / 10, { good: 0.6, warning: 0.3 }),
    },
    {
      label: "Avg Credibility",
      value: health.avg_credibility.toFixed(2),
      subtitle: `${counts.atoms.verified} verified of ${counts.atoms.total} atoms`,
      ratio: health.avg_credibility,
      status: getStatus(health.avg_credibility, { good: 0.6, warning: 0.3 }),
    },
    {
      label: "Connection Density",
      value: (health.connection_density * 100).toFixed(1) + "%",
      subtitle: `${counts.connections.typed} typed edges · ${counts.connections.floating} floating`,
      ratio: Math.min(1, health.connection_density * 10), // Scale for visibility
      status: getStatus(health.connection_density, { good: 0.03, warning: 0.01 }),
    },
    {
      label: "Insight Yield",
      value: health.insight_yield.toFixed(2),
      subtitle: `${counts.insights.total} insights from ${counts.atoms.total} atoms`,
      ratio: Math.min(1, health.insight_yield * 5), // Scale for visibility
      status: getStatus(health.insight_yield, { good: 0.1, warning: 0.03 }),
    },
  ];

  return (
    <div className="p-4">
      <div className="flex gap-4">
        {/* Left: Health metric grid */}
        <div className="flex-1">
          <div className="grid grid-cols-2 gap-2.5">
            {cells.map((cell) => (
              <div
                key={cell.label}
                className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 hover:border-gray-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                    {cell.label}
                  </p>
                  <span className={cn("text-[8px] font-medium rounded-full px-1.5 py-0.5", STATUS_TEXT[cell.status])}>
                    {cell.status === "good" ? "Healthy" : cell.status === "warning" ? "Needs attention" : "Building"}
                  </span>
                </div>
                <p className="mt-1 text-xl font-bold text-gray-800 tabular-nums leading-none">
                  {cell.value}
                </p>
                <p className="text-[10px] text-gray-400 mt-1">{cell.subtitle}</p>
                <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", STATUS_COLORS[cell.status])}
                    style={{ width: `${cell.ratio * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Allocation Radar Chart */}
        <div className="flex-shrink-0 w-[220px] hidden lg:block">
          <AllocationRadarChart
            counts={counts}
            coverageBreakdown={coverageBreakdown}
          />
        </div>
      </div>
    </div>
  );
}
