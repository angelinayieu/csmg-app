"use client";

import { useMemo, useState, useEffect } from "react";
import { Target, Plus, LayoutDashboard, Table2, ChevronDown, GitBranch, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ImprovementGoal } from "@/types/goals";

export type ViewMode = "dashboard" | "tabs";

interface DashboardTopBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  activeGoal: ImprovementGoal | null;
  goals: ImprovementGoal[];
  onSelectGoal: (goal: ImprovementGoal | null) => void;
  onCreateGoal: () => void;
}

export function DashboardTopBar({
  viewMode,
  onViewModeChange,
  activeGoal,
  goals,
  onSelectGoal,
  onCreateGoal,
}: DashboardTopBarProps) {
  const [goalDropdownOpen, setGoalDropdownOpen] = useState(false);
  const [intelGoalIds, setIntelGoalIds] = useState<Set<string>>(new Set());

  const currentSpaceId = activeGoal?.space_id ?? goals[0]?.space_id ?? null;

  useEffect(() => {
    if (!currentSpaceId) {
      setIntelGoalIds(new Set());
      return;
    }
    try {
      const raw = window.localStorage.getItem(`interaxis:intel-goal-links:${currentSpaceId}`);
      if (!raw) {
        setIntelGoalIds(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, string>;
      setIntelGoalIds(new Set(Object.keys(parsed)));
    } catch {
      setIntelGoalIds(new Set());
    }
  }, [currentSpaceId]);

  // Build tree: top-level goals + their children
  const topLevelGoals = useMemo(
    () => goals.filter((g) => !g.parent_goal_id),
    [goals]
  );
  const childMap = useMemo(() => {
    const map = new Map<string, ImprovementGoal[]>();
    for (const g of goals) {
      if (g.parent_goal_id) {
        const arr = map.get(g.parent_goal_id) ?? [];
        arr.push(g);
        map.set(g.parent_goal_id, arr);
      }
    }
    return map;
  }, [goals]);

  // Count active sub-objectives for display
  const activeChildCount = activeGoal
    ? (childMap.get(activeGoal.id) ?? []).filter((c) => c.status === "active").length
    : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100">
      {/* View mode toggle */}
      <div className="flex items-center rounded-lg bg-gray-100 p-0.5">
        <button
          onClick={() => onViewModeChange("dashboard")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            viewMode === "dashboard"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Dashboard
        </button>
        <button
          onClick={() => onViewModeChange("tabs")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            viewMode === "tabs"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          <Table2 className="h-3.5 w-3.5" />
          Classic
        </button>
      </div>

      {/* Goal dropdown — only in dashboard mode */}
      {viewMode === "dashboard" && (
        <div className="relative">
          <button
            onClick={() => setGoalDropdownOpen(!goalDropdownOpen)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              activeGoal
                ? "border-interaxis-200 bg-interaxis-50 text-interaxis-700"
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
            )}
          >
            <Target className="h-3.5 w-3.5" />
            {activeGoal ? activeGoal.title : "Set objective"}
            {activeGoal && intelGoalIds.has(activeGoal.id) && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1 py-0.5 text-[9px] font-medium text-indigo-700">
                <Radar className="h-2.5 w-2.5" />
                Intel
              </span>
            )}
            {activeChildCount > 0 && (
              <span className="text-[9px] text-interaxis-500 font-normal">
                +{activeChildCount} sub
              </span>
            )}
            <ChevronDown className={cn(
              "h-3 w-3 transition-transform",
              goalDropdownOpen && "rotate-180"
            )} />
          </button>

          {goalDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setGoalDropdownOpen(false)}
              />
              <div className="absolute top-full left-0 z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-80 overflow-y-auto">
                {topLevelGoals.length > 0 && (
                  <>
                    {topLevelGoals.map((goal) => {
                      const children = childMap.get(goal.id) ?? [];
                      return (
                        <div key={goal.id}>
                          <button
                            onClick={() => {
                              onSelectGoal(goal);
                              setGoalDropdownOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors",
                              activeGoal?.id === goal.id && "bg-interaxis-50"
                            )}
                          >
                            <Target className="h-3 w-3 flex-shrink-0 text-gray-400" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-700 truncate">
                                {goal.title}
                                {intelGoalIds.has(goal.id) && (
                                  <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1 py-0.5 text-[9px] font-medium text-indigo-700 align-middle">
                                    <Radar className="h-2.5 w-2.5" />
                                    Intel
                                  </span>
                                )}
                              </p>
                              <p className="text-gray-400 truncate">
                                {goal.current_value}/{goal.target_value} {goal.metric_unit ?? goal.metric_name}
                                {children.length > 0 && (
                                  <span className="ml-1 text-interaxis-400">· {children.length} sub</span>
                                )}
                              </p>
                            </div>
                          </button>
                          {/* Indented children */}
                          {children.map((child) => (
                            <button
                              key={child.id}
                              onClick={() => {
                                onSelectGoal(child);
                                setGoalDropdownOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 pl-8 pr-3 py-1.5 text-left text-[11px] hover:bg-gray-50 transition-colors",
                                activeGoal?.id === child.id && "bg-interaxis-50"
                              )}
                            >
                              <GitBranch className="h-2.5 w-2.5 flex-shrink-0 text-gray-300" />
                              <div className="flex-1 min-w-0">
                                <p className="text-gray-600 truncate">{child.title}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                    <div className="my-1 border-t border-gray-100" />
                  </>
                )}
                {activeGoal && (
                  <button
                    onClick={() => {
                      onSelectGoal(null);
                      setGoalDropdownOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-400 hover:bg-gray-50"
                  >
                    Clear goal
                  </button>
                )}
                <button
                  onClick={() => {
                    onCreateGoal();
                    setGoalDropdownOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-interaxis-600 hover:bg-interaxis-50"
                >
                  <Plus className="h-3 w-3" />
                  New objective
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
