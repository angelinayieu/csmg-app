"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { RefreshCw, Search, Radar } from "lucide-react";

export interface RadarDashboardHeaderProps {
  totalExternal: number;
  categoryCount: number;
  activeSignalCount: number;
  researchLoading: boolean;
  onRefresh: () => void;
  onResearch: () => void;
}

export function RadarDashboardHeader({
  totalExternal,
  categoryCount,
  activeSignalCount,
  researchLoading,
  onRefresh,
  onResearch,
}: RadarDashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between py-1">
      {/* Left: logo + title */}
      <div className="flex items-center gap-3.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-md shadow-blue-500/25">
          <Radar className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight text-gray-900">
            Intelligence Radar
          </h2>
          <p className="text-[13px] text-gray-500 mt-0.5">
            {totalExternal} external signals across {categoryCount} categories
          </p>
        </div>
      </div>

      {/* Right: signal badge + buttons */}
      <div className="flex items-center gap-2.5">
        {/* Active signal badge */}
        <div className="flex items-center gap-2 rounded-full border border-gray-200/60 bg-white px-3 py-1.5 shadow-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="text-xs font-medium text-gray-700">
            {activeSignalCount} active
          </span>
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          disabled={researchLoading}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200/60 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw
            className={cn(
              "h-3 w-3",
              researchLoading && "animate-spin"
            )}
          />
          Refresh
        </button>

        {/* Research button */}
        <button
          onClick={onResearch}
          disabled={researchLoading}
          className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm shadow-blue-600/30 transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <Search className="h-3 w-3" />
          Research
        </button>
      </div>
    </div>
  );
}
