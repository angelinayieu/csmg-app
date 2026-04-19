"use client";

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ArrowRight,
  Minus,
} from "lucide-react";
import type {
  TemporalIntelligence,
  SignalVelocity,
  EntityStaleness,
  CoverageTrajectory,
  CadenceRecommendation,
} from "@/types/intelligence-v2";

// ── Props ──

export interface TemporalIntelligencePanelProps {
  temporal: TemporalIntelligence | null;
  onEntityClick?: (entityId: string) => void;
  onUpdateCadence?: (cadence: string) => void;
  className?: string;
}

// ── Signal Velocity ──

function SignalVelocityIndicator({ velocity }: { velocity: SignalVelocity }) {
  const { acceleration, current_period_count, previous_period_count, by_type, period_days } = velocity;

  const accelLabel =
    acceleration > 1.3
      ? { text: "Accelerating", emoji: "\uD83D\uDD25", className: "bg-orange-50 text-orange-700" }
      : acceleration < 0.7
        ? { text: "Decelerating", emoji: "\u23F8\uFE0F", className: "bg-blue-50 text-blue-600" }
        : { text: "Steady", emoji: "\u2192", className: "bg-gray-100 text-gray-600" };

  // Build mini bar data from by_type
  const typeEntries = Object.entries(by_type);
  const maxCount = Math.max(...typeEntries.map(([, v]) => v), 1);

  const typeColors: Record<string, string> = {
    research: "bg-purple-400",
    signal: "bg-blue-400",
    bridge: "bg-blue-400",
    authority_update: "bg-amber-400",
    manual: "bg-gray-400",
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Activity className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500">
          Signal Velocity
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[9px] font-medium",
            accelLabel.className
          )}
        >
          {accelLabel.emoji} {accelLabel.text}
        </span>
      </div>

      {/* Period comparison */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-baseline gap-1">
          <span className="text-[16px] font-bold text-gray-900">{current_period_count}</span>
          <span className="text-[9px] text-gray-400">this period</span>
        </div>
        <span className="text-[9px] text-gray-300">vs</span>
        <div className="flex items-baseline gap-1">
          <span className="text-[13px] font-semibold text-gray-500">{previous_period_count}</span>
          <span className="text-[9px] text-gray-400">prev</span>
        </div>
        <span className="text-[8px] text-gray-400">({period_days}d window)</span>
      </div>

      {/* Mini bar chart: by_type breakdown */}
      {typeEntries.length > 0 && (
        <div className="space-y-1">
          {typeEntries.map(([type, count]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className="text-[8px] text-gray-500 w-[60px] truncate text-right">
                {type.replace(/_/g, " ")}
              </span>
              <div className="flex-1 h-[6px] rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", typeColors[type] ?? "bg-gray-400")}
                  style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                />
              </div>
              <span className="text-[8px] font-medium text-gray-500 w-[16px] text-right">
                {count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Coverage Trajectory ──

function CoverageTrajectoryChart({ trajectory }: { trajectory: CoverageTrajectory }) {
  const { snapshots, trend, delta_per_period } = trajectory;

  const trendConfig =
    trend === "improving"
      ? { icon: TrendingUp, label: "Improving", className: "bg-green-50 text-green-700", stroke: "#22c55e", fill: "rgba(34,197,94,0.08)" }
      : trend === "degrading"
        ? { icon: TrendingDown, label: "Degrading", className: "bg-red-50 text-red-600", stroke: "#ef4444", fill: "rgba(239,68,68,0.08)" }
        : { icon: Minus, label: "Stable", className: "bg-gray-100 text-gray-600", stroke: "#9ca3af", fill: "rgba(156,163,175,0.06)" };

  const TrendIcon = trendConfig.icon;

  const deltaLabel =
    delta_per_period >= 0
      ? `+${delta_per_period.toFixed(1)} pts/period`
      : `${delta_per_period.toFixed(1)} pts/period`;

  // Build SVG polyline from snapshots
  const chartWidth = 200;
  const chartHeight = 40;
  const padding = { top: 4, bottom: 4, left: 2, right: 2 };
  const plotW = chartWidth - padding.left - padding.right;
  const plotH = chartHeight - padding.top - padding.bottom;

  const points = useMemo(() => {
    if (snapshots.length === 0) return { line: "", area: "" };

    const scores = snapshots.map((s) => s.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore || 1;

    const coords = snapshots.map((s, i) => {
      const x = padding.left + (snapshots.length > 1 ? (i / (snapshots.length - 1)) * plotW : plotW / 2);
      const y = padding.top + plotH - ((s.score - minScore) / range) * plotH;
      return { x, y };
    });

    const lineStr = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

    // Area: line + close to bottom
    const areaStr =
      lineStr +
      ` L${coords[coords.length - 1].x.toFixed(1)},${(chartHeight - padding.bottom).toFixed(1)}` +
      ` L${coords[0].x.toFixed(1)},${(chartHeight - padding.bottom).toFixed(1)} Z`;

    return { line: lineStr, area: areaStr };
  }, [snapshots, plotW, plotH, chartHeight, padding.left, padding.top, padding.bottom]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendIcon className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500">
            Coverage Trajectory
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-medium", trendConfig.className)}>
            {trend === "improving" ? "\u2197" : trend === "degrading" ? "\u2198" : "\u2192"} {trendConfig.label}
          </span>
          <span
            className={cn(
              "text-[9px] font-medium",
              delta_per_period > 0 ? "text-green-600" : delta_per_period < 0 ? "text-red-500" : "text-gray-500"
            )}
          >
            {deltaLabel}
          </span>
        </div>
      </div>

      {/* Mini SVG chart */}
      {snapshots.length >= 2 && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-1.5">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            width={chartWidth}
            height={chartHeight}
            className="w-full max-w-[200px]"
            preserveAspectRatio="none"
          >
            {/* Area fill */}
            <path d={points.area} fill={trendConfig.fill} />
            {/* Line */}
            <path d={points.line} fill="none" stroke={trendConfig.stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            {/* Dots */}
            {snapshots.length <= 10 &&
              snapshots.map((s, i) => {
                const scores = snapshots.map((sp) => sp.score);
                const minS = Math.min(...scores);
                const maxS = Math.max(...scores);
                const rangeS = maxS - minS || 1;
                const x = padding.left + (snapshots.length > 1 ? (i / (snapshots.length - 1)) * plotW : plotW / 2);
                const y = padding.top + plotH - ((s.score - minS) / rangeS) * plotH;
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r="2"
                    fill="white"
                    stroke={trendConfig.stroke}
                    strokeWidth="1"
                  />
                );
              })}
          </svg>
        </div>
      )}

      {/* Score range */}
      {snapshots.length >= 2 && (
        <div className="mt-1 flex justify-between text-[8px] text-gray-400">
          <span>{snapshots[0].date}</span>
          <span>{snapshots[snapshots.length - 1].date}</span>
        </div>
      )}
    </div>
  );
}

// ── Stale Entities ──

function StaleEntitiesSection({
  entities,
  onEntityClick,
}: {
  entities: EntityStaleness[];
  onEntityClick?: (entityId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (entities.length === 0) return null;

  const staleCount = entities.filter((e) => e.stale).length;

  const touchedByColors: Record<string, string> = {
    research: "bg-purple-50 text-purple-600",
    signal: "bg-blue-50 text-blue-600",
    bridge: "bg-blue-50 text-blue-600",
    authority_update: "bg-amber-50 text-amber-600",
    manual: "bg-gray-100 text-gray-500",
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
            Stale Entities
          </span>
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">
            {entities.length}
          </span>
          {staleCount > 0 && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[8px] font-medium text-red-600">
              {staleCount} stale
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-gray-300 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {entities.map((entity) => (
            <div
              key={entity.entity_id}
              onClick={() => onEntityClick?.(entity.entity_id)}
              className={cn(
                "rounded-lg border px-3 py-2 transition-all",
                entity.stale
                  ? "border-amber-200 bg-amber-50/30"
                  : "border-gray-200 bg-white",
                onEntityClick && "cursor-pointer hover:shadow-sm"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11px] font-medium text-gray-800 truncate">
                    {entity.entity_name}
                  </span>
                  {entity.stale && (
                    <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide",
                      touchedByColors[entity.last_touched_by] ?? touchedByColors.manual
                    )}
                  >
                    {entity.last_touched_by.replace(/_/g, " ")}
                  </span>
                  <span
                    className={cn(
                      "text-[9px] font-medium",
                      entity.stale ? "text-amber-600" : "text-gray-400"
                    )}
                  >
                    {entity.days_since_last_touch}d ago
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cadence Recommendation ──

function CadenceRecommendationBanner({
  rec,
  onApply,
}: {
  rec: CadenceRecommendation;
  onApply?: (cadence: string) => void;
}) {
  // Only show when current differs from recommended
  if (rec.current_cadence === rec.recommended_cadence) return null;

  const volatilityColors: Record<string, string> = {
    high: "bg-red-50 text-red-600",
    medium: "bg-amber-50 text-amber-600",
    low: "bg-green-50 text-green-600",
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/50 to-blue-50/30 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-blue-600">
              Cadence Recommendation
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide",
                volatilityColors[rec.landscape_volatility] ?? volatilityColors.medium
              )}
            >
              {rec.landscape_volatility} volatility
            </span>
          </div>
          <p className="text-[11px] text-gray-700 leading-snug">
            Consider switching from{" "}
            <span className="font-semibold text-gray-900">{rec.current_cadence}</span>
            {" "}to{" "}
            <span className="font-semibold text-blue-700">{rec.recommended_cadence}</span>
          </p>
          <p className="mt-1 text-[10px] text-gray-500 leading-snug">
            {rec.reason}
          </p>
        </div>
        {onApply && (
          <button
            onClick={() => onApply(rec.recommended_cadence)}
            className="flex-shrink-0 mt-1 flex items-center gap-0.5 rounded-md bg-blue-100 px-2.5 py-1.5 text-[9px] font-semibold text-blue-700 hover:bg-blue-200 transition-colors"
          >
            Apply
            <ArrowRight className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Panel ──

export function TemporalIntelligencePanel({
  temporal,
  onEntityClick,
  onUpdateCadence,
  className,
}: TemporalIntelligencePanelProps) {
  if (!temporal) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Signal Velocity */}
      <SignalVelocityIndicator velocity={temporal.signal_velocity} />

      {/* Coverage Trajectory */}
      <CoverageTrajectoryChart trajectory={temporal.coverage_trajectory} />

      {/* Stale Entities (collapsed by default) */}
      {temporal.stale_entities.length > 0 && (
        <StaleEntitiesSection
          entities={temporal.stale_entities}
          onEntityClick={onEntityClick}
        />
      )}

      {/* Cadence Recommendation (only when applicable) */}
      {temporal.cadence_recommendation && (
        <CadenceRecommendationBanner
          rec={temporal.cadence_recommendation}
          onApply={onUpdateCadence}
        />
      )}
    </div>
  );
}
