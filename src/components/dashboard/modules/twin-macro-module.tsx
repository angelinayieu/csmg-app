"use client";

import { useMemo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { TrajectoryModule } from "@/components/dashboard/modules/trajectory-module";
import { RecommendationModule } from "@/components/dashboard/modules/recommendation-module";
import { ChangeAlertModule, StaleSynthesisAlert } from "@/components/dashboard/modules/change-alert-module";
import type { IntelligenceSignal } from "@/types/intelligence";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import {
  Activity,
  BarChart3,
  ShieldAlert,
  RefreshCw,
  ArrowUpRight,
  HelpCircle,
  Zap,
  Eye,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Ban,
  GitBranch,
  ChevronDown,
} from "lucide-react";
import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal, GoalRecommendation } from "@/types/goals";
import type { ObjectiveBenchmark } from "@/types/goals";
import type { TwinMacroState, ChangeDetection } from "@/types/twin";

import type { SuggestedObjective } from "@/types/goals";
import type { InventoryHighlight } from "@/components/dashboard/dashboard-grid";
import { SuggestedObjectivesModule } from "@/components/dashboard/modules/suggested-objectives-module";

interface TwinMacroModuleProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  activeGoal: ImprovementGoal | null;
  childGoals?: ImprovementGoal[];
  /** Full goals list for recursive progress computation across nested sub-objectives */
  allGoals?: ImprovementGoal[];
  onStatClick?: (highlight: InventoryHighlight) => void;
  onAcceptObjective?: (objective: SuggestedObjective) => void | Promise<void>;
}

// ── Health score ring (SVG) ──

function HealthRing({ score, label, size = 80 }: { score: number; label: string; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const colorMap: Record<string, string> = {
    strong: "#22C55E",
    developing: "#6366F1",
    fragile: "#F59E0B",
    critical: "#EF4444",
  };
  const color = colorMap[label] ?? "#6366F1";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#F3F4F6"
          strokeWidth={5}
        />
        {/* Score ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-lg font-bold text-gray-900">{score}</span>
        <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  );
}

// ── Stat pill ──

function StatPill({
  icon,
  label,
  value,
  color = "gray",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: "gray" | "red" | "amber" | "green" | "blue" | "purple";
  onClick?: () => void;
}) {
  const colorMap = {
    gray: "bg-gray-50 text-gray-600",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-green-50 text-green-700",
    blue: "bg-blue-50 text-blue-700",
    purple: "bg-purple-50 text-purple-700",
  };

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-left",
        colorMap[color],
        onClick && "cursor-pointer hover:ring-1 hover:ring-gray-300 transition-all"
      )}
    >
      <span className="flex-shrink-0 opacity-60">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] opacity-70 truncate">{label}</div>
        <div className="text-sm font-semibold leading-tight">{value}</div>
      </div>
    </Wrapper>
  );
}

// ── Maturity badge ──

function MaturityBadge({ maturity }: { maturity: TwinMacroState["maturity"] }) {
  const config: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
    actionable_now: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Actionable",
      className: "bg-green-50 text-green-700 border-green-200",
    },
    waiting_on_dependency: {
      icon: <Clock className="h-3 w-3" />,
      label: "Waiting",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    },
    theoretical: {
      icon: <Eye className="h-3 w-3" />,
      label: "Theoretical",
      className: "bg-blue-50 text-blue-700 border-blue-200",
    },
    blocked: {
      icon: <Ban className="h-3 w-3" />,
      label: "Blocked",
      className: "bg-red-50 text-red-700 border-red-200",
    },
  };

  const c = config[maturity] ?? config.theoretical;

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", c.className)}>
      {c.icon}
      {c.label}
    </span>
  );
}

// ── Confidence bar ──

function ConfidenceBar({ high, medium, low, onSegmentClick }: {
  high: number;
  medium: number;
  low: number;
  onSegmentClick?: (level: "high" | "medium" | "low") => void;
}) {
  const total = high + medium + low;
  if (total === 0) return null;
  const hPct = (high / total) * 100;
  const mPct = (medium / total) * 100;
  const lPct = (low / total) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-500">Confidence distribution</span>
        <span className="text-[10px] text-gray-400">{total} entities</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <button onClick={() => onSegmentClick?.("high")} className="bg-green-400 transition-all hover:bg-green-500 cursor-pointer" style={{ width: `${hPct}%` }} title={`High: ${high}`} />
        <button onClick={() => onSegmentClick?.("medium")} className="bg-amber-400 transition-all hover:bg-amber-500 cursor-pointer" style={{ width: `${mPct}%` }} title={`Medium: ${medium}`} />
        <button onClick={() => onSegmentClick?.("low")} className="bg-red-400 transition-all hover:bg-red-500 cursor-pointer" style={{ width: `${lPct}%` }} title={`Low: ${low}`} />
      </div>
      <div className="flex justify-between mt-0.5">
        <button onClick={() => onSegmentClick?.("high")} className="text-[9px] text-green-600 hover:underline cursor-pointer">{high} high</button>
        <button onClick={() => onSegmentClick?.("medium")} className="text-[9px] text-amber-600 hover:underline cursor-pointer">{medium} mid</button>
        <button onClick={() => onSegmentClick?.("low")} className="text-[9px] text-red-500 hover:underline cursor-pointer">{low} low</button>
      </div>
    </div>
  );
}

// ── Sub-objectives progress section ──

function SubObjectivesProgress({
  children,
  parentTitle,
  allGoals,
}: {
  children: ImprovementGoal[];
  parentTitle: string;
  allGoals?: ImprovementGoal[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (children.length === 0) return null;

  const activeChildren = children.filter((c) => c.status === "active");
  const completedCount = children.filter((c) => c.status === "achieved").length;

  // Count total descendants for richer display
  const totalDescendants = useMemo(() => {
    if (!allGoals) return children.length;
    let count = 0;
    function walk(parentId: string) {
      const kids = allGoals!.filter((g) => g.parent_goal_id === parentId);
      count += kids.length;
      for (const k of kids) walk(k.id);
    }
    for (const c of children) {
      count++; // count the child itself
      walk(c.id);
    }
    return count;
  }, [children, allGoals]);

  // Compute progress accounting for grandchildren
  const computeChildProgress = (child: ImprovementGoal): number => {
    if (!allGoals) {
      const range = Number(child.target_value) - Number(child.baseline_value);
      return range > 0
        ? Math.max(0, Math.min(100, ((Number(child.current_value) - Number(child.baseline_value)) / range) * 100))
        : 0;
    }
    // Check for grandchildren — if they exist, average their progress
    const grandchildren = allGoals.filter((g) => g.parent_goal_id === child.id);
    if (grandchildren.length > 0) {
      let total = 0;
      for (const gc of grandchildren) total += computeChildProgress(gc);
      return total / grandchildren.length;
    }
    const range = Number(child.target_value) - Number(child.baseline_value);
    return range > 0
      ? Math.max(0, Math.min(100, ((Number(child.current_value) - Number(child.baseline_value)) / range) * 100))
      : 0;
  };

  return (
    <DashboardCard
      title="Sub-Objectives"
      icon={<GitBranch className="h-4 w-4" />}
      subtitle={`${completedCount}/${children.length} complete${totalDescendants > children.length ? ` (${totalDescendants} total)` : ""}`}
      collapsible={false}
    >
      <div className="space-y-2">
        {/* Aggregate progress bar */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
          {children.map((child) => {
            const pct = computeChildProgress(child);
            const widthPct = 100 / children.length;

            return (
              <div
                key={child.id}
                className="relative"
                style={{ width: `${widthPct}%` }}
                title={`${child.title}: ${Math.round(pct)}%`}
              >
                <div className="h-full bg-gray-100">
                  <div
                    className={cn(
                      "h-full transition-all",
                      child.status === "achieved"
                        ? "bg-green-400"
                        : pct > 50
                          ? "bg-interaxis-500"
                          : "bg-interaxis-300"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Child goal rows */}
        {activeChildren.slice(0, expanded ? undefined : 3).map((child) => {
          const pct = Math.round(computeChildProgress(child));
          const grandchildCount = allGoals
            ? allGoals.filter((g) => g.parent_goal_id === child.id).length
            : 0;

          const typeConfig: Record<string, { color: string }> = {
            maximize: { color: "text-green-600" },
            minimize: { color: "text-red-600" },
            maintain: { color: "text-blue-600" },
            explore: { color: "text-purple-600" },
            avoid: { color: "text-amber-600" },
          };
          const tc = typeConfig[child.objective_type] ?? { color: "text-gray-600" };

          return (
            <div key={child.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
              <span className={cn("text-[9px] font-bold uppercase", tc.color)}>
                {child.objective_type.slice(0, 3)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-[11px] font-medium text-gray-700 truncate">{child.title}</p>
                  {grandchildCount > 0 && (
                    <span className="text-[8px] text-gray-400 flex-shrink-0">
                      ({grandchildCount} sub)
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <div className="h-1 flex-1 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-interaxis-400 transition-all"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 flex-shrink-0">{pct}%</span>
                </div>
              </div>
            </div>
          );
        })}

        {activeChildren.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center justify-center gap-1 text-[10px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            {expanded ? "Show less" : `+${activeChildren.length - 3} more`}
            <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
    </DashboardCard>
  );
}

// ── Main component ──

export function TwinMacroModule({
  space,
  entities,
  edges,
  cycles,
  activeGoal,
  childGoals = [],
  allGoals,
  onStatClick,
  onAcceptObjective,
}: TwinMacroModuleProps) {
  // Parse synthesis data
  const synthesisData = useMemo<SynthesisData | null>(() => {
    if (!space.synthesis_data) return null;
    try {
      return (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  }, [space.synthesis_data]);

  // Extract benchmark for active goal
  const activeBenchmark = useMemo<ObjectiveBenchmark | null>(() => {
    if (!activeGoal || !synthesisData) return null;
    const sd = synthesisData as unknown as Record<string, unknown>;
    const goalBenchmarks = sd.goal_benchmarks as Record<string, ObjectiveBenchmark> | undefined;
    return goalBenchmarks?.[activeGoal.id] ?? null;
  }, [activeGoal, synthesisData]);

  // Change detection from latest synthesis refresh
  const [changeDismissed, setChangeDismissed] = useState(false);
  const lastChange = useMemo<ChangeDetection | null>(() => {
    if (changeDismissed) return null;
    const lc = synthesisData?.last_change;
    if (!lc || typeof lc !== "object") return null;
    // Only show if detected within last 24 hours
    const age = Date.now() - new Date((lc as ChangeDetection).detected_at).getTime();
    if (age > 24 * 60 * 60 * 1000) return null;
    return lc as ChangeDetection;
  }, [synthesisData?.last_change, changeDismissed]);

  // Stale synthesis alert
  const [staleDismissed, setStaleDismissed] = useState(false);
  const staleReport = useMemo(() => {
    if (staleDismissed) return null;
    if (!synthesisData?.is_stale && !synthesisData?.stale_report) return null;
    const sr = synthesisData?.stale_report;
    if (!sr || sr.total_stale === 0) return null;
    return sr;
  }, [synthesisData?.stale_report, synthesisData?.is_stale, staleDismissed]);

  // Suggested objectives from synthesis — top-level OR sub-objectives
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const suggestedObjectives = useMemo<SuggestedObjective[]>(() => {
    const raw = synthesisData?.suggested_objectives;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw.filter((o) => !dismissedKeys.has(o.key));
  }, [synthesisData?.suggested_objectives, dismissedKeys]);

  // Sub-objective suggestions (top-level objectives are handled by Objective Command Center)
  const subObjectiveSuggestions = useMemo(
    () => activeGoal
      ? suggestedObjectives.filter((o) => o.parent_goal_id === activeGoal.id)
      : [],
    [suggestedObjectives, activeGoal]
  );

  // Fetch recommendations if goal active (for overlay)
  const [recommendations, setRecommendations] = useState<GoalRecommendation[]>([]);
  useEffect(() => {
    if (!activeGoal) {
      setRecommendations([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/goals/${activeGoal.id}/recommendations`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data) setRecommendations(data.recommendations ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeGoal?.id]);

  // Compute twin state
  const twinState = useMemo(
    () => computeTwinState(space, entities, edges, cycles, synthesisData, activeGoal, recommendations),
    [space, entities, edges, cycles, synthesisData, activeGoal, recommendations]
  );

  const { macro, goal_overlay } = twinState;
  const cd = macro.coverage.confidence_distribution;
  const timeAgo = getTimeAgo(macro.last_updated);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Card 1: System State (always visible) ── */}
      <DashboardCard
        title="System State"
        icon={<Activity className="h-4 w-4" />}
        subtitle={`${macro.analysis_tier} analysis · updated ${timeAgo}`}
        collapsible={false}
        headerRight={<MaturityBadge maturity={macro.maturity} />}
      >
        <div className="space-y-4">
          {/* Health ring + key stats */}
          <div className="flex items-start gap-4">
            <div className="relative">
              <HealthRing score={macro.health_score} label={macro.health_label} />
              {lastChange && lastChange.health_delta !== 0 && (
                <span
                  className={cn(
                    "absolute -top-1 -right-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                    lastChange.health_delta > 0
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  )}
                >
                  {lastChange.health_delta > 0 ? "+" : ""}
                  {lastChange.health_delta}
                </span>
              )}
            </div>

            <div className="flex-1 grid grid-cols-2 gap-2">
              <StatPill
                icon={<ShieldAlert className="h-3 w-3" />}
                label="Risk exposure"
                value={macro.risk_exposure.total_risk_points > 0
                  ? `${macro.risk_exposure.total_risk_points} risks`
                  : "None detected"}
                color={macro.risk_exposure.critical_risks > 0 ? "red" : macro.risk_exposure.total_risk_points > 0 ? "amber" : "green"}
                onClick={macro.risk_exposure.total_risk_points > 0
                  ? () => onStatClick?.({ type: "role", role: "risk" })
                  : undefined}
              />
              <StatPill
                icon={<RefreshCw className="h-3 w-3" />}
                label="Active dynamics"
                value={`${macro.dynamics.total_loops} loops`}
                color={macro.dynamics.reinforcing_negative > 0 ? "amber" : macro.dynamics.total_loops > 0 ? "blue" : "gray"}
              />
              <StatPill
                icon={<ArrowUpRight className="h-3 w-3" />}
                label="Leverage points"
                value={macro.dynamics.leverage_points}
                color={macro.dynamics.leverage_points > 0 ? "green" : "gray"}
                onClick={macro.dynamics.leverage_points > 0
                  ? () => onStatClick?.({ type: "role", role: "leverage" })
                  : undefined}
              />
              <StatPill
                icon={<HelpCircle className="h-3 w-3" />}
                label="Open questions"
                value={macro.coverage.open_questions}
                color={macro.coverage.open_questions > 3 ? "amber" : "gray"}
              />
            </div>
          </div>

          {/* Confidence distribution */}
          <ConfidenceBar
            high={cd.high}
            medium={cd.medium}
            low={cd.low}
            onSegmentClick={(level) => onStatClick?.({ type: "confidence", level })}
          />

          {/* Bottleneck callout (if exists) */}
          {macro.risk_exposure.bottleneck_name && (
            <div className="rounded-lg border border-red-200 bg-red-50/40 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-red-500" />
                <span className="text-[11px] font-semibold text-red-700">Top Constraint</span>
              </div>
              <p className="mt-0.5 text-xs text-red-600">
                {macro.risk_exposure.bottleneck_name}
                <span className="ml-1 text-red-400">
                  — {macro.risk_exposure.bottleneck_system_share}% of system
                </span>
              </p>
            </div>
          )}

          {/* Quick stats row */}
          <div className="flex items-center gap-3 text-[10px] text-gray-400 border-t border-gray-100 pt-2">
            <span>{macro.coverage.entities_modeled} entities</span>
            <span className="text-gray-200">·</span>
            <span>{macro.coverage.edges_mapped} edges</span>
            <span className="text-gray-200">·</span>
            <span>{macro.coverage.cycles_detected} cycles</span>
            {macro.coverage.contradictions > 0 && (
              <>
                <span className="text-gray-200">·</span>
                <span className="text-amber-500">
                  <Zap className="inline h-2.5 w-2.5" /> {macro.coverage.contradictions} contradictions
                </span>
              </>
            )}
            {macro.external_entities > 0 && (
              <>
                <span className="text-gray-200">·</span>
                <span className="text-purple-500">{macro.external_entities} external</span>
              </>
            )}
          </div>
        </div>
      </DashboardCard>

      {/* ── Change Alert (shows when recent synthesis detected changes) ── */}
      {lastChange && lastChange.magnitude !== "minor" && (
        <ChangeAlertModule
          change={lastChange}
          onDismiss={() => setChangeDismissed(true)}
          intelligenceSignals={
            ((synthesisData as unknown as Record<string, unknown>)?.intelligence_radar as
              { signals?: IntelligenceSignal[] } | undefined
            )?.signals?.filter((s) => s.severity === "high" || s.severity === "medium")
          }
        />
      )}

      {/* ── Stale Synthesis Alert (shows when critique found stale findings) ── */}
      {staleReport && (
        <StaleSynthesisAlert
          staleReport={staleReport}
          onDismiss={() => setStaleDismissed(true)}
        />
      )}

      {/* ── Card 2: Goal Trajectory (only if goal active) ── */}
      {activeGoal && (
        <TrajectoryModule goal={activeGoal} />
      )}

      {/* ── Card 2B: Benchmark Status (compact) ── */}
      {activeGoal && activeBenchmark && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/30 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-[11px] font-semibold text-teal-700">Evaluation Criteria</span>
            <span className="text-[9px] text-teal-500 ml-auto">
              {activeBenchmark.success_criteria.filter(sc => sc.priority === "must_have").length} must-have
            </span>
          </div>

          {activeBenchmark.evaluation_approach && (
            <p className="text-[10px] text-teal-600 italic mb-2">{activeBenchmark.evaluation_approach}</p>
          )}

          {/* Leading indicators traffic-light */}
          {activeBenchmark.leading_indicators.length > 0 && (
            <div className="space-y-1.5">
              {activeBenchmark.leading_indicators.slice(0, 3).map((li, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Activity className="h-3 w-3 text-teal-500 flex-shrink-0" />
                  <span className="text-[10px] font-medium text-gray-700 flex-1 truncate">{li.metric}</span>
                  <div className="flex items-center gap-1">
                    <span className="rounded bg-emerald-50 px-1 py-0 text-[8px] font-medium text-emerald-600">✓ {li.on_track}</span>
                    <span className="rounded bg-amber-50 px-1 py-0 text-[8px] font-medium text-amber-600">⚠ {li.at_risk}</span>
                    <span className="rounded bg-red-50 px-1 py-0 text-[8px] font-medium text-red-600">✗ {li.off_track}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Milestones progress row */}
          {activeBenchmark.milestones.length > 0 && (
            <div className="mt-2 flex items-center gap-1 overflow-x-auto">
              {activeBenchmark.milestones.map((ms, i) => (
                <div key={i} className="flex items-center gap-1 flex-shrink-0">
                  {i > 0 && <span className="text-[8px] text-gray-300">→</span>}
                  <span className="rounded bg-white border border-teal-100 px-1.5 py-0.5 text-[8px] text-gray-600">
                    {ms.name} <span className="text-teal-500">({ms.expected_by})</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Failure signals (warning) */}
          {activeBenchmark.failure_signals.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-[9px] text-amber-600">
                {activeBenchmark.failure_signals.map((fs, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    {fs.signal} → <span className="font-medium">{fs.response.replace("_", " ")}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Card 3: Sub-Objectives Progress (if goal has children) ── */}
      {activeGoal && childGoals.length > 0 && (
        <SubObjectivesProgress children={childGoals} parentTitle={activeGoal.title} allGoals={allGoals} />
      )}

      {/* ── Card 4: Suggested Sub-Objectives (if goal active, no children yet, suggestions exist) ── */}
      {activeGoal && childGoals.length === 0 && subObjectiveSuggestions.length > 0 && (
        <SuggestedObjectivesModule
          objectives={subObjectiveSuggestions}
          onAccept={(obj) => onAcceptObjective?.(obj)}
          onDismiss={(key) => setDismissedKeys((prev) => new Set([...prev, key]))}
        />
      )}

      {/* ── Card 5: Goal Recommendations (only if goal active) ── */}
      {activeGoal && (
        <RecommendationModule goalId={activeGoal.id} />
      )}

      {/* Objectives are shown in the Objective Command Center (full-width, above columns) */}
    </div>
  );
}

// ── Helper: relative time ──

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
