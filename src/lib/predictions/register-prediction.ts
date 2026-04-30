// ── register-prediction (Phase 5) ─────────────────────────────────
//
// Pre-registration helper. Converts a Phase 4 Monte Carlo trajectory
// into a prediction_ledger row tagged with kind='trajectory' so the
// resolver can later compare actual repeated-measures outcomes
// against the per-week predicted distributions.
//
// PIPELINE
//
//   intervention activated (status → 'active')
//     └─→ runMonteCarlo(weeklyHorizon = peak * 2 or 26)
//          └─→ SimulationResult.trajectory[]
//               └─→ THIS FILE (build prediction_ledger payload)
//                    └─→ insert into prediction_ledger (open, trajectory)
//                         └─→ basis edge ids + basis evidence ids
//                              attached so resolver can do path-aware
//                              calibration when actuals come in.
//
// USAGE
//
// Two entry points:
//   1. From an intervention activation hook — `registerInterventionPrediction`
//      pulls the intervention's basis edge data and runs the
//      simulator inline.
//   2. From a custom caller that already ran the simulator —
//      `persistTrajectoryPrediction` accepts a prebuilt
//      SimulationResult + metadata and just persists.
//
// Both paths converge on the same prediction_ledger insert so the
// audit trail is identical regardless of who triggered the prediction.

import type { Database } from "@/types/database.types";
import type {
  SimulationResult,
  WeeklyTrajectoryEntry,
} from "@/lib/simulation/monte-carlo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

type InterventionRow = Database["public"]["Tables"]["interventions"]["Row"];
type EdgeRow = Database["public"]["Tables"]["edges"]["Row"];

export interface PersistTrajectoryPredictionOpts {
  spaceId: string;
  userId: string;
  /** Entity the prediction is about (target of the intervention). */
  targetEntityId: string;
  /** Intervention whose activation triggered this. Optional — leave
   *  null for non-intervention predictions (template seeds, etc). */
  interventionId: string | null;
  /** App that hosts the intervention, when known. */
  appId: string | null;
  /** Strategy snapshot that scoped the recommendation. */
  strategySnapshotId: string | null;
  /** Required: the simulator's per-week trajectory output. Filtered
   *  to one node here (targetEntityId) — caller passes the full
   *  result and we extract. */
  simulationResult: SimulationResult;
  /** Edges whose pooled timing fed the simulator. Used by the
   *  resolver for path-aware calibration. */
  basisEdgeIds: string[];
  /** evidence_registries.id rows that fed the basis edges' pools.
   *  Lets a temporal surprise back-trace to source studies. */
  basisEvidenceIds: string[];
  /** Metric label — required by prediction_ledger's existing schema.
   *  For intervention-driven predictions the convention is
   *  "<intervention_title>::trajectory" so resolver queries can
   *  group easily. Caller supplies. */
  metricLabel: string;
  /** Optional unit hint for UI rendering ("Cohen's d", "%", etc). */
  metricUnit?: string | null;
  /** Optional human-readable rationale (e.g. "based on 4 RCTs;
   *  see edge X's pool"). Persisted as the prediction's rationale
   *  field. */
  rationale?: string | null;
  /** Confidence in the prediction (0..1). Defaults to the basis
   *  edge's pool confidence when not supplied. */
  confidence?: number | null;
}

export interface PersistedPrediction {
  id: string;
  horizon_at: string;
  weeks_horizon: number;
}

/** Build the prediction_ledger payload from a SimulationResult. The
 *  trajectory is sliced to just the target entity so the row is
 *  compact (one node × N weeks instead of all-nodes × N weeks). */
function trajectoryForTarget(
  simulation: SimulationResult,
  targetEntityId: string,
): Array<{
  week: number;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
}> {
  if (!simulation.trajectory || simulation.trajectory.length === 0) {
    return [];
  }
  return simulation.trajectory.map((entry: WeeklyTrajectoryEntry) => {
    const node = entry.nodes.find((n) => n.nodeId === targetEntityId);
    if (!node) {
      return {
        week: entry.week,
        p10: 0,
        p50: 0,
        p90: 0,
        mean: 0,
        stddev: 0,
      };
    }
    return {
      week: entry.week,
      p10: node.p10,
      p50: node.p50,
      p90: node.p90,
      mean: node.mean,
      stddev: node.stddev,
    };
  });
}

/** Persist a trajectory prediction. Returns the new row's id +
 *  horizon_at + weekly span so callers can surface "we predicted you
 *  through week N" in UI. */
export async function persistTrajectoryPrediction(
  db: AnyDb,
  opts: PersistTrajectoryPredictionOpts,
): Promise<PersistedPrediction | null> {
  const trajectory = trajectoryForTarget(
    opts.simulationResult,
    opts.targetEntityId,
  );
  if (trajectory.length === 0) {
    console.warn(
      "[register-prediction] simulation produced empty trajectory; skipping",
    );
    return null;
  }
  const lastWeek = trajectory[trajectory.length - 1].week;
  // horizon_at = predicted_at + lastWeek weeks. The cron resolver
  // picks rows up at horizon_at; for trajectory predictions the
  // resolver is opt-in (a separate trajectory-aware resolver runs
  // when the user uploads observations) so this is mainly UI signal.
  const predictedAt = new Date();
  const horizonAt = new Date(
    predictedAt.getTime() + lastWeek * 7 * 24 * 60 * 60 * 1000,
  );

  const insert: Database["public"]["Tables"]["prediction_ledger"]["Insert"] = {
    space_id: opts.spaceId,
    user_id: opts.userId,
    strategy_snapshot_id: opts.strategySnapshotId,
    app_id: opts.appId,
    agent_id: null,
    tracker_id: null,
    metric_label: opts.metricLabel,
    metric_unit: opts.metricUnit ?? null,
    predicted_at: predictedAt.toISOString(),
    horizon_at: horizonAt.toISOString(),
    // Existing scalar lanes left null — trajectory mode populates the
    // new `predicted_trajectory` column instead.
    predicted_value: null,
    predicted_value_text: null,
    predicted_distribution: null,
    rationale: opts.rationale ?? null,
    confidence: opts.confidence ?? null,
    status: "open",
    entity_ids: [opts.targetEntityId],
    subject_kind: "metric",
    // Phase 5 columns.
    prediction_kind: "trajectory",
    target_entity_id: opts.targetEntityId,
    intervention_id: opts.interventionId,
    predicted_trajectory: trajectory,
    predicted_basis_edge_ids: opts.basisEdgeIds,
    predicted_basis_evidence_ids: opts.basisEvidenceIds,
    actual_trajectory: null,
    predicted_simulator:
      opts.simulationResult.integrator === "ode_rk4"
        ? "monte_carlo_ode"
        : "monte_carlo_discrete",
  };

  const { data, error } = await db
    .from("prediction_ledger")
    .insert(insert)
    .select("id, horizon_at")
    .single();
  if (error || !data) {
    console.error("[register-prediction] insert failed:", error);
    return null;
  }
  return {
    id: data.id as string,
    horizon_at: data.horizon_at as string,
    weeks_horizon: lastWeek,
  };
}

// ── Intervention-driven entry point ───────────────────────────────

export interface RegisterInterventionPredictionOpts {
  /** Optional override of the simulation horizon. Defaults to
   *  max(2 × intervention.peak_days_in_weeks, 26). */
  weeklyHorizon?: number;
  /** Override iteration count for the simulator (cost control). */
  iterations?: number;
  /** Override seed for determinism. */
  seed?: number;
}

/** Entry point for "an intervention just got activated, register a
 *  pre-flight prediction." Loads the intervention + basis edge,
 *  pulls the local subgraph, runs the time-aware simulator, and
 *  persists. Returns the new prediction id, or null when the
 *  intervention lacks the temporal data to support trajectory mode
 *  (in which case the caller should fall back to a point-value
 *  prediction via the existing path).
 *
 *  Soft-fail: per "no orphan systems," every error path returns
 *  null + logs rather than throwing, so an activation flow doesn't
 *  abort because a prediction couldn't be built.
 */
export async function registerInterventionPrediction(
  db: AnyDb,
  interventionId: string,
  opts: RegisterInterventionPredictionOpts = {},
): Promise<PersistedPrediction | null> {
  // 1. Load the intervention with temporal columns.
  const { data: ivData, error: ivErr } = await db
    .from("interventions")
    .select(
      "id, space_id, user_id, target_entity_id, app_id, source_strategy_version, " +
        "title, peak_days, persistence_days, temporal_basis_edge_id, temporal_confidence",
    )
    .eq("id", interventionId)
    .maybeSingle();
  if (ivErr || !ivData) {
    console.warn("[register-prediction] intervention not found:", interventionId);
    return null;
  }
  const iv = ivData as Pick<
    InterventionRow,
    | "id"
    | "space_id"
    | "user_id"
    | "target_entity_id"
    | "app_id"
    | "source_strategy_version"
    | "title"
    | "peak_days"
    | "persistence_days"
    | "temporal_basis_edge_id"
    | "temporal_confidence"
  >;

  if (!iv.target_entity_id || !iv.temporal_basis_edge_id) {
    // Without target + basis we can't build a path-aware trajectory.
    // Caller should fall back to a point-value prediction.
    return null;
  }

  // 2. Load the basis edge + its temporal evidence list so the
  //    prediction row can cite both.
  const { data: edgeData, error: edgeErr } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, peak_days_p50, persistence_days_p50, temporal_evidence_ids",
    )
    .eq("id", iv.temporal_basis_edge_id)
    .maybeSingle();
  if (edgeErr || !edgeData) {
    console.warn(
      "[register-prediction] basis edge not found:",
      iv.temporal_basis_edge_id,
    );
    return null;
  }
  const edge = edgeData as Pick<
    EdgeRow,
    | "id"
    | "source_entity_id"
    | "target_entity_id"
    | "peak_days_p50"
    | "persistence_days_p50"
    | "temporal_evidence_ids"
  >;

  // 3. Decide horizon. Default = max(2 × peak weeks, 26 weeks).
  //    Stretches the prediction past peak so we capture decay too.
  const peakWeeks =
    typeof iv.peak_days === "number" ? Math.ceil(iv.peak_days / 7) : null;
  const persistenceWeeks =
    typeof iv.persistence_days === "number"
      ? Math.ceil(iv.persistence_days / 7)
      : null;
  const defaultHorizon = Math.max(
    26,
    (peakWeeks ?? 8) * 2,
    (peakWeeks ?? 0) + (persistenceWeeks ?? 0),
  );
  const weeklyHorizon = opts.weeklyHorizon ?? Math.min(defaultHorizon, 156);

  // 4. Run the simulator on a 2-hop subgraph around target.
  let simulationResult: SimulationResult | null = null;
  try {
    const { runMonteCarlo } = await import("@/lib/simulation/monte-carlo");
    const { buildSubgraphSpec } = await import("./build-subgraph-spec");
    const spec = await buildSubgraphSpec(db, iv.space_id, iv.target_entity_id);
    if (!spec) {
      console.warn(
        "[register-prediction] could not build subgraph for entity:",
        iv.target_entity_id,
      );
      return null;
    }
    simulationResult = runMonteCarlo({
      ...spec,
      iterations: opts.iterations ?? 500,
      weeklyHorizon,
      seed: opts.seed ?? 42,
    });
  } catch (err) {
    console.warn("[register-prediction] simulator failed:", err);
    return null;
  }

  if (!simulationResult || !simulationResult.trajectory) return null;

  // 5. Persist via the shared insertion path so the audit story
  //    matches the manual entry point.
  return await persistTrajectoryPrediction(db, {
    spaceId: iv.space_id,
    userId: iv.user_id,
    targetEntityId: iv.target_entity_id,
    interventionId: iv.id,
    appId: iv.app_id,
    strategySnapshotId: null, // resolver can be filled in if known by caller
    simulationResult,
    basisEdgeIds: [edge.id],
    basisEvidenceIds: edge.temporal_evidence_ids ?? [],
    metricLabel: `${iv.title}::trajectory`,
    metricUnit: null,
    rationale:
      "Auto-registered at intervention activation from temporal-pooler basis edge.",
    confidence: iv.temporal_confidence ?? null,
  });
}
