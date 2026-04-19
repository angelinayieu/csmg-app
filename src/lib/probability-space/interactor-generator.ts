// ── Interactor Generator (Tiers 1-3) ──
//
// Given a focal entity + its extracted roles + the full graph, generate
// candidate interactors — the entities worth combining with the focal node
// to predict convergent outcomes. Phase 1 covers the three *pure* tiers:
//
//   Tier 1  EMPIRICAL         direct graph neighbors. High confidence.
//   Tier 2  STRUCTURAL        2-hop reachability. Medium-high confidence.
//   Tier 3  ANALOGICAL        entities from other systems/domains with the
//                             same role pattern as current Tier-1 interactors.
//                             Reveals cross-system transfer. Medium confidence.
//
// Tiers 4 (domain_inference) and 5 (adversarial) are LLM-driven and deferred
// to a later phase. The generator is written so they can slot in as additional
// collectors without changing the orchestrator or type surface.

import type { Entity, Edge } from "@/types";
import type { Role, InteractorCandidate, InteractorTier } from "@/types/convergent-point";

// ── Helpers ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parentOf(e: Entity): string | undefined { return (e as any).parent_entity_id; }

interface GraphIndex {
  byUuid: Map<string, Entity>;
  outgoingEdgesByEntity: Map<string, Edge[]>;
  incomingEdgesByEntity: Map<string, Edge[]>;
  // For analogical tier: index entities by (layer, dominant_role_keys) → [uuids]
  entityRolePattern: Map<string, string>;
}

function buildGraphIndex(entities: Entity[], edges: Edge[]): GraphIndex {
  const byUuid = new Map<string, Entity>();
  for (const e of entities) byUuid.set(e.id, e);

  const outgoingEdgesByEntity = new Map<string, Edge[]>();
  const incomingEdgesByEntity = new Map<string, Edge[]>();
  for (const edge of edges) {
    const out = outgoingEdgesByEntity.get(edge.source_entity_id) ?? [];
    out.push(edge);
    outgoingEdgesByEntity.set(edge.source_entity_id, out);
    const inc = incomingEdgesByEntity.get(edge.target_entity_id) ?? [];
    inc.push(edge);
    incomingEdgesByEntity.set(edge.target_entity_id, inc);
  }

  // Role pattern index: for each entity, compute its dominant role keys.
  // Used for Tier 3 analogical mapping.
  const entityRolePattern = new Map<string, string>();
  // (We skip this for now — Tier 3 can compute on demand. See computeEntityRoleSignature below.)

  return { byUuid, outgoingEdgesByEntity, incomingEdgesByEntity, entityRolePattern };
}

/**
 * Compute a lightweight role signature for an arbitrary entity: the multiset
 * of (dimension, direction) labels from its incident edges, joined into a
 * canonical string. Used to find structurally similar entities for Tier 3.
 * Example: "causal-out:3|functional-in:2|structural-out:1".
 */
function computeEntityRoleSignature(entityUuid: string, idx: GraphIndex): string {
  const counts = new Map<string, number>();
  const bump = (dim: string, dir: "out" | "in") => {
    const k = `${dim}-${dir}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (const e of idx.outgoingEdgesByEntity.get(entityUuid) ?? []) bump(e.dimension, "out");
  for (const e of idx.incomingEdgesByEntity.get(entityUuid) ?? []) bump(e.dimension, "in");
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
}

// ── Tier 1: Empirical neighbors ──

function collectTier1(
  focalUuid: string,
  roles: Role[],
  idx: GraphIndex,
  maxCount: number,
): InteractorCandidate[] {
  const candidates = new Map<string, InteractorCandidate>();
  const roleKeyByEdgeId = new Map<string, string[]>();
  for (const r of roles) {
    for (const edgeId of r.sample_edge_ids) {
      const arr = roleKeyByEdgeId.get(edgeId) ?? [];
      arr.push(r.key);
      roleKeyByEdgeId.set(edgeId, arr);
    }
  }

  const processEdge = (edge: Edge, neighborUuid: string) => {
    if (neighborUuid === focalUuid) return;
    const neighbor = idx.byUuid.get(neighborUuid);
    if (!neighbor) return;

    const existing = candidates.get(neighborUuid);
    const conf = typeof edge.confidence === "number" ? edge.confidence : 0.7;
    const linkedRoles = roleKeyByEdgeId.get(edge.id) ?? [];
    const reason = `Direct edge: ${edge.relationship_type}${linkedRoles.length > 0 ? ` (role: ${linkedRoles.join(",")})` : ""}`;

    if (!existing || existing.confidence < conf) {
      candidates.set(neighborUuid, {
        entity_id: neighborUuid,
        entity_display_id: neighbor.entity_id,
        entity_name: neighbor.name,
        tier: 1,
        confidence: conf,
        reason,
        role_key: linkedRoles[0],
      });
    }
  };

  for (const edge of idx.outgoingEdgesByEntity.get(focalUuid) ?? []) {
    processEdge(edge, edge.target_entity_id);
  }
  for (const edge of idx.incomingEdgesByEntity.get(focalUuid) ?? []) {
    processEdge(edge, edge.source_entity_id);
  }

  return Array.from(candidates.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxCount);
}

// ── Tier 2: Structural (2-hop) ──

function collectTier2(
  focalUuid: string,
  tier1: InteractorCandidate[],
  idx: GraphIndex,
  maxCount: number,
): InteractorCandidate[] {
  const tier1Ids = new Set(tier1.map((c) => c.entity_id));
  tier1Ids.add(focalUuid);

  const candidates = new Map<string, InteractorCandidate>();

  // For each Tier-1 neighbor, look one more hop out.
  for (const t1 of tier1) {
    const intermediate = t1.entity_id;
    const outbound = idx.outgoingEdgesByEntity.get(intermediate) ?? [];
    const inbound = idx.incomingEdgesByEntity.get(intermediate) ?? [];

    const inspect = (nextUuid: string, viaEdge: Edge) => {
      if (tier1Ids.has(nextUuid)) return; // already known
      if (nextUuid === focalUuid) return;
      const next = idx.byUuid.get(nextUuid);
      if (!next) return;

      // Confidence decays at 2-hop: product of hop confidences × 0.7 penalty
      const hopConf = typeof viaEdge.confidence === "number" ? viaEdge.confidence : 0.7;
      const t1Conf = t1.confidence;
      const conf = Math.min(0.85, hopConf * t1Conf * 0.75);

      const existing = candidates.get(nextUuid);
      if (existing && existing.confidence >= conf) return;

      candidates.set(nextUuid, {
        entity_id: nextUuid,
        entity_display_id: next.entity_id,
        entity_name: next.name,
        tier: 2,
        confidence: conf,
        reason: `2-hop via ${t1.entity_name} (${viaEdge.relationship_type})`,
        via_entity_ids: [intermediate],
      });
    };

    for (const e of outbound) inspect(e.target_entity_id, e);
    for (const e of inbound) inspect(e.source_entity_id, e);
  }

  return Array.from(candidates.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxCount);
}

// ── Tier 3: Analogical ──
//
// For each Tier-1 interactor, compute its role signature. Then find other
// entities in the graph — preferably in *different* hierarchical systems —
// with the same signature. These are structural analogs: in a different
// context, they play an equivalent role.
//
// This is where the hierarchical layer shines. An "enabler" in the "Go-to-
// market" system might have a counterpart enabler in the "Product engineering"
// system. Cross-system analogs are exactly what strategic transfer exploits.

function collectTier3(
  focalUuid: string,
  tier1: InteractorCandidate[],
  tier2: InteractorCandidate[],
  entities: Entity[],
  idx: GraphIndex,
  maxCount: number,
): InteractorCandidate[] {
  if (tier1.length === 0) return [];

  const excluded = new Set<string>([focalUuid]);
  for (const c of tier1) excluded.add(c.entity_id);
  for (const c of tier2) excluded.add(c.entity_id);

  // Build reference signatures from Tier 1 interactors.
  const referenceSignatures = new Map<string, { signature: string; sourceName: string }>();
  for (const t1 of tier1) {
    const sig = computeEntityRoleSignature(t1.entity_id, idx);
    if (sig.length === 0) continue;
    // Keep the first entity we see for each unique signature as the "source" of the analogy.
    if (!referenceSignatures.has(sig)) {
      referenceSignatures.set(sig, { signature: sig, sourceName: t1.entity_name });
    }
  }

  // Determine the focal's hierarchical "home" system for cross-system weighting.
  const focalEntity = idx.byUuid.get(focalUuid);
  const focalSystemUuid = (() => {
    if (!focalEntity) return undefined;
    if (focalEntity.layer === "system") return focalEntity.id;
    if (focalEntity.layer === "domain") return parentOf(focalEntity);
    if (focalEntity.layer === "thread") {
      const dUuid = parentOf(focalEntity);
      return dUuid ? parentOf(idx.byUuid.get(dUuid) ?? ({} as Entity)) : undefined;
    }
    return undefined;
  })();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const systemOfEntity = (e: Entity): string | undefined => {
    if (e.layer === "system") return e.id;
    if (e.layer === "domain") return parentOf(e);
    if (e.layer === "thread") {
      const dUuid = parentOf(e);
      const d = dUuid ? idx.byUuid.get(dUuid) : undefined;
      return d ? parentOf(d) : undefined;
    }
    return undefined;
  };

  const candidates = new Map<string, InteractorCandidate>();

  for (const e of entities) {
    if (excluded.has(e.id)) continue;

    const sig = computeEntityRoleSignature(e.id, idx);
    if (sig.length === 0) continue;

    const match = referenceSignatures.get(sig);
    if (!match) continue;

    // Cross-system bonus: prefer analogs from a different system than focal.
    const entitySys = systemOfEntity(e);
    const isCrossSystem = focalSystemUuid && entitySys && entitySys !== focalSystemUuid;
    const conf = isCrossSystem ? 0.62 : 0.45;

    candidates.set(e.id, {
      entity_id: e.id,
      entity_display_id: e.entity_id,
      entity_name: e.name,
      tier: 3,
      confidence: conf,
      reason: isCrossSystem
        ? `Structural analog of ${match.sourceName} (cross-system, same role signature)`
        : `Structural analog of ${match.sourceName} (same role signature)`,
      analog_entity_ids: [match.sourceName],
    });
  }

  return Array.from(candidates.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxCount);
}

// ── Public entry point ──

const DEFAULT_MAX_PER_TIER: Record<InteractorTier, number> = {
  1: 8,
  2: 6,
  3: 4,
  4: 0, // deferred
  5: 0, // deferred
};

export interface GenerateInteractorsOptions {
  maxPerTier?: Partial<Record<InteractorTier, number>>;
  skipTiers?: InteractorTier[];
}

export function generateInteractors(
  focalEntityUuid: string,
  roles: Role[],
  entities: Entity[],
  edges: Edge[],
  options: GenerateInteractorsOptions = {},
): InteractorCandidate[] {
  const maxPer = { ...DEFAULT_MAX_PER_TIER, ...(options.maxPerTier ?? {}) };
  const skip = new Set<InteractorTier>(options.skipTiers ?? []);

  const idx = buildGraphIndex(entities, edges);

  const tier1 = skip.has(1) ? [] : collectTier1(focalEntityUuid, roles, idx, maxPer[1]);
  const tier2 = skip.has(2) ? [] : collectTier2(focalEntityUuid, tier1, idx, maxPer[2]);
  const tier3 = skip.has(3) ? [] : collectTier3(focalEntityUuid, tier1, tier2, entities, idx, maxPer[3]);

  return [...tier1, ...tier2, ...tier3];
}

// ── Combinatorial planner ──
// At 18 candidates (8+6+4), the power set is 262k. We prune to sensible
// combinations: all singletons + pairs among Tier-1 that share a cycle or
// edge with each other + any cluster of 3 from a single cycle.

export interface PlannedCombinations {
  singletons: Array<{ interactor_ids: string[]; reason: string }>;
  pairs: Array<{ interactor_ids: string[]; reason: string }>;
  clusters: Array<{ interactor_ids: string[]; reason: string }>;
}

export function planCombinations(
  focalEntityUuid: string,
  candidates: InteractorCandidate[],
  edges: Edge[],
  options: { singletonsOnly?: boolean } = {},
): PlannedCombinations {
  const result: PlannedCombinations = { singletons: [], pairs: [], clusters: [] };

  // Singletons: every candidate.
  for (const c of candidates) {
    result.singletons.push({
      interactor_ids: [c.entity_id],
      reason: `Singleton ${c.tier === 1 ? "empirical" : c.tier === 2 ? "structural" : "analogical"} interactor`,
    });
  }

  if (options.singletonsOnly) return result;

  // Pairs: Tier-1 candidates that share an edge with each other.
  const tier1 = candidates.filter((c) => c.tier === 1);
  const tier1Ids = new Set(tier1.map((c) => c.entity_id));
  const t1Adjacent = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.source_entity_id === focalEntityUuid || e.target_entity_id === focalEntityUuid) continue;
    if (!tier1Ids.has(e.source_entity_id) || !tier1Ids.has(e.target_entity_id)) continue;
    const a = t1Adjacent.get(e.source_entity_id) ?? new Set();
    a.add(e.target_entity_id);
    t1Adjacent.set(e.source_entity_id, a);
    const b = t1Adjacent.get(e.target_entity_id) ?? new Set();
    b.add(e.source_entity_id);
    t1Adjacent.set(e.target_entity_id, b);
  }
  const seenPair = new Set<string>();
  for (const a of tier1) {
    const adj = t1Adjacent.get(a.entity_id);
    if (!adj) continue;
    for (const b of tier1) {
      if (a.entity_id >= b.entity_id) continue; // dedup ordered pair
      if (!adj.has(b.entity_id)) continue;
      const key = `${a.entity_id}|${b.entity_id}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      result.pairs.push({
        interactor_ids: [a.entity_id, b.entity_id],
        reason: `Pair — ${a.entity_name} + ${b.entity_name} are themselves connected, making their joint interaction with focal non-trivial`,
      });
    }
  }

  // Clusters: triples-of-Tier-1-candidates that form a triangle with focal.
  // Sparse in practice — we keep them because these are the highest-signal
  // combinations (if A, B, C, and focal all interact pairwise, they're a
  // coherent sub-system worth analyzing jointly).
  for (const a of tier1) {
    const adjA = t1Adjacent.get(a.entity_id) ?? new Set();
    for (const b of tier1) {
      if (a.entity_id >= b.entity_id) continue;
      if (!adjA.has(b.entity_id)) continue;
      const adjB = t1Adjacent.get(b.entity_id) ?? new Set();
      for (const c of tier1) {
        if (b.entity_id >= c.entity_id) continue;
        if (!adjA.has(c.entity_id) || !adjB.has(c.entity_id)) continue;
        result.clusters.push({
          interactor_ids: [a.entity_id, b.entity_id, c.entity_id],
          reason: `Cluster — ${a.entity_name}, ${b.entity_name}, ${c.entity_name} form a triangle, all connected to focal and each other`,
        });
        // Cap at 3 clusters per focal to control LLM cost.
        if (result.clusters.length >= 3) return result;
      }
    }
  }

  return result;
}
