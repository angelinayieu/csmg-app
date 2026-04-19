"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldAlert,
  Zap,
  GitBranch,
  HelpCircle,
  ChevronDown,
  X,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import type { ChangeDetection, ChangeMagnitude } from "@/types/twin";
import type { IntelligenceSignal } from "@/types/intelligence";

interface ChangeAlertModuleProps {
  change: ChangeDetection;
  onDismiss: () => void;
  /** Intelligence signals to surface alongside structural changes (Phase 2.5) */
  intelligenceSignals?: IntelligenceSignal[];
}

const magnitudeConfig: Record<
  ChangeMagnitude,
  { color: string; bg: string; border: string; label: string; icon: React.ReactNode }
> = {
  significant: {
    color: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200",
    label: "Significant change",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  moderate: {
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    label: "Moderate change",
    icon: <Zap className="h-4 w-4" />,
  },
  minor: {
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    label: "Minor refinement",
    icon: <Minus className="h-4 w-4" />,
  },
};

function DeltaBadge({
  icon,
  label,
  count,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: "green" | "red" | "amber" | "blue" | "purple";
}) {
  if (count === 0) return null;

  const colorMap = {
    green: "bg-green-50 text-green-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    purple: "bg-purple-50 text-purple-700",
  };

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", colorMap[color])}>
      {icon}
      {count} {label}
    </span>
  );
}

export function ChangeAlertModule({ change, onDismiss, intelligenceSignals = [] }: ChangeAlertModuleProps) {
  const [expanded, setExpanded] = useState(false);
  const config = magnitudeConfig[change.magnitude];
  const d = change.synthesis_delta;

  const timeAgo = getRelativeTime(change.detected_at);

  return (
    <div className={cn("rounded-xl border", config.border, config.bg, "relative")}>
      {/* Dismiss button */}
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 rounded-md p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>

      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span className={cn("mt-0.5 flex-shrink-0", config.color)}>
          {config.icon}
        </span>
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2">
            <span className={cn("text-[10px] font-semibold uppercase tracking-wider", config.color)}>
              {config.label}
            </span>
            <span className="text-[9px] text-gray-400">{timeAgo}</span>
          </div>
          <p className="text-xs text-gray-700 leading-snug mt-0.5">
            {change.summary}
          </p>

          {/* Health delta pill */}
          {change.health_delta !== 0 && (
            <span
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                change.health_delta > 0
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              )}
            >
              {change.health_delta > 0 ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {change.health_delta > 0 ? "+" : ""}
              {change.health_delta} health
              <span className="font-normal text-[9px] opacity-70">
                ({change.health_before} → {change.health_after})
              </span>
            </span>
          )}
        </div>

        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform mt-1",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-200/50 px-3 py-2.5 space-y-2">
          {/* Delta badges */}
          <div className="flex flex-wrap gap-1.5">
            <DeltaBadge
              icon={<ArrowUpRight className="h-2.5 w-2.5" />}
              label="new leverage"
              count={d.leverage_added.length}
              color="green"
            />
            <DeltaBadge
              icon={<ArrowDownRight className="h-2.5 w-2.5" />}
              label="removed leverage"
              count={d.leverage_removed.length}
              color="amber"
            />
            <DeltaBadge
              icon={<ShieldAlert className="h-2.5 w-2.5" />}
              label="new risk"
              count={d.risk_added.length}
              color="red"
            />
            <DeltaBadge
              icon={<ShieldAlert className="h-2.5 w-2.5" />}
              label="mitigated risk"
              count={d.risk_removed.length}
              color="green"
            />
            <DeltaBadge
              icon={<GitBranch className="h-2.5 w-2.5" />}
              label="new loop"
              count={d.loops_added.length}
              color="blue"
            />
            <DeltaBadge
              icon={<HelpCircle className="h-2.5 w-2.5" />}
              label="new question"
              count={d.questions_new.length}
              color="purple"
            />
            <DeltaBadge
              icon={<HelpCircle className="h-2.5 w-2.5" />}
              label="question resolved"
              count={d.questions_resolved.length}
              color="green"
            />
          </div>

          {/* Bottleneck shift callout */}
          {d.bottleneck_changed && (
            <div className="rounded-md bg-white/50 border border-red-100 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold text-red-600">Bottleneck shift</p>
              <p className="text-[10px] text-gray-600">
                {d.bottleneck_old && d.bottleneck_new
                  ? `${d.bottleneck_old} → ${d.bottleneck_new}`
                  : d.bottleneck_new
                    ? `New: ${d.bottleneck_new}`
                    : "Previous bottleneck resolved"}
              </p>
            </div>
          )}

          {/* Specific findings */}
          {d.leverage_added.length > 0 && (
            <div className="text-[10px] text-gray-500">
              <span className="font-medium text-green-600">New leverage: </span>
              {d.leverage_added.join(", ")}
            </div>
          )}
          {d.risk_added.length > 0 && (
            <div className="text-[10px] text-gray-500">
              <span className="font-medium text-red-600">New risks: </span>
              {d.risk_added.join(", ")}
            </div>
          )}

          {/* Objectives stale warning */}
          {change.objectives_stale && (
            <div className="rounded-md bg-amber-100/60 border border-amber-200 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold text-amber-700">
                Objectives may need review
              </p>
              <p className="text-[10px] text-amber-600">
                Significant structural changes detected. Recommendations and sub-objectives may be outdated.
              </p>
            </div>
          )}

          {/* Intelligence signals (Phase 2.5) */}
          {intelligenceSignals.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-indigo-600">
                  Intelligence Signals
                </span>
                <span className="rounded-full bg-indigo-100 px-1.5 text-[8px] font-bold text-indigo-600">
                  {intelligenceSignals.length}
                </span>
              </div>
              {intelligenceSignals.slice(0, 4).map((sig) => {
                const sevColor =
                  sig.severity === "high" ? "bg-red-400" :
                  sig.severity === "medium" ? "bg-amber-400" : "bg-gray-300";
                const typeLabel =
                  sig.type === "new_entity" ? "New" :
                  sig.type === "new_bridge" ? "Bridge" :
                  sig.type === "authority_change" ? "Authority" :
                  sig.type === "entity_removed" ? "Removed" :
                  sig.type === "confidence_shift" ? "Confidence" :
                  "Source";

                return (
                  <div key={sig.id} className="flex items-start gap-1.5 rounded-md bg-white/50 px-2 py-1">
                    <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0", sevColor)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="rounded bg-indigo-50 px-1 text-[7px] font-semibold text-indigo-500 uppercase">
                          {typeLabel}
                        </span>
                        <span className="text-[9px] font-medium text-gray-700 truncate">
                          {sig.entity_name}
                        </span>
                      </div>
                      <p className="text-[8px] leading-snug text-gray-500 line-clamp-1">
                        {sig.description}
                      </p>
                    </div>
                  </div>
                );
              })}
              {intelligenceSignals.length > 4 && (
                <p className="text-[8px] text-gray-400 text-center">
                  +{intelligenceSignals.length - 4} more signals
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Gap 2: Stale Synthesis Warning ──
// Shown when critique detected that the synthesis is outdated

interface StaleReport {
  stale_leverage_points: string[];
  stale_risk_points: string[];
  stale_feedback_loops: string[];
  stale_action_entity_ids: string[];
  total_stale: number;
  recommendation: "re-synthesize" | "review" | "none";
}

interface StaleSynthesisAlertProps {
  staleReport: StaleReport;
  onResynthesize?: () => void;
  onDismiss: () => void;
}

export function StaleSynthesisAlert({ staleReport, onResynthesize, onDismiss }: StaleSynthesisAlertProps) {
  const [expanded, setExpanded] = useState(false);

  if (staleReport.total_stale === 0) return null;

  const isCritical = staleReport.recommendation === "re-synthesize";

  return (
    <div className={cn(
      "rounded-xl border relative",
      isCritical ? "border-amber-300 bg-amber-50" : "border-yellow-200 bg-yellow-50"
    )}>
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 rounded-md p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span className={cn("mt-0.5 flex-shrink-0", isCritical ? "text-amber-600" : "text-yellow-600")}>
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2">
            <span className={cn("text-[10px] font-semibold uppercase tracking-wider", isCritical ? "text-amber-700" : "text-yellow-700")}>
              {isCritical ? "Synthesis outdated" : "Synthesis may be stale"}
            </span>
          </div>
          <p className="text-xs text-gray-700 leading-snug mt-0.5">
            {staleReport.total_stale} finding{staleReport.total_stale !== 1 ? "s" : ""} affected by recent graph changes
          </p>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform mt-1", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-gray-200/50 px-3 py-2.5 space-y-2">
          {staleReport.stale_leverage_points.length > 0 && (
            <div className="text-[10px] text-gray-600">
              <span className="font-medium text-amber-600">Stale leverage points: </span>
              {staleReport.stale_leverage_points.join(", ")}
            </div>
          )}
          {staleReport.stale_risk_points.length > 0 && (
            <div className="text-[10px] text-gray-600">
              <span className="font-medium text-amber-600">Stale risk points: </span>
              {staleReport.stale_risk_points.join(", ")}
            </div>
          )}
          {staleReport.stale_feedback_loops.length > 0 && (
            <div className="text-[10px] text-gray-600">
              <span className="font-medium text-amber-600">Stale feedback loops: </span>
              {staleReport.stale_feedback_loops.join(", ")}
            </div>
          )}

          {onResynthesize && (
            <button
              onClick={onResynthesize}
              className="mt-1.5 flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-amber-700 transition-colors"
            >
              <TrendingUp className="h-3 w-3" />
              Re-run synthesis
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
