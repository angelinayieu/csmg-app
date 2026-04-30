"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Filter, Zap } from "lucide-react";
import type { AnalysisRun, AnalysisRunPipeline } from "@/types/analysis-runs";
import { humanAge } from "@/lib/pipeline/cache";

// ── Apple-Vision-Pro-style analysis trail ──
// Replaces the one-line provenance chip with a collapsible browsable log.
// Design principles applied:
//  • Glass-morphism surface — subtle backdrop blur, soft shadow, no harsh borders
//  • Typographic hierarchy over color — weight + size drive attention, color accents sparingly
//  • 8-px rhythm — spacing snaps to multiples of 4/8 for visual calm
//  • One accent color (indigo) carries the "system intelligence" semantic
//  • Pressable affordances only where pressable — filter pills / expand chevrons
//  • Motion: 180ms transforms on chevrons; no decorative motion

const PIPELINE_META: Record<AnalysisRunPipeline, { label: string; accent: string }> = {
  decompose: { label: "Decompose", accent: "bg-blue-50 text-blue-700" },
  decompose_hierarchical: { label: "Hierarchical decompose", accent: "bg-blue-50 text-blue-700" },
  research: { label: "Research", accent: "bg-emerald-50 text-emerald-700" },
  research_deep: { label: "Deep research", accent: "bg-emerald-50 text-emerald-700" },
  synthesize: { label: "Synthesize", accent: "bg-indigo-50 text-indigo-700" },
  synthesize_layered: { label: "Layered synthesize", accent: "bg-indigo-50 text-indigo-700" },
  strategy_refresh: { label: "Strategy", accent: "bg-purple-50 text-purple-700" },
  generate_apps: { label: "Apps", accent: "bg-purple-50 text-purple-700" },
  expand: { label: "Expand", accent: "bg-sky-50 text-sky-700" },
  quick_decompose: { label: "Quick decompose", accent: "bg-blue-50 text-blue-600" },
  reevaluate: { label: "Reevaluate", accent: "bg-amber-50 text-amber-700" },
  chat_incremental: { label: "Chat update", accent: "bg-teal-50 text-teal-700" },
  interweave: { label: "Interweave", accent: "bg-fuchsia-50 text-fuchsia-700" },
};

const STATUS_META: Record<AnalysisRun["status"], { label: string; cls: string }> = {
  completed: { label: "completed", cls: "bg-green-100 text-green-700" },
  running: { label: "running", cls: "bg-blue-100 text-blue-700" },
  failed: { label: "failed", cls: "bg-red-100 text-red-700" },
  skipped_cache: { label: "cache hit", cls: "bg-gray-100 text-gray-600" },
};

type ImpactFilter = "all" | "impactful" | "cache_only";

function isImpactful(run: AnalysisRun): boolean {
  if (run.status === "skipped_cache") return false;
  if (run.pipeline === "decompose" || run.pipeline === "decompose_hierarchical") return true;
  if (run.pipeline === "synthesize" || run.pipeline === "synthesize_layered") return true;
  if (run.pipeline === "research" || run.pipeline === "research_deep") return true;
  if (run.pipeline === "expand") return true;
  if (run.pipeline === "strategy_refresh") return true;
  if (run.pipeline === "reevaluate") return (run.stages_run?.length ?? 0) > 2;
  return (run.stages_run?.length ?? 0) >= 2;
}

export function AnalysisTrailPanel({
  runs,
}: {
  runs: AnalysisRun[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState<AnalysisRunPipeline | "all">("all");
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>("all");

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (pipelineFilter !== "all" && r.pipeline !== pipelineFilter) return false;
      if (impactFilter === "impactful" && !isImpactful(r)) return false;
      if (impactFilter === "cache_only" && r.status !== "skipped_cache") return false;
      return true;
    });
  }, [runs, pipelineFilter, impactFilter]);

  // Hooks must run before any conditional return — moved above the
  // empty-runs early return so the hook order stays stable when runs
  // transitions between empty/non-empty.
  const stats = useMemo(() => {
    const totalRuns = runs.length;
    const cacheHits = runs.filter((r) => r.status === "skipped_cache").length;
    const impactfulCount = runs.filter(isImpactful).length;
    return { totalRuns, cacheHits, impactfulCount };
  }, [runs]);

  // Available pipeline filter options — only show ones present in runs
  const pipelineOptions = useMemo(() => {
    const set = new Set<AnalysisRunPipeline>();
    for (const r of runs) set.add(r.pipeline);
    return Array.from(set);
  }, [runs]);

  if (runs.length === 0) return null;
  const latest = runs[0];

  return (
    <section className={cn(
      // Glass surface: subtle backdrop blur + soft off-white bg + near-invisible border
      "rounded-2xl border border-gray-200/70 bg-white/60 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all",
      expanded && "shadow-[0_4px_24px_rgba(0,0,0,0.06)]",
    )}>
      {/* Collapsed header (always visible) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-white/40 rounded-2xl transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
            Analysis trail
          </span>
          <span className={cn("rounded-full px-2 py-[2px] text-[10px] font-medium", STATUS_META[latest.status].cls)}>
            {STATUS_META[latest.status].label}
          </span>
          <span className={cn("rounded-full px-2 py-[2px] text-[10px] font-medium", PIPELINE_META[latest.pipeline].accent)}>
            {PIPELINE_META[latest.pipeline].label}
          </span>
          <span className="text-[12px] text-gray-600">
            {latest.tier ? latest.tier : latest.depth}
            {" · "}
            {humanAge(latest.completed_at ?? latest.started_at)}
          </span>
          {typeof latest.quality_score === "number" && (
            <span className="text-[11px] tabular-nums text-gray-500">
              q <span className="font-semibold text-gray-700">{latest.quality_score}</span>
            </span>
          )}
          {typeof latest.coverage_pct === "number" && (
            <span className="text-[11px] tabular-nums text-gray-500">
              cov <span className="font-semibold text-gray-700">{latest.coverage_pct}%</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-400 tabular-nums">
            {stats.totalRuns} run{stats.totalRuns === 1 ? "" : "s"}
            {stats.cacheHits > 0 && (
              <span className="ml-1.5 text-gray-400">· {stats.cacheHits} cached</span>
            )}
          </span>
          <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform duration-200", expanded && "rotate-180")} />
        </div>
      </button>

      {/* Expanded: filter bar + run list */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3 w-3 text-gray-400" />

            {/* Impact filter */}
            <div className="flex rounded-full bg-gray-100 p-[2px]">
              {(["all", "impactful", "cache_only"] as ImpactFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setImpactFilter(f)}
                  className={cn(
                    "rounded-full px-2.5 py-[3px] text-[10px] font-medium transition-colors",
                    impactFilter === f
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700",
                  )}
                >
                  {f === "all" ? "All runs" : f === "impactful" ? "Impactful only" : "Cache hits only"}
                </button>
              ))}
            </div>

            {/* Pipeline filter (pill scroller) */}
            {pipelineOptions.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto max-w-full">
                <button
                  type="button"
                  onClick={() => setPipelineFilter("all")}
                  className={cn(
                    "rounded-full px-2 py-[3px] text-[10px] font-medium whitespace-nowrap transition-colors",
                    pipelineFilter === "all"
                      ? "bg-gray-900 text-white"
                      : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300",
                  )}
                >
                  Any pipeline
                </button>
                {pipelineOptions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPipelineFilter(p)}
                    className={cn(
                      "rounded-full px-2 py-[3px] text-[10px] font-medium whitespace-nowrap transition-colors",
                      pipelineFilter === p
                        ? "bg-gray-900 text-white"
                        : cn("border border-gray-200 hover:border-gray-300", PIPELINE_META[p].accent),
                    )}
                  >
                    {PIPELINE_META[p].label}
                  </button>
                ))}
              </div>
            )}

            <span className="ml-auto text-[10px] text-gray-400 tabular-nums">
              {filtered.length} of {stats.totalRuns}
            </span>
          </div>

          {/* Run list */}
          <div className="space-y-1">
            {filtered.length === 0 && (
              <div className="text-[11px] text-gray-400 italic py-3 text-center">
                No runs match the current filters.
              </div>
            )}
            {filtered.map((run) => {
              const rowExpanded = expandedRunId === run.run_id;
              const pipelineCfg = PIPELINE_META[run.pipeline];
              const statusCfg = STATUS_META[run.status];
              const isCache = run.status === "skipped_cache";
              return (
                <div
                  key={run.run_id}
                  className={cn(
                    "rounded-xl border transition-all",
                    rowExpanded
                      ? "border-gray-200 bg-gray-50/60"
                      : "border-transparent hover:border-gray-150 hover:bg-gray-50/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedRunId(rowExpanded ? null : run.run_id)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left"
                  >
                    <ChevronRight className={cn(
                      "h-3 w-3 shrink-0 text-gray-400 transition-transform duration-200",
                      rowExpanded && "rotate-90",
                    )} />
                    <span className={cn("rounded-full px-2 py-[2px] text-[9px] font-medium shrink-0", pipelineCfg.accent)}>
                      {pipelineCfg.label}
                    </span>
                    <span className={cn("rounded-full px-1.5 py-[1px] text-[9px] font-medium shrink-0", statusCfg.cls)}>
                      {statusCfg.label}
                    </span>
                    {isImpactful(run) && !isCache && (
                      <Zap className="h-3 w-3 text-amber-500 shrink-0" aria-label="Impactful run" />
                    )}
                    <span className="text-[11px] text-gray-600 tabular-nums shrink-0">
                      {humanAge(run.completed_at ?? run.started_at)}
                    </span>
                    {run.note && (
                      <span className="text-[11px] text-gray-500 truncate italic">
                        {run.note}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2 shrink-0">
                      {typeof run.quality_score === "number" && (
                        <span className="text-[10px] tabular-nums text-gray-500">
                          q {run.quality_score}
                        </span>
                      )}
                      {typeof run.coverage_pct === "number" && (
                        <span className="text-[10px] tabular-nums text-gray-500">
                          cov {run.coverage_pct}%
                        </span>
                      )}
                      {run.fingerprint && (
                        <span className="font-mono text-[9px] text-gray-400">
                          {run.fingerprint.slice(0, 6)}
                        </span>
                      )}
                    </span>
                  </button>
                  {rowExpanded && (
                    <div className="px-3 pb-3 pt-0 ml-6 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                      {run.stages_run && run.stages_run.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                            Stages run
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {run.stages_run.map((s) => (
                              <span key={s} className="rounded bg-white border border-gray-200 px-1.5 py-[1px] text-[10px] text-gray-700">
                                {s.replace(/_/g, " ")}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {run.stages_skipped && run.stages_skipped.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                            Stages skipped
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {run.stages_skipped.map((s) => (
                              <span key={s} className="rounded bg-gray-100 px-1.5 py-[1px] text-[10px] text-gray-500 line-through">
                                {s.replace(/_/g, " ")}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {run.cache_hits && run.cache_hits.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                            Cache hits / preservation
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {run.cache_hits.map((s, i) => (
                              <span key={`${s}-${i}`} className="rounded bg-green-50 border border-green-200 px-1.5 py-[1px] text-[10px] text-green-700">
                                {s.replace(/_/g, " ")}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {run.error && (
                        <div className="col-span-2">
                          <div className="text-[9px] font-semibold uppercase tracking-wider text-red-500 mb-1">
                            Error
                          </div>
                          <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-700">
                            {run.error}
                          </div>
                        </div>
                      )}
                      <div className="col-span-2 flex gap-4 text-[10px] text-gray-500 pt-1 border-t border-gray-100">
                        <span>
                          <span className="text-gray-400">id </span>
                          <span className="font-mono">{run.run_id.slice(0, 16)}</span>
                        </span>
                        {run.started_at && (
                          <span>
                            <span className="text-gray-400">started </span>
                            {new Date(run.started_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
