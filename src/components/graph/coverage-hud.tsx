"use client";

import { useMemo, useState } from "react";
import { Activity, Radar, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CoverageLandscapePanel } from "./coverage-landscape-panel";
import type { Entity } from "@/types";

interface CoverageHudProps {
  entities: Entity[];
  /** Number of pair-checks recorded for this space (from server) */
  pairChecksCount?: number;
  /** Called when user clicks "Analyze now" button */
  onRunNow?: () => void;
  /** Whether a manual run is in flight */
  running?: boolean;
  /** Required for the landscape panel — pass space.id */
  spaceId?: string;
}

/**
 * Compact coverage indicator showing analysis progress across the graph.
 * Mirrors what a biology-KG coverage HUD shows: which nodes have been
 * connection-scanned, how many pairs remain to examine.
 */
export function CoverageHud({ entities, pairChecksCount = 0, onRunNow, running, spaceId }: CoverageHudProps) {
  const [expanded, setExpanded] = useState(false);

  const stats = useMemo(() => {
    const total = entities.length;
    if (total === 0) return null;

    // How many entities have been connection-searched at least once?
    let searched = 0;
    let totalSearchCount = 0;
    for (const e of entities) {
      const count = (e as Entity & { connection_search_count?: number }).connection_search_count ?? 0;
      if (count > 0) searched++;
      totalSearchCount += count;
    }

    const searchedPct = Math.round((searched / total) * 100);
    // Total possible pairs = n*(n-1)/2
    const totalPairs = (total * (total - 1)) / 2;
    const pairsPct = totalPairs > 0 ? Math.round((pairChecksCount / totalPairs) * 100) : 0;

    return {
      total,
      searched,
      searchedPct,
      totalSearchCount,
      totalPairs,
      pairsChecked: pairChecksCount,
      pairsPct,
    };
  }, [entities, pairChecksCount]);

  if (!stats) return null;

  return (
    <div className="w-full">
      {/* Compact bar (always visible) */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 backdrop-blur-sm text-[10px]">
        <Radar className="h-3 w-3 text-gray-400" />
        <span className="font-semibold uppercase tracking-wider text-gray-400">Coverage</span>

        <div className="flex items-center gap-1.5 border-l border-gray-200 pl-2">
          <span className="text-gray-500">Nodes:</span>
          <span className="font-mono font-semibold text-gray-700">
            {stats.searched}/{stats.total}
          </span>
          <span className="text-gray-400">({stats.searchedPct}%)</span>
        </div>

        <div className="flex items-center gap-1.5 border-l border-gray-200 pl-2">
          <span className="text-gray-500">Pairs:</span>
          <span className="font-mono font-semibold text-gray-700">
            {stats.pairsChecked.toLocaleString()}/{stats.totalPairs.toLocaleString()}
          </span>
          <span className="text-gray-400">({stats.pairsPct}%)</span>
        </div>

        {spaceId && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-all",
              expanded
                ? "border-interaxis-300 bg-interaxis-100 text-interaxis-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
            )}
            title="Show coverage landscape — dimensional matrix, blind spots, calibration"
          >
            <Radar className="h-3 w-3" />
            {expanded ? "Hide landscape" : "Landscape"}
            <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}

        {onRunNow && (
          <button
            onClick={onRunNow}
            disabled={running}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-all",
              !spaceId && "ml-auto",
              running
                ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                : "border-interaxis-200 bg-interaxis-50 text-interaxis-700 hover:bg-interaxis-100",
            )}
            title="Run connection prospector now"
          >
            <Activity className={cn("h-3 w-3", running && "animate-pulse")} />
            {running ? "Scanning…" : "Scan now"}
          </button>
        )}
      </div>

      {/* Expanded landscape (when toggled) */}
      {expanded && spaceId && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white/90 p-3 backdrop-blur-sm">
          <CoverageLandscapePanel spaceId={spaceId} />
        </div>
      )}
    </div>
  );
}
