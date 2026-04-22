/**
 * Wave D L3.2 — surprise-deviation cascade.
 *
 * Called from /api/cron/predictions-resolve after it resolves an open
 * prediction. When `deviation_tag='surprise'`, the system should not
 * silently log it. Three side effects fire:
 *
 *   1. Every app tracking the prediction's metric gets
 *      stale_reason='new_research' — the data no longer matches the
 *      app's assumptions.
 *   2. An agent_finding (severity='urgent') lands so the Pulse module
 *      shows the user.
 *   3. A user_event of type 'prediction.surprise' goes into the stream
 *      so the Wave C digest learns the user's surprise-frequency.
 *
 * Soft-fail throughout — the resolver must complete even if these
 * cascades hit a transient error.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { flagAppsByMetricChange } from "@/lib/apps/staleness-triggers";
import { recordAgentFinding } from "./finding-recorder";
import { recordUserEvent } from "@/lib/user-events/record";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface ResolvedSurpriseRow {
  id: string;
  user_id: string;
  space_id: string | null;
  app_id: string | null;
  tracker_id: string | null;
  metric_label: string | null;
  predicted_value: number | null;
  resolved_actual: number | null;
  deviation: number | null;
  deviation_tag: string | null;
  horizon_at: string | null;
  resolved_at: string | null;
}

export interface SurpriseCascadeResult {
  apps_flagged: number;
  finding_id: string | null;
  user_event_recorded: boolean;
}

export async function handleSurpriseDeviation(
  db: AnyDb,
  row: ResolvedSurpriseRow,
): Promise<SurpriseCascadeResult> {
  if (row.deviation_tag !== "surprise") {
    return {
      apps_flagged: 0,
      finding_id: null,
      user_event_recorded: false,
    };
  }

  // ── (1) Staleness cascade ──────────────────────────────────────────
  let appsFlagged = 0;
  if (row.tracker_id) {
    try {
      const result = await flagAppsByMetricChange(
        db,
        row.tracker_id,
        "new_research",
        "cron:predictions-resolve:surprise",
        `Surprise deviation on ${row.metric_label ?? "metric"}`,
      );
      appsFlagged = result.flagged_count;
    } catch (err) {
      console.warn("[surprise-cascade] flag failed:", err);
    }
  }

  // ── (2) Agent finding ──────────────────────────────────────────────
  const summary = buildSummary(row);
  const rationale = buildRationale(row);

  const findingId = await recordAgentFinding(db, {
    user_id: row.user_id,
    finding_kind: "prediction_surprise",
    summary,
    rationale,
    severity: "urgent",
    ref_kind: row.app_id ? "app" : "tracker",
    ref_id: row.app_id ?? row.tracker_id ?? null,
    space_id: row.space_id,
    confidence: 0.95, // we know with high certainty it WAS a surprise
    payload: {
      prediction_id: row.id,
      tracker_id: row.tracker_id,
      metric_label: row.metric_label,
      predicted: row.predicted_value,
      actual: row.resolved_actual,
      deviation: row.deviation,
      horizon_at: row.horizon_at,
      apps_flagged: appsFlagged,
    },
  });

  // ── (3) User event ─────────────────────────────────────────────────
  let userEventOk = false;
  try {
    const eventId = await recordUserEvent(db, {
      user_id: row.user_id,
      event_type: "misc", // no bespoke enum — payload carries the type
      source: "cron:predictions-resolve:surprise",
      ref_kind: row.app_id ? "app" : "tracker",
      ref_id: row.app_id ?? row.tracker_id ?? null,
      space_id: row.space_id ?? undefined,
      payload: {
        subtype: "prediction.surprise",
        prediction_id: row.id,
        metric_label: row.metric_label,
        deviation: row.deviation,
      },
    });
    userEventOk = !!eventId;
  } catch {
    /* non-fatal */
  }

  return {
    apps_flagged: appsFlagged,
    finding_id: findingId,
    user_event_recorded: userEventOk,
  };
}

function buildSummary(row: ResolvedSurpriseRow): string {
  const metric = row.metric_label ?? "a tracked metric";
  const hasNumbers =
    typeof row.predicted_value === "number" &&
    typeof row.resolved_actual === "number";
  if (hasNumbers) {
    const pred = row.predicted_value as number;
    const act = row.resolved_actual as number;
    return `Surprise on ${metric}: predicted ${formatNum(pred)}, actual ${formatNum(act)}.`;
  }
  return `Surprise deviation on ${metric}.`;
}

function buildRationale(row: ResolvedSurpriseRow): string {
  const parts: string[] = [];
  if (row.deviation !== null) {
    parts.push(`Deviation magnitude: ${formatNum(row.deviation)}.`);
  }
  if (row.horizon_at) {
    parts.push(`Horizon reached at ${row.horizon_at}.`);
  }
  parts.push(
    "Apps tracking this metric have been flagged for review — their assumptions may no longer hold.",
  );
  return parts.join(" ");
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}
