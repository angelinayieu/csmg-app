// Prediction resolver — visits open predictions past their horizon, fills
// in the actual, computes deviation, and tags the result. Runs hourly via
// /api/cron/predictions-resolve.
//
// Resolution sources (in order of preference):
//   1. metric_observations joined on tracker_id — authoritative when a
//      tracker exists and has a recent observation (within +/- 3 days of
//      horizon).
//   2. metric_trackers.current_value — fallback when observations are
//      missing but the tracker has been touched. Lower confidence.
//   3. none — mark "qualitative" if the prediction was text-only; mark
//      "abandoned" if the prediction was numeric and we can't find a
//      resolution candidate within a resolution window.
//
// Qualitative predictions (predicted_value_text only, no numeric): skipped
// for auto-resolution. They'll get "qualitative" tag and need human or
// validator-agent resolution via apply_validation_result.
//
// The resolver is idempotent — reading open rows and transitioning each
// to 'resolved' or 'abandoned' is a one-way edge. A re-run on the same
// window finds no open rows (they're now resolved) so does nothing.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { tagDeviation } from "@/types/prediction";

// Supabase query-builder generics collapse to `never` across module
// boundaries — mirror the app-generator.ts convention of accepting
// `SupabaseClient<Database> | any` to keep call sites ergonomic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

// Width of the window (in hours) around horizon_at to search for an
// observation. Predictions where no observation lands within this window
// get abandoned so the ledger doesn't grow stale.
const RESOLUTION_WINDOW_HOURS_BEFORE = 24 * 3;   // 3 days before horizon
const RESOLUTION_WINDOW_HOURS_AFTER = 24 * 7;    // up to 7 days after horizon
// Max age a prediction can stay open past its horizon before we give up
// and mark it abandoned. Separate from RESOLUTION_WINDOW_HOURS_AFTER
// because a no-tracker prediction should be abandoned sooner than a
// tracker-backed one whose observation is merely late.
const STALE_HOURS = 24 * 14;

export interface ResolvePredictionsResult {
  scanned: number;
  resolved: number;
  abandoned: number;
  qualitative: number;
  /** Count by tag for quick scanning in the cron log. */
  by_tag: Record<string, number>;
}

/**
 * Main entry point. Processes up to `batchSize` open predictions whose
 * horizon is in the past. Returns a summary suitable for cron logging.
 *
 * NOTE: uses the service client so it bypasses RLS. The caller (cron
 * route) is responsible for auth via CRON_SECRET.
 */
export async function resolvePredictions(
  db: DB,
  opts: { batchSize?: number } = {},
): Promise<ResolvePredictionsResult> {
  const batchSize = opts.batchSize ?? 200;
  const now = new Date();
  const nowIso = now.toISOString();
  const staleCutoff = new Date(now.getTime() - STALE_HOURS * 60 * 60 * 1000).toISOString();

  const result: ResolvePredictionsResult = {
    scanned: 0,
    resolved: 0,
    abandoned: 0,
    qualitative: 0,
    by_tag: {},
  };

  // Pull open predictions past horizon. Order by horizon_at so the oldest
  // ones get resolved first — important when batchSize clips the set.
  const { data: openRows, error } = await db
    .from("prediction_ledger")
    .select(
      "id, tracker_id, metric_label, predicted_value, predicted_value_text, horizon_at, predicted_at",
    )
    .eq("status", "open")
    .lte("horizon_at", nowIso)
    .order("horizon_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    console.error("[resolve-predictions] open-rows query failed:", error);
    throw error;
  }

  result.scanned = openRows?.length ?? 0;
  if (!openRows || openRows.length === 0) return result;

  for (const row of openRows) {
    // Qualitative — text-only predictions, no numeric comparison possible.
    // Mark 'qualitative' and leave for validator agents to resolve.
    if (row.predicted_value === null) {
      const { error: updErr } = await db
        .from("prediction_ledger")
        .update({
          status: "resolved",
          resolved_at: nowIso,
          deviation_tag: "qualitative",
          resolution_notes: "Text prediction — numeric resolution not applicable; awaiting validator agent or manual resolve.",
        })
        .eq("id", row.id);
      if (updErr) {
        console.warn(`[resolve-predictions] ${row.id} qualitative update failed:`, updErr);
        continue;
      }
      result.qualitative++;
      result.by_tag.qualitative = (result.by_tag.qualitative ?? 0) + 1;
      continue;
    }

    // Stale-no-tracker: abandon immediately.
    if (!row.tracker_id && row.horizon_at < staleCutoff) {
      const { error: updErr } = await db
        .from("prediction_ledger")
        .update({
          status: "abandoned",
          resolved_at: nowIso,
          resolution_notes: `No tracker linked and prediction is >${STALE_HOURS}h past horizon — abandoned.`,
        })
        .eq("id", row.id);
      if (!updErr) {
        result.abandoned++;
        result.by_tag.abandoned = (result.by_tag.abandoned ?? 0) + 1;
      }
      continue;
    }

    // Numeric + tracker: pull latest observation within the resolution window.
    let actual: number | null = null;
    let resolutionSource: "observation" | "tracker_current" | null = null;

    if (row.tracker_id) {
      const horizonDate = new Date(row.horizon_at);
      const windowStart = new Date(horizonDate.getTime() - RESOLUTION_WINDOW_HOURS_BEFORE * 60 * 60 * 1000).toISOString();
      const windowEnd = new Date(horizonDate.getTime() + RESOLUTION_WINDOW_HOURS_AFTER * 60 * 60 * 1000).toISOString();

      // Prefer the observation closest to horizon_at (but any in-window
      // observation is acceptable). We ask for a small set and pick the
      // nearest; Postgres can't order by abs-distance without an extra
      // expression index, and the set is tiny.
      const { data: obs } = await db
        .from("metric_observations")
        .select("value, recorded_at")
        .eq("tracker_id", row.tracker_id)
        .gte("recorded_at", windowStart)
        .lte("recorded_at", windowEnd)
        .not("value", "is", null);

      if (obs && obs.length > 0) {
        type ObsRow = { value: number | null; recorded_at: string };
        const nearest = (obs as ObsRow[]).reduce<ObsRow>((best, cur) => {
          const bd = Math.abs(new Date(best.recorded_at).getTime() - horizonDate.getTime());
          const cd = Math.abs(new Date(cur.recorded_at).getTime() - horizonDate.getTime());
          return cd < bd ? cur : best;
        }, (obs as ObsRow[])[0]);
        if (nearest.value !== null) {
          actual = Number(nearest.value);
          resolutionSource = "observation";
        }
      }

      // Fallback: tracker.current_value if no observation in window
      if (actual === null) {
        const { data: tracker } = await db
          .from("metric_trackers")
          .select("current_value, updated_at")
          .eq("id", row.tracker_id)
          .single();
        if (tracker?.current_value !== null && tracker?.current_value !== undefined) {
          // Only trust current_value if the tracker has been touched since
          // the prediction was made (otherwise it's the same baseline value).
          if (tracker.updated_at && tracker.updated_at > row.predicted_at) {
            actual = Number(tracker.current_value);
            resolutionSource = "tracker_current";
          }
        }
      }
    }

    // Still nothing? Either abandon (stale) or leave open (fresh).
    if (actual === null) {
      if (row.horizon_at < staleCutoff) {
        const { error: updErr } = await db
          .from("prediction_ledger")
          .update({
            status: "abandoned",
            resolved_at: nowIso,
            resolution_notes: row.tracker_id
              ? `No observation within +/-${RESOLUTION_WINDOW_HOURS_AFTER}h of horizon and >${STALE_HOURS}h elapsed — abandoned.`
              : `No tracker linked and >${STALE_HOURS}h past horizon — abandoned.`,
          })
          .eq("id", row.id);
        if (!updErr) {
          result.abandoned++;
          result.by_tag.abandoned = (result.by_tag.abandoned ?? 0) + 1;
        }
      }
      // else: leave open, retry next cron tick
      continue;
    }

    // We have an actual — compute deviation + tag
    const predicted = Number(row.predicted_value);
    const deviation = actual - predicted;
    const tag = tagDeviation(predicted, actual);

    const { error: updErr } = await db
      .from("prediction_ledger")
      .update({
        status: "resolved",
        resolved_at: nowIso,
        resolved_actual: actual,
        deviation,
        deviation_tag: tag,
        resolution_notes: resolutionSource === "observation"
          ? `Resolved from metric_observations within +/-${RESOLUTION_WINDOW_HOURS_AFTER}h window.`
          : `Resolved from metric_trackers.current_value (no observation in window; tracker updated post-prediction).`,
      })
      .eq("id", row.id);

    if (updErr) {
      console.warn(`[resolve-predictions] ${row.id} resolve update failed:`, updErr);
      continue;
    }

    result.resolved++;
    result.by_tag[tag] = (result.by_tag[tag] ?? 0) + 1;
  }

  console.log(
    `[resolve-predictions] scanned=${result.scanned} resolved=${result.resolved} ` +
      `abandoned=${result.abandoned} qualitative=${result.qualitative} tags=${JSON.stringify(result.by_tag)}`,
  );

  return result;
}
