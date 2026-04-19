"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { nodeColors } from "@/lib/design-tokens";
import type { ConvergenceInsight, ConvergenceDepth } from "@/types/interactions";

interface ConvergenceGalleryProps {
  convergences: ConvergenceInsight[];
}

const DEPTH_CONFIG: Record<ConvergenceDepth, {
  color: string;
  bg: string;
  border: string;
  badge: string;
  label: string;
  valueLabel: string;
}> = {
  L4: {
    color: "#007AFF",
    bg: "rgba(0, 122, 255, 0.04)",
    border: "rgba(0, 122, 255, 0.25)",
    badge: "#007AFF",
    label: "L4 INVARIANT",
    valueLabel: "First-principle — highest structural value",
  },
  L3: {
    color: "#F59E0B",
    bg: "rgba(245, 158, 11, 0.04)",
    border: "rgba(245, 158, 11, 0.25)",
    badge: "#F59E0B",
    label: "L3 LOGIC",
    valueLabel: "Shared logical fundamental",
  },
  L2: {
    color: "#8B5CF6",
    bg: "rgba(139, 92, 246, 0.04)",
    border: "rgba(139, 92, 246, 0.25)",
    badge: "#8B5CF6",
    label: "L2 METHOD",
    valueLabel: "Shared causal mechanism",
  },
  L1: {
    color: "#6B7280",
    bg: "rgba(107, 114, 128, 0.03)",
    border: "rgba(107, 114, 128, 0.2)",
    badge: "#6B7280",
    label: "L1 OUTCOME",
    valueLabel: "Shared outcome — most common",
  },
};

function getCategoryColor(category: string): string {
  return (nodeColors as Record<string, { fill: string; stroke: string }>)[category]?.fill ?? "#6B7280";
}

function ConvergenceCard({ insight }: { insight: ConvergenceInsight }) {
  const [expanded, setExpanded] = useState(false);
  const config = DEPTH_CONFIG[insight.depth];
  const isHero = insight.depth === "L4";

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition-all",
        isHero ? "col-span-2" : ""
      )}
      style={{
        borderColor: config.border,
        background: config.bg,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider text-white"
          style={{ background: config.badge }}
        >
          {config.label}
        </span>
        <span className="text-xs font-medium text-gray-500">
          {config.valueLabel}
        </span>
        <span className="ml-auto text-[10px] font-semibold text-gray-400">
          {Math.round(insight.structural_value * 100)}% structural value
        </span>
      </div>

      {/* Branches + Shared Element visualization */}
      <div className="px-4 pb-4">
        {/* Converging branches */}
        <div className={cn(
          "grid gap-3 mb-3",
          insight.converging_branches.length <= 2 ? "grid-cols-2" : "grid-cols-3"
        )}>
          {insight.converging_branches.map((branch, i) => (
            <div
              key={branch.entity_id}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: getCategoryColor(branch.category) }}
                />
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                  {branch.category}
                </span>
              </div>
              <p className="text-xs font-semibold text-gray-800 leading-tight">
                {branch.name}
              </p>
            </div>
          ))}
        </div>

        {/* Convergence indicator */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px" style={{ background: config.border }} />
          <span
            className="shrink-0 rounded-full px-3 py-1 text-[10px] font-bold text-white"
            style={{ background: config.badge }}
          >
            CONVERGES AT {insight.depth}
          </span>
          <div className="flex-1 h-px" style={{ background: config.border }} />
        </div>

        {/* Shared element card */}
        <div
          className="rounded-lg border-2 bg-white p-3"
          style={{ borderColor: config.color }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
              style={{ background: config.badge }}
            >
              {insight.depth_label.toUpperCase()}
            </span>
            <span className="text-[10px] text-gray-400 font-medium">
              shared element &middot; {insight.shared_element.category}
            </span>
          </div>
          <p className="text-sm font-bold text-gray-900">
            {insight.shared_element.name}
          </p>
        </div>

        {/* Explanation (expandable) */}
        {insight.explanation && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 text-[11px] text-gray-500 hover:text-gray-700 font-medium transition-colors"
          >
            {expanded ? "Hide reasoning" : "Why this matters"}
          </button>
        )}
        {expanded && (
          <p className="mt-1.5 text-xs text-gray-600 leading-relaxed">
            {insight.explanation}
          </p>
        )}
      </div>
    </div>
  );
}

export function ConvergenceGallery({ convergences }: ConvergenceGalleryProps) {
  const [activeFilter, setActiveFilter] = useState<ConvergenceDepth | "all">("all");

  if (convergences.length === 0) return null;

  const filtered = activeFilter === "all"
    ? convergences
    : convergences.filter(c => c.depth === activeFilter);

  // Count by depth
  const countByDepth: Record<string, number> = {};
  for (const c of convergences) {
    countByDepth[c.depth] = (countByDepth[c.depth] ?? 0) + 1;
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Filter
        </span>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
          {(["all", "L4", "L3", "L2", "L1"] as const).map((key) => {
            const isActive = activeFilter === key;
            const count = key === "all" ? convergences.length : (countByDepth[key] ?? 0);
            if (key !== "all" && count === 0) return null;
            const depthConfig = key !== "all" ? DEPTH_CONFIG[key] : null;
            return (
              <button
                key={key}
                onClick={() => setActiveFilter(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold transition-all",
                  isActive
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                {depthConfig && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: depthConfig.color }}
                  />
                )}
                {key === "all" ? "All" : key}
                <span className="text-gray-400">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-2 gap-3">
        {filtered.map((insight) => (
          <ConvergenceCard key={insight.id} insight={insight} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-xs text-gray-400 py-6">
          No convergences at this depth level.
        </p>
      )}
    </div>
  );
}
