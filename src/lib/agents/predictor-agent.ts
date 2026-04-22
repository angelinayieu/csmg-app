// ── Predictor agent (Tier 5 v1) ────────────────────────────────────────
//
// First real agent implementation. Given an app with an active
// sub-strategy + a predictor agent declared in the parent proposal's
// agent_specs, produces a prediction based on the metric's observation
// history and writes it to prediction_ledger with agent_id populated.
//
// v1 method: linear extrapolation from the two most recent observations.
//   - predicted_value = last + (last - prev) * (horizon_days / observation_gap_days)
//   - When there's only one observation, uses "last value hold" (flat forecast).
//   - When there are zero observations, skips (nothing to predict from).
//
// v2 will use an LLM to read the observation history + app context +
// external signals and produce a richer forecast. The storage contract
// (prediction_ledger.agent_id, .rationale, .confidence, .predicted_value)
// is identical — only the `method` field on the audit row differs.
//
// Skip conditions (none of these are errors):
//   - No active sub-strategy with prediction_spec → nothing to predict
//   - No metrics_to_track[] entries → nothing to predict
//   - Target metric has an open prediction from this agent already → no duplicate
//   - Target metric has no tracker + no observations → nothing to extrapolate from

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import { hydrateAppStrategy } from "@/types/app-strategy";
import type { AppStrategyRow, AppStrategy } from "@/types/app-strategy";
import type { AppRow } from "@/types/app";
import { hydrateApp } from "@/types/app";
import type { AgentRoleKind, AgentSpec } from "@/types/strategy";
import type { PredictorOutput } from "@/types/agent-run";
import { normalizeMetricLabel, findMatchingLabel } from "@/lib/strategy/normalize-metric-label";

// Supabase generic collapse — match convention used elsewhere in the codebase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

export interface PredictorAgentInput {
  db: DB;
  /** App to run the predictor for. */
  appRow: AppRow;
  /** Active sub-strategy for the app; must have a prediction_spec. */
  subStrategy: AppStrategy;
  /** The AgentSpec for the predictor role (from parent proposal's agent_specs). */
  agentSpec: AgentSpec;
}

export type PredictorRunResult =
  | {
      status: "completed";
      predictionId: string;
      metricLabel: string;
      predictedValue: number;
      horizonDays: number;
      method: PredictorOutput["method"];
    }
  | {
      status: "skipped";
      note: string;
    }
  | {
      status: "failed";
      note: string;
    };

// Minimum gap between two observations (in days) for linear extrapolation
// to be meaningful. Below this, we fall back to last_value_hold — two
// observations 10 minutes apart don't imply a trend.
const MIN_EXTRAPOLATION_GAP_DAYS = 0.25;

// How many recent observations to pull. Two is enough for linear; we
// fetch three in case the most recent is an outlier we want to skip in v2.
const OBSERVATION_LOOKBACK = 5;

/**
 * Run a single predictor pass. Pure-ish from the caller's perspective
 * (reads DB, maybe writes one prediction_ledger row; doesn't touch any
 * other state). Scheduler decides when this runs; this function decides
 * whether there's something to predict.
 */
export async function runPredictorAgent(
  input: PredictorAgentInput,
): Promise<PredictorRunResult> {
  const { db, appRow, subStrategy, agentSpec } = input;
  const predictionSpec = subStrategy.spec?.prediction_spec;

  if (!predictionSpec || predictionSpec.metrics_to_track.length === 0) {
    return {
      status: "skipped",
      note: "No prediction_spec or empty metrics_to_track in active sub-strategy",
    };
  }

  // v1: predict the FIRST metric in metrics_to_track. Multi-metric
  // support (one prediction per metric per run) lands in v2 — this
  // keeps the cron cheap and avoids duplicate predictions racing with
  // the linear-extrapolation window.
  const targetMetric = predictionSpec.metrics_to_track[0];
  const metricLabel = targetMetric.label;
  const horizonDays =
    targetMetric.horizon_days ?? predictionSpec.default_horizon_days ?? 30;

  // De-dup guard: if this agent has an OPEN prediction for this metric
  // already, skip. Prevents piling up three open predictions for the
  // same metric across three runs that land within the horizon.
  const { data: openForMetric } = await db
    .from("prediction_ledger")
    .select("id")
    .eq("app_id", appRow.id)
    .eq("agent_id", agentSpec.id)
    .eq("metric_label", metricLabel)
    .eq("status", "open")
    .limit(1);

  if (openForMetric && openForMetric.length > 0) {
    return {
      status: "skipped",
      note: `Agent already has an open prediction for "${metricLabel}" — deferring`,
    };
  }

  // Look up the tracker + observation history. Three join paths:
  //   1. targetMetric.tracker_id is set → use directly (happy path)
  //   2. No tracker_id → look up by (space_id, label) and use if found
  //   3. No tracker → fall back to last_value_hold using strategy_baseline
  //      metric_baselines if available; otherwise skip.
  let trackerId: string | null = targetMetric.tracker_id ?? null;
  let trackerUnit: string | null = targetMetric.unit ?? null;

  if (!trackerId) {
    // Exact-match first (index-friendly). If that misses, fall back to
    // normalized matching so drift like "NPS (Enterprise)" vs "NPS for
    // Enterprise Segment" still joins. Normalized path loads all active
    // trackers for the space (cheap — typically < 20 per space) and
    // matches in memory via normalizeMetricLabel.
    const { data: exactRow } = await db
      .from("metric_trackers")
      .select("id, unit, label")
      .eq("space_id", appRow.space_id)
      .eq("label", metricLabel)
      .eq("status", "active")
      .maybeSingle();
    if (exactRow) {
      trackerId = exactRow.id as string;
      trackerUnit = (exactRow.unit as string | null) ?? trackerUnit;
    } else {
      // Tier 6: normalized fallback. Prevents silent drift loss.
      const { data: allTrackers } = await db
        .from("metric_trackers")
        .select("id, unit, label")
        .eq("space_id", appRow.space_id)
        .eq("status", "active");
      const candidates = (allTrackers ?? []) as Array<{ id: string; unit: string | null; label: string }>;
      const matchLabel = findMatchingLabel(metricLabel, candidates.map((c) => c.label));
      if (matchLabel) {
        const matched = candidates.find((c) => c.label === matchLabel);
        if (matched) {
          trackerId = matched.id;
          trackerUnit = matched.unit ?? trackerUnit;
          console.log(
            `[predictor-agent] normalized label match: "${metricLabel}" → tracker "${matchLabel}" ` +
            `(norm="${normalizeMetricLabel(metricLabel)}")`,
          );
        }
      }
    }
  }

  // Collect numeric observations. Oldest-first so linear extrapolation
  // math reads naturally. Limit enforced by OBSERVATION_LOOKBACK.
  let observations: Array<{ value: number; recorded_at: string }> = [];
  if (trackerId) {
    const { data: obsRows } = await db
      .from("metric_observations")
      .select("value, recorded_at")
      .eq("tracker_id", trackerId)
      .not("value", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(OBSERVATION_LOOKBACK);
    observations = (obsRows ?? [])
      .filter((o: { value: unknown }) => typeof o.value === "number")
      .map((o: { value: number; recorded_at: string }) => ({
        value: Number(o.value),
        recorded_at: o.recorded_at,
      }))
      .reverse(); // oldest-first
  }

  // Prediction computation
  let predictedValue: number | null = null;
  let method: PredictorOutput["method"] = "last_value_hold";
  let rationale = "";

  if (observations.length >= 2) {
    // Linear extrapolation from last two observations.
    const [prev, last] = observations.slice(-2);
    const gapDays =
      (new Date(last.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) /
      (1000 * 60 * 60 * 24);
    if (gapDays >= MIN_EXTRAPOLATION_GAP_DAYS) {
      const slopePerDay = (last.value - prev.value) / gapDays;
      predictedValue = last.value + slopePerDay * horizonDays;
      method = "linear_extrapolation";
      rationale =
        `Linear extrapolation from last 2 observations: ` +
        `${prev.value.toFixed(2)} → ${last.value.toFixed(2)} ` +
        `(${gapDays.toFixed(1)}d gap) = ${slopePerDay.toFixed(3)}/day × ${horizonDays}d horizon. ` +
        `Predictor agent v1 (trend-only).`;
    } else {
      // Gap too short — flat hold.
      predictedValue = last.value;
      rationale = `Last-value hold (${last.value.toFixed(2)}); observation gap (${gapDays.toFixed(2)}d) below extrapolation threshold.`;
    }
  } else if (observations.length === 1) {
    predictedValue = observations[0].value;
    rationale = `Last-value hold (${observations[0].value.toFixed(2)}); only one observation available.`;
  } else {
    // No observations — try strategy_baseline as a seed value.
    const { data: baselineRow } = await db
      .from("strategy_baselines")
      .select("metric_baselines")
      .eq("space_id", appRow.space_id)
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const baselines = (baselineRow?.metric_baselines as Array<{
      label: string;
      value?: number;
    }> | null) ?? [];
    const seed = baselines.find((b) => b.label === metricLabel);
    if (seed && typeof seed.value === "number") {
      predictedValue = seed.value;
      rationale = `Last-value hold from T0 baseline (${seed.value.toFixed(2)}); no observations recorded yet.`;
    } else {
      return {
        status: "skipped",
        note: `No observations + no baseline value for "${metricLabel}" — nothing to extrapolate from`,
      };
    }
  }

  if (predictedValue === null || !Number.isFinite(predictedValue)) {
    return {
      status: "skipped",
      note: `Computed non-finite predicted value for "${metricLabel}"`,
    };
  }

  // Clamp confidence: the sub-strategy's default_confidence is an upper
  // bound; methods further damp it. Linear extrapolation is the most
  // confident (0.85×); last-value hold from observations is moderate
  // (0.7×); seeded-from-baseline is low (0.4×).
  const methodDamp =
    method === "linear_extrapolation"
      ? 0.85
      : observations.length > 0
        ? 0.7
        : 0.4;
  const confidence = Math.max(
    0,
    Math.min(1, (predictionSpec.default_confidence ?? 0.6) * methodDamp),
  );

  const horizonAt = new Date(
    Date.now() + horizonDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Tier 6: populate entity_ids from the app's dominant_entity_ids so
  // predictions carry the KG lineage the metric label lacks. This lets
  // cascade staleness (flagAppsByEntityChange) mark predictions stale
  // when their underlying entities change, and lets the rollup
  // surface "how many predictions reference entity X."
  //
  // Why app.dominant_entity_ids specifically: it's the existing
  // authoritative "which entities does this app care about" link
  // (apps migration 20260428:101, populated by app-generator from
  // infrastructure_map core_components + micro_tactics.entity_id).
  // The tracker's source_id would be more precise but it's text and
  // stores micro_tactic.id, not entity_id — no clean join.
  const predictionEntityIds = Array.isArray(appRow.dominant_entity_ids)
    ? appRow.dominant_entity_ids
    : [];

  const { data: inserted, error: insertErr } = await db
    .from("prediction_ledger")
    .insert({
      space_id: appRow.space_id,
      user_id: appRow.user_id,
      app_id: appRow.id,
      agent_id: agentSpec.id,
      tracker_id: trackerId,
      metric_label: metricLabel,
      metric_unit: trackerUnit,
      horizon_at: horizonAt,
      predicted_value: predictedValue,
      rationale,
      confidence,
      status: "open",
      entity_ids: predictionEntityIds,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return {
      status: "failed",
      note: insertErr?.message ?? "prediction_ledger insert returned no row",
    };
  }

  return {
    status: "completed",
    predictionId: inserted.id as string,
    metricLabel,
    predictedValue,
    horizonDays,
    method,
  };
}

// ── Helpers used by the scheduler ──────────────────────────────────────

/**
 * Extract the predictor agent spec from a sub-strategy's parent_proposal_snapshot.
 * Returns null when no predictor is declared — scheduler should skip those apps.
 */
export function findPredictorAgent(subStrategy: AppStrategy): AgentSpec | null {
  const snap = subStrategy.parent_proposal_snapshot as
    | { agent_specs?: AgentSpec[] }
    | null;
  if (!snap?.agent_specs) return null;
  return (
    snap.agent_specs.find((a) => (a.role as AgentRoleKind) === "predictor") ?? null
  );
}

/**
 * Hydrate an AppStrategyRow to the typed domain shape. Re-exported from
 * app-strategy.ts so the scheduler doesn't need two imports.
 */
export function hydrateSubStrategy(row: AppStrategyRow): AppStrategy {
  return hydrateAppStrategy(row);
}

/**
 * Hydrate an AppRow. Re-exported for symmetry.
 */
export function hydrateAppForAgent(row: AppRow) {
  return hydrateApp(row);
}

// Marker type so consumers importing Json don't have to reach into db types.
export type { Json };
