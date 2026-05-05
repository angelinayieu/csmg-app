"use client";

// ── Insight Lab · results panel ───────────────────────────────────────
//
// Right pane (380px). Filter tabs by insight kind + ranked list of
// insight cards. Score chip per card. Empty state when idle or no
// insights of the active filter.

import { useState } from "react";
import { Beaker } from "lucide-react";
import { ALGO_CATALOG, KIND_META, scoreColor, type InsightKind } from "./types";
import type { LabRunState, LiveLabInsight } from "./hooks/use-lab-run";

type FilterKey = InsightKind | "all";

const FILTER_TABS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "hub", label: "Hubs" },
  { key: "bridge", label: "Bridges" },
  { key: "cycle", label: "Cycles" },
  { key: "cluster", label: "Clusters" },
];

export function ResultsPanel({
  runState,
  insights,
  counts,
  filter,
  onFilterChange,
  stackAvg,
}: {
  runState: LabRunState;
  insights: LiveLabInsight[];
  counts: Record<FilterKey, number>;
  filter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  stackAvg: number | null;
}) {
  const isStreaming = runState === "streaming" || runState === "submitting";
  const isComplete = runState === "complete";

  return (
    <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-slate-200/80 bg-white/40">
      <div className="border-b border-slate-200/60 px-4 py-3">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Results
        </div>
        <div className="mt-1 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-slate-900">
            {isComplete
              ? `${counts.all} insight${counts.all === 1 ? "" : "s"}`
              : isStreaming
                ? counts.all > 0
                  ? `${counts.all} streaming…`
                  : "Streaming…"
                : "Run a stack to see insights"}
          </div>
          {(isComplete || (isStreaming && stackAvg !== null)) &&
            stackAvg !== null && (
              <ScoreChip label="Goal match" value={stackAvg} />
            )}
        </div>
      </div>

      {(isComplete || isStreaming) && counts.all > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200/60 px-2 py-2">
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onFilterChange(key)}
              className={`shrink-0 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors ${
                filter === key
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
              <span className="ml-1 tabular-nums opacity-70">
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="p-3">
        {runState === "idle" && <ResultsIdle />}
        {(isStreaming && counts.all === 0) && <ResultsStreaming />}
        {(isComplete || (isStreaming && counts.all > 0)) && (
          <div className="space-y-2">
            {insights.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white/40 p-4 text-center text-[11px] text-slate-500">
                No insights of this kind.
              </div>
            ) : (
              insights.map((i) => <InsightCard key={i.insightKey} insight={i} />)
            )}
          </div>
        )}
        {runState === "error" && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-[11px] text-rose-700">
            Run failed before producing results. See the error above the Run
            button.
          </div>
        )}
      </div>
    </aside>
  );
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white">
      <span className="opacity-70">{label}</span>
      <span className="tabular-nums">{value.toFixed(2)}</span>
    </div>
  );
}

function ResultsIdle() {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/40 p-6 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400">
        <Beaker className="h-4 w-4" />
      </div>
      <div className="mt-3 text-[12px] font-semibold text-slate-700">
        Nothing to show yet
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Compose a stack on the left and hit Run.
      </div>
    </div>
  );
}

function ResultsStreaming() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-3"
          style={{ animationDelay: `${i * 0.1}s` }}
        >
          <div className="h-2.5 w-3/4 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-2 w-1/2 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function InsightCard({ insight }: { insight: LiveLabInsight }) {
  const [expanded, setExpanded] = useState(false);
  const meta = KIND_META[insight.kind];
  const Icon = meta.icon;
  const algoEntry = ALGO_CATALOG.find((a) => a.id === insight.algoId);
  return (
    <button
      onClick={() => setExpanded((e) => !e)}
      className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1 ${meta.ring} ${meta.chip}`}
        >
          <Icon className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider ${meta.chip}`}
                >
                  {meta.label}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-[12.5px] font-semibold text-slate-900">
                {insight.summary}
              </div>
            </div>
            <div className="shrink-0">
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1 rounded-full bg-slate-50 px-1.5 py-0.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${scoreColor(insight.goalMatch)}`}
                  />
                  <span className="text-[10px] font-bold tabular-nums text-slate-700">
                    {insight.goalMatch !== null
                      ? insight.goalMatch.toFixed(2)
                      : "—"}
                  </span>
                </div>
                <div className="mt-0.5 text-[8.5px] uppercase tracking-wider text-slate-400">
                  goal match
                </div>
              </div>
            </div>
          </div>
          {expanded && (
            <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[10px]">
              <div className="font-semibold uppercase tracking-wider text-slate-400">
                Provenance
              </div>
              <div className="mt-0.5 text-slate-600">
                Step {insight.stepIdx + 1} ·{" "}
                {algoEntry?.name ?? insight.algoId}
              </div>
              {insight.entityIds.length > 0 && (
                <div className="mt-1 text-slate-500">
                  {insight.entityIds.length} entit
                  {insight.entityIds.length === 1 ? "y" : "ies"} referenced
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
