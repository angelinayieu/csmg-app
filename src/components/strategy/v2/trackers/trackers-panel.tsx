"use client";

import { useMemo, useState } from "react";
import { Activity, FlaskConical, Pencil, RefreshCcw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpaceTrackers, type TrackerWithLatest } from "@/lib/hooks/use-space-trackers";
import { KnownnessPill } from "@/components/ui/knownness-pill";
import type { PosteriorMap } from "@/lib/upf/posterior";
import { DATA_CATEGORY_META, type DataCategory } from "@/types/consent";

/**
 * Phase 4c-final-v3: the Trackers Lab panel.
 *
 * First user-visible surface that can actually drive the UPF learning loop.
 * Lists active metric_trackers for the space, groups them by depth_tier
 * (light / mid / heavy), shows current value + latest observation, and
 * provides an inline "Log reading" input on each row.
 *
 * On submit → POST /api/metric-trackers/[id]/observations → the server's
 * posterior fan-out updates `construct_posteriors` across every related
 * entity + proposal → the next render of every UPF-aware surface re-ranks.
 *
 * Rendered inside strategy-glass-page.tsx below InfrastructureSection.
 */

const DEPTH_TIER_META: Record<
  NonNullable<TrackerWithLatest["depth_tier"]>,
  { label: string; short: string; bg: string; fg: string; border: string; order: number; sub: string }
> = {
  light: {
    label: "Light",
    short: "L",
    bg: "bg-sky-50",
    fg: "text-sky-700",
    border: "border-sky-200",
    order: 0,
    sub: "cheap & fast · self-report / quick check",
  },
  mid: {
    label: "Mid",
    short: "M",
    bg: "bg-indigo-50",
    fg: "text-indigo-700",
    border: "border-indigo-200",
    order: 1,
    sub: "moderate effort · operational metric",
  },
  heavy: {
    label: "Heavy",
    short: "H",
    bg: "bg-rose-50",
    fg: "text-rose-700",
    border: "border-rose-200",
    order: 2,
    sub: "high effort · outcome / instrumentation",
  },
};

function depthTier(t: TrackerWithLatest): "light" | "mid" | "heavy" {
  return (t.depth_tier ?? "mid") as "light" | "mid" | "heavy";
}

function formatAge(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = ms / 60_000;
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

interface TrackersPanelProps {
  spaceId: string;
  /** Posterior map from synthesis_data — feeds the per-entity knownness pill
   *  context. Optional; pill is conditional on space entity_ids which trackers
   *  don't directly carry, so today we only use this to match tracker.label
   *  against `metric:<label>` constructs. */
  posteriors?: PosteriorMap;
}

export function TrackersPanel({ spaceId, posteriors }: TrackersPanelProps) {
  const { trackers, loading, error, refresh, logObservation } = useSpaceTrackers(spaceId);

  const grouped = useMemo(() => {
    const by: Record<"light" | "mid" | "heavy", TrackerWithLatest[]> = {
      light: [],
      mid: [],
      heavy: [],
    };
    for (const t of trackers) by[depthTier(t)].push(t);
    return by;
  }, [trackers]);

  const activeCount = trackers.length;
  const counts = {
    light: grouped.light.length,
    mid: grouped.mid.length,
    heavy: grouped.heavy.length,
  };

  if (!loading && trackers.length === 0 && !error) return null;

  return (
    <div className="relative">
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-2.5 px-0.5">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            border: "1px solid rgba(11,13,18,0.14)",
            fontSize: 11,
            fontWeight: 700,
            color: "#0B0D12",
            letterSpacing: "-0.005em",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.8) inset, 0 2px 6px rgba(11,13,18,0.04)",
          }}
        >
          <FlaskConical className="w-2.5 h-2.5" style={{ color: "rgba(11,13,18,0.48)" }} />
          Trackers Lab
        </span>
        <span
          style={{
            fontSize: 11,
            color: "rgba(11,13,18,0.48)",
            fontWeight: 500,
          }}
        >
          {activeCount} active
          {counts.light > 0 && ` · ${counts.light} light`}
          {counts.mid > 0 && ` · ${counts.mid} mid`}
          {counts.heavy > 0 && ` · ${counts.heavy} heavy`}
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[10.5px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          title="Refetch trackers from server"
        >
          <RefreshCcw className={cn("h-3 w-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Glass container */}
      <div
        className="relative overflow-hidden rounded-[14px] p-5"
        style={{
          background: "rgba(255, 255, 255, 0.72)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          border: "1px solid rgba(11,13,18,0.14)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04)",
        }}
      >
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            <AlertCircle className="w-3 h-3" />
            <span>Failed to load trackers: {error}</span>
          </div>
        )}

        {loading && trackers.length === 0 && (
          <div className="text-[12px] text-gray-500">Loading trackers…</div>
        )}

        {(["light", "mid", "heavy"] as const).map((tier) => {
          const rows = grouped[tier];
          if (rows.length === 0) return null;
          const meta = DEPTH_TIER_META[tier];
          return (
            <div key={tier} className="mb-5 last:mb-0">
              <div className="flex items-baseline gap-2 mb-2 px-0.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border",
                    meta.bg,
                    meta.fg,
                    meta.border
                  )}
                >
                  {meta.short} · {meta.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(11,13,18,0.48)",
                    fontWeight: 500,
                  }}
                >
                  · {meta.sub}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {rows.map((t) => (
                  <TrackerRow
                    key={t.id}
                    tracker={t}
                    posteriors={posteriors}
                    onSubmit={logObservation}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Per-row ──────────────────────────────────────────────────────────

function TrackerRow({
  tracker,
  posteriors,
  onSubmit,
}: {
  tracker: TrackerWithLatest;
  posteriors: PosteriorMap | undefined;
  onSubmit: (
    trackerId: string,
    payload: { value?: number | null; value_text?: string | null; note?: string | null }
  ) => Promise<{ ok: true; posteriorUpdates: number } | { ok: false; error: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState<string>("");
  const [draftNote, setDraftNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<null | { ok: boolean; msg: string }>(null);

  const category = (tracker.data_category ?? "generic") as DataCategory | "generic";
  const categoryLabel =
    category === "generic"
      ? null
      : DATA_CATEGORY_META[category as DataCategory]?.label ?? category;

  const latestAge = formatAge(tracker.latest_observation?.recorded_at);
  const displayValue =
    tracker.current_value != null
      ? tracker.unit
        ? `${tracker.current_value} ${tracker.unit}`
        : String(tracker.current_value)
      : tracker.current_text ?? "—";

  // Knownness pill on the metric-level construct (metric:<label-lower>).
  // The observation endpoint also updates this construct.
  const metricConstructId = `metric:${(tracker.label ?? "").trim().toLowerCase()}`;
  const hasMetricPosterior = !!posteriors?.[metricConstructId];

  async function submit() {
    const trimmedValue = draftValue.trim();
    if (!trimmedValue) {
      setFlash({ ok: false, msg: "Enter a value" });
      return;
    }
    const asNumber = Number(trimmedValue);
    const isNumber = Number.isFinite(asNumber);
    setBusy(true);
    setFlash(null);
    const payload = {
      value: isNumber ? asNumber : null,
      value_text: isNumber ? null : trimmedValue,
      note: draftNote.trim() ? draftNote.trim() : null,
    };
    const res = await onSubmit(tracker.id, payload);
    setBusy(false);
    if (res.ok) {
      setFlash({
        ok: true,
        msg: `Logged · ${res.posteriorUpdates} belief${res.posteriorUpdates === 1 ? "" : "s"} updated`,
      });
      setDraftValue("");
      setDraftNote("");
      setEditing(false);
      // Auto-clear the flash after 3s.
      setTimeout(() => setFlash(null), 3000);
    } else {
      setFlash({ ok: false, msg: res.error });
    }
  }

  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{
        background: "rgba(255,255,255,0.70)",
        border: "1px solid rgba(11,13,18,0.08)",
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Activity className="w-3 h-3 text-gray-400 flex-shrink-0" />
        <span
          className="font-semibold text-[12.5px] flex-1 min-w-[160px]"
          style={{ color: "#0B0D12" }}
        >
          {tracker.label}
        </span>

        {/* Current value */}
        <span
          className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] font-mono font-semibold text-gray-700"
          title="Latest recorded value"
        >
          {displayValue}
        </span>

        {/* Cadence */}
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
          style={{ background: "rgba(11,13,18,0.04)", color: "rgba(11,13,18,0.54)" }}
        >
          {tracker.cadence}
        </span>

        {/* Data category (consent-relevant) */}
        {categoryLabel && (
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-semibold"
            style={{ background: "rgba(99,102,241,0.08)", color: "#3730A3" }}
          >
            {categoryLabel}
          </span>
        )}

        {/* Latest observation age */}
        {latestAge && (
          <span
            className="text-[10px]"
            style={{ color: "rgba(11,13,18,0.48)" }}
            title={tracker.latest_observation?.recorded_at ?? undefined}
          >
            {latestAge}
          </span>
        )}

        {/* Knownness pill — metric-level construct.
            Only shows once at least one observation has been folded in. */}
        {hasMetricPosterior && (
          <MetricKnownnessPill
            posteriors={posteriors}
            constructId={metricConstructId}
          />
        )}

        <button
          onClick={() => setEditing((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-semibold",
            editing
              ? "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
              : "border-interaxis-200 bg-interaxis-50 text-interaxis-700 hover:bg-interaxis-100"
          )}
          title="Record a new observation — updates posteriors across related entities + proposals"
        >
          <Pencil className="w-2.5 h-2.5" />
          {editing ? "Cancel" : "Log reading"}
        </button>
      </div>

      {/* Edit row — inline form */}
      {editing && (
        <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <input
            type="text"
            inputMode="decimal"
            placeholder={
              tracker.unit
                ? `Value (${tracker.unit})`
                : tracker.baseline_text != null
                  ? "e.g. 'slightly improved'"
                  : "Numeric value"
            }
            className="flex-1 min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-900 focus:border-interaxis-400 focus:outline-none focus:ring-1 focus:ring-interaxis-400"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <input
            type="text"
            placeholder="Optional note"
            className="flex-1 min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-900 focus:border-interaxis-400 focus:outline-none focus:ring-1 focus:ring-interaxis-400"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            disabled={busy}
          />
          <button
            onClick={submit}
            disabled={busy || draftValue.trim().length === 0}
            className="rounded-md bg-interaxis-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-interaxis-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Submit"}
          </button>
        </div>
      )}

      {/* Flash message */}
      {flash && (
        <div
          className={cn(
            "mt-1.5 text-[10.5px] font-semibold",
            flash.ok ? "text-emerald-700" : "text-red-600"
          )}
        >
          {flash.msg}
        </div>
      )}
    </div>
  );
}

/**
 * Small metric-level variant of the knownness pill — looks up posterior by
 * metric construct id directly. Mirrors the entity-level KnownnessPill but
 * keys on a raw construct id, so we don't have to broaden that component's
 * API just for this surface.
 */
function MetricKnownnessPill({
  posteriors,
  constructId,
}: {
  posteriors: PosteriorMap | undefined;
  constructId: string;
}) {
  const p = posteriors?.[constructId];
  if (!p || p.observation_count === 0) return null;
  // Re-use the main KnownnessPill with a placeholder entityId by mapping
  // it through a synthetic posteriors object whose entity key points at
  // our metric posterior. Avoids a second pill component variant.
  const synthetic = { [`entity:__metric__`]: p };
  return <KnownnessPill entityId="__metric__" posteriors={synthetic} compact />;
}
