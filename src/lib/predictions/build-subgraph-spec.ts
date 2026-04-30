// ── build-subgraph-spec (Phase 5) ─────────────────────────────────
//
// Helper that loads a 2-hop subgraph around a target entity from the
// live DB and converts it to the SimulationSpec shape consumed by the
// time-aware Monte Carlo. Compact + reusable so register-prediction
// (and any future pre-flight predictor) doesn't reinvent it.
//
// SHAPE
//
//   - NodeSpec per entity in the subgraph: priorMean=0 (we measure
//     deltas, not absolute values), priorStdDev derived from edge
//     confidence diffuseness on the entity's incident edges.
//   - EdgeSpec per edge with strength, polarity, dynamics, and the
//     Phase 4 `temporal` field pulled from edges.{onset,peak,
//     persistence}_days_p50 + decay_kinetics_modal.
//
// SCOPE LIMITS
//
//   - 2-hop (target ± direct neighbors ± their direct neighbors).
//     Matches what the lab routes use; deeper subgraphs slow the
//     simulator without typically improving signal.
//   - Up to ~120 nodes and ~600 edges (the simulator's MAX_NODES
//     and MAX_EDGES caps elsewhere). Larger spaces are clipped at
//     query time via the implicit subgraph bound.

import type { Database } from "@/types/database.types";
import type {
  NodeSpec,
  EdgeSpec,
  EdgeDynamics,
  EdgePolarity,
  EdgeTemporalSpec,
  SimulationSpec,
} from "@/lib/simulation/monte-carlo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

type EdgeRow = Database["public"]["Tables"]["edges"]["Row"];

const VALID_DYNAMICS: EdgeDynamics[] = [
  "linear",
  "threshold",
  "compounding",
  "decay",
  "exponential",
];

const VALID_POLARITIES: EdgePolarity[] = [
  "positive",
  "negative",
  "neutral",
  "conditional",
];

function normDynamics(raw: string | null | undefined): EdgeDynamics {
  if (!raw) return "linear";
  const found = VALID_DYNAMICS.find((d) => d === raw);
  return found ?? "linear";
}

function normPolarity(raw: string | null | undefined): EdgePolarity | undefined {
  if (!raw) return undefined;
  const found = VALID_POLARITIES.find((p) => p === raw);
  return found;
}

function pullTemporal(
  row: Record<string, unknown>,
): EdgeTemporalSpec | null {
  const onset = numericOrNull(row.onset_days_p50);
  const peak = numericOrNull(row.peak_days_p50);
  const persistence = numericOrNull(row.persistence_days_p50);
  const decay = row.decay_kinetics_modal;
  const hasAny =
    onset !== null ||
    peak !== null ||
    persistence !== null ||
    decay === "linear" ||
    decay === "exponential" ||
    decay === "sustained" ||
    decay === "biphasic";
  if (!hasAny) return null;
  return {
    onset_days: onset,
    peak_days: peak,
    persistence_days: persistence,
    decay_kinetics:
      decay === "linear" ||
      decay === "exponential" ||
      decay === "sustained" ||
      decay === "biphasic" ||
      decay === "unknown"
        ? decay
        : null,
  };
}

function numericOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Load a 2-hop subgraph around `targetEntityId` and return a
 *  ready-to-run SimulationSpec (sans iterations/seed/weeklyHorizon —
 *  caller fills those). Returns null when the target isn't found or
 *  the space is empty.
 *
 *  The target gets a +0.5 priorMean (the intervention seed); other
 *  nodes start at 0. priorStdDev defaults to 0 — the simulator
 *  injects noise via the iteration loop rather than per-node draws,
 *  so this is fine for trajectory shape (and matches the existing
 *  lab MC's behavior). */
export async function buildSubgraphSpec(
  db: AnyDb,
  spaceId: string,
  targetEntityId: string,
): Promise<Omit<SimulationSpec, "iterations" | "seed"> | null> {
  // 1. First-hop edges touching target.
  const { data: hop1 } = (await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, strength, polarity, dynamics, dynamics_properties, " +
        "onset_days_p50, peak_days_p50, persistence_days_p50, decay_kinetics_modal",
    )
    .eq("space_id", spaceId)
    .or(
      `source_entity_id.eq.${targetEntityId},target_entity_id.eq.${targetEntityId}`,
    )) as { data: EdgeRow[] | null };
  const directEdges = hop1 ?? [];

  if (directEdges.length === 0) {
    // No incident edges — return a 1-node subgraph so the simulator
    // produces a flat baseline trajectory rather than failing.
    return {
      nodes: [{ id: targetEntityId, priorMean: 0.5, priorStdDev: 0 }],
      edges: [],
    };
  }

  const neighborIds = Array.from(
    new Set(
      directEdges
        .flatMap((e) => [e.source_entity_id, e.target_entity_id])
        .filter((id) => id !== targetEntityId),
    ),
  );

  // 2. Second-hop edges touching neighbors.
  let hop2Edges: EdgeRow[] = [];
  if (neighborIds.length > 0) {
    const { data } = (await db
      .from("edges")
      .select(
        "id, source_entity_id, target_entity_id, strength, polarity, dynamics, dynamics_properties, " +
          "onset_days_p50, peak_days_p50, persistence_days_p50, decay_kinetics_modal",
      )
      .eq("space_id", spaceId)
      .or(
        `source_entity_id.in.(${neighborIds.join(",")}),target_entity_id.in.(${neighborIds.join(",")})`,
      )) as { data: EdgeRow[] | null };
    hop2Edges = data ?? [];
  }

  const edgeMap = new Map<string, EdgeRow>();
  for (const e of [...directEdges, ...hop2Edges]) edgeMap.set(e.id, e);
  const allEdges = Array.from(edgeMap.values());

  const nodeIds = Array.from(
    new Set([
      targetEntityId,
      ...allEdges.flatMap((e) => [e.source_entity_id, e.target_entity_id]),
    ]),
  );

  const nodes: NodeSpec[] = nodeIds.map((id) => ({
    id,
    // Target entity gets the intervention seed; others start neutral.
    priorMean: id === targetEntityId ? 0.5 : 0,
    priorStdDev: id === targetEntityId ? 0.05 : 0,
  }));

  const edges: EdgeSpec[] = allEdges.map((e) => {
    const temporal = pullTemporal(
      e as unknown as Record<string, unknown>,
    );
    return {
      sourceId: e.source_entity_id,
      targetId: e.target_entity_id,
      strength: typeof e.strength === "number" ? e.strength : 0.5,
      polarity: normPolarity(e.polarity),
      dynamics: normDynamics(e.dynamics),
      params:
        e.dynamics_properties &&
        typeof e.dynamics_properties === "object" &&
        !Array.isArray(e.dynamics_properties)
          ? (e.dynamics_properties as Record<string, number>)
          : undefined,
      ...(temporal ? { temporal } : {}),
    };
  });

  return { nodes, edges };
}
