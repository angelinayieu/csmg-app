"use client";

import { cn } from "@/lib/utils";
import type { ImprovementGoal } from "@/types/goals";

interface GoalStripProps {
  goal: ImprovementGoal;
  className?: string;
}

export function GoalStrip({ goal, className }: GoalStripProps) {
  const range = goal.target_value - goal.baseline_value;
  const progress = range !== 0
    ? Math.round(((goal.current_value - goal.baseline_value) / range) * 100)
    : 0;
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div
      className={cn(
        "flex items-center gap-5 rounded-xl border border-gray-200 bg-gray-50/80 px-5 py-3.5",
        "border-l-[3px] border-l-blue-500",
        className,
      )}
    >
      {/* Goal text */}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="h-[5px] w-[5px] rounded-full bg-green-500" />
          <span className="text-[9.5px] font-bold uppercase tracking-wider text-blue-600">
            Optimizing toward &middot; master outcome
          </span>
        </div>
        <p className="truncate text-sm font-bold text-gray-900">
          {goal.title}
        </p>
      </div>

      {/* Current */}
      <div className="text-right">
        <div className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
          Current
        </div>
        <div className="text-lg font-bold text-gray-900">
          {goal.current_value}
          {goal.metric_unit ? <span className="text-xs text-gray-400">{goal.metric_unit}</span> : null}
        </div>
      </div>

      {/* Target */}
      <div className="text-right">
        <div className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
          Target
        </div>
        <div className="text-lg font-bold text-green-600">
          {goal.target_value}
          {goal.metric_unit ? <span className="text-xs text-gray-400">{goal.metric_unit}</span> : null}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-40">
        <div className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
          Progress &middot; {clampedProgress}%
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-500"
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
