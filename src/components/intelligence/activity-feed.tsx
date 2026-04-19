"use client";

import { Activity, CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEntry } from "@/app/api/spaces/[id]/intelligence-overview/route";

interface ActivityFeedProps {
  entries: ActivityEntry[];
  /** How many rows to display. Default 15. */
  limit?: number;
}

/**
 * Prospector activity feed — the pulse of the reflexive loop.
 *
 * Each row describes one pair-check: which pair, whether an edge was found,
 * the examination level (visual depth indicator), and the LLM's reasoning
 * snippet if stored. Grouped visually by time buckets so the user can see
 * batches from individual prospector runs.
 */
export function ActivityFeed({ entries, limit = 15 }: ActivityFeedProps) {
  const shown = entries.slice(0, limit);

  if (shown.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
        <Activity className="mx-auto mb-2 h-6 w-6 text-gray-300" />
        <p className="text-[12px] font-semibold text-gray-600">No activity yet</p>
        <p className="mt-0.5 text-[11px] text-gray-500">
          The prospector hasn&rsquo;t examined any pairs. Enable auto-refresh or tap &ldquo;Scan now&rdquo; to begin.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {shown.map((e, i) => {
        const isNewBucket = i === 0 || bucketKey(e.checked_at) !== bucketKey(shown[i - 1].checked_at);
        return (
          <li key={`${e.checked_at}-${i}`}>
            {isNewBucket && (
              <div className="mt-2 mb-1 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                <span>{bucketLabel(e.checked_at)}</span>
                <span className="h-px flex-1 bg-gray-100" />
              </div>
            )}
            <ActivityRow entry={e} />
          </li>
        );
      })}
      {entries.length > limit && (
        <li className="pt-1 text-center text-[10px] text-gray-400">
          + {entries.length - limit} more
        </li>
      )}
    </ul>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const Icon = entry.edge_proposed ? CheckCircle2 : Circle;
  const iconColor = entry.edge_proposed ? "text-emerald-500" : "text-gray-300";
  return (
    <div className="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-gray-50 transition-colors">
      <Icon className={cn("h-3 w-3 shrink-0 mt-0.5", iconColor)} />
      <div className="min-w-0 flex-1 text-[11px]">
        <div className="flex items-center gap-1 truncate">
          <span className="truncate font-medium text-gray-800">{entry.entity_a_name}</span>
          <ArrowRight className="h-2.5 w-2.5 shrink-0 text-gray-400" />
          <span className="truncate font-medium text-gray-800">{entry.entity_b_name}</span>
          <ExamLevelPill level={entry.examination_level} />
          {entry.edge_proposed && (
            <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-700">
              edge
            </span>
          )}
        </div>
        {entry.reasoning && (
          <p className="mt-0.5 text-[10px] leading-snug text-gray-500 line-clamp-2">
            {entry.reasoning}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[9px] tabular-nums text-gray-400 mt-0.5">
        {timeOnly(entry.checked_at)}
      </span>
    </div>
  );
}

function ExamLevelPill({ level }: { level: number }) {
  const styles: Record<number, { label: string; bg: string; fg: string }> = {
    0: { label: "L0", bg: "bg-gray-100", fg: "text-gray-400" },
    1: { label: "L1", bg: "bg-amber-100", fg: "text-amber-700" },
    2: { label: "L2", bg: "bg-blue-100", fg: "text-blue-700" },
    3: { label: "L3", bg: "bg-emerald-100", fg: "text-emerald-700" },
    4: { label: "L4", bg: "bg-purple-100", fg: "text-purple-700" },
  };
  const s = styles[level] ?? styles[1];
  return (
    <span className={cn("shrink-0 rounded px-1 py-0.5 text-[8px] font-bold tabular-nums", s.bg, s.fg)} title={`Examination level ${level}`}>
      {s.label}
    </span>
  );
}

function bucketKey(iso: string): string {
  const d = new Date(iso);
  const hr = d.getHours();
  const day = d.toISOString().slice(0, 10);
  // Hour-resolution bucket (each hour = one time-strip header)
  return `${day}:${hr}`;
}

function bucketLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const yesterday = d.toDateString() === new Date(Date.now() - 86400000).toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (same) return `Today · ${time.replace(/:\d+/, ":00")}`;
  if (yesterday) return `Yesterday · ${time.replace(/:\d+/, ":00")}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${time.replace(/:\d+/, ":00")}`;
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
