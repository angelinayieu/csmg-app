"use client";

// ── StepMetrics (Arc 5C.2 / P0.2) ──────────────────────────────────────
//
// Step 1 of the intake review. Shows the 10-25 metric trackers that will
// be created when the user confirms the strategy, with per-row:
//   • Toggle off (defer — won't be created)
//   • Target override (inline editable)
//   • Cadence + source kind readouts (read-only — derived from strategy)
//
// Data: we preview-compute the tracker roster from the in-memory strategy
// recommendation rather than querying /api/metric-trackers (those rows
// don't exist yet — we're PRE-confirm). The logic mirrors
// buildTrackerRowsFromStrategy in src/lib/strategy/build-tracker-rows.ts
// but only the user-facing subset.

import { useMemo } from "react";
import { Gauge, CircleDot, TrendingUp, Activity, Flag, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { StrategicRecommendation } from "@/types/strategy";
import type { IntakeReviewState } from "./types";

interface TrackerPreview {
  source_key: string;
  source_kind:
    | "target_objective"
    | "perspective_key_metric"
    | "micro_tactic_metric"
    | "leading_indicator"
    | "lagging_indicator";
  label: string;
  target_value: string;
  unit?: string;
  cadence: string;
}

interface Props {
  recommendation: StrategicRecommendation;
  state: IntakeReviewState;
  onChange: (next: IntakeReviewState) => void;
}

const SOURCE_META: Record<
  TrackerPreview["source_kind"],
  { label: string; icon: typeof Gauge; tint: string }
> = {
  target_objective: {
    label: "Objective",
    icon: Flag,
    tint: "text-indigo-600 bg-indigo-50 ring-indigo-200",
  },
  perspective_key_metric: {
    label: "Perspective",
    icon: Gauge,
    tint: "text-cyan-600 bg-cyan-50 ring-cyan-200",
  },
  micro_tactic_metric: {
    label: "Tactic",
    icon: CircleDot,
    tint: "text-emerald-600 bg-emerald-50 ring-emerald-200",
  },
  leading_indicator: {
    label: "Leading",
    icon: TrendingUp,
    tint: "text-amber-600 bg-amber-50 ring-amber-200",
  },
  lagging_indicator: {
    label: "Lagging",
    icon: Activity,
    tint: "text-rose-600 bg-rose-50 ring-rose-200",
  },
};

// Narrow helpers so TypeScript can infer the arrays without any-casts.
interface RecPerspective {
  id?: string;
  name?: string;
  key_metric?: { name?: string; target?: string; unit?: string; cadence?: string };
}
interface RecTactic {
  id: string;
  title: string;
  metric?: { name?: string; target?: string; unit?: string };
  timeframe?: string;
}

export function StepMetrics({ recommendation, state, onChange }: Props) {
  const reducedMotion = useReducedMotion();

  // Compute the tracker roster from the recommendation. Follows the same
  // ordering convention the server builder uses so the user's preview
  // matches what actually gets materialized.
  const previews = useMemo<TrackerPreview[]>(() => {
    const rows: TrackerPreview[] = [];

    // Objective tracker
    const rec = recommendation as unknown as {
      target_objective?: { name?: string; target?: string; unit?: string };
      perspectives?: RecPerspective[];
      micro_tactics?: RecTactic[];
      learning_loop?: {
        leading_indicators?: Array<{ name?: string; target?: string; cadence?: string; unit?: string }>;
        lagging_indicator?: { name?: string; target?: string; cadence?: string; unit?: string };
      };
    };

    if (rec.target_objective?.name) {
      rows.push({
        source_key: `objective:${slug(rec.target_objective.name)}`,
        source_kind: "target_objective",
        label: rec.target_objective.name,
        target_value: rec.target_objective.target ?? "TBD",
        unit: rec.target_objective.unit,
        cadence: "monthly",
      });
    }

    // Perspectives' key metrics
    for (const p of rec.perspectives ?? []) {
      if (!p.key_metric?.name) continue;
      rows.push({
        source_key: `perspective:${p.id ?? slug(p.name ?? p.key_metric.name)}`,
        source_kind: "perspective_key_metric",
        label: `${p.name ?? "Perspective"}: ${p.key_metric.name}`,
        target_value: p.key_metric.target ?? "TBD",
        unit: p.key_metric.unit,
        cadence: p.key_metric.cadence ?? "weekly",
      });
    }

    // Tactic metrics
    for (const t of rec.micro_tactics ?? []) {
      if (!t.metric?.name) continue;
      rows.push({
        source_key: `tactic:${t.id}`,
        source_kind: "micro_tactic_metric",
        label: `${t.title}: ${t.metric.name}`,
        target_value: t.metric.target ?? "TBD",
        unit: t.metric.unit,
        cadence: "weekly",
      });
    }

    // Learning loop
    const loop = rec.learning_loop;
    if (loop?.lagging_indicator?.name) {
      rows.push({
        source_key: `lagging:${slug(loop.lagging_indicator.name)}`,
        source_kind: "lagging_indicator",
        label: loop.lagging_indicator.name,
        target_value: loop.lagging_indicator.target ?? "TBD",
        unit: loop.lagging_indicator.unit,
        cadence: loop.lagging_indicator.cadence ?? "monthly",
      });
    }
    for (const li of loop?.leading_indicators ?? []) {
      if (!li?.name) continue;
      rows.push({
        source_key: `leading:${slug(li.name)}`,
        source_kind: "leading_indicator",
        label: li.name,
        target_value: li.target ?? "TBD",
        unit: li.unit,
        cadence: li.cadence ?? "weekly",
      });
    }

    return rows;
  }, [recommendation]);

  // Grouped for rendering
  const groups = useMemo(() => {
    const order: TrackerPreview["source_kind"][] = [
      "target_objective",
      "lagging_indicator",
      "perspective_key_metric",
      "leading_indicator",
      "micro_tactic_metric",
    ];
    const byKind = new Map<string, TrackerPreview[]>();
    for (const r of previews) {
      if (!byKind.has(r.source_kind)) byKind.set(r.source_kind, []);
      byKind.get(r.source_kind)!.push(r);
    }
    return order
      .map((k) => ({ kind: k, items: byKind.get(k) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [previews]);

  const toggleDefer = (source_key: string) => {
    const next = new Set(state.deferredTrackerKeys);
    if (next.has(source_key)) next.delete(source_key);
    else next.add(source_key);
    onChange({ ...state, deferredTrackerKeys: next });
  };

  const setTargetOverride = (source_key: string, value: string) => {
    const next = new Map(state.trackerTargetOverrides);
    if (value.trim().length === 0) next.delete(source_key);
    else next.set(source_key, value);
    onChange({ ...state, trackerTargetOverrides: next });
  };

  const activeCount = previews.length - state.deferredTrackerKeys.size;

  return (
    <div className="space-y-4">
      {/* Summary chip */}
      <div className="flex items-center gap-2 text-[11.5px] text-slate-500">
        <Target className="h-3.5 w-3.5 text-emerald-600" />
        <span>
          <span className="font-semibold tabular-nums text-slate-900">{activeCount}</span>{" "}
          of <span className="tabular-nums">{previews.length}</span> metrics will be tracked.
          Tap any row to defer.
        </span>
      </div>

      {/* Grouped trackers */}
      <div className="space-y-4">
        {groups.map((g) => {
          const meta = SOURCE_META[g.kind];
          const Icon = meta.icon;
          return (
            <section key={g.kind}>
              <div className="mb-2 flex items-center gap-1.5">
                <Icon className={cn("h-3 w-3", meta.tint.split(" ")[0])} />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {meta.label}
                </span>
                <span className="text-[9.5px] tabular-nums text-slate-400">
                  {g.items.length}
                </span>
              </div>
              <ul className="space-y-1.5">
                {g.items.map((t) => {
                  const deferred = state.deferredTrackerKeys.has(t.source_key);
                  const overrideValue = state.trackerTargetOverrides.get(t.source_key);
                  return (
                    <li
                      key={t.source_key}
                      className={cn(
                        "rounded-xl bg-white ring-1 px-3 py-2.5",
                        !reducedMotion && "transition-[opacity,background] duration-150",
                        deferred
                          ? "opacity-50 bg-slate-50 ring-slate-200"
                          : "ring-slate-200/70 hover:shadow-[0_1px_4px_rgba(15,23,42,0.05)]",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-semibold text-slate-900">
                            {t.label}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-500 tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <span className="text-slate-400">target</span>
                              <input
                                type="text"
                                defaultValue={overrideValue ?? t.target_value}
                                onBlur={(e) =>
                                  setTargetOverride(t.source_key, e.target.value)
                                }
                                aria-label={`Target value for ${t.label}`}
                                className="w-16 rounded bg-transparent px-1 py-0 text-[10.5px] font-semibold text-slate-700 ring-1 ring-transparent hover:ring-slate-200 focus:bg-white focus:ring-indigo-300 focus:outline-none"
                                disabled={deferred}
                              />
                            </span>
                            {t.unit && <span className="text-slate-400">{t.unit}</span>}
                            <span className="text-slate-300">·</span>
                            <span>{t.cadence}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleDefer(t.source_key)}
                          aria-pressed={!deferred}
                          aria-label={
                            deferred ? `Re-enable ${t.label}` : `Defer ${t.label}`
                          }
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold flex-shrink-0",
                            !reducedMotion && "transition-colors duration-150",
                            deferred
                              ? "bg-slate-200 text-slate-600 hover:bg-slate-300"
                              : "bg-emerald-500 text-white hover:bg-emerald-600",
                          )}
                        >
                          {deferred ? "Deferred" : "Active"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {previews.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <Gauge className="h-7 w-7 text-slate-300" aria-hidden />
          <p className="text-[12.5px] text-slate-500">
            No metrics specified in this strategy yet.
          </p>
        </div>
      )}
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
