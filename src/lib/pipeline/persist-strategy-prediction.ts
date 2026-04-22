// ── Persist a strategy's simulated distribution to prediction_ledger ──
//
// Inserts one row per ranked-strategy simulation so the resolver-cron
// can later compare against real metric_observations + tag deviation.
// This is the last mile of the rigor loop: today's simulation becomes
// tomorrow's calibration signal.
//
// Fields wired:
//   space_id, user_id, strategy_snapshot_id — scoping
//   metric_label           — strategy title (fallback: target entity name)
//   predicted_value        — simulation p50 (point estimate for resolver)
//   predicted_distribution — full {p10, p50, p90, mean, stddev}
//   horizon_at             — predicted_at + horizonDays
//   confidence             — 1 / (1 + stddev) mapped to [0,1] — tighter
//                            distributions = higher self-reported confidence
//   rationale              — human-readable sketch of how the sim ran
//
// Soft-fail — returns null on any error so the caller (strategy-refresh
// emission loop) never breaks a pipeline run over a persistence hiccup.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface DistributionShape {
  p10: number;
  p50: number;
  p90: number;
  mean?: number;
  stddev?: number;
}

export interface PersistStrategyPredictionOpts {
  spaceId: string;
  userId: string;
  strategyTitle: string;
  /** Rank index (1-based) — part of the metric_label for readability in logs. */
  rank: number;
  strategySnapshotId?: string | null;
  targetEntityId?: string | null;
  targetEntityName?: string | null;
  distribution: DistributionShape;
  /** Days from now until we expect a resolution. Default 30. */
  horizonDays?: number;
  iterations?: number;
  /**
   * Phase 2G · research-first priors. When populated, the
   * distribution is backed by N high-reliability evidence items
   * linked to claims on the target entity. These are captured in
   * the rationale string today (no dedicated column yet) so
   * readers of prediction_ledger can see whether this prediction
   * stands on literature or pure LLM chain propagation.
   */
  evidenceBackingCount?: number;
  meanReliability?: number;
  groundingTier?: "measured" | "estimated" | "narrative";
}

export async function persistStrategyPrediction(
  db: AnyDb,
  opts: PersistStrategyPredictionOpts,
): Promise<string | null> {
  const horizonDays = opts.horizonDays ?? 30;
  const horizonMs = horizonDays * 24 * 60 * 60 * 1000;
  const horizonIso = new Date(Date.now() + horizonMs).toISOString();

  const metric_label = buildMetricLabel(opts);
  const confidence = stddevToConfidence(opts.distribution.stddev);
  const rationale = buildRationale(opts, horizonDays);

  const row: Record<string, unknown> = {
    space_id: opts.spaceId,
    user_id: opts.userId,
    metric_label,
    horizon_at: horizonIso,
    predicted_value: opts.distribution.p50,
    predicted_distribution: opts.distribution,
    confidence,
    rationale,
  };
  if (opts.strategySnapshotId) {
    row.strategy_snapshot_id = opts.strategySnapshotId;
  }

  try {
    const { data, error } = await db
      .from("prediction_ledger")
      .insert(row)
      .select("id")
      .single();
    if (error) {
      console.warn("[persist-strategy-prediction] insert failed:", error.message);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn("[persist-strategy-prediction] threw:", err);
    return null;
  }
}

function buildMetricLabel(opts: PersistStrategyPredictionOpts): string {
  const parts: string[] = [];
  const prefix = opts.targetEntityName
    ? `Δ ${opts.targetEntityName}`
    : `Strategy #${opts.rank}`;
  parts.push(prefix);
  const title = opts.strategyTitle.slice(0, 80);
  if (title && title !== prefix) parts.push(title);
  return parts.join(" — ").slice(0, 200);
}

/**
 * Map stddev → 0..1 self-reported confidence. A small stddev means the
 * sim produced a tight cluster around p50 (high confidence); a large
 * stddev means the uncertainty envelope is wide (low confidence).
 * Formula: conf = 1 / (1 + stddev) — monotonic, smooth, bounded.
 */
function stddevToConfidence(stddev: number | undefined): number {
  if (stddev === undefined || !Number.isFinite(stddev)) return 0.5;
  return Math.max(0, Math.min(1, 1 / (1 + Math.abs(stddev))));
}

function buildRationale(
  opts: PersistStrategyPredictionOpts,
  horizonDays: number,
): string {
  const iters = opts.iterations ?? 500;
  const { p10, p50, p90, stddev } = opts.distribution;
  const groundingBit = opts.groundingTier
    ? ` Grounding: ${opts.groundingTier}` +
      (opts.evidenceBackingCount && opts.evidenceBackingCount > 0
        ? ` (${opts.evidenceBackingCount} evidence items, mean reliability ${(opts.meanReliability ?? 0).toFixed(2)})`
        : "")
    : "";
  return (
    `Monte-Carlo simulation against ${opts.targetEntityName ?? "target entity"} causal chain. ` +
    `iter=${iters}, p10=${num(p10)}, p50=${num(p50)}, p90=${num(p90)}, stddev=${num(stddev)}. ` +
    `Horizon: ${horizonDays}d from strategy generation.${groundingBit}`
  ).slice(0, 2000);
}

function num(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}
