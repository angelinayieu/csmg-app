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
import { resolveConditionGate, type ConditionGateResult } from "./condition-gate";

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
  /**
   * Optional per-entity priorMean overrides, keyed by entityId. Used by
   * `simulateVariantLift` to model "this variant's intervention is
   * applied to entity X with magnitude Δ" — the engine treats the node
   * as having a non-zero mean shock rather than the default 0.
   *
   * For the baseline run leave this empty. For the "variant applied"
   * run, pass `{ [leverEntityId]: 0.5 }` (or whatever magnitude). Reuse
   * the same seed across both calls so Gaussian draws cancel and the
   * p50 delta is pure signal from the perturbation, not sampling noise.
   *
   * Nodes not in the map keep the default priorMean (0). The target
   * entity's override is ignored — target is always a receiver.
   */
  perturbations?: Map<string, { priorMean?: number; priorStdDev?: number }>;
  /**
   * R5 Phase A — snapshot-input mode.
   *
   * When set, the engine reads entities + edges from the given
   * `twin_snapshots` row's JSONB payload instead of the live
   * `entities`/`edges` tables. Makes "test on a frozen baseline"
   * possible — the proposal card's MC distribution computed against
   * snapshot S stays reproducible even if the live KG drifts.
   *
   * When `scenarioId` is also set, the snapshot's entities/edges are
   * loaded FIRST, then the scenario's action_list is replayed on top
   * via `applyScenarioActions`. The resulting (snapshot + deltas)
   * subgraph is what the MC sees. This is the "test-after-intervention"
   * path: pick a snapshot, apply a scenario, run MC, compare to the
   * baseline MC on the same snapshot without the scenario.
   *
   * Mutually exclusive with live-KG reads — when either is set, the
   * space_id + target_entity_id live-table lookups are replaced with
   * snapshot-payload lookups.
   */
  snapshotId?: string;
  scenarioId?: string;
  /**
   * R3 composition — integrator selection forwarded to `runMonteCarlo`.
   * Default "discrete" matches pre-R3 behavior. Set "ode_rk4" to run
   * the continuous-time RK4 path inside each Monte Carlo iteration
   * (Tier 5 math — see monte-carlo.ts). Honored on BOTH the live-KG
   * path and the snapshot-mode path so a frozen baseline can be
   * integrated with the same tier as a live run.
   *
   * Callers that forward this downstream (e.g. `simulateVariantLift`
   * runs baseline + perturbed pairs) MUST pass the same integrator to
   * both legs so the p50 delta is apples-to-apples.
   */
  integrator?: "discrete" | "ode_rk4";
}

/**
 * Per-conditional-edge audit row. We expose this so callers (the
 * monte-carlo HTTP route, simulation widgets, the audit drawer) can
 * show "edge X→Y fires ~78% of iterations [usually]" instead of
 * burying the gate inside an opaque numeric simulation result.
 *
 * Without this, the conditional-gate resolver (Phase 4 §5.4) is
 * invisible — users see the numeric distribution but never find out
 * WHICH edges were treated as flaky and WHY.
 */
export interface GateDecision {
  sourceId: string;
  targetId: string;
  gate: number;
  source: ConditionGateResult["source"];
  certainty: number;
  /** The original prose condition the resolver parsed (truncated for
   *  payload hygiene). Useful in audit UIs so users can sanity-check
   *  the heuristic's verdict against the LLM's text. */
  conditionText: string | null;
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
  /** Per-conditional-edge gate decisions. Empty when the subgraph
   *  contained no conditional edges. Always present (never undefined)
   *  so callers don't have to null-check. */
  gateDecisions: GateDecision[];
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

  // R5 Phase A — snapshot-input mode short-circuits the live-KG reads.
  // When snapshotId is set, we load the subgraph from the snapshot's
  // JSONB payload (+ optional scenario deltas) and skip the
  // `entities`/`edges` table queries entirely.
  if (opts.snapshotId) {
    return simulateEntityChainFromSnapshot(db, opts);
  }

  type EdgeRow = {
    source_entity_id: string;
    target_entity_id: string;
    strength: number;
    polarity: string;
    confidence: number;
    dynamics: string | null;
    dynamics_properties: unknown;
    /** Phase 3 §4.2 — gating condition for conditional polarity edges.
     *  Translated to a numeric conditionGate when wired into the MC. */
    conditions: string | null;
  };

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
    .select("source_entity_id, target_entity_id, strength, polarity, confidence, dynamics, dynamics_properties, conditions");
  if (edgesErr) {
    return empty(`edges fetch: ${edgesErr.message}`);
  }
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
  // priorStdDev; name for optional output labeling; provenance used to
  // dampen/amplify perturbation by why-chain stop_reason — see below).
  const includedIdsArr = Array.from(includedEntityIds);
  const { data: entitiesRaw, error: entErr } = await db
    .from("entities")
    .select("id, name, confidence, entity_type, provenance")
    .in("id", includedIdsArr);
  if (entErr) {
    return empty(`entities fetch: ${entErr.message}`);
  }
  type EntityRow = {
    id: string;
    name: string;
    confidence: number | null;
    entity_type?: string | null;
    provenance?: Record<string, unknown> | null;
  };
  const entities = (entitiesRaw ?? []) as EntityRow[];
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Map to engine specs.
  const perturbations = opts.perturbations;
  const nodes: NodeSpec[] = includedIdsArr.map((id) => {
    const row = entityById.get(id);
    const confidence = row?.confidence ?? 0.5;
    if (id === opts.targetEntityId) {
      // Target is a receiver — no prior perturbation. Perturbations
      // passed for this id are intentionally ignored so callers can't
      // accidentally short-circuit the propagation chain by nudging the
      // target itself — then "lift" would just be noise.
      return { id, priorMean: 0, priorStdDev: 0 };
    }

    // Stop-reason-aware perturbation scaling.
    //
    // Without this, an `external` driver (e.g. market price, weather,
    // regulatory change — outside the user's locus of action) injects
    // noise with the same magnitude as a `user_controllable` driver.
    // That distorts the simulation: p10/p90 spreads reflect "what
    // happens if the market moves" alongside "what happens if you
    // change the lever," when the user's decision surface only
    // contains the latter.
    //
    //   external        → dampen to 0.35× — we want a tight prior
    //                     around its OBSERVED state; the user can't
    //                     intervene on it, so modeling what happens
    //                     when it wiggles isn't actionable.
    //   user_controllable → amplify to 1.20× — these are the levers;
    //                     widening their range makes p10/p90 surface
    //                     a realistic envelope of "what if you pulled
    //                     this differently?"
    //   other (continue/speculative, or non-driver) → 1.0× (unchanged)
    //
    // Only applied when the entity is actually a causal_driver with
    // why_chain provenance — we don't want to dampen every entity in
    // the graph, just the ones the deepener labeled.
    let leverMultiplier = 1;
    if (row?.entity_type === "causal_driver") {
      const prov = (row.provenance ?? {}) as Record<string, unknown>;
      if (prov.source === "why_chain") {
        if (prov.stop_reason === "external") leverMultiplier = 0.35;
        else if (prov.stop_reason === "user_controllable") leverMultiplier = 1.2;
      }
    }

    // Upstream entities: small random perturbations scaled by
    // (1 - confidence) × leverMultiplier. High-confidence entities →
    // tight prior; external drivers → tighter still; user-controllable
    // drivers → wider to expose intervention envelope.
    //
    // Perturbation override (variant lift, counterfactual queries, …):
    // if the caller passed an explicit {priorMean, priorStdDev} for
    // this node, use it. This is how simulateVariantLift asks "what
    // happens when I nudge entity X by +Δ" — the caller sets priorMean
    // to Δ on the lever node, leaves everything else default, and the
    // distribution on target reflects the downstream propagation.
    const override = perturbations?.get(id);
    const defaultStdDev = Math.max(0.02, (1 - confidence) * leverMultiplier);
    return {
      id,
      priorMean: override?.priorMean ?? 0,
      priorStdDev: override?.priorStdDev ?? defaultStdDev,
    };
  });

  // Resolve conditional-edge gates ONCE per edge so we can both feed
  // the engine AND surface a per-edge audit row to callers. Doing the
  // resolution inline inside .map() and again to build the audit list
  // would risk drift if the call args ever changed.
  const gateDecisions: GateDecision[] = [];
  const edges: EdgeSpec[] = includedEdges.map((e) => {
    const polarity = normalizePolarity(e.polarity);
    let conditionGate: number | undefined;
    // Phase 4 §5.4 — conditional gate via condition-text evaluator.
    //
    // For polarity="conditional" edges, parse the prose `conditions`
    // string with the heuristic resolver (lexical hedging adverbs:
    // always/usually/sometimes/rarely/only-if/never) and fall back to
    // edge confidence when no token hits. This replaces the Phase 3
    // placeholder that used confidence as the gate directly — confidence
    // measures "is the relationship real?" while the gate measures
    // "how often does it fire?" — orthogonal questions.
    //
    // Non-conditional polarities skip the gate (engine ignores
    // conditionGate when polarity ≠ conditional).
    if (polarity === "conditional") {
      const resolved = resolveConditionGate(
        e.conditions,
        Number.isFinite(e.confidence) ? e.confidence : null,
      );
      conditionGate = resolved.gate;
      // Truncate prose to keep network payloads + audit-drawer rendering
      // bounded — the LLM occasionally returns multi-sentence rationales
      // here. 200 chars is plenty for a sanity check; full text lives on
      // the edges row if a deep dive is needed.
      const text = (e.conditions ?? "").trim();
      gateDecisions.push({
        sourceId: e.source_entity_id,
        targetId: e.target_entity_id,
        gate: resolved.gate,
        source: resolved.source,
        certainty: resolved.certainty,
        conditionText: text.length > 0 ? text.slice(0, 200) : null,
      });
    }
    return {
      sourceId: e.source_entity_id,
      targetId: e.target_entity_id,
      strength: Number.isFinite(e.strength) ? e.strength : 0.5,
      polarity,
      dynamics: normalizeDynamics(e.dynamics),
      params:
        e.dynamics_properties && typeof e.dynamics_properties === "object"
          ? (e.dynamics_properties as Record<string, number>)
          : undefined,
      conditionGate,
    };
  });

  const simulation = runMonteCarlo({
    nodes,
    edges,
    iterations: opts.iterations,
    timesteps: opts.timesteps,
    seed: opts.seed,
    integrator: opts.integrator,
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
    gateDecisions,
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
      integrator: "discrete",
    },
    targetDistribution: null,
    nodeCount: 0,
    edgeCount: 0,
    gateDecisions: [],
    error,
  };
}

// ── R5 Phase A — snapshot-mode MC ───────────────────────────────────
//
// When the caller passes `snapshotId` (and optionally `scenarioId`),
// the engine reads entities + edges from the frozen JSONB payload
// instead of live tables. This is what makes "test on baseline" real —
// a proposal's MC distribution against snapshot S stays reproducible
// even if the live KG drifts.
//
// When `scenarioId` is also set, the scenario's action_list is
// replayed on top of the snapshot via `applyScenarioActions` before
// the MC runs. That's the "test-after-intervention" path: baseline MC
// on snapshot = before; scenario-applied MC on snapshot = after.

async function simulateEntityChainFromSnapshot(
  db: AnyDb,
  opts: SimulateChainOpts,
): Promise<SimulateChainResult> {
  const depth = Math.min(opts.depthHops ?? DEFAULT_DEPTH, MAX_DEPTH);

  // Load snapshot row. JSONB payload carries frozen entities + edges.
  const { data: snapshot, error: snapshotErr } = await db
    .from("twin_snapshots")
    .select("id, entities, edges")
    .eq("id", opts.snapshotId!)
    .maybeSingle();

  if (snapshotErr || !snapshot) {
    return empty(
      snapshotErr?.message ??
        `snapshot ${opts.snapshotId} not found`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshotRow = snapshot as any;
  type SnapshotEntity = {
    id: string;
    name?: string;
    confidence?: number | null;
    entity_type?: string | null;
    provenance?: Record<string, unknown> | null;
  };
  type SnapshotEdge = {
    id?: string;
    source_entity_id: string;
    target_entity_id: string;
    strength?: number;
    polarity?: string;
    confidence?: number;
    dynamics?: string | null;
    dynamics_properties?: unknown;
    conditions?: string | null;
  };
  let snapshotEntities: SnapshotEntity[] = Array.isArray(snapshotRow.entities)
    ? (snapshotRow.entities as SnapshotEntity[])
    : [];
  let snapshotEdges: SnapshotEdge[] = Array.isArray(snapshotRow.edges)
    ? (snapshotRow.edges as SnapshotEdge[])
    : [];

  // If a scenario is attached, replay its actions on top of the
  // snapshot before the MC reads. Lazy-import to avoid pulling
  // scenario types into every simulator consumer.
  if (opts.scenarioId) {
    const { data: scenario, error: scenarioErr } = await db
      .from("scenarios")
      .select("id, action_list, parent_snapshot_id")
      .eq("id", opts.scenarioId)
      .maybeSingle();
    if (scenarioErr || !scenario) {
      return empty(
        scenarioErr?.message ??
          `scenario ${opts.scenarioId} not found`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scenarioRow = scenario as any;
    // Sanity: the scenario must match the snapshot. Mismatched pairs
    // would apply deltas to the wrong baseline.
    if (scenarioRow.parent_snapshot_id !== opts.snapshotId) {
      return empty(
        `scenario ${opts.scenarioId} is rooted at snapshot ${scenarioRow.parent_snapshot_id}, not ${opts.snapshotId}`,
      );
    }
    const actions = Array.isArray(scenarioRow.action_list)
      ? scenarioRow.action_list
      : [];
    if (actions.length > 0) {
      const { applyScenarioActions } = await import(
        "@/lib/twin/snapshot-capture"
      );
      // Cast through unknown — snapshot's entity/edge rows are a subset
      // of the full Entity/Edge types, but the replayer only needs the
      // fields it actually uses (id, confidence, strength, polarity).
      const replayed = applyScenarioActions(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snapshotEntities as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snapshotEdges as any,
        [],
        [],
        actions,
      );
      snapshotEntities = replayed.entities as unknown as SnapshotEntity[];
      snapshotEdges = replayed.edges as unknown as SnapshotEdge[];
    }
  }

  // Verify target is in the snapshot (+ optional scenario) subgraph.
  const target = snapshotEntities.find((e) => e.id === opts.targetEntityId);
  if (!target) {
    return empty(
      `Target entity ${opts.targetEntityId} not in snapshot ${opts.snapshotId}${opts.scenarioId ? ` + scenario ${opts.scenarioId}` : ""}`,
    );
  }

  // BFS upstream from target — same logic as the live path.
  const includedEntityIds = new Set<string>([opts.targetEntityId]);
  const includedEdges: SnapshotEdge[] = [];
  let frontier: Set<string> = new Set([opts.targetEntityId]);
  for (let hop = 0; hop < depth && frontier.size > 0; hop++) {
    const nextFrontier = new Set<string>();
    for (const edge of snapshotEdges) {
      if (
        frontier.has(edge.target_entity_id) &&
        !includedEntityIds.has(edge.source_entity_id)
      ) {
        includedEntityIds.add(edge.source_entity_id);
        includedEdges.push(edge);
        nextFrontier.add(edge.source_entity_id);
      } else if (frontier.has(edge.target_entity_id)) {
        if (!includedEdges.includes(edge)) includedEdges.push(edge);
      }
    }
    frontier = nextFrontier;
  }

  const entityById = new Map<string, SnapshotEntity>(
    snapshotEntities
      .filter((e) => includedEntityIds.has(e.id))
      .map((e) => [e.id, e]),
  );

  // Map to engine specs. Mirrors the live path's logic, including
  // lever-multiplier and perturbation override support.
  const perturbations = opts.perturbations;
  const nodes: NodeSpec[] = Array.from(includedEntityIds).map((id) => {
    const row = entityById.get(id);
    const confidence = row?.confidence ?? 0.5;
    if (id === opts.targetEntityId) {
      return { id, priorMean: 0, priorStdDev: 0 };
    }
    let leverMultiplier = 1;
    if (row?.entity_type === "causal_driver") {
      const prov = (row.provenance ?? {}) as Record<string, unknown>;
      if (prov.source === "why_chain") {
        if (prov.stop_reason === "external") leverMultiplier = 0.35;
        else if (prov.stop_reason === "user_controllable") leverMultiplier = 1.2;
      }
    }
    const override = perturbations?.get(id);
    const defaultStdDev = Math.max(0.02, (1 - (confidence ?? 0.5)) * leverMultiplier);
    return {
      id,
      priorMean: override?.priorMean ?? 0,
      priorStdDev: override?.priorStdDev ?? defaultStdDev,
    };
  });

  // Resolve conditional gates same way the live path does.
  const gateDecisions: GateDecision[] = [];
  const edges: EdgeSpec[] = includedEdges.map((e) => {
    const polarity = normalizePolarity(e.polarity);
    let conditionGate: number | undefined;
    if (polarity === "conditional") {
      const resolved = resolveConditionGate(
        e.conditions ?? null,
        Number.isFinite(e.confidence ?? NaN) ? (e.confidence as number) : null,
      );
      conditionGate = resolved.gate;
      const text = (e.conditions ?? "").trim();
      gateDecisions.push({
        sourceId: e.source_entity_id,
        targetId: e.target_entity_id,
        gate: resolved.gate,
        source: resolved.source,
        certainty: resolved.certainty,
        conditionText: text.length > 0 ? text.slice(0, 200) : null,
      });
    }
    return {
      sourceId: e.source_entity_id,
      targetId: e.target_entity_id,
      strength: Number.isFinite(e.strength ?? NaN) ? (e.strength as number) : 0.5,
      polarity,
      dynamics: normalizeDynamics(e.dynamics),
      params:
        e.dynamics_properties && typeof e.dynamics_properties === "object"
          ? (e.dynamics_properties as Record<string, number>)
          : undefined,
      conditionGate,
    };
  });

  const simulation = runMonteCarlo({
    nodes,
    edges,
    iterations: opts.iterations,
    timesteps: opts.timesteps,
    seed: opts.seed,
    integrator: opts.integrator,
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
    gateDecisions,
    error: null,
  };
}
