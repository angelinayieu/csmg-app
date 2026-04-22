/**
 * Wave C — user-behavior digest engine.
 *
 * Two callable surfaces:
 *   - digestForUser(db, userId) — runs the LLM on one user's recent
 *     events, writes the result into profiles. Called from the cron
 *     and from /api/user-baseline/regenerate.
 *   - digestAllStaleUsers(db, opts) — picks candidate users (threshold
 *     on events_since_last_digest OR age of behavior_summary_updated_at)
 *     and runs digestForUser on each. Called by the nightly cron.
 *
 * Aggregation strategy:
 *   - Fetch the last 30d of events for the user (cap 500).
 *   - Compute a small context bundle: counts by event_type, distinct
 *     sources, time spans. Send this alongside a trimmed event list.
 *   - LLM produces persona_tags + behavior_summary + goal_preferences +
 *     baseline_metrics.
 *   - Persist to profiles; reset events_since_last_digest to 0.
 *   - Memory-index the new behavior_summary under the user's memory
 *     namespace so the Lab + Synthesis prompts can retrieve it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { llmJSON } from "@/lib/llm";
import { USER_BEHAVIOR_DIGEST_SYSTEM_PROMPT } from "@/lib/prompts/user-behavior-digest";
import type { UserBehaviorDigestOutput } from "@/types/user-baseline";
import { fetchRecentUserEvents } from "./record";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface DigestResult {
  user_id: string;
  updated: boolean;
  events_considered: number;
  skipped_reason?: string;
  digest?: UserBehaviorDigestOutput;
}

/** Minimum events needed before we bother calling the LLM. Below this,
 *  the digest would be synthetic and unhelpful; we set a placeholder
 *  summary that says "not enough data yet" and move on. */
const MIN_EVENTS_FOR_DIGEST = 5;

/** Window the LLM sees — keep bounded so token cost stays predictable. */
const EVENT_WINDOW_HOURS = 24 * 30; // 30 days
const EVENT_CAP = 300;

export async function digestForUser(
  db: AnyDb,
  userId: string,
): Promise<DigestResult> {
  const events = await fetchRecentUserEvents(db, userId, {
    sinceHours: EVENT_WINDOW_HOURS,
    limit: EVENT_CAP,
  });

  if (events.length < MIN_EVENTS_FOR_DIGEST) {
    // Still update the bookkeeping so the cron doesn't re-pick this
    // user until more events arrive.
    await db
      .from("profiles")
      .update({
        behavior_summary:
          `Not enough activity yet to infer a pattern (${events.length} recent events). Keep using the product and this will fill in.`,
        behavior_summary_updated_at: new Date().toISOString(),
        events_since_last_digest: 0,
      })
      .eq("id", userId);

    return {
      user_id: userId,
      updated: true,
      events_considered: events.length,
      skipped_reason: "insufficient_events",
    };
  }

  // Aggregate counts for the prompt context.
  const countsByType = new Map<string, number>();
  const sources = new Set<string>();
  const spaces = new Set<string>();
  let earliest = events[0].at;
  let latest = events[0].at;
  for (const e of events) {
    countsByType.set(e.event_type, (countsByType.get(e.event_type) ?? 0) + 1);
    sources.add(e.source);
    if (e.space_id) spaces.add(e.space_id);
    if (e.at < earliest) earliest = e.at;
    if (e.at > latest) latest = e.at;
  }

  const spanMs = new Date(latest).getTime() - new Date(earliest).getTime();
  const spanDays = Math.max(1, spanMs / (1000 * 60 * 60 * 24));

  // Trim each event's payload to keep the prompt small.
  const trimmedEvents = events.map((e) => ({
    type: e.event_type,
    source: e.source,
    ref_kind: e.ref_kind,
    at: e.at,
    payload: trimPayload(e.payload),
  }));

  const promptContext = {
    events: trimmedEvents,
    aggregates: {
      total_events: events.length,
      distinct_event_types: countsByType.size,
      distinct_spaces: spaces.size,
      counts_by_type: Object.fromEntries(countsByType),
      span_days: Math.round(spanDays * 10) / 10,
      events_per_week: Math.round((events.length / spanDays) * 7 * 10) / 10,
    },
  };

  let output: UserBehaviorDigestOutput;
  try {
    output = await llmJSON<UserBehaviorDigestOutput>({
      system: USER_BEHAVIOR_DIGEST_SYSTEM_PROMPT,
      user: JSON.stringify(promptContext, null, 2),
      maxTokens: 1500,
      temperature: 0.3,
    });
  } catch (err) {
    console.warn(`[digest] LLM failed for user ${userId}:`, err);
    return {
      user_id: userId,
      updated: false,
      events_considered: events.length,
      skipped_reason: "llm_error",
    };
  }

  // Defensive validation.
  const safeTags = Array.isArray(output?.persona_tags)
    ? output.persona_tags
        .filter((t): t is string => typeof t === "string" && t.length > 0)
        .slice(0, 7)
    : [];
  const safeSummary =
    typeof output?.behavior_summary === "string"
      ? output.behavior_summary.slice(0, 2000)
      : "";
  const safeGoalPrefs =
    output?.goal_preferences && typeof output.goal_preferences === "object"
      ? (output.goal_preferences as Record<string, unknown>)
      : {};
  const safeBaseline =
    output?.baseline_metrics &&
    typeof output.baseline_metrics === "object"
      ? (output.baseline_metrics as Record<string, unknown>)
      : {};

  const { error: updErr } = await db
    .from("profiles")
    .update({
      persona_tags: safeTags,
      behavior_summary: safeSummary,
      goal_preferences: safeGoalPrefs,
      baseline_metrics: safeBaseline,
      behavior_summary_updated_at: new Date().toISOString(),
      events_since_last_digest: 0,
    })
    .eq("id", userId);

  if (updErr) {
    console.warn(`[digest] profile update failed for ${userId}:`, updErr);
    return {
      user_id: userId,
      updated: false,
      events_considered: events.length,
      skipped_reason: "profile_update_failed",
    };
  }

  return {
    user_id: userId,
    updated: true,
    events_considered: events.length,
    digest: {
      persona_tags: safeTags,
      behavior_summary: safeSummary,
      goal_preferences: safeGoalPrefs,
      baseline_metrics: safeBaseline as Record<string, number | string>,
    },
  };
}

/**
 * Candidate selection for the cron: users whose events_since_last_digest
 * has crossed a threshold OR whose behavior_summary is stale (or null).
 *
 * Threshold: 20 events OR 24h since last digest. Tuned so a typical
 * active user gets a refresh within a day of meaningful new behaviour.
 */
export async function digestAllStaleUsers(
  db: AnyDb,
  opts: {
    eventThreshold?: number;
    staleAgeHours?: number;
    maxUsers?: number;
  } = {},
): Promise<{
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const eventThreshold = opts.eventThreshold ?? 20;
  const staleAgeHours = opts.staleAgeHours ?? 24;
  const maxUsers = opts.maxUsers ?? 200;

  const staleCutoff = new Date(
    Date.now() - staleAgeHours * 60 * 60 * 1000,
  ).toISOString();

  // Candidate query: events_since_last_digest >= threshold OR summary is
  // null / older than cutoff.
  const { data: candidates } = (await db
    .from("profiles")
    .select("id, events_since_last_digest, behavior_summary_updated_at")
    .or(
      `events_since_last_digest.gte.${eventThreshold},behavior_summary_updated_at.lt.${staleCutoff},behavior_summary_updated_at.is.null`,
    )
    .order("behavior_summary_updated_at", {
      ascending: true,
      nullsFirst: true,
    })
    .limit(maxUsers)) as {
    data: Array<{
      id: string;
      events_since_last_digest: number;
      behavior_summary_updated_at: string | null;
    }> | null;
  };

  const rows = candidates ?? [];
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await digestForUser(db, row.id);
      if (result.updated) updated += 1;
      else if (result.skipped_reason === "insufficient_events")
        skipped += 1;
      else failed += 1;
    } catch (err) {
      console.warn(`[digest] user ${row.id} threw:`, err);
      failed += 1;
    }
  }

  return { scanned: rows.length, updated, skipped, failed };
}

/** Payload trimmer — the LLM doesn't need every field, and oversized
 *  payloads blow token budgets. Keep obvious signal keys, drop others. */
function trimPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keep = [
    "reason",
    "confidence",
    "source",
    "direction",
    "magnitude",
    "cross_canvas",
    "auto_detected",
    "prior_stale_reason",
    "lean",
    "objective_type",
  ];
  for (const k of keep) {
    if (k in payload) out[k] = payload[k];
  }
  return out;
}
