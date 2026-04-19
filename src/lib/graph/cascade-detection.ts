// ── Cascade detection ──
//
// Takes the structural graph (entities + directed causal edges) and computes
// multi-hop downstream reach from "seed" entities — typically leverage
// points, risk points, and the master bottleneck. The output is a set of
// causal paths that a single upstream change would propagate through.
//
// This is the first non-trivial multi-hop reasoning operation wired into
// the pipeline. Previously every query was 1-hop (entity → neighbor). Cascade
// traces up to K hops along edges whose dimension is causal/functional,
// accumulating a confidence-discounted impact score along the way.
//
// The result is persisted to `reasoning_results` with reasoning_type='cascade'
// so UIs can surface "if you move node X, here's what moves with it" without
// another LLM call.
//
// Intentionally deterministic and CPU-cheap — no LLM. Uses path strength as
// the decay model (each hop multiplies confidence × edge.strength) so deep
// weak chains score lower than short strong ones.

export interface CascadeEntityInput {
  id: string;              // UUID (DB primary key)
  entity_id: string;       // display id, e.g. "C3"
  name: string;
  is_leverage_point: boolean;
  is_risk_point: boolean;
  is_master_bottleneck: boolean;
  importance: string | null;
  blast_radius: number | null;
}

export interface CascadeEdgeInput {
  source_entity_id: string; // UUID
  target_entity_id: string; // UUID
  dimension: string | null;
  strength: number | null;
  confidence: number | null;
  polarity: string | null;
}

export interface CascadeHop {
  entity_id: string;        // display id
  name: string;
  depth: number;            // 1 = direct neighbor
  accumulated_impact: number; // 0-1, product of edge strength × confidence along the path
  polarity_flips: number;   // count of "negative" edges along path
}

export interface CascadePath {
  seed_entity_id: string;   // display id
  seed_name: string;
  seed_role: "leverage_point" | "risk_point" | "master_bottleneck" | "high_importance";
  downstream: CascadeHop[];
  total_reach: number;      // count of distinct downstream entities
  max_depth: number;
}

export interface CascadeReport {
  seeds_analyzed: number;
  paths: CascadePath[];
  // Aggregate: how many entities fall under ANY seed's cascade (union).
  total_affected_entities: number;
  // Entities reached by ≥3 seeds — systemic convergence points.
  systemic_pressure_points: Array<{ entity_id: string; name: string; hit_by_seeds: number }>;
  computed_at: string;
}

// Dimensions that transmit causal/functional force. Correlational, comparative,
// epistemic, and agentive edges do NOT propagate cascades (knowing that A
// correlates with B doesn't mean moving A moves B).
const CAUSAL_DIMENSIONS = new Set(["causal", "functional", "temporal", "structural"]);

const MAX_DEPTH = 4;        // Stop after 4 hops — longer chains have near-zero impact
const MIN_IMPACT = 0.05;    // Prune paths whose accumulated impact falls below this
const TOP_N_PATHS = 40;     // Cap output size per cascade

export function computeCascades(
  entities: CascadeEntityInput[],
  edges: CascadeEdgeInput[],
): CascadeReport {
  // Build adjacency: uuid → [{target_uuid, strength, confidence, polarity}]
  const adjacency = new Map<string, Array<{ target: string; weight: number; polarity: string }>>();
  for (const e of edges) {
    if (!e.dimension || !CAUSAL_DIMENSIONS.has(e.dimension)) continue;
    const strength = typeof e.strength === "number" ? e.strength : 0.5;
    const confidence = typeof e.confidence === "number" ? e.confidence : 0.8;
    const weight = strength * confidence;
    if (weight <= 0) continue;
    const list = adjacency.get(e.source_entity_id) ?? [];
    list.push({
      target: e.target_entity_id,
      weight,
      polarity: e.polarity ?? "positive",
    });
    adjacency.set(e.source_entity_id, list);
  }

  // Build uuid → display metadata lookup
  const meta = new Map<string, CascadeEntityInput>();
  for (const ent of entities) meta.set(ent.id, ent);

  // Pick seeds: every leverage_point, risk_point, master_bottleneck, plus
  // any entity with importance=fundamental (strategic override).
  const seeds: Array<{ uuid: string; role: CascadePath["seed_role"] }> = [];
  for (const ent of entities) {
    if (ent.is_master_bottleneck) {
      seeds.push({ uuid: ent.id, role: "master_bottleneck" });
    } else if (ent.is_leverage_point) {
      seeds.push({ uuid: ent.id, role: "leverage_point" });
    } else if (ent.is_risk_point) {
      seeds.push({ uuid: ent.id, role: "risk_point" });
    } else if (ent.importance === "fundamental") {
      seeds.push({ uuid: ent.id, role: "high_importance" });
    }
  }

  // Trace from each seed
  const paths: CascadePath[] = [];
  const reachedBySeeds = new Map<string, number>(); // target uuid → seed count

  for (const seed of seeds) {
    const seedMeta = meta.get(seed.uuid);
    if (!seedMeta) continue;

    // BFS with path-impact tracking. Visited on this cascade to prevent cycles.
    const hops: CascadeHop[] = [];
    const visited = new Set<string>([seed.uuid]);
    const queue: Array<{ uuid: string; depth: number; impact: number; flips: number }> = [
      { uuid: seed.uuid, depth: 0, impact: 1.0, flips: 0 },
    ];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.depth >= MAX_DEPTH) continue;
      const neighbors = adjacency.get(cur.uuid) ?? [];
      for (const nb of neighbors) {
        if (visited.has(nb.target)) continue;
        const nextImpact = cur.impact * nb.weight;
        if (nextImpact < MIN_IMPACT) continue;
        const nextFlips = cur.flips + (nb.polarity === "negative" ? 1 : 0);
        const targetMeta = meta.get(nb.target);
        if (!targetMeta) continue;
        visited.add(nb.target);
        hops.push({
          entity_id: targetMeta.entity_id,
          name: targetMeta.name,
          depth: cur.depth + 1,
          accumulated_impact: Math.round(nextImpact * 1000) / 1000,
          polarity_flips: nextFlips,
        });
        reachedBySeeds.set(nb.target, (reachedBySeeds.get(nb.target) ?? 0) + 1);
        queue.push({
          uuid: nb.target,
          depth: cur.depth + 1,
          impact: nextImpact,
          flips: nextFlips,
        });
      }
    }

    // Sort hops by impact descending, cap
    hops.sort((a, b) => b.accumulated_impact - a.accumulated_impact);
    const trimmed = hops.slice(0, TOP_N_PATHS);

    if (trimmed.length > 0) {
      paths.push({
        seed_entity_id: seedMeta.entity_id,
        seed_name: seedMeta.name,
        seed_role: seed.role,
        downstream: trimmed,
        total_reach: hops.length,
        max_depth: Math.max(0, ...hops.map((h) => h.depth)),
      });
    }
  }

  // Systemic pressure points: entities reached by ≥3 seeds
  const pressurePoints: CascadeReport["systemic_pressure_points"] = [];
  for (const [uuid, count] of reachedBySeeds.entries()) {
    if (count >= 3) {
      const m = meta.get(uuid);
      if (m) {
        pressurePoints.push({
          entity_id: m.entity_id,
          name: m.name,
          hit_by_seeds: count,
        });
      }
    }
  }
  pressurePoints.sort((a, b) => b.hit_by_seeds - a.hit_by_seeds);

  return {
    seeds_analyzed: seeds.length,
    paths,
    total_affected_entities: reachedBySeeds.size,
    systemic_pressure_points: pressurePoints.slice(0, 20),
    computed_at: new Date().toISOString(),
  };
}
