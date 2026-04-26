// ── Snapshot capture + replay (R5 Phase A) ───────────────────────────
//
// Two narrow responsibilities:
//
//   1. `captureSnapshot(db, { spaceId, userId, reason })` — freeze
//      the current live KG + computed twin state into `twin_snapshots`.
//      Returns the new snapshot id. Idempotent on root_hash: if the
//      last snapshot for this space has the same hash, returns that
//      id instead of inserting a duplicate.
//
//   2. `applyScenarioActions(entities, edges, cycles, bridges, actions)`
//      — replay a scenario's action_list against a snapshot's frozen
//      subgraph. Returns the mutated arrays + the derived delta rows.
//      Pure function; no DB access. Used by the MC engine's snapshot
//      path and by the scenario-commit flow.
//
// What's NOT in this file: action PERSISTENCE (creating scenario_deltas
// rows from the returned deltas — that's the caller's job, done in a
// single insert). Also not: actual application of a scenario back to
// the live KG — that's `commitScenarioToLiveKG()` in a separate module
// we'll add when Phase B ships.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entity, Edge } from "@/types";
import type {
  SnapshotReason,
  SnapshotCycle,
  SnapshotBridge,
} from "@/types/snapshot";
import type {
  ScenarioAction,
  ScenarioDelta,
  ScenarioReplayResult,
} from "@/types/scenario";
import { computeTwinState } from "./compute-twin-state";
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any> | any;

// ── 1. Snapshot capture ─────────────────────────────────────────────

export interface CaptureSnapshotOpts {
  spaceId: string;
  userId: string;
  reason: SnapshotReason;
  /** Optional — when set, links the snapshot to the pipeline run that
   *  triggered it (captures happen during strategy-refresh, etc.). */
  pipelineRunId?: string | null;
  strategyBaselineId?: string | null;
  /**
   * If true and the latest snapshot for this space has the same
   * root_hash, return its id instead of creating a duplicate.
   * Default true — "capture" is usually idempotent.
   */
  dedupeOnHash?: boolean;
}

export interface CaptureSnapshotResult {
  snapshotId: string;
  created: boolean; // false = returned an existing row with matching hash
  rootHash: string;
  entityCount: number;
  edgeCount: number;
  cycleCount: number;
}

/**
 * Freeze the current live KG of a space into a `twin_snapshots` row.
 * Idempotent on root_hash when `dedupeOnHash` is true (default).
 *
 * Returns `{ created: false }` when the latest snapshot already
 * carries the same hash — caller can use this to avoid re-diagnosing
 * an identical state.
 */
export async function captureSnapshot(
  db: AnyDb,
  opts: CaptureSnapshotOpts,
): Promise<CaptureSnapshotResult> {
  const { spaceId, userId, reason } = opts;
  const dedupe = opts.dedupeOnHash ?? true;

  // Load live subgraph. Keep the selected columns minimal — the JSONB
  // store doesn't need editor-specific noise (position, ui_state).
  const [entitiesRes, edgesRes, cyclesRes, bridgesRes, spaceRes] =
    await Promise.all([
      db
        .from("entities")
        .select(
          "id, space_id, name, description, confidence, entity_type, entity_category, importance, provenance, source_tag, parameters, created_at, causal_depth, converges_chains",
        )
        .eq("space_id", spaceId),
      db
        .from("edges")
        .select(
          "id, source_entity_id, target_entity_id, relationship_type, dimension, polarity, strength, confidence, conditions, dynamics, dynamics_properties",
        )
        .eq("space_id", spaceId),
      db
        .from("cycles")
        .select("id, classification, entity_ids, estimated_multiplier")
        .eq("space_id", spaceId),
      db
        .from("bridges")
        .select(
          "id, source_entity_id, target_entity_id, bridge_type, confidence",
        )
        .eq("space_id", spaceId),
      db.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
    ]);

  const entities: Entity[] = (entitiesRes.data ?? []) as Entity[];
  const edges: Edge[] = (edgesRes.data ?? []) as Edge[];
  const cycles: SnapshotCycle[] = ((cyclesRes.data ?? []) as Array<{
    id: string;
    classification: string | null;
    entity_ids: string[];
    estimated_multiplier: number | null;
  }>).map((r) => ({
    id: r.id,
    classification: r.classification ?? "unknown",
    entity_ids: Array.isArray(r.entity_ids) ? r.entity_ids : [],
    estimated_multiplier: r.estimated_multiplier,
  }));
  const bridges: SnapshotBridge[] = ((bridgesRes.data ?? []) as Array<
    SnapshotBridge
  >).map((r) => ({
    id: r.id,
    source_entity_id: r.source_entity_id,
    target_entity_id: r.target_entity_id,
    bridge_type: r.bridge_type,
    confidence: r.confidence,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spaceRow = spaceRes.data as any;

  // Hash the structural signal — entity/edge ids + key fields. We
  // DON'T hash free-text descriptions or timestamps because those can
  // drift without changing the structural state the twin computer
  // sees. Two snapshots with identical (id, confidence, polarity,
  // strength) tuples dedupe.
  const rootHash = computeRootHash(entities, edges, cycles, bridges);

  if (dedupe) {
    const { data: latest } = await db
      .from("twin_snapshots")
      .select("id, root_hash, entity_count, edge_count, cycle_count")
      .eq("space_id", spaceId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      latest &&
      (latest as { root_hash?: string }).root_hash === rootHash
    ) {
      const row = latest as {
        id: string;
        entity_count: number;
        edge_count: number;
        cycle_count: number;
      };
      return {
        snapshotId: row.id,
        created: false,
        rootHash,
        entityCount: row.entity_count,
        edgeCount: row.edge_count,
        cycleCount: row.cycle_count,
      };
    }
  }

  // Compute twin state from the frozen subgraph (not live — for
  // consistency with what downstream reads will see). computeTwinState
  // is positional: (space, entities, edges, cycles, synthesis, goal?,
  // recommendations?, recentPredictions?). We don't have active goal /
  // recommendations / recent predictions in the capture path — those
  // are optional, we pass undefined and let the computer degrade to
  // its dashboard-like shape.
  let twinState: unknown = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const space: any = spaceRow ?? { id: spaceId, name: "(unknown)" };
    const synthesisRaw =
      (spaceRow as { synthesis_data?: unknown } | null)?.synthesis_data ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let synthesis: any = null;
    if (synthesisRaw && typeof synthesisRaw === "object") synthesis = synthesisRaw;
    else if (typeof synthesisRaw === "string") {
      try {
        synthesis = JSON.parse(synthesisRaw);
      } catch {
        synthesis = null;
      }
    }
    twinState = computeTwinState(
      space,
      entities,
      edges,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cyclesRes.data ?? []) as any,
      synthesis,
      null,
    );
  } catch (err) {
    console.warn(
      "[snapshot-capture] computeTwinState failed; inserting snapshot without twin_state:",
      err,
    );
  }

  const { data: inserted, error } = await db
    .from("twin_snapshots")
    .insert({
      space_id: spaceId,
      user_id: userId,
      reason,
      root_hash: rootHash,
      entities,
      edges,
      cycles,
      bridges,
      twin_state: twinState,
      entity_count: entities.length,
      edge_count: edges.length,
      cycle_count: cycles.length,
      pipeline_run_id: opts.pipelineRunId ?? null,
      strategy_baseline_id: opts.strategyBaselineId ?? null,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    throw new Error(
      `[snapshot-capture] insert failed: ${error?.message ?? "no row returned"}`,
    );
  }

  const snapshotId = (inserted as { id: string }).id;

  // Auto-run twin quality diagnostics (cheap, deterministic — no LLM).
  // Persists a `twin_diagnostics` row so the UI can surface issue
  // counts + per-layer scores on the snapshot card in the drawer.
  // Soft-fails: a failed diagnose never breaks the snapshot capture.
  // Calibration is NOT auto-run (LLM cost); users trigger it
  // explicitly from the diagnostics endpoint with includeCalibration.
  try {
    const { runTwinDiagnostics } = await import("./run-twin-diagnostics");
    const diag = await runTwinDiagnostics(db, { snapshotId });
    if ("error" in diag) {
      console.warn(
        "[snapshot-capture] auto-diagnostics failed (non-fatal):",
        diag.error,
      );
    } else if (diag.warning) {
      console.warn(
        "[snapshot-capture] auto-diagnostics warning (non-fatal):",
        diag.warning,
      );
    }
  } catch (err) {
    console.warn(
      "[snapshot-capture] auto-diagnostics threw (non-fatal):",
      err,
    );
  }

  return {
    snapshotId,
    created: true,
    rootHash,
    entityCount: entities.length,
    edgeCount: edges.length,
    cycleCount: cycles.length,
  };
}

// ── 2. Scenario replay ──────────────────────────────────────────────

/**
 * Pure function. Applies a scenario's action_list to a snapshot's
 * frozen entities/edges/cycles/bridges. Returns the mutated arrays +
 * the derived delta rows for persistence.
 *
 * Does NOT mutate the inputs. Operates on defensive copies so the
 * caller's snapshot object stays intact across calls.
 *
 * Actions that can't apply (entity not found, double-delete, etc.)
 * are appended to `skipped` with a reason. The caller decides whether
 * a non-empty skipped list is a hard error or a warning.
 */
export function applyScenarioActions(
  baseEntities: Entity[],
  baseEdges: Edge[],
  baseCycles: SnapshotCycle[],
  baseBridges: SnapshotBridge[],
  actions: ScenarioAction[],
): ScenarioReplayResult {
  // Defensive copies — never mutate caller's snapshot.
  const entities: Entity[] = baseEntities.map((e) => ({ ...e }));
  const edges: Edge[] = baseEdges.map((e) => ({ ...e }));
  const cycles: SnapshotCycle[] = baseCycles.map((c) => ({ ...c }));
  const bridges: SnapshotBridge[] = baseBridges.map((b) => ({ ...b }));

  const entityById = new Map<string, Entity>(
    entities.map((e) => [e.id, e]),
  );
  const edgeById = new Map<string, Edge>(edges.map((e) => [e.id, e]));

  const deltas: ScenarioReplayResult["deltas"] = [];
  const skipped: ScenarioReplayResult["skipped"] = [];

  actions.forEach((action, idx) => {
    switch (action.kind) {
      case "update_entity_confidence": {
        const e = entityById.get(action.entityId);
        if (!e) {
          skipped.push({
            action_index: idx,
            reason: `entity ${action.entityId} not in snapshot`,
          });
          return;
        }
        const old = e.confidence;
        e.confidence = action.confidence;
        deltas.push({
          target_kind: "entity",
          target_id: action.entityId,
          op: "update",
          field: "confidence",
          old_value: old,
          new_value: action.confidence,
          action_index: idx,
        });
        return;
      }
      case "update_edge_strength": {
        const edge = edgeById.get(action.edgeId);
        if (!edge) {
          skipped.push({
            action_index: idx,
            reason: `edge ${action.edgeId} not in snapshot`,
          });
          return;
        }
        const old = edge.strength;
        edge.strength = action.strength;
        deltas.push({
          target_kind: "edge",
          target_id: action.edgeId,
          op: "update",
          field: "strength",
          old_value: old,
          new_value: action.strength,
          action_index: idx,
        });
        return;
      }
      case "flip_edge_polarity": {
        const edge = edgeById.get(action.edgeId);
        if (!edge) {
          skipped.push({
            action_index: idx,
            reason: `edge ${action.edgeId} not in snapshot`,
          });
          return;
        }
        const old = edge.polarity;
        edge.polarity = action.to;
        deltas.push({
          target_kind: "edge",
          target_id: action.edgeId,
          op: "update",
          field: "polarity",
          old_value: old,
          new_value: action.to,
          action_index: idx,
        });
        return;
      }
      case "add_entity": {
        if (entityById.has(action.entityId)) {
          skipped.push({
            action_index: idx,
            reason: `entity ${action.entityId} already exists`,
          });
          return;
        }
        const newEntity = {
          id: action.entityId,
          space_id: "", // scenario-scoped; not persisted to live entities until commit
          name: action.name,
          description: action.description ?? null,
          confidence:
            typeof action.confidence === "number" ? action.confidence : 0.5,
          entity_category: action.entity_category ?? null,
        } as unknown as Entity;
        entities.push(newEntity);
        entityById.set(action.entityId, newEntity);
        deltas.push({
          target_kind: "entity",
          target_id: action.entityId,
          op: "create",
          field: null,
          old_value: null,
          new_value: newEntity,
          action_index: idx,
        });
        return;
      }
      case "add_edge": {
        if (edgeById.has(action.edgeId)) {
          skipped.push({
            action_index: idx,
            reason: `edge ${action.edgeId} already exists`,
          });
          return;
        }
        if (!entityById.has(action.source_entity_id)) {
          skipped.push({
            action_index: idx,
            reason: `source entity ${action.source_entity_id} missing`,
          });
          return;
        }
        if (!entityById.has(action.target_entity_id)) {
          skipped.push({
            action_index: idx,
            reason: `target entity ${action.target_entity_id} missing`,
          });
          return;
        }
        const newEdge = {
          id: action.edgeId,
          source_entity_id: action.source_entity_id,
          target_entity_id: action.target_entity_id,
          relationship_type: action.relationship_type,
          polarity: action.polarity,
          strength:
            typeof action.strength === "number" ? action.strength : 0.5,
          confidence:
            typeof action.confidence === "number" ? action.confidence : 0.5,
          dynamics: action.dynamics ?? "linear",
        } as unknown as Edge;
        edges.push(newEdge);
        edgeById.set(action.edgeId, newEdge);
        deltas.push({
          target_kind: "edge",
          target_id: action.edgeId,
          op: "create",
          field: null,
          old_value: null,
          new_value: newEdge,
          action_index: idx,
        });
        return;
      }
      case "remove_entity": {
        const idx2 = entities.findIndex((e) => e.id === action.entityId);
        if (idx2 < 0) {
          skipped.push({
            action_index: idx,
            reason: `entity ${action.entityId} not in snapshot`,
          });
          return;
        }
        const removed = entities[idx2];
        entities.splice(idx2, 1);
        entityById.delete(action.entityId);
        deltas.push({
          target_kind: "entity",
          target_id: action.entityId,
          op: "delete",
          field: null,
          old_value: removed,
          new_value: null,
          action_index: idx,
        });
        // Cascade: remove any edges touching the removed entity.
        for (let i = edges.length - 1; i >= 0; i--) {
          const edge = edges[i];
          if (
            edge.source_entity_id === action.entityId ||
            edge.target_entity_id === action.entityId
          ) {
            deltas.push({
              target_kind: "edge",
              target_id: edge.id,
              op: "delete",
              field: null,
              old_value: edge,
              new_value: null,
              action_index: idx,
            });
            edges.splice(i, 1);
            edgeById.delete(edge.id);
          }
        }
        return;
      }
      case "remove_edge": {
        const idx2 = edges.findIndex((e) => e.id === action.edgeId);
        if (idx2 < 0) {
          skipped.push({
            action_index: idx,
            reason: `edge ${action.edgeId} not in snapshot`,
          });
          return;
        }
        const removed = edges[idx2];
        edges.splice(idx2, 1);
        edgeById.delete(action.edgeId);
        deltas.push({
          target_kind: "edge",
          target_id: action.edgeId,
          op: "delete",
          field: null,
          old_value: removed,
          new_value: null,
          action_index: idx,
        });
        return;
      }
      default: {
        // Exhaustiveness check — TypeScript will flag if a new kind is
        // added to the union without a case here.
        const _exhaustive: never = action;
        skipped.push({
          action_index: idx,
          reason: `unknown action kind: ${(_exhaustive as ScenarioAction).kind}`,
        });
      }
    }
  });

  return { entities, edges, cycles, bridges, deltas, skipped };
}

// ── Hash helper ─────────────────────────────────────────────────────

function computeRootHash(
  entities: Entity[],
  edges: Edge[],
  cycles: SnapshotCycle[],
  bridges: SnapshotBridge[],
): string {
  // Structural hash — (id, key_scalar_fields). Order-invariant via
  // sort. Free-text fields excluded so two snapshots with identical
  // (id, confidence, polarity, strength) tuples dedupe even if
  // descriptions were edited.
  const ePart = entities
    .map((e) => `${e.id}|${e.confidence ?? ""}|${e.entity_category ?? ""}`)
    .sort()
    .join(";");
  const edPart = edges
    .map(
      (e) =>
        `${e.id}|${e.source_entity_id}|${e.target_entity_id}|${e.polarity ?? ""}|${e.strength ?? ""}|${e.dynamics ?? ""}`,
    )
    .sort()
    .join(";");
  const cPart = cycles
    .map((c) => `${c.id}|${c.classification}|${c.entity_ids.slice().sort().join(",")}`)
    .sort()
    .join(";");
  const bPart = bridges
    .map(
      (b) =>
        `${b.id}|${b.source_entity_id}|${b.target_entity_id}|${b.bridge_type}`,
    )
    .sort()
    .join(";");

  return createHash("sha256")
    .update([ePart, edPart, cPart, bPart].join("||"))
    .digest("hex");
}

// Convenience type re-exports so callers can import both from one file.
export type { ScenarioDelta, ScenarioReplayResult };
