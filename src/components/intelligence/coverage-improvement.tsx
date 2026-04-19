"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  Link2,
  Search,
  ShieldCheck,
  Plus,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import type { CoverageImprovementRec } from "@/types/intelligence-v2";

export interface CoverageImprovementPanelProps {
  improvements: CoverageImprovementRec[];
  currentScore: number;
  onCreateBridge?: (externalEntityId: string, internalEntityId: string) => void;
  onTriggerResearch?: (focusAreas: string[]) => void;
  className?: string;
}

const actionIcons: Record<string, React.ReactNode> = {
  create_bridge: <Link2 className="h-3.5 w-3.5 text-blue-500" />,
  research_category: <Search className="h-3.5 w-3.5 text-purple-500" />,
  upgrade_authority: <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />,
  add_entity: <Plus className="h-3.5 w-3.5 text-green-500" />,
};

const actionColors: Record<string, { border: string; bg: string }> = {
  create_bridge: { border: "border-blue-100", bg: "bg-blue-50/30" },
  research_category: { border: "border-purple-100", bg: "bg-purple-50/30" },
  upgrade_authority: { border: "border-amber-100", bg: "bg-amber-50/30" },
  add_entity: { border: "border-green-100", bg: "bg-green-50/30" },
};

const effortBadge: Record<string, { label: string; className: string }> = {
  low: { label: "Quick win", className: "bg-green-50 text-green-700" },
  medium: { label: "Some effort", className: "bg-amber-50 text-amber-700" },
  high: { label: "Significant", className: "bg-red-50 text-red-600" },
};

export function CoverageImprovementPanel({
  improvements,
  currentScore,
  onCreateBridge,
  onTriggerResearch,
  className,
}: CoverageImprovementPanelProps) {
  if (improvements.length === 0) return null;

  // Estimate potential score after all improvements
  const maxGain = improvements.reduce((sum, r) => sum + r.estimated_coverage_gain, 0);
  const potentialScore = Math.min(100, currentScore + maxGain);

  return (
    <div className={cn("space-y-2.5", className)}>
      {/* Header with potential score */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-green-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500">
            Improve Coverage
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <span className="font-semibold text-gray-600">{currentScore}</span>
          <ArrowRight className="h-2.5 w-2.5 text-gray-400" />
          <span className="font-bold text-green-600">{potentialScore}</span>
          <span className="text-gray-400">possible</span>
        </div>
      </div>

      {/* Improvement cards */}
      <div className="space-y-1.5">
        {improvements.map((rec, i) => {
          const icon = actionIcons[rec.action] ?? actionIcons.add_entity;
          const colors = actionColors[rec.action] ?? actionColors.add_entity;
          const effort = effortBadge[rec.effort] ?? effortBadge.medium;

          return (
            <div
              key={i}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-all hover:shadow-sm",
                colors.border,
                colors.bg
              )}
            >
              <span className="mt-0.5 flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-gray-800 leading-snug">
                  {rec.description}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide",
                      effort.className
                    )}
                  >
                    {effort.label}
                  </span>
                  <span className="text-[9px] text-green-600 font-medium">
                    +{rec.estimated_coverage_gain} pts
                  </span>
                </div>
              </div>

              {/* Quick action button for bridge creation */}
              {rec.action === "create_bridge" && rec.target_entity_id && rec.internal_entity_id && onCreateBridge && (
                <button
                  onClick={() => onCreateBridge(rec.target_entity_id!, rec.internal_entity_id!)}
                  className="flex-shrink-0 mt-1 flex items-center gap-0.5 rounded-md bg-blue-100 px-2 py-1 text-[9px] font-medium text-blue-700 hover:bg-blue-200 transition-colors"
                >
                  Bridge
                  <ChevronRight className="h-2.5 w-2.5" />
                </button>
              )}

              {/* Quick action for research */}
              {rec.action === "research_category" && onTriggerResearch && (
                <button
                  onClick={() => onTriggerResearch([])}
                  className="flex-shrink-0 mt-1 flex items-center gap-0.5 rounded-md bg-purple-100 px-2 py-1 text-[9px] font-medium text-purple-700 hover:bg-purple-200 transition-colors"
                >
                  Research
                  <ChevronRight className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
