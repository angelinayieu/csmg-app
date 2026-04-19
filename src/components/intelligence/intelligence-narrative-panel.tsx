"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  ChevronDown,
  AlertCircle,
  GitBranch,
  HelpCircle,
  Hexagon,
  Zap,
  AlertTriangle,
  Radio,
} from "lucide-react";
import type { IntelligenceNarrative } from "@/types/intelligence-v2";

export interface IntelligenceNarrativePanelProps {
  narrative: IntelligenceNarrative | null;
  onEntityClick?: (entityId: string) => void;
  className?: string;
}

const SOURCE_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; bg: string }
> = {
  decision: {
    icon: <Zap className="h-3 w-3" />,
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
  },
  contradiction: {
    icon: <AlertTriangle className="h-3 w-3" />,
    color: "text-red-600",
    bg: "bg-red-50 border-red-200",
  },
  unknown: {
    icon: <HelpCircle className="h-3 w-3" />,
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
  },
  archetype: {
    icon: <Hexagon className="h-3 w-3" />,
    color: "text-teal-600",
    bg: "bg-teal-50 border-teal-200",
  },
  triad: {
    icon: <GitBranch className="h-3 w-3" />,
    color: "text-purple-600",
    bg: "bg-purple-50 border-purple-200",
  },
  signal: {
    icon: <Radio className="h-3 w-3" />,
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
  },
};

export function IntelligenceNarrativePanel({
  narrative,
  onEntityClick,
  className,
}: IntelligenceNarrativePanelProps) {
  const [showAttention, setShowAttention] = useState(true);

  if (!narrative || !narrative.executive_summary) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50/60 to-white overflow-hidden",
        className
      )}
    >
      {/* Executive Summary */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <BookOpen className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-600">
            Intelligence Brief
          </span>
          {narrative.change_summary && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-medium text-blue-600">
              Updated
            </span>
          )}
        </div>
        <p className="text-[12px] leading-[1.65] text-gray-800 font-medium">
          {narrative.executive_summary}
        </p>
        {narrative.change_summary && (
          <p className="mt-1.5 text-[10px] leading-[1.5] text-blue-700 italic">
            {narrative.change_summary}
          </p>
        )}
      </div>

      {/* Attention Items */}
      {narrative.attention_items.length > 0 && (
        <div className="border-t border-slate-100">
          <button
            onClick={() => setShowAttention(!showAttention)}
            className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50/50 transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3 text-amber-500" />
              <span className="text-[9px] font-semibold uppercase tracking-[0.04em] text-gray-500">
                Requires Attention
              </span>
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-medium text-amber-600">
                {narrative.attention_items.length}
              </span>
            </div>
            <ChevronDown
              className={cn(
                "h-3 w-3 text-gray-300 transition-transform",
                showAttention && "rotate-180"
              )}
            />
          </button>
          {showAttention && (
            <div className="px-4 pb-3 space-y-1.5">
              {narrative.attention_items.map((item, i) => {
                const config =
                  SOURCE_CONFIG[item.source] ?? SOURCE_CONFIG.signal;
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border px-3 py-2",
                      config.bg
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={config.color}>{config.icon}</span>
                      <span
                        className={cn(
                          "text-[11px] font-semibold",
                          config.color
                        )}
                      >
                        {item.title}
                      </span>
                      <span className="text-[8px] text-gray-400 capitalize">
                        {item.source}
                      </span>
                    </div>
                    <p className="text-[10px] leading-[1.5] text-gray-600">
                      {item.reason}
                    </p>
                    {item.entity_ids.length > 0 && onEntityClick && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.entity_ids.slice(0, 4).map((eid) => (
                          <button
                            key={eid}
                            onClick={() => onEntityClick(eid)}
                            className="rounded-full bg-white/60 px-1.5 py-0.5 text-[8px] font-medium text-gray-600 hover:text-blue-700 hover:bg-blue-50 transition-colors border border-gray-200"
                          >
                            {eid}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
