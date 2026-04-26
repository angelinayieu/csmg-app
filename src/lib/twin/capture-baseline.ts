// Baseline capture — called from /api/pipeline/strategy-refresh after a
// strategy_snapshots row is written. Writes:
//
//   1. one strategy_baselines row holding (kg_snapshot, twin_state,
//      metric_baselines, predicted_outcomes) at T0
//   2. N prediction_ledger rows, one per predicted outcome extracted from
//      the strategy structure
//
// Shape rationale:
// - We derive predictions from the strategy's own structure (perspectives,
//   micro_tactics, learning_loop) rather than running a fresh LLM call.
//   The strategy already emits current→target, timeframes, and
//   leading_indicator cadences — use them. A calibrated-prediction LLM
//   step can be added later without changing the storage shape.
// - Horizons come from timeframe enums via HORIZON_DAYS. Intentionally
//   coarse — a "short_term" tactic that takes 21d vs 30d doesn't matter
//   for deviation tagging. If the strategy has explicit dates (e.g.
//   benchmark milestones), we prefer those.
// - The function is non-critical: a failure should NOT block strategy
//   delivery. The caller wraps in try/catch and logs.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { StrategicRecommendation, MicroTactic, StrategyPerspective } from "@/types/strategy";
import type {
  KgSnapshot,
  MetricBaseline,
  PredictedOutcome,
  PredictionLedgerInsert,
} from "@/types/prediction";
import { computeTwinState } from "@/lib/twin/compute-twin-state";

// Supabase's query-builder generics narrow to `never` across function
// boundaries, so the rest of the codebase uses `SupabaseClient<Database> | any`
// (see src/lib/pipeline/app-generator.ts). Follow that convention.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

// ── Horizon mapping ─────────────────────────────────────────────────────
//
// Maps the strategy's coarse timeframe enums to concrete days-from-now.
// Kept in one place so the resolver and any UI timeline share the same
// definition. Values are upper-ish estimates — a "short_term" tactic
// evaluated at day 30 won't misclassify a still-in-progress prediction
// as a surprise, which is what we want.

const HORIZON_DAYS: Record<string, number> = {
  now: 7,
  short_term: 30,
  medium_term: 90,
  long_term: 180,
};

function horizonFromTimeframe(tf: string | undefined, baseAt: Date): string {
  const days = HORIZON_DAYS[tf ?? "short_term"] ?? HORIZON_DAYS.short_term;
  const out = new Date(baseAt.getTime() + days * 24 * 60 * 60 * 1000);
  return out.toISOString();
}

// ── KG snapshot ─────────────────────────────────────────────────────────

function buildKgSnapshot(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  healthScore: number,
): KgSnapshot {
  // Bridge edges = edges whose removal would increase component count by 1.
  // Here we use the pre-computed knowledge_layer === "bridge" flag which is
  // the cheaper version of the same signal; full bridge analysis is computed
  // during synthesis and we don't want to duplicate it.
  const bridgeCount = edges.filter((e) => e.knowledge_layer === "bridge").length;

  // Orphan = entity with zero edges. Count both directions.
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.source_entity_id);
    connected.add(edge.target_entity_id);
  }
  const orphans = entities.filter((e) => !connected.has(e.entity_id)).length;
  const orphanRatio = entities.length > 0 ? orphans / entities.length : 0;

  const avgConfidence =
    entities.length > 0
      ? entities.reduce((sum, e) => sum + (e.confidence ?? 0), 0) / entities.length
      : 0;

  return {
    entity_count: entities.length,
    edge_count: edges.length,
    cycle_count: cycles.length,
    bridge_count: bridgeCount,
    orphan_ratio: Number(orphanRatio.toFixed(3)),
    avg_confidence: Number(avgConfidence.toFixed(3)),
    health_score: healthScore,
  };
}

// ── Metric baselines ────────────────────────────────────────────────────

/**
 * Pull existing metric_trackers for the space and pair them with fallback
 * entries derived from the strategy text when a metric referenced in the
 * strategy has no tracker yet. The union is what the baseline row stores —
 * subsequent regens will often have more trackers (because approve-and-launch
 * creates them), and that's fine: each baseline is a snapshot-in-time.
 */
async function buildMetricBaselines(
  db: DB,
  spaceId: string,
  recommendation: StrategicRecommendation,
): Promise<MetricBaseline[]> {
  const baselines: MetricBaseline[] = [];
  const seen = new Set<string>(); // dedupe by label — trackers first, then text fallbacks

  // 1. Active trackers (authoritative current values)
  const { data: trackers } = await db
    .from("metric_trackers")
    .select("id, label, current_value, current_text, unit, source_kind")
    .eq("space_id", spaceId)
    .eq("status", "active");

  for (const t of trackers ?? []) {
    if (seen.has(t.label)) continue;
    seen.add(t.label);
    baselines.push({
      tracker_id: t.id,
      label: t.label,
      value: t.current_value ?? undefined,
      value_text: t.current_text ?? undefined,
      unit: t.unit ?? undefined,
      source_kind: t.source_kind,
      captured_from: "tracker",
    });
  }

  // 2. Strategy-text fallbacks for metrics without trackers yet
  for (const p of recommendation.perspectives ?? []) {
    const label = p.key_metric?.name;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const raw = p.key_metric?.current;
    const numeric = raw !== undefined ? Number(raw) : NaN;
    baselines.push({
      label,
      value: Number.isFinite(numeric) ? numeric : undefined,
      value_text: Number.isFinite(numeric) ? undefined : (raw ?? undefined),
      unit: p.key_metric?.unit ?? undefined,
      source_kind: "perspective_key_metric",
      captured_from: "strategy_text",
    });
  }
  for (const t of recommendation.micro_tactics ?? []) {
    const label = t.metric?.name;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const raw = t.metric?.current_value;
    const numeric = raw !== undefined ? Number(raw) : NaN;
    baselines.push({
      label,
      value: Number.isFinite(numeric) ? numeric : undefined,
      value_text: Number.isFinite(numeric) ? undefined : (typeof raw === "string" ? raw : undefined),
      unit: t.metric?.unit ?? undefined,
      source_kind: "micro_tactic_metric",
      captured_from: "strategy_text",
    });
  }

  return baselines;
}

// ── Predicted outcomes ──────────────────────────────────────────────────

/**
 * Extract forward-looking forecasts from the strategy's own structure.
 * Sources ranked by reliability:
 *   1. learning_loop.lagging_indicator (explicit deadline)     — highest signal
 *   2. learning_loop.leading_indicators (cadence-based horizon)
 *   3. perspective.key_metric (timeframe from actions[].timeframe)
 *   4. micro_tactics.metric (timeframe from tactic.timeframe)
 *
 * Confidence cascades: top-level recommendation.confidence / 100 is the
 * cap; each layer can dial down if the strategy emits a per-element
 * confidence (currently only perspectives expose one).
 */
function extractPredictedOutcomes(
  recommendation: StrategicRecommendation,
  generatedAt: Date,
): PredictedOutcome[] {
  const outcomes: PredictedOutcome[] = [];
  const baseConfidence = Math.max(0, Math.min(1, (recommendation.confidence ?? 50) / 100));

  const confFromTier = (tier: StrategyPerspective["confidence"] | undefined): number => {
    if (!tier) return baseConfidence;
    const cap = tier === "high" ? 0.9 : tier === "moderate" ? 0.65 : 0.4;
    return Math.min(baseConfidence, cap);
  };

  // 1. Lagging indicator (usually the goal / target_objective)
  const lagging = recommendation.learning_loop?.lagging_indicator;
  if (lagging?.metric) {
    const deadlineIso = parseDeadlineToISO(lagging.deadline, generatedAt);
    const raw = lagging.target;
    const numeric = raw !== undefined ? Number(raw) : NaN;
    outcomes.push({
      metric_label: lagging.metric,
      horizon_at: deadlineIso,
      predicted_value: Number.isFinite(numeric) ? numeric : undefined,
      predicted_text: Number.isFinite(numeric) ? undefined : raw,
      confidence: baseConfidence,
      rationale: `Lagging indicator target from strategy learning_loop. Deadline: ${lagging.deadline ?? "unspecified"}.`,
      source: "lagging_indicator",
    });
  }

  // 2. Leading indicators — cadence → horizon
  for (const li of recommendation.learning_loop?.leading_indicators ?? []) {
    if (!li.metric) continue;
    const horizonDays =
      li.cadence === "daily" ? 7
      : li.cadence === "weekly" ? 21
      : li.cadence === "biweekly" ? 42
      : li.cadence === "monthly" ? 60
      : 30;
    const horizonAt = new Date(generatedAt.getTime() + horizonDays * 24 * 60 * 60 * 1000).toISOString();
    // Leading indicators don't expose a target value; we treat the "green reading"
    // as the prediction boundary — if actual falls outside green, deviation fires.
    outcomes.push({
      metric_label: li.metric,
      horizon_at: horizonAt,
      predicted_text: li.green_reading || "on-track",
      confidence: baseConfidence * 0.9, // slightly damped — leading = less certain
      rationale: `Leading indicator expected to read "${li.green_reading ?? "on-track"}" at ${li.cadence} cadence; measurement method: ${li.measurement_method ?? "n/a"}.`,
      source: "leading_indicator",
    });
  }

  // 3. Perspective key metrics — timeframe from first action
  for (const p of recommendation.perspectives ?? []) {
    if (!p.key_metric?.name) continue;
    const firstAction = p.actions?.[0];
    const horizon = horizonFromTimeframe(firstAction?.timeframe, generatedAt);
    const raw = p.key_metric.target;
    const numeric = raw !== undefined ? Number(raw) : NaN;
    outcomes.push({
      metric_label: p.key_metric.name,
      horizon_at: horizon,
      predicted_value: Number.isFinite(numeric) ? numeric : undefined,
      predicted_text: Number.isFinite(numeric) ? undefined : raw,
      unit: p.key_metric.unit,
      confidence: confFromTier(p.confidence),
      rationale: `Perspective "${p.name}" targets ${p.key_metric.name}: ${p.key_metric.current} → ${p.key_metric.target}${p.key_metric.unit ? ` ${p.key_metric.unit}` : ""}.`,
      source: "perspective_key_metric",
      source_id: p.id,
    });
  }

  // 4. Micro tactic metrics
  for (const t of recommendation.micro_tactics ?? []) {
    if (!t.metric?.name) continue;
    const horizon = horizonFromTimeframe(t.timeframe, generatedAt);
    const raw = t.metric.target;
    const numeric = raw !== undefined ? Number(raw) : NaN;
    outcomes.push({
      metric_label: t.metric.name,
      horizon_at: horizon,
      predicted_value: Number.isFinite(numeric) ? numeric : undefined,
      predicted_text: Number.isFinite(numeric) ? undefined : raw,
      unit: t.metric.unit,
      // Tactic-level confidence: scale by impact (high=1, med=0.8, low=0.6)
      confidence: baseConfidence * impactScale(t),
      rationale: `Micro tactic "${t.title}" targets ${t.metric.name} = ${t.metric.target}${t.metric.unit ? ` ${t.metric.unit}` : ""} within ${t.timeframe}.`,
      source: "micro_tactic_metric",
      source_id: t.id,
    });
  }

  return outcomes;
}

function impactScale(t: MicroTactic): number {
  if (t.impact === "high") return 1.0;
  if (t.impact === "medium") return 0.8;
  return 0.6;
}

/**
 * Parse a human-entered deadline string ("2026-07-01", "in 90 days",
 * "end of Q3") into an ISO timestamp. Falls back to generatedAt + 90d
 * when the string is unparseable — better than dropping the prediction.
 */
function parseDeadlineToISO(deadline: string | undefined, generatedAt: Date): string {
  if (!deadline) return new Date(generatedAt.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  // Try ISO / Date.parse first
  const direct = Date.parse(deadline);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  // "in N days" / "N days"
  const dayMatch = deadline.match(/(\d+)\s*day/i);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    return new Date(generatedAt.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  // "N weeks" / "N months"
  const weekMatch = deadline.match(/(\d+)\s*week/i);
  if (weekMatch) {
    return new Date(generatedAt.getTime() + Number(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  const monthMatch = deadline.match(/(\d+)\s*month/i);
  if (monthMatch) {
    return new Date(generatedAt.getTime() + Number(monthMatch[1]) * 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  // Fallback: 90 days out
  return new Date(generatedAt.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
}

// ── Public entry point ─────────────────────────────────────────────────

export interface CaptureBaselineArgs {
  db: DB;
  spaceId: string;
  userId: string;
  strategySnapshotId: string;
  recommendation: StrategicRecommendation;
  space: Space;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  synthesisData: SynthesisData | null;
  activeGoal?: ImprovementGoal | null;
  /** ISO timestamp from strategy_snapshots.created_at — keeps horizons deterministic. */
  generatedAt: string;
  /** Defaults to "pipeline:strategy-refresh". Override for backfill jobs. */
  createdBy?: string;
}

export interface CaptureBaselineResult {
  baselineId: string;
  predictionsWritten: number;
  /** Non-fatal notes — tracker missing, strategy field empty, etc. */
  notes: string[];
}

/**
 * Capture the T0 baseline for a freshly-written strategy snapshot.
 *
 * Safe to call multiple times for the same strategy_snapshot_id: the
 * unique constraint on strategy_baselines.strategy_snapshot_id will cause
 * the insert to fail, which we catch and treat as idempotent. Predictions
 * are NOT re-inserted on the second call.
 */
export async function captureBaseline(
  args: CaptureBaselineArgs,
): Promise<CaptureBaselineResult | null> {
  const {
    db, spaceId, userId, strategySnapshotId, recommendation,
    space, entities, edges, cycles, synthesisData, activeGoal,
    generatedAt, createdBy = "pipeline:strategy-refresh",
  } = args;

  const notes: string[] = [];
  const generatedAtDate = new Date(generatedAt);

  // 1. Compute twin state at T0
  let twinState;
  try {
    twinState = computeTwinState(space, entities, edges, cycles, synthesisData, activeGoal ?? null);
  } catch (err) {
    console.warn("[capture-baseline] computeTwinState failed, capturing without twin state", err);
    notes.push("twin_state_unavailable");
    twinState = null;
  }

  // 2. Build KG snapshot
  const healthScore = twinState?.macro?.health_score ?? 0;
  const kgSnapshot = buildKgSnapshot(entities, edges, cycles, healthScore);

  // 3. Build metric baselines
  let metricBaselines: MetricBaseline[];
  try {
    metricBaselines = await buildMetricBaselines(db, spaceId, recommendation);
  } catch (err) {
    console.warn("[capture-baseline] metric_trackers read failed, capturing strategy-text only", err);
    notes.push("metric_trackers_read_failed");
    metricBaselines = [];
  }

  // 4. Extract predicted outcomes from strategy
  const predictedOutcomes = extractPredictedOutcomes(recommendation, generatedAtDate);
  if (predictedOutcomes.length === 0) {
    notes.push("no_predicted_outcomes_extractable");
  }

  // 5. Insert baseline row (idempotent via unique constraint)
  const { data: baselineRow, error: baseErr } = await db
    .from("strategy_baselines")
    .insert({
      strategy_snapshot_id: strategySnapshotId,
      space_id: spaceId,
      user_id: userId,
      kg_snapshot: kgSnapshot as unknown as Database["public"]["Tables"]["strategy_baselines"]["Insert"]["kg_snapshot"],
      twin_state: (twinState ?? {}) as unknown as Database["public"]["Tables"]["strategy_baselines"]["Insert"]["twin_state"],
      metric_baselines: metricBaselines as unknown as Database["public"]["Tables"]["strategy_baselines"]["Insert"]["metric_baselines"],
      predicted_outcomes: predictedOutcomes as unknown as Database["public"]["Tables"]["strategy_baselines"]["Insert"]["predicted_outcomes"],
      created_by: createdBy,
      capture_notes: notes.length > 0 ? notes.join(", ") : null,
    })
    .select("id")
    .single();

  if (baseErr) {
    // Unique-violation = already captured for this snapshot. Treat as success.
    if ((baseErr as { code?: string }).code === "23505") {
      console.log(`[capture-baseline] baseline already exists for snapshot ${strategySnapshotId} — skipping`);
      return null;
    }
    console.warn("[capture-baseline] baseline insert failed:", baseErr);
    return null;
  }

  // 6. Materialize predicted_outcomes as prediction_ledger rows.
  //    Join to metric_trackers by label to set tracker_id when available.
  if (predictedOutcomes.length > 0) {
    const labelToTracker = new Map<string, { id: string; unit: string | null }>();
    for (const mb of metricBaselines) {
      if (mb.tracker_id) labelToTracker.set(mb.label, { id: mb.tracker_id, unit: mb.unit ?? null });
    }

    const rows: PredictionLedgerInsert[] = predictedOutcomes.map((po) => {
      const tracker = labelToTracker.get(po.metric_label);
      return {
        space_id: spaceId,
        user_id: userId,
        strategy_snapshot_id: strategySnapshotId,
        tracker_id: tracker?.id ?? null,
        metric_label: po.metric_label,
        metric_unit: po.unit ?? tracker?.unit ?? null,
        predicted_at: generatedAt,
        horizon_at: po.horizon_at,
        predicted_value: po.predicted_value ?? null,
        predicted_value_text: po.predicted_text ?? null,
        rationale: po.rationale,
        confidence: po.confidence,
        status: "open",
      };
    });

    const { error: predErr } = await db.from("prediction_ledger").insert(rows);
    if (predErr) {
      console.warn("[capture-baseline] prediction_ledger insert failed (baseline row still written):", predErr);
      notes.push("prediction_ledger_write_failed");
    }
  }

  // 7. Gap B — kick off reality calibration. Soft-fail: a calibration
  //    crash must NEVER block baseline delivery. The lab UI falls back
  //    to `status: "unknown"` (not a visible error — just an unlocked
  //    but unverified state) if this step fails.
  //
  //    Synchronous on purpose: this function already runs in a
  //    background capture trigger and the UI needs the row present
  //    before the next SpaceLab render. A fire-and-forget here would
  //    race against the user opening the lab.
  try {
    const { runRealityCalibration } = await import(
      "@/lib/pipeline/reality-calibration"
    );
    const { calibration } = await runRealityCalibration(db, {
      strategyBaselineId: baselineRow.id,
      spaceId,
      baselines: metricBaselines,
      entities,
      edges,
    });
    notes.push(`calibration:${calibration.status}`);
  } catch (err) {
    console.warn("[capture-baseline] reality-calibration failed (non-fatal):", err);
    notes.push("calibration_failed");
  }

  console.log(
    `[capture-baseline] wrote baseline ${baselineRow.id} + ${predictedOutcomes.length} predictions for snapshot ${strategySnapshotId}`,
  );

  return {
    baselineId: baselineRow.id,
    predictionsWritten: predictedOutcomes.length,
    notes,
  };
}
