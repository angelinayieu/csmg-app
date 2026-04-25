// ── Snapshot types (R5 Phase A) ──────────────────────────────────────
//
// A snapshot is a frozen view of a space's KG + computed twin state at
// a single point in time. Snapshots are the substrate that makes
// before/after testing possible: `simulateEntityChain` and
// `computeTwinState` can read from a snapshot's JSONB subgraph instead
// of the live entities/edges tables, so a scenario tested today gives
// reproducible results even if the live graph drifts tomorrow.
//
// Snapshots are IMMUTABLE once written. A "re-diagnosis" that updates
// the `twin_state` field writes through a dedicated path that logs the
// mutation — `entities`/`edges`/`cycles` never change after capture.
//
// See:
//   - supabase/migrations/20260602_snapshots_scenarios.sql (schema)
//   - src/lib/twin/snapshot-capture.ts (capture + diff helpers)
//   - docs/R5_STRATEGIC_BRIEF.md §4 (architecture)

import type { Entity, Edge } from "@/types";
import type { TwinState } from "@/types/twin";

/**
 * Why a snapshot was captured. Drives downstream behavior:
 *   - `pre_strategy` — taken right before strategy-refresh; baseline
 *     capture links to this.
 *   - `user_request` — explicit "snapshot my current state" click.
 *     Does NOT imply anything about strategy generation.
 *   - `post_intervention` — captured after a scenario was applied.
 *     The "after" half of a before/after delta.
 *   - `scheduled` — sweep cron (daily, weekly). Used for long-running
 *     drift detection.
 *   - `pipeline_checkpoint` — automated capture at a specific pipeline
 *     stage boundary. The painter may emit a
 *     `twin_snapshot_captured` event tagged with this reason.
 */
export type SnapshotReason =
  | "user_request"
  | "pre_strategy"
  | "post_intervention"
  | "scheduled"
  | "pipeline_checkpoint";

/** Minimal cycle shape the snapshot freezes. Mirrors schema.cycles
 *  without editor-specific fields (positions, meta) — just what the
 *  MC engine and twin computer need. */
export interface SnapshotCycle {
  id: string;
  classification: string;
  entity_ids: string[];
  estimated_multiplier: number | null;
}

/** Minimal bridge shape — cross-space structural link. */
export interface SnapshotBridge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  bridge_type: string;
  confidence: number;
}

/**
 * Top-level snapshot record. Mirrors `twin_snapshots` row + parsed
 * JSONB payloads. Callers that just need the scalar fields can use
 * `TwinSnapshotMeta` (below) to avoid hydrating the large subgraph.
 */
export interface TwinSnapshot {
  id: string;
  space_id: string;
  user_id: string;
  reason: SnapshotReason;
  root_hash: string;

  entities: Entity[];
  edges: Edge[];
  cycles: SnapshotCycle[];
  bridges: SnapshotBridge[];

  /** Present when captureTwinState ran at capture time — usually yes.
   *  Null only on emergency manual inserts. */
  twin_state: TwinState | null;

  entity_count: number;
  edge_count: number;
  cycle_count: number;

  pipeline_run_id: string | null;
  strategy_baseline_id: string | null;

  captured_at: string;
  created_at: string;
}

/**
 * Scalar-only view of a snapshot row — cheap to list hundreds of
 * these without hydrating the subgraph JSONB.
 */
export interface TwinSnapshotMeta {
  id: string;
  space_id: string;
  reason: SnapshotReason;
  root_hash: string;
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  pipeline_run_id: string | null;
  strategy_baseline_id: string | null;
  captured_at: string;
}
