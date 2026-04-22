"use client";

// ── Intelligence Dashboard ──
// /app/space/[id]/intelligence
//
// The showcase surface for the Reflexive Loop system. Shows everything the
// system is doing on the user's behalf, in one coherent view:
//
//   [Header with live status + controls]
//   [4 big metrics: coverage / depth / calibration / questions]
//   [Two-column main content:
//      Left:  Proposed Edges Inbox (calibration loop)
//             Activity Feed (prospector pulse)
//      Right: Open Questions Board (intent routing)
//             Coverage Landscape Panel (introspection)
//   ]

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Radar,
  Loader2,
  RefreshCw,
  Activity,
  Inbox,
  MessageCircleQuestion,
  Target,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpaceData } from "@/contexts/space-data-context";
import { ReflexiveLoopStats } from "@/components/intelligence/reflexive-loop-stats";
import { ProposedEdgesInbox } from "@/components/intelligence/proposed-edges-inbox";
import { OpenQuestionsBoard } from "@/components/intelligence/open-questions-board";
import { ActivityFeed } from "@/components/intelligence/activity-feed";
import { CoverageLandscapePanel } from "@/components/graph/coverage-landscape-panel";
import type { IntelligenceOverview } from "@/app/api/spaces/[id]/intelligence-overview/route";
import type { CoverageLandscape } from "@/app/api/spaces/[id]/coverage-landscape/route";

export function ReflexiveDashboardView() {
  const ctx = useSpaceData();
  const spaceId = ctx.space.id;

  const [overview, setOverview] = useState<IntelligenceOverview | null>(null);
  const [landscape, setLandscape] = useState<CoverageLandscape | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Last Scan now delta — rendered as an auto-dismissing success strip so the
  // user sees what changed instead of having to compare numbers before/after.
  // One scan only examines ~20 pairs at a time; without this feedback the
  // dashboard looks unresponsive even on a successful run.
  const [lastScanDelta, setLastScanDelta] = useState<{
    pairs_examined: number;
    edges_proposed: number;
    duration_ms: number;
    entities_touched: number;
    message?: string | null;
  } | null>(null);
  useEffect(() => {
    if (!lastScanDelta) return;
    const id = window.setTimeout(() => setLastScanDelta(null), 8000);
    return () => window.clearTimeout(id);
  }, [lastScanDelta]);

  // Fetch both overview + landscape in parallel
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ovRes, lsRes] = await Promise.all([
        fetch(`/api/spaces/${spaceId}/intelligence-overview`),
        fetch(`/api/spaces/${spaceId}/coverage-landscape`),
      ]);
      if (ovRes.ok) {
        const data = (await ovRes.json()) as IntelligenceOverview;
        setOverview(data);
      }
      if (lsRes.ok) {
        const data = (await lsRes.json()) as CoverageLandscape;
        setLandscape(data);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleScanNow = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/prospect-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          entitiesToExamine: 8,
          pairsPerRun: 20,
        }),
      });
      if (res.ok) {
        // Capture summary so the delta banner can show what this scan added.
        // Response shape: { summary: { pairs_examined, edges_proposed,
        //   entities_touched: string[], duration_ms }, edges?, message? }
        const data = (await res.json()) as {
          summary?: {
            pairs_examined?: number;
            edges_proposed?: number;
            entities_touched?: string[];
            duration_ms?: number;
          };
          message?: string | null;
        };
        const s = data.summary ?? {};
        setLastScanDelta({
          pairs_examined: s.pairs_examined ?? 0,
          edges_proposed: s.edges_proposed ?? 0,
          entities_touched: (s.entities_touched ?? []).length,
          duration_ms: s.duration_ms ?? 0,
          message: data.message ?? null,
        });
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Scan failed (HTTP ${res.status})`);
      }
      // Always re-fetch the aggregates so the numbers actually move on success.
      await fetchAll();
    } catch (err) {
      setError((err as Error).message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [scanning, spaceId, fetchAll]);

  // Compute total possible pairs for the coverage metric narrative
  const totalEntities = ctx.entities.length;
  const totalPossiblePairs = (totalEntities * (totalEntities - 1)) / 2;

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* ── Breadcrumb + title strip ── */}
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <Link
          href={`/app/space/${spaceId}`}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-3 w-3" />
          {ctx.space.name}
        </Link>
        <span className="text-[11px] text-gray-300">/</span>
        <div className="flex items-center gap-1.5">
          <Radar className="h-4 w-4 text-interaxis-600" />
          <h1 className="text-sm font-bold text-gray-900">Intelligence</h1>
          <span className="rounded-full bg-interaxis-50 px-2 py-0.5 text-[10px] font-semibold text-interaxis-700">
            Reflexive loop
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={fetchAll}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            title="Refresh all intelligence data"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={handleScanNow}
            disabled={scanning}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-all",
              scanning
                ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                : "border-interaxis-300 bg-interaxis-600 text-white hover:bg-interaxis-700",
            )}
            title="Run the connection prospector now"
          >
            {scanning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Zap className="h-3 w-3" />
            )}
            {scanning ? "Scanning…" : "Scan now"}
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700">
              {error}
            </div>
          )}

          {/* Scan now delta — auto-dismisses after 8s. Makes each prospector
              run legible: "examined N pairs, proposed M edges in X seconds".
              Without this the dashboard looks unresponsive because a single
              run only moves the coverage bar by ~20 / total-possible-pairs. */}
          {lastScanDelta && (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12px] text-emerald-800 shadow-sm">
              <Zap className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                {lastScanDelta.message ? (
                  <span className="font-medium">{lastScanDelta.message}</span>
                ) : lastScanDelta.pairs_examined === 0 ? (
                  <span className="font-medium">
                    Nothing new to examine — all candidate pairs have been
                    recently checked. Try again later or add entities.
                  </span>
                ) : (
                  <span className="font-medium">
                    Examined <strong className="tabular-nums">{lastScanDelta.pairs_examined}</strong>{" "}
                    {lastScanDelta.pairs_examined === 1 ? "pair" : "pairs"} across{" "}
                    <strong className="tabular-nums">{lastScanDelta.entities_touched}</strong>{" "}
                    {lastScanDelta.entities_touched === 1 ? "entity" : "entities"}
                    {lastScanDelta.edges_proposed > 0 && (
                      <>
                        {" "}· proposed{" "}
                        <strong className="tabular-nums text-emerald-900">
                          {lastScanDelta.edges_proposed}
                        </strong>{" "}
                        new {lastScanDelta.edges_proposed === 1 ? "edge" : "edges"}
                      </>
                    )}
                    {" "}· {(lastScanDelta.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <button
                onClick={() => setLastScanDelta(null)}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                aria-label="Dismiss"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading && !overview && (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-gray-400" />
              <p className="text-[12px] text-gray-500">Loading intelligence overview…</p>
            </div>
          )}

          {overview && (
            <>
              {/* ── 4-metric storytelling strip ── */}
              <ReflexiveLoopStats
                overview={overview}
                coverageSummary={landscape?.summary ?? null}
                totalPossiblePairs={totalPossiblePairs}
              />

              {/* ── Velocity strip ── */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-3.5 w-3.5 text-emerald-600" />
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-700">
                    Velocity
                  </h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <VelocityStat
                    label="Last 24h"
                    value={overview.velocity.checks_last_24h}
                    suffix="checks"
                  />
                  <VelocityStat
                    label="Last 7 days"
                    value={overview.velocity.checks_last_7d}
                    suffix="checks"
                  />
                  <VelocityStat
                    label="Edges found"
                    value={overview.velocity.edges_found_last_7d}
                    suffix="in 7d"
                    accent="emerald"
                  />
                  <VelocityStat
                    label="Proposals pending"
                    value={overview.prospector_proposed_edges}
                    suffix="awaiting review"
                    accent={overview.prospector_proposed_edges > 0 ? "amber" : "neutral"}
                  />
                </div>
              </div>

              {/* ── 2-column main content ── */}
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                {/* Left column */}
                <div className="space-y-6">
                  {/* Proposed Edges Inbox */}
                  <Panel
                    icon={<Inbox className="h-4 w-4 text-purple-600" />}
                    title="Proposed edges · Review queue"
                    subtitle="Each verdict trains the calibration loop. Per-dimension acceptance rate updates live."
                    count={overview.proposed_edges_queue.length}
                    accent={overview.proposed_edges_queue.length > 0 ? "purple" : "neutral"}
                  >
                    <ProposedEdgesInbox
                      spaceId={spaceId}
                      queue={overview.proposed_edges_queue}
                      onVerdictRecorded={fetchAll}
                    />
                  </Panel>

                  {/* Activity Feed */}
                  <Panel
                    icon={<Activity className="h-4 w-4 text-gray-600" />}
                    title="Prospector activity"
                    subtitle="Every pair the system has recently examined, with reasoning"
                    count={overview.recent_activity.length}
                    accent="neutral"
                  >
                    <ActivityFeed entries={overview.recent_activity} limit={20} />
                  </Panel>
                </div>

                {/* Right column */}
                <div className="space-y-6">
                  {/* Open Questions */}
                  <Panel
                    icon={<MessageCircleQuestion className="h-4 w-4 text-blue-600" />}
                    title="Open questions · Intent routing"
                    subtitle="Entities with open questions jump to the front of the prospector queue"
                    count={overview.open_questions.length}
                    accent={overview.open_questions.length > 0 ? "blue" : "neutral"}
                  >
                    <OpenQuestionsBoard spaceId={spaceId} questions={overview.open_questions} />
                  </Panel>

                  {/* Coverage Landscape */}
                  <Panel
                    icon={<Target className="h-4 w-4 text-interaxis-600" />}
                    title="Coverage landscape"
                    subtitle="Dimensional blind spots, category-pair matrix, examination depth"
                    accent="interaxis"
                  >
                    <CoverageLandscapePanel spaceId={spaceId} />
                  </Panel>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───

function VelocityStat({
  label,
  value,
  suffix,
  accent = "neutral",
}: {
  label: string;
  value: number;
  suffix: string;
  accent?: "neutral" | "emerald" | "amber";
}) {
  const color =
    accent === "emerald" ? "text-emerald-600"
      : accent === "amber" ? "text-amber-600"
        : "text-gray-900";
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={cn("text-lg font-bold tabular-nums", color)}>{value}</span>
        <span className="text-[10px] text-gray-500">{suffix}</span>
      </div>
    </div>
  );
}

function Panel({
  icon,
  title,
  subtitle,
  count,
  accent = "neutral",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  count?: number;
  accent?: "neutral" | "interaxis" | "purple" | "blue" | "emerald" | "amber";
  children: React.ReactNode;
}) {
  const accentStyles: Record<typeof accent, string> = {
    neutral: "border-gray-200",
    interaxis: "border-interaxis-200",
    purple: "border-purple-200",
    blue: "border-blue-200",
    emerald: "border-emerald-200",
    amber: "border-amber-200",
  };
  const pillStyles: Record<typeof accent, string> = {
    neutral: "bg-gray-100 text-gray-700",
    interaxis: "bg-interaxis-100 text-interaxis-700",
    purple: "bg-purple-100 text-purple-700",
    blue: "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
  };
  return (
    <div className={cn("rounded-xl border bg-white p-5 shadow-sm", accentStyles[accent])}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          {count !== undefined && (
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", pillStyles[accent])}>
              {count}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
