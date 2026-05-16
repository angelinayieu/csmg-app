/**
 * Synergy parallel-path weekly digest cron
 *
 * Fires every Monday at 8:23 UTC. For each active parallel-path room:
 *   1. Compute the week_starting Monday (00:00 UTC of last Monday)
 *   2. Count plan_step_checkins per user in [week_starting, +7d)
 *   3. Count cumulative plan_step_checkins per user (no time filter) —
 *      stored as a side-effect on the digest row so the room interior
 *      can render "Total: X vs. Y" without a separate query
 *   4. UPSERT room_digests on (room_id, week_starting) — idempotent
 *      retry-safe
 *
 * The summary text stored in the row is a neutral audit-trail string;
 * the actual user-facing sentence is rendered client-side from the
 * counts via buildDigestSummary() so each user sees the perspective-
 * appropriate "you / them" wording.
 *
 * Why a separate step.run per room: each room's COUNT + UPSERT is its
 * own checkpoint. If one room's write fails (RLS edge case, schema
 * drift), the rest of the batch completes. Mirrors the per-component
 * pattern in synergy-match-refresh.ts.
 *
 * Cron offset (8:23 UTC = 3:23am ET) chosen to:
 *   - Fall on a Monday morning across most timezones (US west awakens
 *     to the new digest with coffee at 12:23am PT — same calendar day)
 *   - Land off the top-of-hour cluster so Inngest doesn't dispatch
 *     simultaneously with other crons
 */

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/service";
import {
  formatDateOnly,
  weekStartingUtc,
} from "@/lib/synergy/digest-template";

// Cap per tick so a runaway-active marketplace doesn't blow the LLM
// budget — but there's no LLM here; this is pure SQL. We still cap
// for blast-radius safety. A market of 5000 active parallel rooms
// stretches across 5 weekly runs at this cap. (For our scale, we're
// nowhere near this.)
const MAX_ROOMS_PER_TICK = 2000;

interface RoomRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
}

export const synergyParallelDigestWeekly = inngest.createFunction(
  {
    id: "synergy-parallel-digest-weekly",
    name: "Synergy · weekly digest for parallel-path rooms",
    retries: 1,
    triggers: [{ cron: "23 8 * * 1" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    // ── Step 1: enumerate active parallel-path rooms ──
    const rooms: RoomRow[] = await step.run(
      "enumerate-active-parallel-rooms",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = createServiceClient() as any;
        const { data, error } = await db
          .from("synergy_rooms")
          .select("id, user_a, user_b, created_at")
          .eq("room_kind", "parallel_path")
          .is("archived_at", null)
          .order("created_at", { ascending: true })
          .limit(MAX_ROOMS_PER_TICK);
        if (error) throw new Error(error.message);
        return (data ?? []) as RoomRow[];
      },
    );

    if (rooms.length === 0) {
      return { rooms_total: 0, digests_written: 0 };
    }

    // ── Step 2: compute week_starting once, shared across all rooms ──
    //
    // The cron fires Monday morning UTC, so weekStartingUtc(now) returns
    // TODAY (Monday 00:00 UTC) — meaning the digest covers the week
    // that JUST ended (Sunday-midnight to now-ish). The aggregation
    // below filters by checkins where marked_complete_at >= last Monday
    // AND marked_complete_at < this Monday, i.e. the full prior week.

    const now = new Date();
    const thisWeekStart = weekStartingUtc(now);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
    const lastWeekStartIso = lastWeekStart.toISOString();
    const thisWeekStartIso = thisWeekStart.toISOString();
    const weekDateOnly = formatDateOnly(lastWeekStart);

    // ── Step 3: per-room aggregation + upsert (each its own step) ──
    let digestsWritten = 0;
    const failures: string[] = [];

    for (const room of rooms) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const ok: boolean = await step.run(
          `digest-${room.id}`,
          async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const db = createServiceClient() as any;

            // 3a — week counts. Two queries, one per user. Could also
            // do a single SELECT with GROUP BY user_id but the JS-level
            // dispatch is easier to reason about + each query is a
            // tiny index hit on (room_id, marked_complete_at).
            const { data: weekRows, error: wErr } = await db
              .from("plan_step_checkins")
              .select("user_id")
              .eq("room_id", room.id)
              .gte("marked_complete_at", lastWeekStartIso)
              .lt("marked_complete_at", thisWeekStartIso);
            if (wErr) throw new Error(wErr.message);

            // 3b — cumulative counts (no time filter)
            const { data: totalRows, error: tErr } = await db
              .from("plan_step_checkins")
              .select("user_id")
              .eq("room_id", room.id);
            if (tErr) throw new Error(tErr.message);

            let userAWeek = 0;
            let userBWeek = 0;
            for (const r of (weekRows ?? []) as Array<{ user_id: string }>) {
              if (r.user_id === room.user_a) userAWeek += 1;
              else if (r.user_id === room.user_b) userBWeek += 1;
            }
            let userATotal = 0;
            let userBTotal = 0;
            for (const r of (totalRows ?? []) as Array<{ user_id: string }>) {
              if (r.user_id === room.user_a) userATotal += 1;
              else if (r.user_id === room.user_b) userBTotal += 1;
            }

            // Skip rooms with literally no check-ins ever AND no plan
            // steps yet — there's nothing to summarize. (A room with
            // plan steps but zero check-ins still gets a "First weeks"
            // digest so the bottom of the room never looks broken.)
            if (
              userATotal === 0 &&
              userBTotal === 0 &&
              userAWeek === 0 &&
              userBWeek === 0
            ) {
              // Check if there are even any plan_step blocks for either
              // strategy — if zero on both sides, skip entirely.
              const { data: hasBlocks } = await db
                .from("synergy_strategy_blocks")
                .select("id")
                .eq("block_type", "plan_step")
                .in("strategy_id", [
                  // We need strategy ids; not on the room row in our
                  // limited SELECT. Add a second tiny lookup below.
                  await getStrategyIds(db, room.id),
                ].flat())
                .limit(1);
              if (!hasBlocks || hasBlocks.length === 0) {
                return false;
              }
            }

            // Audit-trail neutral summary string. The CLIENT renders
            // the user-perspective sentence from the counts.
            const summary =
              `Week of ${weekDateOnly} — ` +
              `A: ${userAWeek} (total ${userATotal}), ` +
              `B: ${userBWeek} (total ${userBTotal}).`;

            const { error: upErr } = await db
              .from("room_digests")
              .upsert(
                {
                  room_id: room.id,
                  week_starting: weekDateOnly,
                  summary,
                  user_a_completions: userAWeek,
                  user_b_completions: userBWeek,
                },
                { onConflict: "room_id,week_starting" },
              );
            if (upErr) throw new Error(upErr.message);

            return true;
          },
        );
        if (ok) digestsWritten += 1;
      } catch (err) {
        failures.push(`${room.id}: ${(err as Error).message}`);
      }
    }

    return {
      rooms_total: rooms.length,
      week_starting: weekDateOnly,
      digests_written: digestsWritten,
      failures: failures.length > 0 ? failures.slice(0, 10) : undefined,
    };
  },
);

/**
 * Helper — read both strategy IDs for a room. Used only on the
 * skip-empty-room path so the room-blocks check has something to query.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStrategyIds(db: any, roomId: string): Promise<string[]> {
  const { data } = await db
    .from("synergy_rooms")
    .select("strategy_a_id, strategy_b_id")
    .eq("id", roomId)
    .maybeSingle();
  if (!data) return [];
  const ids: string[] = [];
  if (data.strategy_a_id) ids.push(data.strategy_a_id);
  if (data.strategy_b_id) ids.push(data.strategy_b_id);
  return ids;
}
