"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Target } from "lucide-react";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import type { ImprovementGoal, GoalProgress } from "@/types/goals";

interface TrajectoryModuleProps {
  goal: ImprovementGoal;
}

export function TrajectoryModule({ goal }: TrajectoryModuleProps) {
  const [progress, setProgress] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/goals/${goal.id}/progress`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setProgress(data.progress ?? []);
        }
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [goal.id]);

  const pct = goal.target_value > 0
    ? Math.round((Number(goal.current_value) / Number(goal.target_value)) * 100)
    : 0;

  const gap = Number(goal.target_value) - Number(goal.current_value);

  return (
    <DashboardCard
      title="Metric & Trajectory"
      icon={<TrendingUp className="h-4 w-4" />}
      subtitle={goal.title}
      collapsible={false}
    >
      {/* Goal summary */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">
              {Number(goal.current_value)}
            </span>
            <span className="text-sm text-gray-400">
              / {Number(goal.target_value)} {goal.metric_unit ?? goal.metric_name}
            </span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-interaxis-500 transition-all duration-500"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            {pct}% complete — {gap > 0 ? `${gap} ${goal.metric_unit ?? "units"} to go` : "Goal reached!"}
          </p>
        </div>
        <div className="flex flex-col items-center">
          <Target className="h-5 w-5 text-interaxis-500" />
          <span className="mt-0.5 text-[10px] font-medium text-interaxis-600">
            {pct}%
          </span>
        </div>
      </div>

      {/* Trajectory chart (SVG sparkline) */}
      {!loading && progress.length > 1 && (
        <TrajectoryChart
          progress={progress}
          target={Number(goal.target_value)}
          baseline={Number(goal.baseline_value)}
        />
      )}

      {!loading && progress.length <= 1 && (
        <div className="flex items-center justify-center py-4 text-xs text-gray-400">
          Record progress to see your trajectory chart
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-4 text-xs text-gray-400">
          Loading progress...
        </div>
      )}

      {goal.deadline && (
        <p className="mt-2 text-[10px] text-gray-400">
          Deadline: {new Date(goal.deadline).toLocaleDateString()}
        </p>
      )}
    </DashboardCard>
  );
}

/** Simple SVG sparkline chart — no external dependencies */
function TrajectoryChart({
  progress,
  target,
  baseline,
}: {
  progress: GoalProgress[];
  target: number;
  baseline: number;
}) {
  const W = 320;
  const H = 100;
  const PAD = { top: 10, right: 10, bottom: 20, left: 10 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = progress.map((p) => Number(p.value));
  const minVal = Math.min(baseline, ...values) * 0.95;
  const maxVal = Math.max(target, ...values) * 1.05;
  const range = maxVal - minVal || 1;

  const scaleY = (v: number) => PAD.top + plotH - ((v - minVal) / range) * plotH;
  const scaleX = (i: number) =>
    PAD.left + (progress.length > 1 ? (i / (progress.length - 1)) * plotW : plotW / 2);

  const points = progress.map((_, i) => `${scaleX(i)},${scaleY(values[i])}`).join(" ");
  const targetY = scaleY(target);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {/* Target line */}
      <line
        x1={PAD.left}
        y1={targetY}
        x2={W - PAD.right}
        y2={targetY}
        stroke="#22C55E"
        strokeWidth={1}
        strokeDasharray="4 2"
        opacity={0.5}
      />
      <text x={W - PAD.right - 2} y={targetY - 3} textAnchor="end" fontSize={8} fill="#22C55E">
        Target
      </text>

      {/* Progress line */}
      <polyline
        points={points}
        fill="none"
        stroke="#6366F1"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Data points */}
      {progress.map((_, i) => (
        <circle
          key={i}
          cx={scaleX(i)}
          cy={scaleY(values[i])}
          r={3}
          fill="white"
          stroke="#6366F1"
          strokeWidth={1.5}
        />
      ))}

      {/* X-axis labels: first and last date */}
      {progress.length >= 2 && (
        <>
          <text x={PAD.left} y={H - 2} fontSize={8} fill="#9CA3AF">
            {new Date(progress[0].recorded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </text>
          <text x={W - PAD.right} y={H - 2} textAnchor="end" fontSize={8} fill="#9CA3AF">
            {new Date(progress[progress.length - 1].recorded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </text>
        </>
      )}
    </svg>
  );
}
