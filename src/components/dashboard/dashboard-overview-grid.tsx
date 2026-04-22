"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Target,
  Network,
  BarChart3,
  Activity,
  Database,
  Zap,
  Radar,
  BookOpen,
  ChevronRight,
  ChevronDown,
  Lock,
  Expand,
  Check,
  GitBranch,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpaceData } from "@/contexts/space-data-context";
import type { SuggestedObjective } from "@/types/goals";
import { getChildGoals } from "@/lib/goals/build-goal-tree";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import type { SynthesisData } from "@/types/synthesis";
import {
  IconGraph,
  IconBars,
  IconPulse,
  IconDb,
  IconBolt,
  IconRadar,
  IconBook,
  IconArrowRight,
} from "@/components/dashboard/glass-glyphs";
import { RecommendationCardBody } from "@/components/dashboard/recommendation-card-body";

// ---------------------------------------------------------------------------
// Overview Card
// ---------------------------------------------------------------------------

function OverviewCard({
  title,
  icon,
  href,
  locked,
  lockMessage,
  metric,
  metricLabel,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  locked?: boolean;
  lockMessage?: string;
  metric?: string | number;
  metricLabel?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  if (locked) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-5 flex flex-col",
          className
        )}
      >
        <div className="flex items-center gap-2 mb-2">
          <Lock className="h-3.5 w-3.5 text-gray-300" />
          <span className="text-xs font-semibold text-gray-400">{title}</span>
        </div>
        <p className="text-[11px] text-gray-400 flex-1">
          {lockMessage ?? "Run synthesis to unlock"}
        </p>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "group rounded-xl border border-gray-200 bg-white p-5 flex flex-col hover:border-interaxis-200 hover:shadow-md transition-all",
        className
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-interaxis-50 text-interaxis-600">
            {icon}
          </div>
          <span className="text-xs font-semibold text-gray-700">{title}</span>
        </div>
        {metric !== undefined && (
          <div className="text-right">
            <div className="text-sm font-bold text-gray-900">{metric}</div>
            {metricLabel && (
              <div className="text-[9px] text-gray-400 uppercase tracking-wider">
                {metricLabel}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 text-xs text-gray-500">{children}</div>
      <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-interaxis-600 opacity-0 group-hover:opacity-100 transition-opacity">
        <Expand className="h-3 w-3" />
        View full page
        <ChevronRight className="h-3 w-3" />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Reticle Icon (custom objectives icon with animated sweep)
// ---------------------------------------------------------------------------

function ReticleIcon({ size = 28 }: { size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-lg"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(145deg, #0a1020 0%, #1e2a4a 55%, #3b5bdb 110%)",
        boxShadow: "0 4px 12px rgba(0,30,140,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
      }}
    >
      <div
        className="absolute inset-[-50%] animate-[sweep_4s_linear_infinite]"
        style={{
          background: "conic-gradient(from 0deg, rgba(99,102,241,0) 0deg, rgba(99,102,241,0.45) 60deg, rgba(99,102,241,0) 120deg)",
        }}
      />
      <div
        className="absolute inset-[1.5px] rounded-[inherit] z-[1]"
        style={{ background: "linear-gradient(145deg, #0a1020 0%, #1e2a4a 55%, #3b5bdb 110%)" }}
      />
      <svg
        viewBox="0 0 24 24"
        className="relative z-[2]"
        style={{ width: size * 0.55, height: size * 0.55, filter: "drop-shadow(0 0 4px rgba(120,180,255,0.6))" }}
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" fill="white" stroke="none" />
        <line x1="12" y1="1" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="23" />
        <line x1="1" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="23" y2="12" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Objective Overview Banner (collapsible objectives tree)
// ---------------------------------------------------------------------------

function ObjectiveOverviewBanner({
  base,
  hasSynthesis,
  activeGoal,
  goalList,
  pendingObjectives,
  onSelectGoal,
  onCreateGoal,
}: {
  base: string;
  hasSynthesis: boolean;
  activeGoal: import("@/types/goals").ImprovementGoal | null;
  goalList: import("@/types/goals").ImprovementGoal[];
  pendingObjectives: SuggestedObjective[];
  onSelectGoal: (goal: import("@/types/goals").ImprovementGoal | null) => void;
  onCreateGoal: () => void;
}) {
  const [treeExpanded, setTreeExpanded] = useState(false);
  const [goalDropdownOpen, setGoalDropdownOpen] = useState(false);

  // Build tree: top-level goals + their children
  const topLevelGoals = useMemo(
    () => goalList.filter((g) => !g.parent_goal_id),
    [goalList],
  );
  const goalChildMap = useMemo(() => {
    const map = new Map<string, import("@/types/goals").ImprovementGoal[]>();
    for (const g of goalList) {
      if (g.parent_goal_id) {
        const arr = map.get(g.parent_goal_id) ?? [];
        arr.push(g);
        map.set(g.parent_goal_id, arr);
      }
    }
    return map;
  }, [goalList]);

  const childGoals = useMemo(
    () => (activeGoal ? getChildGoals(goalList, activeGoal.id) : []),
    [goalList, activeGoal],
  );
  const trackedCount = goalList.filter((g) => g.status === "active").length;
  const totalDetected = goalList.length + pendingObjectives.length;

  // Locked state (no synthesis)
  if (!hasSynthesis) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-5 flex flex-col w-full">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="h-3.5 w-3.5 text-gray-300" />
          <span className="text-xs font-semibold text-gray-400">Main Objective + Overview</span>
        </div>
        <p className="text-[11px] text-gray-400 flex-1">
          Run synthesis to unlock
        </p>
      </div>
    );
  }

  // Compute progress for active goal
  const progress = activeGoal
    ? (() => {
        const range = Number(activeGoal.target_value) - Number(activeGoal.baseline_value);
        if (range === 0) return 0;
        const p = Number(activeGoal.current_value) - Number(activeGoal.baseline_value);
        return Math.max(0, Math.min(100, Math.round((p / range) * 100)));
      })()
    : 0;

  // Depth config for badges
  const depthColor: Record<string, string> = {
    fundamental: "bg-blue-50 text-blue-700 border-blue-200",
    structural: "bg-purple-50 text-purple-700 border-purple-200",
    surface: "bg-amber-50 text-amber-700 border-amber-200",
  };
  const typeLabel: Record<string, string> = {
    maximize: "MAX",
    minimize: "MIN",
    maintain: "KEEP",
    explore: "EXP",
    avoid: "AVOID",
  };
  const typeColor: Record<string, string> = {
    maximize: "text-green-700 bg-green-50",
    minimize: "text-red-700 bg-red-50",
    maintain: "text-blue-700 bg-blue-50",
    explore: "text-purple-700 bg-purple-50",
    avoid: "text-amber-700 bg-amber-50",
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white w-full overflow-hidden hover:border-interaxis-200 transition-all">
      {/* Header row */}
      <div className="flex items-center gap-3 p-5 pb-3">
        <ReticleIcon size={32} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-700">Main Objective + Overview</span>
            {totalDetected > 0 && (
              <span className="text-[10px] text-gray-400">
                {totalDetected} detected · <span className="text-interaxis-600 font-semibold">{trackedCount} tracked</span>
              </span>
            )}
          </div>
          {activeGoal ? (
            <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
              {activeGoal.title}
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">
              Set an objective to track progress across your analysis
            </p>
          )}
        </div>

        {/* Progress + dropdown */}
        {activeGoal && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <div className="text-sm font-bold text-gray-900 tabular-nums">{progress}%</div>
              <div className="text-[9px] text-gray-400 uppercase tracking-wider">progress</div>
            </div>
            <div className="relative">
              <button
                onClick={() => setGoalDropdownOpen(!goalDropdownOpen)}
                className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-interaxis-600 hover:border-interaxis-200 hover:bg-interaxis-50 transition-colors"
              >
                <Target className="h-3 w-3" />
                <ChevronDown className={cn("h-3 w-3 transition-transform", goalDropdownOpen && "rotate-180")} />
              </button>
              {goalDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setGoalDropdownOpen(false)} />
                  <div className="absolute top-full right-0 z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-80 overflow-y-auto">
                    {topLevelGoals.length > 0 && (
                      <>
                        {topLevelGoals.map((goal) => {
                          const children = goalChildMap.get(goal.id) ?? [];
                          return (
                            <div key={goal.id}>
                              <button
                                onClick={() => { onSelectGoal(goal); setGoalDropdownOpen(false); }}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors",
                                  activeGoal?.id === goal.id && "bg-interaxis-50",
                                )}
                              >
                                <Target className="h-3 w-3 flex-shrink-0 text-gray-400" />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-700 truncate">{goal.title}</p>
                                  <p className="text-gray-400 truncate">
                                    {goal.current_value}/{goal.target_value} {goal.metric_unit ?? goal.metric_name}
                                    {children.length > 0 && <span className="ml-1 text-interaxis-400">&middot; {children.length} sub</span>}
                                  </p>
                                </div>
                              </button>
                              {children.map((child) => (
                                <button
                                  key={child.id}
                                  onClick={() => { onSelectGoal(child); setGoalDropdownOpen(false); }}
                                  className={cn(
                                    "flex w-full items-center gap-2 pl-8 pr-3 py-1.5 text-left text-[11px] hover:bg-gray-50 transition-colors",
                                    activeGoal?.id === child.id && "bg-interaxis-50",
                                  )}
                                >
                                  <GitBranch className="h-2.5 w-2.5 flex-shrink-0 text-gray-300" />
                                  <p className="text-gray-600 truncate flex-1">{child.title}</p>
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
                        onClick={() => { onSelectGoal(null); setGoalDropdownOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-400 hover:bg-gray-50"
                      >
                        Clear goal
                      </button>
                    )}
                    <button
                      onClick={() => { onCreateGoal(); setGoalDropdownOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-interaxis-600 hover:bg-interaxis-50"
                    >
                      <Plus className="h-3 w-3" />
                      New objective
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {!activeGoal && hasSynthesis && (
          <div className="relative">
            <button
              onClick={() => setGoalDropdownOpen(!goalDropdownOpen)}
              className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-interaxis-600 hover:border-interaxis-200 hover:bg-interaxis-50 transition-colors"
            >
              <Target className="h-3 w-3" />
              Set objective
              <ChevronDown className={cn("h-3 w-3 transition-transform", goalDropdownOpen && "rotate-180")} />
            </button>
            {goalDropdownOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setGoalDropdownOpen(false)} />
                <div className="absolute top-full right-0 z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-80 overflow-y-auto">
                  {topLevelGoals.length > 0 && (
                    <>
                      {topLevelGoals.map((goal) => {
                        const children = goalChildMap.get(goal.id) ?? [];
                        return (
                          <div key={goal.id}>
                            <button
                              onClick={() => { onSelectGoal(goal); setGoalDropdownOpen(false); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              <Target className="h-3 w-3 flex-shrink-0 text-gray-400" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-700 truncate">{goal.title}</p>
                                <p className="text-gray-400 truncate">
                                  {goal.current_value}/{goal.target_value} {goal.metric_unit ?? goal.metric_name}
                                  {children.length > 0 && <span className="ml-1 text-interaxis-400">&middot; {children.length} sub</span>}
                                </p>
                              </div>
                            </button>
                            {children.map((child) => (
                              <button
                                key={child.id}
                                onClick={() => { onSelectGoal(child); setGoalDropdownOpen(false); }}
                                className="flex w-full items-center gap-2 pl-8 pr-3 py-1.5 text-left text-[11px] hover:bg-gray-50 transition-colors"
                              >
                                <GitBranch className="h-2.5 w-2.5 flex-shrink-0 text-gray-300" />
                                <p className="text-gray-600 truncate flex-1">{child.title}</p>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                      <div className="my-1 border-t border-gray-100" />
                    </>
                  )}
                  <button
                    onClick={() => { onCreateGoal(); setGoalDropdownOpen(false); }}
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

      {/* Progress bar */}
      {activeGoal && (
        <div className="mx-5 h-1 rounded-full bg-gray-100 overflow-hidden mb-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-interaxis-400 to-interaxis-600 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Collapsible sub-objectives tree */}
      {(childGoals.length > 0 || pendingObjectives.length > 0) && (
        <>
          <button
            onClick={() => setTreeExpanded(!treeExpanded)}
            className="flex items-center gap-1.5 w-full px-5 py-2 text-left border-t border-gray-100 hover:bg-gray-50/50 transition-colors"
          >
            {treeExpanded ? (
              <ChevronDown className="h-3 w-3 text-gray-400" />
            ) : (
              <ChevronRight className="h-3 w-3 text-gray-400" />
            )}
            <GitBranch className="h-3 w-3 text-gray-400" />
            <span className="text-[10px] font-semibold text-gray-500">
              {childGoals.length > 0
                ? `${childGoals.length} sub-objectives`
                : `${pendingObjectives.length} suggested`}
            </span>
            {childGoals.length > 0 && (
              <span className="text-[10px] text-gray-400">
                · {childGoals.filter((c) => c.status === "achieved").length}/{childGoals.length} complete
              </span>
            )}
          </button>

          {treeExpanded && (
            <div className="px-5 pb-4 space-y-0">
              {/* Accepted sub-objectives */}
              {childGoals.map((child, i) => {
                const isLast = i === childGoals.length - 1 && pendingObjectives.length === 0;
                const cPct = (() => {
                  const r = Number(child.target_value) - Number(child.baseline_value);
                  if (r === 0) return 0;
                  return Math.max(0, Math.min(100, Math.round(((Number(child.current_value) - Number(child.baseline_value)) / r) * 100)));
                })();
                return (
                  <div key={child.id} className="relative pl-6 pb-1.5">
                    {/* Spine */}
                    <div className={cn("absolute left-[9px] top-0 w-px bg-gray-200", isLast ? "h-3" : "h-full")} />
                    {/* Bend */}
                    <svg className="absolute left-[5px] top-[4px] text-gray-200" width="14" height="12" viewBox="0 0 14 12" fill="none">
                      <path d="M4 0 L4 5 Q4 8 7 8 L14 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                    </svg>
                    {/* Dot */}
                    <div className={cn(
                      "absolute left-[6px] top-[4px] h-[7px] w-[7px] rounded-full border-[1.5px] z-[1]",
                      child.status === "achieved"
                        ? "border-green-400 bg-green-400"
                        : "border-interaxis-300 bg-white",
                    )}>
                      {child.status === "achieved" && (
                        <Check className="h-[5px] w-[5px] text-white" style={{ marginTop: -1, marginLeft: -0.5 }} />
                      )}
                    </div>
                    {/* Content */}
                    <div className="flex items-center gap-2 py-1">
                      <span className={cn("rounded px-1 py-0 text-[8px] font-bold", typeColor[child.objective_type] ?? "text-gray-500 bg-gray-50")}>
                        {typeLabel[child.objective_type] ?? "OBJ"}
                      </span>
                      <p className="text-[11px] font-medium text-gray-700 truncate flex-1">{child.title}</p>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="w-16 h-1 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              child.status === "achieved" ? "bg-green-400" : "bg-interaxis-400",
                            )}
                            style={{ width: `${cPct}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-gray-400 tabular-nums w-6 text-right">{cPct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Pending suggested objectives (not yet accepted) */}
              {!activeGoal && pendingObjectives.slice(0, 4).map((obj, i) => {
                const isLast = i === Math.min(pendingObjectives.length, 4) - 1;
                return (
                  <div key={obj.key} className="relative pl-6 pb-1.5">
                    <div className={cn("absolute left-[9px] top-0 w-px bg-gray-200", isLast ? "h-3" : "h-full")} />
                    <svg className="absolute left-[5px] top-[4px] text-gray-200" width="14" height="12" viewBox="0 0 14 12" fill="none">
                      <path d="M4 0 L4 5 Q4 8 7 8 L14 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeDasharray="2 2" />
                    </svg>
                    <div className="absolute left-[6px] top-[4px] h-[7px] w-[7px] rounded-full border-[1.5px] border-gray-300 bg-white z-[1]" />
                    <div className="flex items-center gap-2 py-1">
                      <span className={cn("rounded px-1 py-0 text-[8px] font-bold", typeColor[obj.objective_type] ?? "text-gray-500 bg-gray-50")}>
                        {typeLabel[obj.objective_type] ?? "OBJ"}
                      </span>
                      {obj.depth && (
                        <span className={cn("rounded border px-1 py-0 text-[7px] font-medium", depthColor[obj.depth] ?? "")}>
                          {obj.depth.slice(0, 5)}
                        </span>
                      )}
                      <p className="text-[11px] text-gray-500 truncate flex-1">{obj.title}</p>
                      {obj.confidence && (
                        <span className="text-[9px] text-gray-400">{obj.confidence}</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {pendingObjectives.length > 4 && !activeGoal && (
                <p className="pl-6 text-[10px] text-gray-400">
                  +{pendingObjectives.length - 4} more suggested
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Grid
// ---------------------------------------------------------------------------

export function DashboardOverviewGrid() {
  const ctx = useSpaceData();
  const base = `/app/space/${ctx.space.id}`;
  const hasSynthesis = ctx.hasSynthesis;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthData = ctx.space.synthesis_data as Record<string, any> | null;
  const strategicRec = synthData?.strategic_recommendation;
  const entityCount = ctx.entities.length;

  const coreEntities = entityCount === 0 ? 0 : ctx.entities.filter((e) => e.knowledge_layer !== "external").length;
  const externalEntities = entityCount === 0 ? 0 : ctx.entities.filter((e) => e.knowledge_layer === "external").length;

  // ── Dynamic layer breakdown (fixes hardcoded "4 layers" + binary core/external split) ──
  const layerBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of ctx.entities) {
      const key = (e.knowledge_layer ?? "core").toString();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const order = ["core", "conceptual", "bridge", "external", "internal"];
    const entries = Object.entries(counts).sort(
      (a, b) => (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) -
                (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]))
    );
    return entries; // [["core", 8], ["external", 12], ...]
  }, [ctx.entities]);

  const layerCount = useMemo(() => {
    const layers = new Set<string>();
    for (const e of ctx.entities) {
      const k = (e.layer ?? e.knowledge_layer ?? "default").toString();
      if (k) layers.add(k);
    }
    return Math.max(1, layers.size);
  }, [ctx.entities]);

  // ── Rich synthesis-data extracts (wires "dead" cards to real data) ──
  const probabilitySummary = strategicRec?.probability_space_summary as
    | { spaces_analyzed: number; intersections_found: number; high_risk_points: number; key_insights?: string[] }
    | undefined;
  const researchProvenance = synthData?.research_provenance as
    | {
        top_sources?: Array<{ domain: string; count: number }>;
        authority_distribution?: { high: number; moderate: number; low: number; unverified: number };
        entities_from_search?: number;
        research_mode?: "web_verified" | "training_only" | "mixed";
        searches_performed?: number;
      }
    | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worthConsidering = (synthData?.worth_considering ?? []) as Array<{ type: string; confidence?: string }>;
  const frameworkCount = worthConsidering.filter((w) => w.type === "framework").length;
  const analogyCount = worthConsidering.filter((w) => w.type === "analogy" || w.type === "precedent").length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signalExtraction = synthData?.signal_extraction as any;
  const signalCount =
    (signalExtraction?.hypotheses?.length ?? 0) +
    (signalExtraction?.hidden_variables?.length ?? 0) +
    (signalExtraction?.cascade_vulnerabilities?.length ?? 0);

  const openQuestionCount = (synthData?.open_questions as unknown[] | undefined)?.length ?? 0;
  const leveragePointCount = (synthData?.leverage_points as unknown[] | undefined)?.length ?? 0;
  const riskPointCount = (synthData?.risk_points as unknown[] | undefined)?.length ?? 0;
  const feedbackLoopCount = (synthData?.feedback_loops as unknown[] | undefined)?.length ?? 0;
  const crossContextCount = (synthData?.cross_context_insights as unknown[] | undefined)?.length ?? 0;
  const qualityScore = (synthData?.quality_score as { overall?: number } | undefined)?.overall ?? null;

  // ── Twin preview (computed from live data — doesn't wait for strategy approval) ──
  const twinMacro = useMemo(() => {
    if (entityCount < 3) return null;
    try {
      const synthDataTyped = (synthData ?? null) as unknown as SynthesisData | null;
      const state = computeTwinState(
        ctx.space,
        ctx.entities,
        ctx.edges,
        ctx.cycles,
        synthDataTyped,
        ctx.activeGoal ?? null,
        undefined
      );
      return state.macro;
    } catch (err) {
      // computeTwinState can throw if data is malformed — don't let it break the dashboard
      console.warn("[dashboard] twin compute failed:", err);
      return null;
    }
  }, [ctx.space, ctx.entities, ctx.edges, ctx.cycles, ctx.activeGoal, synthData, entityCount]);

  // Layer palette — gradient per layer for visual consistency
  const layerPalette = [
    "linear-gradient(90deg,#1a7aff,#0051ff)",
    "linear-gradient(90deg,#4fa3ff,#1a7aff)",
    "linear-gradient(90deg,#5856d6,#3c44d9)",
    "linear-gradient(90deg,#a855f7,#5856d6)",
    "linear-gradient(90deg,#ec4899,#a855f7)",
  ];

  return (
    <>
      <style>{glassDashStyles}</style>
      <div className="glass-dash-root h-full overflow-y-auto relative">
        <div className="glass-dash-inner relative min-h-full">
          {/* Contained animated background — fills the entire content area, not just viewport */}
          <div className="glass-dash-bg" aria-hidden>
            <div className="gd-sphere s1"><div className="body" /></div>
            <div className="gd-sphere s2"><div className="body" /></div>
            <div className="gd-sphere s3"><div className="body" /></div>
            <div className="gd-sphere s4"><div className="body" /></div>
            <div className="gd-frost" />
            <div className="gd-grain" />
          </div>

          <div className="relative z-[1] p-6 space-y-4">
          {/* Row 0: Main Objective + Overview banner (existing functionality, preserved) */}
          <ObjectiveOverviewBanner
            base={base}
            hasSynthesis={hasSynthesis}
            activeGoal={ctx.activeGoal}
            goalList={ctx.goalList}
            pendingObjectives={ctx.pendingObjectives}
            onSelectGoal={ctx.setActiveGoal}
            onCreateGoal={() => {
              ctx.setGoalPrefill(null);
              ctx.setShowGoalSetter(true);
            }}
          />

          {/* Row 1-2: 3-column glass-morphism grid (spans match reference) */}
          <div className="grid grid-cols-3 gap-2.5 auto-rows-[minmax(0,auto)]">
            {/* KG Multiview */}
            <GlassCard
              href={`${base}/whiteboard?drawer=graph&tab=graph`}
              locked={entityCount === 0}
              lockMessage="Add entities via chat to build the graph"
              icon={<IconGraph className="h-[17px] w-[17px]" />}
              title="KG Multiview"
              sub={entityCount > 0 ? `${ctx.edges.length} edges · ${ctx.cycles.length} cycles` : undefined}
              metric={entityCount > 0 ? entityCount : undefined}
              metricLabel="Entities"
            >
              {entityCount > 0 && (
                <div className="mt-3">
                  {/* Layer distribution bar — one segment per knowledge_layer, width proportional to count */}
                  <div className="flex gap-0 h-1.5 rounded-full overflow-hidden bg-[rgba(10,30,80,0.05)]">
                    {layerBreakdown.map(([layer, count], i) => (
                      <div
                        key={layer}
                        className="h-full"
                        style={{
                          flex: count,
                          background: layerPalette[i % layerPalette.length],
                          opacity: 0.85 - i * 0.15,
                        }}
                        title={`${layer}: ${count}`}
                      />
                    ))}
                  </div>
                  <div className="mt-2.5 flex items-center gap-3 text-[12px] text-[#556479]">
                    <span><strong className="text-[#0a1020] font-bold">{layerCount}</strong> {layerCount === 1 ? "layer" : "layers"}</span>
                    <span className="w-[3px] h-[3px] rounded-full bg-[#b4bfd0]" />
                    <span>density <strong className="text-[#0a1020] font-bold">{(ctx.edges.length / Math.max(entityCount, 1)).toFixed(2)}</strong></span>
                    {ctx.space.orphan_count > 0 && (
                      <>
                        <span className="w-[3px] h-[3px] rounded-full bg-[#b4bfd0]" />
                        <span className="text-amber-700"><strong>{ctx.space.orphan_count}</strong> orphan{ctx.space.orphan_count === 1 ? "" : "s"}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </GlassCard>

            {/* Metrics Graph — wired to real probability_space_summary + signal_extraction */}
            <GlassCard
              href={`${base}/whiteboard?drawer=probability&tab=spaces`}
              locked={!hasSynthesis}
              lockMessage="Run synthesis to unlock"
              icon={<IconBars className="h-[17px] w-[17px]" />}
              title="Metrics Graph"
              sub={
                probabilitySummary
                  ? `${probabilitySummary.spaces_analyzed} spaces · ${probabilitySummary.intersections_found} intersections`
                  : "Probability space intelligence"
              }
            >
              {hasSynthesis && (() => {
                // Build 4 bars from real data — scale each to its max within the set
                const bars: Array<{ label: string; value: number; color: string }> = [];
                if (probabilitySummary) {
                  bars.push(
                    { label: "Spaces", value: probabilitySummary.spaces_analyzed, color: "#1a7aff" },
                    { label: "Joins", value: probabilitySummary.intersections_found, color: "#0051ff" },
                    { label: "Risks", value: probabilitySummary.high_risk_points, color: "#dc2626" }
                  );
                }
                if (signalCount > 0 || !probabilitySummary) {
                  bars.push({ label: "Signals", value: signalCount, color: "#a855f7" });
                }
                if (feedbackLoopCount > 0) {
                  bars.push({ label: "Loops", value: feedbackLoopCount, color: "#059669" });
                }
                if (bars.length === 0) {
                  return (
                    <p className="mt-3 text-[11.5px] text-[#8592a8]">
                      No probability-space data yet. Run strategy to compute failure analysis.
                    </p>
                  );
                }
                const maxVal = Math.max(1, ...bars.map((b) => b.value));
                return (
                  <div className="mt-3">
                    <div className={cn("grid gap-[6px] h-[54px] items-end", bars.length <= 3 ? "grid-cols-3" : bars.length === 4 ? "grid-cols-4" : "grid-cols-5")}>
                      {bars.map((b) => (
                        <div key={b.label} className="flex flex-col items-center justify-end h-full">
                          <div
                            className="w-full rounded-t-[3px] transition-all duration-500"
                            style={{
                              height: `${Math.max(8, (b.value / maxVal) * 100)}%`,
                              background: `linear-gradient(180deg,${b.color}90,${b.color})`,
                              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className={cn("mt-1.5 grid gap-[6px]", bars.length <= 3 ? "grid-cols-3" : bars.length === 4 ? "grid-cols-4" : "grid-cols-5")}>
                      {bars.map((b) => (
                        <div key={b.label} className="flex flex-col items-center">
                          <span className="text-[10.5px] font-bold text-[#0a1020] tabular-nums leading-none">{b.value}</span>
                          <span className="text-[8.5px] font-semibold text-[#8592a8] tracking-wide uppercase mt-0.5">{b.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </GlassCard>

            {/* Digital Twin — spans 2 rows, now surfaces computed TwinMacroState */}
            <GlassCard
              href={`${base}/whiteboard?drawer=twin&tab=design`}
              locked={entityCount < 3}
              lockMessage="Need 3+ entities to build a model"
              icon={<IconPulse className="h-[17px] w-[17px]" />}
              title="Digital Twin"
              sub={twinMacro ? `${twinMacro.health_label} · ${twinMacro.dynamics.total_loops} loop${twinMacro.dynamics.total_loops === 1 ? "" : "s"}` : "Behavioural simulation"}
              className="row-span-2"
            >
              {entityCount >= 3 && twinMacro && (() => {
                const { health_score, health_label, coverage, risk_exposure, dynamics } = twinMacro;
                const healthColor =
                  health_label === "strong" ? "#059669" :
                  health_label === "developing" ? "#0051ff" :
                  health_label === "fragile" ? "#d97706" :
                  "#dc2626";
                const healthDash = 125.66;
                const healthOffset = healthDash * (1 - health_score / 100);
                const coveragePct = coverage.entities_modeled > 0
                  ? Math.round((1 - coverage.orphan_ratio) * 100)
                  : 0;
                return (
                  <div className="mt-3 flex flex-col gap-3">
                    {/* Health ring — centerpiece */}
                    <div className="flex flex-col items-center gap-2">
                      <div className="relative w-[72px] h-[72px]">
                        <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
                          <circle cx="24" cy="24" r="20" fill="none" stroke="#eef2f8" strokeWidth="4" />
                          <circle
                            cx="24" cy="24" r="20" fill="none"
                            stroke={healthColor} strokeWidth="4" strokeLinecap="round"
                            strokeDasharray={healthDash}
                            strokeDashoffset={healthOffset}
                            style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-[18px] font-bold text-[#0a1020] tabular-nums leading-none">{health_score}</span>
                          <span className="text-[8.5px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: healthColor }}>{health_label}</span>
                        </div>
                      </div>
                      <div className="text-[10px] font-semibold text-[#8592a8] uppercase tracking-wider">Twin Health</div>
                    </div>

                    {/* Key stats */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="rounded-[7px] bg-white/55 border border-white/80 px-2 py-1.5">
                        <div className="text-[8.5px] font-semibold text-[#8592a8] uppercase tracking-wide">Coverage</div>
                        <div className="text-[13px] font-bold text-[#0a1020] tabular-nums mt-0.5">{coveragePct}%</div>
                        <div className="text-[9.5px] text-[#556479] mt-0.5">{coverage.orphan_count} orphan{coverage.orphan_count === 1 ? "" : "s"}</div>
                      </div>
                      <div className="rounded-[7px] bg-white/55 border border-white/80 px-2 py-1.5">
                        <div className="text-[8.5px] font-semibold text-[#8592a8] uppercase tracking-wide">Risk</div>
                        <div className="text-[13px] font-bold text-[#dc2626] tabular-nums mt-0.5">{risk_exposure.critical_risks}</div>
                        <div className="text-[9.5px] text-[#556479] mt-0.5">{risk_exposure.total_risk_points} total pts</div>
                      </div>
                      <div className="rounded-[7px] bg-white/55 border border-white/80 px-2 py-1.5">
                        <div className="text-[8.5px] font-semibold text-[#8592a8] uppercase tracking-wide">Leverage</div>
                        <div className="text-[13px] font-bold text-[#0a1020] tabular-nums mt-0.5">{dynamics.leverage_points}</div>
                        <div className="text-[9.5px] text-[#556479] mt-0.5 truncate" title={dynamics.top_leverage_name ?? ""}>
                          {dynamics.top_leverage_name ? dynamics.top_leverage_name : "—"}
                        </div>
                      </div>
                      <div className="rounded-[7px] bg-white/55 border border-white/80 px-2 py-1.5">
                        <div className="text-[8.5px] font-semibold text-[#8592a8] uppercase tracking-wide">Dynamics</div>
                        <div className="text-[13px] font-bold text-[#0a1020] tabular-nums mt-0.5">{dynamics.total_loops}</div>
                        <div className="text-[9.5px] text-[#556479] mt-0.5">
                          <span className="text-[#059669] font-semibold">{dynamics.reinforcing_positive}+</span>
                          {" / "}
                          <span className="text-[#dc2626] font-semibold">{dynamics.reinforcing_negative}−</span>
                          {" / "}
                          <span className="text-[#0051ff] font-semibold">{dynamics.balancing}B</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottleneck alert */}
                    {risk_exposure.bottleneck_name && (
                      <div className="flex items-center gap-2 rounded-[7px] bg-amber-50/70 border border-amber-200 px-2 py-1.5">
                        <svg viewBox="0 0 12 12" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" className="w-3 h-3 flex-shrink-0">
                          <path d="M6 2v4M6 9v.01" />
                        </svg>
                        <span className="text-[10.5px] leading-tight min-w-0">
                          <span className="font-semibold text-[#92400e]">Bottleneck:</span>{" "}
                          <span className="text-[#1f2937] truncate inline-block align-bottom max-w-[140px]" title={risk_exposure.bottleneck_name}>
                            {risk_exposure.bottleneck_name}
                          </span>{" "}
                          <span className="text-[#92400e] font-semibold tabular-nums">({risk_exposure.bottleneck_system_share}%)</span>
                        </span>
                      </div>
                    )}

                    {/* Approval CTA (only if not yet approved) */}
                    {!ctx.strategyApproved && (
                      <div className="text-[10.5px] text-[#556479] leading-snug text-center pt-1 border-t border-black/[0.05]">
                        Approve <span className="text-[#0051ff] font-semibold">#1 Recommendation</span> to activate the twin
                      </div>
                    )}
                  </div>
                );
              })()}
              {entityCount >= 3 && !twinMacro && (
                <div className="flex flex-col items-center justify-center text-center gap-3 py-6 min-h-[180px]">
                  <div className="gd-twin-pulse">
                    <IconPulse className="w-[26px] h-[26px]" />
                  </div>
                  <p className="text-[12px] text-[#556479] max-w-[240px] leading-snug">
                    Twin state unavailable. Run synthesis to generate.
                  </p>
                </div>
              )}
            </GlassCard>

            {/* Assets & Entities — full layer breakdown (no more silent >2-layer merging) */}
            <GlassCard
              href={`${base}/whiteboard?drawer=inventory&tab=entities`}
              locked={entityCount === 0}
              lockMessage="Add entities first"
              icon={<IconDb className="h-[17px] w-[17px]" />}
              title="Assets & Entities"
              sub={
                entityCount > 0
                  ? layerBreakdown.length > 2
                    ? `${layerBreakdown.length} layers · ${entityCount} total`
                    : `${coreEntities} core · ${externalEntities} external`
                  : undefined
              }
              metric={entityCount > 0 ? entityCount : undefined}
              metricLabel="Entities"
            >
              {entityCount > 0 && (
                <div className="mt-3">
                  {/* Stacked layer bar — one segment per real knowledge_layer */}
                  <div
                    className="flex h-2 rounded overflow-hidden bg-[rgba(10,30,80,0.06)]"
                    style={{ boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)" }}
                  >
                    {layerBreakdown.map(([layer, count], i) => (
                      <div
                        key={layer}
                        title={`${layer}: ${count}`}
                        style={{
                          width: `${(count / entityCount) * 100}%`,
                          background: layerPalette[i % layerPalette.length],
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
                        }}
                      />
                    ))}
                  </div>
                  {/* Per-layer legend (max 4 visible, "+N more" overflow) */}
                  <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[#556479] font-medium">
                    {layerBreakdown.slice(0, 4).map(([layer, count], i) => (
                      <span key={layer} className="inline-flex items-center gap-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: layerPalette[i % layerPalette.length].split(",")[1].replace(")", "") }}
                        />
                        <span className="capitalize">{layer}</span>
                        <strong className="text-[#0a1020] tabular-nums">{count}</strong>
                      </span>
                    ))}
                    {layerBreakdown.length > 4 && (
                      <span className="text-[#8592a8]">+{layerBreakdown.length - 4} more</span>
                    )}
                  </div>
                </div>
              )}
            </GlassCard>

            {/* #1 Recommendation */}
            <GlassCard
              href={`${base}/whiteboard?drawer=strategy&tab=strategy`}
              locked={!hasSynthesis}
              lockMessage="Run synthesis first"
              icon={<IconBolt className="h-[17px] w-[17px]" />}
              title="#1 Recommendation"
              sub={
                strategicRec
                  ? ctx.strategyApproved
                    ? "Approved"
                    : "Improvement proposal"
                  : "Strategy pending"
              }
            >
              {strategicRec ? (
                <RecommendationCardBody
                  strategicRec={strategicRec as Record<string, unknown>}
                  approved={ctx.strategyApproved}
                  rankedCount={
                    Array.isArray((synthData as Record<string, unknown>)?.ranked_strategies)
                      ? (synthData as { ranked_strategies: unknown[] }).ranked_strategies.length
                      : 1
                  }
                />
              ) : (
                <p className="mt-2 text-[12px] text-[#8592a8]">Generate strategy after synthesis</p>
              )}
            </GlassCard>
          </div>

          {/* Row 3: Intelligence Radar (span 2) + Insights */}
          <div className="grid grid-cols-3 gap-2.5">
            <GlassCard
              href={`${base}/whiteboard?drawer=intelligence&tab=radar`}
              locked={!hasSynthesis}
              lockMessage="Run synthesis to unlock"
              icon={<IconRadar className="h-[17px] w-[17px]" />}
              title="Intelligence Radar"
              sub={
                researchProvenance
                  ? `${researchProvenance.research_mode === "web_verified" ? "Web-verified" : researchProvenance.research_mode === "training_only" ? "Training-only" : "External"} · ${researchProvenance.searches_performed ?? 0} searches`
                  : "External landscape · frameworks · signals"
              }
              className="col-span-2"
            >
              {hasSynthesis && (
                <div className="mt-3 space-y-2">
                  {/* Row 1: 4 real metric pills (replaces 3 wrong pills) */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Landscape", count: externalEntities, color: "#1a7aff", hint: "external entities" },
                      { label: "Frameworks", count: frameworkCount, color: "#5856d6", hint: "frameworks + precedents" },
                      { label: "Signals", count: signalCount, color: "#ec4899", hint: "hypotheses + hidden variables" },
                      { label: "Bridges", count: crossContextCount, color: "#059669", hint: "cross-context insights" },
                    ].map((r) => (
                      <div
                        key={r.label}
                        title={r.hint}
                        className="flex flex-col gap-0.5 px-2 py-1.5 rounded-[9px] bg-white/55 border border-white/80"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: r.color, boxShadow: `0 0 4px ${r.color}` }}
                          />
                          <span className="text-[9.5px] font-semibold text-[#556479] uppercase tracking-wide">{r.label}</span>
                        </span>
                        <span className="text-[14px] font-bold text-[#0a1020] tabular-nums leading-none">{r.count}</span>
                      </div>
                    ))}
                  </div>

                  {/* Row 2: Authority distribution (if research happened) */}
                  {researchProvenance?.authority_distribution && (() => {
                    const d = researchProvenance.authority_distribution;
                    const total = d.high + d.moderate + d.low + d.unverified;
                    if (total === 0) return null;
                    return (
                      <div className="flex items-center gap-2">
                        <span className="text-[9.5px] font-semibold text-[#556479] uppercase tracking-wide flex-shrink-0">Authority</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-[rgba(10,30,80,0.06)] flex">
                          <div style={{ flex: d.high, background: "#059669" }} title={`High: ${d.high}`} />
                          <div style={{ flex: d.moderate, background: "#0051ff" }} title={`Moderate: ${d.moderate}`} />
                          <div style={{ flex: d.low, background: "#d97706" }} title={`Low: ${d.low}`} />
                          <div style={{ flex: d.unverified, background: "#9ca3af" }} title={`Unverified: ${d.unverified}`} />
                        </div>
                        <span className="text-[10px] text-[#556479] font-medium tabular-nums flex-shrink-0">
                          <span className="text-[#059669] font-semibold">{d.high}</span>
                          <span className="text-[#cbd5e1] mx-0.5">·</span>
                          <span className="text-[#0051ff] font-semibold">{d.moderate}</span>
                          <span className="text-[#cbd5e1] mx-0.5">·</span>
                          <span className="text-[#d97706] font-semibold">{d.low}</span>
                          {d.unverified > 0 && (
                            <>
                              <span className="text-[#cbd5e1] mx-0.5">·</span>
                              <span className="text-[#9ca3af] font-semibold">{d.unverified}</span>
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Row 3: Top sources (if web research ran) */}
                  {researchProvenance?.top_sources && researchProvenance.top_sources.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9.5px] font-semibold text-[#556479] uppercase tracking-wide">Sources</span>
                      {researchProvenance.top_sources.slice(0, 4).map((s) => (
                        <span
                          key={s.domain}
                          className="inline-flex items-center gap-1 rounded-[5px] border border-black/[0.06] bg-white/60 px-1.5 py-[2px] text-[10px] text-[#374151]"
                        >
                          {s.domain}
                          <span className="text-[#8592a8] tabular-nums">·{s.count}</span>
                        </span>
                      ))}
                      {researchProvenance.top_sources.length > 4 && (
                        <span className="text-[10px] text-[#8592a8]">+{researchProvenance.top_sources.length - 4} more</span>
                      )}
                    </div>
                  )}

                  {/* Fallback: empty state when synthesis done but no research info */}
                  {!researchProvenance && externalEntities === 0 && signalCount === 0 && frameworkCount === 0 && (
                    <p className="text-[11px] text-[#8592a8]">
                      No external research yet. Run research to populate signals, frameworks, and landscape.
                    </p>
                  )}
                </div>
              )}
            </GlassCard>

            <GlassCard
              href={`${base}/whiteboard?drawer=synthesis&tab=insights`}
              locked={!hasSynthesis}
              lockMessage="Run synthesis to unlock"
              icon={<IconBook className="h-[17px] w-[17px]" />}
              title="Insights"
              sub={
                hasSynthesis
                  ? qualityScore !== null
                    ? `Quality ${Math.round(qualityScore)}/100`
                    : `${ctx.novelConnections.length + openQuestionCount + leveragePointCount} signals`
                  : undefined
              }
            >
              {hasSynthesis && (
                <div className="mt-3 space-y-2">
                  {/* 6-stat grid — 3 columns × 2 rows, covers the big insight types */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { v: leveragePointCount, l: "Leverage", color: "#059669" },
                      { v: riskPointCount, l: "Risk", color: "#dc2626" },
                      { v: openQuestionCount, l: "Open Qs", color: "#d97706" },
                      { v: ctx.novelConnections.length, l: "Novel", color: "#0051ff" },
                      { v: ctx.contradictions.length, l: "Conflicts", color: "#ec4899" },
                      { v: ctx.scenarios.length, l: "Scenarios", color: "#5856d6" },
                    ].map((s) => (
                      <div
                        key={s.l}
                        className="text-center py-2 px-1.5 rounded-[8px] bg-white/55 border border-white/80"
                      >
                        <div
                          className="text-[15px] font-extrabold tabular-nums tracking-[-0.02em] leading-none"
                          style={{ color: s.v > 0 ? s.color : "#9ca3af" }}
                        >
                          {s.v}
                        </div>
                        <div className="mt-1 text-[9px] font-bold text-[#556479] tracking-[0.08em] uppercase leading-none">{s.l}</div>
                      </div>
                    ))}
                  </div>

                  {/* Quality score + grounding footer */}
                  {(qualityScore !== null || crossContextCount > 0 || analogyCount > 0) && (
                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-black/[0.06] text-[10px]">
                      {qualityScore !== null && (
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-[#0051ff]">
                            <path d="M6 1l1.5 3.5L11 5 8.5 7.5 9 11 6 9.5 3 11l.5-3.5L1 5l3.5-.5z" />
                          </svg>
                          <span className="text-[#374151]">Quality</span>
                          <span className="text-[#0a1020] tabular-nums">{Math.round(qualityScore)}/100</span>
                        </span>
                      )}
                      {crossContextCount > 0 && (
                        <span className="text-[#374151]">
                          <strong className="text-[#0a1020] tabular-nums">{crossContextCount}</strong> cross-ctx
                        </span>
                      )}
                      {analogyCount > 0 && (
                        <span className="text-[#374151]">
                          <strong className="text-[#0a1020] tabular-nums">{analogyCount}</strong> analog{analogyCount === 1 ? "y" : "ies"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </GlassCard>
          </div>
        </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Glass Card — reusable card matching reference design
// ---------------------------------------------------------------------------

function GlassCard({
  icon,
  title,
  sub,
  metric,
  metricLabel,
  href,
  locked,
  lockMessage,
  className,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  metric?: string | number;
  metricLabel?: string;
  href: string;
  locked?: boolean;
  lockMessage?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="relative z-[1] flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="gd-chip-soft flex-shrink-0">{icon}</div>
          <div className="min-w-0">
            <div className="text-[14.5px] font-bold text-[#0a1020] leading-tight tracking-[-0.015em] truncate">{title}</div>
            {sub && <div className="text-[11.5px] text-[#556479] font-medium mt-0.5 truncate">{sub}</div>}
          </div>
        </div>
        {metric !== undefined && (
          <div className="text-right leading-none flex-shrink-0">
            <div
              className="text-[24px] font-extrabold tabular-nums tracking-[-0.03em]"
              style={{
                background: "linear-gradient(180deg,#0a1020 20%,#0051ff 120%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {metric}
            </div>
            {metricLabel && <div className="mt-1 text-[9.5px] font-bold text-[#556479] tracking-[0.12em] uppercase">{metricLabel}</div>}
          </div>
        )}
      </div>
      {locked && lockMessage ? (
        <div className="relative z-[1] mt-3 text-[11.5px] text-[#8592a8] italic">{lockMessage}</div>
      ) : (
        <div className="relative z-[1]">{children}</div>
      )}
    </>
  );

  const cardClass = cn(
    "gd-card group relative rounded-[20px] px-[22px] py-[20px] flex flex-col overflow-hidden transition-all duration-300",
    locked && "opacity-75",
    className
  );

  if (locked) {
    return <div className={cardClass}>{body}</div>;
  }
  return (
    <Link href={href} className={cardClass}>
      {body}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Glass dashboard styles
// ---------------------------------------------------------------------------

const glassDashStyles = `
  .glass-dash-root {
    background: radial-gradient(1400px 1000px at 50% 40%, #ffffff 0%, #eef2f8 60%, #e4eaf2 100%);
  }

  .glass-dash-inner {
    /* Gradient also on inner so tall content keeps it painted through scroll */
    background: radial-gradient(1400px 1000px at 50% 40%, #ffffff 0%, #eef2f8 60%, #e4eaf2 100%);
  }

  .glass-dash-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
  }

  @keyframes gd-floatA { 0%,100%{transform:translate(0,0)} 50%{transform:translate(50px,40px)} }
  @keyframes gd-floatB { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-40px,30px)} }
  @keyframes gd-floatC { 0%,100%{transform:translate(0,0)} 50%{transform:translate(40px,-40px)} }
  @keyframes gd-floatD { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-40px,-50px)} }
  @keyframes gd-ring {
    0% { transform: scale(0.8); opacity: 0.8; }
    100% { transform: scale(1.8); opacity: 0; }
  }

  /* Spheres — reduced to a soft ambient wash. Only the body gradient remains,
     at low opacity and heavily blurred so they read as diffuse color hints
     rather than discrete objects. */
  .gd-sphere {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    filter: blur(70px) saturate(0.85);
    opacity: 0.22;
    will-change: transform;
  }
  .gd-sphere .body {
    position: absolute; inset: 0; border-radius: 50%;
    background: radial-gradient(circle at 40% 40%, rgba(170,210,255,0.9) 0%, rgba(120,170,240,0.65) 45%, rgba(90,140,220,0.4) 80%, rgba(90,140,220,0) 100%);
  }
  .gd-sphere.s1 { width: 460px; height: 460px; left: -100px; top: 60px; animation: gd-floatA 30s ease-in-out infinite; }
  .gd-sphere.s2 { width: 360px; height: 360px; right: -60px; top: 60px; animation: gd-floatB 34s ease-in-out infinite; }
  .gd-sphere.s3 { width: 520px; height: 520px; left: 42%; top: 30%; animation: gd-floatC 38s ease-in-out infinite; }
  .gd-sphere.s4 { width: 400px; height: 400px; right: -40px; bottom: -60px; animation: gd-floatD 36s ease-in-out infinite; }

  /* Frost layer sits between the spheres and the content.
     Heavy blur + mild white wash mutes the sphere shapes into soft color glows. */
  .gd-frost {
    position: absolute;
    inset: 0;
    backdrop-filter: blur(24px) saturate(1.05);
    -webkit-backdrop-filter: blur(24px) saturate(1.05);
    background: linear-gradient(180deg,
      rgba(255,255,255,0.12) 0%,
      rgba(245,248,253,0.10) 50%,
      rgba(238,242,248,0.16) 100%);
    pointer-events: none;
  }

  .gd-grain {
    position: absolute; inset: 0; pointer-events: none; opacity: 0.03; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  .gd-card {
    background: rgba(255,255,255,0.92);
    backdrop-filter: blur(16px) saturate(140%);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    border: 1px solid rgba(0, 0, 0, 0.06);
    box-shadow:
      0 16px 40px -14px rgba(8,60,180,0.08),
      0 6px 14px -8px rgba(8,60,180,0.04),
      inset 0 1px 0 rgba(255,255,255,1);
  }
  .gd-card::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0) 55%);
    pointer-events: none;
  }
  .gd-card.group:hover {
    transform: translateY(-2px);
    background: rgba(255,255,255,0.96);
    box-shadow:
      0 22px 48px -18px rgba(8,60,180,0.12),
      0 8px 18px -10px rgba(8,60,180,0.06),
      inset 0 1px 0 rgba(255,255,255,1);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .gd-chip-soft {
    width: 36px; height: 36px;
    border-radius: 10px;
    display: grid; place-items: center;
    background: linear-gradient(145deg, rgba(255,255,255,0.92) 0%, rgba(225,238,255,0.72) 50%, rgba(150,190,255,0.58) 100%);
    border: 1px solid rgba(255,255,255,0.85);
    color: #0051ff;
    backdrop-filter: blur(14px) saturate(160%);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.95),
      inset 0 -2px 5px rgba(26,122,255,0.14),
      0 3px 8px rgba(8,60,180,0.1);
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }
  .gd-chip-soft::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 70% 45% at 28% 15%, rgba(255,255,255,0.55), rgba(255,255,255,0) 75%);
    pointer-events: none;
  }
  .gd-chip-soft > svg { position: relative; z-index: 1; }

  .gd-twin-pulse {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, rgba(26,122,255,0.25), rgba(26,122,255,0.05) 65%, rgba(26,122,255,0) 80%);
    display: grid; place-items: center;
    color: #0051ff;
    position: relative;
    flex-shrink: 0;
  }
  .gd-twin-pulse::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(26,122,255,0.3), rgba(26,122,255,0) 70%);
    animation: gd-ring 2.4s ease-out infinite;
  }
  .gd-twin-pulse > svg { position: relative; z-index: 1; }
`;
