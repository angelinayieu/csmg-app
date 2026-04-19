"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Maximize2,
  Loader2,
  Zap,
  Check,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import type { KnowledgeStackCounts, StackHealth } from "@/types/intelligence-v2";
import type { PriorityDecisionV2 } from "@/types/intelligence-v2";
import type { RadarSummary, IntelligenceSignal, ResearchAgent } from "@/types/intelligence";

// ── Agent callsign naming ──

const CALLSIGNS = ["ATLAS", "ORION", "VEGA", "HELIOS", "LYRA", "NOVA", "CYGNUS", "RIGEL"];

function getAgentCallsign(index: number, agent: ResearchAgent): string {
  const name = CALLSIGNS[index % CALLSIGNS.length];
  // Generate a 2-digit suffix from focus area hash
  const hash = (agent.focus_areas.join("") + agent.id).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const suffix = String(hash % 100).padStart(2, "0");
  return `${name}-${suffix}`;
}

// ── Category badge colors ──

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  competitor: { bg: "bg-blue-100", text: "text-blue-700" },
  framework: { bg: "bg-purple-100", text: "text-purple-700" },
  pattern: { bg: "bg-teal-100", text: "text-teal-700" },
  data_point: { bg: "bg-gray-100", text: "text-gray-700" },
  analogy: { bg: "bg-amber-100", text: "text-amber-700" },
  risk_pattern: { bg: "bg-red-100", text: "text-red-700" },
  resource: { bg: "bg-green-100", text: "text-green-700" },
};

function getCategoryLabel(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Time ago helper ──

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ── Sparkline ──

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[1.5px] h-3">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-[3px] rounded-sm transition-all"
          style={{
            height: `${Math.max(1, (v / max) * 12)}px`,
            backgroundColor: color,
            opacity: 0.4 + (i / values.length) * 0.6,
          }}
        />
      ))}
    </div>
  );
}

// ── Props ──

interface RadarCollapsedViewProps {
  stackCounts: KnowledgeStackCounts;
  stackHealth: StackHealth;
  weakStage: "sources" | "atoms" | "connections" | "insights" | null;
  summary: RadarSummary;
  coverageScore: number;
  attentionItems: Array<{ title: string; reason: string; source: string }>;
  v2Decisions: PriorityDecisionV2[];
  researchLoading: boolean;
  onTriggerResearch: () => void;
  onExpandFullscreen: () => void;
  signalCount?: number;
  agentCount?: number;
  runningAgentCount?: number;
  // New props for redesign
  signals?: IntelligenceSignal[];
  agentFleet?: ResearchAgent[];
  goalName?: string;
}

// ── Main Component ──

export function RadarCollapsedView({
  stackCounts,
  stackHealth,
  weakStage,
  summary,
  coverageScore,
  attentionItems,
  v2Decisions,
  researchLoading,
  onTriggerResearch,
  onExpandFullscreen,
  signalCount = 0,
  agentCount = 0,
  runningAgentCount = 0,
  signals = [],
  agentFleet = [],
  goalName,
}: RadarCollapsedViewProps) {
  const [showWhy, setShowWhy] = useState(false);
  const isLive = runningAgentCount > 0 || researchLoading;
  const topDecision = v2Decisions[0] ?? null;

  // Sort signals by severity then recency
  const sortedSignals = [...signals]
    .filter((s) => s.status !== "dismissed" && s.status !== "resolved")
    .sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2 };
      const sevDiff = (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
    })
    .slice(0, 3);

  const highUrgencyCount = signals.filter((s) => s.severity === "high" && s.status !== "dismissed").length;

  // Find weakest category for coverage gap
  const categories = Object.entries(summary.by_category ?? {});
  const weakestCategory = categories.length > 0
    ? categories.sort((a, b) => a[1] - b[1])[0]?.[0] ?? null
    : null;

  // Sparkline data
  const sparkline = [
    Math.max(1, stackCounts.sources.total * 0.5),
    stackCounts.sources.total,
    stackCounts.atoms.total * 0.6,
    stackCounts.atoms.total,
    stackCounts.connections.typed * 0.7,
    stackCounts.connections.typed,
    stackCounts.insights.total,
  ];

  return (
    <div className="space-y-3">
      {/* ═══ Section 1: Status Header ═══ */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold border",
            isLive
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-gray-50 border-gray-200 text-gray-500"
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full flex-shrink-0",
              isLive ? "bg-green-500 animate-pulse" : "bg-gray-400"
            )} />
            {researchLoading ? "Researching" : runningAgentCount > 0 ? `${runningAgentCount} agent${runningAgentCount > 1 ? "s" : ""} running` : "Idle"}
          </div>
          <div>
            {goalName && (
              <p className="text-[10px] text-gray-400 truncate max-w-[200px]">{goalName}</p>
            )}
            <p className="text-[13px] font-semibold text-gray-800 leading-tight">
              {summary.total_external} signals · {summary.bridge_count} bridges
            </p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[20px] font-bold text-gray-800 tabular-nums leading-none">
            {Math.round(coverageScore)}
            <span className="text-[11px] font-normal text-gray-400 ml-0.5">%</span>
          </p>
          <p className="text-[9px] text-gray-400 mt-0.5">Coverage</p>
        </div>
      </div>

      {/* ═══ Section 2: Top Decision Card ═══ */}
      {topDecision && (
        <div className="rounded-xl border border-gray-200 bg-white p-3.5 space-y-2.5">
          {/* Decision header */}
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-blue-600 font-medium">Decision pending</span>
            <span className="text-gray-300">·</span>
            <span className={cn(
              "font-medium",
              topDecision.due_window === "now" ? "text-red-500" :
              topDecision.due_window === "this_week" ? "text-amber-500" : "text-gray-400"
            )}>
              {topDecision.due_window === "now" ? "Act now" :
               topDecision.due_window === "this_week" ? "This week" : "This month"}
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400">{topDecision.entity_name}</span>
          </div>

          {/* Decision question + actions */}
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-medium text-gray-800 leading-snug flex-1">
              {topDecision.decision_question}
            </p>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-green-600 text-white px-3.5 py-1.5 text-[11px] font-semibold hover:bg-green-700 transition-all active:scale-[0.98] shadow-sm flex-shrink-0"
            >
              <Check className="h-3 w-3" />
              Accept
              <Sparkles className="h-3 w-3 opacity-60" />
            </button>
          </div>

          {/* Confidence bar */}
          <div className="flex items-center gap-2.5">
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-500"
                style={{ width: `${Math.round(topDecision.confidence * 100)}%` }}
              />
            </div>
            <span className="text-[11px] font-semibold text-green-700 tabular-nums flex-shrink-0">
              {Math.round(topDecision.confidence * 100)}%
            </span>
            <span className="text-[9px] text-gray-400 flex-shrink-0">
              confidence · {topDecision.evidence_refs?.length ?? 0} sources · {topDecision.options?.[0]?.reversibility ?? "—"} reversible
            </span>
          </div>

          {/* Action row */}
          <div className="flex items-center justify-between">
            {/* Trigger / affects */}
            <div className="flex items-center gap-2 min-w-0">
              {topDecision.affected_entities?.length > 0 && (
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  <span className="font-semibold text-gray-500 uppercase tracking-wider text-[9px]">Affects</span>
                  {topDecision.affected_entities.slice(0, 2).map((ae, i) => (
                    <span key={i} className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-600 truncate max-w-[100px]">
                      {ae}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Override + Why */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button className="rounded-lg border border-gray-200 px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-all">
                Override
              </button>
              <button
                onClick={() => setShowWhy(!showWhy)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-all",
                  showWhy
                    ? "border-blue-200 bg-blue-50 text-blue-600"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300"
                )}
              >
                Why?
              </button>
            </div>
          </div>

          {/* Why panel (expandable) */}
          {showWhy && topDecision.recommended_reason && (
            <div className="rounded-lg bg-blue-50/70 border border-blue-100 px-3 py-2 text-[11px] text-blue-700 leading-relaxed">
              {topDecision.recommended_reason}
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 3: Metric Cards Strip ═══ */}
      <div className="grid grid-cols-4 gap-2">
        {([
          {
            label: "Signals",
            value: signalCount,
            badge: null,
            color: "#007AFF",
          },
          {
            label: "High severity",
            value: highUrgencyCount,
            badge: highUrgencyCount > 0 ? `${highUrgencyCount}` : null,
            color: "#EF4444",
          },
          {
            label: "Agents",
            value: agentCount > 0 ? `${runningAgentCount}` : "0",
            badge: agentCount > 0 ? `${runningAgentCount} / ${agentCount}` : null,
            color: "#10B981",
          },
          {
            label: "Weakest area",
            value: weakestCategory ? getCategoryLabel(weakestCategory) : "—",
            badge: weakStage ? `${Math.round(100 - coverageScore)}%` : null,
            color: "#F59E0B",
            isText: true,
          },
        ] as const).map((stat, idx) => (
          <div
            key={stat.label}
            className={cn(
              "rounded-xl border border-gray-100 bg-gray-50/60 px-2.5 py-2 hover:border-gray-200 transition-all",
              idx === 1 && highUrgencyCount > 0 && "bg-red-50/40 border-red-100"
            )}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-medium text-gray-400">{stat.label}</span>
              {stat.badge && (
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[8px] font-bold tabular-nums",
                  idx === 1 && highUrgencyCount > 0
                    ? "bg-red-100 text-red-600"
                    : "bg-green-100 text-green-700"
                )}>
                  {stat.badge}
                </span>
              )}
            </div>
            <div className={cn(
              "font-bold tabular-nums leading-none",
              "isText" in stat && stat.isText ? "text-[13px]" : "text-[20px]",
              idx === 1 && highUrgencyCount > 0 ? "text-red-700" : "text-gray-800"
            )}>
              {stat.value}
            </div>
            <div className="mt-1.5">
              <MiniSparkline values={sparkline} color={stat.color} />
            </div>
          </div>
        ))}
      </div>

      {/* ═══ Section 4: Top Signals ═══ */}
      {sortedSignals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
              Top Signals
            </span>
            {signals.length > 3 && (
              <button
                onClick={onExpandFullscreen}
                className="text-[10px] font-medium text-interaxis-600 hover:text-interaxis-700 transition-colors"
              >
                View all {signals.length} →
              </button>
            )}
          </div>
          <div className="space-y-1">
            {sortedSignals.map((signal) => {
              const catStyle = CATEGORY_COLORS[signal.category] ?? CATEGORY_COLORS.pattern;
              return (
                <div
                  key={signal.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 hover:border-gray-200 transition-colors"
                >
                  {/* Category badge */}
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[9px] font-semibold flex-shrink-0",
                    catStyle.bg, catStyle.text
                  )}>
                    {getCategoryLabel(signal.category)}
                  </span>
                  {/* Description */}
                  <p className="text-[11px] text-gray-600 flex-1 min-w-0 truncate">
                    {signal.description}
                  </p>
                  {/* Related entities (max 2 icons) */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {signal.related_internal_entities.slice(0, 2).map((_, i) => (
                      <span key={i} className="h-3.5 w-3.5 rounded bg-gray-100 border border-gray-200 flex items-center justify-center text-[7px] text-gray-400 font-bold">
                        {i === 0 ? "○" : "▽"}
                      </span>
                    ))}
                  </div>
                  {/* Severity */}
                  <span className={cn(
                    "text-[10px] font-semibold flex-shrink-0",
                    signal.severity === "high" ? "text-red-600" :
                    signal.severity === "medium" ? "text-amber-600" : "text-gray-400"
                  )}>
                    {signal.severity === "high" ? "High" : signal.severity === "medium" ? "Med" : "Low"}
                  </span>
                  {/* Time ago */}
                  <span className="text-[9px] text-gray-400 tabular-nums flex-shrink-0 w-6 text-right">
                    {timeAgo(signal.detected_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Section 5: Fleet Strip + Actions ═══ */}
      <div className="space-y-2.5 pt-0.5">
        {/* Fleet row */}
        {agentFleet.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Fleet</span>
              <button
                onClick={onExpandFullscreen}
                className="text-[10px] font-medium text-interaxis-600 hover:text-interaxis-700 transition-colors"
              >
                Agent details →
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {agentFleet.slice(0, 5).map((agent, i) => {
                const isRunning = agent.status === "running";
                const isCompleted = agent.status === "completed";
                return (
                  <div
                    key={agent.id}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 hover:border-gray-300 transition-colors"
                  >
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full flex-shrink-0",
                      isRunning ? "bg-green-500 animate-pulse" :
                      isCompleted ? "bg-green-500" :
                      agent.status === "error" ? "bg-red-500" :
                      "bg-gray-400"
                    )} />
                    <span className="text-[10px] font-bold text-gray-700 tracking-wide">
                      {getAgentCallsign(i, agent)}
                    </span>
                    <span className="text-[10px] text-gray-400 tabular-nums">
                      {agent.findings_count}
                    </span>
                    {agent.status === "idle" && (
                      <span className="text-[8px] text-gray-400">· idle</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={onTriggerResearch}
            disabled={researchLoading}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[11px] font-medium transition-all",
              researchLoading
                ? "bg-gray-100 text-gray-400 border border-gray-200"
                : "bg-gray-900 text-white hover:bg-gray-800 shadow-sm active:scale-[0.98]"
            )}
          >
            {researchLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            {researchLoading ? "Researching..." : "Research"}
          </button>
          <button
            onClick={onExpandFullscreen}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98]"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Expand
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compute which stage of the knowledge stack is the weakest.
 */
export function computeWeakStage(health: StackHealth): "sources" | "atoms" | "connections" | "insights" | null {
  const thresholds: Array<{ stage: "sources" | "atoms" | "connections" | "insights"; score: number; min: number }> = [
    { stage: "sources", score: health.source_diversity / 10, min: 0.3 },
    { stage: "connections", score: Math.min(1, health.connection_density * 10), min: 0.3 },
    { stage: "insights", score: Math.min(1, health.insight_yield * 5), min: 0.15 },
  ];

  let weakest: (typeof thresholds)[number] | null = null;
  for (const t of thresholds) {
    if (t.score < t.min) {
      if (!weakest || t.score < weakest.score) weakest = t;
    }
  }
  return weakest?.stage ?? null;
}
