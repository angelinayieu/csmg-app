"use client";

// ── TrackingPulseModule (Arc 5.5 Phase A) ──────────────────────────────
//
// The metric-tracker visibility fix. Before this module, trackers were
// seeded at strategy-confirm time but never surfaced on the main
// dashboard — the user had to navigate to /strategy to find them.
//
// This module renders:
//   • Top row: N trackers active · N recorded this week · aggregate
//     "tracking health" readout (all green / mixed / red)
//   • Each tracker as a compact row: label + cadence chip + current
//     value + target bar + "Record" CTA
//   • Empty state when no strategy has been confirmed yet
//
// Design: Apple Vision Pro clean white — glass card, restrained accent,
// tabular-nums for all numbers, reduced-motion respected.
//
// Grouping: trackers are grouped by source_kind (objective /
// perspective / tactic / leading / lagging) so the hierarchy is visible
// at a glance. User can expand a section to see all trackers under it.

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Target,
  TrendingUp,
  Gauge,
  CircleDot,
  Flag,
  PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

// ── Types ──────────────────────────────────────────────────────────────

type SourceKind =
  | "goal"
  | "target_objective"
  | "perspective_key_metric"
  | "micro_tactic_metric"
  | "leading_indicator"
  | "lagging_indicator";

interface Observation {
  tracker_id: string;
  recorded_at: string;
  value: number | null;
  value_text: string | null;
  note: string | null;
  source: string | null;
}

interface Tracker {
  id: string;
  space_id: string;
  source_kind: SourceKind;
  source_key: string;
  label: string;
  measurement_method: string | null;
  unit: string | null;
  cadence: "daily" | "weekly" | "biweekly" | "monthly" | "adhoc";
  baseline_value: number | null;
  current_value: number | null;
  target_value: number | null;
  baseline_text: string | null;
  current_text: string | null;
  target_text: string | null;
  green_reading: string | null;
  yellow_reading: string | null;
  red_reading: string | null;
  status: "active" | "superseded" | "archived";
  latest_observation: Observation | null;
}

interface Props {
  spaceId: string;
  /** Controls whether the module shows at all. If strategy isn't confirmed
   *  yet, the caller can hide it (zero trackers anyway). */
  visible?: boolean;
  /** Called when the user clicks "Record" on a tracker. Parent should
   *  open the progress-recording modal (already exists on dashboard) or
   *  navigate to /strategy#trackers. */
  onRecord?: (trackerId: string) => void;
  className?: string;
}

const SOURCE_META: Record<
  SourceKind,
  { label: string; icon: typeof Activity; tint: string }
> = {
  goal: { label: "Goal", icon: Flag, tint: "text-indigo-600" },
  target_objective: { label: "Objective", icon: Target, tint: "text-indigo-600" },
  perspective_key_metric: {
    label: "Perspective",
    icon: Gauge,
    tint: "text-cyan-600",
  },
  micro_tactic_metric: {
    label: "Tactic",
    icon: CircleDot,
    tint: "text-emerald-600",
  },
  leading_indicator: {
    label: "Leading",
    icon: TrendingUp,
    tint: "text-amber-600",
  },
  lagging_indicator: {
    label: "Lagging",
    icon: Activity,
    tint: "text-rose-600",
  },
};

const SOURCE_ORDER: SourceKind[] = [
  "target_objective",
  "goal",
  "perspective_key_metric",
  "lagging_indicator",
  "leading_indicator",
  "micro_tactic_metric",
];

const CADENCE_LABEL: Record<Tracker["cadence"], string> = {
  daily: "daily",
  weekly: "weekly",
  biweekly: "biweekly",
  monthly: "monthly",
  adhoc: "ad-hoc",
};

// ── Compute helpers ────────────────────────────────────────────────────

/** Progress toward target (0-100, capped). Returns null when values are
 *  missing or non-numeric — the row renders just the text in that case. */
function computeProgress(t: Tracker): number | null {
  const baseline = t.baseline_value;
  const current = t.latest_observation?.value ?? t.current_value;
  const target = t.target_value;
  if (baseline === null || current === null || target === null) return null;
  if (target === baseline) return null;
  const span = target - baseline;
  const travelled = current - baseline;
  const pct = (travelled / span) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Health tier from progress + how fresh the last observation is. */
function healthTier(t: Tracker): "on_track" | "drifting" | "off_track" | "unknown" {
  const progress = computeProgress(t);
  if (progress === null) return "unknown";
  if (progress >= 60) return "on_track";
  if (progress >= 25) return "drifting";
  return "off_track";
}

const HEALTH_META: Record<
  ReturnType<typeof healthTier>,
  { bar: string; chip: string; label: string }
> = {
  on_track: {
    bar: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    label: "on track",
  },
  drifting: {
    bar: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 ring-amber-200",
    label: "drifting",
  },
  off_track: {
    bar: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700 ring-rose-200",
    label: "off track",
  },
  unknown: {
    bar: "bg-slate-300",
    chip: "bg-slate-50 text-slate-500 ring-slate-200",
    label: "no signal",
  },
};

function formatAge(iso: string | null): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "never";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  const d = Math.floor(secs / 86400);
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Component ──────────────────────────────────────────────────────────

export function TrackingPulseModule({
  spaceId,
  visible = true,
  onRecord,
  className,
}: Props) {
  const reducedMotion = useReducedMotion();
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKinds, setExpandedKinds] = useState<Set<SourceKind>>(
    () => new Set(["target_objective", "lagging_indicator"]),
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/spaces/${spaceId}/metric-trackers`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { trackers: Tracker[] };
        if (!cancelled) setTrackers(data.trackers ?? []);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message ?? "Failed to load trackers");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    // Refetch on window-focus so the dashboard reflects fresh observations
    const onFocus = () => {
      if (!cancelled) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [spaceId, visible]);

  const groups = useMemo(() => {
    const map = new Map<SourceKind, Tracker[]>();
    for (const t of trackers) {
      const k = t.source_kind;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    return SOURCE_ORDER.map((k) => ({ kind: k, items: map.get(k) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [trackers]);

  // Aggregate health — counts by tier.
  const summary = useMemo(() => {
    const tiers = { on_track: 0, drifting: 0, off_track: 0, unknown: 0 };
    for (const t of trackers) tiers[healthTier(t)]++;
    const recordedThisWeek = trackers.filter((t) => {
      const iso = t.latest_observation?.recorded_at;
      if (!iso) return false;
      return Date.parse(iso) > Date.now() - 7 * 24 * 60 * 60 * 1000;
    }).length;
    return { ...tiers, total: trackers.length, recordedThisWeek };
  }, [trackers]);

  if (!visible) return null;
  if (!loading && trackers.length === 0 && !error) return null;

  return (
    <section
      className={cn(
        "rounded-2xl bg-white/85 backdrop-blur-xl ring-1 ring-slate-200/70",
        "shadow-[0_1px_3px_rgba(15,23,42,0.04)]",
        className,
      )}
      aria-label="Tracking pulse"
    >
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-100/70">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-200 text-emerald-600">
          <Activity className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Tracking pulse
          </div>
          <div className="text-[13px] font-semibold text-slate-900">
            {loading ? (
              "Loading trackers…"
            ) : trackers.length === 0 ? (
              "No active trackers"
            ) : (
              <>
                <span className="tabular-nums">{summary.total}</span> metrics tracked
                <span className="text-slate-400 font-medium">
                  {" · "}
                  <span className="tabular-nums">{summary.recordedThisWeek}</span> logged this week
                </span>
              </>
            )}
          </div>
        </div>
        {!loading && trackers.length > 0 && (
          <HealthDial
            onTrack={summary.on_track}
            drifting={summary.drifting}
            offTrack={summary.off_track}
            total={summary.total}
          />
        )}
      </header>

      {/* Body */}
      {error && (
        <div className="px-4 py-3 text-[11.5px] text-rose-600">{error}</div>
      )}
      {!error && loading && <TrackerSkeletons reducedMotion={reducedMotion} />}
      {!error && !loading && trackers.length > 0 && (
        <ul className="divide-y divide-slate-100/70">
          {groups.map((g) => {
            const meta = SOURCE_META[g.kind];
            const Icon = meta.icon;
            const isExpanded = expandedKinds.has(g.kind);
            return (
              <li key={g.kind}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedKinds((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.kind)) next.delete(g.kind);
                      else next.add(g.kind);
                      return next;
                    })
                  }
                  aria-expanded={isExpanded}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-2 text-left",
                    "hover:bg-slate-50/70",
                    !reducedMotion && "transition-colors duration-150",
                  )}
                >
                  <Icon className={cn("h-3 w-3", meta.tint)} />
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-600">
                    {meta.label}
                  </span>
                  <span className="tabular-nums text-[10px] text-slate-400">
                    {g.items.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      "ml-auto h-3 w-3 text-slate-400",
                      !reducedMotion && "transition-transform duration-200",
                      isExpanded && "rotate-180",
                    )}
                  />
                </button>
                {isExpanded && (
                  <ul className="space-y-1 px-4 pb-3">
                    {g.items.map((t) => (
                      <TrackerRow
                        key={t.id}
                        tracker={t}
                        reducedMotion={reducedMotion}
                        onRecord={onRecord}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function TrackerRow({
  tracker,
  reducedMotion,
  onRecord,
}: {
  tracker: Tracker;
  reducedMotion: boolean;
  onRecord?: (trackerId: string) => void;
}) {
  const progress = computeProgress(tracker);
  const tier = healthTier(tracker);
  const health = HEALTH_META[tier];
  const observationAge = formatAge(tracker.latest_observation?.recorded_at ?? null);
  const currentDisplay =
    tracker.latest_observation?.value_text ??
    (tracker.latest_observation?.value !== null && tracker.latest_observation?.value !== undefined
      ? String(tracker.latest_observation.value)
      : tracker.current_text ?? (tracker.current_value !== null ? String(tracker.current_value) : "—"));
  const targetDisplay =
    tracker.target_text ??
    (tracker.target_value !== null ? String(tracker.target_value) : null);

  return (
    <li
      className={cn(
        "group rounded-xl bg-white ring-1 ring-slate-200/60 px-3 py-2",
        !reducedMotion && "transition-shadow duration-150",
        "hover:shadow-[0_1px_4px_rgba(15,23,42,0.05)]",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-semibold text-slate-900">
              {tracker.label}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold",
                health.chip,
              )}
              title={`Last logged ${observationAge}`}
            >
              {health.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-500 tabular-nums">
            <span className="font-semibold text-slate-700">{currentDisplay}</span>
            {targetDisplay && (
              <>
                <span className="text-slate-300">→</span>
                <span>{targetDisplay}</span>
              </>
            )}
            {tracker.unit && <span className="text-slate-400">{tracker.unit}</span>}
            <span className="text-slate-300">·</span>
            <span>{CADENCE_LABEL[tracker.cadence]}</span>
            <span className="text-slate-300">·</span>
            <span title={tracker.latest_observation?.recorded_at ?? undefined}>
              {observationAge}
            </span>
          </div>
        </div>
        {onRecord && (
          <button
            type="button"
            onClick={() => onRecord(tracker.id)}
            aria-label={`Record progress for ${tracker.label}`}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full",
              "text-slate-400 hover:bg-emerald-50 hover:text-emerald-600",
              !reducedMotion && "transition-colors duration-150",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
            title="Record progress"
          >
            <PlusCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {progress !== null && (
        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              "h-full rounded-full",
              health.bar,
              !reducedMotion && "transition-[width] duration-500 ease-out",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </li>
  );
}

function HealthDial({
  onTrack,
  drifting,
  offTrack,
  total,
}: {
  onTrack: number;
  drifting: number;
  offTrack: number;
  total: number;
}) {
  if (total === 0) return null;
  const pct = (count: number) => (count / total) * 100;
  return (
    <div
      className="flex h-2 w-32 overflow-hidden rounded-full bg-slate-100"
      role="img"
      aria-label={`${onTrack} on track, ${drifting} drifting, ${offTrack} off track`}
    >
      {onTrack > 0 && (
        <div
          className="bg-emerald-500"
          style={{ width: `${pct(onTrack)}%` }}
          title={`${onTrack} on track`}
        />
      )}
      {drifting > 0 && (
        <div
          className="bg-amber-500"
          style={{ width: `${pct(drifting)}%` }}
          title={`${drifting} drifting`}
        />
      )}
      {offTrack > 0 && (
        <div
          className="bg-rose-500"
          style={{ width: `${pct(offTrack)}%` }}
          title={`${offTrack} off track`}
        />
      )}
    </div>
  );
}

function TrackerSkeletons({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="space-y-2 px-4 py-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-10 rounded-xl bg-slate-100",
            !reducedMotion && "animate-pulse",
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}
