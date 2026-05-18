"use client";

// ── Recent observations feed ───────────────────────────────────────
//
// Lives on the Outcomes tab. Fetches the last 10 observations via
// GET /api/spaces/[id]/observations and renders them as a vertical
// timeline. Each row shows the free-text observation, observed_at
// (relative), tags, and a calibration verdict chip.
//
// Owns its own data fetch + re-fetch trigger (parent calls
// `refresh()` via an imperative handle after a new observation
// submits, or after a realtime event lands in Phase 2 W3).

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { ObservationIcon } from "@/components/twin/icons/twin-icons";
import type { ObservationRow } from "@/app/api/spaces/[id]/observations/route";

interface Props {
  spaceId: string;
}

export interface ObservationFeedHandle {
  refresh: () => Promise<void>;
  /** Prepend a single observation optimistically — used right after
   *  submit so the new row appears immediately without waiting for
   *  the fetch round-trip. */
  prepend: (obs: ObservationRow) => void;
}

export const TwinObservationFeed = forwardRef<ObservationFeedHandle, Props>(
  function TwinObservationFeed({ spaceId }, ref) {
    const [items, setItems] = useState<ObservationRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchItems = useCallback(async () => {
      setError(null);
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/observations?limit=10`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { observations: ObservationRow[] };
        setItems(json.observations);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }, [spaceId]);

    useEffect(() => {
      void fetchItems();
    }, [fetchItems]);

    useImperativeHandle(
      ref,
      () => ({
        refresh: fetchItems,
        prepend: (obs) => setItems((curr) => [obs, ...curr].slice(0, 10)),
      }),
      [fetchItems],
    );

    return (
      <article
        className="rounded-2xl"
        style={{
          background: "var(--glass-card-bg)",
          boxShadow: "var(--shadow-card)",
          backdropFilter: "blur(var(--blur-card))",
          WebkitBackdropFilter: "blur(var(--blur-card))",
        }}
      >
        <header className="flex items-center justify-between border-b border-black/[0.04] px-6 py-3.5">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            <ObservationIcon size={11} />
            Recent observations
          </div>
          <span className="text-[10.5px] text-gray-400">
            {items.length === 0 ? "Empty" : `Last ${items.length}`}
          </span>
        </header>

        {loading ? (
          <FeedSkeleton />
        ) : error ? (
          <div className="px-6 py-6 text-[13px] text-gray-600">
            Couldn&apos;t load: {error}
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-6 text-[13px] leading-relaxed text-gray-500">
            No observations yet. Use the &quot;Log observation&quot; button
            above to tell the twin what you&apos;ve actually seen — it&apos;ll
            score it against open predictions.
          </div>
        ) : (
          <ul className="divide-y divide-black/[0.04]">
            {items.map((obs) => (
              <ObservationRow key={obs.id} observation={obs} />
            ))}
          </ul>
        )}
      </article>
    );
  },
);

// ── Per-row ───────────────────────────────────────────────────────

function ObservationRow({ observation }: { observation: ObservationRow }) {
  const cal = observation.calibration_applied;
  return (
    <li className="px-6 py-3.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
          style={{
            background: "rgba(15,23,42,0.04)",
            color: "var(--accent-500)",
          }}
        >
          <ObservationIcon size={11} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[10.5px] text-gray-400">
              {formatRelative(observation.observed_at)}
            </span>
            {cal && <VerdictChip verdict={cal.verdict} />}
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-gray-700">
            {observation.observation_text}
          </p>
          {observation.actual_value && (
            <div className="mt-1.5 font-mono text-[11px] text-gray-500">
              {observation.actual_value.metric} ={" "}
              <span className="text-gray-800">
                {observation.actual_value.value}
              </span>
              {observation.actual_value.unit
                ? ` ${observation.actual_value.unit}`
                : ""}
            </div>
          )}
          {observation.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {observation.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {cal && cal.matched_prediction_ids.length > 0 && (
            <div className="mt-1.5 text-[10.5px] italic text-gray-500">
              {cal.narrative}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Verdict chip ──────────────────────────────────────────────────

function VerdictChip({ verdict }: { verdict: string }) {
  const cls =
    verdict === "confirms"
      ? "bg-emerald-50 text-emerald-700"
      : verdict === "partial"
      ? "bg-amber-50 text-amber-700"
      : verdict === "refutes"
      ? "bg-red-50 text-red-700"
      : verdict === "qualitative"
      ? "bg-gray-100 text-gray-600"
      : "bg-gray-50 text-gray-500";
  const label =
    verdict === "confirms"
      ? "Confirms"
      : verdict === "partial"
      ? "Partial match"
      : verdict === "refutes"
      ? "Surprise"
      : verdict === "qualitative"
      ? "Qualitative"
      : "No match yet";
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <ul className="divide-y divide-black/[0.04]">
      {[0, 1, 2].map((i) => (
        <li key={i} className="px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 flex-shrink-0 animate-pulse rounded-md bg-black/[0.05]" />
            <div className="flex-1 space-y-2">
              <div className="h-2.5 w-16 animate-pulse rounded-full bg-black/[0.05]" />
              <div className="h-3 w-full animate-pulse rounded-full bg-black/[0.05]" />
              <div className="h-3 w-4/5 animate-pulse rounded-full bg-black/[0.05]" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Relative-time helper ──────────────────────────────────────────

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.round(day / 30);
    return `${mo}mo ago`;
  } catch {
    return "—";
  }
}
