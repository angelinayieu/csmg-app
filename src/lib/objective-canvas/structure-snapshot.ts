// ── structure-snapshot ────────────────────────────────────────────────
//
// Pure serializer + respawn planner for the `structure_snapshots` table
// (migration 20260912) and the durable Library-save bridge into
// `library_objects` (object_type = "structure").
//
// Deliberately dependency-light: NO React, NO Supabase client, NO imports of
// shared Entity/Edge view types. Routes fetch the rows; this module SHAPES
// them into the denormalized, FK-free payload that survives source deletion,
// and PLANS an idempotent respawn. That keeps it unit-testable, usable on
// both server and client, and collision-safe against the parallel
// objective-canvas session (it owns no symbol here).
//
// The structural model it captures (confirmed against live schema 2026-05-30):
//   spaces → improvement_goals (objectives AND rooms, via parent_goal_id)
//          → entities (parent_sub_objective_id → improvement_goals.id)
//          → edges (source/target_entity_id → entities.id)
//   + layer_ontology (space-level altitude bands)
//   + whiteboard_positions (space_id, entity_id, x, y)
// There is no separate `sub_objectives` table — a "room" is an
// improvement_goals row.

export const STRUCTURE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/**
 * Library-save bridge. A whole structure saved into `library_objects` uses
 * this free-text object_type (no CHECK constraint — verified 2026-05-30) with
 * `source_entity_id = NULL`, so it is NOT cascade-killed when a source entity
 * is deleted (source_entity_id → entities ON DELETE CASCADE). The full capture
 * rides in `content_snapshot`. This is what makes a Library save *durable*.
 */
export const STRUCTURE_LIBRARY_OBJECT_TYPE = "structure" as const;

export type StructureScope = "space" | "room" | "subgraph";

export type SnapshotReason =
  | "manual"
  | "pre_delete"
  | "pre_respawn"
  | "auto"
  | "library_save"
  // A "Deepen → v2" iteration capture — the situation-model timeline reads
  // these to show how the structure grew per deepen pass. The DB `reason`
  // column is free text, so this is purely a type-level addition.
  | "deepen";

/**
 * A DB row, kept structurally loose on purpose so this module never couples to
 * a shared Entity/Edge type the parallel session may be editing. We only read
 * `id` and a handful of well-known foreign-key columns for filtering.
 */
export type Row = Record<string, unknown> & { id?: string };

export interface StructureSnapshotPayload {
  schemaVersion: number;
  scope: StructureScope;
  scopeRef: string | null;
  scopeLabel: string | null;
  capturedAt: string; // ISO
  space: Row | null;
  improvementGoals: Row[];
  entities: Row[];
  edges: Row[];
  layerOntology: Row[];
  whiteboardPositions: Row[];
  counts: { entities: number; edges: number; rooms: number };
}

export interface RawStructure {
  space?: Row | null;
  improvementGoals?: Row[];
  entities?: Row[];
  edges?: Row[];
  layerOntology?: Row[];
  whiteboardPositions?: Row[];
}

export interface SerializeInput extends RawStructure {
  scope: StructureScope;
  /** room → improvement_goals.id; subgraph → anchor entities.id; space → null. */
  scopeRef?: string | null;
  scopeLabel?: string | null;
}

// ── small helpers ─────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** 64-bit FNV-1a as 16-hex chars (two 32-bit lanes). Dependency-free; ample
 *  for dedupe where the unique index also keys on (space, scope, scope_ref). */
function fnv1a64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x85ebca77);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1) + hex(h2);
}

// ── serialize ─────────────────────────────────────────────────────────

/**
 * Shape already-fetched rows into a denormalized snapshot payload, narrowed to
 * the requested scope. Pure except for `capturedAt` (wall clock) — that field
 * is intentionally EXCLUDED from {@link hashStructureContent} so re-capturing
 * identical structure dedupes.
 *
 * Scope semantics:
 *  - "space":    keep everything as passed (whole objective structure).
 *  - "room":     scopeRef = improvement_goals.id; keep that room (+ any child
 *                goals), its entities (parent_sub_objective_id === roomId), the
 *                edges among them, all bands, and positions for those entities.
 *  - "subgraph": caller pre-narrowed `entities` (e.g. via scopeRoomToMechanism);
 *                trust them, keep only edges whose BOTH endpoints are in the set.
 */
export function serializeStructureSnapshot(
  input: SerializeInput,
): StructureSnapshotPayload {
  const scope = input.scope;
  const allGoals = input.improvementGoals ?? [];
  const allEntities = input.entities ?? [];
  const allEdges = input.edges ?? [];
  const allBands = input.layerOntology ?? [];
  const allPos = input.whiteboardPositions ?? [];

  let goals = allGoals;
  let entities = allEntities;
  let edges = allEdges;

  if (scope === "room" && input.scopeRef) {
    const roomId = input.scopeRef;
    goals = allGoals.filter(
      (g) => g.id === roomId || str(g["parent_goal_id"]) === roomId,
    );
    entities = allEntities.filter(
      (e) => str(e["parent_sub_objective_id"]) === roomId,
    );
    const ids = new Set(entities.map((e) => e.id));
    edges = allEdges.filter(
      (e) =>
        str(e["parent_sub_objective_id"]) === roomId ||
        (ids.has(str(e["source_entity_id"])) &&
          ids.has(str(e["target_entity_id"]))),
    );
  } else if (scope === "subgraph") {
    entities = allEntities;
    const ids = new Set(entities.map((e) => e.id));
    edges = allEdges.filter(
      (e) =>
        ids.has(str(e["source_entity_id"])) &&
        ids.has(str(e["target_entity_id"])),
    );
    goals = input.scopeRef
      ? allGoals.filter(
          (g) =>
            g.id === input.scopeRef ||
            entities.some((e) => str(e["parent_sub_objective_id"]) === g.id),
        )
      : allGoals;
  }
  // "space" → keep everything as-is.

  const keptEntityIds = new Set(entities.map((e) => e.id));
  const positions = allPos.filter((p) =>
    keptEntityIds.has(str(p["entity_id"])),
  );

  return {
    schemaVersion: STRUCTURE_SNAPSHOT_SCHEMA_VERSION,
    scope,
    scopeRef: input.scopeRef ?? null,
    scopeLabel: input.scopeLabel ?? null,
    capturedAt: new Date().toISOString(),
    space: input.space ?? null,
    improvementGoals: goals,
    entities,
    edges,
    layerOntology: allBands,
    whiteboardPositions: positions,
    counts: {
      entities: entities.length,
      edges: edges.length,
      rooms: goals.length,
    },
  };
}

/**
 * Stable content hash over membership + modification times (NOT capturedAt).
 * Lets a re-capture of unchanged structure resolve to the same row via the
 * `structure_snapshots_dedupe` unique index. v1 is membership+mtime based:
 * adding/removing/renaming rows changes the hash; a pure no-op re-save does not.
 */
export function hashStructureContent(p: StructureSnapshotPayload): string {
  const sig = (rows: Row[]) =>
    rows
      .map(
        (r) =>
          `${str(r.id) ?? ""}:${
            str(r["updated_at"]) ?? str(r["moved_at"]) ?? str(r["name"]) ?? ""
          }`,
      )
      .sort()
      .join(",");
  const basis = [
    `s=${p.scope}`,
    `r=${p.scopeRef ?? ""}`,
    `g=${sig(p.improvementGoals)}`,
    `e=${sig(p.entities)}`,
    `d=${sig(p.edges)}`,
    `l=${sig(p.layerOntology)}`,
  ].join("|");
  return fnv1a64(basis);
}

// ── row builders (insert payloads — module stays DB-client-free) ──────

export interface StructureSnapshotRow {
  space_id: string;
  user_id: string;
  scope: StructureScope;
  scope_ref: string | null;
  scope_label: string | null;
  reason: SnapshotReason;
  payload: StructureSnapshotPayload;
  entity_count: number;
  edge_count: number;
  room_count: number;
  content_hash: string;
  schema_version: number;
}

/** Build the `structure_snapshots` insert row from a payload. */
export function toSnapshotRow(
  payload: StructureSnapshotPayload,
  opts: { spaceId: string; userId: string; reason?: SnapshotReason },
): StructureSnapshotRow {
  return {
    space_id: opts.spaceId,
    user_id: opts.userId,
    scope: payload.scope,
    scope_ref: payload.scopeRef,
    scope_label: payload.scopeLabel,
    reason: opts.reason ?? "manual",
    payload,
    entity_count: payload.counts.entities,
    edge_count: payload.counts.edges,
    room_count: payload.counts.rooms,
    content_hash: hashStructureContent(payload),
    schema_version: payload.schemaVersion,
  };
}

export interface LibraryStructureRow {
  space_id: string;
  user_id: string;
  object_type: typeof STRUCTURE_LIBRARY_OBJECT_TYPE;
  title: string;
  summary: string | null;
  /** NULL on purpose — decouples the save from any single entity's cascade. */
  source_entity_id: null;
  source_sub_objective_id: string | null;
  content_snapshot: StructureSnapshotPayload;
}

/**
 * Build the DURABLE `library_objects` insert row for a "Save structure to
 * Library" action. Reuses the existing table (no migration) and stores the
 * whole capture in `content_snapshot` with `source_entity_id = NULL` so it
 * outlives deletion of any source entity.
 */
export function toLibraryStructureRow(
  payload: StructureSnapshotPayload,
  opts: { spaceId: string; userId: string; title: string; summary?: string },
): LibraryStructureRow {
  return {
    space_id: opts.spaceId,
    user_id: opts.userId,
    object_type: STRUCTURE_LIBRARY_OBJECT_TYPE,
    title: opts.title,
    summary:
      opts.summary ??
      `${payload.counts.entities} nodes · ${payload.counts.edges} edges · ${payload.counts.rooms} rooms`,
    source_entity_id: null,
    source_sub_objective_id: payload.scope === "room" ? payload.scopeRef : null,
    content_snapshot: payload,
  };
}

// ── respawn planner ───────────────────────────────────────────────────

export interface RespawnPlan {
  /** Payload rows with no live row of the same id — re-create (with original
   *  id, preserving edge references). */
  entitiesToInsert: Row[];
  edgesToInsert: Row[];
  goalsToInsert: Row[];
  bandsToInsert: Row[];
  /** Payload rows whose id still exists live — restore in place (e.g. clear a
   *  `deleted_at` tombstone / re-apply captured fields). */
  entitiesToUpdate: Row[];
  goalsToUpdate: Row[];
  /** Positions are keyed by (space_id, entity_id) — always upsert. */
  positionsToUpsert: Row[];
  summary: {
    inserts: number;
    updates: number;
    scope: StructureScope;
    scopeRef: string | null;
  };
}

/**
 * Diff a snapshot payload against the live rows currently in the target space
 * and produce an idempotent insert/update PLAN. Pure — the caller executes it
 * inside a transaction. Handles both restore modes:
 *  - hard-deleted source (ids absent live)  → INSERT with original ids.
 *  - soft-deleted source (ids present live) → UPDATE (un-tombstone / restore).
 */
export function planRespawn(
  payload: StructureSnapshotPayload,
  live: RawStructure,
): RespawnPlan {
  const liveEntityIds = new Set((live.entities ?? []).map((e) => e.id));
  const liveGoalIds = new Set((live.improvementGoals ?? []).map((g) => g.id));
  const liveEdgeIds = new Set((live.edges ?? []).map((e) => e.id));
  const liveBandIds = new Set((live.layerOntology ?? []).map((b) => b.id));

  const entitiesToInsert = payload.entities.filter(
    (e) => !liveEntityIds.has(e.id),
  );
  const entitiesToUpdate = payload.entities.filter((e) =>
    liveEntityIds.has(e.id),
  );
  const goalsToInsert = payload.improvementGoals.filter(
    (g) => !liveGoalIds.has(g.id),
  );
  const goalsToUpdate = payload.improvementGoals.filter((g) =>
    liveGoalIds.has(g.id),
  );
  const edgesToInsert = payload.edges.filter((e) => !liveEdgeIds.has(e.id));
  const bandsToInsert = payload.layerOntology.filter(
    (b) => !liveBandIds.has(b.id),
  );

  const inserts =
    entitiesToInsert.length +
    edgesToInsert.length +
    goalsToInsert.length +
    bandsToInsert.length;
  const updates = entitiesToUpdate.length + goalsToUpdate.length;

  return {
    entitiesToInsert,
    edgesToInsert,
    goalsToInsert,
    bandsToInsert,
    entitiesToUpdate,
    goalsToUpdate,
    positionsToUpsert: payload.whiteboardPositions,
    summary: {
      inserts,
      updates,
      scope: payload.scope,
      scopeRef: payload.scopeRef,
    },
  };
}
