"use client";

// ── Recent Pipeline Runs Strip ─────────────────────────────────────
//
// Compact, read-only summary of `spine.recent_runs` rendered above
// the existing Reflexive dashboard content. Surfaces what the
// pipeline has been doing on the user's behalf — decompose,
// research, synthesize, strategy-refresh, generate-apps, critique —
// in the same panel that already shows prospector activity, so the
// "Reflexive" tab becomes a true unified ops feed.
//
// Click on a row → navigate to /app/space/<id>/whiteboard?run=<runId>
// which mounts the existing canvas event HUD against that run.
//
// Renders nothing when there are zero recent runs.

import { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Activity, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import type { SpineRun } from "@/types/intelligence-spine";

interface Props {
  spaceId: string;
  runs: SpineRun[] | null;
  /** Soft cap on rows. Default 6 — enough to fit on one strip. */
  limit?: number;
  className?: string;
}

const PIPELINE_LABEL: Record<string, string> = {
  decompose: "Decompose",
  research: "Research",
  synthesize: "Synthesize",
  "strategy-refresh": "Strategy refresh",
  "generate-apps": "Generate apps",
  critique: "Critique",
  expand: "Expand",
  "intake-bootstrap": "Intake",
  "prospect-connections": "Prospector",
};

export function RecentPipelineRunsStrip({
  spaceId,
  runs,
  limit = 6,
  className,
}: Props) {
  const trimmed = useMemo(
    () => (runs ?? []).slice(0, limit),
    [runs, limit],
  );

  if (trimmed.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-xl border border-gray-200 bg-white shadow-sm",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-interaxis-600" />
          <h2 className="text-[12px] font-semibold text-gray-900">
            Recent pipeline runs
          </h2>
          <span className="text-[10.5px] text-gray-400">
            ({trimmed.length})
          </span>
        </div>
      </header>
      <ul className="divide-y divide-gray-100">
        {trimmed.map((run) => (
          <RunRow key={run.id} run={run} spaceId={spaceId} />
        ))}
      </ul>
    </section>
  );
}

function RunRow({ run, spaceId }: { run: SpineRun; spaceId: string }) {
  const label = PIPELINE_LABEL[run.pipeline] ?? run.pipeline;
  const { Icon, tone, statusLabel } = formatStatus(run.status);

  return (
    <li>
      <Link
        href={`/app/space/${spaceId}/whiteboard?run=${run.id}`}
        className="flex items-center gap-3 px-4 py-2 text-[11.5px] hover:bg-gray-50 transition-colors"
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            tone,
            run.status === "running" && "animate-spin",
          )}
        />
        <span className="font-semibold text-gray-900 min-w-0 truncate">
          {label}
        </span>
        <span className={cn("font-medium tabular-nums", tone)}>
          {statusLabel}
        </span>
        <span className="ml-auto flex items-center gap-2 tabular-nums text-gray-500">
          {typeof run.duration_ms === "number" && (
            <span title="Duration">
              {formatDuration(run.duration_ms)}
            </span>
          )}
          <span className="text-gray-400" title={`Started ${run.started_at}`}>
            {formatRel(run.started_at)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function formatStatus(status: SpineRun["status"]): {
  Icon: typeof Loader2;
  tone: string;
  statusLabel: string;
} {
  if (status === "running") {
    return { Icon: Loader2, tone: "text-amber-600", statusLabel: "running" };
  }
  if (status === "completed") {
    return { Icon: CheckCircle2, tone: "text-emerald-600", statusLabel: "done" };
  }
  if (status === "failed") {
    return { Icon: AlertCircle, tone: "text-rose-600", statusLabel: "failed" };
  }
  return { Icon: Clock, tone: "text-gray-500", statusLabel: status };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatRel(iso: string): string {
  const d = Date.now() - Date.parse(iso);
  if (Number.isNaN(d) || d < 0) return "now";
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  return `${dd}d ago`;
}
