// GET /api/spaces/:id/rollup — cross-app aggregation for the objective view
//
// Tier 4: after six tiers of per-app infrastructure (apps, sub-strategies,
// predictions, deviations, hypotheses, simulations), the user has no single
// surface to answer "did all this actually work?" Each app is visible
// individually, but nothing rolls up "5 apps for objective X, collectively
// 23 open predictions, 3 surprises, 7 in-flight hypotheses, last regen 3d ago."
//
// This endpoint is that rollup. It groups apps by serves_goal_id (Tier 2.5
// populated this from the strategy batch) and aggregates per group:
//   - app count + status breakdown
//   - sub-strategy health (active vs draft vs missing)
//   - prediction ledger totals (open / resolved / abandoned)
//   - deviation tag counts (expected / regime_shift / surprise / qualitative)
//   - hypothesis counts (open experiments drawn from the validation_spec bank)
//   - last sub-strategy regen timestamp across all apps in the group
//
// Query shape: one indexed query per table + group in memory. Cheap.
// Everything already has the right indexes from prior tiers (apps.space_id,
// prediction_ledger.space_id+status, app_strategies.space_id+status).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { AppRow } from "@/types/app";
import type { PredictionLedgerRow } from "@/types/prediction";
import type { AppStrategyRow } from "@/types/app-strategy";
import type { StrategyBatch, StrategyBatchEntry } from "@/types/strategy-batch";

export const maxDuration = 60;

// ── Response shapes ────────────────────────────────────────────────────

/**
 * One entry per objective (or one "unassigned" bucket when apps have no
 * goal FK). Shape is intentionally flat + ready-to-render so the
 * component can iterate without further aggregation.
 */
export interface ObjectiveRollup {
  /** improvement_goals.id when the objective is goal-backed; null for unassigned bucket. */
  objective_id: string | null;
  /** Display label — from strategy_batch.strategies[].objective_title when found. */
  objective_title: string;
  /** True when this rollup represents the user's primary objective (root). */
  is_primary: boolean;

  // App counts
  apps_total: number;
  apps_by_status: Record<string, number>;       // { active, paused, proposed, ... }

  // Sub-strategy health
  substrategies_active: number;                 // apps with an active app_strategies row
  substrategies_draft: number;                  // apps with a draft only
  substrategies_missing: number;                // apps with zero rows
  substrategy_last_generated_at: string | null; // most recent generated_at across the group
  substrategy_last_deviation_at: string | null; // most recent last_deviation_trigger_at

  // Prediction ledger
  predictions_open: number;
  predictions_resolved: number;
  predictions_abandoned: number;
  deviation_by_tag: {
    expected: number;
    regime_shift: number;
    surprise: number;
    qualitative: number;
    // `failed` was added to the prediction-ledger deviation_tag enum but
    // the local rollup type wasn't updated. Added here so the prediction
    // indexer can increment it without TS narrowing to `never`.
    failed: number;
  };

  // Experiments — open predictions flagged as experiments via
  // prediction_ledger.rationale starting with "[experiment]" (Item 4
  // convention). Separate bucket from open_predictions.
  experiments_in_flight: number;
}

export interface SpaceRollupResponse {
  /** Per-objective rollups. Matches the strategy_batch ordering when present. */
  objectives: ObjectiveRollup[];
  /** Top-level counts — summed across all objectives + unassigned. */
  totals: {
    apps_total: number;
    substrategies_active: number;
    substrategies_draft: number;
    substrategies_missing: number;
    predictions_open: number;
    experiments_in_flight: number;
    surprises: number;
    regime_shifts: number;
  };
  /**
   * Tier 6: objectives where cross-app surprise density exceeds threshold.
   * Triggered when the objective has ≥3 resolved surprises across ≥2
   * distinct apps in the last 14 days. Signals to the UI that the parent
   * strategy entry for this objective probably needs regen — the pattern
   * isn't just one app's quirk, it's objective-wide.
   *
   * Empty array means nothing's tripped. Non-empty entries are ordered
   * most-recent-trigger first.
   */
  stale_objectives: Array<{
    objective_id: string | null;
    objective_title: string;
    surprise_count: number;
    affected_app_count: number;
    reason: string;
    triggered_at: string;
  }>;
  /** batch_id of the strategy_batch used for labels; null when no batch exists yet. */
  batch_id: string | null;
  /** When the rollup was computed — useful for "as of" UX. */
  computed_at: string;
}

// ── GET ────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership + fetch synthesis_data for the batch labels. Single roundtrip.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const batch: StrategyBatch | null =
    ((spaceRow.synthesis_data as Record<string, unknown> | null)?.strategy_batch as
      | StrategyBatch
      | undefined) ?? null;

  // Parallel fan-out for the three tables that drive the aggregation.
  // RLS scopes everything to the current user via the same supabase client
  // we used for auth; no extra user_id filters needed here.
  const [
    { data: apps },
    { data: allPredictions },
    { data: allSubstrategies },
  ] = await Promise.all([
    db.from("apps").select("*").eq("space_id", spaceId),
    db.from("prediction_ledger").select("*").eq("space_id", spaceId),
    db.from("app_strategies").select("*").eq("space_id", spaceId),
  ]);

  const appRows = (apps ?? []) as AppRow[];
  const predictionRows = (allPredictions ?? []) as PredictionLedgerRow[];
  const substrategyRows = (allSubstrategies ?? []) as AppStrategyRow[];

  // ── Bucketing strategy ─────────────────────────────────────────────
  // Group everything by objective_id derived from the primary key chain:
  //   - Apps: apps.serves_goal_id
  //   - Predictions: join apps.id → app_id → serves_goal_id (via lookup)
  //     Falls back to null bucket when app_id is null or app not found.
  //   - Sub-strategies: join via app_id (same approach)
  //
  // Building an app_id → goal_id lookup keeps the aggregation O(n).

  const appGoalByAppId = new Map<string, string | null>();
  for (const a of appRows) {
    appGoalByAppId.set(a.id, a.serves_goal_id ?? null);
  }

  // Seed the bucket map with the strategy_batch entries first so their
  // order + titles are preserved in the response. Unassigned apps / ones
  // whose goal_id doesn't match any batch entry fall into a terminal
  // null bucket at the end.
  const buckets = new Map<string | null, ObjectiveRollup>();
  const primarySet = new Set<string | null>();
  if (batch) {
    for (const entry of batch.strategies as StrategyBatchEntry[]) {
      const key = entry.objective_id ?? null;
      if (buckets.has(key)) continue;
      buckets.set(key, emptyRollup(key, entry.objective_title, entry.is_primary));
      if (entry.is_primary) primarySet.add(key);
    }
  }

  // Add an "Unassigned" bucket only if needed (deferred — only created when
  // we actually encounter an app whose goal_id isn't in the batch).
  function ensureBucket(goalId: string | null): ObjectiveRollup {
    let b = buckets.get(goalId);
    if (!b) {
      b = emptyRollup(
        goalId,
        goalId ? "Other objective" : "Unassigned",
        primarySet.has(goalId),
      );
      buckets.set(goalId, b);
    }
    return b;
  }

  // ── App aggregation ───────────────────────────────────────────────
  for (const a of appRows) {
    const b = ensureBucket(a.serves_goal_id ?? null);
    b.apps_total++;
    b.apps_by_status[a.status] = (b.apps_by_status[a.status] ?? 0) + 1;
  }

  // ── Sub-strategy aggregation ──────────────────────────────────────
  // Track per-app state so substrategies_missing is accurate (apps with
  // zero rows need to be counted too). Iterate apps, then for each look
  // up the sub-strategy's status. Active trumps draft trumps missing.
  const substrategyByApp = new Map<string, { active: boolean; draft: boolean; latest: AppStrategyRow | null }>();
  for (const s of substrategyRows) {
    const cur = substrategyByApp.get(s.app_id) ?? { active: false, draft: false, latest: null };
    if (s.status === "active") cur.active = true;
    if (s.status === "draft") cur.draft = true;
    // Keep the most recent row (by generated_at) so we can surface the
    // last-generated and last-deviation timestamps.
    if (!cur.latest || (s.generated_at ?? "") > (cur.latest.generated_at ?? "")) {
      cur.latest = s;
    }
    substrategyByApp.set(s.app_id, cur);
  }

  for (const a of appRows) {
    const b = ensureBucket(a.serves_goal_id ?? null);
    const sub = substrategyByApp.get(a.id);
    if (!sub) {
      b.substrategies_missing++;
    } else if (sub.active) {
      b.substrategies_active++;
      // The active row's timestamps roll up — primary signal the user wants.
      if (sub.latest) {
        const g = sub.latest.generated_at;
        if (g && (!b.substrategy_last_generated_at || g > b.substrategy_last_generated_at)) {
          b.substrategy_last_generated_at = g;
        }
        const d = sub.latest.last_deviation_trigger_at;
        if (d && (!b.substrategy_last_deviation_at || d > b.substrategy_last_deviation_at)) {
          b.substrategy_last_deviation_at = d;
        }
      }
    } else if (sub.draft) {
      b.substrategies_draft++;
    }
  }

  // ── Prediction aggregation ────────────────────────────────────────
  for (const p of predictionRows) {
    const goalId = p.app_id ? (appGoalByAppId.get(p.app_id) ?? null) : null;
    const b = ensureBucket(goalId);
    if (p.status === "open") {
      b.predictions_open++;
      if ((p.rationale ?? "").startsWith("[experiment]")) {
        b.experiments_in_flight++;
      }
    } else if (p.status === "resolved") {
      b.predictions_resolved++;
      if (p.deviation_tag && b.deviation_by_tag[p.deviation_tag] !== undefined) {
        b.deviation_by_tag[p.deviation_tag]++;
      }
    } else if (p.status === "abandoned") {
      b.predictions_abandoned++;
    }
  }

  // ── Flatten + compute totals ──────────────────────────────────────
  const objectives = Array.from(buckets.values());

  const totals = objectives.reduce(
    (acc, o) => ({
      apps_total: acc.apps_total + o.apps_total,
      substrategies_active: acc.substrategies_active + o.substrategies_active,
      substrategies_draft: acc.substrategies_draft + o.substrategies_draft,
      substrategies_missing: acc.substrategies_missing + o.substrategies_missing,
      predictions_open: acc.predictions_open + o.predictions_open,
      experiments_in_flight: acc.experiments_in_flight + o.experiments_in_flight,
      surprises: acc.surprises + o.deviation_by_tag.surprise,
      regime_shifts: acc.regime_shifts + o.deviation_by_tag.regime_shift,
    }),
    {
      apps_total: 0,
      substrategies_active: 0,
      substrategies_draft: 0,
      substrategies_missing: 0,
      predictions_open: 0,
      experiments_in_flight: 0,
      surprises: 0,
      regime_shifts: 0,
    },
  );

  // ── Tier 6: cross-app surprise threshold detection ─────────────────
  // An objective with persistent surprises across multiple apps signals
  // that the parent strategy's assumptions are wrong. Today the only
  // loop is per-app sub-strategy regen, which fixes the leaf but leaves
  // the objective's parent strategy frozen. Surfacing `stale_objectives`
  // gives the UI the signal to prompt users to regen the whole strategy
  // for that objective.
  //
  // Threshold: ≥3 resolved surprises (+ regime_shifts) across ≥2 apps
  // in the last 14 days. Tuned conservatively so one chatty app can't
  // trip the signal alone — we require multi-app evidence.
  const STALE_WINDOW_DAYS = 14;
  const STALE_MIN_SURPRISES = 3;
  const STALE_MIN_APPS = 2;
  const windowCutoff = Date.now() - STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const surpriseByObjective = new Map<
    string | null,
    { count: number; apps: Set<string>; lastAt: string }
  >();
  for (const p of predictionRows) {
    if (p.status !== "resolved") continue;
    if (!p.deviation_tag || !["surprise", "regime_shift"].includes(p.deviation_tag)) continue;
    if (!p.resolved_at || new Date(p.resolved_at).getTime() < windowCutoff) continue;
    const goalId = p.app_id ? (appGoalByAppId.get(p.app_id) ?? null) : null;
    const bucket = surpriseByObjective.get(goalId) ?? {
      count: 0,
      apps: new Set<string>(),
      lastAt: p.resolved_at,
    };
    bucket.count++;
    if (p.app_id) bucket.apps.add(p.app_id);
    if (p.resolved_at > bucket.lastAt) bucket.lastAt = p.resolved_at;
    surpriseByObjective.set(goalId, bucket);
  }

  const staleObjectives: SpaceRollupResponse["stale_objectives"] = [];
  for (const [goalId, data] of surpriseByObjective) {
    if (data.count < STALE_MIN_SURPRISES) continue;
    if (data.apps.size < STALE_MIN_APPS) continue;
    const bucket = buckets.get(goalId);
    staleObjectives.push({
      objective_id: goalId,
      objective_title: bucket?.objective_title ?? "Unassigned",
      surprise_count: data.count,
      affected_app_count: data.apps.size,
      reason:
        `${data.count} surprises across ${data.apps.size} apps in the last ${STALE_WINDOW_DAYS}d — ` +
        `parent strategy assumptions may be wrong, consider objective-level regen`,
      triggered_at: data.lastAt,
    });
  }
  // Most recent first — surfaces the freshest signal at the top of the UI.
  staleObjectives.sort((a, b) => b.triggered_at.localeCompare(a.triggered_at));

  const response: SpaceRollupResponse = {
    objectives,
    totals,
    stale_objectives: staleObjectives,
    batch_id: batch?.batch_id ?? null,
    computed_at: new Date().toISOString(),
  };

  return NextResponse.json(response);
}

// ── Helpers ────────────────────────────────────────────────────────────

function emptyRollup(
  objectiveId: string | null,
  title: string,
  isPrimary: boolean,
): ObjectiveRollup {
  return {
    objective_id: objectiveId,
    objective_title: title,
    is_primary: isPrimary,
    apps_total: 0,
    apps_by_status: {},
    substrategies_active: 0,
    substrategies_draft: 0,
    substrategies_missing: 0,
    substrategy_last_generated_at: null,
    substrategy_last_deviation_at: null,
    predictions_open: 0,
    predictions_resolved: 0,
    predictions_abandoned: 0,
    deviation_by_tag: {
      expected: 0,
      regime_shift: 0,
      surprise: 0,
      qualitative: 0,
      failed: 0,
    },
    experiments_in_flight: 0,
  };
}
