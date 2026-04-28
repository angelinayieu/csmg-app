"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X,
  Sparkles,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Search,
  TrendingUp,
  TrendingDown,
  Zap,
  Dice5,
  History,
  Repeat,
  Shield,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";
import type { WhatIfResponse } from "@/lib/prompts/what-if";
import { SimulationModeBadge } from "./simulation-mode-badge";
import {
  SIMULATION_MODE_META,
  qualitativeBandFor,
  type SimulationMode,
} from "@/types/simulation-mode";
import type {
  MonteCarloResult,
  AffectedEntityStats,
} from "@/lib/pipeline/monte-carlo";
import type {
  BootstrapResult,
  BootstrapAffectedEntityStats,
} from "@/lib/pipeline/bootstrap-simulation";

/**
 * LLM-grounded What-If panel — opened from UniversalLabControlPanel's
 * "LLM scenario" button (or any Lab scope's equivalent).
 *
 * Flow:
 *   1. User picks a target entity (search by name) + direction + magnitude.
 *   2. We POST to /api/lab/what-if — the server walks the neighborhood
 *      subgraph and calls the LLM.
 *   3. Result renders inline: narrative + affected entities with effect
 *      direction + propagation paths + distribution + cautions.
 *
 * Impact-overlay callback lets the parent (Lab page) pulse the affected
 * entities in the 3D chamber. Call signature: onImpactOverlay(entityIds).
 * Pass null to clear.
 */

type Direction = "strengthen" | "weaken" | "remove";

interface WhatIfPanelProps {
  /** Entities the user can target. Universal Lab passes everything it
   *  knows about; space/entity Labs would pass their narrower slice. */
  entities: Array<Pick<Entity, "id" | "name" | "description" | "entity_category">>;
  onClose: () => void;
  onImpactOverlay?: (entityIds: string[] | null) => void;
  /** Subject phase — when present, every successful what-if / MC /
   *  bootstrap run POSTs to /api/subjects/[subjectId]/experiments
   *  with the live conditions snapshot. The append-only audit log
   *  is what powers the Subject detail page's experiment history.
   *  Soft-fails silently — log failures don't block the user from
   *  seeing the simulation result. */
  subjectId?: string | null;
  /** Current live conditions from the lab's SubjectStrip (lifted
   *  state). Frozen into the experiment row at log time so later
   *  slider edits don't rewrite history. */
  currentConditions?: Record<string, number>;
}

export function WhatIfPanel({
  entities,
  onClose,
  onImpactOverlay,
  subjectId,
  currentConditions,
}: WhatIfPanelProps) {
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("strengthen");
  const [magnitude, setMagnitude] = useState(0.5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Gap B — simulation mode picker. `narrative_walk` is always
   * available; `monte_carlo` is conditional on `mcPreflight.ok` which
   * we refresh whenever the target changes. When user selects monte_carlo
   * on a subgraph that doesn't support it, we show the reason inline.
   */
  const [mode, setMode] = useState<
    "narrative_walk" | "monte_carlo" | "bootstrap"
  >("narrative_walk");
  const [mcPreflight, setMcPreflight] = useState<{
    ok: boolean;
    reason?: string;
    numeric_edge_count: number;
    downstream_reachable_count: number;
  } | null>(null);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  // Bootstrap preflight runs alongside the Monte-Carlo one on target
  // change. Its gate is different (needs ≥ N historical observations
  // on a tracker fuzzy-matched to the target), so the preflight reply
  // includes the matched_tracker label we render on the tab for
  // traceability ("resampled from: North Star ARR").
  const [bsPreflight, setBsPreflight] = useState<{
    ok: boolean;
    reason?: string;
    historical_n: number;
    downstream_reachable_count: number;
  } | null>(null);
  const [bsMatchedTracker, setBsMatchedTracker] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [bsMatchedTrackerScore, setBsMatchedTrackerScore] = useState<
    number | null
  >(null);
  const [bsResult, setBsResult] = useState<BootstrapResult | null>(null);
  // Cross-space bridge counts live in panel state rather than on the
  // engine result types because the engines themselves stay pure — only
  // the route knows how many bridges it spliced in. Surfaced back
  // through the /api/lab/* response bodies and stashed here so the
  // result views can render the "3 bridges" pill.
  const [mcBridgeCount, setMcBridgeCount] = useState(0);
  const [bsBridgeCount, setBsBridgeCount] = useState(0);

  // Preflight fires whenever the user picks a new target — cheap check
  // so the Monte-Carlo tab can render `disabled` with a tooltip rather
  // than the user clicking through to an error.
  useEffect(() => {
    if (!targetId) {
      setMcPreflight(null);
      setBsPreflight(null);
      setBsMatchedTracker(null);
      setBsMatchedTrackerScore(null);
      return;
    }
    let cancelled = false;
    // Fire both preflights in parallel — they share no state and both
    // tab enablements should light up together rather than in a
    // visible cascade.
    (async () => {
      try {
        const [mcRes, bsRes] = await Promise.all([
          fetch("/api/lab/monte-carlo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              preflight: true,
              target_entity_id: targetId,
            }),
          }),
          fetch("/api/lab/bootstrap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              preflight: true,
              target_entity_id: targetId,
            }),
          }),
        ]);
        if (cancelled) return;
        if (mcRes.ok) {
          const body = (await mcRes.json()) as {
            preflight: {
              ok: boolean;
              reason?: string;
              numeric_edge_count: number;
              downstream_reachable_count: number;
            };
          };
          if (!cancelled) setMcPreflight(body.preflight);
        }
        if (bsRes.ok) {
          const body = (await bsRes.json()) as {
            preflight: {
              ok: boolean;
              reason?: string;
              historical_n: number;
              downstream_reachable_count: number;
            };
            matched_tracker: { id: string; label: string } | null;
            matched_tracker_score?: number | null;
          };
          if (!cancelled) {
            setBsPreflight(body.preflight);
            setBsMatchedTracker(body.matched_tracker);
            setBsMatchedTrackerScore(body.matched_tracker_score ?? null);
          }
        }
      } catch {
        /* non-fatal — the buttons stay disabled */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return entities.slice(0, 8);
    return entities
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.description ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [query, entities]);

  const targetEntity = useMemo(
    () => entities.find((e) => e.id === targetId) ?? null,
    [targetId, entities],
  );

  /** Subject experiment logging — POSTs to
   *  /api/subjects/[subjectId]/experiments after each successful
   *  what-if / MC / bootstrap run. Soft-fails — log failures don't
   *  block the user from seeing the simulation result. No-op when
   *  no subject is in scope. */
  async function logExperiment(opts: {
    run_kind: "what_if" | "monte_carlo" | "bootstrap";
    run_params: Record<string, unknown>;
    outcome_summary: Record<string, unknown>;
    outcome_distribution?: Record<string, unknown>;
  }) {
    if (!subjectId) return;
    try {
      await fetch(`/api/subjects/${subjectId}/experiments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_kind: opts.run_kind,
          conditions_at_run: currentConditions ?? {},
          run_params: opts.run_params,
          outcome_summary: opts.outcome_summary,
          outcome_distribution: opts.outcome_distribution ?? null,
        }),
      });
    } catch (err) {
      console.warn("[what-if-panel] experiment log failed:", err);
    }
  }

  async function run() {
    if (!targetId) return;
    setRunning(true);
    setError(null);
    // Note: we do NOT clear the other two modes' results. The
    // ModeComparisonStrip below uses last-run-per-mode to let the user
    // eyeball how the modes disagree — wiping on each run would kill
    // that, and users would never see the narrative↔MC↔bootstrap
    // contrast which is the whole point of the taxonomy.
    onImpactOverlay?.(null);
    try {
      if (mode === "monte_carlo") {
        setMcResult(null);
        const res = await fetch("/api/lab/monte-carlo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_entity_id: targetId,
            direction,
            magnitude,
          }),
        });
        const body = await res.json();
        if (res.status === 409 && body.error === "monte_carlo_unavailable") {
          // Graph doesn't support MC; surface the reason + offer the
          // fallback instead of burying this in the generic error lane.
          setError(
            `${body.reason ?? "Monte-Carlo unavailable."} Switching back to narrative walk is safe here — the LLM doesn't need numeric edges.`,
          );
          return;
        }
        if (!res.ok) throw new Error(body.error ?? "Monte-Carlo failed");
        const r = body.result as MonteCarloResult & {
          cross_space_bridges_included?: number;
        };
        setMcResult(r);
        setMcBridgeCount(r.cross_space_bridges_included ?? 0);
        onImpactOverlay?.(r.affected_entities.map((a) => a.entity_id));
        // Subject phase — log the experiment (no-op when no subject).
        void logExperiment({
          run_kind: "monte_carlo",
          run_params: { target_entity_id: targetId, direction, magnitude },
          outcome_summary: {
            ...r.aggregate_distribution,
            iterations: r.iterations,
            cross_space_bridges_included: r.cross_space_bridges_included ?? 0,
            affected_entity_count: r.affected_entities.length,
          },
        });
        return;
      }

      if (mode === "bootstrap") {
        setBsResult(null);
        const res = await fetch("/api/lab/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_entity_id: targetId,
            direction,
            magnitude,
          }),
        });
        const body = await res.json();
        if (res.status === 409 && body.error === "bootstrap_unavailable") {
          // Same epistemic-honesty posture as the MC 409 branch — tell
          // the user exactly why bootstrap isn't on the table and point
          // them at the next-best mode.
          setError(
            `${body.reason ?? "Bootstrap unavailable."} Monte-Carlo or narrative walk will still work here.`,
          );
          return;
        }
        if (!res.ok) throw new Error(body.error ?? "Bootstrap failed");
        const r = body.result as BootstrapResult & {
          cross_space_bridges_included?: number;
        };
        setBsResult(r);
        setBsBridgeCount(r.cross_space_bridges_included ?? 0);
        if (body.matched_tracker) setBsMatchedTracker(body.matched_tracker);
        if (typeof body.matched_tracker_score === "number") {
          setBsMatchedTrackerScore(body.matched_tracker_score);
        }
        onImpactOverlay?.(r.affected_entities.map((a) => a.entity_id));
        // Subject phase — log bootstrap experiment.
        void logExperiment({
          run_kind: "bootstrap",
          run_params: { target_entity_id: targetId, direction, magnitude },
          outcome_summary: {
            ...(r as unknown as { aggregate_distribution?: object })
              .aggregate_distribution ?? {},
            cross_space_bridges_included: r.cross_space_bridges_included ?? 0,
            affected_entity_count: r.affected_entities.length,
            matched_tracker: body.matched_tracker ?? null,
          },
        });
        return;
      }

      setResult(null);

      // narrative_walk
      const res = await fetch("/api/lab/what-if", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_entity_id: targetId,
          direction,
          magnitude,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "What-if failed");
      const r = body.result as WhatIfResponse;
      setResult(r);
      onImpactOverlay?.(r.affected_entities.map((a) => a.entity_id));
      // Subject phase — log narrative-walk experiment.
      void logExperiment({
        run_kind: "what_if",
        run_params: { target_entity_id: targetId, direction, magnitude },
        outcome_summary: {
          // narrative walks return a derived distribution + a verdict-y narrative
          ...((r as unknown as { derived_distribution?: object })
            .derived_distribution ?? {}),
          affected_entity_count: r.affected_entities.length,
          // Don't bloat the row with a long narrative — store a short summary.
          narrative_preview:
            typeof (r as { narrative?: string }).narrative === "string"
              ? (r as { narrative: string }).narrative.slice(0, 240)
              : null,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "What-if failed");
    } finally {
      setRunning(false);
    }
  }

  function handleClose() {
    onImpactOverlay?.(null);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={running ? undefined : handleClose}
    >
      <div
        className="mx-4 w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--lab-border-strong)] bg-[var(--lab-panel-bg)] shadow-2xl"
        style={{
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--lab-border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--lab-info)]">
              <Sparkles className="h-3 w-3" />
              Scenario walk
            </div>
            <p className="mt-1 text-[13px] text-[var(--lab-text-mid)]">
              Ask the LLM to walk your graph and guess what happens. This is a
              hypothesis engine, not a simulation — results are narrative
              inference, not computed forecasts.
            </p>
            {/* Gap B — mode chip lives in the header so the user sees the
                engine's epistemic weight before they even pick a target.
                Compact size; the result card below shows the full badge
                with tagline for the final answer. */}
            <div className="mt-2">
              <SimulationModeBadge mode="narrative_walk" size="compact" />
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={running}
            className="rounded p-1 text-[var(--lab-text-dim)] hover:bg-[var(--lab-panel-raised)] hover:text-[var(--lab-text)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-[var(--lab-text)]">
          {/* Target picker */}
          <div>
            <label className="mb-1.5 block text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
              Target
            </label>
            {targetEntity ? (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--lab-info-border)] bg-[var(--lab-info-tint)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">
                    {targetEntity.name}
                  </div>
                  {targetEntity.description && (
                    <div className="truncate text-[11px] text-[var(--lab-text-dim)]">
                      {targetEntity.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setTargetId(null);
                    setResult(null);
                  }}
                  className="rounded p-1 text-[var(--lab-text-dim)] hover:bg-[var(--lab-panel-raised)]"
                  aria-label="Change target"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-2.5">
                  <Search className="h-3.5 w-3.5 text-[var(--lab-text-dim)]" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for an entity to perturb…"
                    className="flex-1 border-0 bg-transparent py-2 text-[13px] text-[var(--lab-text)] placeholder-[var(--lab-text-faint)] focus:outline-none"
                  />
                </div>
                {matches.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-1.5">
                    {matches.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => {
                          setTargetId(e.id);
                          setQuery("");
                        }}
                        className="block w-full rounded px-2 py-1.5 text-left text-[12px] hover:bg-[var(--lab-panel-bg)]"
                      >
                        <div className="truncate font-medium">{e.name}</div>
                        {e.description && (
                          <div className="truncate text-[10px] text-[var(--lab-text-dim)]">
                            {e.description}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Direction + magnitude */}
          {targetEntity && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
                  Direction
                </label>
                <div className="flex gap-1">
                  {(["strengthen", "weaken", "remove"] as Direction[]).map(
                    (d) => (
                      <button
                        key={d}
                        onClick={() => setDirection(d)}
                        className={cn(
                          "flex-1 rounded-md border px-2 py-1.5 text-[11px] capitalize",
                          direction === d
                            ? "border-[var(--lab-info)] bg-[var(--lab-info-tint-strong)] text-[var(--lab-info)]"
                            : "border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] text-[var(--lab-text-mid)] hover:border-[var(--lab-border-strong)]",
                        )}
                      >
                        {d}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1.5 flex items-baseline justify-between text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
                  Magnitude
                  <span className="tabular-nums text-[11px] text-[var(--lab-text)]">
                    {magnitude.toFixed(1)}
                  </span>
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.1}
                  value={magnitude}
                  onChange={(e) => setMagnitude(parseFloat(e.target.value))}
                  className="w-full cursor-pointer appearance-none rounded-[2px] bg-[var(--lab-panel-inset)]"
                  style={{ height: 4 }}
                />
                <div className="mt-1 flex justify-between font-mono text-[8px] text-[var(--lab-text-faint)]">
                  <span>nudge</span>
                  <span>mid</span>
                  <span>full</span>
                </div>
              </div>
            </div>
          )}

          {/* Gap B — simulation mode tabs. The Monte-Carlo tab's enabled
              state + tooltip come from `mcPreflight`. When the subgraph
              doesn't qualify, the tab shows disabled with a 1-line
              explanation so the user knows *why* the stronger mode
              isn't on the table (not enough numeric strengths, or
              nothing downstream). */}
          {targetEntity && !result && !mcResult && !bsResult && (
            <div>
              <label className="mb-1.5 block text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
                Simulation mode
              </label>
              <div className="flex gap-1">
                <button
                  onClick={() => setMode("narrative_walk")}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-[11px]",
                    mode === "narrative_walk"
                      ? "border-[var(--lab-info)] bg-[var(--lab-info-tint-strong)] text-[var(--lab-info)]"
                      : "border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] text-[var(--lab-text-mid)]",
                  )}
                >
                  <div className="flex items-center justify-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Narrative
                  </div>
                  <div className="mt-0.5 text-[9px] font-normal normal-case opacity-70">
                    one LLM pass
                  </div>
                </button>
                <button
                  onClick={() => mcPreflight?.ok && setMode("monte_carlo")}
                  disabled={!mcPreflight?.ok}
                  title={mcPreflight?.reason ?? undefined}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                    mode === "monte_carlo"
                      ? "border-blue-400 bg-blue-400/15 text-blue-300"
                      : "border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] text-[var(--lab-text-mid)]",
                    !mcPreflight?.ok && "cursor-not-allowed opacity-50",
                  )}
                >
                  <div className="flex items-center justify-center gap-1">
                    <Dice5 className="h-3 w-3" />
                    Monte-Carlo
                  </div>
                  <div className="mt-0.5 text-[9px] font-normal normal-case opacity-70">
                    {mcPreflight?.ok
                      ? `${mcPreflight.numeric_edge_count} numeric edges`
                      : mcPreflight
                        ? "subgraph too thin"
                        : "checking…"}
                  </div>
                </button>
                {/* Bootstrap tab — third rung. Tooltip surfaces the
                    matched tracker label when preflight passes, or
                    the gate reason when it fails, so the user can
                    eyeball whether the match picked the right metric
                    before burning a run on it. */}
                <button
                  onClick={() => bsPreflight?.ok && setMode("bootstrap")}
                  disabled={!bsPreflight?.ok}
                  title={
                    bsPreflight?.ok
                      ? bsMatchedTracker
                        ? `Resampling from: ${bsMatchedTracker.label} (${bsPreflight.historical_n} historical deltas)`
                        : undefined
                      : (bsPreflight?.reason ?? undefined)
                  }
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                    mode === "bootstrap"
                      ? "border-teal-400 bg-teal-400/15 text-teal-300"
                      : "border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] text-[var(--lab-text-mid)]",
                    !bsPreflight?.ok && "cursor-not-allowed opacity-50",
                  )}
                >
                  <div className="flex items-center justify-center gap-1">
                    <History className="h-3 w-3" />
                    Bootstrap
                  </div>
                  <div className="mt-0.5 text-[9px] font-normal normal-case opacity-70">
                    {bsPreflight?.ok
                      ? `${bsPreflight.historical_n} historical deltas`
                      : bsPreflight
                        ? "not enough history"
                        : "checking…"}
                  </div>
                </button>
              </div>
              {mode === "monte_carlo" && mcPreflight?.ok && (
                <div className="mt-1.5 text-[10px] leading-snug text-[var(--lab-text-dim)]">
                  Runs ~500 propagation iterations with sampled edge
                  strengths + polarity uncertainty. Honest p10/p50/p90
                  instead of LLM-guessed numbers.
                </div>
              )}
              {mode === "bootstrap" && bsPreflight?.ok && (
                <div className="mt-1.5 text-[10px] leading-snug text-[var(--lab-text-dim)]">
                  Resamples {bsPreflight.historical_n} period-to-period
                  deltas from{" "}
                  <span className="font-semibold text-[var(--lab-text-mid)]">
                    {bsMatchedTracker?.label ?? "the matched tracker"}
                  </span>
                  . Uncertainty comes from your actual historical
                  volatility — not a fabricated σ.
                </div>
              )}
            </div>
          )}

          {/* Run button */}
          {targetEntity && !result && !mcResult && !bsResult && (
            <button
              onClick={run}
              disabled={running || !targetId}
              className={cn(
                "flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                mode === "monte_carlo"
                  ? "border-blue-400 bg-blue-400/15 text-blue-300 hover:bg-blue-400/25"
                  : mode === "bootstrap"
                    ? "border-teal-400 bg-teal-400/15 text-teal-300 hover:bg-teal-400/25"
                    : "border-[var(--lab-info)] bg-[var(--lab-info-tint-strong)] text-[var(--lab-info)] hover:bg-[var(--lab-info-tint-strong)]",
              )}
            >
              {running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {mode === "monte_carlo"
                    ? "Sampling distribution…"
                    : mode === "bootstrap"
                      ? "Resampling history…"
                      : "Walking the graph…"}
                </>
              ) : mode === "monte_carlo" ? (
                <>
                  <Dice5 className="h-3.5 w-3.5" />
                  Run Monte-Carlo
                </>
              ) : mode === "bootstrap" ? (
                <>
                  <History className="h-3.5 w-3.5" />
                  Run Bootstrap
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Walk the graph
                </>
              )}
            </button>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          )}

          {/* Cross-mode comparison — renders once the user has run ≥ 2
              modes for the same target. Shows each mode's headline p50
              in its own row so "narrative says +40%, Monte-Carlo says
              p50=12, bootstrap says p50=6" is visible in one glance.
              That contrast is the whole promise of the taxonomy — if
              the modes agree, the user has converging evidence; if they
              disagree, the stronger mode wins and the narrative should
              be treated as vibes. Without this strip, users would see
              only one card at a time and never notice the
              disagreement. */}
          {(() => {
            const count =
              (result ? 1 : 0) + (mcResult ? 1 : 0) + (bsResult ? 1 : 0);
            if (count < 2) return null;
            return (
              <ModeComparisonStrip
                narrative={result}
                monteCarlo={mcResult}
                bootstrap={bsResult}
                seedMagnitude={magnitude}
              />
            );
          })()}

          {result && (
            <ResultView
              result={result}
              entities={entities}
              onReRun={() => {
                setResult(null);
                onImpactOverlay?.(null);
              }}
            />
          )}

          {mcResult && (
            <MonteCarloResultView
              result={mcResult}
              entities={entities}
              seedMagnitude={magnitude}
              bridgeCount={mcBridgeCount}
              onReRun={() => {
                setMcResult(null);
                onImpactOverlay?.(null);
              }}
            />
          )}

          {bsResult && (
            <BootstrapResultView
              result={bsResult}
              matchedTracker={bsMatchedTracker}
              matchedTrackerScore={bsMatchedTrackerScore}
              entities={entities}
              seedMagnitude={magnitude}
              bridgeCount={bsBridgeCount}
              onReRun={() => {
                setBsResult(null);
                onImpactOverlay?.(null);
              }}
            />
          )}
        </div>
      </div>

      <style jsx>{`
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #00acc1;
          box-shadow: 0 0 6px #00acc1;
          cursor: pointer;
          border: 1px solid #10161f;
        }
      `}</style>
    </div>
  );
}

function ResultView({
  result,
  entities,
  onReRun,
}: {
  result: WhatIfResponse;
  entities: Array<Pick<Entity, "id" | "name">>;
  onReRun: () => void;
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) m.set(e.id, e.name);
    return m;
  }, [entities]);

  // Gap B — route always stamps narrative_walk today; other engines
  // will emit monte_carlo / bootstrap / deterministic_replay later and
  // this component routes them into mode-aware chrome below.
  const mode: SimulationMode = result.simulation_mode ?? "narrative_walk";
  const isNarrative = mode === "narrative_walk";

  return (
    <div className="space-y-3">
      {/* Provenance — full badge with tagline at the top of the result
          card. Reading order: the user sees HOW the prediction was
          made before they see WHAT the prediction is. That's the whole
          point of Gap B's epistemic-honesty pass. */}
      <SimulationModeBadge mode={mode} showTagline />

      {/* Narrative */}
      <div className="rounded-lg border-l-2 border-[var(--lab-info)] bg-[var(--lab-info-tint)] px-3 py-2">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--lab-info)]">
          Scenario
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--lab-text)]">
          {result.narrative || "No narrative returned."}
        </p>
      </div>

      {/* Predicted impact — mode-aware. In narrative_walk mode the LLM
          emitted p10/p50/p90 by pattern-matching, not by sampling a
          distribution. Rendering them as numeric percentiles would
          borrow visual authority the engine didn't earn. So we collapse
          to a qualitative band and reserve the numeric distribution pill
          row for modes that ran real math. */}
      {isNarrative ? (
        <QualitativeBand
          p50={result.derived_distribution.p50}
          rationale={result.derived_distribution.rationale}
        />
      ) : (
        <div className="rounded-lg border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-3">
          <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
            Predicted impact
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <DistroPill label="p10" value={result.derived_distribution.p10} muted />
            <DistroPill label="p50" value={result.derived_distribution.p50} />
            <DistroPill label="p90" value={result.derived_distribution.p90} muted />
          </div>
          {result.derived_distribution.rationale && (
            <p className="mt-2 text-[11px] italic text-[var(--lab-text-mid)]">
              {result.derived_distribution.rationale}
            </p>
          )}
        </div>
      )}

      {/* Affected entities */}
      {result.affected_entities.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
            Affected entities ({result.affected_entities.length})
          </div>
          <div className="space-y-1">
            {result.affected_entities.map((a) => (
              <AffectedRow
                key={a.entity_id}
                name={nameById.get(a.entity_id) ?? a.entity_id.slice(0, 8)}
                effect={a.effect}
                confidence={a.confidence}
                reasoning={a.reasoning}
              />
            ))}
          </div>
        </div>
      )}

      {/* Propagation paths */}
      {result.propagation_paths.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
            Propagation paths
          </div>
          <div className="space-y-1.5">
            {result.propagation_paths.map((p, i) => (
              <div
                key={i}
                className="rounded-lg border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-2"
              >
                <div className="flex flex-wrap items-center gap-1 text-[12px]">
                  {p.path.map((id, idx) => (
                    <span key={idx} className="flex items-center gap-1">
                      <span className="rounded bg-[var(--lab-panel-bg)] px-1.5 py-0.5 text-[11px]">
                        {nameById.get(id) ?? id.slice(0, 8)}
                      </span>
                      {idx < p.path.length - 1 && (
                        <ArrowRight className="h-3 w-3 text-[var(--lab-text-faint)]" />
                      )}
                    </span>
                  ))}
                  <span
                    className={cn(
                      "ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase",
                      p.likelihood === "high" &&
                        "bg-green-500/10 text-green-300",
                      p.likelihood === "medium" &&
                        "bg-amber-500/10 text-amber-300",
                      p.likelihood === "low" && "bg-gray-500/10 text-gray-400",
                    )}
                  >
                    {p.likelihood}
                  </span>
                </div>
                {p.description && (
                  <p className="mt-1 text-[11px] text-[var(--lab-text-mid)]">
                    {p.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cautions */}
      {result.cautions && result.cautions.length > 0 && (
        <div className="rounded-lg border-l-2 border-amber-400 bg-amber-400/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Cautions
          </div>
          <ul className="mt-1 space-y-0.5">
            {result.cautions.map((c, i) => (
              <li key={i} className="text-[12px] text-amber-200">
                • {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Provenance footer — restated at the bottom of the card so the
          reading order closes on the same honesty note it opened with.
          Authoritative copy from SIMULATION_MODE_META; never paraphrase
          here, or the two ends of the card will disagree. */}
      <div className="rounded-md border-l-2 border-dashed px-3 py-2 text-[11px] leading-snug text-[var(--lab-text-mid)]"
           style={{ borderColor: SIMULATION_MODE_META[mode].accent }}>
        <span className="font-semibold" style={{ color: SIMULATION_MODE_META[mode].accent }}>
          How we got this:
        </span>{" "}
        {SIMULATION_MODE_META[mode].tagline}
      </div>

      <button
        onClick={onReRun}
        className="w-full rounded-lg border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] py-2 text-[12px] font-medium text-[var(--lab-text-mid)] hover:border-[var(--lab-info-border)] hover:text-[var(--lab-info)]"
      >
        Run another scenario
      </button>
    </div>
  );
}

// Gap B — Monte-Carlo result card. Distinct from ResultView because
// the shape is different (no LLM narrative, no propagation-path prose;
// instead real numeric p-bands + per-entity distributions + a
// convergence note that tells the user whether to trust the tight-band
// reading or treat p10/p90 as "large uncertainty"). Kept as a sibling
// component so the narrative path stays untouched and each engine has
// chrome that actually matches what it produced.
function MonteCarloResultView({
  result,
  entities,
  onReRun,
  seedMagnitude,
  bridgeCount,
}: {
  result: MonteCarloResult;
  entities: Array<Pick<Entity, "id" | "name">>;
  onReRun: () => void;
  seedMagnitude: number;
  bridgeCount: number;
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) m.set(e.id, e.name);
    return m;
  }, [entities]);

  return (
    <div className="space-y-3">
      {/* Provenance — full badge with tagline, same reading order as
          ResultView so both engines open with "here's how we got this". */}
      <SimulationModeBadge mode="monte_carlo" showTagline />

      {/* Headline distribution — real p-bands, this time earned. */}
      <div className="rounded-lg border border-blue-400/50 bg-blue-400/5 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-blue-300">
            Propagated impact distribution
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-[var(--lab-text-dim)]">
            {bridgeCount > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded bg-purple-400/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-purple-300"
                title={`Propagation crossed ${bridgeCount} cross-space bridge${bridgeCount === 1 ? "" : "s"}. Effects on entities in other spaces are included in this distribution.`}
              >
                <Link2 className="h-2.5 w-2.5" />
                {bridgeCount} bridge{bridgeCount === 1 ? "" : "s"}
              </span>
            )}
            <span>N = {result.iterations}</span>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <DistroPill
            label="p10"
            value={result.aggregate_distribution.p10}
            muted
          />
          <DistroPill label="p50" value={result.aggregate_distribution.p50} />
          <DistroPill
            label="p90"
            value={result.aggregate_distribution.p90}
            muted
          />
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--lab-text-mid)]">
          <span>
            μ={" "}
            <span className="font-mono tabular-nums text-[var(--lab-text)]">
              {result.aggregate_distribution.mean}
            </span>
          </span>
          <span>
            σ={" "}
            <span className="font-mono tabular-nums text-[var(--lab-text)]">
              {result.aggregate_distribution.stddev}
            </span>
          </span>
        </div>
        <p className="mt-2 text-[11px] italic text-[var(--lab-text-mid)]">
          {result.convergence_note}
        </p>
      </div>

      {/* Per-entity affected list with sign-stability badge.
          Sign-stability < 0.6 is flagged as "direction uncertain" so the
          user doesn't read a +0.2 mean as authoritative when half the
          iterations went negative. */}
      {result.affected_entities.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
            Affected entities ({result.affected_entities.length})
          </div>
          <div className="space-y-1">
            {result.affected_entities.slice(0, 10).map((a) => (
              <MonteCarloAffectedRow
                key={a.entity_id}
                stats={a}
                name={nameById.get(a.entity_id) ?? a.entity_id.slice(0, 8)}
                seedMagnitude={seedMagnitude}
              />
            ))}
            {result.affected_entities.length > 10 && (
              <div className="text-center text-[10px] text-[var(--lab-text-faint)]">
                … and {result.affected_entities.length - 10} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Provenance footer — same pattern as ResultView. */}
      <div
        className="rounded-md border-l-2 border-dashed px-3 py-2 text-[11px] leading-snug text-[var(--lab-text-mid)]"
        style={{ borderColor: SIMULATION_MODE_META.monte_carlo.accent }}
      >
        <span
          className="font-semibold"
          style={{ color: SIMULATION_MODE_META.monte_carlo.accent }}
        >
          How we got this:
        </span>{" "}
        {SIMULATION_MODE_META.monte_carlo.tagline}
      </div>

      <button
        onClick={onReRun}
        className="w-full rounded-lg border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] py-2 text-[12px] font-medium text-[var(--lab-text-mid)] hover:border-blue-400/60 hover:text-blue-300"
      >
        Run another scenario
      </button>
    </div>
  );
}

// Gap B — Bootstrap result card. Visually mirrors the Monte-Carlo card
// (same pill row + per-entity sign-stability chrome) but carries two
// extra provenance fields in the header: `historical_n` (how many
// observations we resampled from) and the matched tracker label (which
// metric the resample was drawn from). Those two facts are the
// difference between "trust this distribution" and "our fuzzy-match
// pulled the wrong tracker." Surfacing them up-top lets the user
// catch a bad match in one glance.
function BootstrapResultView({
  result,
  matchedTracker,
  matchedTrackerScore,
  entities,
  onReRun,
  seedMagnitude,
  bridgeCount,
}: {
  result: BootstrapResult;
  matchedTracker: { id: string; label: string } | null;
  matchedTrackerScore: number | null;
  entities: Array<Pick<Entity, "id" | "name">>;
  onReRun: () => void;
  seedMagnitude: number;
  bridgeCount: number;
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) m.set(e.id, e.name);
    return m;
  }, [entities]);

  return (
    <div className="space-y-3">
      <SimulationModeBadge mode="bootstrap" showTagline />

      {/* Matched-tracker banner — the most important provenance check
          the user can make before trusting the distribution. If the
          fuzzy-match picked "Monthly churn %" when the target is "NPS",
          the whole bootstrap is meaningless. Make the user see this.
          When matchedTrackerScore is low (≤1), we flag "low-confidence
          match" in amber so the user treats the whole result as
          suggestive rather than authoritative. */}
      {matchedTracker && (() => {
        const lowConfidence =
          matchedTrackerScore !== null && matchedTrackerScore <= 1;
        const border = lowConfidence
          ? "border-amber-400/50"
          : "border-teal-400/40";
        const bg = lowConfidence ? "bg-amber-400/5" : "bg-teal-400/5";
        const accent = lowConfidence ? "text-amber-300" : "text-teal-300";
        return (
          <div className={cn("rounded-md border px-3 py-2", border, bg)}>
            <div
              className={cn(
                "flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest",
                accent,
              )}
            >
              <History className="h-3 w-3" />
              Resampled from
              {lowConfidence && (
                <span
                  className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-amber-200"
                  title="The fuzzy-matcher's confidence in this tracker was low. The distribution may be reasoned from a metric that doesn't actually track this target — treat the numbers as suggestive, not authoritative."
                >
                  <AlertTriangle className="h-2.5 w-2.5" />
                  low-confidence match
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[12px] font-semibold text-[var(--lab-text)]">
              {matchedTracker.label}
            </div>
            <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--lab-text-mid)]">
              N = {result.historical_n} period-to-period deltas · median
              |Δ| ={" "}
              <span className="text-[var(--lab-text)]">
                {result.historical_median_abs_delta.toFixed(3)}
              </span>
              {matchedTrackerScore !== null && (
                <>
                  {" "}· match score{" "}
                  <span className="text-[var(--lab-text)]">
                    {matchedTrackerScore.toFixed(1)}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Headline distribution — real p-bands, earned by resampling. */}
      <div className="rounded-lg border border-teal-400/50 bg-teal-400/5 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-teal-300">
            Empirical impact distribution
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-[var(--lab-text-dim)]">
            {bridgeCount > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded bg-purple-400/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-purple-300"
                title={`Propagation crossed ${bridgeCount} cross-space bridge${bridgeCount === 1 ? "" : "s"}. Effects on entities in other spaces are included in this distribution.`}
              >
                <Link2 className="h-2.5 w-2.5" />
                {bridgeCount} bridge{bridgeCount === 1 ? "" : "s"}
              </span>
            )}
            <span>N = {result.iterations}</span>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <DistroPill
            label="p10"
            value={result.aggregate_distribution.p10}
            muted
          />
          <DistroPill label="p50" value={result.aggregate_distribution.p50} />
          <DistroPill
            label="p90"
            value={result.aggregate_distribution.p90}
            muted
          />
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--lab-text-mid)]">
          <span>
            μ={" "}
            <span className="font-mono tabular-nums text-[var(--lab-text)]">
              {result.aggregate_distribution.mean}
            </span>
          </span>
          <span>
            σ={" "}
            <span className="font-mono tabular-nums text-[var(--lab-text)]">
              {result.aggregate_distribution.stddev}
            </span>
          </span>
          <span className="ml-auto text-[var(--lab-text-faint)]">
            edge coverage{" "}
            <span className="text-[var(--lab-text-mid)]">
              {Math.round(result.numeric_edge_coverage * 100)}%
            </span>
          </span>
        </div>
        <p className="mt-2 text-[11px] italic text-[var(--lab-text-mid)]">
          {result.convergence_note}
        </p>
      </div>

      {result.affected_entities.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
            Affected entities ({result.affected_entities.length})
          </div>
          <div className="space-y-1">
            {result.affected_entities.slice(0, 10).map((a) => (
              <BootstrapAffectedRow
                key={a.entity_id}
                stats={a}
                name={nameById.get(a.entity_id) ?? a.entity_id.slice(0, 8)}
                seedMagnitude={seedMagnitude}
              />
            ))}
            {result.affected_entities.length > 10 && (
              <div className="text-center text-[10px] text-[var(--lab-text-faint)]">
                … and {result.affected_entities.length - 10} more
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className="rounded-md border-l-2 border-dashed px-3 py-2 text-[11px] leading-snug text-[var(--lab-text-mid)]"
        style={{ borderColor: SIMULATION_MODE_META.bootstrap.accent }}
      >
        <span
          className="font-semibold"
          style={{ color: SIMULATION_MODE_META.bootstrap.accent }}
        >
          How we got this:
        </span>{" "}
        {SIMULATION_MODE_META.bootstrap.tagline}
      </div>

      <button
        onClick={onReRun}
        className="w-full rounded-lg border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] py-2 text-[12px] font-medium text-[var(--lab-text-mid)] hover:border-teal-400/60 hover:text-teal-300"
      >
        Run another scenario
      </button>
    </div>
  );
}

// Bootstrap-mode row mirrors the Monte-Carlo one — same sign-stability
// badge for honesty, same pill layout — but accepts the bootstrap
// engine's stats shape so both cards stay type-tight rather than
// leaking cross-engine types.
function BootstrapAffectedRow({
  stats,
  name,
  seedMagnitude,
}: {
  stats: BootstrapAffectedEntityStats;
  name: string;
  seedMagnitude: number;
}) {
  const { mean_delta, p10, p50, p90, sign_stability, cycle_role } = stats;
  const meanSign = mean_delta >= 0 ? "up" : "down";
  const color = mean_delta >= 0 ? "#4ade80" : "#f472b6";
  const Icon = mean_delta >= 0 ? TrendingUp : TrendingDown;
  const stableEnough = sign_stability >= 0.6;
  const seedFractionPct =
    seedMagnitude > 0 ? Math.round((mean_delta / seedMagnitude) * 100) : 0;
  return (
    <div className="rounded-md border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 flex-shrink-0" style={{ color }} />
        <span className="truncate text-[12px] font-semibold text-[var(--lab-text)]">
          {name}
        </span>
        <CycleRoleBadge role={cycle_role} />
        {!stableEnough && (
          <span
            className="flex-shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300"
            title={`Only ${(sign_stability * 100).toFixed(0)}% of resamples agreed on direction.`}
          >
            direction uncertain
          </span>
        )}
        <span
          className="ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider tabular-nums"
          style={{ background: `${color}18`, color }}
          title={`mean_delta = ${mean_delta.toFixed(3)} (${seedFractionPct >= 0 ? "+" : ""}${seedFractionPct}% of seed ${seedMagnitude.toFixed(1)})`}
        >
          {meanSign} {Math.abs(mean_delta).toFixed(2)}
          <span className="ml-1 opacity-70">
            ({seedFractionPct >= 0 ? "+" : ""}{seedFractionPct}%)
          </span>
        </span>
      </div>
      <div className="mt-1 flex gap-3 font-mono text-[10px] tabular-nums text-[var(--lab-text-mid)]">
        <span>
          p10 <span className="text-[var(--lab-text)]">{p10.toFixed(2)}</span>
        </span>
        <span>
          p50 <span className="text-[var(--lab-text)]">{p50.toFixed(2)}</span>
        </span>
        <span>
          p90 <span className="text-[var(--lab-text)]">{p90.toFixed(2)}</span>
        </span>
        <span className="ml-auto">
          stability{" "}
          <span className="text-[var(--lab-text)]">
            {(sign_stability * 100).toFixed(0)}%
          </span>
        </span>
      </div>
    </div>
  );
}

function MonteCarloAffectedRow({
  stats,
  name,
  seedMagnitude,
}: {
  stats: AffectedEntityStats;
  name: string;
  seedMagnitude: number;
}) {
  const { mean_delta, p10, p50, p90, sign_stability, cycle_role } = stats;
  const meanSign = mean_delta >= 0 ? "up" : "down";
  const color = mean_delta >= 0 ? "#4ade80" : "#f472b6";
  const Icon = mean_delta >= 0 ? TrendingUp : TrendingDown;
  const stableEnough = sign_stability >= 0.6;
  const seedFractionPct =
    seedMagnitude > 0 ? Math.round((mean_delta / seedMagnitude) * 100) : 0;
  return (
    <div className="rounded-md border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 flex-shrink-0" style={{ color }} />
        <span className="truncate text-[12px] font-semibold text-[var(--lab-text)]">
          {name}
        </span>
        <CycleRoleBadge role={cycle_role} />
        {!stableEnough && (
          <span
            className="flex-shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300"
            title={`Only ${(sign_stability * 100).toFixed(0)}% of iterations agreed on direction.`}
          >
            direction uncertain
          </span>
        )}
        <span
          className="ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider tabular-nums"
          style={{ background: `${color}18`, color }}
          title={`mean_delta = ${mean_delta.toFixed(3)} (${seedFractionPct >= 0 ? "+" : ""}${seedFractionPct}% of seed ${seedMagnitude.toFixed(1)})`}
        >
          {meanSign} {Math.abs(mean_delta).toFixed(2)}
          <span className="ml-1 opacity-70">
            ({seedFractionPct >= 0 ? "+" : ""}
            {seedFractionPct}%)
          </span>
        </span>
      </div>
      <div className="mt-1 flex gap-3 font-mono text-[10px] tabular-nums text-[var(--lab-text-mid)]">
        <span>
          p10 <span className="text-[var(--lab-text)]">{p10.toFixed(2)}</span>
        </span>
        <span>
          p50 <span className="text-[var(--lab-text)]">{p50.toFixed(2)}</span>
        </span>
        <span>
          p90 <span className="text-[var(--lab-text)]">{p90.toFixed(2)}</span>
        </span>
        <span className="ml-auto">
          stability{" "}
          <span className="text-[var(--lab-text)]">
            {(sign_stability * 100).toFixed(0)}%
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Cross-mode comparison strip. Shown once the user has run ≥ 2 of
 * {narrative, monte_carlo, bootstrap} against the same target. Shows
 * each mode's headline p50 (and, for MC/bootstrap, p10–p90 spread)
 * in a single glanceable strip so disagreement becomes visible.
 *
 * Copy rationale: we *don't* call one mode "right" — we let the user
 * see the range. The taxonomy's rule is "stronger mode wins on
 * disagreement", and we reinforce that implicitly by ordering the
 * rows narrative → MC → bootstrap (weakest → strongest, left
 * column). The footer note explicitly says that.
 *
 * The narrative-walk number is LLM-guessed, not sampled — we render
 * it in italic with a "guess" tag so the user doesn't read it as
 * equally authoritative. That's consistent with ResultView's
 * QualitativeBand-not-numeric treatment.
 */
function ModeComparisonStrip({
  narrative,
  monteCarlo,
  bootstrap,
  seedMagnitude,
}: {
  narrative: WhatIfResponse | null;
  monteCarlo: MonteCarloResult | null;
  bootstrap: BootstrapResult | null;
  seedMagnitude: number;
}) {
  const rows: Array<{
    mode: SimulationMode;
    label: string;
    accent: string;
    p50: number;
    p10?: number;
    p90?: number;
    isGuess: boolean;
  }> = [];
  if (narrative) {
    rows.push({
      mode: "narrative_walk",
      label: "Narrative",
      accent: SIMULATION_MODE_META.narrative_walk.accent,
      p50: narrative.derived_distribution.p50,
      isGuess: true,
    });
  }
  if (monteCarlo) {
    rows.push({
      mode: "monte_carlo",
      label: "Monte-Carlo",
      accent: SIMULATION_MODE_META.monte_carlo.accent,
      p50: monteCarlo.aggregate_distribution.p50,
      p10: monteCarlo.aggregate_distribution.p10,
      p90: monteCarlo.aggregate_distribution.p90,
      isGuess: false,
    });
  }
  if (bootstrap) {
    rows.push({
      mode: "bootstrap",
      label: "Bootstrap",
      accent: SIMULATION_MODE_META.bootstrap.accent,
      p50: bootstrap.aggregate_distribution.p50,
      p10: bootstrap.aggregate_distribution.p10,
      p90: bootstrap.aggregate_distribution.p90,
      isGuess: false,
    });
  }
  // Disagreement heuristic: if the narrative-walk p50 sits outside the
  // strongest-mode's p10–p90 envelope, flag it so the user sees the
  // taxonomy promise play out. Prefer bootstrap's envelope when
  // available (stronger mode), fall back to MC.
  const envelope = bootstrap
    ? { p10: bootstrap.aggregate_distribution.p10, p90: bootstrap.aggregate_distribution.p90 }
    : monteCarlo
      ? { p10: monteCarlo.aggregate_distribution.p10, p90: monteCarlo.aggregate_distribution.p90 }
      : null;
  const narrativeOutsideEnvelope =
    narrative && envelope
      ? narrative.derived_distribution.p50 < envelope.p10 ||
        narrative.derived_distribution.p50 > envelope.p90
      : false;
  return (
    <div className="rounded-lg border border-dashed border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] p-3">
      <div className="flex items-center justify-between">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
          Cross-mode comparison
        </div>
        <div className="font-mono text-[9px] tabular-nums text-[var(--lab-text-faint)]">
          seed {seedMagnitude.toFixed(1)}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((r) => (
          <div
            key={r.mode}
            className="flex items-center gap-2 rounded border border-[var(--lab-border)] bg-[var(--lab-panel-bg)] px-2 py-1"
          >
            <span
              className="flex-shrink-0 h-2 w-2 rounded-full"
              style={{ background: r.accent }}
              aria-hidden
            />
            <span
              className={cn(
                "w-20 flex-shrink-0 text-[11px] font-semibold",
                r.isGuess && "italic",
              )}
              style={{ color: r.accent }}
            >
              {r.label}
            </span>
            {r.isGuess ? (
              <span className="flex-shrink-0 rounded bg-[var(--lab-panel-raised)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--lab-text-faint)]">
                guess
              </span>
            ) : (
              <span className="flex-shrink-0 rounded bg-[var(--lab-panel-raised)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--lab-text-mid)]">
                sampled
              </span>
            )}
            <span className="ml-auto flex items-center gap-2 font-mono text-[11px] tabular-nums text-[var(--lab-text)]">
              {typeof r.p10 === "number" && typeof r.p90 === "number" ? (
                <span className="text-[var(--lab-text-faint)]">
                  [{r.p10.toFixed(1)}–{r.p90.toFixed(1)}]
                </span>
              ) : null}
              <span className="font-semibold">p50 {r.p50.toFixed(1)}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-[var(--lab-text-mid)]">
        {narrativeOutsideEnvelope ? (
          <>
            <span className="font-semibold text-amber-300">
              Narrative disagrees with the sampled envelope.
            </span>{" "}
            When the LLM guess lands outside the stronger mode&apos;s
            p10–p90 band, trust the sampled distribution and treat the
            narrative as a vibe-check.
          </>
        ) : (
          <>
            Stronger modes (Monte-Carlo, bootstrap) win on disagreement;
            narrative is a vibe-check, not a forecast.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Small badge flagging whether this entity sits on a cycle that
 * amplified (reinforcing) or damped (balancing) its contribution during
 * propagation. Rendered inline next to the name so the user can
 * distinguish "this number is big because it's genuinely downstream"
 * from "this number is big because feedback loops pumped it up". Null
 * role → no badge (off-cycle, no chrome needed).
 */
function CycleRoleBadge({
  role,
}: {
  role: "reinforcing" | "balancing" | null;
}) {
  if (!role) return null;
  const isReinforcing = role === "reinforcing";
  const style = isReinforcing
    ? { bg: "#f59e0b18", fg: "#fbbf24", label: "reinforcing loop" }
    : { bg: "#60a5fa18", fg: "#93c5fd", label: "balancing loop" };
  const Icon = isReinforcing ? Repeat : Shield;
  return (
    <span
      className="flex-shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
      style={{ background: style.bg, color: style.fg }}
      title={
        isReinforcing
          ? "Contribution was amplified at the point of entry by a reinforcing cycle. The propagated delta is larger than a tree-only walk would suggest."
          : "Contribution was damped at the point of entry by a balancing cycle. The propagated delta is smaller than a tree-only walk would suggest."
      }
    >
      <Icon className="h-2.5 w-2.5" />
      {style.label}
    </span>
  );
}

function QualitativeBand({
  p50,
  rationale,
}: {
  p50: number;
  rationale: string;
}) {
  // Narrative-mode predictions get qualitative bands instead of numeric
  // percentiles. The band is derived from the LLM-emitted p50 ONLY as a
  // shortcut for sorting — we're not claiming the number itself is real,
  // just using it to bucket the label. When a real distribution-backed
  // mode lands, the parent renders the numeric pills instead.
  const band = qualitativeBandFor(p50);
  const toneStyle: Record<typeof band.tone, { border: string; bg: string; fg: string }> = {
    positive: { border: "#4ade8055", bg: "#4ade8014", fg: "#4ade80" },
    neutral: { border: "#9ca3af55", bg: "#9ca3af14", fg: "#9ca3af" },
    caution: { border: "#f59e0b55", bg: "#f59e0b14", fg: "#f59e0b" },
    negative: { border: "#f472b655", bg: "#f472b614", fg: "#f472b6" },
  };
  const s = toneStyle[band.tone];
  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: s.border, background: s.bg }}
    >
      <div
        className="text-[9px] font-bold uppercase tracking-widest"
        style={{ color: s.fg }}
      >
        Graph-topology verdict
      </div>
      <div className="mt-1 text-[14px] font-semibold" style={{ color: s.fg }}>
        {band.label}
      </div>
      {rationale && (
        <p className="mt-1 text-[11px] italic text-[var(--lab-text-mid)]">
          {rationale}
        </p>
      )}
      <p className="mt-2 text-[10px] text-[var(--lab-text-faint)]">
        No numeric range is shown because this engine did not sample a
        distribution. Run Monte-Carlo or deterministic replay to earn p-bands.
      </p>
    </div>
  );
}

function DistroPill({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-md border px-2 py-1.5 text-center",
        muted
          ? "border-[var(--lab-border)] bg-[var(--lab-panel-bg)]"
          : "border-[var(--lab-info-border)] bg-[var(--lab-info-tint)]",
      )}
    >
      <div
        className={cn(
          "text-[9px] uppercase tracking-widest",
          muted ? "text-[var(--lab-text-faint)]" : "text-[var(--lab-info)]",
        )}
      >
        {label}
      </div>
      <div className="mt-0.5 text-[16px] tabular-nums text-[var(--lab-text)]">
        {Math.round(value)}
        <span className="ml-0.5 text-[9px] text-[var(--lab-text-dim)]">%</span>
      </div>
    </div>
  );
}

function AffectedRow({
  name,
  effect,
  confidence,
  reasoning,
}: {
  name: string;
  effect: WhatIfResponse["affected_entities"][number]["effect"];
  confidence: number;
  reasoning: string;
}) {
  const Icon =
    effect === "increases"
      ? TrendingUp
      : effect === "decreases"
        ? TrendingDown
        : effect === "destabilizes"
          ? Zap
          : effect === "reinforces"
            ? Sparkles
            : null;
  const color =
    effect === "increases"
      ? "#4ade80"
      : effect === "decreases"
        ? "#f472b6"
        : effect === "destabilizes"
          ? "#f59e0b"
          : effect === "reinforces"
            ? "#00ACC1"
            : "#64748b";
  return (
    <div className="rounded-md border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 flex-shrink-0" style={{ color }} />}
        <span className="truncate text-[12px] font-semibold text-[var(--lab-text)]">
          {name}
        </span>
        <span
          className="ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
          style={{ background: `${color}18`, color }}
        >
          {effect}
        </span>
        <span className="flex-shrink-0 tabular-nums text-[10px] text-[var(--lab-text-dim)]">
          {Math.round(confidence * 100)}%
        </span>
      </div>
      {reasoning && (
        <p className="mt-0.5 text-[11px] text-[var(--lab-text-mid)]">{reasoning}</p>
      )}
    </div>
  );
}
