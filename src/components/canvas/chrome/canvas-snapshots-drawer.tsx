"use client";

// ── Canvas snapshots drawer (R5 Phase A — minimum UI) ────────────────
//
// First user-visible surface for R5's snapshot primitive. Right-side
// drawer that:
//   - Lists captured snapshots for this space
//   - Has a "Capture now" button that hits POST /snapshots
//   - Lists scenarios per-snapshot with status chips
//   - Deep-links into a scenario detail view (not yet built) via the
//     onOpenScenario callback
//
// Intentionally minimal. The brief's full scenario shelf (Phase B) is
// a much richer UI — fork/diff/merge on the canvas, scenario editor
// with action composer, etc. This drawer is what lets users SEE the
// primitive exists before we build all that. Without any UI, Phase A
// sits as unreachable code.

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  GitBranch,
  Plus,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TwinSnapshotMeta, SnapshotReason } from "@/types/snapshot";
import type { ScenarioMeta } from "@/types/scenario";
import type {
  TwinDiagnosticsMeta,
  TwinQualityGrade,
} from "@/types/twin-diagnostics";

export interface CanvasSnapshotsDrawerProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** Called when the user clicks a scenario row — wires to the
   *  scenario detail panel in the host. */
  onOpenScenario?: (scenarioId: string) => void;
  /** Called when the user clicks "+ Scenario" on a snapshot row —
   *  wires to the scenario compose panel in the host. */
  onNewScenario?: (snapshotId: string) => void;
}

const REASON_LABEL: Record<SnapshotReason, string> = {
  user_request: "Captured",
  pre_strategy: "Pre-strategy",
  post_intervention: "Post-intervention",
  scheduled: "Scheduled",
  pipeline_checkpoint: "Pipeline",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  testing: "bg-blue-50 text-blue-700",
  applied: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  superseded: "bg-amber-50 text-amber-700",
};

// Grade → small-pill color. Matches the 5-step grade scale from
// validateTwinQuality; we don't invent new tiers here.
const GRADE_TONE: Record<TwinQualityGrade, string> = {
  excellent: "bg-emerald-100 text-emerald-800",
  good: "bg-emerald-50 text-emerald-700",
  fair: "bg-amber-50 text-amber-700",
  needs_attention: "bg-orange-50 text-orange-700",
  critical: "bg-rose-50 text-rose-700",
};

export function CanvasSnapshotsDrawer({
  open,
  onClose,
  spaceId,
  onOpenScenario,
  onNewScenario,
}: CanvasSnapshotsDrawerProps) {
  const [snapshots, setSnapshots] = useState<TwinSnapshotMeta[]>([]);
  const [scenariosBySnapshot, setScenariosBySnapshot] = useState<
    Record<string, ScenarioMeta[]>
  >({});
  // Latest diagnostics per snapshot (scalar meta only). Fetched in
  // parallel with the snapshot list — each GET is one DB row per
  // snapshot so ~N roundtrips. Fine for the <50 snapshot cap; if
  // performance becomes an issue, a batch endpoint is the right
  // follow-up.
  const [diagnosticsBySnapshot, setDiagnosticsBySnapshot] = useState<
    Record<string, TwinDiagnosticsMeta>
  >({});
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapRes, scenRes] = await Promise.all([
        fetch(`/api/spaces/${spaceId}/snapshots`, { cache: "no-store" }),
        fetch(`/api/spaces/${spaceId}/scenarios`, { cache: "no-store" }),
      ]);
      if (!snapRes.ok) throw new Error(`snapshots HTTP ${snapRes.status}`);
      if (!scenRes.ok) throw new Error(`scenarios HTTP ${scenRes.status}`);
      const snapJson = (await snapRes.json()) as {
        snapshots: TwinSnapshotMeta[];
      };
      const scenJson = (await scenRes.json()) as { scenarios: ScenarioMeta[] };
      const snapList = snapJson.snapshots ?? [];
      setSnapshots(snapList);
      const grouped: Record<string, ScenarioMeta[]> = {};
      for (const s of scenJson.scenarios ?? []) {
        const arr = grouped[s.parent_snapshot_id] ?? [];
        arr.push(s);
        grouped[s.parent_snapshot_id] = arr;
      }
      setScenariosBySnapshot(grouped);

      // Fetch diagnostics in parallel. Soft-fail per-snapshot so a
      // single missing row doesn't empty the whole drawer.
      const diagPairs = await Promise.all(
        snapList.map(async (s) => {
          try {
            const r = await fetch(
              `/api/spaces/${spaceId}/snapshots/${s.id}/diagnostics`,
              { cache: "no-store" },
            );
            if (!r.ok) return null;
            const j = (await r.json()) as {
              diagnostics: TwinDiagnosticsMeta | null;
            };
            return j.diagnostics ? ([s.id, j.diagnostics] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      const diagMap: Record<string, TwinDiagnosticsMeta> = {};
      for (const pair of diagPairs) {
        if (pair) diagMap[pair[0]] = pair[1];
      }
      setDiagnosticsBySnapshot(diagMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleCapture = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "user_request" }),
      });
      if (!res.ok) throw new Error(`capture HTTP ${res.status}`);
      // Re-load after a successful capture. When the hash was the same
      // as the latest existing snapshot, the endpoint returns
      // `created: false` — list is unchanged, but we still refresh to
      // surface the fact to the user via the refreshed timestamp.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "capture failed");
    } finally {
      setCapturing(false);
    }
  }, [spaceId, load]);

  if (!open) return null;

  return (
    <>
      <div
        className="pointer-events-auto fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Snapshots + scenarios"
        className="pointer-events-auto fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-gray-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-600">
              R5 · Phase A
            </div>
            <div className="mt-0.5 text-[14px] font-semibold text-gray-900">
              Snapshots & scenarios
            </div>
            <div className="mt-0.5 text-[11px] text-gray-500 leading-snug">
              Freeze the current KG so you can test interventions
              against a fixed baseline. Run MC on a snapshot + scenario
              to see the real before/after lift.
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Capture bar */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
          <button
            onClick={handleCapture}
            disabled={capturing}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Camera className="h-3 w-3" />
            {capturing ? "Capturing…" : "Capture snapshot"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
            title="Refresh"
          >
            <RefreshCw
              className={cn("h-3 w-3", loading && "animate-spin")}
            />
          </button>
          <div className="ml-auto text-[10.5px] text-gray-400">
            {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {error && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
              {error}
            </div>
          )}

          {!loading && snapshots.length === 0 && (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50/60 px-4 py-6 text-center text-[12px] text-gray-500">
              No snapshots yet. Click <span className="font-semibold">Capture snapshot</span>{" "}
              to freeze the current KG as a baseline you can test against.
            </div>
          )}

          <ol className="flex flex-col gap-2">
            {snapshots.map((s) => {
              const scenarios = scenariosBySnapshot[s.id] ?? [];
              const diag = diagnosticsBySnapshot[s.id] ?? null;
              return (
                <li
                  key={s.id}
                  className="rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600"
                      title="Snapshot"
                    >
                      <Camera className="h-3 w-3" />
                    </span>
                    <span className="text-[11.5px] font-semibold text-gray-900">
                      {REASON_LABEL[s.reason] ?? s.reason}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-gray-500">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(s.captured_at).toLocaleString()}
                    </span>
                    {onNewScenario && (
                      <button
                        onClick={() => onNewScenario(s.id)}
                        className="ml-auto flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 transition-colors hover:bg-purple-100"
                        title="Compose a scenario against this snapshot"
                      >
                        <Plus className="h-2.5 w-2.5" />
                        Scenario
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10.5px] text-gray-500">
                    <span className="font-mono tabular-nums">
                      {s.entity_count} ent · {s.edge_count} edges
                      {s.cycle_count > 0
                        ? ` · ${s.cycle_count} cycles`
                        : ""}
                    </span>
                    <span className="font-mono text-gray-300">
                      #{s.root_hash.slice(0, 8)}
                    </span>
                  </div>

                  {/* Diagnostics summary — only rendered when
                      twin_diagnostics has a row for this snapshot.
                      captureSnapshot auto-runs, so new snapshots get
                      this on first paint. Older snapshots without a
                      diagnostics row show nothing (the backend is
                      silent rather than pretending a missing report
                      is "good"). */}
                  {diag && (
                    <div
                      className="mt-2 flex items-center gap-2"
                      title={
                        diag.passed === false
                          ? `Quality ${diag.score ?? "?"}/100 — below passing threshold`
                          : `Quality ${diag.score ?? "?"}/100`
                      }
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          diag.grade
                            ? GRADE_TONE[diag.grade]
                            : "bg-gray-100 text-gray-700",
                        )}
                      >
                        {diag.passed ? (
                          <CheckCircle2 className="h-2.5 w-2.5" />
                        ) : (
                          <AlertTriangle className="h-2.5 w-2.5" />
                        )}
                        <span className="font-mono tabular-nums">
                          {diag.score ?? "—"}
                        </span>
                      </span>
                      {(diag.error_count > 0 ||
                        diag.warning_count > 0 ||
                        diag.info_count > 0) && (
                        <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
                          {diag.error_count > 0 && (
                            <span className="font-mono tabular-nums text-rose-600">
                              {diag.error_count} err
                            </span>
                          )}
                          {diag.warning_count > 0 && (
                            <span className="font-mono tabular-nums text-amber-600">
                              {diag.warning_count} warn
                            </span>
                          )}
                          {diag.info_count > 0 && (
                            <span className="font-mono tabular-nums text-gray-500">
                              {diag.info_count} info
                            </span>
                          )}
                        </span>
                      )}
                      {diag.calibration_status &&
                        diag.calibration_status !== "unknown" && (
                          <span
                            className="ml-auto flex items-center gap-1 text-[10px] text-gray-500"
                            title={
                              diag.calibration_score != null
                                ? `Calibration ${(diag.calibration_score * 100).toFixed(0)}%`
                                : undefined
                            }
                          >
                            <Activity className="h-2.5 w-2.5" />
                            {diag.calibration_status}
                          </span>
                        )}
                    </div>
                  )}

                  {scenarios.length > 0 && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <div className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
                        Scenarios ({scenarios.length})
                      </div>
                      <ol className="flex flex-col gap-1">
                        {scenarios.map((sc) => (
                          <li key={sc.id}>
                            <button
                              onClick={() => onOpenScenario?.(sc.id)}
                              className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-gray-50"
                            >
                              <GitBranch className="h-3 w-3 flex-shrink-0 text-gray-400 group-hover:text-gray-700" />
                              <span className="flex-1 truncate text-[11.5px] text-gray-800 group-hover:text-gray-900">
                                {sc.label}
                              </span>
                              <span
                                className={cn(
                                  "flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                                  STATUS_TONE[sc.status] ??
                                    "bg-gray-100 text-gray-700",
                                )}
                              >
                                {sc.status}
                              </span>
                              <span className="flex-shrink-0 font-mono text-[9.5px] text-gray-400 tabular-nums">
                                {sc.action_count} act
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {scenarios.length === 0 && (
                    <div className="mt-2 border-t border-gray-100 pt-2 text-[10.5px] text-gray-400">
                      No scenarios yet. Click{" "}
                      <span className="font-semibold text-purple-600">
                        + Scenario
                      </span>{" "}
                      above to compose one against this baseline.
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-4 py-2 text-[10.5px] leading-relaxed text-gray-500">
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            Simulate a scenario by{" "}
            <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[9.5px]">
              POST /scenarios/[id]/simulate
            </code>
          </span>
        </div>
      </aside>
    </>
  );
}
