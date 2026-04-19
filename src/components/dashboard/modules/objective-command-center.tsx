"use client";

import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import {
  getChildGoals,
  computeAggregateProgress,
  computeRecursiveProgress,
} from "@/lib/goals/build-goal-tree";
import {
  Target,
  Crosshair,
  ChevronDown,
  ChevronRight,
  Clock,
  ArrowRight,
  Zap,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  GitBranch,
  Play,
  Pause,
  ExternalLink,
  Plus,
  Sparkles,
  Loader2,
  Check,
  Radar,
} from "lucide-react";
import type {
  ImprovementGoal,
  SuggestedObjective,
  ObjectiveType,
  ObjectiveBenchmark,
} from "@/types/goals";
import type { MicroTactic } from "@/types/strategy";
import type { SynthesisData } from "@/types/synthesis";

// ── Props ──

interface ObjectiveCommandCenterProps {
  activeGoal: ImprovementGoal | null;
  goals: ImprovementGoal[];
  suggestedObjectives: SuggestedObjective[];
  synthesisData: SynthesisData | null;
  onAcceptObjective: (objective: SuggestedObjective) => void | Promise<void>;
  onCreateSubSpace: (goalId: string) => void;
  onNavigateToSpace: (spaceId: string) => void;
  onBreakDownGoal: (goalId: string) => void;
  onGoalClick: (goal: ImprovementGoal) => void;
  /** Whether auto-detection is currently running */
  objectiveAutoLoading?: boolean;
  /** Error from auto-detection */
  objectiveAutoError?: string | null;
  /** Trigger manual objective detection */
  onDetectObjectives?: () => void;
  /** Whether existing objectives need refresh due to structural changes */
  needsRefresh?: boolean;
}

// ── Helpers ──

const objectiveTypeConfig: Record<
  ObjectiveType,
  { label: string; color: string; bg: string }
> = {
  maximize: { label: "Maximize", color: "text-green-700", bg: "bg-green-50" },
  minimize: { label: "Minimize", color: "text-red-700", bg: "bg-red-50" },
  maintain: { label: "Maintain", color: "text-blue-700", bg: "bg-blue-50" },
  explore: { label: "Explore", color: "text-purple-700", bg: "bg-purple-50" },
  avoid: { label: "Avoid", color: "text-amber-700", bg: "bg-amber-50" },
};

const statusConfig: Record<
  string,
  { dot: string; label: string }
> = {
  active: { dot: "bg-green-500", label: "Active" },
  paused: { dot: "bg-amber-500", label: "Paused" },
  achieved: { dot: "bg-emerald-500", label: "Achieved" },
  abandoned: { dot: "bg-gray-400", label: "Abandoned" },
};

const depthConfig: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  fundamental: {
    label: "Fundamental",
    color: "text-rose-700",
    bg: "bg-rose-50",
    border: "border-rose-200",
  },
  structural: {
    label: "Structural",
    color: "text-indigo-700",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
  },
  surface: {
    label: "Surface",
    color: "text-gray-600",
    bg: "bg-gray-50",
    border: "border-gray-200",
  },
};

const priorityConfig: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  critical: { label: "Critical", color: "text-red-700", bg: "bg-red-50" },
  high: { label: "High", color: "text-amber-700", bg: "bg-amber-50" },
  medium: { label: "Medium", color: "text-blue-700", bg: "bg-blue-50" },
  low: { label: "Low", color: "text-gray-600", bg: "bg-gray-50" },
};

const infraActionConfig: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  build: { label: "Build", color: "text-green-700", bg: "bg-green-50" },
  strengthen: { label: "Strengthen", color: "text-blue-700", bg: "bg-blue-50" },
  connect: { label: "Connect", color: "text-purple-700", bg: "bg-purple-50" },
  monitor: { label: "Monitor", color: "text-amber-700", bg: "bg-amber-50" },
  configure: { label: "Configure", color: "text-gray-700", bg: "bg-gray-50" },
};

const timeframeLabels: Record<string, string> = {
  now: "Now",
  short_term: "1-2 weeks",
  medium_term: "1-3 months",
  long_term: "3+ months",
};

function computeGoalProgress(goal: ImprovementGoal): number {
  const range = Number(goal.target_value) - Number(goal.baseline_value);
  if (range === 0) return 0;
  const progress = Number(goal.current_value) - Number(goal.baseline_value);
  return Math.max(0, Math.min(100, Math.round((progress / range) * 100)));
}

function getDaysRemaining(deadline: string | null): number | null {
  if (!deadline) return null;
  const now = new Date();
  const end = new Date(deadline);
  const diff = end.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getUrgencyColor(days: number | null): string {
  if (days === null) return "text-gray-400";
  if (days <= 0) return "text-red-600";
  if (days <= 3) return "text-red-500";
  if (days <= 7) return "text-amber-600";
  if (days <= 14) return "text-amber-500";
  return "text-gray-500";
}

function getProgressColor(pct: number, daysRemaining: number | null): string {
  if (daysRemaining !== null && daysRemaining <= 0 && pct < 100) return "bg-rose-500";
  if (daysRemaining !== null && daysRemaining <= 7 && pct < 50) return "bg-rose-400";
  if (daysRemaining !== null && daysRemaining <= 14 && pct < 30) return "bg-amber-400";
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 50) return "bg-emerald-400";
  if (pct >= 25) return "bg-amber-400";
  return "bg-rose-400";
}

function getTrackingStatus(
  pct: number,
  daysRemaining: number | null
): { label: string; color: string; bg: string } {
  if (pct >= 100) return { label: "Achieved", color: "text-emerald-700", bg: "bg-emerald-50" };
  if (daysRemaining !== null && daysRemaining <= 0)
    return { label: "Overdue", color: "text-rose-700", bg: "bg-rose-50" };
  if (daysRemaining !== null && daysRemaining <= 7 && pct < 50)
    return { label: "Behind", color: "text-rose-700", bg: "bg-rose-50" };
  if (daysRemaining !== null && daysRemaining <= 14 && pct < 30)
    return { label: "At risk", color: "text-amber-700", bg: "bg-amber-50" };
  return { label: "On track", color: "text-emerald-700", bg: "bg-emerald-50" };
}

function getTacticPriorityLabel(priority: number): string {
  if (priority <= 1) return "critical";
  if (priority <= 2) return "high";
  if (priority <= 4) return "medium";
  return "low";
}

// ── Progress Ring (SVG) ──

function ProgressRing({
  pct,
  size = 64,
  colorClass,
}: {
  pct: number;
  size?: number;
  colorClass: string;
}) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  // Map tailwind class to hex
  const colorMap: Record<string, string> = {
    "bg-emerald-500": "#10B981",
    "bg-emerald-400": "#34D399",
    "bg-amber-400": "#FBBF24",
    "bg-rose-500": "#F43F5E",
    "bg-rose-400": "#FB7185",
  };
  const stroke = colorMap[colorClass] ?? "#10B981";

  return (
    <div
      className="relative flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#F3F4F6"
          strokeWidth={5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-base font-bold text-gray-900">{pct}%</span>
      </div>
    </div>
  );
}

// ── Sub-Objective Row (recursive) ──

function SubObjectiveRow({
  goal,
  allGoals,
  depth = 0,
  onGoalClick,
  onNavigateToSpace,
  onCreateSubSpace,
  onBreakDownGoal,
}: {
  goal: ImprovementGoal;
  allGoals: ImprovementGoal[];
  depth?: number;
  onGoalClick: (goal: ImprovementGoal) => void;
  onNavigateToSpace: (spaceId: string) => void;
  onCreateSubSpace: (goalId: string) => void;
  onBreakDownGoal: (goalId: string) => void;
}) {
  const [childrenExpanded, setChildrenExpanded] = useState(depth < 1);
  const pct = computeGoalProgress(goal);
  const status = statusConfig[goal.status] ?? statusConfig.active;
  const typeConf = objectiveTypeConfig[goal.objective_type] ?? objectiveTypeConfig.explore;

  // Find direct children of this goal
  const children = useMemo(
    () => allGoals.filter((g) => g.parent_goal_id === goal.id),
    [allGoals, goal.id],
  );
  const hasChildren = children.length > 0;
  const maxDepth = 3;

  return (
    <div>
      <div
        className="flex items-center gap-2.5 rounded-lg bg-gray-50 px-3 py-2 cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => onGoalClick(goal)}
      >
        {/* Expand toggle for children */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setChildrenExpanded(!childrenExpanded);
            }}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
          >
            {childrenExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className={cn("h-2 w-2 rounded-full flex-shrink-0", status.dot)} />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[9px] font-bold uppercase", typeConf.color)}>
              {goal.objective_type.slice(0, 3)}
            </span>
            <p className="text-[11px] font-medium text-gray-700 truncate">
              {goal.title}
            </p>
            {hasChildren && (
              <span className="text-[8px] text-gray-400">
                ({children.filter((c) => c.status === "achieved").length}/{children.length})
              </span>
            )}
          </div>
          {/* Mini progress bar */}
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-gray-200 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", getProgressColor(pct, null))}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="text-[9px] text-gray-400 flex-shrink-0 w-7 text-right">
              {pct}%
            </span>
          </div>
          {/* Metric readout */}
          <p className="mt-0.5 text-[9px] text-gray-400">
            {goal.current_value}/{goal.target_value}
            {goal.metric_unit ? ` ${goal.metric_unit}` : ""}
          </p>
        </div>

        {/* Actions — stop propagation to avoid triggering row click */}
        <div
          className="flex items-center gap-1 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {depth < maxDepth && (
            <button
              onClick={() => onBreakDownGoal(goal.id)}
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-purple-600 hover:bg-purple-50 transition-colors"
              title="Decompose into sub-objectives"
            >
              <Sparkles className="h-2.5 w-2.5" />
            </button>
          )}
          <button
            onClick={() => onCreateSubSpace(goal.id)}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium text-interaxis-600 hover:bg-interaxis-50 transition-colors"
            title="Create analysis space"
          >
            <Plus className="h-2.5 w-2.5" />
            <span className="hidden sm:inline">Space</span>
          </button>
        </div>
      </div>

      {/* Recursive children */}
      {hasChildren && childrenExpanded && depth < maxDepth && (
        <div className="ml-4 mt-1 space-y-1 border-l border-gray-200 pl-2.5">
          {children.map((child) => (
            <SubObjectiveRow
              key={child.id}
              goal={child}
              allGoals={allGoals}
              depth={depth + 1}
              onGoalClick={onGoalClick}
              onNavigateToSpace={onNavigateToSpace}
              onCreateSubSpace={onCreateSubSpace}
              onBreakDownGoal={onBreakDownGoal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Suggested Objective Card ──

function SuggestedObjectiveCard({
  objective,
  onAccept,
  showDepth,
}: {
  objective: SuggestedObjective;
  onAccept: () => void;
  showDepth?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const typeConf = objectiveTypeConfig[objective.objective_type] ?? objectiveTypeConfig.explore;
  const depth = objective.depth ? depthConfig[objective.depth] : null;

  async function handleTrack() {
    setStatus("loading");
    try {
      await onAccept();
      setStatus("done");
    } catch {
      setStatus("idle");
    }
  }

  return (
    <div className={cn(
      "rounded-lg border bg-white px-3 py-2.5 space-y-1.5 transition-all duration-300",
      status === "done"
        ? "border-emerald-200 bg-emerald-50/30"
        : "border-gray-200"
    )}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                typeConf.bg,
                typeConf.color
              )}
            >
              {typeConf.label}
            </span>
            {showDepth && depth && (
              <span
                className={cn(
                  "inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  depth.bg,
                  depth.color,
                  depth.border
                )}
              >
                {depth.label}
              </span>
            )}
            {objective.confidence && (
              <span className="text-[9px] text-gray-400">
                {objective.confidence} conf.
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-medium text-gray-800">
            {objective.title}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-500 line-clamp-2">
            {objective.description}
          </p>
        </div>
        <button
          onClick={handleTrack}
          disabled={status !== "idle"}
          className={cn(
            "flex-shrink-0 flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-semibold transition-all",
            status === "done"
              ? "bg-emerald-100 text-emerald-700"
              : status === "loading"
                ? "bg-interaxis-500 text-white opacity-70"
                : "bg-interaxis-600 text-white hover:bg-interaxis-700"
          )}
        >
          {status === "loading" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          {status === "done" && <Check className="h-2.5 w-2.5" />}
          {status === "done" ? "Tracking" : status === "loading" ? "..." : "Track"}
        </button>
      </div>

      {/* Convergence visualization */}
      {objective.convergence_score != null && objective.convergence_score > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-400">Convergence</span>
          <div className="flex gap-0.5">
            {Array.from({ length: Math.min(objective.convergence_score, 6) }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-interaxis-400"
              />
            ))}
          </div>
          <span className="text-[9px] text-gray-400">
            {objective.convergence_score} chains
          </span>
        </div>
      )}

      {/* Propellant callout */}
      {objective.propellant && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
          <div className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-amber-600" />
            <span className="text-[9px] font-semibold text-amber-700">
              Key Action
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-amber-800">
            {objective.propellant.action}
          </p>
          <p className="text-[9px] text-amber-600">{objective.propellant.why}</p>
        </div>
      )}
    </div>
  );
}

// ── Tactic Card ──

function TacticCard({ tactic }: { tactic: MicroTactic }) {
  const prioKey = getTacticPriorityLabel(tactic.priority);
  const prioConf = priorityConfig[prioKey] ?? priorityConfig.medium;
  const infraConf = tactic.infrastructure_action
    ? infraActionConfig[tactic.infrastructure_action]
    : null;
  const tfLabel = timeframeLabels[tactic.timeframe] ?? tactic.timeframe;

  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-gray-800 line-clamp-1">
            {tactic.title}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-500 line-clamp-2">
            {tactic.description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Priority */}
        <span
          className={cn(
            "inline-flex rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase",
            prioConf.bg,
            prioConf.color
          )}
        >
          {prioConf.label}
        </span>
        {/* Timeframe */}
        <span className="inline-flex items-center gap-0.5 text-[8px] text-gray-400">
          <Clock className="h-2.5 w-2.5" />
          {tfLabel}
        </span>
        {/* Effort */}
        <span
          className={cn(
            "inline-flex rounded px-1 py-0.5 text-[8px] font-medium",
            tactic.effort === "low"
              ? "bg-green-50 text-green-600"
              : tactic.effort === "medium"
                ? "bg-amber-50 text-amber-600"
                : "bg-red-50 text-red-600"
          )}
        >
          E:{tactic.effort[0].toUpperCase()}
        </span>
        {/* Impact */}
        <span
          className={cn(
            "inline-flex rounded px-1 py-0.5 text-[8px] font-medium",
            tactic.impact === "high"
              ? "bg-green-50 text-green-600"
              : tactic.impact === "medium"
                ? "bg-blue-50 text-blue-600"
                : "bg-gray-50 text-gray-500"
          )}
        >
          I:{tactic.impact[0].toUpperCase()}
        </span>
        {/* Infrastructure action */}
        {infraConf && (
          <span
            className={cn(
              "inline-flex rounded px-1 py-0.5 text-[8px] font-medium",
              infraConf.bg,
              infraConf.color
            )}
          >
            {infraConf.label}
          </span>
        )}
      </div>
      {/* Entity link */}
      <p className="text-[9px] text-gray-400">
        <span className="font-medium text-gray-500">{tactic.entity_name}</span>
        {" "}
        <span className="text-gray-300">·</span>{" "}
        {tactic.entity_id}
      </p>
    </div>
  );
}

// ── Benchmark Tracker (for active goals) ──

function BenchmarkTracker({ benchmark }: { benchmark: ObjectiveBenchmark }) {
  const [expanded, setExpanded] = useState(false);
  const mustHaveCount = benchmark.success_criteria.filter(sc => sc.priority === "must_have").length;

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <BarChart3 className="h-3.5 w-3.5 text-teal-600" />
        <span className="text-[10px] font-semibold text-teal-700">
          Evaluation Criteria
        </span>
        <span className="text-[9px] text-teal-500">
          {mustHaveCount} must-have · {benchmark.leading_indicators.length} indicators · {benchmark.milestones.length} milestones
        </span>
        <ChevronDown className={cn("h-3 w-3 text-teal-400 ml-auto transition-transform", !expanded && "-rotate-90")} />
      </button>

      {expanded && (
        <div className="border-t border-teal-100 px-3 py-2.5 space-y-3">
          {/* Evaluation approach */}
          {benchmark.evaluation_approach && (
            <p className="text-[10px] text-teal-700 italic">{benchmark.evaluation_approach}</p>
          )}

          {/* Success Criteria */}
          {benchmark.success_criteria.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-teal-700 uppercase tracking-wider mb-1">
                Success Criteria
              </p>
              <div className="space-y-1">
                {benchmark.success_criteria.map((sc, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md bg-white border border-teal-100 px-2 py-1.5">
                    <span className={cn(
                      "mt-0.5 rounded px-1 text-[8px] font-bold border",
                      sc.priority === "must_have" ? "bg-red-50 text-red-700 border-red-200" :
                      sc.priority === "should_have" ? "bg-amber-50 text-amber-700 border-amber-200" :
                      "bg-gray-50 text-gray-500 border-gray-200"
                    )}>
                      {sc.priority === "must_have" ? "MUST" : sc.priority === "should_have" ? "SHOULD" : "NICE"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-700">{sc.criterion}</p>
                      <p className="text-[9px] text-teal-600 font-mono">{sc.threshold}</p>
                      <p className="text-[8px] text-gray-400">Measured by: {sc.measurement}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Leading Indicators — traffic-light style */}
          {benchmark.leading_indicators.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-teal-700 uppercase tracking-wider mb-1">
                Leading Indicators
              </p>
              <div className="space-y-1">
                {benchmark.leading_indicators.map((li, i) => (
                  <div key={i} className="rounded-md bg-white border border-teal-100 px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-gray-700">{li.metric}</span>
                      <span className="text-[8px] text-gray-400">Check: {li.check_frequency}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[8px] font-medium text-emerald-600">
                        ✓ {li.on_track}
                      </span>
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[8px] font-medium text-amber-600">
                        ⚠ {li.at_risk}
                      </span>
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[8px] font-medium text-red-600">
                        ✗ {li.off_track}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Milestones — timeline */}
          {benchmark.milestones.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-teal-700 uppercase tracking-wider mb-1">
                Milestones
              </p>
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {benchmark.milestones.map((ms, i) => (
                  <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
                    {i > 0 && <ArrowRight className="h-2.5 w-2.5 text-gray-300 flex-shrink-0" />}
                    <div className="rounded-md bg-white border border-teal-100 px-2 py-1">
                      <p className="text-[9px] font-medium text-gray-700">{ms.name}</p>
                      <p className="text-[8px] text-teal-600">{ms.target_value}</p>
                      <p className="text-[8px] text-gray-400">{ms.expected_by}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Failure Signals */}
          {benchmark.failure_signals.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-amber-700 uppercase tracking-wider mb-1">
                <AlertTriangle className="h-2.5 w-2.5 inline mr-0.5" />
                Failure Signals
              </p>
              <div className="space-y-1">
                {benchmark.failure_signals.map((fs, i) => (
                  <div key={i} className="rounded-md bg-amber-50/50 border border-amber-100 px-2 py-1.5">
                    <p className="text-[10px] text-gray-700">{fs.signal}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn(
                        "rounded px-1 py-0 text-[8px] font-medium",
                        fs.response === "investigate" ? "bg-blue-50 text-blue-700" :
                        fs.response === "adjust_target" ? "bg-amber-50 text-amber-700" :
                        fs.response === "pivot" ? "bg-orange-50 text-orange-700" :
                        "bg-red-50 text-red-700"
                      )}>
                        {fs.response.replace("_", " ")}
                      </span>
                      <span className="text-[8px] text-gray-400">{fs.deadline}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export function ObjectiveCommandCenter({
  activeGoal,
  goals,
  suggestedObjectives,
  synthesisData,
  onAcceptObjective,
  onCreateSubSpace,
  onNavigateToSpace,
  onBreakDownGoal,
  onGoalClick,
  objectiveAutoLoading = false,
  objectiveAutoError = null,
  onDetectObjectives,
  needsRefresh = false,
}: ObjectiveCommandCenterProps) {
  const [tacticsExpanded, setTacticsExpanded] = useState(false);
  const [subObjExpanded, setSubObjExpanded] = useState(true);

  // Derive child goals
  const childGoals = useMemo(
    () => (activeGoal ? getChildGoals(goals, activeGoal.id) : []),
    [goals, activeGoal]
  );

  // Suggested sub-objectives matching parent
  const suggestedSubObjectives = useMemo(
    () =>
      activeGoal
        ? suggestedObjectives.filter((o) => o.parent_goal_id === activeGoal.id)
        : [],
    [suggestedObjectives, activeGoal]
  );

  // Top-level suggestions (no parent)
  const topLevelSuggestions = useMemo(
    () =>
      suggestedObjectives
        .filter((o) => !o.parent_goal_id)
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 3),
    [suggestedObjectives]
  );

  // Tactics from strategy
  const microTactics = useMemo<MicroTactic[]>(() => {
    const rec = synthesisData?.strategic_recommendation?.recommendation;
    if (!rec?.micro_tactics) return [];
    return rec.micro_tactics;
  }, [synthesisData]);

  // Extract benchmark for active goal from synthesis_data
  const activeBenchmark = useMemo<ObjectiveBenchmark | null>(() => {
    if (!activeGoal || !synthesisData) return null;
    // Check goal_benchmarks storage
    const sd = synthesisData as unknown as Record<string, unknown>;
    const goalBenchmarks = sd.goal_benchmarks as Record<string, ObjectiveBenchmark> | undefined;
    if (goalBenchmarks?.[activeGoal.id]) return goalBenchmarks[activeGoal.id];
    // Fallback: check if the matching suggested objective had a benchmark
    const matchingObj = suggestedObjectives.find(o => o.title === activeGoal.title && o.benchmark);
    return matchingObj?.benchmark ?? null;
  }, [activeGoal, synthesisData, suggestedObjectives]);

  // Group tactics by timeframe
  const tacticsByTimeframe = useMemo(() => {
    const groups: Record<string, MicroTactic[]> = {};
    for (const t of microTactics) {
      const key = t.timeframe ?? "now";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return groups;
  }, [microTactics]);

  const visibleTacticCount = tacticsExpanded ? microTactics.length : 6;
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

  // ── ACTIVE GOAL STATE ──

  if (activeGoal) {
    const pct = computeGoalProgress(activeGoal);
    const aggregatePct =
      childGoals.length > 0
        ? computeAggregateProgress(activeGoal, childGoals)
        : pct;
    const daysRemaining = getDaysRemaining(activeGoal.deadline);
    const urgencyColor = getUrgencyColor(daysRemaining);
    const progressColor = getProgressColor(aggregatePct, daysRemaining);
    const typeConf =
      objectiveTypeConfig[activeGoal.objective_type] ?? objectiveTypeConfig.explore;
    const goalStatus = statusConfig[activeGoal.status] ?? statusConfig.active;
    const trackingStatus = getTrackingStatus(aggregatePct, daysRemaining);

    return (
      <DashboardCard
        title="Objective Command Center"
        icon={<Crosshair className="h-4 w-4" />}
        collapsible={false}
        className="border-interaxis-200 bg-gradient-to-br from-white to-interaxis-50/30"
      >
        <div className="space-y-4">
          {/* ── 1. Main Objective Header ── */}
          <div className="flex items-start gap-4">
            <ProgressRing pct={aggregatePct} colorClass={progressColor} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-gray-900 leading-tight">
                  {activeGoal.title}
                </h2>
                {intelGoalIds.has(activeGoal.id) && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[9px] font-medium text-indigo-700">
                    <Radar className="h-3 w-3" />
                    From Intelligence Radar
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                    typeConf.bg,
                    typeConf.color
                  )}
                >
                  {typeConf.label}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium",
                    goalStatus.dot === "bg-green-500"
                      ? "bg-green-50 text-green-700"
                      : goalStatus.dot === "bg-amber-500"
                        ? "bg-amber-50 text-amber-700"
                        : goalStatus.dot === "bg-emerald-500"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-gray-50 text-gray-600"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", goalStatus.dot)} />
                  {goalStatus.label}
                </span>
              </div>

              {/* Metric display */}
              <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                <span className="font-medium">
                  {activeGoal.current_value} / {activeGoal.target_value}
                  {activeGoal.metric_unit ? ` ${activeGoal.metric_unit}` : ""}
                </span>
                <span className="text-gray-300">|</span>
                <span className="font-medium text-gray-600">
                  {activeGoal.metric_name}
                </span>
              </div>

              {/* Deadline + tracking status */}
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                {daysRemaining !== null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-medium",
                      urgencyColor
                    )}
                  >
                    <Clock className="h-3 w-3" />
                    {daysRemaining <= 0
                      ? `${Math.abs(daysRemaining)} days overdue`
                      : `${daysRemaining} days remaining`}
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold",
                    trackingStatus.bg,
                    trackingStatus.color
                  )}
                >
                  {trackingStatus.label}
                </span>
              </div>
            </div>
          </div>

          {/* ── 2. Sub-Objectives Section ── */}
          {(childGoals.length > 0 ||
            suggestedSubObjectives.length > 0) && (
            <div className="space-y-2">
              <button
                onClick={() => setSubObjExpanded(!subObjExpanded)}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-700 transition-colors"
              >
                {subObjExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <GitBranch className="h-3 w-3" />
                Sub-Objectives
                {childGoals.length > 0 && (
                  <span className="text-gray-400 font-normal normal-case">
                    ({childGoals.filter((c) => c.status === "achieved").length}/
                    {childGoals.length} complete)
                  </span>
                )}
              </button>

              {subObjExpanded && (
                <div className="ml-2 space-y-1.5 border-l-2 border-interaxis-100 pl-3">
                  {childGoals.length > 0 ? (
                    <>
                      {childGoals.map((child) => (
                        <SubObjectiveRow
                          key={child.id}
                          goal={child}
                          allGoals={goals}
                          depth={0}
                          onGoalClick={onGoalClick}
                          onNavigateToSpace={onNavigateToSpace}
                          onCreateSubSpace={onCreateSubSpace}
                          onBreakDownGoal={onBreakDownGoal}
                        />
                      ))}
                    </>
                  ) : (
                    /* No children yet — show suggested sub-objectives */
                    suggestedSubObjectives.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-gray-400">
                          Detected sub-objectives:
                        </p>
                        {suggestedSubObjectives.map((obj) => (
                          <SuggestedObjectiveCard
                            key={obj.key}
                            objective={obj}
                            onAccept={() => onAcceptObjective(obj)}
                          />
                        ))}
                      </div>
                    )
                  )}

                  {/* Show suggested sub-objectives alongside accepted children */}
                  {childGoals.length > 0 && suggestedSubObjectives.length > 0 && (
                    <div className="space-y-1.5 mt-2 pt-2 border-t border-dashed border-gray-200">
                      <p className="text-[10px] text-gray-400">
                        Suggested gap-filling objectives:
                      </p>
                      {suggestedSubObjectives.map((obj) => (
                        <SuggestedObjectiveCard
                          key={obj.key}
                          objective={obj}
                          onAccept={() => onAcceptObjective(obj)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Break down button */}
                  <button
                    onClick={() => onBreakDownGoal(activeGoal.id)}
                    className="flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-[10px] font-medium text-gray-500 hover:border-interaxis-300 hover:text-interaxis-600 hover:bg-interaxis-50/50 transition-colors w-full justify-center"
                  >
                    <Sparkles className="h-3 w-3" />
                    Break down this goal
                  </button>
                </div>
              )}
            </div>
          )}

          {/* If no sub-objectives at all and no suggestions, still show break-down */}
          {childGoals.length === 0 &&
            suggestedSubObjectives.length === 0 && (
              <button
                onClick={() => onBreakDownGoal(activeGoal.id)}
                className="flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-[10px] font-medium text-gray-500 hover:border-interaxis-300 hover:text-interaxis-600 hover:bg-interaxis-50/50 transition-colors w-full justify-center"
              >
                <GitBranch className="h-3 w-3" />
                Decompose into sub-objectives
              </button>
            )}

          {/* ── 2B. Benchmark Tracker ── */}
          {activeBenchmark && (
            <BenchmarkTracker benchmark={activeBenchmark} />
          )}

          {/* ── 3. Tactics Timeline ── */}
          {microTactics.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  Tactics
                </span>
                <span className="text-[9px] text-gray-400">
                  {microTactics.length} total
                </span>
              </div>

              <div className="space-y-1.5">
                {/* Show tactics grouped by timeframe or flat */}
                {Object.keys(tacticsByTimeframe).length > 1
                  ? Object.entries(tacticsByTimeframe)
                      .sort(
                        ([a], [b]) =>
                          ["now", "short_term", "medium_term", "long_term"].indexOf(a) -
                          ["now", "short_term", "medium_term", "long_term"].indexOf(b)
                      )
                      .map(([tf, tactics]) => {
                        const shownTactics = tacticsExpanded
                          ? tactics
                          : tactics.slice(0, Math.max(2, Math.ceil(6 / Object.keys(tacticsByTimeframe).length)));
                        return (
                          <div key={tf}>
                            <p className="text-[9px] font-semibold text-gray-400 uppercase mb-1">
                              {timeframeLabels[tf] ?? tf}
                            </p>
                            {shownTactics.map((t) => (
                              <TacticCard key={t.id} tactic={t} />
                            ))}
                          </div>
                        );
                      })
                  : microTactics
                      .slice(0, visibleTacticCount)
                      .map((t) => <TacticCard key={t.id} tactic={t} />)}
              </div>

              {microTactics.length > 6 && (
                <button
                  onClick={() => setTacticsExpanded(!tacticsExpanded)}
                  className="flex w-full items-center justify-center gap-1 text-[10px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {tacticsExpanded
                    ? "Show less"
                    : `Show all ${microTactics.length} tactics`}
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      tacticsExpanded && "rotate-180"
                    )}
                  />
                </button>
              )}
            </div>
          )}

          {/* ── 4. Aggregate Progress Footer ── */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-3 w-3 text-gray-400" />
              <span className="text-[10px] text-gray-500">
                Overall progress
              </span>
              <div className="h-1.5 w-24 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    progressColor
                  )}
                  style={{ width: `${Math.min(aggregatePct, 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-semibold text-gray-700">
                {aggregatePct}%
              </span>
            </div>
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold",
                trackingStatus.bg,
                trackingStatus.color
              )}
            >
              {trackingStatus.label}
            </span>
          </div>
        </div>
      </DashboardCard>
    );
  }

  // ── NO ACTIVE GOAL STATE ──

  if (topLevelSuggestions.length > 0) {
    return (
      <DashboardCard
        title="Detected Objectives"
        icon={<Target className="h-4 w-4" />}
        subtitle="AI-detected from your analysis"
        collapsible={false}
        className="border-interaxis-200"
      >
        <div className="space-y-2">
          {/* Staleness nudge — objectives may be outdated after structural changes */}
          {needsRefresh && onDetectObjectives && (
            <button
              onClick={onDetectObjectives}
              disabled={objectiveAutoLoading}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-left transition-colors hover:bg-amber-50"
            >
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
              <span className="text-[11px] font-medium text-amber-700 flex-1">
                Structural changes detected — objectives may need updating
              </span>
              <Loader2
                className={`h-3 w-3 flex-shrink-0 text-amber-400 ${objectiveAutoLoading ? "animate-spin" : "hidden"}`}
              />
            </button>
          )}
          {topLevelSuggestions.map((obj) => (
            <SuggestedObjectiveCard
              key={obj.key}
              objective={obj}
              onAccept={() => onAcceptObjective(obj)}
              showDepth
            />
          ))}
          {suggestedObjectives.filter((o) => !o.parent_goal_id).length > 3 && (
            <p className="text-center text-[9px] text-gray-400">
              +{suggestedObjectives.filter((o) => !o.parent_goal_id).length - 3}{" "}
              more detected
            </p>
          )}
        </div>
      </DashboardCard>
    );
  }

  // ── DETECTING STATE (auto-detection in progress) ──

  if (objectiveAutoLoading) {
    return (
      <DashboardCard
        title="Objective Command Center"
        icon={<Crosshair className="h-4 w-4" />}
        collapsible={false}
      >
        <div className="flex flex-col items-center py-5 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-interaxis-50 mb-2.5">
            <Loader2 className="h-5 w-5 text-interaxis-500 animate-spin" />
          </div>
          <p className="text-xs font-semibold text-gray-700">
            Detecting objectives from your analysis...
          </p>
          <p className="mt-1 text-[10px] text-gray-400 max-w-[280px] leading-relaxed">
            Tracing causal chains through your knowledge graph to discover
            what you truly need to achieve.
          </p>
        </div>
      </DashboardCard>
    );
  }

  // ── ERROR STATE ──

  if (objectiveAutoError) {
    return (
      <DashboardCard
        title="Objective Command Center"
        icon={<Crosshair className="h-4 w-4" />}
        collapsible={false}
      >
        <div className="flex flex-col items-center py-4 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 mb-2.5">
            <AlertTriangle className="h-4.5 w-4.5 text-red-400" />
          </div>
          <p className="text-xs font-medium text-gray-600">
            Objective detection encountered an issue
          </p>
          <p className="mt-1 text-[10px] text-red-400 max-w-[280px]">
            {objectiveAutoError}
          </p>
          {onDetectObjectives && (
            <button
              onClick={onDetectObjectives}
              className="mt-2 rounded-md bg-interaxis-50 px-3 py-1.5 text-[10px] font-semibold text-interaxis-600 hover:bg-interaxis-100 transition-colors"
            >
              Try again
            </button>
          )}
        </div>
      </DashboardCard>
    );
  }

  // ── EMPTY STATE ──

  return (
    <DashboardCard
      title="Objective Command Center"
      icon={<Crosshair className="h-4 w-4" />}
      collapsible={false}
    >
      <div className="flex flex-col items-center py-5 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-interaxis-50 mb-3">
          <Target className="h-5 w-5 text-interaxis-400" />
        </div>
        <p className="text-sm font-semibold text-gray-700">
          {synthesisData ? "No objectives detected yet" : "Run synthesis first"}
        </p>
        <p className="mt-1.5 text-xs text-gray-500 max-w-[340px] leading-relaxed">
          {synthesisData
            ? "Click below to detect objectives from your analysis — the AI will identify what to optimize, track, and measure based on your leverage points, risks, and bottleneck."
            : "Synthesis is required before objectives can be detected. Type /synthesize in the chat to run the analysis pipeline."}
        </p>
        {onDetectObjectives && synthesisData && (
          <button
            onClick={onDetectObjectives}
            disabled={objectiveAutoLoading}
            className="mt-4 flex items-center gap-2 rounded-lg bg-interaxis-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-interaxis-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            {objectiveAutoLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Detecting...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Detect Objectives
              </>
            )}
          </button>
        )}
        {objectiveAutoError && (
          <p className="mt-2 text-[10px] text-red-500 max-w-[300px]">
            {objectiveAutoError} — try again
          </p>
        )}
      </div>
    </DashboardCard>
  );
}
