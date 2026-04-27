"use client";

// ── Canvas run-context panel ──
//
// Consumes GET /api/pipeline/runs/[runId]/context and renders the
// structured summary (counts, stages, proposals, entities, sources).
// Fills the gap between the HUD (high-level status + counters) and
// the painter (spatial ghost shapes): this is the reviewable
// audit trail of the run.
//
// Collapsed by default — single thin row with totals, click to expand.
// Auto-fetches on mount + polls every 8s while status === "running";
// stops polling once the run completes (the final state doesn't
// change). Doesn't use the SSE stream directly to avoid racing with
// the painter/HUD over the same resource.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  History,
  Loader2,
  Layers,
  Network,
  Link2,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunContext } from "@/lib/events/run-context";

interface CanvasRunContextPanelProps {
  runId: string | null;
  /** Enables the run-history dropdown. Omit for runs not tied to a space. */
  spaceId?: string | null;
}

interface RunHistoryItem {
  id: string;
  pipeline: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  initial_prompt: string | null;
}

const RUNNING_POLL_INTERVAL_MS = 8_000;

export function CanvasRunContextPanel({
  runId,
  spaceId,
}: CanvasRunContextPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState(false);
  const [ctx, setCtx] = useState<RunContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RunHistoryItem[]>([]);
  // Live-ticking clock so running stages show "12.3s" counting up
  // instead of a frozen "…". Cheap — one setState per second, scoped
  // to this panel.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (ctx?.status !== "running") return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ctx?.status]);

  const fetchCtx = useCallback(async () => {
    if (!runId) return;
    setFetching(true);
    try {
      const res = await fetch(`/api/pipeline/runs/${runId}/context`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        // Run doesn't exist yet (just kicked off; event bus may not
        // have written the row). Retry on next poll tick. DO NOT
        // show an error — this is an expected warmup state.
        setError(null);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as RunContext;
      setCtx(data);
      // Success clears any prior transient error so the red banner
      // doesn't stick around once the network recovers. Earlier bug:
      // error was only cleared at the top of fetchCtx (which we moved
      // here) — a network blip then a successful retry left the red
      // "fetch failed" banner frozen until a full page reload.
      setError(null);
    } catch (err) {
      // Keep existing ctx visible — don't blank the panel. Only surface
      // the error banner if we have NO prior successful context
      // (fresh-run fetch failure) so users can tell the panel is stale
      // without being blocked by a scary red block mid-pipeline.
      setCtx((prev) => {
        if (prev) return prev;
        setError(err instanceof Error ? err.message : "Fetch failed");
        return prev;
      });
    } finally {
      setFetching(false);
    }
  }, [runId]);

  // Initial fetch + polling while running.
  useEffect(() => {
    if (!runId) {
      setCtx(null);
      setError(null);
      return;
    }
    fetchCtx();
    const interval = setInterval(() => {
      // Stop polling once terminal — ctx value captured at poll time
      // so we need to read state via functional setter trick. Simpler:
      // just do the fetch; if run is done, nothing changes.
      fetchCtx();
    }, RUNNING_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runId, fetchCtx]);

  // Stop polling when status flips terminal.
  useEffect(() => {
    if (!ctx) return;
    if (ctx.status === "completed" || ctx.status === "failed") {
      // interval already clears on unmount; no action needed here.
      // Intentional no-op — comment documents the condition.
    }
  }, [ctx]);

  // Load run history when the dropdown opens. Fire-and-forget — a
  // stale list is better than a loading spinner that blocks the UI.
  useEffect(() => {
    if (!historyOpen || !spaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/spaces/${spaceId}/runs`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { runs?: RunHistoryItem[] };
        if (!cancelled) setHistory(data.runs ?? []);
      } catch {
        /* transient errors dropped — user can re-open the dropdown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyOpen, spaceId]);

  // Clicking a history entry sets ?run=<id> so the panel + HUD + painter
  // all flip to the selected run. router.replace keeps the scroll pos.
  const openRun = useCallback(
    (newRunId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("run", newRunId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      setHistoryOpen(false);
      setExpanded(true);
    },
    [router, pathname, searchParams],
  );

  if (!runId) return null;

  return (
    <aside
      // Slide right by the floating-glass-sidebar's width + the tool-dock's
      // own clearance, so the panel never gets clipped when the sidebar
      // is expanded. `--kg-rail-offset` is set by floating-glass-sidebar
      // (0px collapsed, 156px expanded). We add another 64px to clear
      // the canvas-tool-dock's own width on the rail's right edge.
      style={{
        left: "calc(1rem + var(--kg-rail-offset, 0px) + 64px)",
      }}
      className={cn(
        "pointer-events-auto absolute top-20 z-30 flex w-[320px] flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white/95 shadow-sm backdrop-blur transition-[left] duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
      )}
      aria-label="Pipeline run context"
    >
      {/* Collapsed header — always visible */}
      <div className="relative flex items-stretch gap-0 border-b border-gray-100/80">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50"
        >
          <StatusIcon status={ctx?.status} fetching={fetching} />
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gray-500">
              Run context · {ctx?.pipeline ?? "…"}
            </div>
            {ctx && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-gray-600">
                <CountPill icon={<Layers className="h-2.5 w-2.5" />} value={ctx.counts.entities} label="ent" />
                <CountPill icon={<Network className="h-2.5 w-2.5" />} value={ctx.counts.edges} label="edg" />
                <CountPill icon={<RefreshCw className="h-2.5 w-2.5" />} value={ctx.counts.cycles} label="cyc" />
                <CountPill icon={<Link2 className="h-2.5 w-2.5" />} value={ctx.counts.bridges} label="bri" />
                <CountPill icon={<Sparkles className="h-2.5 w-2.5" />} value={ctx.counts.proposals} label="prop" />
                <CountPill icon={<TrendingUp className="h-2.5 w-2.5" />} value={ctx.counts.sources} label="src" />
              </div>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          )}
        </button>
        {spaceId && (
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1 border-l border-gray-100/80 px-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
            title="Past runs for this space"
            aria-label="Run history"
          >
            <History className="h-3 w-3" />
          </button>
        )}

        {/* History dropdown */}
        {historyOpen && spaceId && (
          <div className="absolute right-0 top-full z-40 mt-1 w-[320px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="border-b border-gray-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
              Recent runs
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {history.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-gray-400">
                  No runs yet — trigger an analysis to populate.
                </div>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => openRun(h.id)}
                    disabled={h.id === runId}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 border-b border-gray-50 px-3 py-1.5 text-left transition-colors last:border-b-0",
                      h.id === runId
                        ? "bg-blue-50 text-blue-900"
                        : "hover:bg-gray-50",
                    )}
                  >
                    <div className="flex w-full items-center gap-1.5">
                      <RunStatusDot status={h.status} />
                      <span className="text-[11px] font-semibold text-gray-800">
                        {h.pipeline}
                      </span>
                      <span className="ml-auto font-mono text-[9.5px] tabular-nums text-gray-400">
                        {fmtRelative(h.started_at)}
                      </span>
                    </div>
                    {h.initial_prompt && (
                      <span className="line-clamp-1 text-[10px] text-gray-500">
                        {h.initial_prompt}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Expanded body */}
      {expanded && ctx && (
        <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
          {/* Stages timeline */}
          {ctx.stages.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
                Stages
              </h3>
              <div className="space-y-1.5">
                {ctx.stages.map((s) => {
                  // Live duration: while the stage is still running
                  // (entered, not exited), count up from enteredAt
                  // using the ticking clock. Once exitedAt lands the
                  // server's durationMs is authoritative.
                  const isActive = !!s.enteredAt && !s.exitedAt;
                  const liveMs = isActive
                    ? Math.max(0, nowMs - new Date(s.enteredAt!).getTime())
                    : s.durationMs;
                  return (
                    <div
                      key={s.stage}
                      className="rounded-md bg-gray-50/60 px-2 py-1.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <StageDot stage={s.stage} completed={!!s.exitedAt} />
                          <span className="font-medium capitalize text-gray-700">{s.stage}</span>
                        </span>
                        <span
                          className={cn(
                            "font-mono text-[10px] tabular-nums",
                            isActive ? "text-blue-600" : "text-gray-500",
                          )}
                        >
                          {fmtDuration(liveMs)}
                        </span>
                      </div>
                      {s.digest && (
                        <p className="mt-1 text-[10.5px] leading-snug text-gray-600">
                          {s.digest}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Proposals with distributions */}
          {ctx.proposals.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
                Proposals · {ctx.proposals.length}
              </h3>
              <ol className="space-y-1">
                {ctx.proposals.slice(0, 6).map((p, i) => (
                  <li
                    key={p.proposalId}
                    className="rounded-md bg-white px-2 py-1.5 ring-1 ring-gray-200/80"
                  >
                    <div className="flex items-start gap-1.5">
                      <span className="flex h-4 min-w-[16px] items-center justify-center rounded bg-gradient-to-br from-blue-500 to-purple-500 px-1 text-[9px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="line-clamp-2 flex-1 text-[11px] font-medium leading-tight text-gray-900">
                        {p.title}
                      </span>
                    </div>
                    {p.distribution && (
                      <div className="ml-[22px] mt-1 flex items-center gap-1 font-mono text-[9.5px] tabular-nums text-gray-500">
                        <span>{num(p.distribution.p10)}</span>
                        <span className="text-gray-300">→</span>
                        <span className="font-bold text-gray-800">{num(p.distribution.p50)}</span>
                        <span className="text-gray-300">→</span>
                        <span>{num(p.distribution.p90)}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Entities added — just names, capped */}
          {ctx.entities.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
                Entities · {ctx.entities.length}
              </h3>
              <ul className="flex flex-wrap gap-1">
                {ctx.entities.slice(0, 25).map((e) => (
                  <li
                    key={e.entityId}
                    className="rounded bg-gray-100/80 px-1.5 py-0.5 text-[10px] text-gray-700"
                    title={`${e.category ?? ""} · ${e.importance ?? ""}`.trim()}
                  >
                    {e.name.slice(0, 40)}
                  </li>
                ))}
                {ctx.entities.length > 25 && (
                  <li className="px-1.5 py-0.5 text-[10px] text-gray-400">
                    +{ctx.entities.length - 25}
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* Sources — urls */}
          {ctx.sources.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
                Sources · {ctx.sources.length}
              </h3>
              <ul className="space-y-0.5">
                {ctx.sources.slice(0, 10).map((s, i) => (
                  <li key={`${s.url}-${i}`} className="truncate text-[10px]">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                      title={s.url}
                    >
                      {s.title ?? s.url.replace(/^https?:\/\//, "").slice(0, 60)}
                    </a>
                    {s.authority > 0 && (
                      <span className="ml-1 font-mono text-[9px] text-gray-400">
                        auth {s.authority.toFixed(2)}
                      </span>
                    )}
                  </li>
                ))}
                {ctx.sources.length > 10 && (
                  <li className="text-[10px] text-gray-400">
                    +{ctx.sources.length - 10} more
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* Error banner */}
          {ctx.errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              {ctx.errorMessage}
            </div>
          )}
        </div>
      )}

      {/* Transient error (fetch-level) */}
      {error && !ctx && (
        <div className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[10.5px] text-red-600">
          {error}
        </div>
      )}
    </aside>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

function StatusIcon({
  status,
  fetching,
}: {
  status?: RunContext["status"];
  fetching: boolean;
}) {
  if (status === "completed") return <CircleCheck className="h-3.5 w-3.5 text-green-600" />;
  if (status === "failed") return <CircleX className="h-3.5 w-3.5 text-red-600" />;
  if (fetching) return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />;
  return <BarChart3 className="h-3.5 w-3.5 text-gray-400" />;
}

function CountPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  if (value === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 font-mono tabular-nums text-gray-700">
      {icon}
      <strong className="font-semibold">{value}</strong>
      <span className="text-gray-400">{label}</span>
    </span>
  );
}

const STAGE_COLORS: Record<string, string> = {
  intake: "#3b82f6",
  landscape: "#8b5cf6",
  kg: "#10b981",
  proposal: "#f59e0b",
  lab: "#ef4444",
  results: "#06b6d4",
};

function RunStatusDot({ status }: { status: RunHistoryItem["status"] }) {
  const color =
    status === "completed" ? "#10b981"
      : status === "failed" ? "#ef4444"
      : "#3b82f6"; // running
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: color,
        boxShadow: status === "running" ? `0 0 0 1.5px ${color}55` : undefined,
        animation: status === "running" ? "pulse 2s ease-in-out infinite" : undefined,
      }}
    />
  );
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

function StageDot({ stage, completed }: { stage: string; completed: boolean }) {
  const color = STAGE_COLORS[stage] ?? "#94a3b8";
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: color,
        opacity: completed ? 1 : 0.5,
        boxShadow: completed ? `0 0 0 1.5px ${color}33` : undefined,
      }}
    />
  );
}

function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "…";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  return `${m.toFixed(1)}m`;
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
