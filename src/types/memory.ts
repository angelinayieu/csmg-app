/**
 * Memory store types — Sprint 0 substrate
 *
 * Unified vector memory across entities, notes, bridges, objectives, apps,
 * canvases. Writer + retriever land in Sprint 2 (lib/memory/*).
 *
 * Source of truth: supabase/migrations/20260503_memory_items.sql
 */

import type { CanvasScope } from "./canvas-library";

export type MemoryKind =
  | "entity"
  | "note"
  | "bridge"
  | "objective"
  | "app"
  | "canvas";

export interface MemoryItem {
  id: string;
  owner_id: string;

  kind: MemoryKind;
  ref_id: string;

  scope: CanvasScope | null;
  scope_ref_id: string | null;

  text: string;
  /** Stored server-side as vector(1536). Omitted from most client
   *  responses to save bandwidth — only the retriever handles the raw
   *  embedding. */
  embedding?: number[];

  salience: number;
  last_seen_at: string;

  embedding_model: string;
  embedding_version: number;

  created_at: string;
  updated_at: string;
}

/** Retrieval query — lib/memory/retrieve.ts (Sprint 2) */
export interface MemoryQuery {
  owner_id: string;
  query_text: string;
  /** Optional — restrict to these scopes (e.g. retrieval scoped to the
   *  current canvas's scope when typing in a project canvas, we may
   *  still want universal-scope items). */
  scopes?: CanvasScope[];
  /** Optional — restrict to a specific ref (e.g. only this project). */
  scope_ref_ids?: string[];
  kinds?: MemoryKind[];
  k?: number;
  min_salience?: number;
}

export interface MemoryHit {
  item: MemoryItem;
  /** Cosine similarity ∈ [−1, 1] (pgvector <=> returns distance, so
   *  the retriever converts: similarity = 1 − distance). */
  similarity: number;
}
