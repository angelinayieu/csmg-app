"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";

type CardVariant =
  | "leverage"
  | "risk"
  | "cycle-positive"
  | "cycle-negative"
  | "cycle-balancing";

interface ExpandableCardProps {
  variant: CardVariant;
  rank: number;
  entityId?: string;
  title: string;
  score?: number; // 0-1, shown as Ring
  children: React.ReactNode; // expanded content (CalloutBoxes, description, etc.)
  defaultExpanded?: boolean;
  className?: string;
}

const variantConfig: Record<
  CardVariant,
  {
    rankBg: string;
    rankText: string;
    expandedBg: string;
    expandedBorder: string;
  }
> = {
  leverage: {
    rankBg: "bg-blue-500",
    rankText: "text-white",
    expandedBg: "bg-blue-50/40",
    expandedBorder: "border-blue-200",
  },
  risk: {
    rankBg: "bg-red-500",
    rankText: "text-white",
    expandedBg: "bg-red-50/40",
    expandedBorder: "border-red-200",
  },
  "cycle-positive": {
    rankBg: "bg-green-500",
    rankText: "text-white",
    expandedBg: "bg-green-50/40",
    expandedBorder: "border-green-200",
  },
  "cycle-negative": {
    rankBg: "bg-red-500",
    rankText: "text-white",
    expandedBg: "bg-red-50/40",
    expandedBorder: "border-red-200",
  },
  "cycle-balancing": {
    rankBg: "bg-amber-500",
    rankText: "text-white",
    expandedBg: "bg-amber-50/40",
    expandedBorder: "border-amber-200",
  },
};

export function ExpandableCard({
  variant,
  rank,
  entityId,
  title,
  score,
  children,
  defaultExpanded = false,
  className,
}: ExpandableCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = variantConfig[variant];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[12px] border transition-all duration-[250ms]",
        expanded
          ? cn(config.expandedBg, config.expandedBorder)
          : "border-gray-200 bg-gray-50/80",
        className
      )}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-5 py-[14px] text-left"
      >
        {/* Rank badge */}
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors duration-[250ms]",
            expanded
              ? cn(config.rankBg, config.rankText)
              : "bg-gray-200 text-gray-500"
          )}
        >
          {rank}
        </span>

        {/* Entity ID */}
        {entityId && (
          <span className="text-[11px] font-semibold tracking-[0.03em] text-gray-400">
            {entityId}
          </span>
        )}

        {/* Title */}
        <span className="flex-1 truncate text-[14px] font-semibold text-gray-800">
          {title}
        </span>

        {/* Score ring */}
        {score !== undefined && (
          <Ring value={score} size={38} showValue={true} />
        )}

        {/* Chevron */}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-gray-400 transition-transform duration-[250ms]",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded content */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-[350ms]",
          expanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        )}
        style={{
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div className="space-y-3 px-5 pb-5 pt-1">{children}</div>
      </div>
    </div>
  );
}
