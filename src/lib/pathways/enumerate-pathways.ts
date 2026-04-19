/**
 * Pathway enumeration — finds all source→sink paths through an entity's
 * internal structure and scores them by cumulative probability.
 *
 * This is the "combinatorial space" the user described: given N sub-components
 * connected by M pathways, enumerate every way a signal can traverse the
 * structure, so the user can:
 *   1. See the critical path (highest cumulative probability)
 *   2. Inspect alternative paths ranked by probability
 *   3. Identify pathways that share failure points
 *   4. Apply counterfactual probability overrides and watch the ranking shift
 *
 * Pure function — no side effects, no LLM calls. Deterministic given inputs.
 */

import type { SubComponent, InternalPathway, InternalDynamic } from "@/types/expansion";

// ── Types ──

export interface PathwayHop {
  /** Source sub-component id (e.g. "SC1") */
  from: string;
  from_name: string;
  /** Target sub-component id */
  to: string;
  to_name: string;
  /** Probability used for this hop (either raw or overridden) */
  probability: number;
  /** Whether this hop's probability was overridden by a counterfactual */
  overridden: boolean;
  /** Mechanism text from the internal pathway */
  mechanism: string;
  /** Edge dynamics — sequential/parallel/conditional/probabilistic */
  dynamics: InternalPathway["dynamics"];
  /** Failure mode if this hop fails (from pathway) */
  failure_mode: string | null;
  /** Is this hop's target involved in a named internal dynamic (bottleneck / feedback_loop / gate)? */
  dynamic_flags: Array<InternalDynamic["type"]>;
}

export interface EnumeratedPathway {
  /** Stable id built from the sequence of node ids */
  id: string;
  /** Ordered hops from source to sink */
  hops: PathwayHop[];
  /** Entry (first) node id */
  source_id: string;
  /** Exit (last) node id */
  sink_id: string;
  /** Product of hop probabilities */
  cumulative_probability: number;
  /** Minimum hop probability along the path — the weakest link */
  min_hop_probability: number;
  /** Entity ids of nodes flagged with bottleneck or gate dynamics */
  failure_points: string[];
  /** How many distinct internal-dynamics categories this path crosses */
  dynamic_categories_crossed: number;
  /** Importance tier of the most important node on the path */
  max_importance: SubComponent["importance"] | null;
  /** Whether any hop is marked conditional — means path only fires under conditions */
  has_conditional_hop: boolean;
}

export interface PathwayEnumerationResult {
  pathways: EnumeratedPathway[];
  /** The critical path — highest cumulative probability */
  critical_pathway_id: string | null;
  /** Node ids not reachable from any source OR not leading to any sink (orphans) */
  unreachable_node_ids: string[];
  /** Node ids that are both sources (in-degree 0) and sinks (out-degree 0) — disconnected */
  isolated_node_ids: string[];
  /** Total source (root) count */
  source_count: number;
  /** Total sink (leaf) count */
  sink_count: number;
}

export interface EnumerateOptions {
  /** User-supplied probability overrides keyed by "source_id->target_id". Value replaces pathway probability for that hop. */
  probabilityOverrides?: Map<string, number>;
  /** Maximum number of pathways to enumerate (guards against combinatorial explosion on dense DAGs). Default 200. */
  maxPathways?: number;
  /** Cycle guard — maximum hops per path. Default 12. */
  maxPathLength?: number;
}

// ── Public API ──

export function enumeratePathways(
  sub_components: SubComponent[],
  internal_pathways: InternalPathway[],
  internal_dynamics: InternalDynamic[] | undefined,
  options: EnumerateOptions = {},
): PathwayEnumerationResult {
  const maxPathways = options.maxPathways ?? 200;
  const maxPathLength = options.maxPathLength ?? 12;
  const overrides = options.probabilityOverrides ?? new Map<string, number>();

  if (!sub_components || sub_components.length === 0) {
    return {
      pathways: [],
      critical_pathway_id: null,
      unreachable_node_ids: [],
      isolated_node_ids: [],
      source_count: 0,
      sink_count: 0,
    };
  }

  // ── Build adjacency ──
  const subById = new Map<string, SubComponent>();
  for (const sc of sub_components) subById.set(sc.id, sc);

  const outgoing = new Map<string, InternalPathway[]>();
  const inDegree = new Map<string, number>();
  for (const sc of sub_components) {
    outgoing.set(sc.id, []);
    inDegree.set(sc.id, 0);
  }
  for (const pw of internal_pathways ?? []) {
    if (!subById.has(pw.source_id) || !subById.has(pw.target_id)) continue;
    outgoing.get(pw.source_id)!.push(pw);
    inDegree.set(pw.target_id, (inDegree.get(pw.target_id) ?? 0) + 1);
  }

  // Dynamics membership lookup (sub_component id → set of dynamic types it's involved in)
  const dynamicTypesByNode = new Map<string, Set<InternalDynamic["type"]>>();
  for (const dyn of internal_dynamics ?? []) {
    for (const cid of dyn.component_ids ?? []) {
      if (!dynamicTypesByNode.has(cid)) dynamicTypesByNode.set(cid, new Set());
      dynamicTypesByNode.get(cid)!.add(dyn.type);
    }
  }

  // ── Identify sources, sinks, isolated nodes ──
  const sources: string[] = [];
  const sinks: string[] = [];
  const isolated: string[] = [];
  for (const sc of sub_components) {
    const inD = inDegree.get(sc.id) ?? 0;
    const outD = (outgoing.get(sc.id) ?? []).length;
    if (inD === 0 && outD === 0) isolated.push(sc.id);
    else if (inD === 0) sources.push(sc.id);
    else if (outD === 0) sinks.push(sc.id);
  }

  // ── DFS from each source, enumerate paths to any sink ──
  const pathways: EnumeratedPathway[] = [];
  const reachable = new Set<string>();

  function overrideKey(from: string, to: string): string {
    return `${from}->${to}`;
  }

  function getHopProbability(pw: InternalPathway): { probability: number; overridden: boolean } {
    const key = overrideKey(pw.source_id, pw.target_id);
    if (overrides.has(key)) {
      return { probability: overrides.get(key)!, overridden: true };
    }
    return { probability: pw.probability ?? 0.5, overridden: false };
  }

  function toHop(pw: InternalPathway): PathwayHop {
    const { probability, overridden } = getHopProbability(pw);
    const fromNode = subById.get(pw.source_id);
    const toNode = subById.get(pw.target_id);
    const dynamicTypes = dynamicTypesByNode.get(pw.target_id);
    return {
      from: pw.source_id,
      from_name: fromNode?.name ?? pw.source_id,
      to: pw.target_id,
      to_name: toNode?.name ?? pw.target_id,
      probability,
      overridden,
      mechanism: pw.mechanism ?? "",
      dynamics: pw.dynamics,
      failure_mode: pw.failure_mode ?? null,
      dynamic_flags: dynamicTypes ? Array.from(dynamicTypes) : [],
    };
  }

  function dfs(currentNodeId: string, currentPath: PathwayHop[], visited: Set<string>) {
    if (pathways.length >= maxPathways) return;
    if (currentPath.length > maxPathLength) return;

    reachable.add(currentNodeId);

    const outEdges = outgoing.get(currentNodeId) ?? [];

    // Terminal: node is a sink (no outgoing) — record the path
    if (outEdges.length === 0) {
      if (currentPath.length > 0) {
        pathways.push(finalizePath(currentPath));
      }
      return;
    }

    // Non-terminal: also record if we've reached a sink-like state (though our graph DAG should only terminate at out-degree-0)
    for (const edge of outEdges) {
      if (visited.has(edge.target_id)) continue; // cycle guard
      const hop = toHop(edge);
      const nextVisited = new Set(visited);
      nextVisited.add(edge.target_id);
      dfs(edge.target_id, [...currentPath, hop], nextVisited);
    }
  }

  function finalizePath(hops: PathwayHop[]): EnumeratedPathway {
    const sourceId = hops[0].from;
    const sinkId = hops[hops.length - 1].to;
    const cumulative = hops.reduce((acc, h) => acc * h.probability, 1);
    const minHop = hops.reduce((min, h) => Math.min(min, h.probability), 1);
    const failurePoints = new Set<string>();
    const categories = new Set<string>();
    let maxImportance: SubComponent["importance"] | null = null;
    const importanceRank: Record<SubComponent["importance"], number> = {
      critical: 0,
      important: 1,
      moderate: 2,
      minor: 3,
    };
    let hasConditional = false;

    // Include source node in failure-point sweep
    const nodeIds = [sourceId, ...hops.map((h) => h.to)];
    for (const nid of nodeIds) {
      const sc = subById.get(nid);
      if (sc?.importance) {
        if (
          maxImportance === null ||
          importanceRank[sc.importance] < importanceRank[maxImportance]
        ) {
          maxImportance = sc.importance;
        }
      }
      const dyns = dynamicTypesByNode.get(nid);
      if (dyns) {
        for (const d of dyns) {
          categories.add(d);
          if (d === "bottleneck" || d === "gate") failurePoints.add(nid);
        }
      }
    }
    for (const h of hops) {
      if (h.dynamics === "conditional") hasConditional = true;
    }

    const id = `${sourceId}:${hops.map((h) => h.to).join(":")}`;

    return {
      id,
      hops,
      source_id: sourceId,
      sink_id: sinkId,
      cumulative_probability: cumulative,
      min_hop_probability: minHop,
      failure_points: Array.from(failurePoints),
      dynamic_categories_crossed: categories.size,
      max_importance: maxImportance,
      has_conditional_hop: hasConditional,
    };
  }

  for (const srcId of sources) {
    if (pathways.length >= maxPathways) break;
    const visited = new Set<string>();
    visited.add(srcId);
    dfs(srcId, [], visited);
  }

  // Sort by cumulative probability descending — most likely paths first
  pathways.sort((a, b) => b.cumulative_probability - a.cumulative_probability);

  const criticalPathwayId = pathways[0]?.id ?? null;

  // Unreachable = nodes we never touched during DFS
  const unreachable: string[] = [];
  for (const sc of sub_components) {
    if (!reachable.has(sc.id) && !isolated.includes(sc.id)) {
      unreachable.push(sc.id);
    }
  }

  return {
    pathways,
    critical_pathway_id: criticalPathwayId,
    unreachable_node_ids: unreachable,
    isolated_node_ids: isolated,
    source_count: sources.length,
    sink_count: sinks.length,
  };
}
