// ── Item 4 digital-twin action handlers ────────────────────────────────
//
// Registered alongside the built-in handlers in action-dispatcher.ts.
// Each handler is a thin mutation layer over prediction_ledger /
// metric_observations; rendering lives in the widget components.
//
// Handlers are idempotent-ish: the same payload submitted twice either
// produces two ledger rows (for log_prediction — intentional, each
// submission is a separate forecast) or a no-op (for status transitions
// that are already at the target state).
//
// Imported for side effects from src/lib/apps/action-dispatcher.ts so
// registration happens once at module load.

import { registerActionHandler } from "./action-dispatcher";
import { tagDeviation } from "@/types/prediction";

// ── log_prediction ─────────────────────────────────────────────────────
//
// Predictor agent (or user via prediction_panel) emits a new forecast.
// Payload must include a metric_label, a horizon (ISO or days-from-now),
// and at least one of predicted_value / predicted_value_text. Optional
// tracker_id links to metric_trackers for automatic resolution.
//
// Payload:
//   {
//     metric_label: string;
//     horizon_at?: string;       // ISO; OR horizon_days number
//     horizon_days?: number;
//     predicted_value?: number;
//     predicted_value_text?: string;
//     rationale?: string;
//     confidence?: number;       // 0..1
//     tracker_id?: string;
//     agent_id?: string;         // optional attribution
//   }

registerActionHandler("log_prediction", async (ctx) => {
  const p = ctx.payload;
  const metricLabel = typeof p.metric_label === "string" ? p.metric_label : null;
  if (!metricLabel) return { ok: false, reason: "metric_label required" };

  const hasValue =
    typeof p.predicted_value === "number" ||
    (typeof p.predicted_value_text === "string" && p.predicted_value_text.length > 0);
  if (!hasValue) {
    return { ok: false, reason: "predicted_value or predicted_value_text required" };
  }

  // Accept either an ISO horizon or a days offset — widget can post whichever is
  // natural. Days-offset is clamped to 1..365 because the resolver's stale
  // window is 14d; <1 day predictions can't be resolved before they're surprises.
  let horizonAt: string;
  if (typeof p.horizon_at === "string") {
    const parsed = Date.parse(p.horizon_at);
    if (Number.isNaN(parsed)) return { ok: false, reason: "horizon_at must be ISO timestamp" };
    horizonAt = new Date(parsed).toISOString();
  } else {
    const days = Math.max(1, Math.min(365, Number(p.horizon_days ?? 30)));
    horizonAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const confidence =
    typeof p.confidence === "number"
      ? Math.max(0, Math.min(1, p.confidence))
      : null;

  // Tier 6: inherit entity_ids from the app. User-logged predictions
  // carry the same KG lineage as agent-emitted ones so cascade staleness
  // + aggregate queries treat them uniformly. Callers can override via
  // explicit p.entity_ids[] — matches the pattern of agent_id override.
  const entityIds: string[] = Array.isArray(p.entity_ids)
    ? (p.entity_ids as unknown[]).filter((v): v is string => typeof v === "string")
    : Array.isArray(ctx.app.dominant_entity_ids)
      ? ctx.app.dominant_entity_ids
      : [];

  const { error } = await ctx.db.from("prediction_ledger").insert({
    space_id: ctx.app.space_id,
    user_id: ctx.userId,
    app_id: ctx.app.id,
    agent_id: typeof p.agent_id === "string" ? p.agent_id : null,
    tracker_id: typeof p.tracker_id === "string" ? p.tracker_id : null,
    metric_label: metricLabel,
    metric_unit: typeof p.metric_unit === "string" ? p.metric_unit : null,
    horizon_at: horizonAt,
    predicted_value: typeof p.predicted_value === "number" ? p.predicted_value : null,
    predicted_value_text:
      typeof p.predicted_value_text === "string" ? p.predicted_value_text : null,
    rationale: typeof p.rationale === "string" ? p.rationale : null,
    confidence,
    status: "open",
    entity_ids: entityIds,
  });

  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    updated_app: ctx.app,
    change_type: "user_edit",
    change_summary: `Logged prediction: ${metricLabel}`,
  };
});

// ── start_experiment ───────────────────────────────────────────────────
//
// Validator flow phase 1: seed a prediction row tagged as experimental.
// Under the hood this is just log_prediction + a marker in the rationale.
// Item 4 keeps them distinct at the action layer so a future
// "experiments" surface (bench of open validations) can filter by it.
//
// Payload: same as log_prediction + required `hypothesis: string`

registerActionHandler("start_experiment", async (ctx) => {
  const p = ctx.payload;
  const hypothesis = typeof p.hypothesis === "string" ? p.hypothesis : null;
  if (!hypothesis) return { ok: false, reason: "hypothesis required" };

  const metricLabel = typeof p.metric_label === "string" ? p.metric_label : null;
  if (!metricLabel) return { ok: false, reason: "metric_label required" };

  const days = Math.max(1, Math.min(365, Number(p.horizon_days ?? 14)));
  const horizonAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  // Tier 6: inherit entity_ids from the app — same pattern as log_prediction.
  const expEntityIds: string[] = Array.isArray(p.entity_ids)
    ? (p.entity_ids as unknown[]).filter((v): v is string => typeof v === "string")
    : Array.isArray(ctx.app.dominant_entity_ids)
      ? ctx.app.dominant_entity_ids
      : [];

  const { data: inserted, error } = await ctx.db
    .from("prediction_ledger")
    .insert({
      space_id: ctx.app.space_id,
      user_id: ctx.userId,
      app_id: ctx.app.id,
      agent_id: typeof p.agent_id === "string" ? p.agent_id : "validator",
      tracker_id: typeof p.tracker_id === "string" ? p.tracker_id : null,
      metric_label: metricLabel,
      horizon_at: horizonAt,
      predicted_value: typeof p.predicted_value === "number" ? p.predicted_value : null,
      predicted_value_text:
        typeof p.predicted_value_text === "string"
          ? p.predicted_value_text
          : `Hypothesis: ${hypothesis}`,
      rationale: `[experiment] ${hypothesis}`,
      confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
      status: "open",
      entity_ids: expEntityIds,
    })
    .select("id")
    .single();

  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    updated_app: ctx.app,
    extra: { experiment_id: inserted?.id },
    change_type: "user_edit",
    change_summary: `Started experiment: ${hypothesis.slice(0, 60)}`,
  };
});

// ── end_experiment ─────────────────────────────────────────────────────
//
// Validator flow phase 2: user or validator agent writes the actual. The
// handler resolves the prediction (numeric path uses tagDeviation from
// the shared threshold module; qualitative path just records the text
// and tags "qualitative").
//
// Payload:
//   {
//     prediction_id: string;
//     actual_value?: number;
//     actual_text?: string;
//     notes?: string;
//   }

registerActionHandler("end_experiment", async (ctx) => {
  const p = ctx.payload;
  const predictionId = typeof p.prediction_id === "string" ? p.prediction_id : null;
  if (!predictionId) return { ok: false, reason: "prediction_id required" };

  const hasActual =
    typeof p.actual_value === "number" ||
    (typeof p.actual_text === "string" && p.actual_text.length > 0);
  if (!hasActual) return { ok: false, reason: "actual_value or actual_text required" };

  // Load the prediction so we can compute deviation (requires predicted_value)
  const { data: pred, error: selErr } = await ctx.db
    .from("prediction_ledger")
    .select("id, predicted_value, status")
    .eq("id", predictionId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (selErr) return { ok: false, reason: selErr.message };
  if (!pred) return { ok: false, reason: "prediction not found or not owned" };
  if (pred.status !== "open") {
    return { ok: false, reason: `prediction is ${pred.status}; only open predictions can be ended` };
  }

  // Numeric resolution path
  let update: Record<string, unknown>;
  if (typeof p.actual_value === "number" && pred.predicted_value !== null) {
    const predicted = Number(pred.predicted_value);
    const actual = p.actual_value;
    update = {
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_actual: actual,
      deviation: actual - predicted,
      deviation_tag: tagDeviation(predicted, actual),
      resolution_notes:
        typeof p.notes === "string"
          ? `Experiment ended by user: ${p.notes}`
          : "Experiment ended by user",
    };
  } else {
    // Qualitative resolution
    update = {
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_actual_text:
        typeof p.actual_text === "string"
          ? p.actual_text
          : String(p.actual_value ?? ""),
      deviation_tag: "qualitative",
      resolution_notes:
        typeof p.notes === "string"
          ? `Experiment ended by user (qualitative): ${p.notes}`
          : "Experiment ended by user (qualitative)",
    };
  }

  const { error } = await ctx.db
    .from("prediction_ledger")
    .update(update)
    .eq("id", predictionId);
  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    updated_app: ctx.app,
    change_type: "user_edit",
    change_summary: `Ended experiment ${predictionId.slice(0, 8)}`,
  };
});

// ── apply_validation_result ────────────────────────────────────────────
//
// Resolver flow for qualitative predictions that the cron's auto-resolver
// left tagged "qualitative" pending a human or validator-agent call.
// Shape is intentionally the same as end_experiment's qualitative path so
// callers don't have to know which route produced the row.
//
// Payload: { prediction_id: string; result_text: string; deviation_tag?: DeviationTag }

registerActionHandler("apply_validation_result", async (ctx) => {
  const p = ctx.payload;
  const predictionId = typeof p.prediction_id === "string" ? p.prediction_id : null;
  const resultText = typeof p.result_text === "string" ? p.result_text : null;
  if (!predictionId || !resultText) {
    return { ok: false, reason: "prediction_id and result_text required" };
  }

  const allowedTags = ["expected", "regime_shift", "surprise", "qualitative"] as const;
  const tag =
    typeof p.deviation_tag === "string" &&
    (allowedTags as readonly string[]).includes(p.deviation_tag)
      ? (p.deviation_tag as (typeof allowedTags)[number])
      : "qualitative";

  const { error } = await ctx.db
    .from("prediction_ledger")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_actual_text: resultText,
      deviation_tag: tag,
      resolution_notes: "Validator result applied",
    })
    .eq("id", predictionId)
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    updated_app: ctx.app,
    change_type: "user_edit",
    change_summary: `Applied validation result (${tag})`,
  };
});

// ── record_deviation ───────────────────────────────────────────────────
//
// Manual tag annotation on a resolved prediction. Typical use: user looks
// at a resolver-tagged "regime_shift" and upgrades it to "surprise"
// because they know it's actually more meaningful than the math suggests.
//
// Payload: { prediction_id: string; deviation_tag: DeviationTag; notes?: string }

registerActionHandler("record_deviation", async (ctx) => {
  const p = ctx.payload;
  const predictionId = typeof p.prediction_id === "string" ? p.prediction_id : null;
  const tag = typeof p.deviation_tag === "string" ? p.deviation_tag : null;
  if (!predictionId || !tag) {
    return { ok: false, reason: "prediction_id and deviation_tag required" };
  }
  if (!["expected", "regime_shift", "surprise", "qualitative"].includes(tag)) {
    return { ok: false, reason: `invalid deviation_tag: ${tag}` };
  }

  const { error } = await ctx.db
    .from("prediction_ledger")
    .update({
      deviation_tag: tag,
      resolution_notes:
        typeof p.notes === "string" ? `[manual] ${p.notes}` : "Manual tag override",
    })
    .eq("id", predictionId)
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    updated_app: ctx.app,
    change_type: "user_edit",
    change_summary: `Re-tagged prediction as ${tag}`,
  };
});

// ── escalate_to_research ───────────────────────────────────────────────
//
// The loop-closer. A surprise deviation signals "the model's wrong about
// something" — this action adds a targeted research task to the space's
// research_schedule so the next self-improving-loop tick investigates.
//
// Implementation today: append a space_changelog entry + mark the space's
// research_schedule as bumped. Sprint: future versions will create a
// dedicated research_tasks row with the surprise as prompt context.
//
// Payload: { prediction_id: string; reason?: string }

registerActionHandler("escalate_to_research", async (ctx) => {
  const p = ctx.payload;
  const predictionId = typeof p.prediction_id === "string" ? p.prediction_id : null;
  if (!predictionId) return { ok: false, reason: "prediction_id required" };

  // Load the prediction for context
  const { data: pred } = await ctx.db
    .from("prediction_ledger")
    .select("metric_label, predicted_value, resolved_actual, deviation_tag")
    .eq("id", predictionId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!pred) return { ok: false, reason: "prediction not found" };

  const reason = typeof p.reason === "string" ? p.reason : null;
  const summary =
    `Escalated to research: ${pred.metric_label} ` +
    `(predicted ${pred.predicted_value ?? "?"}, actual ${pred.resolved_actual ?? "?"}, ` +
    `tag ${pred.deviation_tag ?? "?"})` +
    (reason ? ` — ${reason}` : "");

  // Write a changelog entry — this is the durable record of the escalation.
  // The research loop's next pass reads recent changelog entries of type
  // 'research_escalation' to seed research queries.
  try {
    const { data: latestCL } = await ctx.db
      .from("space_changelog")
      .select("version")
      .eq("space_id", ctx.app.space_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (latestCL?.version ?? 0) + 1;
    await ctx.db.from("space_changelog").insert({
      space_id: ctx.app.space_id,
      version,
      change_type: "research_escalation",
      summary,
      details: {
        prediction_id: predictionId,
        metric_label: pred.metric_label,
        deviation_tag: pred.deviation_tag,
        source_app_id: ctx.app.id,
      },
    });
  } catch (err) {
    console.warn("[action:escalate_to_research] changelog write failed:", err);
  }

  // Mark prediction so the UI knows it's been escalated (use resolution_notes)
  await ctx.db
    .from("prediction_ledger")
    .update({
      resolution_notes:
        (reason ? `[escalated: ${reason}] ` : "[escalated] ") +
        "forwarded to research queue",
    })
    .eq("id", predictionId);

  // Tier 3: also trigger a per-app sub-strategy regeneration. The
  // surprise deviation is exactly the signal that says "this app's
  // model of reality is wrong" — the sub-strategy needs to incorporate
  // the new pattern. Wrapped in a try/catch so a generation failure
  // doesn't block the escalation itself (the changelog entry above is
  // the durable record; sub-strategy regen is best-effort).
  //
  // Skipped when:
  //   - The deviation tag is "expected" or "qualitative" (not actually
  //     surprising; sub-strategy doesn't need updating)
  //   - The reason starts with "[skip-substrategy]" (caller can opt out)
  let substrategyTriggered = false;
  let substrategyId: string | null = null;
  const shouldRegenerate =
    pred.deviation_tag === "surprise" || pred.deviation_tag === "regime_shift";
  const optOut = (reason ?? "").startsWith("[skip-substrategy]");
  if (shouldRegenerate && !optOut) {
    try {
      const { generateAppStrategy } = await import("@/lib/pipeline/app-strategy-generator");
      const focusHint =
        `Recent surprise on metric "${pred.metric_label}": ` +
        `predicted ${pred.predicted_value ?? "?"}, actual ${pred.resolved_actual ?? "?"} ` +
        `(tag: ${pred.deviation_tag}). ` +
        (reason ? `User context: ${reason}.` : "") +
        " Consider: (a) tightening or loosening prediction confidence baseline, " +
        "(b) adding a hypothesis to the validation bank that tests the new pattern, " +
        "(c) narrowing focused_objective scope if the surprise reveals the prior scope was wrong.";
      const result = await generateAppStrategy({
        db: ctx.db,
        appId: ctx.app.id,
        triggeredBy: `user:${ctx.userId}:escalation`,
        triggerReason: `Deviation escalation: ${pred.metric_label} (${pred.deviation_tag})`,
        deviationFocusHint: focusHint,
        isDeviationDriven: true,
      });
      substrategyTriggered = true;
      substrategyId = result.app_strategy.id;
    } catch (regenErr) {
      console.warn(
        "[action:escalate_to_research] sub-strategy regen failed (non-critical):",
        regenErr,
      );
    }
  }

  return {
    ok: true,
    updated_app: ctx.app,
    change_type: "user_edit",
    change_summary: summary.slice(0, 100),
    extra: {
      changelog_summary: summary,
      substrategy_triggered: substrategyTriggered,
      substrategy_id: substrategyId,
    },
  };
});

// ── run_simulation ─────────────────────────────────────────────────────
//
// Minimum-viable what-if engine. Takes a simple perturbation spec and
// stores the result on app.state.last_simulation so the simulation_lab
// widget can render it. Does NOT write to prediction_ledger — scenarios
// are hypothetical, not forecasts.
//
// The actual "simulation" today is arithmetic: for each perturbation,
// multiply the relevant metric baseline by (1 + delta_pct) and recompute
// a crude health delta. This is intentionally simple. A real simulation
// engine (perturb entities → recompute TwinState) is future work; the
// storage shape + action contract here are the stable interface that
// engine will land behind.
//
// Payload:
//   {
//     scenario_label: string;
//     perturbations: Array<{
//       metric_label: string;       // matches strategy_baseline.metric_baselines[].label
//       delta_pct: number;          // e.g. 0.15 for +15%
//       rationale?: string;
//     }>;
//   }

registerActionHandler("run_simulation", async (ctx) => {
  const p = ctx.payload;
  const label = typeof p.scenario_label === "string" ? p.scenario_label : null;
  const perturbations = Array.isArray(p.perturbations)
    ? (p.perturbations as Array<Record<string, unknown>>)
    : null;
  if (!label || !perturbations || perturbations.length === 0) {
    return { ok: false, reason: "scenario_label + non-empty perturbations required" };
  }

  // Load the latest baseline to run against
  const { data: baseline } = await ctx.db
    .from("strategy_baselines")
    .select("kg_snapshot, metric_baselines")
    .eq("space_id", ctx.app.space_id)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const metricBaselines = Array.isArray(baseline?.metric_baselines)
    ? (baseline.metric_baselines as Array<{ label: string; value?: number; unit?: string }>)
    : [];
  const baselineHealth =
    (baseline?.kg_snapshot as { health_score?: number } | null)?.health_score ?? 50;

  // Compute per-metric scenario values and a crude health delta.
  // Health delta formula: sum of clamped (delta_pct * 10) bounded to [-30, +30].
  // Not meaningful as a forecast — exists so the widget has something to show.
  const simMetrics = perturbations.map((pert) => {
    const metricLabel = typeof pert.metric_label === "string" ? pert.metric_label : "";
    const deltaPct = typeof pert.delta_pct === "number" ? pert.delta_pct : 0;
    const base = metricBaselines.find((m) => m.label === metricLabel);
    const baseValue = base?.value ?? null;
    const scenarioValue = baseValue !== null ? baseValue * (1 + deltaPct) : null;
    return {
      metric_label: metricLabel,
      baseline_value: baseValue,
      scenario_value: scenarioValue,
      delta_pct: deltaPct,
      rationale: typeof pert.rationale === "string" ? pert.rationale : null,
      unit: base?.unit ?? null,
    };
  });

  const healthDelta = Math.max(
    -30,
    Math.min(
      30,
      simMetrics.reduce((sum, m) => sum + m.delta_pct * 10, 0),
    ),
  );

  const simulation = {
    scenario_label: label,
    ran_at: new Date().toISOString(),
    run_by: `user:${ctx.userId}`,
    baseline_health: baselineHealth,
    scenario_health: Math.max(0, Math.min(100, baselineHealth + healthDelta)),
    health_delta: healthDelta,
    metrics: simMetrics,
  };

  // Write to app.state.last_simulation. Not using patchAppState because
  // this is a single-field overwrite, not a diffed patch, and we want the
  // prior simulation to be fully replaced.
  const currentState = (ctx.app.state as Record<string, unknown>) ?? {};
  const newState = { ...currentState, last_simulation: simulation };

  const { data: updatedRow, error } = await ctx.db
    .from("apps")
    .update({ state: newState })
    .eq("id", ctx.app.id)
    .select("*")
    .single();
  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    updated_app: { ...ctx.app, state: newState as typeof ctx.app.state },
    extra: { simulation },
    change_type: "user_edit",
    change_summary: `Ran simulation: ${label}`,
  };
});

// ── resolve_predictions ────────────────────────────────────────────────
//
// Manual invocation of the resolver for this app's predictions — mostly
// useful for testing / demos so users don't have to wait for the hourly
// cron. Returns a summary the widget can toast.

registerActionHandler("resolve_predictions", async (ctx) => {
  const { resolvePredictions } = await import("@/lib/twin/resolve-predictions");
  const result = await resolvePredictions(ctx.db, { batchSize: 50 });
  return {
    ok: true,
    updated_app: ctx.app,
    extra: { ...result },
    change_type: "user_edit",
    change_summary: `Resolver ran: ${result.resolved} resolved, ${result.abandoned} abandoned`,
  };
});
