"use client";

// ── Item 4 digital-twin lab widgets (real implementations) ─────────────
//
// These read from the Item 2 ledger + baseline data, surfaced via the
// Item 3 resolver table. Action buttons dispatch through the shared
// /api/apps/:id/action endpoint to the handlers in action-handlers-item4.ts.
//
// Rendering philosophy:
//   - Defensive rendering — widgets never crash on missing data. Empty,
//     loading, and error states are always handled via WidgetEmpty /
//     ResolvedBinding.status checks.
//   - Compact UI — each widget fits a default dashboard slot comfortably.
//     Power-user detail (expanded rows, charts, etc.) is future work; v1
//     shows the 3-5 most important columns.
//   - No inline DB access — widgets only touch data through the resolver
//     and only mutate through context.dispatch.
//
// File-size note: five widgets in one file is tight but each is ~100 lines
// of JSX, and keeping them adjacent makes the shared types + helpers
// (tag color mapping, deviation formatters) obvious. Split if a single
// widget grows past ~250 lines.

import { useMemo, useState } from "react";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type {
  StrategyBaselineRow,
  PredictionLedgerRow,
  MetricBaseline,
  PredictedOutcome,
} from "@/types/prediction";
import {
  Surface,
  WidgetTitle,
  WidgetEmpty,
  ActionButton,
} from "./shared";
import { cn } from "@/lib/utils";

// ── Shared types + helpers ─────────────────────────────────────────────

type DeviationTag = "expected" | "regime_shift" | "surprise" | "qualitative";

// Violet stays as the lab-family accent, but we vary tag colors inside
// so deviation severity reads at a glance (green=expected, amber=shift,
// rose=surprise, slate=qualitative).
const TAG_COLORS: Record<DeviationTag, { bg: string; text: string; label: string }> = {
  expected: {
    bg: "bg-emerald-50/80 ring-1 ring-emerald-200/70",
    text: "text-emerald-700",
    label: "On track",
  },
  regime_shift: {
    bg: "bg-amber-50/80 ring-1 ring-amber-200/70",
    text: "text-amber-700",
    label: "Regime shift",
  },
  surprise: {
    bg: "bg-rose-50/80 ring-1 ring-rose-200/70",
    text: "text-rose-700",
    label: "Surprise",
  },
  qualitative: {
    bg: "bg-slate-50/80 ring-1 ring-slate-200/70",
    text: "text-slate-600",
    label: "Qualitative",
  },
};

function TagPill({ tag }: { tag: DeviationTag | null | undefined }) {
  const spec = tag ? TAG_COLORS[tag] : null;
  if (!spec) {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
        open
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
        spec.bg,
        spec.text,
      )}
    >
      {spec.label}
    </span>
  );
}

function formatNumber(n: number | null | undefined, unit?: string | null): string {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  const formatted =
    abs >= 1000 ? n.toFixed(0) : abs >= 10 ? n.toFixed(1) : n.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatDelta(predicted: number | null, actual: number | null): string {
  if (predicted === null || actual === null) return "—";
  const d = actual - predicted;
  const sign = d > 0 ? "+" : "";
  return `${sign}${formatNumber(d)}`;
}

function relativeHorizon(iso: string | null | undefined): string {
  if (!iso) return "—";
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffDays = Math.round((target - now) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "today";
  if (diffDays > 0) return `in ${diffDays}d`;
  return `${Math.abs(diffDays)}d ago`;
}

// ── baseline_deviation_tracker ─────────────────────────────────────────
//
// Shows metric-level deviation: for each metric in the strategy_baseline,
// find the most recent resolved prediction and display (baseline → predicted →
// actual → deviation_tag). Metrics with no resolved prediction show "awaiting
// horizon"; metrics with no baseline entry are skipped (we don't want to
// surface every tracker in the system — just what the strategy committed to).

export function BaselineDeviationTracker({ instance, context }: WidgetComponentProps) {
  const baselineBinding = instance.bindings?.baseline;
  const deviationsBinding = instance.bindings?.deviations;

  const baselineRes = context.resolve<StrategyBaselineRow | null>(baselineBinding);
  const deviationsRes = context.resolve<PredictionLedgerRow[]>(deviationsBinding);

  const baseline = baselineRes.value;
  const deviations = deviationsRes.value ?? [];

  const rows = useMemo(() => {
    if (!baseline) return [];
    const metricBaselines = Array.isArray(baseline.metric_baselines)
      ? (baseline.metric_baselines as unknown as MetricBaseline[])
      : [];
    const predictedOutcomes = Array.isArray(baseline.predicted_outcomes)
      ? (baseline.predicted_outcomes as unknown as PredictedOutcome[])
      : [];

    return metricBaselines.slice(0, 8).map((mb) => {
      // Join: any predicted outcome for this metric label
      const predicted = predictedOutcomes.find((po) => po.metric_label === mb.label);
      // Join: most recent resolved deviation for this metric
      const deviation = deviations
        .filter((d) => d.metric_label === mb.label && d.status === "resolved")
        .sort((a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""))[0];
      return {
        label: mb.label,
        unit: mb.unit,
        baselineValue: mb.value ?? null,
        predictedValue: predicted?.predicted_value ?? null,
        actual: deviation?.resolved_actual ?? null,
        tag: (deviation?.deviation_tag as DeviationTag | null) ?? null,
      };
    });
  }, [baseline, deviations]);

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Lab · Baseline deviation"
        title="Predicted vs actual"
        subtitle={
          baseline
            ? `T0 snapshot · ${new Date(baseline.snapshot_at).toLocaleDateString()}`
            : "No baseline captured yet"
        }
        rightSlot={
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
            {rows.length} {rows.length === 1 ? "metric" : "metrics"}
          </span>
        }
      />
      {!baseline ? (
        <WidgetEmpty>
          No strategy baseline found for this space — run a strategy refresh to capture T0.
        </WidgetEmpty>
      ) : rows.length === 0 ? (
        <WidgetEmpty>This baseline has no tracked metrics yet.</WidgetEmpty>
      ) : (
        <div className="-mx-1 overflow-hidden rounded-xl">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">
                <th className="py-1.5 pl-2 pr-3">Metric</th>
                <th className="px-2 text-right">T0</th>
                <th className="px-2 text-right">Predicted</th>
                <th className="px-2 text-right">Actual</th>
                <th className="px-2 text-right">Δ</th>
                <th className="pl-2 pr-2 text-right">Tag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  className="border-t border-gray-100/80 hover:bg-gray-50/50"
                >
                  <td className="truncate py-2 pl-2 pr-3 font-medium text-gray-800">
                    {row.label}
                  </td>
                  <td className="px-2 text-right text-gray-600">
                    {formatNumber(row.baselineValue, row.unit)}
                  </td>
                  <td className="px-2 text-right text-gray-600">
                    {formatNumber(row.predictedValue, row.unit)}
                  </td>
                  <td className="px-2 text-right font-medium text-gray-800">
                    {formatNumber(row.actual, row.unit)}
                  </td>
                  <td className="px-2 text-right text-gray-500">
                    {formatDelta(row.predictedValue, row.actual)}
                  </td>
                  <td className="py-2 pl-2 pr-2 text-right">
                    <TagPill tag={row.tag} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Surface>
  );
}

// ── prediction_panel ───────────────────────────────────────────────────
//
// Lists open predictions for the current app (or space if bound broadly).
// Inline form at the top lets the user log a new prediction via the
// log_prediction action. Each row shows metric, horizon, predicted value,
// confidence, and agent attribution; no row-level actions in v1 (editing
// open predictions is a v2 concern).

export function PredictionPanel({ instance, context }: WidgetComponentProps) {
  const predictionsBinding = instance.bindings?.predictions;
  const res = context.resolve<PredictionLedgerRow[]>(predictionsBinding);
  const predictions = (res.value ?? []).filter((p) => p.status === "open");

  const [showForm, setShowForm] = useState(false);
  const [metric, setMetric] = useState("");
  const [value, setValue] = useState("");
  const [days, setDays] = useState("30");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!metric || !value) return;
    setBusy(true);
    try {
      await context.dispatch(instance.id, "log_prediction", {
        metric_label: metric,
        predicted_value: Number(value),
        horizon_days: Number(days) || 30,
        rationale: rationale || undefined,
      });
      setMetric("");
      setValue("");
      setDays("30");
      setRationale("");
      setShowForm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Lab · Predictions"
        title="Open forecasts"
        subtitle={`${predictions.length} awaiting horizon`}
        rightSlot={
          <ActionButton
            label={showForm ? "Cancel" : "+ Log"}
            variant="subtle"
            compact
            onClick={() => setShowForm((s) => !s)}
          />
        }
      />

      {showForm && (
        <div className="mb-3 space-y-2 rounded-xl border border-violet-200/60 bg-violet-50/30 p-3">
          <div className="grid grid-cols-3 gap-2">
            <input
              className="col-span-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
              placeholder="Metric label"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
            />
            <input
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
              placeholder="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type="number"
              inputMode="decimal"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
              placeholder="Days"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              type="number"
              inputMode="numeric"
            />
            <input
              className="col-span-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
              placeholder="Rationale (optional)"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <ActionButton
              label={busy ? "Logging…" : "Log prediction"}
              variant="primary"
              compact
              disabled={busy || !metric || !value}
              onClick={submit}
            />
          </div>
        </div>
      )}

      {predictions.length === 0 ? (
        <WidgetEmpty>No open predictions. Log one to start tracking.</WidgetEmpty>
      ) : (
        <ul className="space-y-1.5">
          {predictions.slice(0, 6).map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-gray-800">
                  {p.metric_label}
                </div>
                <div className="truncate text-[11px] text-gray-500">
                  {p.rationale ?? p.agent_id ?? "self-authored"}
                </div>
              </div>
              <div className="flex shrink-0 items-baseline gap-2 text-right">
                <span className="text-[13px] font-semibold tabular-nums text-gray-900">
                  {formatNumber(p.predicted_value, p.metric_unit)}
                </span>
                <span className="text-[10.5px] uppercase tracking-[0.06em] text-gray-400">
                  {relativeHorizon(p.horizon_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

// ── deviation_signal_feed ──────────────────────────────────────────────
//
// Surprise feed — resolved predictions the system couldn't predict.
// Each row has an escalate_to_research action that kicks the surprise
// into the research queue so the next self-improving loop pass picks
// it up. This is the loop closer.

export function DeviationSignalFeed({ instance, context }: WidgetComponentProps) {
  const signalsBinding = instance.bindings?.signals;
  const res = context.resolve<PredictionLedgerRow[]>(signalsBinding);
  const signals = (res.value ?? []).slice(0, 6);

  const [escalating, setEscalating] = useState<string | null>(null);

  async function escalate(predictionId: string) {
    setEscalating(predictionId);
    try {
      await context.dispatch(instance.id, "escalate_to_research", {
        prediction_id: predictionId,
      });
    } finally {
      setEscalating(null);
    }
  }

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Lab · Deviation feed"
        title="Surprises"
        subtitle="Predictions that went unexpectedly. Each is a high-value training signal."
        rightSlot={
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
            {signals.length} recent
          </span>
        }
      />
      {signals.length === 0 ? (
        <WidgetEmpty>
          No surprises yet — either the resolver hasn&apos;t caught up, or reality matched
          predictions.
        </WidgetEmpty>
      ) : (
        <ul className="space-y-2">
          {signals.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-rose-100/80 bg-rose-50/30 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-gray-900">
                      {s.metric_label}
                    </span>
                    <TagPill tag={s.deviation_tag as DeviationTag | null} />
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-gray-600">
                    predicted{" "}
                    <span className="tabular-nums text-gray-800">
                      {formatNumber(s.predicted_value, s.metric_unit)}
                    </span>
                    {" · actual "}
                    <span className="tabular-nums font-medium text-gray-900">
                      {formatNumber(s.resolved_actual, s.metric_unit)}
                    </span>
                    {" · Δ "}
                    <span className="tabular-nums text-gray-600">
                      {formatDelta(s.predicted_value, s.resolved_actual)}
                    </span>
                  </div>
                  {s.resolution_notes && (
                    <div className="mt-1 text-[11px] italic text-gray-500">
                      {s.resolution_notes}
                    </div>
                  )}
                </div>
                <ActionButton
                  label={escalating === s.id ? "…" : "Escalate"}
                  variant="secondary"
                  compact
                  disabled={escalating === s.id || (s.resolution_notes ?? "").includes("[escalated")}
                  onClick={() => escalate(s.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

// ── validation_lab ─────────────────────────────────────────────────────
//
// Hypothesis-testing surface. Top: form to start an experiment (which is
// really a prediction with a hypothesis string). Below: open experiments
// with end-experiment controls. v1 doesn't persist experiment metadata
// beyond what prediction_ledger already carries; a richer experiments
// table is future work if we need side-by-side comparison.

export function ValidationLab({ instance, context }: WidgetComponentProps) {
  const predictionsBinding = instance.bindings?.predictions;
  const res = context.resolve<PredictionLedgerRow[]>(predictionsBinding);
  const experiments = (res.value ?? []).filter(
    (p) => p.status === "open" && (p.rationale ?? "").startsWith("[experiment]"),
  );

  const [hypothesis, setHypothesis] = useState("");
  const [metric, setMetric] = useState("");
  const [predictedValue, setPredictedValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endActual, setEndActual] = useState("");

  async function startExperiment() {
    if (!hypothesis || !metric) return;
    setBusy(true);
    try {
      await context.dispatch(instance.id, "start_experiment", {
        hypothesis,
        metric_label: metric,
        predicted_value: predictedValue ? Number(predictedValue) : undefined,
        horizon_days: 14,
      });
      setHypothesis("");
      setMetric("");
      setPredictedValue("");
    } finally {
      setBusy(false);
    }
  }

  async function endExperiment(id: string) {
    if (!endActual) return;
    setBusy(true);
    try {
      await context.dispatch(instance.id, "end_experiment", {
        prediction_id: id,
        actual_value: Number(endActual),
      });
      setEndingId(null);
      setEndActual("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Lab · Validation"
        title="Experiments in flight"
        subtitle={`${experiments.length} hypothesis tests awaiting actuals`}
      />

      {/* Start form */}
      <div className="mb-3 space-y-2 rounded-xl border border-violet-200/60 bg-violet-50/25 p-3">
        <input
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
          placeholder="Hypothesis (e.g. 'shipping X will lift retention')"
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            className="col-span-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
            placeholder="Metric to watch"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          />
          <input
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
            placeholder="Predicted"
            value={predictedValue}
            onChange={(e) => setPredictedValue(e.target.value)}
            type="number"
            inputMode="decimal"
          />
        </div>
        <div className="flex justify-end">
          <ActionButton
            label={busy ? "Starting…" : "Start experiment"}
            variant="primary"
            compact
            disabled={busy || !hypothesis || !metric}
            onClick={startExperiment}
          />
        </div>
      </div>

      {/* Open experiments list */}
      {experiments.length === 0 ? (
        <WidgetEmpty>No open experiments. Declare a hypothesis above.</WidgetEmpty>
      ) : (
        <ul className="space-y-2">
          {experiments.map((e) => {
            const hypothesis = (e.rationale ?? "").replace(/^\[experiment\]\s*/, "");
            const isEnding = endingId === e.id;
            return (
              <li
                key={e.id}
                className="rounded-xl border border-gray-100 bg-white/70 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-gray-800">
                      {hypothesis}
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      metric: <span className="text-gray-700">{e.metric_label}</span>
                      {e.predicted_value !== null && (
                        <>
                          {" · predicted "}
                          <span className="tabular-nums text-gray-700">
                            {formatNumber(e.predicted_value, e.metric_unit)}
                          </span>
                        </>
                      )}
                      {" · "}
                      <span className="text-gray-400">{relativeHorizon(e.horizon_at)}</span>
                    </div>
                  </div>
                  {isEnding ? (
                    <div className="flex items-center gap-1">
                      <input
                        className="w-20 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11.5px]"
                        placeholder="Actual"
                        value={endActual}
                        onChange={(ev) => setEndActual(ev.target.value)}
                        type="number"
                        inputMode="decimal"
                      />
                      <ActionButton
                        label={busy ? "…" : "Save"}
                        variant="primary"
                        compact
                        disabled={busy || !endActual}
                        onClick={() => endExperiment(e.id)}
                      />
                    </div>
                  ) : (
                    <ActionButton
                      label="End"
                      variant="secondary"
                      compact
                      onClick={() => {
                        setEndingId(e.id);
                        setEndActual("");
                      }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}

// ── simulation_lab ─────────────────────────────────────────────────────
//
// What-if engine. User picks metrics from the baseline and dials deltas;
// run_simulation action writes the scenario to app.state.last_simulation
// and the widget re-renders with the scenario row. No persistence of prior
// scenarios in v1 — each run overwrites — which keeps the UI simple while
// the underlying engine is still arithmetic.

interface SimulationResult {
  scenario_label: string;
  ran_at: string;
  baseline_health: number;
  scenario_health: number;
  health_delta: number;
  metrics: Array<{
    metric_label: string;
    baseline_value: number | null;
    scenario_value: number | null;
    delta_pct: number;
    unit: string | null;
  }>;
}

export function SimulationLab({ instance, context }: WidgetComponentProps) {
  const twinBinding = instance.bindings?.twin;
  const scenariosBinding = instance.bindings?.scenarios;

  const twinRes = context.resolve<{ macro?: { health_score?: number } } | null>(twinBinding);
  const simRes = context.resolve<SimulationResult | null>(scenariosBinding);

  // Pull baseline metrics from the app's state or from a pre-fetched
  // baseline binding. The simpler path: just read whatever simulation
  // was last run.
  const lastSim = simRes.value;
  const currentHealth =
    (twinRes.value?.macro?.health_score ?? null) ?? lastSim?.baseline_health ?? null;

  const [label, setLabel] = useState("");
  const [metric, setMetric] = useState("");
  const [deltaPct, setDeltaPct] = useState("10");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!label || !metric) return;
    setBusy(true);
    try {
      await context.dispatch(instance.id, "run_simulation", {
        scenario_label: label,
        perturbations: [
          {
            metric_label: metric,
            delta_pct: (Number(deltaPct) || 0) / 100,
          },
        ],
      });
      setLabel("");
      setMetric("");
      setDeltaPct("10");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Lab · Simulation"
        title="What-if scenarios"
        subtitle="Perturb a metric and see the projected health delta. Scenarios do not touch the real ledger."
        rightSlot={
          currentHealth !== null && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-gray-700">
              Twin {currentHealth.toFixed(0)}
            </span>
          )
        }
      />

      <div className="mb-3 space-y-2 rounded-xl border border-violet-200/60 bg-violet-50/25 p-3">
        <input
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
          placeholder="Scenario label (e.g. 'Ship onboarding v2')"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            className="col-span-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
            placeholder="Metric to perturb"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          />
          <div className="flex items-center gap-1">
            <input
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px]"
              placeholder="%"
              value={deltaPct}
              onChange={(e) => setDeltaPct(e.target.value)}
              type="number"
              inputMode="decimal"
            />
            <span className="text-[11px] text-gray-500">%</span>
          </div>
        </div>
        <div className="flex justify-end">
          <ActionButton
            label={busy ? "Running…" : "Run scenario"}
            variant="primary"
            compact
            disabled={busy || !label || !metric}
            onClick={run}
          />
        </div>
      </div>

      {!lastSim ? (
        <WidgetEmpty>Run a scenario above to see the projected delta.</WidgetEmpty>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-white/60 p-3">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[12.5px] font-semibold text-gray-900">
                {lastSim.scenario_label}
              </div>
              <div className="text-[11px] text-gray-500">
                run {new Date(lastSim.ran_at).toLocaleString()}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[20px] font-semibold tabular-nums text-gray-900">
                {lastSim.scenario_health.toFixed(0)}
                <span className="ml-1 text-[11px] font-normal text-gray-500">twin</span>
              </div>
              <div
                className={cn(
                  "text-[11.5px] font-medium",
                  lastSim.health_delta > 0 ? "text-emerald-600" : lastSim.health_delta < 0 ? "text-rose-600" : "text-gray-500",
                )}
              >
                {lastSim.health_delta > 0 ? "+" : ""}
                {lastSim.health_delta.toFixed(1)} from baseline
              </div>
            </div>
          </div>
          <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
            {lastSim.metrics.map((m, i) => (
              <li
                key={`${m.metric_label}-${i}`}
                className="flex items-center justify-between text-[11.5px]"
              >
                <span className="truncate text-gray-700">{m.metric_label}</span>
                <span className="ml-2 shrink-0 tabular-nums text-gray-500">
                  {formatNumber(m.baseline_value, m.unit)} →{" "}
                  <span className="font-medium text-gray-800">
                    {formatNumber(m.scenario_value, m.unit)}
                  </span>{" "}
                  <span className="text-gray-400">
                    ({m.delta_pct > 0 ? "+" : ""}
                    {(m.delta_pct * 100).toFixed(0)}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

    </Surface>
  );
}
