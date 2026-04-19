/**
 * Probability Space Engine
 *
 * Given an edge between Entity A and Entity B, reads both entities' expansion data
 * and constructs a probability sub-graph of mediating variables, conditions, and
 * alternative pathways that govern the connection.
 *
 * The engine:
 * 1. Extracts sub-components from each entity's expansion
 * 2. Maps internal pathways as probability edges
 * 3. Detects cross-entity bridges (where A's sub-components connect to B's)
 * 4. Adds condition gates and mediator nodes
 * 5. Computes the critical path (highest-probability route)
 * 6. Identifies failure points and alternative paths
 */

import type { Entity, Edge } from "@/types";
import type {
  ProbabilityNode,
  ProbabilityEdge,
  ProbabilitySpace,
  FailurePoint,
  EdgeCondition,
} from "@/types/probability-space";

// ── Types for expansion data (read from entity provenance) ──

interface ExpansionSubComponent {
  id?: string;
  name: string;
  role?: string;
  description?: string;
  component_type?: string;
  importance?: "critical" | "important" | "moderate" | "minor";
  probability?: number;
  embedding?: number[];
  embedding_model?: string;
  embedding_version?: string;
  manifold?: {
    controllability?: "direct" | "indirect" | "uncontrollable";
    visibility?: "observable" | "latent" | "hidden";
    volatility?: "stable" | "fluctuating" | "chaotic";
  };
}

interface ExpansionPathway {
  source_id: string;
  target_id: string;
  mechanism: string;
  probability?: number;
  conditions?: string | null;
  dynamics?: "sequential" | "parallel" | "conditional" | "probabilistic";
  strength?: number;
  failure_mode?: string | null;
}

interface ExpansionDynamic {
  type: "bottleneck" | "feedback_loop" | "gate" | "amplifier" | "decay";
  component_ids: string[];
  description: string;
  impact?: string;
}

interface ExpansionData {
  sub_components: ExpansionSubComponent[];
  internal_pathways: ExpansionPathway[];
  internal_dynamics: ExpansionDynamic[];
}

// ── Utility: Tokenize for similarity ──

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Sanitize entity ID for use in probability space node IDs ──

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
}

// ── Extract expansion data from entity provenance ──

export function extractExpansionData(entity: Entity): ExpansionData | null {
  const prov = entity.provenance as Record<string, unknown> | null;
  if (!prov) return null;

  const subComponents = (prov.sub_components ?? []) as ExpansionSubComponent[];
  const internalPathways = (prov.internal_pathways ?? []) as ExpansionPathway[];
  const internalDynamics = (prov.internal_dynamics ?? []) as ExpansionDynamic[];

  // Also check entity-level expansion data if stored separately
  const expansionData = prov.expansion as Record<string, unknown> | undefined;
  if (expansionData) {
    if (Array.isArray(expansionData.sub_components) && subComponents.length === 0) {
      subComponents.push(...(expansionData.sub_components as ExpansionSubComponent[]));
    }
    if (Array.isArray(expansionData.internal_pathways) && internalPathways.length === 0) {
      internalPathways.push(...(expansionData.internal_pathways as ExpansionPathway[]));
    }
    if (Array.isArray(expansionData.internal_dynamics) && internalDynamics.length === 0) {
      internalDynamics.push(...(expansionData.internal_dynamics as ExpansionDynamic[]));
    }
  }

  if (subComponents.length === 0 && internalPathways.length === 0) return null;

  return { sub_components: subComponents, internal_pathways: internalPathways, internal_dynamics: internalDynamics };
}

/**
 * Extract expansion data from the `expansions` table row (richer data than provenance).
 * Falls back to provenance-based extraction if no expansion row is provided.
 */
export function extractExpansionDataFromTable(
  entity: Entity,
  expansionRow?: { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown } | null
): ExpansionData | null {
  if (expansionRow) {
    const subComponents = Array.isArray(expansionRow.sub_components)
      ? (expansionRow.sub_components as ExpansionSubComponent[])
      : [];
    const internalPathways = Array.isArray(expansionRow.internal_pathways)
      ? (expansionRow.internal_pathways as ExpansionPathway[])
      : [];
    const internalDynamics = Array.isArray(expansionRow.internal_dynamics)
      ? (expansionRow.internal_dynamics as ExpansionDynamic[])
      : [];

    if (subComponents.length > 0 || internalPathways.length > 0) {
      return { sub_components: subComponents, internal_pathways: internalPathways, internal_dynamics: internalDynamics };
    }
  }

  // Fall back to provenance-based extraction
  return extractExpansionData(entity);
}

// ── Score similarity between two sub-components ──

export function scoreCrossEntitySimilarity(
  scA: ExpansionSubComponent,
  scB: ExpansionSubComponent
): { score: number; mechanism: string } {
  const nameTokensA = tokenize(scA.name);
  const nameTokensB = tokenize(scB.name);
  let nameSim = jaccardSimilarity(nameTokensA, nameTokensB);

  // Boost for matching component_type
  if (scA.component_type && scB.component_type && scA.component_type === scB.component_type) {
    nameSim = Math.min(1, nameSim + 0.15);
  }

  // Boost for matching role/description keywords
  const roleA = tokenize(scA.role ?? scA.description ?? "");
  const roleB = tokenize(scB.role ?? scB.description ?? "");
  const roleSim = jaccardSimilarity(roleA, roleB);

  const combinedScore = nameSim * 0.6 + roleSim * 0.4;

  const mechanism = combinedScore > 0.5
    ? `"${scA.name}" and "${scB.name}" appear to represent the same underlying variable, creating a cross-entity bridge`
    : `"${scA.name}" shares structural similarity with "${scB.name}", suggesting a potential mediating pathway`;

  return { score: combinedScore, mechanism };
}

function deriveSpaceQualityTier(spaceId: string, edges: ProbabilityEdge[]): "verified" | "estimated" | "speculative" {
  if (spaceId.startsWith("synth_")) return "speculative";
  if (edges.length === 0) return "speculative";

  const defaultEdges = edges.filter((e) => e.probability_source === "default").length;
  const measuredEdges = edges.filter((e) => e.probability_source === "measured").length;
  const estimatedEdges = edges.filter((e) => e.probability_source === "estimated").length;

  const defaultRatio = defaultEdges / edges.length;
  if (defaultRatio >= 0.5) return "speculative";
  if (measuredEdges > 0 && defaultRatio <= 0.2) return "verified";
  if (estimatedEdges > 0 || defaultEdges > 0) return "estimated";
  return "speculative";
}

// ── Build probability space for a single edge ──

export function buildProbabilitySpace(
  edge: Edge,
  sourceEntity: Entity,
  targetEntity: Entity,
  sourceExpansion: ExpansionData | null,
  targetExpansion: ExpansionData | null,
  edgeConditions?: EdgeCondition[],
  goalEntityIds?: string[]
): ProbabilitySpace | null {
  // Need at least one side with expansion data
  if (!sourceExpansion && !targetExpansion) return null;

  const edgeId = sanitizeId(
    edge.id ?? `${edge.source_entity_id}_${edge.target_entity_id}`
  );
  const nodes: ProbabilityNode[] = [];
  const edges: ProbabilityEdge[] = [];

  // ── Step 1: Extract source-side sub-components ──
  const sourceScMap = new Map<string, string>(); // original SC id → PS node id
  if (sourceExpansion) {
    for (const [idx, sc] of sourceExpansion.sub_components.entries()) {
      const scId = sc.id ?? `SC${idx + 1}`;
      const nodeId = `PS_${edgeId}_S_${sanitizeId(scId)}`;
      sourceScMap.set(scId, nodeId);
      nodes.push({
        id: nodeId,
        name: sc.name,
        type: "sub_component",
        parent_entity_id: sourceEntity.entity_id,
        source_expansion_sc_id: scId,
        probability: sc.probability,
        controllability: sc.manifold?.controllability,
        visibility: sc.manifold?.visibility,
        volatility: sc.manifold?.volatility,
        component_type: sc.component_type,
        importance: sc.importance,
        embedding: Array.isArray(sc.embedding) ? sc.embedding : undefined,
      });
    }
  }

  // ── Step 2: Extract target-side sub-components ──
  const targetScMap = new Map<string, string>();
  if (targetExpansion) {
    for (const [idx, sc] of targetExpansion.sub_components.entries()) {
      const scId = sc.id ?? `SC${idx + 1}`;
      const nodeId = `PS_${edgeId}_T_${sanitizeId(scId)}`;
      targetScMap.set(scId, nodeId);
      nodes.push({
        id: nodeId,
        name: sc.name,
        type: "sub_component",
        parent_entity_id: targetEntity.entity_id,
        source_expansion_sc_id: scId,
        probability: sc.probability,
        controllability: sc.manifold?.controllability,
        visibility: sc.manifold?.visibility,
        volatility: sc.manifold?.volatility,
        component_type: sc.component_type,
        importance: sc.importance,
        embedding: Array.isArray(sc.embedding) ? sc.embedding : undefined,
      });
    }
  }

  // ── Step 3: Copy internal pathways from source ──
  // Note: expansion-derived pathways are "estimated" even when using fallback probability,
  // because they represent LLM-reasoned mechanisms, not synthetic padding.
  if (sourceExpansion) {
    for (const pw of sourceExpansion.internal_pathways) {
      const srcNode = sourceScMap.get(pw.source_id);
      const tgtNode = sourceScMap.get(pw.target_id);
      if (!srcNode || !tgtNode) continue;
      const probability = pw.probability ?? 0.7;
      const strength = pw.strength ?? 0.6;
      edges.push({
        source_id: srcNode,
        target_id: tgtNode,
        probability,
        probability_source: "estimated",
        conditions: pw.conditions,
        dynamics: pw.dynamics ?? "sequential",
        mechanism: pw.mechanism,
        strength,
        failure_mode: pw.failure_mode,
        edge_type: "internal_pathway",
      });
    }
  }

  // ── Step 4: Copy internal pathways from target ──
  if (targetExpansion) {
    for (const pw of targetExpansion.internal_pathways) {
      const srcNode = targetScMap.get(pw.source_id);
      const tgtNode = targetScMap.get(pw.target_id);
      if (!srcNode || !tgtNode) continue;
      const probability = pw.probability ?? 0.7;
      const strength = pw.strength ?? 0.6;
      edges.push({
        source_id: srcNode,
        target_id: tgtNode,
        probability,
        probability_source: "estimated",
        conditions: pw.conditions,
        dynamics: pw.dynamics ?? "sequential",
        mechanism: pw.mechanism,
        strength,
        failure_mode: pw.failure_mode,
        edge_type: "internal_pathway",
      });
    }
  }

  // ── Step 5: Detect cross-entity bridges ──
  const BRIDGE_THRESHOLD = 0.3;
  const sourceScs = sourceExpansion?.sub_components ?? [];
  const targetScs = targetExpansion?.sub_components ?? [];

  for (const [sIdx, scA] of sourceScs.entries()) {
    for (const [tIdx, scB] of targetScs.entries()) {
      const { score, mechanism } = scoreCrossEntitySimilarity(scA, scB);
      if (score >= BRIDGE_THRESHOLD) {
        const scAId = scA.id ?? `SC${sIdx + 1}`;
        const scBId = scB.id ?? `SC${tIdx + 1}`;
        const srcNode = sourceScMap.get(scAId);
        const tgtNode = targetScMap.get(scBId);
        if (!srcNode || !tgtNode) continue;
        edges.push({
          source_id: srcNode,
          target_id: tgtNode,
          probability: score,
          probability_source: "estimated",
          conditions: null,
          dynamics: "conditional",
          mechanism,
          strength: score,
          failure_mode: null,
          edge_type: "cross_entity_bridge",
        });
      }
    }
  }

  // ── Step 5b: Guarantee at least one cross-entity bridge ──
  // If similarity-based bridge detection found nothing, create a default bridge
  // using the original graph edge's confidence/strength. Without this, the critical
  // path algorithm finds no route from source-side to target-side → 0% probability.
  const hasCrossEntityBridge = edges.some((e) => e.edge_type === "cross_entity_bridge");
  if (!hasCrossEntityBridge && sourceScMap.size > 0 && targetScMap.size > 0) {
    // Pick the "best" source and target nodes:
    // - prefer nodes with highest importance, or first available
    const importanceOrder = ["critical", "important", "moderate", "minor"];
    const sortByImportance = (a: ProbabilityNode, b: ProbabilityNode) => {
      const aIdx = importanceOrder.indexOf(a.importance ?? "moderate");
      const bIdx = importanceOrder.indexOf(b.importance ?? "moderate");
      return aIdx - bIdx;
    };

    const sourceNodes = nodes
      .filter((n) => n.parent_entity_id === sourceEntity.entity_id && n.type === "sub_component")
      .sort(sortByImportance);
    const targetNodes = nodes
      .filter((n) => n.parent_entity_id === targetEntity.entity_id && n.type === "sub_component")
      .sort(sortByImportance);

    if (sourceNodes.length > 0 && targetNodes.length > 0) {
      // Use the original graph edge's confidence as the bridge probability
      const rawConf = edge.confidence;
      const parsedConf = typeof rawConf === "number" ? rawConf : typeof rawConf === "string" ? parseFloat(rawConf) : NaN;
      const bridgeProb = (!parsedConf || parsedConf <= 0 || isNaN(parsedConf)) ? 0.5 : Math.min(parsedConf, 1);

      const rawStr = edge.strength;
      const parsedStr = typeof rawStr === "number" ? rawStr : typeof rawStr === "string" ? parseFloat(rawStr) : NaN;
      const bridgeStrength = (!parsedStr || parsedStr <= 0 || isNaN(parsedStr)) ? 0.5 : Math.min(parsedStr, 1);

      // Create bridge from best source-side node to best target-side node
      edges.push({
        source_id: sourceNodes[0].id,
        target_id: targetNodes[0].id,
        probability: bridgeProb,
        probability_source: "estimated",
        conditions: null,
        dynamics: "conditional",
        mechanism: null, // No fabricated mechanism — LLM pathway analyzer handles honest labeling
        strength: bridgeStrength,
        failure_mode: null,
        edge_type: "cross_entity_bridge",
      });

      // If there are multiple important nodes, add a second bridge for path diversity
      if (sourceNodes.length > 1 && targetNodes.length > 1) {
        edges.push({
          source_id: sourceNodes[1].id,
          target_id: targetNodes[0].id,
          probability: bridgeProb * 0.8,
          probability_source: "estimated",
          conditions: null,
          dynamics: "conditional",
          mechanism: null, // No fabricated mechanism for secondary bridges
          strength: bridgeStrength * 0.8,
          failure_mode: null,
          edge_type: "cross_entity_bridge",
        });
      }
    }
  }

  // ── Step 6: Add condition gates from edge conditions ──
  if (edgeConditions) {
    for (const [idx, cond] of edgeConditions.entries()) {
      const condNodeId = `PS_${edgeId}_COND_${idx}`;
      nodes.push({
        id: condNodeId,
        name: cond.condition_description,
        type: "condition",
        parent_entity_id: cond.internal_entity_id,
        controllability: cond.controllability,
        probability: cond.probability,
      });

      // Wire condition to nearest source-side node (first available)
      const nearestSource = nodes.find((n) => n.parent_entity_id === sourceEntity.entity_id && n.type === "sub_component");
      const nearestTarget = nodes.find((n) => n.parent_entity_id === targetEntity.entity_id && n.type === "sub_component");
      if (nearestSource) {
        edges.push({
          source_id: nearestSource.id,
          target_id: condNodeId,
          probability: cond.probability,
          probability_source: "estimated",
          conditions: cond.when_active,
          dynamics: "conditional",
          mechanism: `Condition: ${cond.condition_description}`,
          strength: cond.probability,
          edge_type: "condition_gate",
        });
      }
      if (nearestTarget) {
        edges.push({
          source_id: condNodeId,
          target_id: nearestTarget.id,
          probability: cond.probability,
          probability_source: "estimated",
          conditions: cond.when_active,
          dynamics: "conditional",
          mechanism: `${cond.condition_type}: ${cond.condition_description}`,
          strength: cond.probability,
          edge_type: "condition_gate",
        });
      }
    }
  }

  // ── Step 7: Add mediator nodes from internal dynamics ──
  const allExpansions = [
    { exp: sourceExpansion, prefix: "S", scMap: sourceScMap, entityId: sourceEntity.entity_id },
    { exp: targetExpansion, prefix: "T", scMap: targetScMap, entityId: targetEntity.entity_id },
  ];

  for (const { exp, prefix, scMap, entityId } of allExpansions) {
    if (!exp) continue;
    for (const [idx, dyn] of exp.internal_dynamics.entries()) {
      if (dyn.type === "gate" || dyn.type === "bottleneck") {
        const mediatorId = `PS_${edgeId}_${prefix}_MED_${idx}`;
        nodes.push({
          id: mediatorId,
          name: dyn.description,
          type: "mediator",
          parent_entity_id: entityId,
          importance: dyn.type === "bottleneck" ? "critical" : "important",
        });
        // Wire mediator to its component IDs
        for (const compId of dyn.component_ids) {
          const mappedId = scMap.get(compId);
          if (mappedId) {
            edges.push({
              source_id: mappedId,
              target_id: mediatorId,
              probability: 0.8,
              probability_source: "default",
              dynamics: "sequential",
              mechanism: `${dyn.type}: ${dyn.description}`,
              strength: 0.7,
              edge_type: "internal_pathway",
            });
          }
        }
      }
    }
  }

  // ── Step 8: Compute critical path ──
  const { path: criticalPath, probability: pathProb } = computeCriticalPath(
    nodes,
    edges,
    sourceEntity.entity_id,
    targetEntity.entity_id
  );

  // ── Step 9: Identify failure points ──
  const failurePoints: FailurePoint[] = [];
  const criticalPathSet = new Set(criticalPath);
  for (const e of edges) {
    if (e.failure_mode) {
      const node = nodes.find((n) => n.id === e.target_id);
      // Count downstream nodes via BFS to determine blast radius
      const downstream = countDownstream(e.target_id, edges);
      const blastRadius = classifyBlastRadius({
        failingNodeId: e.target_id,
        edges,
        nodes,
        criticalPathSet,
        downstreamCount: downstream,
        goalEntityIds,
      });
      failurePoints.push({
        node_id: e.target_id,
        node_name: node?.name ?? e.target_id,
        failure_mode: e.failure_mode,
        failure_probability: 1 - (e.probability ?? 0.7),
        blast_radius: blastRadius.radius,
        goal_aware: blastRadius.goalAware,
        classification_rationale: blastRadius.rationale,
      });
    }
  }

  // ── Step 10: Collect conditions summary ──
  const conditionsSummary = edges
    .filter((e) => e.conditions)
    .map((e) => e.conditions!)
    .filter((c, i, arr) => arr.indexOf(c) === i)
    .slice(0, 5);

  // ── Step 11: Find alternative paths ──
  const critPathSet = new Set(criticalPath);
  const altEdges = edges.filter((e) => !critPathSet.has(e.source_id) || !critPathSet.has(e.target_id));
  const altPath = computeCriticalPath(nodes, altEdges.length > 0 ? altEdges : edges, sourceEntity.entity_id, targetEntity.entity_id);
  const alternativePaths = altPath.path.length > 0 && altPath.path.join(",") !== criticalPath.join(",")
    ? [altPath.path]
    : [];

  const spaceId = `pspace_${edgeId}`;

  return {
    id: spaceId,
    edge_id: edge.id ?? `${edge.source_entity_id}_${edge.target_entity_id}`,
    source_entity_id: sourceEntity.entity_id,
    target_entity_id: targetEntity.entity_id,
    source_entity_name: sourceEntity.name,
    target_entity_name: targetEntity.name,
    nodes,
    edges,
    total_pathway_probability: pathProb,
    quality_tier: deriveSpaceQualityTier(spaceId, edges),
    critical_path: criticalPath,
    alternative_paths: alternativePaths,
    failure_points: failurePoints,
    conditions_summary: conditionsSummary,
    computed_at: new Date().toISOString(),
  };
}

// ── Compute critical path (modified Dijkstra with probability weights) ──

export function computeCriticalPath(
  nodes: ProbabilityNode[],
  edges: ProbabilityEdge[],
  sourceEntityId: string,
  targetEntityId: string
): { path: string[]; probability: number } {
  // Start nodes = source-side sub-components with no incoming cross-entity edges
  const sourceNodes = nodes.filter((n) => n.parent_entity_id === sourceEntityId);
  const targetNodes = nodes.filter((n) => n.parent_entity_id === targetEntityId);

  if (sourceNodes.length === 0 || targetNodes.length === 0) {
    return { path: [], probability: 0 };
  }

  // Build adjacency list
  const adj = new Map<string, Array<{ target: string; weight: number; prob: number }>>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }
  for (const e of edges) {
    const weight = e.probability > 0 ? -Math.log(e.probability) : 100;
    adj.get(e.source_id)?.push({ target: e.target_id, weight, prob: e.probability });
  }

  // Dijkstra from each source node, find shortest path to any target node
  let bestPath: string[] = [];
  let bestProb = 0;

  for (const startNode of sourceNodes) {
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const visited = new Set<string>();

    for (const n of nodes) dist.set(n.id, Infinity);
    dist.set(startNode.id, 0);

    for (let iter = 0; iter < nodes.length; iter++) {
      // Find min-dist unvisited
      let minDist = Infinity;
      let minNode = "";
      for (const [nid, d] of dist) {
        if (!visited.has(nid) && d < minDist) {
          minDist = d;
          minNode = nid;
        }
      }
      if (!minNode) break;
      visited.add(minNode);

      for (const neighbor of adj.get(minNode) ?? []) {
        const alt = minDist + neighbor.weight;
        if (alt < (dist.get(neighbor.target) ?? Infinity)) {
          dist.set(neighbor.target, alt);
          prev.set(neighbor.target, minNode);
        }
      }
    }

    // Check all target nodes
    for (const endNode of targetNodes) {
      const d = dist.get(endNode.id) ?? Infinity;
      if (d < Infinity) {
        const prob = Math.exp(-d);
        if (prob > bestProb) {
          // Reconstruct path
          const path: string[] = [];
          let cur: string | undefined = endNode.id;
          while (cur) {
            path.unshift(cur);
            cur = prev.get(cur);
          }
          bestPath = path;
          bestProb = prob;
        }
      }
    }
  }

  return { path: bestPath, probability: bestProb };
}

// ── Count downstream nodes via BFS ──

function countDownstream(startId: string, edges: ProbabilityEdge[]): number {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const e of edges) {
      if (e.source_id === current && !visited.has(e.target_id)) {
        queue.push(e.target_id);
      }
    }
  }
  return visited.size - 1; // exclude start node
}

// ── Build synthetic probability space from edge metadata only (no expansion data) ──

function buildSyntheticProbabilitySpace(
  edge: Edge,
  sourceEntity: Entity,
  targetEntity: Entity,
  edgeConditions: EdgeCondition[],
  goalEntityIds?: string[]
): ProbabilitySpace | null {
  const edgeId = edge.id;
  // Robustly parse confidence/strength — DB may store as string, null, 0, or number
  const rawConf = edge.confidence;
  const rawStr = edge.strength;
  const parsedConf = typeof rawConf === "number" ? rawConf : typeof rawConf === "string" ? parseFloat(rawConf) : NaN;
  const parsedStr = typeof rawStr === "number" ? rawStr : typeof rawStr === "string" ? parseFloat(rawStr) : NaN;
  // Ensure minimum viable values — 0 or NaN gets a reasonable default
  const confidence = (!parsedConf || parsedConf <= 0 || isNaN(parsedConf)) ? 0.5 : Math.min(parsedConf, 1);
  const strength = (!parsedStr || parsedStr <= 0 || isNaN(parsedStr)) ? 0.5 : Math.min(parsedStr, 1);

  // Create source and target nodes
  const sourceNodeId = `PS_${edgeId}_SRC`;
  const targetNodeId = `PS_${edgeId}_TGT`;

  const nodes: ProbabilityNode[] = [
    {
      id: sourceNodeId,
      name: sourceEntity.name,
      type: "sub_component" as const,
      parent_entity_id: sourceEntity.entity_id,
      probability: confidence,
      importance: sourceEntity.importance === "critical" ? "critical" as const : "important" as const,
    },
    {
      id: targetNodeId,
      name: targetEntity.name,
      type: "sub_component" as const,
      parent_entity_id: targetEntity.entity_id,
      probability: confidence,
      importance: targetEntity.importance === "critical" ? "critical" as const : "important" as const,
    },
  ];

  const probEdges: ProbabilityEdge[] = [
    {
      source_id: sourceNodeId,
      target_id: targetNodeId,
      probability: confidence * strength,
      probability_source: "default" as const,
      conditions: edge.conditions ?? null,
      dynamics: "sequential" as const,
      mechanism: edge.relationship_type ?? "relationship",
      strength,
      failure_mode: confidence < 0.5 ? `Low confidence ${edge.relationship_type} relationship` : null,
      edge_type: "cross_entity_bridge" as const,
    },
  ];

  // Add condition nodes from edge conditions
  for (let i = 0; i < edgeConditions.length; i++) {
    const cond = edgeConditions[i];
    const condNodeId = `PS_${edgeId}_C${i}`;
    nodes.push({
      id: condNodeId,
      name: cond.condition_description || `Condition ${i + 1}`,
      type: "condition" as const,
      parent_entity_id: sourceEntity.entity_id,
      probability: cond.probability,
      controllability: cond.controllability,
    });
  }

  // Add a mediator node for the relationship type
  const mediatorId = `PS_${edgeId}_M`;
  nodes.push({
    id: mediatorId,
    name: `${edge.relationship_type ?? "Connection"} mechanism`,
    type: "mediator" as const,
    parent_entity_id: sourceEntity.entity_id,
    probability: strength,
  });

  probEdges.push(
    {
      source_id: sourceNodeId,
      target_id: mediatorId,
      probability: confidence,
      probability_source: "default" as const,
      dynamics: "sequential" as const,
      mechanism: "drives",
      strength: confidence,
      edge_type: "internal_pathway" as const,
    },
    {
      source_id: mediatorId,
      target_id: targetNodeId,
      probability: strength,
      probability_source: "default" as const,
      dynamics: "sequential" as const,
      mechanism: "produces",
      strength,
      edge_type: "internal_pathway" as const,
    }
  );

  const pathProb = confidence * strength;
  const failurePoints: FailurePoint[] = [];

  if (confidence < 0.7) {
    const confidenceBlastRadius: FailurePoint["blast_radius"] =
      goalEntityIds?.includes(targetEntity.entity_id) || goalEntityIds?.includes(sourceEntity.entity_id)
        ? "systemic"
        : confidence < 0.4
          ? "cascading"
          : "local";
    failurePoints.push({
      node_id: sourceNodeId,
      node_name: sourceEntity.name,
      failure_mode: `${edge.relationship_type} relationship has moderate confidence (${(confidence * 100).toFixed(0)}%)`,
      failure_probability: 1 - confidence,
      blast_radius: confidenceBlastRadius,
      goal_aware: !!goalEntityIds?.length,
      classification_rationale: goalEntityIds?.length
        ? "Goal-aware classification: pathway directly touches a goal-context entity."
        : "No goal context provided; fallback confidence-based blast radius.",
    });
  }

  if (strength < 0.5) {
    failurePoints.push({
      node_id: mediatorId,
      node_name: `${edge.relationship_type ?? "Connection"} mechanism`,
      failure_mode: `Weak relationship strength (${(strength * 100).toFixed(0)}%)`,
      failure_probability: 1 - strength,
      blast_radius: "local" as const,
    });
  }

  return {
    id: `synth_${edgeId}`,
    edge_id: edgeId,
    source_entity_id: sourceEntity.entity_id,
    target_entity_id: targetEntity.entity_id,
    source_entity_name: sourceEntity.name,
    target_entity_name: targetEntity.name,
    nodes,
    edges: probEdges,
    total_pathway_probability: pathProb,
    quality_tier: "speculative",
    critical_path: [sourceNodeId, mediatorId, targetNodeId],
    alternative_paths: [[sourceNodeId, targetNodeId]],
    failure_points: failurePoints,
    conditions_summary: edge.conditions ? [edge.conditions] : [],
    computed_at: new Date().toISOString(),
  };
}

// ── Build probability spaces for all edges in a graph ──

/**
 * Build probability spaces for all eligible edges in the graph.
 *
 * @param graphEdges - All edges to evaluate
 * @param entities - All entities in the graph
 * @param expansionsMap - Optional map of entity_id → expansion table row.
 *   When provided, uses the richer expansion table data instead of provenance-only data.
 *   Keys should be entity_id (not UUID). Values are expansion table rows with
 *   sub_components, internal_pathways, internal_dynamics fields.
 */
export function buildProbabilitySpacesForGraph(
  graphEdges: Edge[],
  entities: Entity[],
  expansionsMap?: Map<string, { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }>,
  goalEntityIds?: string[]
): ProbabilitySpace[] {
  // Build lookups by both entity_id (string like "SUB_x2_...") and UUID (id)
  // Edges reference entities by UUID (entity.id), not entity_id
  const entityByStringId = new Map<string, Entity>();
  const entityByUuid = new Map<string, Entity>();
  for (const e of entities) {
    entityByStringId.set(e.entity_id, e);
    entityByUuid.set(e.id, e);
  }

  const spaces: ProbabilitySpace[] = [];

  for (const edge of graphEdges) {
    // Try UUID lookup first (edges store UUIDs), fall back to string entity_id
    const sourceEntity = entityByUuid.get(edge.source_entity_id) ?? entityByStringId.get(edge.source_entity_id);
    const targetEntity = entityByUuid.get(edge.target_entity_id) ?? entityByStringId.get(edge.target_entity_id);
    if (!sourceEntity || !targetEntity) continue;

    // Prefer expansion table data over provenance-only data
    // expansionsMap may be keyed by UUID (entity.id) or entity_id — try both
    const sourceExp = expansionsMap
      ? extractExpansionDataFromTable(sourceEntity, expansionsMap.get(sourceEntity.id) ?? expansionsMap.get(edge.source_entity_id))
      : extractExpansionData(sourceEntity);
    const targetExp = expansionsMap
      ? extractExpansionDataFromTable(targetEntity, expansionsMap.get(targetEntity.id) ?? expansionsMap.get(edge.target_entity_id))
      : extractExpansionData(targetEntity);

    // Extract edge conditions from edge provenance
    const edgeProv = edge.provenance as Record<string, unknown> | null;
    const edgeConditions = (edgeProv?.edge_conditions ?? []) as EdgeCondition[];

    // If no expansion data at all, synthesize a basic probability space from edge metadata
    if (!sourceExp && !targetExp) {
      const synthSpace = buildSyntheticProbabilitySpace(edge, sourceEntity, targetEntity, edgeConditions, goalEntityIds);
      if (synthSpace) {
        // Compute layer profile for synthetic space
        const srcLayer = sourceEntity.knowledge_layer ?? "internal";
        const tgtLayer = targetEntity.knowledge_layer ?? "internal";
        synthSpace.layer_profile = {
          source_layer: srcLayer,
          target_layer: tgtLayer,
          is_cross_layer: srcLayer !== tgtLayer,
        };
        spaces.push(synthSpace);
      }
      continue;
    }

    const space = buildProbabilitySpace(edge, sourceEntity, targetEntity, sourceExp, targetExp, edgeConditions, goalEntityIds);
    if (space && space.nodes.length > 0) {
      // Compute layer profile for the space
      const srcLayer = sourceEntity.knowledge_layer ?? "internal";
      const tgtLayer = targetEntity.knowledge_layer ?? "internal";
      space.layer_profile = {
        source_layer: srcLayer,
        target_layer: tgtLayer,
        is_cross_layer: srcLayer !== tgtLayer,
      };
      spaces.push(space);
    }
  }

  return spaces;
}

function classifyBlastRadius(params: {
  failingNodeId: string;
  edges: ProbabilityEdge[];
  nodes: ProbabilityNode[];
  criticalPathSet: Set<string>;
  downstreamCount: number;
  goalEntityIds?: string[];
}): {
  radius: FailurePoint["blast_radius"];
  goalAware: boolean;
  rationale: string;
} {
  const {
    failingNodeId,
    edges,
    nodes,
    criticalPathSet,
    downstreamCount,
    goalEntityIds,
  } = params;

  const reachedNodeIds = traverseReachableNodes(failingNodeId, edges);
  const goalSet = new Set(goalEntityIds ?? []);

  const reachesGoal = goalSet.size > 0 && reachedNodeIds.some((nid) => {
    const n = nodes.find((node) => node.id === nid);
    return !!n && goalSet.has(n.parent_entity_id);
  });

  const criticalPathImpactCount = reachedNodeIds.filter((nid) => criticalPathSet.has(nid)).length;
  const failingNodeOnCriticalPath = criticalPathSet.has(failingNodeId);

  // Goal-aware systemic condition
  if (reachesGoal || (goalSet.size > 0 && failingNodeOnCriticalPath)) {
    return {
      radius: "systemic",
      goalAware: true,
      rationale: reachesGoal
        ? "Failure propagation reaches a goal-context entity."
        : "Failing node is on a critical path under goal-context analysis.",
    };
  }

  // Cascading when multiple critical path nodes are impacted
  if (criticalPathImpactCount >= 2) {
    return {
      radius: "cascading",
      goalAware: goalSet.size > 0,
      rationale: "Failure impacts multiple critical-path nodes.",
    };
  }

  // Fallback legacy behavior when goal context is not available
  const legacyRadius = downstreamCount > 5 ? "systemic" : downstreamCount > 2 ? "cascading" : "local";
  return {
    radius: legacyRadius,
    goalAware: false,
    rationale: "No goal-context impact detected; used downstream reach fallback.",
  };
}

function traverseReachableNodes(startId: string, edges: ProbabilityEdge[]): string[] {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const e of edges) {
      if (e.source_id === current && !visited.has(e.target_id)) {
        queue.push(e.target_id);
      }
    }
  }
  return Array.from(visited);
}

/**
 * Baseline diagnostics for probability space quality/coverage.
 *
 * NOTE: `likely_default_probability_edges` is heuristic-only until
 * explicit probability source labeling is introduced.
 */
export function summarizeProbabilitySpaceDiagnostics(spaces: ProbabilitySpace[]): {
  total_spaces: number;
  synthetic_spaces: number;
  synthetic_space_pct: number;
  total_probability_edges: number;
  likely_default_probability_edges: number;
  likely_default_probability_edge_pct: number;
  spaces_with_any_likely_default_probability: number;
} {
  const totalSpaces = spaces.length;
  const syntheticSpaces = spaces.filter((s) => s.id.startsWith("synth_")).length;

  const allEdges = spaces.flatMap((s) => s.edges ?? []);
  const totalProbabilityEdges = allEdges.length;

  // Prefer explicit source labels; fall back to heuristic for older data.
  const hasSourceLabels = allEdges.some((e) => !!e.probability_source);
  const likelyDefaultProbabilityEdges = hasSourceLabels
    ? allEdges.filter((e) => e.probability_source === "default").length
    : allEdges.filter((e) => e.probability === 0.7 || e.probability === 0.5).length;

  const spacesWithAnyLikelyDefaultProbability = spaces.filter((s) =>
    hasSourceLabels
      ? (s.edges ?? []).some((e) => e.probability_source === "default")
      : (s.edges ?? []).some((e) => e.probability === 0.7 || e.probability === 0.5)
  ).length;

  return {
    total_spaces: totalSpaces,
    synthetic_spaces: syntheticSpaces,
    synthetic_space_pct: totalSpaces > 0 ? syntheticSpaces / totalSpaces : 0,
    total_probability_edges: totalProbabilityEdges,
    likely_default_probability_edges: likelyDefaultProbabilityEdges,
    likely_default_probability_edge_pct:
      totalProbabilityEdges > 0 ? likelyDefaultProbabilityEdges / totalProbabilityEdges : 0,
    spaces_with_any_likely_default_probability: spacesWithAnyLikelyDefaultProbability,
  };
}
