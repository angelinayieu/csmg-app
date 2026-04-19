"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  Zap,
  AlertTriangle,
  HelpCircle,
  Hexagon,
  GitBranch,
  Radio,
} from "lucide-react";

export type AttentionItemType =
  | "decision"
  | "contradiction"
  | "unknown"
  | "archetype"
  | "triad"
  | "signal";

export interface AttentionCardProps {
  type: AttentionItemType;
  impact: "high" | "medium" | "low";
  title: string;
  description: string;
  tags: string[];
  confidence?: number;
  sourceCount?: number;
  onOpen?: () => void;
}

const TYPE_CONFIG: Record<
  AttentionItemType,
  {
    label: string;
    icon: React.ReactNode;
    barColor: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  decision: {
    label: "Decision",
    icon: <Zap className="h-[9px] w-[9px]" />,
    barColor: "bg-blue-500",
    badgeBg: "bg-blue-50",
    badgeText: "text-blue-700",
  },
  contradiction: {
    label: "Contradiction",
    icon: <AlertTriangle className="h-[9px] w-[9px]" />,
    barColor: "bg-red-500",
    badgeBg: "bg-red-50",
    badgeText: "text-red-700",
  },
  unknown: {
    label: "Unknown",
    icon: <HelpCircle className="h-[9px] w-[9px]" />,
    barColor: "bg-amber-500",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-700",
  },
  archetype: {
    label: "Archetype",
    icon: <Hexagon className="h-[9px] w-[9px]" />,
    barColor: "bg-teal-500",
    badgeBg: "bg-teal-50",
    badgeText: "text-teal-700",
  },
  triad: {
    label: "Triad",
    icon: <GitBranch className="h-[9px] w-[9px]" />,
    barColor: "bg-purple-500",
    badgeBg: "bg-purple-50",
    badgeText: "text-purple-700",
  },
  signal: {
    label: "Signal",
    icon: <Radio className="h-[9px] w-[9px]" />,
    barColor: "bg-blue-500",
    badgeBg: "bg-blue-50",
    badgeText: "text-blue-700",
  },
};

export function AttentionCard({
  type,
  impact,
  title,
  description,
  tags,
  confidence,
  sourceCount,
  onOpen,
}: AttentionCardProps) {
  const config = TYPE_CONFIG[type];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
      {/* Priority bar */}
      <div
        className={cn(
          "absolute left-0 top-0 h-full w-[3px]",
          config.barColor
        )}
      />

      {/* Top row: type badge + impact dots */}
      <div className="flex items-center justify-between mb-2.5">
        <span
          className={cn(
            "inline-flex items-center gap-[5px] rounded-md px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.5px]",
            config.badgeBg,
            config.badgeText
          )}
        >
          {config.icon}
          {config.label}
        </span>
        <ImpactDots level={impact} />
      </div>

      {/* Title + description */}
      <h4 className="text-[15px] font-semibold tracking-tight text-gray-900 mb-1.5">
        {title}
      </h4>
      <p className="text-xs leading-relaxed text-gray-500 mb-3">
        {description}
      </p>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-[5px] mb-3">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-gray-100/80 px-2 py-[3px] text-[10px] font-medium text-gray-600"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-[11px] text-gray-400">
        <span>
          {confidence != null && `Confidence ${Math.round(confidence * 100)}%`}
          {confidence != null && sourceCount != null && " \u00b7 "}
          {sourceCount != null && `${sourceCount} sources`}
        </span>
        {onOpen && (
          <button
            onClick={onOpen}
            className="font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            Open <span aria-hidden>\u2192</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ImpactDots({ level }: { level: "high" | "medium" | "low" }) {
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const color =
    level === "high"
      ? "bg-red-500"
      : level === "medium"
        ? "bg-amber-500"
        : "bg-green-500";

  return (
    <div className="flex gap-[2px]" title={`Impact: ${level}`}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn(
            "h-3 w-1 rounded-[1px]",
            i < filled ? color : "bg-gray-200"
          )}
        />
      ))}
    </div>
  );
}
