"use client";

import { useMemo } from "react";
import { Layers, Zap, GitFork, Lock, Repeat, TrendingDown, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import type { Entity, Space } from "@/types";
import type { InternalDynamic, SubComponent } from "@/types/expansion";

// ── Helpers ──

interface ParsedExpansionData {
  sub_components: SubComponent[];
  internal_dynamics: InternalDynamic[];
}

function parseProvenanceExpansion(provenance: unknown): ParsedExpansionData | null {
  if (!provenance || typeof provenance !== "object") return null;
  const p = provenance as Record<string, unknown>;
  const ed = (p.expansion_data ?? p) as Record<string, unknown>;
  const subs = ed.sub_components;
  const dynamics = ed.internal_dynamics;
  if (!Array.isArray(subs) || subs.length === 0) return null;
  return {
    sub_components: subs as SubComponent[],
    internal_dynamics: Array.isArray(dynamics) ? (dynamics as InternalDynamic[]) : [],
  };
}

const DYNAMIC_ICONS: Record<string, typeof Zap> = {
  bottleneck: Lock,
  feedback_loop: Repeat,
  gate: GitFork,
  amplifier: ArrowUpRight,
  decay: TrendingDown,
};

const DYNAMIC_COLORS: Record<string, string> = {
  bottleneck: "bg-red-100 text-red-700",
  feedback_loop: "bg-violet-100 text-violet-700",
  gate: "bg-amber-100 text-amber-700",
  amplifier: "bg-teal-100 text-teal-700",
  decay: "bg-gray-200 text-gray-600",
};

// ── Coverage bar ──

function CoverageBar({ expanded, decomposable }: { expanded: number; decomposable: number }) {
  const pct = decomposable > 0 ? Math.round((expanded / decomposable) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-gray-600">Expansion coverage</span>
        <span className="text-[10px] font-bold text-teal-700 tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-teal-400 to-cyan-500 transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-gray-400 tabular-nums">
        <span>{expanded} expanded</span>
        <span>{decomposable} decomposable</span>
      </div>
    </div>
  );
}

// ── Stat pill ──

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg px-2.5 py-1.5", color)}>
      <span className="text-sm font-bold tabular-nums">{value}</span>
      <span className="text-[9px] font-medium opacity-80">{label}</span>
    </div>
  );
}

// ── Main component ──

interface ExpansionSummaryModuleProps {
  entities: Entity[];
  space: Space;
}

export function ExpansionSummaryModule({ entities }: ExpansionSummaryModuleProps) {
  const stats = useMemo(() => {
    const expanded = entities.filter((e) => e.is_expanded);
    const decomposable = entities.filter((e) => e.is_decomposable);
    const pending = decomposable.filter((e) => !e.is_expanded);
    const withSubSpace = entities.filter((e) => e.has_sub_space);

    // Aggregate expansion data from provenance
    let totalSubComponents = 0;
    let criticalSubComponents = 0;
    let expandableSubComponents = 0;
    const dynamicCounts: Record<string, number> = {
      bottleneck: 0,
      feedback_loop: 0,
      gate: 0,
      amplifier: 0,
      decay: 0,
    };

    for (const entity of expanded) {
      const parsed = parseProvenanceExpansion(entity.provenance);
      if (!parsed) continue;

      totalSubComponents += parsed.sub_components.length;
      criticalSubComponents += parsed.sub_components.filter(
        (sc) => sc.importance === "critical"
      ).length;
      expandableSubComponents += parsed.sub_components.filter(
        (sc) => sc.is_expandable
      ).length;

      for (const dyn of parsed.internal_dynamics) {
        if (dyn.type in dynamicCounts) {
          dynamicCounts[dyn.type]++;
        }
      }
    }

    const hasDynamics = Object.values(dynamicCounts).some((v) => v > 0);
    const hasSubComponentData = totalSubComponents > 0;

    return {
      expandedCount: expanded.length,
      decomposableCount: decomposable.length,
      pendingCount: pending.length,
      subSpaceCount: withSubSpace.length,
      totalSubComponents,
      criticalSubComponents,
      expandableSubComponents,
      dynamicCounts,
      hasDynamics,
      hasSubComponentData,
    };
  }, [entities]);

  // Don't render if nothing is decomposable
  if (stats.decomposableCount === 0) return null;

  return (
    <DashboardCard
      title="Expansion Coverage"
      icon={<Layers className="h-4 w-4" />}
      defaultExpanded={false}
      collapsible
      badge={
        stats.pendingCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-[9px] font-medium text-teal-700">
            {stats.pendingCount} pending
          </span>
        ) : stats.expandedCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-cyan-50 px-2 py-0.5 text-[9px] font-medium text-cyan-700">
            All expanded
          </span>
        ) : null
      }
    >
      <div className="space-y-3">
        {/* Coverage bar */}
        <CoverageBar
          expanded={stats.expandedCount}
          decomposable={stats.decomposableCount}
        />

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-1.5">
          <StatPill label="Expanded" value={stats.expandedCount} color="bg-teal-50 text-teal-700" />
          <StatPill label="Pending" value={stats.pendingCount} color="bg-amber-50 text-amber-700" />
          <StatPill label="Sub-spaces" value={stats.subSpaceCount} color="bg-cyan-50 text-cyan-700" />
        </div>

        {/* Sub-component summary (only if provenance data exists) */}
        {stats.hasSubComponentData && (
          <div className="rounded-lg border border-teal-100 bg-teal-50/40 p-2.5 space-y-2">
            <p className="text-[10px] font-semibold text-teal-800">
              Sub-component overview
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <span className="block text-xs font-bold text-gray-800 tabular-nums">
                  {stats.totalSubComponents}
                </span>
                <span className="text-[9px] text-gray-500">Total</span>
              </div>
              <div>
                <span className="block text-xs font-bold text-red-600 tabular-nums">
                  {stats.criticalSubComponents}
                </span>
                <span className="text-[9px] text-gray-500">Critical</span>
              </div>
              <div>
                <span className="block text-xs font-bold text-teal-600 tabular-nums">
                  {stats.expandableSubComponents}
                </span>
                <span className="text-[9px] text-gray-500">Drillable</span>
              </div>
            </div>
          </div>
        )}

        {/* Dynamics breakdown */}
        {stats.hasDynamics && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-600">
              Internal dynamics
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.dynamicCounts).map(([type, count]) => {
                if (count === 0) return null;
                const Icon = DYNAMIC_ICONS[type] ?? Zap;
                return (
                  <span
                    key={type}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium",
                      DYNAMIC_COLORS[type] ?? "bg-gray-100 text-gray-600"
                    )}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {count} {type.replace(/_/g, " ")}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
