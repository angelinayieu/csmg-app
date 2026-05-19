"use client";

// ── Latest snapshot card ───────────────────────────────────────────
//
// The visible landing spot for the Coach `take_snapshot` action.
// Without this card, the action was a toast-and-vanish — the row
// got written to twin_snapshots but the user had no way to see it.
//
// Three states:
//   - Loading: muted skeleton
//   - Empty:   polite explanation + pointer to the Actions menu
//   - Filled:  freeze metadata (reason, captured_at, counts) +
//              a "since then" delta line comparing snapshot counts
//              to the current live KG
//
// Phase 3 polish: when the twin_snapshots table starts accumulating
// rows, this card grows into a horizontal mini-timeline (multiple
// dots). For now: single most-recent entry, tight glass card.
//
// Imperative `refresh()` handle so the Outcomes tab can re-fetch
// after a take_snapshot action lands.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { SnapshotIcon } from "@/components/twin/icons/twin-icons";
import type { LatestSnapshotPayload } from "@/app/api/spaces/[id]/snapshots/latest/route";

interface Props {
  spaceId: string;
}

export interface LatestSnapshotCardHandle {
  refresh: () => Promise<void>;
}

const REASON_LABEL: Record<string, string> = {
  user_request: "Captured by you",
  pre_strategy: "Before strategy regen",
  post_intervention: "After intervention",
  scheduled: "Scheduled capture",
  pipeline_checkpoint: "Pipeline checkpoint",
};

export const TwinLatestSnapshotCard = forwardRef<
  LatestSnapshotCardHandle,
  Props
>(function TwinLatestSnapshotCard({ spaceId }, ref) {
  const [data, setData] = useState<LatestSnapshotPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/snapshots/latest`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LatestSnapshotPayload;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void fetchLatest();
  }, [fetchLatest]);

  useImperativeHandle(
    ref,
    () => ({ refresh: fetchLatest }),
    [fetchLatest],
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
      <header className="flex items-center justify-between gap-3 border-b border-black/[0.04] px-6 py-3.5">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
          <SnapshotIcon size={11} />
          Snapshots
        </div>
        {data?.latest_snapshot && (
          <span className="text-[10.5px] text-gray-400">
            {formatRelative(data.latest_snapshot.captured_at)}
          </span>
        )}
      </header>

      {loading && <CardSkeleton />}

      {!loading && error && (
        <div className="px-6 py-5 text-[13px] text-gray-600">
          Couldn&apos;t load snapshots: {error}.
        </div>
      )}

      {!loading && !error && data && !data.latest_snapshot && (
        <EmptyState />
      )}

      {!loading && !error && data?.latest_snapshot && (
        <FilledBody
          snapshot={data.latest_snapshot}
          since={data.since_then}
          currentCounts={data.current_counts}
        />
      )}
    </article>
  );
});

// ── Filled body ───────────────────────────────────────────────────

function FilledBody({
  snapshot,
  since,
  currentCounts,
}: {
  snapshot: NonNullable<LatestSnapshotPayload["latest_snapshot"]>;
  since: LatestSnapshotPayload["since_then"];
  currentCounts: LatestSnapshotPayload["current_counts"];
}) {
  const reasonLabel = snapshot.reason
    ? (REASON_LABEL[snapshot.reason] ?? prettyReason(snapshot.reason))
    : "Snapshot";

  return (
    <div className="px-6 py-5">
      <div className="text-[12px] font-medium text-gray-900">
        {reasonLabel}
      </div>
      <div className="mt-0.5 text-[10.5px] text-gray-500">
        {formatDate(snapshot.captured_at)}
      </div>

      {/* At-capture counts ─────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <CountBlock label="Entities" frozen={snapshot.entity_count} />
        <CountBlock label="Edges" frozen={snapshot.edge_count} />
        <CountBlock label="Cycles" frozen={snapshot.cycle_count} />
      </div>

      {/* Since-then delta line ─────────────────────────────────── */}
      {since && (
        <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-black/[0.04] pt-3 text-[11.5px] text-gray-600">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            Since then
          </span>
          <DeltaPill label="entities" delta={since.entities_delta} />
          <DeltaPill label="edges" delta={since.edges_delta} />
          <DeltaPill label="cycles" delta={since.cycles_delta} />
          <span className="ml-auto text-[10.5px] text-gray-400">
            now {currentCounts.entities}/{currentCounts.edges}/
            {currentCounts.cycles}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="px-6 py-5 text-[13px] leading-relaxed text-gray-500">
      No snapshots yet. Open the Actions menu (top-right) and pick{" "}
      <span className="font-medium text-gray-700">Capture snapshot</span>{" "}
      — the twin&apos;s current state will freeze here for comparison.
    </div>
  );
}

// ── Per-count block ───────────────────────────────────────────────

function CountBlock({ label, frozen }: { label: string; frozen: number }) {
  return (
    <div
      className="flex flex-col rounded-xl px-3 py-2.5"
      style={{ background: "rgba(15,23,42,0.03)" }}
    >
      <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-gray-500">
        {label}
      </span>
      <span className="mt-0.5 font-display-tight text-[20px] font-semibold leading-none text-gray-900 tabular-nums">
        {frozen}
      </span>
    </div>
  );
}

// ── Delta pill ────────────────────────────────────────────────────

function DeltaPill({ label, delta }: { label: string; delta: number }) {
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
  const cls =
    delta > 0
      ? "text-emerald-700"
      : delta < 0
      ? "text-red-700"
      : "text-gray-500";
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span className={`font-mono tabular-nums font-semibold ${cls}`}>
        {sign}
        {delta}
      </span>
      <span className="text-gray-500">{label}</span>
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="space-y-3 px-6 py-5">
      <div className="h-3 w-32 animate-pulse rounded-full bg-black/[0.05]" />
      <div className="h-2.5 w-20 animate-pulse rounded-full bg-black/[0.05]" />
      <div className="grid grid-cols-3 gap-3 pt-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-xl bg-black/[0.04]"
          />
        ))}
      </div>
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────

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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function prettyReason(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}
