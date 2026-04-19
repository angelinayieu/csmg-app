"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  TrendingUp,
  Layers,
  Link2,
  Shield,
  Clock,
} from "lucide-react";

interface SummaryCardsProps {
  totalCycles: number;
  totalEntities: number;
  totalEdges: number;
  coverageScore: number;
  nextScheduledRun: string | null;
  firstSnapshotEntities: number;
}

export function SummaryCards({
  totalCycles,
  totalEntities,
  totalEdges,
  coverageScore,
  nextScheduledRun,
  firstSnapshotEntities,
}: SummaryCardsProps) {
  const growthPct =
    firstSnapshotEntities > 0
      ? Math.round(
          ((totalEntities - firstSnapshotEntities) / firstSnapshotEntities) * 100
        )
      : 0;

  const cards = [
    {
      label: "Research Cycles",
      value: totalCycles,
      icon: <RefreshCw className="h-4 w-4" />,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      sub: totalCycles > 0 ? "completed" : "none yet",
    },
    {
      label: "KG Growth",
      value: `${growthPct >= 0 ? "+" : ""}${growthPct}%`,
      icon: <TrendingUp className="h-4 w-4" />,
      color: growthPct > 0 ? "text-green-600" : "text-gray-500",
      bg: growthPct > 0 ? "bg-green-50" : "bg-gray-50",
      sub: `${totalEntities} entities total`,
    },
    {
      label: "Coverage Score",
      value: `${coverageScore}%`,
      icon: <Shield className="h-4 w-4" />,
      color:
        coverageScore >= 50
          ? "text-green-600"
          : coverageScore >= 25
            ? "text-amber-600"
            : "text-red-500",
      bg:
        coverageScore >= 50
          ? "bg-green-50"
          : coverageScore >= 25
            ? "bg-amber-50"
            : "bg-red-50",
      sub: "external landscape",
    },
    {
      label: "Connections",
      value: totalEdges,
      icon: <Link2 className="h-4 w-4" />,
      color: "text-blue-600",
      bg: "bg-blue-50",
      sub: "typed edges",
    },
    {
      label: "Next Run",
      value: nextScheduledRun
        ? formatRelativeTime(nextScheduledRun)
        : "—",
      icon: <Clock className="h-4 w-4" />,
      color: "text-gray-600",
      bg: "bg-gray-50",
      sub: nextScheduledRun ? "scheduled" : "not scheduled",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                card.bg,
                card.color
              )}
            >
              {card.icon}
            </div>
            <span className="text-xs font-medium text-gray-500">
              {card.label}
            </span>
          </div>
          <div
            className={cn(
              "text-2xl font-semibold tracking-tight",
              card.color
            )}
          >
            {card.value}
          </div>
          <div className="mt-1 text-[11px] text-gray-400">{card.sub}</div>
        </div>
      ))}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "overdue";
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return `${Math.ceil(diff / 60000)}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
