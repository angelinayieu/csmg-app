// ── simulate-entity-chain ──
//
// Convenience wrapper over the pure Monte Carlo engine that builds a
// SimulationSpec from live KG data. Caller hands us a space + a target
// entity, we fetch the N-hop upstream causal chain, map DB columns to
// engine specs, run the simulation, and return the target's
// distribution — ready to attach to a `proposal_ready` event or
// `prediction_ledger.predicted_distribution` field.
//
// Shape of the perturbation model:
//   - priorMean = 0 for every node. We simulate DEVIATIONS from
//     baseline, not absolute values — entities don't have canonical
//     baseline values in the schema, but "a small shock to upstream X
//     propagates to Y with what magnitude" is the useful signal for
//     strategy ranking + probability-ring rendering.
//   - priorStdDev = (1 - entity.confidence) for upstream perturbation
//     nodes. Low-confidence entities inject more noise; high-confidence
//     ones simulate as more stable.
//   - The target entity gets priorStdDev = 0 — it's a receiver, its
//     final distribution is entirely propagated effect.
//
// The cycle/DAG question: the current timestep propagation handles
// both. Cycles compound within the capped timestep budget (natural
// dynamics emerge). We don't detect/reject cycles — the Monte Carlo
// engine is shape-agnostic.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runMonteCarlo,
  type EdgeDynamics,
  type EdgeSpec,
  type EdgePolarity,
  type NodeSpec,
  type SimulationResult,
} from "./monte-carlo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const VALID_DYNAMICS: EdgeDynamics[] = [
  "linear",
  "threshold",
  "compounding",
  "decay",
  "exponential",
];

function normalizeDynamics(raw: string | null | undefined): EdgeDynamics {
  if (!raw) return "linear";
  const found = VALID_DYNAMICS.find((d) => d === raw);
  return found ?? "linear";
}

function normalizePolarity(
  raw: string | null | undefined,
): EdgePolarity | undefined {
  if (raw === "positive" || raw === "negative" || raw === "neutral" || raw === "conditional") {
    return raw;
  }
  return undefined;
}

export interface SimulateChainOpts {
  spaceId: string;
  /** Target entity UUID — we measure the deviation distribution on this node. */
  targetEntityId: string;
  /** How many edge-hops upstream to include. Default 3. Capped at 6. */
  depthHops?: number;
  /** Monte Carlo iteration count (passed through). Default 1000. */
  iterations?: number;
  /** Propagation timesteps per iteration (passed through). Default 10. */
  timesteps?: number;
  /** Deterministic seed (passed through). */
  seed?: number;
}

export interface SimulateChainResult {
  /** The simulation output. */
  simulation: SimulationResult;
  /** Distribution summary for the target specifically — convenient access. */
  targetDistribution: {
    p10: number;
    p50: number;
    p90: number;
    mean: number;
    stddev: number;
  } | null;
  /** Count of entities included in the subgraph. */
  nodeCount: number;
  /** Count of edges included. */
  edgeCount: number;
  /** Non-null when subgraph fetch failed or target wasn't found. */
  error: string | null;
}

const MAX_DEPTH = 6;
const DEFAULT_DEPTH = 3;

/**
 * Build + run a Monte Carlo simulation for one target entity's
 * upstream causal chain. Soft-fails: returns {error} rather than
 * throwing so callers can degrade gracefully when the subgraph is
 * missing or the space is empty.
 */
export async function simulateEntityChain(
  db: AnyDb,
  opts: SimulateChainOpts,
): Promise<SimulateChainResult> {
  const depth = Math.min(opts.depthHops ?? DEFAULT_DEPTH, MAX_DEPTH);

  // Verify target entity exists + belongs to the space.
  const { data: target, error: targetErr } = await db
    .from("entities")
    .select("id, space_id, name, confidence")
    .eq("id", opts.targetEntityId)
    .eq("space_id", opts.spaceId)
    .maybeSingle();

  if (targetErr || !target) {
    return empty(
      targetErr?.message ??
        `Target entity ${opts.targetEntityId} not found in space ${opts.spaceId}`,
    );
  }

  // Fetch all edges in the space + walk N hops upstream from the target.
  // For a typical space (≤500 entities, ≤2000 edges) this is cheap.
  // Larger spaces should slice per traversal level; defer to a future turn.
  const { data: allEdgesRaw, error: edgesErr } = await db
    .from("edges")
    .select("source_entity_id, target_entity_id, strength, polarity, confidence, dynamics, dynamics_properties");
  if (edgesErr) {
    return empty(`edges fetch: ${edgesErr.message}`);
  }
  type EdgeRow = {
    source_entity_id: string;
    target_entity_id: string;
    strength: number;
    polarity: string;
    confidence: number;
    dynamics: string | null;
    dynamics_properties: unknown;
  };
  const allEdges = (allEdgesRaw ?? []) as EdgeRow[];

  // BFS upstream: start from target, follow edges in reverse direction.
  const includedEntityIds = new Set<string>([opts.targetEntityId]);
  const includedEdges: EdgeRow[] = [];
  let frontier: Set<string> = new Set([opts.targetEntityId]);
  for (let hop = 0; hop < depth && frontier.size > 0; hop++) {
    const nextFrontier = new Set<string>();
    for (const edge of allEdges) {
      if (frontier.has(edge.target_entity_id) && !includedEntityIds.has(edge.source_entity_id)) {
        includedEntityIds.add(edge.source_entity_id);
        includedEdges.push(edge);
        nextFrontier.add(edge.source_entity_id);
      } else if (frontier.has(edge.target_entity_id)) {
        // Edge lands on an already-included node — still include the
        // edge so cycles propagate in the simulation.
        if (!includedEdges.includes(edge)) includedEdges.push(edge);
      }
    }
    frontier = nextFrontier;
  }

  // Fetch entity metadata for every included id (confidence used as
  // priorStdDev; name for optional output labeling).
  const includedIdsArr = Array.from(includedEntityIds);
  const { data: entitiesRaw, error: entErr } = await db
    .from("entities")
    .select("id, name, confidence")
    .in("id", includedIdsArr);
  if (entErr) {
    return empty(`entities fetch: ${entErr.message}`);
  }
  type EntityRow = { id: string; name: string; confidence: number | null };
  const entities = (entitiesRaw ?? []) as EntityRow[];
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Map to engine specs.
  const nodes: NodeSpec[] = includedIdsArr.map((id) => {
    const row = entityById.get(id);
    const confidence = row?.confidence ?? 0.5;
    if (id === opts.targetEntityId) {
      // Target is a receiver — no prior perturbation.
      return { id, priorMean: 0, priorStdDev: 0 };
    }
    // Upstream entities: small random perturbations scaled by
    // (1 - confidence). High-confidence entities → tight prior.
    return {
      id,
      priorMean: 0,
      priorStdDev: Math.max(0.02, 1 - confidence),
    };
  });

  const edges: EdgeSpec[] = includedEdges.map((e) => ({
    sourceId: e.source_entity_id,
    targetId: e.target_entity_id,
    strength: Number.isFinite(e.strength) ? e.strength : 0.5,
    polarity: normalizePolarity(e.polarity),
    dynamics: normalizeDynamics(e.dynamics),
    params:
      e.dynamics_properties && typeof e.dynamics_properties === "object"
        ? (e.dynamics_properties as Record<string, number>)
        : undefined,
  }));

  const simulation = runMonteCarlo({
    nodes,
    edges,
    iterations: opts.iterations,
    timesteps: opts.timesteps,
    seed: opts.seed,
  });

  const targetNodeDist = simulation.nodes.find(
    (n) => n.nodeId === opts.targetEntityId,
  );
  const targetDistribution = targetNodeDist
    ? {
        p10: targetNodeDist.p10,
        p50: targetNodeDist.p50,
        p90: targetNodeDist.p90,
        mean: targetNodeDist.mean,
        stddev: targetNodeDist.stddev,
      }
    : null;

  return {
    simulation,
    targetDistribution,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    error: null,
  };
}

function empty(error: string): SimulateChainResult {
  return {
    simulation: {
      iterations: 0,
      timesteps: 0,
      seed: 0,
      nodes: [],
      durationMs: 0,
    },
    targetDistribution: null,
    nodeCount: 0,
    edgeCount: 0,
    error,
  };
}
