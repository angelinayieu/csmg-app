"use client";

// ── Background Runtime Panel ───────────────────────────────────────────
//
// The control surface for per-space cron gating. Today the agent-runtime
// (every 2h, runs LLM predictor agents) and predictions-resolve (hourly,
// matures predictions + fires KG calibration) crons act on every space
// regardless of user intent. This panel lets the user, per space:
//
//   • Toggle each cron on/off                 (runtime_settings.{cron}.enabled)
//   • Set the minimum interval between runs   (runtime_settings.{cron}.cadence_hours)
//   • Pause agent-runtime temporarily         (runtime_settings.agent_runtime.paused_until)
//   • See "next run" countdowns               (server-derived next_due field)
//
// The cron itself can't be re-scheduled from here (its frequency is set
// in vercel.json and global). What we control is whether the cron acts
// on this space when it ticks. This is enough to stop cost burn on
// inactive spaces and let power users throttle to e.g. once a day.
//
// Wires: GET/PATCH /api/spaces/[id]/runtime-settings.

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Power,
  Clock,
  Pause,
  Activity,
  Zap,
  AlertCircle,
  Loader2,
  Play,
} from "lucide-react";

interface CronSetting {
  enabled: boolean;
  cadence_hours: number;
  paused_until?: string | null;
}

interface RuntimeSettings {
  agent_runtime: CronSetting;
  predictions_resolve: CronSetting;
}

interface LastRuns {
  agent_runtime: string | null;
  predictions_resolve: string | null;
}

interface DueCheck {
  due: boolean;
  reason: string;
  seconds_until_due: number;
}

interface RuntimeSettingsResponse {
  settings: RuntimeSettings;
  last_runs: LastRuns;
  next_due: {
    agent_runtime: DueCheck;
    predictions_resolve: DueCheck;
  };
}

interface Props {
  spaceId: string;
  className?: string;
}

const AGENT_RUNTIME_CADENCE_OPTIONS = [
  { value: 2, label: "2 h" },
  { value: 6, label: "6 h" },
  { value: 12, label: "12 h" },
  { value: 24, label: "1 d" },
  { value: 72, label: "3 d" },
  { value: 168, label: "1 w" },
];

const PREDICTIONS_RESOLVE_CADENCE_OPTIONS = [
  { value: 1, label: "1 h" },
  { value: 4, label: "4 h" },
  { value: 12, label: "12 h" },
  { value: 24, label: "1 d" },
  { value: 168, label: "1 w" },
];

const PAUSE_PRESETS = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
  { hours: 720, label: "30 days" },
];

export function BackgroundRuntimePanel({ spaceId, className }: Props) {
  const [data, setData] = useState<RuntimeSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/runtime-settings`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as RuntimeSettingsResponse;
      setData(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: Record<string, any>,
    ) => {
      if (saving) return;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/runtime-settings`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as RuntimeSettingsResponse;
        setData(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [spaceId, saving],
  );

  if (loading) {
    return (
      <div className={cn("rounded-xl border border-gray-200 bg-white p-4 space-y-2", className)}>
        <div className="h-3 w-32 bg-gray-100 rounded animate-pulse" />
        <div className="h-3 w-full bg-gray-100 rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={cn("rounded-xl border border-red-200 bg-red-50/40 p-4 text-[11px] text-red-600", className)}>
        Couldn&apos;t load runtime settings: {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={cn("rounded-xl border border-gray-200 bg-white p-4 space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">
            Background Runtime
          </div>
          <p className="text-[10.5px] text-gray-500 leading-snug mt-0.5">
            Control whether crons act on this space. The cron itself ticks on a global schedule; settings here gate the per-space work.
          </p>
        </div>
        {saving && <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin" />}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50/40 ring-1 ring-red-100 px-2.5 py-1.5 text-[10.5px] text-red-700 flex items-center gap-1.5">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}

      <CronControl
        kind="agent_runtime"
        title="Predictor agents"
        subtitle="LLM agents that emit forecasts about your apps"
        icon={<Zap className="h-3.5 w-3.5 text-amber-600" />}
        setting={data.settings.agent_runtime}
        nextDue={data.next_due.agent_runtime}
        lastRun={data.settings.last_runs.agent_runtime}
        cadenceOptions={AGENT_RUNTIME_CADENCE_OPTIONS}
        showPausePresets
        disabled={saving}
        onToggle={(enabled) => patch({ agent_runtime: { enabled } })}
        onCadence={(cadence_hours) => patch({ agent_runtime: { cadence_hours } })}
        onPause={(paused_until) => patch({ agent_runtime: { paused_until } })}
      />

      <div className="border-t border-gray-100" />

      <CronControl
        kind="predictions_resolve"
        title="Prediction resolver"
        subtitle="Matures past-horizon predictions and fires KG calibration"
        icon={<Activity className="h-3.5 w-3.5 text-emerald-600" />}
        setting={data.settings.predictions_resolve}
        nextDue={data.next_due.predictions_resolve}
        lastRun={data.settings.last_runs.predictions_resolve}
        cadenceOptions={PREDICTIONS_RESOLVE_CADENCE_OPTIONS}
        disabled={saving}
        onToggle={(enabled) => patch({ predictions_resolve: { enabled } })}
        onCadence={(cadence_hours) => patch({ predictions_resolve: { cadence_hours } })}
      />

      <div className="text-[9.5px] text-gray-400 leading-snug">
        Cron ticks on a global schedule — agent-runtime every 2h, predictions-resolve every hour. These settings decide whether each tick acts on this space. Disabling stops cost burn but does <span className="font-semibold">not</span> retroactively delete pending predictions; resuming picks them back up.
      </div>
    </div>
  );
}

// ── Per-cron control card ───────────────────────────────────────────────

interface CronControlProps {
  kind: "agent_runtime" | "predictions_resolve";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  setting: CronSetting;
  nextDue: DueCheck;
  lastRun: string | null;
  cadenceOptions: Array<{ value: number; label: string }>;
  showPausePresets?: boolean;
  disabled?: boolean;
  onToggle: (enabled: boolean) => void;
  onCadence: (cadence_hours: number) => void;
  onPause?: (paused_until: string | null) => void;
}

function CronControl({
  title,
  subtitle,
  icon,
  setting,
  nextDue,
  lastRun,
  cadenceOptions,
  showPausePresets,
  disabled,
  onToggle,
  onCadence,
  onPause,
}: CronControlProps) {
  const isPaused = !!setting.paused_until && Date.parse(setting.paused_until) > Date.now();
  const statusTone = !setting.enabled
    ? "bg-gray-100 text-gray-500 ring-gray-200"
    : isPaused
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : nextDue.due
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : "bg-indigo-50 text-indigo-700 ring-indigo-200";
  const statusLabel = !setting.enabled
    ? "Disabled"
    : isPaused
      ? "Paused"
      : nextDue.due
        ? "Ready to run"
        : `Next in ${formatSeconds(nextDue.seconds_until_due)}`;

  return (
    <div className="space-y-2.5">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <div className="mt-0.5 shrink-0">{icon}</div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-gray-900 leading-tight">{title}</div>
            <div className="text-[10.5px] text-gray-500 leading-snug mt-0.5">{subtitle}</div>
          </div>
        </div>
        {/* Master toggle */}
        <button
          type="button"
          onClick={() => onToggle(!setting.enabled)}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-4 w-8 items-center rounded-full transition-colors shrink-0",
            setting.enabled ? "bg-indigo-500" : "bg-gray-300",
            disabled && "opacity-50 cursor-not-allowed",
          )}
          aria-pressed={setting.enabled}
        >
          <span
            className={cn(
              "inline-block h-3 w-3 rounded-full bg-white transition-transform",
              setting.enabled ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Status chip */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold ring-1 tabular-nums", statusTone)}>
          <Power className="h-2.5 w-2.5" />
          {statusLabel}
        </span>
        {lastRun && (
          <span className="text-[9.5px] text-gray-500 tabular-nums">
            <Clock className="inline h-2.5 w-2.5 mr-0.5" />
            Last run {formatRel(lastRun)}
          </span>
        )}
        {!setting.enabled || isPaused ? null : (
          <span className="text-[9.5px] text-gray-400">
            {nextDue.reason}
          </span>
        )}
      </div>

      {/* Cadence selector — only when enabled */}
      {setting.enabled && (
        <div>
          <div className="text-[9.5px] uppercase tracking-wide text-gray-500 font-semibold mb-1">
            Min interval between runs
          </div>
          <div className="flex gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {cadenceOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onCadence(opt.value)}
                disabled={disabled}
                className={cn(
                  "flex-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition-all tabular-nums",
                  setting.cadence_hours === opt.value
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pause presets — only when supported + enabled */}
      {showPausePresets && setting.enabled && onPause && (
        <div>
          <div className="text-[9.5px] uppercase tracking-wide text-gray-500 font-semibold mb-1 flex items-center justify-between">
            <span>Temporary pause</span>
            {isPaused && (
              <button
                type="button"
                onClick={() => onPause(null)}
                disabled={disabled}
                className="text-[9.5px] font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Cancel pause
              </button>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {PAUSE_PRESETS.map((p) => (
              <button
                key={p.hours}
                type="button"
                onClick={() => {
                  const pausedUntil = new Date(Date.now() + p.hours * 60 * 60 * 1000).toISOString();
                  onPause(pausedUntil);
                }}
                disabled={disabled}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition-colors",
                  isPaused
                    ? "bg-white text-gray-500 ring-gray-200 hover:bg-amber-50/40"
                    : "bg-white text-gray-700 ring-gray-200 hover:bg-amber-50/40 hover:text-amber-700 hover:ring-amber-200",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                <Pause className="h-2.5 w-2.5" />
                {p.label}
              </button>
            ))}
          </div>
          {isPaused && setting.paused_until && (
            <div className="mt-1 text-[9.5px] text-amber-700">
              Paused until {new Date(setting.paused_until).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatSeconds(s: number): string {
  if (s < 0) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
