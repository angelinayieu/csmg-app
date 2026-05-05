"use client";

// ── PipelineRunHistoryPanel ──────────────────────────────────────────
//
// Diagnostic surface for "what stages have run for this space".
//
// Solves: silent skips (lazy-guard cache hits, deferred apps, gated
// synthesis) leave the dashboard looking broken with no indication of
// what actually happened. Without this panel users had no way to see
// "synthesis ran 5 minutes ago — but it was a cache hit, no new
// content was produced."
//
// Reads from `/api/spaces/[id]/runs` (already exists; no new endpoint)
// plus `space.synthesis_data.analysis_runs` (already populated by
// synthesize for skip-cache events) for the per-stage skip detail that
// pipeline_runs.status alone doesn't carry.
//
// Self-fetches on mount; refetches when `refreshKey` bumps (consumer
// can pass a counter that increments after Re-evaluate so the panel
// reflects the new run immediately instead of waiting for a polling
// tick that doesn't exist).

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useSpaceData } from "@/contexts/space-data-context";

const EASE = [0.22, 1, 0.36, 1] as const;

interface RunRow {
  id: string;
  pipeline: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  initial_prompt: string | null;
}

interface AnalysisRun {
  run_id: string;
  pipeline: string;
  started_at: string;
  completed_at?: string | null;
  status: string; // "completed" | "skipped_cache" | "failed" | etc.
  tier?: string;
  stages_run?: string[];
  stages_skipped?: string[];
  cache_hits?: string[];
  fingerprint?: string;
  note?: string | null;
}

const PIPELINE_LABEL: Record<string, string> = {
  intake_bootstrap: "Intake",
  decompose: "Decompose",
  research: "Research",
  research_round: "Research round",
  research_deep: "Deep research",
  synthesize: "Synthesize",
  strategy_refresh: "Strategy",
  generate_apps: "Apps",
  critique: "Critique",
  expand: "Expand",
  writer_path: "Writer path",
  plan_propose: "Plan",
  insight_lab: "Lab",
};

function prettyPipeline(p: string): string {
  return PIPELINE_LABEL[p] ?? p.replace(/_/g, " ");
}

export interface PipelineRunHistoryPanelProps {
  /** Bumped by the parent after triggering a fresh run; refetches the list. */
  refreshKey?: number;
}

export function PipelineRunHistoryPanel({ refreshKey = 0 }: PipelineRunHistoryPanelProps) {
  const { space } = useSpaceData();
  const spaceId = space?.id;

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/runs`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { runs?: RunRow[] };
        if (!cancelled) setRuns(json.runs ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? "Failed to load runs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId, refreshKey]);

  // Pull synthesize skip-cache events from synthesis_data.analysis_runs.
  // These don't show up as failed runs (status is still "completed") but
  // tell us "synthesis was reused from cache, nothing new was produced".
  const analysisRuns = useMemo<AnalysisRun[]>(() => {
    const synth = (space?.synthesis_data as Record<string, unknown> | null) ?? null;
    const arr = synth?.analysis_runs;
    if (!Array.isArray(arr)) return [];
    return arr as AnalysisRun[];
  }, [space?.synthesis_data]);

  const cacheHitsByRunId = useMemo(() => {
    const map = new Map<string, AnalysisRun>();
    for (const a of analysisRuns) {
      if (a.status === "skipped_cache" && a.run_id) map.set(a.run_id, a);
    }
    return map;
  }, [analysisRuns]);

  // Summary: counts by status. Drives the collapsed-state header.
  const summary = useMemo(() => {
    let running = 0;
    let completed = 0;
    let failed = 0;
    let cacheSkips = 0;
    for (const r of runs) {
      if (r.status === "running") running++;
      else if (r.status === "completed") {
        completed++;
        if (cacheHitsByRunId.has(r.id)) cacheSkips++;
      } else if (r.status === "failed") failed++;
    }
    return { running, completed, failed, cacheSkips, total: runs.length };
  }, [runs, cacheHitsByRunId]);

  const lastCompleted = useMemo(
    () => runs.find((r) => r.status === "completed" && r.completed_at),
    [runs],
  );

  if (!spaceId) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="rounded-xl border border-gray-200 bg-white/80 backdrop-blur-md"
      aria-label="Pipeline run history"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-50/60"
        aria-expanded={expanded}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{
            background:
              summary.running > 0
                ? "#0A84FF"
                : summary.failed > 0
                  ? "#FF453A"
                  : summary.cacheSkips > 0
                    ? "#FF9F0A"
                    : "#30D158",
            boxShadow:
              summary.running > 0
                ? "0 0 8px rgba(10,132,255,0.5)"
                : undefined,
          }}
        />
        <div className="flex flex-1 items-baseline gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-fg,#6b7280)]">
            Pipeline activity
          </span>
          <span className="text-[12px] text-[color:var(--muted-fg,#48484a)]">
            {loading ? (
              "loading…"
            ) : summary.total === 0 ? (
              "no runs yet"
            ) : (
              <>
                <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">
                  {summary.total}
                </span>{" "}
                run{summary.total === 1 ? "" : "s"}
                {summary.running > 0 ? (
                  <>
                    {" · "}
                    <span className="font-medium text-blue-600">
                      {summary.running} running
                    </span>
                  </>
                ) : null}
                {summary.failed > 0 ? (
                  <>
                    {" · "}
                    <span className="font-medium text-red-600">
                      {summary.failed} failed
                    </span>
                  </>
                ) : null}
                {summary.cacheSkips > 0 ? (
                  <>
                    {" · "}
                    <span className="font-medium text-amber-600">
                      {summary.cacheSkips} cache-skipped
                    </span>
                  </>
                ) : null}
                {lastCompleted ? (
                  <span className="ml-1 text-[color:var(--muted-fg,#86868b)]">
                    · last {formatAgo(lastCompleted.completed_at!)}
                  </span>
                ) : null}
              </>
            )}
          </span>
        </div>
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-gray-200/60">
          {error ? (
            <div className="px-4 py-3 text-[12px] text-red-700">{error}</div>
          ) : runs.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-[color:var(--muted-fg,#86868b)]">
              No pipeline activity recorded yet.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {runs.slice(0, 15).map((r) => {
                const skipDetail = cacheHitsByRunId.get(r.id);
                return <RunRowItem key={r.id} run={r} skipDetail={skipDetail} />;
              })}
            </ul>
          )}
          {runs.length > 15 ? (
            <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-[color:var(--muted-fg,#86868b)]">
              {runs.length - 15} older runs not shown.
            </div>
          ) : null}
        </div>
      ) : null}
    </motion.section>
  );
}

function RunRowItem({
  run,
  skipDetail,
}: {
  run: RunRow;
  skipDetail?: AnalysisRun;
}) {
  const isRunning = run.status === "running";
  const isFailed = run.status === "failed";
  const isCacheSkip = !!skipDetail && run.status === "completed";
  const isFreshCompletion = run.status === "completed" && !isCacheSkip;

  const accent = isRunning
    ? "#0A84FF"
    : isFailed
      ? "#FF453A"
      : isCacheSkip
        ? "#FF9F0A"
        : "#30D158";

  const statusLabel = isRunning
    ? "running"
    : isFailed
      ? "failed"
      : isCacheSkip
        ? "cache hit"
        : "completed";

  const duration =
    run.completed_at && run.started_at
      ? formatDuration(
          new Date(run.completed_at).getTime() - new Date(run.started_at).getTime(),
        )
      : null;

  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: accent, boxShadow: isRunning ? `0 0 6px ${accent}80` : undefined }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-medium text-[color:var(--fg,#1d1d1f)]">
            {prettyPipeline(run.pipeline)}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{
              background: `${accent}1A`,
              color: accent,
              border: `1px solid ${accent}33`,
            }}
          >
            {statusLabel}
          </span>
          <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
            · {formatAgo(run.started_at)}
          </span>
          {duration ? (
            <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
              · {duration}
            </span>
          ) : null}
        </div>
        {isCacheSkip && skipDetail?.note ? (
          <p className="mt-0.5 text-[11.5px] leading-snug text-amber-700">
            {skipDetail.note}
          </p>
        ) : null}
        {isFreshCompletion && skipDetail === undefined && run.pipeline === "synthesize" ? (
          <p className="mt-0.5 text-[11.5px] leading-snug text-[color:var(--muted-fg,#86868b)]">
            Fresh synthesis — new findings written.
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ── Helpers ──

function formatAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const dMs = Date.now() - t;
  const mins = Math.round(dMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(secs < 10 ? 1 : 0)}s`;
  const mins = secs / 60;
  if (mins < 60) return `${mins.toFixed(mins < 10 ? 1 : 0)}m`;
  const hrs = mins / 60;
  return `${hrs.toFixed(1)}h`;
}
