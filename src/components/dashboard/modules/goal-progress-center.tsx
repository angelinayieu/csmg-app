"use client";

import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import {
  Target,
  TrendingUp,
  Activity,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  ArrowRight,
  Search,
  Plus,
  BarChart3,
  ShieldAlert,
  RefreshCw,
  HelpCircle,
  CircleDot,
  Crosshair,
  Flame,
  Radar,
} from "lucide-react";
import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type {
  ImprovementGoal,
  GoalProgress,
  GoalRecommendation,
  ObjectiveBenchmark,
} from "@/types/goals";

// ── Props ──

interface GoalProgressCenterProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  activeGoal: ImprovementGoal | null;
  goalProgress: GoalProgress[];
  recommendations: GoalRecommendation[];
  benchmark: ObjectiveBenchmark | null;
  onDetectObjectives?: () => void;
  onRecordProgress?: () => void;
  objectiveAutoLoading?: boolean;
}

// ── Status determination ──

type GoalTrackingStatus = "on_track" | "at_risk" | "off_track" | "no_goal";

function determineGoalStatus(
  goal: ImprovementGoal | null,
  progress: GoalProgress[]
): GoalTrackingStatus {
  if (!goal) return "no_goal";

  const range = Number(goal.target_value) - Number(goal.baseline_value);
  if (range <= 0) return "on_track";

  const currentProgress =
    (Number(goal.current_value) - Number(goal.baseline_value)) / range;

  // If there is a deadline, compare time elapsed vs progress made
  if (goal.deadline) {
    const now = Date.now();
    const created = new Date(goal.created_at).getTime();
    const deadline = new Date(goal.deadline).getTime();
    const totalDuration = deadline - created;
    const elapsed = now - created;
    const timeProgress = totalDuration > 0 ? elapsed / totalDuration : 1;

    // If past deadline and not complete
    if (now > deadline && currentProgress < 0.95) return "off_track";

    // Significantly behind schedule
    if (timeProgress > 0 && currentProgress / timeProgress < 0.5)
      return "off_track";
    if (timeProgress > 0 && currentProgress / timeProgress < 0.8)
      return "at_risk";
    return "on_track";
  }

  // No deadline: just check progress percentage
  if (currentProgress >= 0.5) return "on_track";
  if (currentProgress >= 0.2) return "at_risk";
  return "off_track";
}

function getStatusConfig(status: GoalTrackingStatus) {
  switch (status) {
    case "on_track":
      return {
        label: "on track",
        dotColor: "bg-emerald-400",
        pillBg: "bg-emerald-500/10",
        pillText: "text-emerald-400",
        pillBorder: "border-emerald-500/20",
      };
    case "at_risk":
      return {
        label: "at risk",
        dotColor: "bg-amber-400",
        pillBg: "bg-amber-500/10",
        pillText: "text-amber-400",
        pillBorder: "border-amber-500/20",
      };
    case "off_track":
      return {
        label: "off track",
        dotColor: "bg-red-400",
        pillBg: "bg-red-500/10",
        pillText: "text-red-400",
        pillBorder: "border-red-500/20",
      };
    case "no_goal":
      return {
        label: "no goal yet",
        dotColor: "bg-gray-400",
        pillBg: "bg-gray-500/10",
        pillText: "text-gray-400",
        pillBorder: "border-gray-500/20",
      };
  }
}

// ── Days left helper ──

function getDaysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ── Trajectory SVG Chart ──

function TrajectoryChart({
  progress,
  baseline,
  target,
  deadline,
  currentValue,
}: {
  progress: GoalProgress[];
  baseline: number;
  target: number;
  deadline: string | null;
  currentValue: number;
}) {
  const W = 360;
  const H = 140;
  const PAD = { top: 16, right: 16, bottom: 24, left: 16 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = progress.map((p) => Number(p.value));
  const allValues = [baseline, target, currentValue, ...values];
  const minVal = Math.min(...allValues) * 0.9;
  const maxVal = Math.max(...allValues) * 1.1;
  const range = maxVal - minVal || 1;

  const scaleY = (v: number) =>
    PAD.top + plotH - ((v - minVal) / range) * plotH;
  const scaleX = (i: number) =>
    PAD.left +
    (progress.length > 1
      ? (i / (progress.length - 1)) * (plotW * 0.7)
      : plotW * 0.35);

  // Build progress line path
  const linePath =
    progress.length > 1
      ? progress
          .map(
            (_, i) =>
              `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(values[i])}`
          )
          .join(" ")
      : "";

  // Last point coordinates for projection line
  const lastIdx = progress.length - 1;
  const lastX = progress.length > 0 ? scaleX(lastIdx) : PAD.left;
  const lastY =
    progress.length > 0 ? scaleY(values[lastIdx]) : scaleY(baseline);

  // Target point (at right edge)
  const targetX = PAD.left + plotW;
  const targetY = scaleY(target);

  // Grid lines
  const gridLines = 4;
  const gridStep = plotH / gridLines;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines */}
      {Array.from({ length: gridLines + 1 }).map((_, i) => (
        <line
          key={i}
          x1={PAD.left}
          y1={PAD.top + i * gridStep}
          x2={W - PAD.right}
          y2={PAD.top + i * gridStep}
          stroke="#D1D5DB"
          strokeWidth={0.5}
          opacity={0.15}
        />
      ))}

      {/* Target dashed line */}
      <line
        x1={PAD.left}
        y1={targetY}
        x2={W - PAD.right}
        y2={targetY}
        stroke="#22C55E"
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.4}
      />

      {/* Progress line */}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke="#818CF8"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Projection dashed line from current to target */}
      {progress.length > 0 && (
        <line
          x1={lastX}
          y1={lastY}
          x2={targetX}
          y2={targetY}
          stroke="#818CF8"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          opacity={0.5}
        />
      )}

      {/* Data point dots */}
      {progress.map((_, i) => (
        <circle
          key={i}
          cx={scaleX(i)}
          cy={scaleY(values[i])}
          r={i === lastIdx ? 5 : 3}
          fill={i === lastIdx ? "#818CF8" : "#F9FAFB"}
          stroke={i === lastIdx ? "#818CF8" : "#9CA3AF"}
          strokeWidth={i === lastIdx ? 0 : 1.5}
        />
      ))}

      {/* Current value label */}
      {progress.length > 0 && (
        <g>
          <rect
            x={lastX - 28}
            y={lastY - 22}
            width={56}
            height={16}
            rx={4}
            fill="#EEF2FF"
          />
          <text
            x={lastX}
            y={lastY - 11}
            textAnchor="middle"
            fontSize={9}
            fontWeight={600}
            fill="#4338CA"
          >
            now: {currentValue}
          </text>
        </g>
      )}

      {/* Target value label */}
      <g>
        <circle
          cx={targetX}
          cy={targetY}
          r={5}
          fill="none"
          stroke="#22C55E"
          strokeWidth={2}
        />
        <text
          x={targetX}
          y={targetY - 10}
          textAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill="#16A34A"
        >
          target: {target}
        </text>
      </g>

      {/* X-axis date labels */}
      {progress.length >= 2 && (
        <>
          <text
            x={PAD.left}
            y={H - 4}
            fontSize={8}
            fill="#6B7280"
          >
            {new Date(progress[0].recorded_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </text>
          <text
            x={scaleX(lastIdx)}
            y={H - 4}
            textAnchor="middle"
            fontSize={8}
            fill="#6B7280"
          >
            {new Date(
              progress[progress.length - 1].recorded_at
            ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </text>
        </>
      )}

      {deadline && (
        <text
          x={targetX}
          y={H - 4}
          textAnchor="end"
          fontSize={8}
          fill="#6B7280"
        >
          {new Date(deadline).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </text>
      )}
    </svg>
  );
}

// ── Health Ring (reused from twin-macro-module pattern) ──

function HealthRing({
  score,
  label,
  size = 64,
}: {
  score: number;
  label: string;
  size?: number;
}) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const colorMap: Record<string, string> = {
    strong: "#22C55E",
    developing: "#818CF8",
    fragile: "#F59E0B",
    critical: "#EF4444",
  };
  const color = colorMap[label] ?? "#818CF8";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-sm font-bold text-gray-900">{score}</span>
        <span
          className="text-[8px] font-medium uppercase tracking-wider"
          style={{ color }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// ── Confidence Bar (dark variant) ──

function ConfidenceBarDark({
  high,
  medium,
  low,
}: {
  high: number;
  medium: number;
  low: number;
}) {
  const total = high + medium + low;
  if (total === 0) return null;
  const hPct = (high / total) * 100;
  const mPct = (medium / total) * 100;
  const lPct = (low / total) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-500">
          Confidence distribution
        </span>
        <span className="text-[10px] text-gray-400">{total} entities</span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="bg-emerald-500 transition-all"
          style={{ width: `${hPct}%` }}
          title={`High: ${high}`}
        />
        <div
          className="bg-amber-500 transition-all"
          style={{ width: `${mPct}%` }}
          title={`Medium: ${medium}`}
        />
        <div
          className="bg-red-500 transition-all"
          style={{ width: `${lPct}%` }}
          title={`Low: ${low}`}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-emerald-500">{high} high</span>
        <span className="text-[9px] text-amber-500">{medium} mid</span>
        <span className="text-[9px] text-red-400">{low} low</span>
      </div>
    </div>
  );
}

// ── Crux status determination ──

type CruxStatus = "addressing" | "stalled" | "resolved" | "none";

function determineCruxStatus(
  bottleneckName: string | null,
  recommendations: GoalRecommendation[]
): CruxStatus {
  if (!bottleneckName) return "none";

  // Check if any in-progress recommendation targets the bottleneck
  const hasInProgress = recommendations.some(
    (r) => r.status === "in_progress"
  );
  const allCompleted = recommendations.filter(
    (r) => r.status === "completed"
  ).length;

  // If all recommendations are completed, bottleneck may be resolved
  if (allCompleted > 0 && recommendations.every((r) => r.status === "completed" || r.status === "dismissed"))
    return "resolved";

  if (hasInProgress) return "addressing";
  return "stalled";
}

function getCruxStatusConfig(status: CruxStatus) {
  switch (status) {
    case "addressing":
      return {
        label: "actively addressing",
        color: "text-emerald-400",
        bg: "bg-emerald-500/10",
        dotColor: "bg-emerald-400",
      };
    case "stalled":
      return {
        label: "stalled",
        color: "text-amber-400",
        bg: "bg-amber-500/10",
        dotColor: "bg-amber-400",
      };
    case "resolved":
      return {
        label: "resolved",
        color: "text-emerald-400",
        bg: "bg-emerald-500/10",
        dotColor: "bg-emerald-400",
      };
    case "none":
      return {
        label: "none identified",
        color: "text-gray-500",
        bg: "bg-gray-500/10",
        dotColor: "bg-gray-500",
      };
  }
}

// ── Main Component ──

export function GoalProgressCenter({
  space,
  entities,
  edges,
  cycles,
  activeGoal,
  goalProgress,
  recommendations,
  benchmark,
  onDetectObjectives,
  onRecordProgress,
  objectiveAutoLoading,
}: GoalProgressCenterProps) {
  const [qualityExpanded, setQualityExpanded] = useState(false);
  const [intelGoalIds, setIntelGoalIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!activeGoal?.space_id) {
      setIntelGoalIds(new Set());
      return;
    }
    try {
      const raw = window.localStorage.getItem(`interaxis:intel-goal-links:${activeGoal.space_id}`);
      if (!raw) {
        setIntelGoalIds(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, string>;
      setIntelGoalIds(new Set(Object.keys(parsed)));
    } catch {
      setIntelGoalIds(new Set());
    }
  }, [activeGoal?.space_id]);

  // Parse synthesis data
  const synthesisData = useMemo<SynthesisData | null>(() => {
    if (!space.synthesis_data) return null;
    try {
      return (
        typeof space.synthesis_data === "string"
          ? JSON.parse(space.synthesis_data)
          : space.synthesis_data
      ) as SynthesisData;
    } catch {
      return null;
    }
  }, [space.synthesis_data]);

  // Compute twin state for analysis quality section
  const twinState = useMemo(
    () =>
      computeTwinState(
        space,
        entities,
        edges,
        cycles,
        synthesisData,
        activeGoal,
        recommendations
      ),
    [space, entities, edges, cycles, synthesisData, activeGoal, recommendations]
  );

  const { macro } = twinState;
  const cd = macro.coverage.confidence_distribution;

  // Goal status
  const goalStatus = determineGoalStatus(activeGoal, goalProgress);
  const statusConfig = getStatusConfig(goalStatus);

  // Progress calculations
  const progressPct = useMemo(() => {
    if (!activeGoal) return 0;
    const range =
      Number(activeGoal.target_value) - Number(activeGoal.baseline_value);
    if (range <= 0) return 0;
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(
          ((Number(activeGoal.current_value) -
            Number(activeGoal.baseline_value)) /
            range) *
            100
        )
      )
    );
  }, [activeGoal]);

  const daysLeft = activeGoal ? getDaysLeft(activeGoal.deadline) : null;

  // Next action: first pending or in_progress recommendation by rank
  const nextAction = useMemo(() => {
    const sorted = [...recommendations]
      .filter((r) => r.status === "pending" || r.status === "in_progress")
      .sort((a, b) => a.rank - b.rank);
    return sorted[0] ?? null;
  }, [recommendations]);

  // Completed recommendations for recent impact
  const completedRecs = useMemo(
    () =>
      [...recommendations]
        .filter((r) => r.status === "completed")
        .sort(
          (a, b) =>
            new Date(b.outcome_recorded_at ?? b.created_at).getTime() -
            new Date(a.outcome_recorded_at ?? a.created_at).getTime()
        )
        .slice(0, 2),
    [recommendations]
  );

  // Crux (master bottleneck)
  const bottleneckName =
    synthesisData?.master_bottleneck?.summary ??
    macro.risk_exposure.bottleneck_name;
  const cruxStatus = determineCruxStatus(bottleneckName, recommendations);
  const cruxConfig = getCruxStatusConfig(cruxStatus);

  // Leading indicators from benchmark
  const leadingIndicators = benchmark?.leading_indicators ?? [];

  // ── No active goal: empty state ──

  if (!activeGoal) {
    // No empty state card — objectives are managed in the Objectives section.
    // Only show Analysis Quality panel.
    return (
      <AnalysisQualityPanel
        macro={macro}
        cd={cd}
        expanded={true}
        onToggle={() => {}}
        forceExpanded
      />
    );
  }

  // ── Active goal: full dashboard ──

  const metricUnit = activeGoal.metric_unit ?? activeGoal.metric_name;
  const gap = Number(activeGoal.target_value) - Number(activeGoal.current_value);

  return (
    <div className="flex flex-col gap-4">
      {/* ── SECTION 1: Header ── */}
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {activeGoal.title}
              </h2>
              {intelGoalIds.has(activeGoal.id) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                  <Radar className="h-3 w-3" />
                  Origin: Intelligence Radar
                </span>
              )}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium flex-shrink-0",
                  statusConfig.pillBg,
                  statusConfig.pillText,
                  statusConfig.pillBorder
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    statusConfig.dotColor
                  )}
                />
                {statusConfig.label}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-gray-500">
              cycle 1 of 1 · active phase
              {daysLeft !== null && ` · ${daysLeft} days left`}
              {daysLeft === null && activeGoal.deadline === null && " · no deadline set"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-2xl font-bold text-gray-900">
              {progressPct}%
            </span>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Trajectory + Leading Indicators (side by side) ── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* Trajectory (wider ~60%) */}
        <div className="md:col-span-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-indigo-400" />
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Trajectory
            </h3>
          </div>

          {goalProgress.length > 0 ? (
            <>
              <TrajectoryChart
                progress={goalProgress}
                baseline={Number(activeGoal.baseline_value)}
                target={Number(activeGoal.target_value)}
                deadline={activeGoal.deadline}
                currentValue={Number(activeGoal.current_value)}
              />
              <p className="mt-2 text-[11px] text-gray-500">
                {Number(activeGoal.current_value)} of{" "}
                {Number(activeGoal.target_value)} {metricUnit}
                {daysLeft !== null && ` · ${daysLeft} days left`}
                {gap > 0 && ` · ${gap} ${metricUnit} to go`}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <BarChart3 className="h-8 w-8 text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">
                No progress recorded yet
              </p>
              {onRecordProgress && (
                <button
                  onClick={onRecordProgress}
                  className="mt-3 flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all"
                >
                  <Plus className="h-3 w-3" />
                  Record Progress
                </button>
              )}
            </div>
          )}
        </div>

        {/* Leading Indicators (~40%) */}
        <div className="md:col-span-2 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-teal-400" />
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Leading Indicators
            </h3>
          </div>

          {leadingIndicators.length > 0 ? (
            <div className="space-y-2.5">
              {leadingIndicators.map((li, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-gray-50 px-3 py-2.5"
                >
                  <div className="flex items-start gap-2">
                    <CircleDot className="h-3.5 w-3.5 text-teal-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-600 leading-snug">
                        {li.metric}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
                          {li.on_track}
                        </span>
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                          {li.at_risk}
                        </span>
                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
                          {li.off_track}
                        </span>
                      </div>
                      <p className="mt-1 text-[9px] text-gray-400">
                        check {li.check_frequency}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Activity className="h-6 w-6 text-gray-300 mb-2" />
              <p className="text-xs text-gray-500">No indicators defined</p>
              <p className="text-[10px] text-gray-400 mt-1">
                Run synthesis with an active goal to generate benchmarks
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 3: DO THIS NEXT ── */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="h-4 w-4 text-indigo-400" />
          <h3 className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">
            Do This Next
          </h3>
        </div>

        {nextAction ? (
          <div>
            <p className="text-sm font-medium text-gray-800 leading-relaxed">
              {nextAction.title}
            </p>
            {nextAction.reasoning && (
              <p className="mt-1 text-[11px] text-gray-500 leading-relaxed line-clamp-2">
                {nextAction.reasoning}
              </p>
            )}
            {bottleneckName && (
              <div className="mt-2 flex items-center gap-1.5">
                <Crosshair className="h-3 w-3 text-indigo-500" />
                <span className="text-[10px] text-indigo-600">
                  addresses your crux:{" "}
                  <span className="font-medium text-indigo-700">
                    {bottleneckName}
                  </span>
                </span>
              </div>
            )}
            {nextAction.status === "in_progress" && (
              <span className="inline-flex items-center gap-1 mt-2 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                <Clock className="h-2.5 w-2.5" />
                in progress
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-2">
            <HelpCircle className="h-4 w-4 text-gray-400" />
            <p className="text-sm text-gray-500">
              Run synthesis to generate recommendations
            </p>
          </div>
        )}
      </div>

      {/* ── SECTION 4: Bottom row (Recent Impact + Your Crux) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent Impact */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Recent Impact
            </h3>
          </div>

          {completedRecs.length > 0 ? (
            <div className="space-y-2.5">
              {completedRecs.map((rec) => {
                const outcomeLabel =
                  rec.outcome === "effective"
                    ? "effective"
                    : rec.outcome === "partial"
                      ? "partial"
                      : rec.outcome === "ineffective"
                        ? "ineffective"
                        : "not tested";
                const outcomeColor =
                  rec.outcome === "effective"
                    ? "text-emerald-400"
                    : rec.outcome === "partial"
                      ? "text-amber-400"
                      : rec.outcome === "ineffective"
                        ? "text-red-400"
                        : "text-gray-500";

                return (
                  <div
                    key={rec.id}
                    className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5"
                  >
                    <ArrowRight className="h-3.5 w-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-600 truncate">
                        {rec.title}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className={cn("text-[10px] font-medium", outcomeColor)}>
                          {outcomeLabel}
                        </span>
                        {rec.outcome_notes && (
                          <span className="text-[9px] text-gray-500 truncate">
                            {rec.outcome_notes}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-4 justify-center">
              <p className="text-xs text-gray-500">
                Complete actions to see impact
              </p>
            </div>
          )}
        </div>

        {/* Your Crux */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="h-4 w-4 text-red-400" />
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Your Crux
            </h3>
          </div>

          {bottleneckName ? (
            <div>
              <p className="text-sm font-medium text-gray-800">
                {bottleneckName}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    cruxConfig.dotColor
                  )}
                />
                <span
                  className={cn("text-[11px] font-medium", cruxConfig.color)}
                >
                  {cruxConfig.label}
                </span>
              </div>
              {cruxStatus === "stalled" && (
                <p className="mt-2 text-[10px] text-gray-400">
                  No actions in progress targeting this constraint
                </p>
              )}
              {cruxStatus === "resolved" && (
                <p className="mt-2 text-[10px] text-emerald-500/60">
                  All recommendations completed. Re-run synthesis to reassess.
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-4 justify-center">
              <p className="text-xs text-gray-500">
                No bottleneck identified yet
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 5: Collapsible Analysis Quality ── */}
      <AnalysisQualityPanel
        macro={macro}
        cd={cd}
        expanded={qualityExpanded}
        onToggle={() => setQualityExpanded(!qualityExpanded)}
      />
    </div>
  );
}

// ── Analysis Quality Panel ──

function AnalysisQualityPanel({
  macro,
  cd,
  expanded,
  onToggle,
  forceExpanded,
}: {
  macro: ReturnType<typeof computeTwinState>["macro"];
  cd: { high: number; medium: number; low: number };
  expanded: boolean;
  onToggle: () => void;
  forceExpanded?: boolean;
}) {
  const isExpanded = forceExpanded || expanded;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header (clickable toggle unless forced) */}
      <button
        onClick={forceExpanded ? undefined : onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-3 text-left",
          !forceExpanded && "cursor-pointer hover:bg-gray-50 transition-colors"
        )}
      >
        <ShieldAlert className="h-4 w-4 text-gray-500" />
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-1">
          Analysis Quality
        </h3>
        {!forceExpanded && (
          <ChevronDown
            className={cn(
              "h-4 w-4 text-gray-400 transition-transform duration-200",
              isExpanded && "rotate-180"
            )}
          />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="mt-3 flex items-start gap-4">
            {/* Health ring */}
            <HealthRing
              score={macro.health_score}
              label={macro.health_label}
            />

            {/* Stats grid */}
            <div className="flex-1 grid grid-cols-2 gap-2">
              <QualityStat
                icon={<ShieldAlert className="h-3 w-3" />}
                label="Risk exposure"
                value={
                  macro.risk_exposure.total_risk_points > 0
                    ? `${macro.risk_exposure.total_risk_points} risks`
                    : "None"
                }
                color={
                  macro.risk_exposure.critical_risks > 0
                    ? "red"
                    : macro.risk_exposure.total_risk_points > 0
                      ? "amber"
                      : "green"
                }
              />
              <QualityStat
                icon={<RefreshCw className="h-3 w-3" />}
                label="Dynamics"
                value={`${macro.dynamics.total_loops} loops`}
                color={
                  macro.dynamics.reinforcing_negative > 0
                    ? "amber"
                    : macro.dynamics.total_loops > 0
                      ? "blue"
                      : "gray"
                }
              />
              <QualityStat
                icon={<TrendingUp className="h-3 w-3" />}
                label="Leverage"
                value={`${macro.dynamics.leverage_points} points`}
                color={
                  macro.dynamics.leverage_points > 0 ? "green" : "gray"
                }
              />
              <QualityStat
                icon={<HelpCircle className="h-3 w-3" />}
                label="Open questions"
                value={macro.coverage.open_questions}
                color={
                  macro.coverage.open_questions > 3 ? "amber" : "gray"
                }
              />
            </div>
          </div>

          {/* Confidence distribution */}
          <div className="mt-3">
            <ConfidenceBarDark
              high={cd.high}
              medium={cd.medium}
              low={cd.low}
            />
          </div>

          {/* Entity/edge/cycle counts */}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-400 border-t border-gray-100 pt-2">
            <span>{macro.coverage.entities_modeled} entities</span>
            <span className="text-gray-300">·</span>
            <span>{macro.coverage.edges_mapped} edges</span>
            <span className="text-gray-300">·</span>
            <span>{macro.coverage.cycles_detected} cycles</span>
            {macro.coverage.contradictions > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-amber-500/70">
                  {macro.coverage.contradictions} contradictions
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quality stat pill (dark variant) ──

function QualityStat({
  icon,
  label,
  value,
  color = "gray",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: "gray" | "red" | "amber" | "green" | "blue";
}) {
  const colorMap = {
    gray: "bg-gray-100 text-gray-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
    green: "bg-emerald-50 text-emerald-600",
    blue: "bg-indigo-50 text-indigo-600",
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-2",
        colorMap[color]
      )}
    >
      <span className="flex-shrink-0 opacity-60">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] opacity-70 truncate">{label}</div>
        <div className="text-xs font-semibold leading-tight">{value}</div>
      </div>
    </div>
  );
}
