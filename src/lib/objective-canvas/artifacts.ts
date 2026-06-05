// ── Artifacts — the persistent "final products" layer ─────────────────
//
// Thin helpers over the `artifacts` + `artifact_versions` tables
// (ARTIFACTS_DOCK_PLAN.md §1 + 20260921_artifacts.sql). The single
// write/read path so every surface (the Artifact Dock, the Artifacts
// Library, each engine's refresh) shares one model.
//
// An artifact is a TERMINAL deliverable (prototype | notebook | document |
// image | social_post | custom) — persistent + continuously updated, unlike
// library_objects (curation handles) or ephemeral board cards.
//
// Every fn is SOFT-FAIL (try/catch → null/[]) so callers + imports are safe
// even before the migration is applied. Upsert is idempotent on the natural
// key (space_id, engine_key, board_shape_id) — re-running an engine into the
// same board card updates the same row.

import type { SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export type ArtifactType =
  | "prototype"
  | "notebook"
  | "document"
  | "image"
  | "social_post"
  | "custom";

export type ArtifactStatus = "generating" | "ready" | "error" | "archived";

export type ArtifactStaleReason =
  | "source_changed"
  | "user_edit"
  | "manual_refresh";

export interface ArtifactRow {
  id: string;
  space_id: string;
  user_id: string;
  artifact_type: string;
  engine_key: string;
  title: string;
  status: string;
  config: unknown;
  content: unknown;
  source_object_ids: string[] | null;
  source_shape_ids: string[] | null;
  board_shape_id: string | null;
  stale_reason: string | null;
  stale_since: string | null;
  last_refreshed_at: string | null;
  last_updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertArtifactInput {
  spaceId: string;
  userId: string;
  artifactType: ArtifactType;
  engineKey: string;
  title?: string;
  status?: ArtifactStatus;
  /** Standardized template/settings. Set only when provided (no clobber). */
  config?: unknown;
  /** The artifact body. Set only when provided (no clobber). */
  content?: unknown;
  sourceObjectIds?: string[] | null;
  sourceShapeIds?: string[] | null;
  /** Canvas card handle — the idempotency anchor for re-runs. */
  boardShapeId?: string | null;
  lastUpdatedBy?: string | null;
}

const SELECT_COLS =
  "id, space_id, user_id, artifact_type, engine_key, title, status, config, content, source_object_ids, source_shape_ids, board_shape_id, stale_reason, stale_since, last_refreshed_at, last_updated_by, created_at, updated_at";

/**
 * Lazy, idempotent upsert by the natural key (space_id, engine_key,
 * board_shape_id). Returns the artifact id, or null on soft-fail. Only sets
 * config/content/sources when explicitly provided so a status-only or
 * title-only update never clobbers an existing body.
 */
export async function upsertArtifact(
  db: AnyDb,
  input: UpsertArtifactInput,
): Promise<string | null> {
  try {
    let q = db
      .from("artifacts")
      .select("id")
      .eq("space_id", input.spaceId)
      .eq("engine_key", input.engineKey);
    q = input.boardShapeId
      ? q.eq("board_shape_id", input.boardShapeId)
      : q.is("board_shape_id", null);
    const { data: existing } = await q.maybeSingle();

    const patch: Record<string, unknown> = {
      artifact_type: input.artifactType,
      updated_at: new Date().toISOString(),
    };
    if (input.title !== undefined) patch.title = input.title;
    if (input.status !== undefined) patch.status = input.status;
    if (input.config !== undefined) patch.config = input.config;
    if (input.content !== undefined) patch.content = input.content;
    if (input.sourceObjectIds !== undefined)
      patch.source_object_ids = input.sourceObjectIds;
    if (input.sourceShapeIds !== undefined)
      patch.source_shape_ids = input.sourceShapeIds;
    if (input.lastUpdatedBy !== undefined)
      patch.last_updated_by = input.lastUpdatedBy;

    if (existing?.id) {
      await db.from("artifacts").update(patch).eq("id", existing.id);
      return existing.id as string;
    }

    const { data: inserted } = await db
      .from("artifacts")
      .insert({
        space_id: input.spaceId,
        user_id: input.userId,
        engine_key: input.engineKey,
        board_shape_id: input.boardShapeId ?? null,
        title: input.title ?? "Untitled",
        status: input.status ?? "generating",
        ...patch,
      })
      .select("id")
      .single();
    return (inserted as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn("[artifacts] upsert failed (soft):", err);
    return null;
  }
}

/** Set the canvas card handle for an artifact (post-create wiring). */
export async function setArtifactBoardShape(
  db: AnyDb,
  artifactId: string,
  boardShapeId: string | null,
): Promise<void> {
  try {
    await db
      .from("artifacts")
      .update({ board_shape_id: boardShapeId, updated_at: new Date().toISOString() })
      .eq("id", artifactId);
  } catch (err) {
    console.warn("[artifacts] setArtifactBoardShape failed (soft):", err);
  }
}

/** Append an immutable version snapshot (the audit/history trail). */
export async function appendArtifactVersion(
  db: AnyDb,
  artifactId: string,
  args: {
    content?: unknown;
    config?: unknown;
    changeType?: "generated" | "user_edit" | "agent_update" | "refresh";
    changeSummary?: string | null;
    changedBy?: string | null;
  } = {},
): Promise<void> {
  try {
    const { data: last } = await db
      .from("artifact_versions")
      .select("version")
      .eq("artifact_id", artifactId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((last as { version?: number } | null)?.version ?? 0) + 1;
    await db.from("artifact_versions").insert({
      artifact_id: artifactId,
      version: nextVersion,
      content_snapshot: args.content ?? null,
      config_snapshot: args.config ?? null,
      change_type: args.changeType ?? "generated",
      change_summary: args.changeSummary ?? null,
      changed_by: args.changedBy ?? null,
    });
  } catch (err) {
    console.warn("[artifacts] appendArtifactVersion failed (soft):", err);
  }
}

/** Mark an artifact stale (its sources moved on) — the continuous-update gate. */
export async function markArtifactStale(
  db: AnyDb,
  artifactId: string,
  reason: ArtifactStaleReason,
): Promise<void> {
  try {
    await db
      .from("artifacts")
      .update({
        stale_reason: reason,
        stale_since: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", artifactId);
  } catch (err) {
    console.warn("[artifacts] markArtifactStale failed (soft):", err);
  }
}

/** Clear staleness after a refresh. */
export async function clearArtifactStale(
  db: AnyDb,
  artifactId: string,
): Promise<void> {
  try {
    await db
      .from("artifacts")
      .update({
        stale_reason: null,
        stale_since: null,
        last_refreshed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", artifactId);
  } catch (err) {
    console.warn("[artifacts] clearArtifactStale failed (soft):", err);
  }
}

export interface ListArtifactsFilter {
  artifactType?: ArtifactType;
  status?: ArtifactStatus;
}

/** List a space's artifacts (the Artifacts Library read path). */
export async function listArtifacts(
  db: AnyDb,
  spaceId: string,
  filter: ListArtifactsFilter = {},
): Promise<ArtifactRow[]> {
  try {
    let q = db.from("artifacts").select(SELECT_COLS).eq("space_id", spaceId);
    if (filter.artifactType) q = q.eq("artifact_type", filter.artifactType);
    if (filter.status) q = q.eq("status", filter.status);
    const { data } = await q.order("updated_at", { ascending: false });
    return (data as ArtifactRow[] | null) ?? [];
  } catch (err) {
    console.warn("[artifacts] list failed (soft):", err);
    return [];
  }
}

/** Fetch a single artifact by id (the open/refine read path). */
export async function getArtifact(
  db: AnyDb,
  artifactId: string,
): Promise<ArtifactRow | null> {
  try {
    const { data } = await db
      .from("artifacts")
      .select(SELECT_COLS)
      .eq("id", artifactId)
      .maybeSingle();
    return (data as ArtifactRow | null) ?? null;
  } catch (err) {
    console.warn("[artifacts] getArtifact failed (soft):", err);
    return null;
  }
}
