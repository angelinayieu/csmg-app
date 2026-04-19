"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Zap, Globe, Shield, Link2 } from "lucide-react";
import { RadarStatCard } from "./radar-stat-card";
import type { RadarSummary } from "@/types/intelligence";
import type {
  PriorityDecisionV2,
  TemporalIntelligence,
} from "@/types/intelligence-v2";
import type { PriorityDecision } from "@/lib/hooks/use-intelligence-radar";

export interface RadarHeroRowProps {
  summary: RadarSummary;
  v2Decisions?: PriorityDecisionV2[];
  v1Decisions?: PriorityDecision[];
  temporalIntelligence?: TemporalIntelligence | null;
  className?: string;
}

export function RadarHeroRow({
  summary,
  v2Decisions,
  v1Decisions,
  temporalIntelligence,
  className,
}: RadarHeroRowProps) {
  // Decision counts
  const { criticalCount, highCount, totalDecisions } = useMemo(() => {
    if (v2Decisions && v2Decisions.length > 0) {
      return {
        criticalCount: v2Decisions.filter((d) => d.due_window === "now").length,
        highCount: v2Decisions.filter((d) => d.due_window === "this_week").length,
        totalDecisions: v2Decisions.length,
      };
    }
    if (v1Decisions && v1Decisions.length > 0) {
      return {
        criticalCount: v1Decisions.filter((d) => d.bucket === "now").length,
        highCount: v1Decisions.filter((d) => d.bucket === "next").length,
        totalDecisions: v1Decisions.length,
      };
    }
    return { criticalCount: 0, highCount: 0, totalDecisions: 0 };
  }, [v2Decisions, v1Decisions]);

  // Trend computations
  const intelTrend = useMemo(() => {
    if (!temporalIntelligence?.signal_velocity) return undefined;
    const accel = temporalIntelligence.signal_velocity.acceleration;
    if (accel > 1.05)
      return { direction: "up" as const, value: `\u2191 ${Math.round((accel - 1) * 100)}%` };
    if (accel < 0.95)
      return { direction: "down" as const, value: `\u2193 ${Math.round((1 - accel) * 100)}%` };
    return { direction: "flat" as const, value: "\u2014 0%" };
  }, [temporalIntelligence]);

  const coverageTrend = useMemo(() => {
    if (!temporalIntelligence?.coverage_trajectory) return undefined;
    const delta = temporalIntelligence.coverage_trajectory.delta_per_period;
    if (delta > 0.5)
      return { direction: "up" as const, value: `\u2191 ${delta.toFixed(1)}%` };
    if (delta < -0.5)
      return { direction: "down" as const, value: `\u2193 ${Math.abs(delta).toFixed(1)}%` };
    return { direction: "flat" as const, value: "\u2014 0%" };
  }, [temporalIntelligence]);

  const immediateCount = criticalCount + highCount;
  const heroText =
    immediateCount > 0
      ? `${immediateCount} immediate intelligence ${immediateCount === 1 ? "decision needs" : "decisions need"} action`
      : totalDecisions > 0
        ? `${totalDecisions} strategic decisions under review`
        : "No immediate threats \u2014 focus on next opportunities";

  return (
    <div
      className={cn(
        "grid grid-cols-[1.3fr_1fr_1fr_1fr] gap-3",
        className
      )}
    >
      {/* Decision Focus — Hero card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-[22px] text-white shadow-md">
        <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10 blur-sm" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2.5">
            <Zap className="h-3 w-3 opacity-85" />
            <span className="text-[11px] font-semibold uppercase tracking-[1px] opacity-85">
              Decision Focus
            </span>
          </div>
          <p className="text-[22px] font-semibold leading-tight tracking-tight mb-3.5 max-w-[90%]">
            {heroText}
          </p>
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium backdrop-blur-sm">
                {criticalCount} critical
              </span>
            )}
            {highCount > 0 && (
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium backdrop-blur-sm">
                {highCount} high priority
              </span>
            )}
          </div>
        </div>
      </div>

      {/* External Intel */}
      <RadarStatCard
        label="External Intel"
        value={summary.total_external}
        icon={<Globe className="h-3 w-3" />}
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
        trend={intelTrend}
        target={`vs ${Math.round(summary.total_external * 0.7)} last week`}
      />

      {/* Coverage */}
      <RadarStatCard
        label="Coverage"
        value={`${summary.coverage_score}%`}
        icon={<Shield className="h-3 w-3" />}
        iconBg="bg-green-50"
        iconColor="text-green-600"
        trend={coverageTrend}
        target="Target 40%"
      />

      {/* Bridges */}
      <RadarStatCard
        label="Bridges"
        value={summary.bridge_count}
        icon={<Link2 className="h-3 w-3" />}
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
        trend={
          summary.bridge_count === 0
            ? { direction: "flat", value: "\u2014 0" }
            : undefined
        }
        target={
          summary.bridge_count === 0
            ? "None established"
            : `${summary.bridge_count} active`
        }
      />
    </div>
  );
}
