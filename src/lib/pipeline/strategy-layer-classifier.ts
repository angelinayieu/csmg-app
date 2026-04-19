/**
 * Strategy Layer Classifier
 *
 * Tags each probability space and intersection with which strategy layers (L1-L4)
 * it informs. This is the bridge between the flat probability space system and
 * the hierarchical strategy layer architecture.
 *
 * Classification logic:
 *   L1 (Outcomes):  Spaces touching goal/objective entities — tells us about achievability
 *   L2 (Methods):   Multi-step spaces with 4+ nodes — critical paths ARE method chains
 *   L3 (Reasoning): Spaces with multiplier/threshold/feedback dynamics — the WHY logic
 *   L4 (Insights):  High-novelty intersections, hidden/latent nodes, cross-domain bridges
 *
 * A space can be relevant to multiple layers. The primary_layer is the strongest signal.
 */

import type {
  ProbabilitySpace,
  SpaceIntersection,
  StrategyLayer,
  StrategyLayerRelevance,
  StrategyLayerBridge,
} from "@/types/probability-space";
import type { Entity } from "@/types";
import type { SuggestedObjective } from "@/types/goals";

// ── Space Classification ──

export function classifySpaceByStrategyLayer(
  space: ProbabilitySpace,
  goalEntityIds: Set<string>,
  objectiveEntityIds: Set<string>,
  hubEntityIds: Set<string>,
): StrategyLayerRelevance {
  const layers: StrategyLayer[] = [];
  const signals: string[] = [];

  const endpointIds = new Set([space.source_entity_id, space.target_entity_id]);

  // ── L1: Outcome relevance ──
  // Spaces whose endpoints are goal entities or objective targets
  const touchesGoal = [...endpointIds].some((id) => goalEntityIds.has(id));
  const touchesObjective = [...endpointIds].some((id) => objectiveEntityIds.has(id));
  if (touchesGoal) {
    layers.push("L1");
    signals.push("endpoint is a goal entity");
  } else if (touchesObjective) {
    layers.push("L1");
    signals.push("endpoint is an objective target");
  }

  // ── L2: Method chain relevance ──
  // Multi-step spaces with sequential/parallel dynamics = causal chains
  const nodeCount = space.nodes.length;
  const criticalPathLength = space.critical_path.length;
  const hasSequentialDynamics = space.edges.some(
    (e) => e.dynamics === "sequential" || e.dynamics === "parallel"
  );

  if (nodeCount >= 4 && criticalPathLength >= 3) {
    layers.push("L2");
    signals.push(`${nodeCount} nodes, ${criticalPathLength}-step critical path`);
  } else if (nodeCount >= 3 && hasSequentialDynamics && space.alternative_paths.length > 0) {
    layers.push("L2");
    signals.push("multi-step with alternatives");
  }

  // ── L3: Reasoning relevance ──
  // Spaces with multiplier/threshold/feedback dynamics, or systemic failure modes
  const hasCriticalDynamics = space.nodes.some(
    (n) => n.type === "mediator" && (n.importance === "critical" || n.importance === "important")
  );
  const hasSystemicFailure = space.failure_points.some(
    (fp) => fp.blast_radius === "systemic" || fp.blast_radius === "cascading"
  );
  const hasConditionGates = space.edges.some((e) => e.edge_type === "condition_gate");
  const touchesHub = [...endpointIds].some((id) => hubEntityIds.has(id));

  if (hasCriticalDynamics) {
    layers.push("L3");
    signals.push("critical mediator dynamics");
  }
  if (hasSystemicFailure) {
    if (!layers.includes("L3")) layers.push("L3");
    signals.push("systemic/cascading failure mode");
  }
  if (hasConditionGates && touchesHub) {
    if (!layers.includes("L3")) layers.push("L3");
    signals.push("condition-gated hub entity");
  }

  // ── L4: Insight relevance ──
  // Hidden/latent nodes, cross-knowledge-layer spaces, low-probability high-impact
  const hasHiddenNodes = space.nodes.some(
    (n) => n.visibility === "hidden" || n.visibility === "latent"
  );
  const isCrossKnowledgeLayer = space.layer_profile?.is_cross_layer === true;
  const hasLowProbHighImpact = space.failure_points.some(
    (fp) => fp.failure_probability > 0.5 && fp.blast_radius === "systemic"
  );
  const hasUncontrollableNodes = space.nodes.some(
    (n) => n.controllability === "uncontrollable"
  );

  if (hasHiddenNodes) {
    layers.push("L4");
    signals.push("hidden/latent variables present");
  }
  if (isCrossKnowledgeLayer) {
    if (!layers.includes("L4")) layers.push("L4");
    signals.push("crosses knowledge layers");
  }
  if (hasLowProbHighImpact) {
    if (!layers.includes("L4")) layers.push("L4");
    signals.push("low-probability systemic risk (blind spot candidate)");
  }
  if (hasUncontrollableNodes) {
    if (!layers.includes("L4")) layers.push("L4");
    signals.push("uncontrollable variables");
  }

  // ── Default: if no layer assigned, classify by structural complexity ──
  if (layers.length === 0) {
    if (nodeCount >= 3) {
      layers.push("L2");
      signals.push("default: multi-node structure");
    } else {
      layers.push("L3");
      signals.push("default: simple connection (relationship evidence)");
    }
  }

  // ── Primary layer: strongest signal ──
  // Priority: L4 (insights are rarest) > L3 > L2 > L1
  // But if L1 is present, it gets primary when goal-aware (most strategically critical)
  const primary: StrategyLayer = touchesGoal
    ? "L1"
    : layers.includes("L4")
      ? "L4"
      : layers.includes("L3")
        ? "L3"
        : layers.includes("L2")
          ? "L2"
          : "L1";

  return { layers, primary_layer: primary, classification_signals: signals };
}

// ── Intersection Classification ──

export function classifyIntersectionByStrategyLayer(
  intersection: SpaceIntersection,
  spaceA: ProbabilitySpace | undefined,
  spaceB: ProbabilitySpace | undefined,
): StrategyLayerBridge {
  const layersA = spaceA?.strategy_layer_relevance?.layers ?? [];
  const layersB = spaceB?.strategy_layer_relevance?.layers ?? [];

  const allLayers = new Set([...layersA, ...layersB]);
  const layersBridged = Array.from(allLayers).sort() as StrategyLayer[];

  // Determine bridge type
  const isCrossLayer = layersA.length > 0 && layersB.length > 0 &&
    !layersA.some((l) => layersB.includes(l));

  const isHighNovelty = intersection.novelty_score > 0.5;

  let bridge_type: StrategyLayerBridge["bridge_type"];
  if (isCrossLayer) {
    bridge_type = "cross_layer_integration";
  } else if (isHighNovelty) {
    bridge_type = "hidden_connection";
  } else {
    bridge_type = "same_layer_alternative";
  }

  // Primary bridge direction
  const primaryA = spaceA?.strategy_layer_relevance?.primary_layer ?? "L3";
  const primaryB = spaceB?.strategy_layer_relevance?.primary_layer ?? "L3";
  const [higher, lower] = [primaryA, primaryB].sort();
  const primary_bridge = higher === lower ? `${higher}↔${lower}` : `${lower}→${higher}`;

  return { layers_bridged: layersBridged, primary_bridge, bridge_type };
}

// ── Batch Classification ──

export function classifyAllSpacesAndIntersections(params: {
  spaces: ProbabilitySpace[];
  intersections: SpaceIntersection[];
  goalEntityIds: string[];
  objectiveEntityIds: string[];
  hubEntityIds: string[];
}): {
  spaces: ProbabilitySpace[];
  intersections: SpaceIntersection[];
  byLayer: Record<StrategyLayer, ProbabilitySpace[]>;
  intersectionsByBridge: Record<string, SpaceIntersection[]>;
} {
  const goalSet = new Set(params.goalEntityIds);
  const objSet = new Set(params.objectiveEntityIds);
  const hubSet = new Set(params.hubEntityIds);

  // Classify spaces
  for (const space of params.spaces) {
    space.strategy_layer_relevance = classifySpaceByStrategyLayer(
      space, goalSet, objSet, hubSet
    );
  }

  // Build space lookup for intersection classification
  const spaceMap = new Map(params.spaces.map((s) => [s.id, s]));

  // Classify intersections
  for (const inter of params.intersections) {
    const spaceA = spaceMap.get(inter.space_a_id);
    const spaceB = spaceMap.get(inter.space_b_id);
    inter.strategy_layer_bridge = classifyIntersectionByStrategyLayer(inter, spaceA, spaceB);
  }

  // Group by layer
  const byLayer: Record<StrategyLayer, ProbabilitySpace[]> = {
    L1: [], L2: [], L3: [], L4: [],
  };
  for (const space of params.spaces) {
    const primary = space.strategy_layer_relevance?.primary_layer ?? "L3";
    byLayer[primary].push(space);
    // Also add to secondary layers
    for (const layer of space.strategy_layer_relevance?.layers ?? []) {
      if (layer !== primary && !byLayer[layer].includes(space)) {
        byLayer[layer].push(space);
      }
    }
  }

  // Group intersections by bridge type
  const intersectionsByBridge: Record<string, SpaceIntersection[]> = {};
  for (const inter of params.intersections) {
    const key = inter.strategy_layer_bridge?.primary_bridge ?? "unknown";
    if (!intersectionsByBridge[key]) intersectionsByBridge[key] = [];
    intersectionsByBridge[key].push(inter);
  }

  return {
    spaces: params.spaces,
    intersections: params.intersections,
    byLayer,
    intersectionsByBridge,
  };
}

// ── Utility: Extract objective entity IDs ──

export function extractObjectiveEntityIds(
  objectives?: SuggestedObjective[],
): string[] {
  if (!objectives) return [];
  return objectives
    .filter((o) => o.source_entity_id)
    .map((o) => o.source_entity_id!)
    .filter((id, i, arr) => arr.indexOf(id) === i);
}
