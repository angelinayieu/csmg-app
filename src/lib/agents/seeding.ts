/**
 * Agent seeding — create the baseline `agents` rows for a space.
 *
 * Used in two places:
 *   1. Lazy-seed on first GET /api/agents (backfills legacy spaces)
 *   2. Proactive-seed after space creation (so the Intelligence Radar lights up
 *      before the first analysis completes)
 *
 * Idempotent: `unique (space_id, kind)` constraint + ON CONFLICT DO NOTHING
 * semantics via ensureAgent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAgent } from "./run-tracker";
import { AGENT_KINDS } from "./kinds";
import type { AgentKind } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

/**
 * Seed the default agent fleet for a space.
 * Returns the agent ids keyed by kind (or null for kinds that failed to seed).
 */
export async function seedAgentsForSpace(
  db: Db,
  spaceId: string,
  userId: string,
  opts: { kinds?: AgentKind[] } = {}
): Promise<Record<string, string | null>> {
  const kindsToSeed = opts.kinds ?? AGENT_KINDS.map((k) => k.kind);
  const ids: Record<string, string | null> = {};

  for (const kind of kindsToSeed) {
    ids[kind] = await ensureAgent(db, { spaceId, userId, kind });
  }

  return ids;
}

/**
 * Lazy backfill: if a space has zero agents rows, seed the default fleet.
 * Cheap to call on every page open — single COUNT query when already seeded.
 */
export async function backfillAgentsIfMissing(
  db: Db,
  spaceId: string,
  userId: string
): Promise<boolean> {
  try {
    const { count } = await db
      .from("agents")
      .select("*", { count: "exact", head: true })
      .eq("space_id", spaceId);

    if ((count ?? 0) > 0) return false;

    await seedAgentsForSpace(db, spaceId, userId);
    return true;
  } catch (err) {
    console.warn("[seeding] backfill failed:", err);
    return false;
  }
}
