// Persistence helper for trajectory_runs. The "trajectory engine" is
// a thin layer over `simulateEntityChain` (which already does the
// subgraph extraction + Monte Carlo + weekly trajectory output). This
// helper is the bridge between the simulator's pure-function output
// and the prediction_ledger row that other surfaces (twin calibration
// panel, lab, dashboard sparklines, etc.) read from.
//
// We deliberately use the existing `prediction_ledger` table instead
// of a new `trajectory_runs` table — the schema already has every
// column we need (`prediction_kind="trajectory"`, `predicted_trajectory`,
// `predicted_basis_edge_ids`, `predicted_simulator`) and reusing it
// means the resolver, calibration, and "list resolved predictions"
// surfaces all just work.

import type {
  SimulationResult,
  WeeklyTrajectoryEntry,
} from "@/lib/simulation/monte-carlo";

/**
 * Minimal shape of the supabase client we accept. Kept structural so
 * tests can pass a fake.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface PersistTrajectoryOpts {
  spaceId: string;
  userId: string;
  /** Display label for the metric being projected (e.g. "executive_function"). */
  metricLabel: string;
  /** Optional metric unit string (e.g. "score 0-100"). */
  metricUnit?: string | null;
  /** Display ID (entity_id, e.g. "C5") of the target metric entity. */
  targetEntityId: string;
  /** Display ID of the intervention entity. Optional — pure-projection
   *  trajectories with no intervention are valid (just the prior trajectory). */
  interventionEntityId?: string | null;
  /** Magnitude applied to the intervention entity's prior. Stored for
   *  transparency in `rationale`. */
  interventionMagnitude?: number | null;
  /** Edge UUIDs included in the simulated subgraph. Drives the
   *  calibration loop (resolve → reweight these specific edges). */
  basisEdgeIds: string[];
  /** Free-text rationale shown alongside the prediction. */
  rationale: string;
  /** Confidence at predict-time — narrows / widens the band tints. */
  confidence: number;
  /** ISO timestamp the prediction matures. Last week's date. */
  horizonAt: string;
  /** Active goal id when the trajectory targets a goal metric. */
  goalId?: string | null;
  /** Strategy snapshot id when triggered from a strategy review surface. */
  strategySnapshotId?: string | null;
  /** App id when scoped to a per-app twin. */
  appId?: string | null;
  /** Result of the Monte Carlo run. Only `trajectory` and final-state
   *  distribution are persisted; raw samples stay in memory for the
   *  request that produced them. */
  simulation: SimulationResult;
  /** Which integrator produced these samples; stamped on the row. */
  simulator?:
    | "monte_carlo_discrete"
    | "monte_carlo_ode"
    | "template_seed"
    | "user_curated";
}

export interface PersistTrajectoryResult {
  predictionId: string;
}

/**
 * Insert a trajectory prediction. Returns the new row's id so the
 * caller can stream it back to the client + emit an SSE event.
 *
 * Soft-fails are NOT swallowed here — any DB error throws so the
 * caller can return a 500. Trajectory is the *primary* artifact of
 * this request, not a side-effect we can lose silently.
 */
export async function persistTrajectory(
  db: AnyDb,
  opts: PersistTrajectoryOpts,
): Promise<PersistTrajectoryResult> {
  const trajectory: WeeklyTrajectoryEntry[] = opts.simulation.trajectory ?? [];
  if (trajectory.length === 0) {
    throw new Error(
      "persistTrajectory: simulation result has no trajectory[]; was weeklyHorizon set on the SimulationSpec?",
    );
  }

  // Find the target node's final-state distribution as the canonical
  // `predicted_value`. The trajectory holds the full per-week shape;
  // predicted_value gives single-number consumers (badges, lists,
  // calibration deviation) a quick handle.
  const finalWeek = trajectory[trajectory.length - 1];
  const targetFinal = finalWeek.nodes.find((n) => n.nodeId === opts.targetEntityId)
    ?? opts.simulation.nodes.find((n) => n.nodeId === opts.targetEntityId)
    ?? null;
  const predictedValue = targetFinal?.p50 ?? null;

  // Predicted distribution — the mean/p10/p50/p90 + stddev at the
  // horizon. Useful for resolvers + downstream charting that doesn't
  // want to walk the full per-week trajectory.
  const predictedDistribution = targetFinal
    ? {
        p10: targetFinal.p10,
        p50: targetFinal.p50,
        p90: targetFinal.p90,
        mean: targetFinal.mean,
        stddev: targetFinal.stddev,
      }
    : null;

  const row = {
    space_id: opts.spaceId,
    user_id: opts.userId,
    strategy_snapshot_id: opts.strategySnapshotId ?? null,
    app_id: opts.appId ?? null,

    metric_label: opts.metricLabel,
    metric_unit: opts.metricUnit ?? null,

    predicted_at: new Date().toISOString(),
    horizon_at: opts.horizonAt,

    predicted_value: predictedValue,
    predicted_distribution: predictedDistribution,
    predicted_trajectory: trajectory,
    predicted_simulator: opts.simulator ?? "monte_carlo_discrete",
    predicted_basis_edge_ids: opts.basisEdgeIds,

    prediction_kind: "trajectory" as const,
    target_entity_id: opts.targetEntityId,

    rationale: opts.rationale,
    confidence: opts.confidence,
    status: "open" as const,

    // Backlinks for the calibration loop (which entities this
    // prediction depends on). Filled with the target + intervention;
    // the simulator already knows the full active subgraph but we
    // only persist the load-bearing pair to keep the array small.
    entity_ids: opts.interventionEntityId
      ? [opts.targetEntityId, opts.interventionEntityId]
      : [opts.targetEntityId],
  };

  const { data, error } = await db
    .from("prediction_ledger")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    throw new Error(`persistTrajectory: insert failed: ${error.message}`);
  }
  return { predictionId: (data as { id: string }).id };
}
