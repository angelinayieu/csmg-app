/**
 * Memory writer — upsert source rows into memory_items with fresh embeddings.
 *
 * Design:
 *   - One row per (kind, ref_id, embedding_version). Re-embedding replaces
 *     via upsert on the unique constraint in memory_items.
 *   - Text is the authoritative input to embedding; we skip re-embedding if
 *     the stored text for this ref_id is identical (cheap dedupe that pays
 *     for itself the first time a user saves a canvas without changes).
 *   - Batch embedding: up to 96 texts per OpenAI call (the API accepts
 *     2048 but 96 is a comfortable 10-100KB request budget).
 *   - Scope inheritance rules (see buildMemoryInput* helpers):
 *       entity     → scope='project', scope_ref_id=entity.space_id
 *       note       → scope=<canvas scope>, scope_ref_id=<canvas scope_ref_id>
 *       bridge     → scope='universal' (cross-scope by construction)
 *       objective  → scope='objective', scope_ref_id=objective.id
 *       app        → scope='app', scope_ref_id=app.id
 *       canvas     → scope=<canvas.scope>, scope_ref_id=<canvas.scope_ref_id>
 *   - Salience: flat 0.5 default. Sprint 5's integrity job can rewrite
 *     salience based on usage signals (pinned, hot, recently accepted).
 *
 * What this module does NOT do:
 *   - Hook into every write path. Sprint 2 wires canvas-PATCH + canvas-POST
 *     only. Other write paths (decompose, weave, strategy) are served by
 *     the backfill endpoint for now; Sprint 5 will add cron/triggers.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  embedTexts,
  DEFAULT_EMBEDDING_MODEL,
} from "@/lib/embeddings";
import { extractNotesFromSnapshot } from "./extract-notes";
import type { MemoryKind } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const BATCH_SIZE = 96;
const EMBEDDING_VERSION = 1;

export interface MemoryUpsertInput {
  owner_id: string;
  kind: MemoryKind;
  ref_id: string;
  scope: "universal" | "project" | "objective" | "app" | null;
  scope_ref_id: string | null;
  /** For kind='note' or kind='canvas' — the canvas this row originated
   *  from. Enables per-canvas prune on reindex (see indexNotesForCanvas).
   *  Null for entity/bridge/objective/app. */
  source_canvas_id?: string | null;
  text: string;
  salience?: number;
}

export interface MemoryUpsertResult {
  upserted: number;
  skipped_unchanged: number;
  failed: number;
}

/**
 * Truncate input text to the embedding model's token budget. We don't
 * tokenize here (openai tokenizer is heavy); instead we cap on character
 * length — text-embedding-3-small tolerates ~8K tokens ≈ ~32K chars.
 * 16K is a safe upper bound that preserves long notes while never hitting
 * the API's token limit.
 */
function clampText(text: string): string {
  const t = text.trim();
  if (t.length <= 16_000) return t;
  return t.slice(0, 16_000);
}

/**
 * Upsert a batch of memory items with embeddings. Skips rows whose text
 * is identical to the currently-stored version (no-op dedupe).
 */
export async function upsertMemoryItemsBatch(
  db: AnyDb,
  items: MemoryUpsertInput[],
): Promise<MemoryUpsertResult> {
  if (items.length === 0) {
    return { upserted: 0, skipped_unchanged: 0, failed: 0 };
  }

  // 1. Dedupe by (kind, ref_id) — later entries win.
  const byKey = new Map<string, MemoryUpsertInput>();
  for (const item of items) {
    byKey.set(`${item.kind}:${item.ref_id}`, item);
  }
  const deduped = Array.from(byKey.values());

  // 2. Load current rows so we can skip unchanged text.
  const refIdsByKind: Record<string, string[]> = {};
  for (const item of deduped) {
    (refIdsByKind[item.kind] ??= []).push(item.ref_id);
  }

  const existingByKey = new Map<string, { text: string | null }>();
  await Promise.all(
    Object.entries(refIdsByKind).map(async ([kind, refIds]) => {
      const { data } = await db
        .from("memory_items")
        .select("kind, ref_id, text")
        .eq("owner_id", deduped[0].owner_id)
        .eq("kind", kind)
        .eq("embedding_version", EMBEDDING_VERSION)
        .in("ref_id", refIds);
      for (const row of (data ?? []) as Array<{
        kind: string;
        ref_id: string;
        text: string | null;
      }>) {
        existingByKey.set(`${row.kind}:${row.ref_id}`, { text: row.text });
      }
    }),
  );

  // 3. Split into "needs embedding" vs "already up to date"
  const toEmbed: MemoryUpsertInput[] = [];
  let skipped = 0;
  for (const item of deduped) {
    const key = `${item.kind}:${item.ref_id}`;
    const existing = existingByKey.get(key);
    const clamped = clampText(item.text);
    if (clamped.length === 0) {
      // Empty text — delete any existing row and count as skipped.
      if (existing) {
        await db
          .from("memory_items")
          .delete()
          .eq("owner_id", item.owner_id)
          .eq("kind", item.kind)
          .eq("ref_id", item.ref_id)
          .eq("embedding_version", EMBEDDING_VERSION);
      }
      skipped++;
      continue;
    }
    if (existing && existing.text === clamped) {
      // Bump last_seen_at even when text is unchanged so recency decay reflects active usage.
      await db
        .from("memory_items")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("owner_id", item.owner_id)
        .eq("kind", item.kind)
        .eq("ref_id", item.ref_id)
        .eq("embedding_version", EMBEDDING_VERSION);
      skipped++;
      continue;
    }
    toEmbed.push({ ...item, text: clamped });
  }

  if (toEmbed.length === 0) {
    return { upserted: 0, skipped_unchanged: skipped, failed: 0 };
  }

  // 4. Embed in batches of BATCH_SIZE
  let upserted = 0;
  let failed = 0;

  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const slice = toEmbed.slice(i, i + BATCH_SIZE);
    const texts = slice.map((s) => s.text);

    let embeddings: number[][];
    try {
      embeddings = await embedTexts(texts);
    } catch (err) {
      console.warn(
        `[memory/writer] embed batch failed (slice ${i}-${i + slice.length}):`,
        err,
      );
      failed += slice.length;
      continue;
    }

    const rows = slice.map((item, idx) => ({
      owner_id: item.owner_id,
      kind: item.kind,
      ref_id: item.ref_id,
      scope: item.scope,
      scope_ref_id: item.scope_ref_id,
      source_canvas_id: item.source_canvas_id ?? null,
      text: item.text,
      embedding: embeddings[idx],
      salience: item.salience ?? 0.5,
      last_seen_at: new Date().toISOString(),
      embedding_model: DEFAULT_EMBEDDING_MODEL,
      embedding_version: EMBEDDING_VERSION,
    }));

    // onConflict on the unique (kind, ref_id, embedding_version) index
    const { error } = await db
      .from("memory_items")
      .upsert(rows, { onConflict: "kind,ref_id,embedding_version" });

    if (error) {
      console.warn("[memory/writer] upsert failed:", error);
      failed += rows.length;
    } else {
      upserted += rows.length;
    }
  }

  return { upserted, skipped_unchanged: skipped, failed };
}

/** Delete memory_items for a given (kind, ref_id) — called when source rows are deleted. */
export async function deleteMemoryItem(
  db: AnyDb,
  kind: MemoryKind,
  refId: string,
): Promise<void> {
  await db
    .from("memory_items")
    .delete()
    .eq("kind", kind)
    .eq("ref_id", refId);
}

// ──────────────────────────────────────────────────────────────────────
// Per-kind builders: source row → MemoryUpsertInput
// ──────────────────────────────────────────────────────────────────────

/** Combine entity name + description into one embed-friendly string. */
function entityText(name: string, description: string | null): string {
  if (!description) return name;
  return `${name}. ${description}`;
}

export interface EntityLike {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  importance?: string | null;
}

export function buildEntityInput(
  ownerId: string,
  entity: EntityLike,
): MemoryUpsertInput {
  // Importance nudges salience so "fundamental" entities float up.
  const salience = (() => {
    switch (entity.importance) {
      case "fundamental":
        return 0.85;
      case "critical":
        return 0.75;
      case "important":
        return 0.6;
      default:
        return 0.5;
    }
  })();
  return {
    owner_id: ownerId,
    kind: "entity",
    ref_id: entity.id,
    scope: "project",
    scope_ref_id: entity.space_id,
    text: entityText(entity.name, entity.description),
    salience,
  };
}

export interface CanvasLike {
  id: string;
  scope: "universal" | "project" | "objective" | "app";
  scope_ref_id: string | null;
  title: string;
  description: string | null;
}

export function buildCanvasInput(
  ownerId: string,
  canvas: CanvasLike,
): MemoryUpsertInput {
  return {
    owner_id: ownerId,
    kind: "canvas",
    ref_id: canvas.id,
    scope: canvas.scope,
    scope_ref_id: canvas.scope_ref_id,
    source_canvas_id: canvas.id,
    text: canvas.description
      ? `${canvas.title}. ${canvas.description}`
      : canvas.title,
  };
}

export interface BridgeLike {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  shared_variable_name: string;
  description: string | null;
  bridge_type: string;
}

export function buildBridgeInput(
  ownerId: string,
  bridge: BridgeLike,
  sourceEntityName?: string,
  targetEntityName?: string,
): MemoryUpsertInput {
  const parts: string[] = [];
  if (sourceEntityName && targetEntityName) {
    parts.push(`${sourceEntityName} ${bridge.bridge_type} ${targetEntityName}`);
  } else {
    parts.push(`Bridge (${bridge.bridge_type}) on ${bridge.shared_variable_name}`);
  }
  if (bridge.description) parts.push(bridge.description);
  return {
    owner_id: ownerId,
    kind: "bridge",
    ref_id: bridge.id,
    // Bridges span two spaces by definition; indexed at universal scope so
    // ambient retrieval surfaces them regardless of which canvas the user
    // is typing in.
    scope: "universal",
    scope_ref_id: null,
    text: parts.join(". "),
  };
}

export interface ObjectiveLike {
  id: string;
  title: string;
  description?: string | null;
}

export function buildObjectiveInput(
  ownerId: string,
  obj: ObjectiveLike,
): MemoryUpsertInput {
  return {
    owner_id: ownerId,
    kind: "objective",
    ref_id: obj.id,
    scope: "objective",
    scope_ref_id: obj.id,
    text: obj.description ? `${obj.title}. ${obj.description}` : obj.title,
  };
}

export interface AppLike {
  id: string;
  name: string;
  description: string | null;
}

export function buildAppInput(
  ownerId: string,
  app: AppLike,
): MemoryUpsertInput {
  return {
    owner_id: ownerId,
    kind: "app",
    ref_id: app.id,
    scope: "app",
    scope_ref_id: app.id,
    text: app.description ? `${app.name}. ${app.description}` : app.name,
  };
}

// ──────────────────────────────────────────────────────────────────────
// High-level indexers — used by backfill + canvas hooks
// ──────────────────────────────────────────────────────────────────────

/**
 * Reindex all notes on a canvas from its tldraw snapshot. Called from
 * PATCH /api/canvases/[id] when the snapshot changes. Also prunes
 * orphan memory_items for notes that no longer exist on the canvas.
 *
 * Scoping: uses memory_items.source_canvas_id (added in 20260506) so
 * the prune query is a single `.eq("source_canvas_id", canvasId)` —
 * independent of scope, so universal canvases with scope_ref_id=null
 * prune cleanly.
 */
export async function indexNotesForCanvas(
  db: AnyDb,
  canvasId: string,
  ownerId: string,
  canvasScope: "universal" | "project" | "objective" | "app",
  canvasScopeRefId: string | null,
  snapshot: unknown,
): Promise<MemoryUpsertResult & { pruned: number }> {
  const notes = extractNotesFromSnapshot(snapshot);
  const liveRefIds = new Set(
    notes.map((n) => noteRefIdFor(canvasId, n.note_id)),
  );

  // 1. Prune notes that were on this canvas but have been deleted.
  const { data: existing } = (await db
    .from("memory_items")
    .select("id, ref_id")
    .eq("owner_id", ownerId)
    .eq("kind", "note")
    .eq("source_canvas_id", canvasId)) as {
    data: Array<{ id: string; ref_id: string }> | null;
  };

  const pruneIds = (existing ?? [])
    .filter((m) => !liveRefIds.has(m.ref_id))
    .map((m) => m.id);

  let pruned = 0;
  if (pruneIds.length > 0) {
    const { error } = await db
      .from("memory_items")
      .delete()
      .in("id", pruneIds);
    if (!error) pruned = pruneIds.length;
  }

  // 2. Upsert live notes
  const inputs: MemoryUpsertInput[] = notes.map((n) => ({
    owner_id: ownerId,
    kind: "note",
    ref_id: noteRefIdFor(canvasId, n.note_id),
    scope: canvasScope,
    scope_ref_id: canvasScopeRefId,
    source_canvas_id: canvasId,
    text: n.text,
  }));

  const res = await upsertMemoryItemsBatch(db, inputs);
  return { ...res, pruned };
}

/**
 * Deterministic uuid-v5-like mapping for (canvas_id, note_id) → uuid.
 * Why: memory_items.ref_id is uuid, but tldraw note ids are opaque
 * strings. We namespace notes under the canvas so the same note_id
 * across two canvases doesn't collide.
 *
 * Implementation: SHA-256 → take first 16 bytes → format as uuid v4-like.
 */
export function noteRefIdFor(canvasId: string, noteId: string): string {
  // Use a simple FNV-1a-like hash + canvas prefix to produce a stable uuid.
  // We intentionally do this on the server side consistently; any code that
  // wants to look up a note's memory row must go through this function.
  const input = `${canvasId}::${noteId}`;
  const hash = createHash("sha256").update(input).digest();
  const bytes = hash.subarray(0, 16);
  // Force uuid version 4 + variant bits so downstream uuid validators accept it.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}
