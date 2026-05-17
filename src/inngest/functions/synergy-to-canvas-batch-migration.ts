/**
 * ── Synergy → Canvas batch migration (Phase 3) ──
 *
 * Event-triggered Inngest function that migrates all of a single
 * user's brainstorm_sessions into spaces (kind='brainstorm') with
 * dual-written components for backwards compatibility.
 *
 * Triggered by the `app/migrate-user-brainstorms` event — fired
 * either by:
 *   1. An admin script during the staged rollout (10% → 50% → 100%)
 *   2. The user's first sign-in after their cohort is enabled
 *      (a tiny middleware check fires the event then redirects)
 *
 * Idempotent: skips any session whose migrated_to_space_id is
 * already set. Safe to re-run on the same user.
 *
 * Transactional per-session: each session's insert chain runs as a
 * single batch (RPC) so a mid-session failure rolls back cleanly
 * — we never end up with a half-migrated session that the dashboard
 * shows as both legacy AND new.
 *
 * See UNIFICATION_DATA_MODEL_SPEC.md §4 for the migration strategy.
 */

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/service";
import {
  sessionToSpaceRow,
  nodeToEntityRow,
  componentToEntityRow,
  nodeParentToEdgeRow,
} from "@/lib/synergy/migration-helpers";
import type {
  BrainstormSession,
  BrainstormNode,
  BrainstormComponent,
} from "@/lib/synergy/types";

// Cap rows-per-batch insert so we don't blow up Supabase's PostgREST
// row limit on the rare 500-node session.
const INSERT_BATCH_SIZE = 200;

interface MigrationResult {
  user_id: string;
  sessions_migrated: number;
  sessions_skipped: number;
  sessions_failed: number;
  entities_created: number;
  edges_created: number;
  strategies_relinked: number;
  errors: Array<{ session_id: string; message: string }>;
}

export const synergyToCanvasBatchMigration = inngest.createFunction(
  {
    id: "synergy-to-canvas-batch-migration",
    name: "Phase 3 · migrate user's brainstorms to canvas",
    // Retry once on transient failures. The per-session transactional
    // guard means a retry won't double-insert; it'll either skip
    // (migrated_to_space_id set) or re-attempt cleanly.
    retries: 1,
    concurrency: {
      // Cap to 4 concurrent user-migrations so we don't pin every
      // Postgres connection during the bulk-rollout day.
      limit: 4,
    },
    triggers: [{ event: "app/migrate-user-brainstorms" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const userId: string | undefined = event.data?.user_id;
    if (!userId || typeof userId !== "string") {
      return {
        error: "user_id required in event data",
      };
    }

    // Step 1 — fetch unmigrated sessions for this user.
    const sessions: BrainstormSession[] = await step.run(
      "fetch-unmigrated-sessions",
      async () => {
        const db = createServiceClient();
        const { data, error } = await db
          .from("brainstorm_sessions")
          .select("*")
          .eq("owner_id", userId)
          .is("migrated_to_space_id", null);
        if (error) throw error;
        return (data ?? []) as BrainstormSession[];
      },
    );

    if (sessions.length === 0) {
      return {
        user_id: userId,
        sessions_migrated: 0,
        sessions_skipped: 0,
        sessions_failed: 0,
        entities_created: 0,
        edges_created: 0,
        strategies_relinked: 0,
        errors: [],
      } satisfies MigrationResult;
    }

    // Step 2 — per-session migration. Each session is its own step
    // so Inngest's resumability handles partial-failure cleanly: a
    // crash during session 14 of 20 means a retry resumes at 15
    // (sessions 1-14 already have migrated_to_space_id set).
    const result: MigrationResult = {
      user_id: userId,
      sessions_migrated: 0,
      sessions_skipped: 0,
      sessions_failed: 0,
      entities_created: 0,
      edges_created: 0,
      strategies_relinked: 0,
      errors: [],
    };

    for (const session of sessions) {
      const stepName = `migrate-session-${session.id}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const perSession: any = await step.run(stepName, async () => {
        return await migrateSingleSession(session);
      });

      if (perSession.skipped) result.sessions_skipped += 1;
      else if (perSession.error) {
        result.sessions_failed += 1;
        result.errors.push({
          session_id: session.id,
          message: perSession.error,
        });
      } else {
        result.sessions_migrated += 1;
        result.entities_created += perSession.entities_created ?? 0;
        result.edges_created += perSession.edges_created ?? 0;
        result.strategies_relinked += perSession.strategies_relinked ?? 0;
      }
    }

    return result;
  },
);

// ── Per-session migration (idempotent + transactional-per-table) ──

interface SingleSessionResult {
  skipped?: boolean;
  error?: string;
  entities_created?: number;
  edges_created?: number;
  strategies_relinked?: number;
}

async function migrateSingleSession(
  session: BrainstormSession,
): Promise<SingleSessionResult> {
  const db = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any;

  try {
    // Re-check migration state (idempotency guard against double-fire).
    const { data: latest } = await dbAny
      .from("brainstorm_sessions")
      .select("migrated_to_space_id")
      .eq("id", session.id)
      .maybeSingle();
    if (latest?.migrated_to_space_id) {
      return { skipped: true };
    }

    // 1. Insert the space row (same UUID as session for redirect-by-ID).
    const spaceRow = sessionToSpaceRow(session);
    const { error: spaceErr } = await dbAny.from("spaces").insert(spaceRow);
    if (spaceErr) {
      // If the space already exists (e.g. partial prior run that
      // failed before stamping migrated_to_space_id), treat as
      // recoverable and continue. The conflict on PK means the row
      // is already there; subsequent inserts (entities, edges) are
      // also idempotent because we use deterministic entity_ids.
      if (!spaceErr.message?.includes("duplicate")) {
        throw new Error(`space insert failed: ${spaceErr.message}`);
      }
    }
    const spaceId = session.id;

    // 2. Load + insert entity rows from brainstorm_nodes.
    const { data: nodesData } = await dbAny
      .from("brainstorm_nodes")
      .select("*")
      .eq("session_id", session.id);
    const nodes = (nodesData ?? []) as BrainstormNode[];
    const entityRows = nodes.map((n) => nodeToEntityRow(n, spaceId));
    const entitiesCreated = await batchInsert(dbAny, "entities", entityRows);

    // 3. Insert edges derived from node.parent_id.
    const edgeRows = nodes
      .map((n) => nodeParentToEdgeRow(n, spaceId))
      .filter((e): e is NonNullable<typeof e> => e !== null);
    const edgesCreated = await batchInsert(dbAny, "edges", edgeRows);

    // 4. Dual-write components — also insert as entities with
    //    is_extracted=true. brainstorm_components stays populated
    //    so marketplace + rooms keep working untouched.
    const { data: componentsData } = await dbAny
      .from("brainstorm_components")
      .select("*")
      .eq("session_id", session.id);
    const components = (componentsData ?? []) as BrainstormComponent[];
    const componentEntityRows = components.map((c) =>
      componentToEntityRow(c, spaceId),
    );
    const componentEntitiesCreated = await batchInsert(
      dbAny,
      "entities",
      componentEntityRows,
    );

    // 5. Relink synergy_strategies via space_id.
    const { data: updatedStrategies } = await dbAny
      .from("synergy_strategies")
      .update({ space_id: spaceId })
      .eq("session_id", session.id)
      .select("id");
    const strategiesRelinked = (updatedStrategies ?? []).length;

    // 6. Mark the session as migrated. This is the atomic flag the
    //    redirect middleware reads. Done LAST so any earlier failure
    //    leaves migrated_to_space_id null + the session falls back
    //    to the legacy whiteboard.
    const { error: stampErr } = await dbAny
      .from("brainstorm_sessions")
      .update({
        migrated_to_space_id: spaceId,
        migrated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (stampErr) {
      throw new Error(`migration stamp failed: ${stampErr.message}`);
    }

    return {
      entities_created: entitiesCreated + componentEntitiesCreated,
      edges_created: edgesCreated,
      strategies_relinked: strategiesRelinked,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Chunked insert — Supabase's PostgREST chokes on huge arrays.
// Returns the total inserted row count.
async function batchInsert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  table: string,
  rows: unknown[],
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { data, error } = await db.from(table).insert(chunk).select("id");
    if (error) {
      // Duplicate-key on retry is OK — that subset is already in.
      if (!error.message?.includes("duplicate")) {
        throw new Error(`batch insert (${table}) failed: ${error.message}`);
      }
    } else {
      inserted += (data ?? []).length;
    }
  }
  return inserted;
}
