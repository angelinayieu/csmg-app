"use client";

// ── TrajectoryPanel ──────────────────────────────────────────────────
//
// Phase 1 trajectory-engine UI. Picks a target metric + an
// intervention entity + a horizon; POSTs to /api/trajectory/project;
// renders the resulting per-week confidence-banded trajectory.
//
// Reads available entities from useSpaceData so the dropdowns are
// always in sync with the current KG. Defaults the target to the
// "Composite" / outcome layer when present (for cognitive-template
// spaces that's the cognitive_performance node), else falls back to
// the first entity in the space.
//
// Self-contained: every state lives in this component, the API call
// happens on submit, the chart is the response. No new context, no
// new global state. When the user navigates away the trajectory_run
// row stays in prediction_ledger so other surfaces (TwinCalibrationPanel,
// dashboard sparklines) pick it up.

import { useEffect, useMemo, useState } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import {
  MonteCarloTrajectoryChart,
  type WeeklyEntry,
} from "./monte-carlo-trajectory-chart";
import { TrajectoryGapChips } from "./trajectory-gap-chips";
import type { TrajectoryGap } from "./types";
import type { Entity } from "@/types";

interface ProjectResponse {
  ok: boolean;
  predictionId: string;
  trajectory: WeeklyEntry[];
  /** Counterfactual baseline trajectory — same subgraph + same seed
   *  but no perturbation. Present only when an intervention was set. */
  baselineTrajectory: WeeklyEntry[] | null;
  targetDistribution:
    | { p10: number; p50: number; p90: number; mean: number; stddev: number }
    | null;
  baselineDistribution:
    | { p10: number; p50: number; p90: number; mean: number; stddev: number }
    | null;
  /** p50 delta of the variant vs baseline at the horizon. Null when
   *  no intervention was set. */
  lift: { absolute: number; pct: number; significant: boolean } | null;
  nodeCount: number;
  edgeCount: number;
  gateDecisions: Array<{
    sourceId: string;
    targetId: string;
    gate: number;
    source: string;
    certainty: number;
    conditionText: string | null;
  }>;
  basisEdgeIds: string[];
  /** Gaps in the basis subgraph that are widening the bands or
   *  weakening structural fidelity. Sorted by severity desc. */
  gaps: TrajectoryGap[];
}

interface ErrorResponse {
  error: string;
  code?: string;
}

const DEFAULT_HORIZON = 6;
const DEFAULT_MAGNITUDE = 0.5;

export function TrajectoryPanel() {
  const { space, entities, activeGoal } = useSpaceData();
  const spaceId = space?.id;

  // Default target preference order:
  //  1. Active goal's target entity (if the goal has one wired)
  //  2. First entity flagged is_master_bottleneck (the system's choke point)
  //  3. First entity at the highest layer ordinal (usually "Composite")
  //  4. First entity in the list (failsafe)
  const sortedEntities = useMemo(() => {
    return ((entities ?? []) as Entity[]).slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [entities]);

  const defaultTargetId = useMemo(() => {
    const ents = (entities ?? []) as Entity[];
    if (ents.length === 0) return "";
    // Try to use the goal's primary outcome entity if the goal points
    // to one. ImprovementGoal doesn't have a hard FK to entity.entity_id,
    // but if the goal title overlaps with an entity name we use that.
    if (activeGoal?.title) {
      const goalNorm = activeGoal.title.toLowerCase();
      const hit = ents.find((e) => goalNorm.includes(e.name.toLowerCase().slice(0, 16)));
      if (hit) return hit.entity_id;
    }
    const bottleneck = ents.find((e) => e.is_master_bottleneck);
    if (bottleneck) return bottleneck.entity_id;
    const fundamental = ents.find((e) => e.importance === "fundamental");
    if (fundamental) return fundamental.entity_id;
    return ents[0]?.entity_id ?? "";
  }, [entities, activeGoal]);

  const [targetEntityId, setTargetEntityId] = useState<string>("");
  const [interventionEntityId, setInterventionEntityId] = useState<string>("");
  const [magnitude, setMagnitude] = useState<number>(DEFAULT_MAGNITUDE);
  const [horizonWeeks, setHorizonWeeks] = useState<number>(DEFAULT_HORIZON);

  // Sync defaults when entities load.
  useEffect(() => {
    if (!targetEntityId && defaultTargetId) {
      setTargetEntityId(defaultTargetId);
    }
  }, [defaultTargetId, targetEntityId]);

  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<ProjectResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Build a nodeId → name lookup for the chart's labels. The MC
  // engine uses entity UUIDs as node ids; we look up names from the
  // entities list keyed by id.
  const nodeNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of (entities ?? []) as Entity[]) {
      map[e.id] = e.name;
      // also map display id (entity_id) so the panel works for either
      map[e.entity_id] = e.name;
    }
    return map;
  }, [entities]);

  const targetUuid = useMemo(() => {
    const e = (entities ?? []).find(
      (en: Entity) => en.entity_id === targetEntityId,
    ) as Entity | undefined;
    return e?.id ?? null;
  }, [entities, targetEntityId]);

  async function runProjection() {
    if (!spaceId || !targetEntityId) return;
    setRunning(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/trajectory/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          targetEntityId,
          interventionEntityId: interventionEntityId || null,
          interventionMagnitude: magnitude,
          horizonWeeks,
          iterations: 500,
          depthHops: 3,
        }),
      });
      const json = (await res.json()) as ProjectResponse | ErrorResponse;
      if (!res.ok || !("ok" in json) || !json.ok) {
        setErrorMsg("error" in json ? json.error : `HTTP ${res.status}`);
        setResponse(null);
        return;
      }
      setResponse(json);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  if (!spaceId) return null;
  if (!entities || entities.length === 0) {
    return (
      <Shell>
        <Header />
        <div className="px-4 pb-4 text-[12px] text-[color:var(--muted-fg,#86868b)]">
          No entities in this space yet. Run decompose first.
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header
        nodeCount={response?.nodeCount}
        edgeCount={response?.edgeCount}
        targetSummary={response?.targetDistribution}
        lift={response?.lift ?? null}
      />

      <div className="grid grid-cols-1 gap-4 px-4 pb-4 lg:grid-cols-[260px_1fr]">
        {/* Controls */}
        <div className="flex flex-col gap-3 rounded-xl border border-white/40 bg-white/40 p-3">
          <Field label="Target metric">
            <select
              value={targetEntityId}
              onChange={(e) => setTargetEntityId(e.target.value)}
              className="w-full rounded-md border border-black/10 bg-white px-2 py-1 text-[12px]"
            >
              {sortedEntities.map((e) => (
                <option key={e.entity_id} value={e.entity_id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Intervention"
            hint="Optional — leave blank to project the prior trajectory."
          >
            <select
              value={interventionEntityId}
              onChange={(e) => setInterventionEntityId(e.target.value)}
              className="w-full rounded-md border border-black/10 bg-white px-2 py-1 text-[12px]"
            >
              <option value="">— No intervention —</option>
              {sortedEntities.map((e) => (
                <option
                  key={e.entity_id}
                  value={e.entity_id}
                  disabled={e.entity_id === targetEntityId}
                >
                  {e.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Magnitude · ${magnitude.toFixed(2)}`}>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={magnitude}
              onChange={(e) => setMagnitude(parseFloat(e.target.value))}
              className="w-full"
              disabled={!interventionEntityId}
            />
          </Field>

          <Field label={`Horizon · ${horizonWeeks} week${horizonWeeks === 1 ? "" : "s"}`}>
            <input
              type="range"
              min={1}
              max={26}
              step={1}
              value={horizonWeeks}
              onChange={(e) => setHorizonWeeks(parseInt(e.target.value, 10))}
              className="w-full"
            />
          </Field>

          <button
            type="button"
            onClick={runProjection}
            disabled={running || !targetEntityId}
            className="mt-1 w-full rounded-md bg-[color:var(--fg,#1d1d1f)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-opacity disabled:opacity-50"
          >
            {running ? "Running Monte Carlo…" : response ? "Re-run" : "Project trajectory"}
          </button>

          {errorMsg ? (
            <div className="rounded-md border border-red-200 bg-red-50/60 px-2 py-1.5 text-[11px] text-red-700">
              {errorMsg}
            </div>
          ) : null}

          {response ? (
            <div className="mt-1 rounded-md border border-white/50 bg-white/30 px-2 py-1.5 text-[10px] leading-relaxed text-[color:var(--muted-fg,#6b7280)]">
              <div>
                <span className="font-semibold">Subgraph:</span>{" "}
                {response.nodeCount} entities · {response.edgeCount} edges
              </div>
              <div>
                <span className="font-semibold">Basis edges:</span>{" "}
                {response.basisEdgeIds.length}
              </div>
              {response.gateDecisions.length > 0 ? (
                <div>
                  <span className="font-semibold">Conditional edges:</span>{" "}
                  {response.gateDecisions.length}
                </div>
              ) : null}
              <div className="opacity-70">id: {response.predictionId.slice(0, 8)}…</div>
            </div>
          ) : null}
        </div>

        {/* Chart + gaps */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-white/40 bg-white/40 p-2">
            {response && targetUuid ? (
              <MonteCarloTrajectoryChart
                trajectory={response.trajectory}
                baselineTrajectory={response.baselineTrajectory}
                targetNodeId={targetUuid}
                nodeNames={nodeNames}
                interventionWeek={interventionEntityId ? 1 : null}
                interventionLabel={interventionEntityId ? "intervention" : null}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded-xl text-[12px] leading-relaxed text-[color:var(--muted-fg,#86868b)]"
                style={{ minHeight: 280 }}
              >
                {running
                  ? "Running Monte Carlo over the upstream subgraph…"
                  : "Pick a target metric (and optional intervention) and click Project trajectory."}
              </div>
            )}
          </div>

          {/* Gap chips — surface the structural reasons the bands are
              wide. Click → Phase 2 dispatch (today this is a stub
              that logs which agent would be invoked). */}
          {response && response.gaps && response.gaps.length > 0 ? (
            <TrajectoryGapChips
              gaps={response.gaps}
              onFillGap={(gap) => {
                // Phase 2 will route to research-rounds / extract-temporal /
                // effect-size extraction. For now log the intended action so
                // the wire-up is visible end-to-end during development.
                console.log("[trajectory] fill gap →", {
                  edgeId: gap.edgeId,
                  kind: gap.kind,
                  remediation: gap.remediation,
                  source: gap.sourceName,
                  target: gap.targetName,
                });
              }}
            />
          ) : response ? (
            <TrajectoryGapChips gaps={[]} />
          ) : null}
        </div>
      </div>
    </Shell>
  );
}

// ── Shell + Header ───────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="relative overflow-hidden rounded-[18px] border border-white/60 bg-gradient-to-br from-white/85 via-white/70 to-white/55 shadow-[0_4px_14px_rgba(15,23,42,0.04)]"
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
      aria-label="Trajectory engine"
    >
      {children}
    </section>
  );
}

function Header({
  nodeCount,
  edgeCount,
  targetSummary,
  lift,
}: {
  nodeCount?: number;
  edgeCount?: number;
  targetSummary?: ProjectResponse["targetDistribution"];
  lift?: ProjectResponse["lift"] | null;
}) {
  const hasResult = typeof nodeCount === "number" && nodeCount > 0;
  // Lift badge color: green if positive + significant, red if negative
  // + significant, amber if directional but inside the noise floor.
  const liftColor = lift
    ? lift.significant
      ? lift.absolute >= 0
        ? "#30D158"
        : "#FF453A"
      : "#FF9F0A"
    : null;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/40 px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className="h-[6px] w-[6px] rounded-full"
          style={{
            background: hasResult ? "#0A84FF" : "#86868B",
            boxShadow: hasResult ? "0 0 10px #0A84FFAA" : undefined,
          }}
        />
        <div>
          <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
            Trajectory Engine
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-[color:var(--fg,#1d1d1f)]">
            {hasResult
              ? `Forward projection over ${nodeCount} entities`
              : "Forward projection from the KG (Monte Carlo)"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Lift vs baseline — appears only when intervention was set */}
        {lift && liftColor ? (
          <div
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
            style={{
              color: liftColor,
              borderColor: `${liftColor}55`,
              background: `${liftColor}12`,
            }}
            title={[
              `Δ p50 vs baseline at horizon: ${formatTarget(lift.absolute)} (${formatPct(lift.pct)})`,
              lift.significant
                ? "Δ exceeds the noise floor (max stddev) — directionally meaningful"
                : "Δ inside the noise floor — within sampling variance",
            ].join("\n")}
          >
            <span>Δ</span>
            <span>
              {lift.absolute >= 0 ? "+" : ""}
              {formatTarget(lift.absolute)}
            </span>
            <span style={{ opacity: 0.7 }}>
              ({lift.pct >= 0 ? "+" : ""}
              {formatPct(lift.pct)})
            </span>
            {!lift.significant ? (
              <span
                className="rounded-full bg-white/40 px-1 text-[8px] font-semibold uppercase tracking-wide"
                style={{ color: liftColor }}
              >
                noise
              </span>
            ) : null}
          </div>
        ) : null}

        {targetSummary ? (
          <div
            className="inline-flex items-center gap-1.5 rounded-full border border-[#0A84FF55] bg-[#0A84FF12] px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-[#0A84FF]"
            title={`p10 ${targetSummary.p10.toFixed(2)} · p50 ${targetSummary.p50.toFixed(2)} · p90 ${targetSummary.p90.toFixed(2)} · σ ${targetSummary.stddev.toFixed(2)}`}
          >
            p50 {formatTarget(targetSummary.p50)} · σ {formatTarget(targetSummary.stddev)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#6b7280)]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[10px] text-[color:var(--muted-fg,#86868b)]">{hint}</span>
      ) : null}
    </label>
  );
}

function formatTarget(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const pct = v * 100;
  if (Math.abs(pct) >= 100) return `${pct.toFixed(0)}%`;
  if (Math.abs(pct) >= 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}
