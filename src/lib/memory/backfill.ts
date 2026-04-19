/**
 * Owner-wide backfill: walks every source table and upserts memory_items.
 *
 * Called from POST /api/memory/backfill. Safe to re-run — upsertMemoryItemsBatch
 * skips rows whose text is unchanged. A full user has ~hundreds of entities +
 * notes + bridges; runtime is dominated by the embedding API call latency.
 *
 * Reports per-kind counts so the UI (admin view or setup flow) can show
 * progress. Errors per kind are isolated — a failed entities batch doesn't
 * prevent canvases from indexing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  upsertMemoryItemsBatch,
  buildEntityInput,
  buildCanvasInput,
  buildBridgeInput,
  buildObjectiveInput,
  buildAppInput,
  indexNotesForCanvas,
  type MemoryUpsertInput,
  type MemoryUpsertResult,
} from "./writer";
import type { Canvas } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface BackfillReport {
  entities: MemoryUpsertResult;
  bridges: MemoryUpsertResult;
  objectives: MemoryUpsertResult;
  apps: MemoryUpsertResult;
  canvases: MemoryUpsertResult;
  notes: MemoryUpsertResult & { pruned: number };
  total_time_ms: number;
}

const EMPTY_RESULT: MemoryUpsertResult = {
  upserted: 0,
  skipped_unchanged: 0,
  failed: 0,
};

function addResults(
  a: MemoryUpsertResult,
  b: MemoryUpsertResult,
): MemoryUpsertResult {
  return {
    upserted: a.upserted + b.upserted,
    skipped_unchanged: a.skipped_unchanged + b.skipped_unchanged,
    failed: a.failed + b.failed,
  };
}

export async function runBackfill(
  db: AnyDb,
  ownerId: string,
): Promise<BackfillReport> {
  const start = Date.now();

  const report: BackfillReport = {
    entities: EMPTY_RESULT,
    bridges: EMPTY_RESULT,
    objectives: EMPTY_RESULT,
    apps: EMPTY_RESULT,
    canvases: EMPTY_RESULT,
    notes: { ...EMPTY_RESULT, pruned: 0 },
    total_time_ms: 0,
  };

  // ── Entities ──
  try {
    // Join spaces to filter by owner (entities.user_id doesn't exist; we go
    // via space_id ∈ spaces where user_id = ownerId).
    const { data: spaces } = (await db
      .from("spaces")
      .select("id")
      .eq("user_id", ownerId)) as { data: Array<{ id: string }> | null };
    const spaceIds = (spaces ?? []).map((s) => s.id);

    if (spaceIds.length > 0) {
      const { data: entities } = (await db
        .from("entities")
        .select("id, space_id, name, description, importance")
        .in("space_id", spaceIds)) as {
        data: Array<{
          id: string;
          space_id: string;
          name: string;
          description: string | null;
          importance: string | null;
        }> | null;
      };
      const inputs = (entities ?? []).map((e) => buildEntityInput(ownerId, e));
      report.entities = await upsertMemoryItemsBatch(db, inputs);
    }
  } catch (err) {
    console.warn("[backfill] entities failed:", err);
    report.entities = { ...report.entities, failed: report.entities.failed + 1 };
  }

  // ── Bridges ──
  try {
    const { data: bridges } = (await db
      .from("bridges")
      .select(
        "id, source_entity_id, target_entity_id, shared_variable_name, description, bridge_type, source_space_id, target_space_id",
      )) as {
      data: Array<{
        id: string;
        source_entity_id: string;
        target_entity_id: string;
        shared_variable_name: string;
        description: string | null;
        bridge_type: string;
        source_space_id: string;
        target_space_id: string;
      }> | null;
    };

    // Filter to owner's bridges (RLS will too, but explicit is safer).
    const { data: ownedSpaces } = (await db
      .from("spaces")
      .select("id")
      .eq("user_id", ownerId)) as { data: Array<{ id: string }> | null };
    const ownedSet = new Set((ownedSpaces ?? []).map((s) => s.id));

    const owned = (bridges ?? []).filter(
      (b) => ownedSet.has(b.source_space_id) || ownedSet.has(b.target_space_id),
    );

    // Hydrate entity names so bridge text is human-readable
    const entityIds = Array.from(
      new Set(owned.flatMap((b) => [b.source_entity_id, b.target_entity_id])),
    );
    const entityNames = new Map<string, string>();
    if (entityIds.length > 0) {
      const { data: ents } = (await db
        .from("entities")
        .select("id, name")
        .in("id", entityIds)) as {
        data: Array<{ id: string; name: string }> | null;
      };
      for (const e of ents ?? []) entityNames.set(e.id, e.name);
    }

    const inputs: MemoryUpsertInput[] = owned.map((b) =>
      buildBridgeInput(
        ownerId,
        b,
        entityNames.get(b.source_entity_id),
        entityNames.get(b.target_entity_id),
      ),
    );
    report.bridges = await upsertMemoryItemsBatch(db, inputs);
  } catch (err) {
    console.warn("[backfill] bridges failed:", err);
  }

  // ── Objectives ──
  try {
    const { data: goals } = (await db
      .from("improvement_goals")
      .select("id, title, description")
      .eq("user_id", ownerId)) as {
      data: Array<{ id: string; title: string; description: string | null }> | null;
    };
    const inputs = (goals ?? []).map((g) => buildObjectiveInput(ownerId, g));
    report.objectives = await upsertMemoryItemsBatch(db, inputs);
  } catch (err) {
    console.warn("[backfill] objectives failed:", err);
  }

  // ── Apps ──
  try {
    const { data: apps } = (await db
      .from("apps")
      .select("id, name, description")
      .eq("user_id", ownerId)) as {
      data: Array<{ id: string; name: string; description: string | null }> | null;
    };
    const inputs = (apps ?? []).map((a) => buildAppInput(ownerId, a));
    report.apps = await upsertMemoryItemsBatch(db, inputs);
  } catch (err) {
    console.warn("[backfill] apps failed:", err);
  }

  // ── Canvases (metadata) ──
  let canvases: Canvas[] = [];
  try {
    const { data } = (await db
      .from("canvases")
      .select("id, scope, scope_ref_id, title, description, snapshot, archived")
      .eq("owner_id", ownerId)
      .eq("archived", false)) as { data: Canvas[] | null };
    canvases = data ?? [];

    const inputs = canvases.map((c) =>
      buildCanvasInput(ownerId, {
        id: c.id,
        scope: c.scope,
        scope_ref_id: c.scope_ref_id,
        title: c.title,
        description: c.description,
      }),
    );
    report.canvases = await upsertMemoryItemsBatch(db, inputs);
  } catch (err) {
    console.warn("[backfill] canvases failed:", err);
  }

  // ── Notes (per canvas) ──
  // Runs in sequence — per-canvas prune query must settle before the next
  // one touches overlapping memory_items rows. Canvases are independent
  // via source_canvas_id so this could parallelize, but sequential keeps
  // error handling simple and the embedding API happy.
  for (const c of canvases) {
    if (!c.snapshot) continue;
    try {
      const res = await indexNotesForCanvas(
        db,
        c.id,
        ownerId,
        c.scope,
        c.scope_ref_id,
        c.snapshot,
      );
      report.notes = {
        upserted: report.notes.upserted + res.upserted,
        skipped_unchanged: report.notes.skipped_unchanged + res.skipped_unchanged,
        failed: report.notes.failed + res.failed,
        pruned: report.notes.pruned + res.pruned,
      };
    } catch (err) {
      console.warn(`[backfill] notes canvas ${c.id} failed:`, err);
      report.notes = {
        ...report.notes,
        failed: report.notes.failed + 1,
      };
    }
  }

  report.total_time_ms = Date.now() - start;
  // Suppress unused-import warning from addResults (kept for future use)
  void addResults;
  return report;
}
