/**
 * Wave C — recordUserEvent helper.
 *
 * Single chokepoint every mutation route calls after a user-initiated
 * change lands. Writes an append-only row into user_events so the
 * Wave C digest cron (and any future analytics consumer) has a unified
 * stream instead of having to scan 6 tables.
 *
 * Soft-fail: errors log + return; the caller's primary mutation never
 * fails because telemetry hiccups. Same pattern as the Wave B notify*
 * hooks, which this lib often runs alongside.
 *
 * Used in tandem with:
 *   - src/lib/apps/notify.ts  — staleness cascade across apps
 *   - this file                — user-level event logging
 *
 * Both can run on the same mutation. They answer different questions:
 * notify* is "which apps need a refresh badge", recordUserEvent is
 * "what did the user just do, so the digest agent can learn their pattern".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RecordUserEventInput,
  UserEventType,
} from "@/types/user-baseline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export async function recordUserEvent(
  db: AnyDb,
  input: RecordUserEventInput,
): Promise<string | null> {
  if (!input.user_id || !input.event_type || !input.source) {
    console.warn(
      "[user-events] recordUserEvent missing required fields:",
      input,
    );
    return null;
  }

  try {
    const { data, error } = await db
      .from("user_events")
      .insert({
        user_id: input.user_id,
        event_type: input.event_type,
        source: input.source,
        ref_kind: input.ref_kind ?? null,
        ref_id: input.ref_id ?? null,
        space_id: input.space_id ?? null,
        payload: input.payload ?? {},
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[user-events] insert failed:", error);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn("[user-events] recordUserEvent threw:", err);
    return null;
  }
}

/**
 * Batch variant — one DB round-trip for N events. Use when a single
 * mutation produces multiple related events (e.g. decompose creates N
 * entities + M proposed goals). Payloads are not merged; each event
 * stays distinct.
 */
export async function recordUserEventsBatch(
  db: AnyDb,
  events: RecordUserEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;
  const valid = events.filter(
    (e) => e.user_id && e.event_type && e.source,
  );
  if (valid.length === 0) return 0;

  try {
    const rows = valid.map((e) => ({
      user_id: e.user_id,
      event_type: e.event_type,
      source: e.source,
      ref_kind: e.ref_kind ?? null,
      ref_id: e.ref_id ?? null,
      space_id: e.space_id ?? null,
      payload: e.payload ?? {},
    }));
    const { error, count } = await db
      .from("user_events")
      .insert(rows, { count: "exact" });
    if (error) {
      console.warn("[user-events] batch insert failed:", error);
      return 0;
    }
    return count ?? rows.length;
  } catch (err) {
    console.warn("[user-events] recordUserEventsBatch threw:", err);
    return 0;
  }
}

/**
 * Convenience: fetch a user's recent events. Used by the digest cron
 * and by future analytics / dashboard consumers.
 *
 * Filters:
 *   sinceHours  — last N hours (default 168 = 7 days)
 *   eventTypes  — optional whitelist
 *   limit       — max rows (default 500)
 */
export async function fetchRecentUserEvents(
  db: AnyDb,
  userId: string,
  opts: {
    sinceHours?: number;
    eventTypes?: UserEventType[] | string[];
    limit?: number;
  } = {},
): Promise<
  Array<{
    id: string;
    event_type: string;
    source: string;
    ref_kind: string | null;
    ref_id: string | null;
    space_id: string | null;
    payload: Record<string, unknown>;
    at: string;
  }>
> {
  const sinceHours = opts.sinceHours ?? 24 * 7;
  const limit = opts.limit ?? 500;
  const since = new Date(
    Date.now() - sinceHours * 60 * 60 * 1000,
  ).toISOString();

  let query = db
    .from("user_events")
    .select(
      "id, event_type, source, ref_kind, ref_id, space_id, payload, at",
    )
    .eq("user_id", userId)
    .gte("at", since)
    .order("at", { ascending: false })
    .limit(limit);

  if (opts.eventTypes && opts.eventTypes.length > 0) {
    query = query.in("event_type", opts.eventTypes as string[]);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[user-events] fetchRecentUserEvents failed:", error);
    return [];
  }
  return (
    (data as Array<{
      id: string;
      event_type: string;
      source: string;
      ref_kind: string | null;
      ref_id: string | null;
      space_id: string | null;
      payload: Record<string, unknown>;
      at: string;
    }> | null) ?? []
  );
}
