"use client";

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { SummaryCards } from "./summary-cards";
import { KGGrowthChart } from "./kg-growth-chart";
import { StackHealthChart } from "./stack-health-chart";
import { CycleHistoryTable } from "./cycle-history-table";
import { CoverageChart } from "./coverage-chart";
import type { KGMetricsSnapshotRow, LoopCycleRecordRow } from "@/types/loop-metrics";

interface SpaceSummary {
  id: string;
  title: string;
  synthesis_data: Record<string, unknown> | null;
  entity_count: number | null;
  edge_count: number | null;
  updated_at: string;
}

export interface AnalyticsDashboardProps {
  spaces: SpaceSummary[];
  snapshots: KGMetricsSnapshotRow[];
  cycles: LoopCycleRecordRow[];
}

export function AnalyticsDashboard({
  spaces,
  snapshots,
  cycles,
}: AnalyticsDashboardProps) {
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | "all">("all");

  // Filter data by selected space
  const filteredSnapshots = useMemo(
    () =>
      selectedSpaceId === "all"
        ? snapshots
        : snapshots.filter((s) => s.space_id === selectedSpaceId),
    [snapshots, selectedSpaceId]
  );

  const filteredCycles = useMemo(
    () =>
      selectedSpaceId === "all"
        ? cycles
        : cycles.filter((c) => c.space_id === selectedSpaceId),
    [cycles, selectedSpaceId]
  );

  // Compute current totals across all spaces
  const currentTotals = useMemo(() => {
    let totalEntities = 0;
    let totalEdges = 0;
    for (const space of spaces) {
      totalEntities += space.entity_count ?? 0;
      totalEdges += space.edge_count ?? 0;
    }
    return { totalEntities, totalEdges, spaceCount: spaces.length };
  }, [spaces]);

  // Get latest snapshot for coverage score
  const latestSnapshot = filteredSnapshots.length > 0
    ? filteredSnapshots[filteredSnapshots.length - 1]
    : null;

  // Get next scheduled run from any space
  const nextScheduledRun = useMemo(() => {
    for (const space of spaces) {
      const synth = space.synthesis_data;
      if (!synth) continue;
      const radar = (synth as Record<string, unknown>).intelligence_radar as Record<string, unknown> | null;
      if (!radar) continue;
      const schedule = radar.schedule as { enabled?: boolean; next_run_at?: string } | null;
      if (schedule?.enabled && schedule.next_run_at) return schedule.next_run_at;
    }
    return null;
  }, [spaces]);

  return (
    <div className="space-y-6">
      {/* Space filter */}
      {spaces.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Space:</label>
          <select
            value={selectedSpaceId}
            onChange={(e) => setSelectedSpaceId(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All spaces</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title ?? s.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary cards */}
      <SummaryCards
        totalCycles={filteredCycles.length}
        totalEntities={currentTotals.totalEntities}
        totalEdges={currentTotals.totalEdges}
        coverageScore={latestSnapshot?.metrics?.coverage_score ?? 0}
        nextScheduledRun={nextScheduledRun}
        firstSnapshotEntities={
          filteredSnapshots.length > 0
            ? filteredSnapshots[0].metrics.entity_count
            : currentTotals.totalEntities
        }
      />

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <KGGrowthChart snapshots={filteredSnapshots} />
        <CoverageChart snapshots={filteredSnapshots} />
      </div>

      {/* Stack health */}
      <StackHealthChart snapshots={filteredSnapshots} />

      {/* Cycle history */}
      <CycleHistoryTable
        cycles={filteredCycles}
        spaceNames={new Map(spaces.map((s) => [s.id, s.title ?? s.id.slice(0, 8)]))}
      />

      {/* Empty state */}
      {snapshots.length === 0 && cycles.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">
            No analytics data yet. Enable a research schedule on a space to start
            collecting metrics automatically.
          </p>
        </div>
      )}
    </div>
  );
}
