// GET /api/spaces/:id/pulse-events — real activity feed for the PulseBar
//
// The PulseBar's recent-activity panel was derived synthetically from
// rollup aggregates (Tier 8 v1), which meant timestamps were fake and
// individual events ("NPS prediction surprised at 2024-11-03 14:22")
// were invisible. This endpoint pulls genuine per-row events from the
// four sources that produce user-visible activity:
//
//   1. space_changelog    — durable log of pipeline events (research
//                           escalations, strategy commits, apps marked
//                           stale, etc.)
//   2. prediction_ledger  — resolved predictions tagged as surprise or
//                           regime_shift (the high-value training signal)
//   3. app_agent_runs     — predictor agent invocations that produced
//                           new predictions (Tier 5+)
//   4. app_strategies     — sub-strategy regens, especially deviation-
//                           triggered ones
//
// Normalization: all four sources funnel into a unified PulseEvent shape
// matching `src/components/pulse/pulse-recent-panel.tsx`. Each source has
// its own kind mapping + title formatter. The endpoint returns events
// sorted by their real timestamp, not a synthetic "now" marker.
//
// Budget: capped at 30 events total (5-10 from each source), sorted and
// clipped. The PulseRecentPanel already shows only the top 12, so this
// is generous headroom without bloating the response.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { PulseEvent, PulseEventKind } from "@/components/pulse";

export const maxDuration = 30;
// The endpoint is hit every 30s by the pulse hook's poll — keep it fast.
// All four queries use existing indexes + return small slices.

export interface PulseEventsResponse {
  /** Per-source events, normalized + sorted most-recent first. */
  events: PulseEvent[];
  /**
   * Analysis in-flight indicator — true when this space has an
   * analysis_jobs row in queued/running status. Drives the "Analyzing"
   * state on the PulseBar so users see the system breathing while
   * work is happening.
   */
  analyzing: boolean;
  /** Current phase name when analyzing — shown in the status label. */
  analysis_phase: string | null;
  /** ISO timestamp of when the response was computed. */
  computed_at: string;
}

const EVENT_WINDOW_DAYS = 7;
const PER_SOURCE_CAP = 10;
const TOTAL_CAP = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check — cheap select on the space itself. RLS handles
  // the sub-queries below, but we want a clean 403 on missing/wrong
  // space instead of a silent empty response.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const windowIso = new Date(
    Date.now() - EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // ── Parallel fan-out across the four sources ───────────────────────
  // analysis_jobs read is the fifth parallel call — cheap, same pattern.
  const [
    { data: changelogRows },
    { data: predictionRows },
    { data: agentRunRows },
    { data: substrategyRows },
    { data: activeJob },
  ] = await Promise.all([
    db
      .from("space_changelog")
      .select("id, change_type, summary, details, created_at")
      .eq("space_id", spaceId)
      .gte("created_at", windowIso)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE_CAP),
    db
      .from("prediction_ledger")
      .select("id, metric_label, predicted_value, resolved_actual, deviation_tag, resolved_at, app_id")
      .eq("space_id", spaceId)
      .eq("status", "resolved")
      .in("deviation_tag", ["surprise", "regime_shift"])
      .gte("resolved_at", windowIso)
      .order("resolved_at", { ascending: false })
      .limit(PER_SOURCE_CAP),
    db
      .from("app_agent_runs")
      .select("id, agent_id, agent_role, status, completed_at, output, note")
      .eq("space_id", spaceId)
      .eq("status", "completed")
      .gte("completed_at", windowIso)
      .order("completed_at", { ascending: false })
      .limit(PER_SOURCE_CAP),
    db
      .from("app_strategies")
      .select("id, app_id, generated_at, last_deviation_trigger_at, generation_rationale, generated_by, version")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .or(`generated_at.gte.${windowIso},last_deviation_trigger_at.gte.${windowIso}`)
      .order("generated_at", { ascending: false })
      .limit(PER_SOURCE_CAP),
    db
      .from("analysis_jobs")
      .select("id, status, current_phase, created_at")
      .eq("space_id", spaceId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const events: PulseEvent[] = [];

  // ── Normalize changelog entries ────────────────────────────────────
  //
  // change_type is a loose string in practice (DB has no constraint but
  // the types union is narrower than what writers actually use).
  // Map known kinds; fall back to "agent_run" icon for unknown.
  for (const row of (changelogRows ?? []) as Array<{
    id: string;
    change_type: string;
    summary: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
  }>) {
    const kind = mapChangelogKind(row.change_type);
    if (!kind) continue; // skip uninteresting internal events
    events.push({
      id: `changelog:${row.id}`,
      kind,
      title: row.summary ?? row.change_type.replace(/_/g, " "),
      detail: changelogDetail(row.change_type, row.details),
      at: row.created_at,
      meta: changelogMeta(row.change_type, row.details),
    });
  }

  // ── Normalize resolved-prediction surprises ────────────────────────
  //
  // These are the individual data points the user most wants to see —
  // "NPS dropped 12 points below prediction" is the kind of event that
  // deserves its own row. Using real per-prediction timestamps instead
  // of the rollup's synthetic summary.
  for (const row of (predictionRows ?? []) as Array<{
    id: string;
    metric_label: string;
    predicted_value: number | null;
    resolved_actual: number | null;
    deviation_tag: "surprise" | "regime_shift" | null;
    resolved_at: string | null;
    app_id: string | null;
  }>) {
    if (!row.resolved_at) continue;
    const kind: PulseEventKind = row.deviation_tag === "surprise" ? "surprise" : "surprise";
    // Both surprise and regime_shift map to the same visual kind — the
    // meta field carries the distinction so the UI can style differently
    // if it wants to.
    const delta =
      row.predicted_value !== null && row.resolved_actual !== null
        ? row.resolved_actual - row.predicted_value
        : null;
    events.push({
      id: `prediction:${row.id}`,
      kind,
      title: `${row.metric_label} ${row.deviation_tag === "regime_shift" ? "shifted regime" : "surprised"}`,
      detail:
        row.predicted_value !== null && row.resolved_actual !== null
          ? `Predicted ${formatNum(row.predicted_value)}, actual ${formatNum(row.resolved_actual)} (${delta !== null ? formatDelta(delta) : "?"})`
          : "Prediction resolved with significant deviation",
      at: row.resolved_at,
      meta:
        row.deviation_tag === "regime_shift"
          ? "regime shift"
          : "surprise",
      href: row.app_id ? `/app/space/${spaceId}/app/${row.app_id}` : undefined,
    });
  }

  // ── Normalize predictor agent runs ─────────────────────────────────
  //
  // Each completed run with a `predictor` role produced a new prediction.
  // Other roles (measurer, validator, etc.) will land here in v2 — for
  // now we filter to predictor only since that's all the runtime emits.
  for (const row of (agentRunRows ?? []) as Array<{
    id: string;
    agent_id: string;
    agent_role: string;
    completed_at: string | null;
    output: Record<string, unknown> | null;
    note: string | null;
  }>) {
    if (!row.completed_at) continue;
    if (row.agent_role !== "predictor") continue;
    const output = row.output as { metric_label?: string; predicted_value?: number; method?: string } | null;
    const metric = output?.metric_label ?? "a metric";
    events.push({
      id: `agent_run:${row.id}`,
      kind: "prediction_logged",
      title: `Predictor agent logged ${metric}`,
      detail:
        output?.method === "linear_extrapolation"
          ? `Linear extrapolation from recent observations${output.predicted_value !== undefined ? ` → ${formatNum(output.predicted_value)}` : ""}`
          : output?.method === "last_value_hold"
            ? "Last-value hold (insufficient trend data)"
            : row.note ?? "Prediction emitted",
      at: row.completed_at,
      meta: output?.method?.replace(/_/g, " "),
    });
  }

  // ── Normalize sub-strategy regens ──────────────────────────────────
  //
  // Deviation-triggered regens are the most interesting — they're the
  // system responding to surprises. Non-deviation regens (scheduled
  // refreshes, initial generation) are lower signal; skip them from
  // the pulse since they'll flood the feed during batch pre-generation.
  for (const row of (substrategyRows ?? []) as Array<{
    id: string;
    app_id: string;
    generated_at: string;
    last_deviation_trigger_at: string | null;
    generation_rationale: string | null;
    generated_by: string;
    version: number;
  }>) {
    const isDeviationDriven = !!row.last_deviation_trigger_at;
    // Only surface deviation-driven regens. Other regens are internal
    // machinery the user doesn't care about at this level.
    if (!isDeviationDriven) continue;
    events.push({
      id: `substrategy:${row.id}`,
      kind: "substrategy_regen",
      title: `Sub-strategy refined (v${row.version})`,
      detail: row.generation_rationale ?? "Deviation signal triggered a spec regeneration",
      at: row.last_deviation_trigger_at ?? row.generated_at,
      meta: "deviation-driven",
      href: `/app/space/${spaceId}/app/${row.app_id}`,
    });
  }

  // ── Sort + cap ─────────────────────────────────────────────────────
  events.sort((a, b) => b.at.localeCompare(a.at));
  const capped = events.slice(0, TOTAL_CAP);

  const response: PulseEventsResponse = {
    events: capped,
    analyzing: !!activeJob,
    analysis_phase: (activeJob as { current_phase?: string } | null)?.current_phase ?? null,
    computed_at: new Date().toISOString(),
  };

  return NextResponse.json(response);
}

// ── Mappers ────────────────────────────────────────────────────────────

function mapChangelogKind(type: string): PulseEventKind | null {
  switch (type) {
    case "research_escalation":
      return "research_finding";
    case "strategy_committed":
      return "strategy_approved";
    case "apps_marked_stale":
      return "agent_run";
    case "initial_analysis":
      return "research_finding";
    case "reevaluation":
      return "research_finding";
    case "synthesis_refresh":
      return "research_finding";
    case "exploration":
      return "agent_run";
    // Unknown types get skipped rather than guessed — noise reduction.
    default:
      return null;
  }
}

function changelogDetail(
  type: string,
  details: Record<string, unknown> | null,
): string | undefined {
  if (!details) return undefined;
  switch (type) {
    case "research_escalation": {
      const metric = typeof details.metric_label === "string" ? details.metric_label : null;
      const tag = typeof details.deviation_tag === "string" ? details.deviation_tag : null;
      if (metric && tag) return `${metric} tagged ${tag} — escalated to research queue`;
      return undefined;
    }
    case "apps_marked_stale": {
      const count =
        typeof details.affected_app_ids === "object" && Array.isArray(details.affected_app_ids)
          ? details.affected_app_ids.length
          : null;
      const reason = typeof details.reason === "string" ? details.reason : null;
      if (count !== null && reason) {
        return `${count} ${count === 1 ? "app" : "apps"} flagged (${reason})`;
      }
      return undefined;
    }
    case "strategy_committed": {
      const trackers = typeof details.tracker_count === "number" ? details.tracker_count : null;
      const apps = (details.apps_result as { apps_total?: number } | null)?.apps_total ?? null;
      if (trackers !== null && apps !== null) {
        return `${apps} ${apps === 1 ? "app" : "apps"} materialized · ${trackers} trackers initialized`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function changelogMeta(
  type: string,
  details: Record<string, unknown> | null,
): string | undefined {
  if (!details) return undefined;
  if (type === "apps_marked_stale") {
    const subs = typeof details.substrategies_flagged === "number" ? details.substrategies_flagged : 0;
    const preds = typeof details.predictions_invalidated === "number" ? details.predictions_invalidated : 0;
    const parts: string[] = [];
    if (subs > 0) parts.push(`${subs} sub-strat`);
    if (preds > 0) parts.push(`${preds} preds`);
    return parts.length > 0 ? `cascade: ${parts.join(", ")}` : undefined;
  }
  return undefined;
}

// ── Formatters ─────────────────────────────────────────────────────────

function formatNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function formatDelta(d: number): string {
  const sign = d > 0 ? "+" : "";
  return `${sign}${formatNum(d)}`;
}
