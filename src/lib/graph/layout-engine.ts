/**
 * Multi-layout engine for the knowledge graph.
 *
 * Supports:
 * - "force"       — D3 force-directed (current default, good for networks/ecosystems)
 * - "flowchart"   — Dagre left-to-right (processes, methodologies, sequential flows)
 * - "hierarchy"   — Dagre top-to-bottom (org charts, decision trees, taxonomies)
 * - "causal"      — Dagre left-to-right with causal edge filtering
 *
 * The layout engine computes static positions for Dagre layouts.
 * Force layout is handled by D3 simulation directly in SpaceGraph.
 */

import dagre from "@dagrejs/dagre";
import type { Entity, Edge } from "@/types";
import type { EntityScores, Tier } from "./compute-entity-scores";
import { computeEntityScoresMap } from "./compute-entity-scores";

// ── Types ──

export type LayoutType = "force" | "flowchart" | "hierarchy" | "causal" | "dense" | "map" | "layered" | "sphere" | "dimensional";

export interface LayoutNode {
  id: string; // entity UUID
  entityId: string; // entity_id (C1, X2, etc.)
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: Map<string, LayoutNode>;
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Horizontal separation between ranks (Dagre) */
  rankSep?: number;
  /** Vertical separation between nodes in same rank */
  nodeSep?: number;
  /** Margins around the graph */
  marginX?: number;
  marginY?: number;
  /** Node width for layout calculation */
  nodeWidth?: number;
  /** Node height for layout calculation */
  nodeHeight?: number;
  /** ID of expanded node (gets larger height) */
  expandedNode?: string;
  /** Height of expanded node */
  expandedHeight?: number;
  /** Only include edges of these dimensions */
  visibleDimensions?: Set<string>;
}

// ── Visualization type inference ──

/**
 * Infer the best visualization type from entity/edge structure.
 * Uses heuristics on edge dimensions, entity categories, and graph topology.
 */
export function inferVisualizationType(
  entities: Entity[],
  edges: Edge[],
): { primary: LayoutType; secondary: LayoutType; reasoning: string } {
  if (entities.length === 0) {
    return { primary: "force", secondary: "force", reasoning: "No entities" };
  }

  // Count edge dimensions
  const dimCounts: Record<string, number> = {};
  for (const e of edges) {
    dimCounts[e.dimension] = (dimCounts[e.dimension] ?? 0) + 1;
  }
  const totalEdges = edges.length || 1;

  const temporalRatio = (dimCounts["temporal"] ?? 0) / totalEdges;
  const causalRatio = (dimCounts["causal"] ?? 0) / totalEdges;
  const functionalRatio = (dimCounts["functional"] ?? 0) / totalEdges;

  // Count entity categories
  const catCounts: Record<string, number> = {};
  for (const e of entities) {
    catCounts[e.entity_category] = (catCounts[e.entity_category] ?? 0) + 1;
  }
  const processRatio = (catCounts["process"] ?? 0) / entities.length;

  // Check for sequential topology (long chains, few branches)
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const e of edges) {
    outDegree.set(e.source_entity_id, (outDegree.get(e.source_entity_id) ?? 0) + 1);
    inDegree.set(e.target_entity_id, (inDegree.get(e.target_entity_id) ?? 0) + 1);
  }
  // Roots: entities with no incoming edges
  const roots = entities.filter((e) => !inDegree.has(e.id) || inDegree.get(e.id) === 0);
  // Leaves: entities with no outgoing edges
  const leaves = entities.filter((e) => !outDegree.has(e.id) || outDegree.get(e.id) === 0);
  // Chain-like: most nodes have in-degree 1 and out-degree 1
  const chainNodes = entities.filter(
    (e) => (inDegree.get(e.id) ?? 0) <= 1 && (outDegree.get(e.id) ?? 0) <= 1
  );
  const chainRatio = chainNodes.length / entities.length;

  // Decision logic
  if (processRatio > 0.3 || (temporalRatio > 0.3 && chainRatio > 0.5)) {
    return {
      primary: "flowchart",
      secondary: "force",
      reasoning: `${Math.round(processRatio * 100)}% process entities, ${Math.round(temporalRatio * 100)}% temporal edges — sequential content`,
    };
  }

  if (causalRatio > 0.4) {
    return {
      primary: "causal",
      secondary: "force",
      reasoning: `${Math.round(causalRatio * 100)}% causal edges — cause-effect structure`,
    };
  }

  if (roots.length <= 2 && leaves.length >= 3 && chainRatio > 0.4) {
    return {
      primary: "hierarchy",
      secondary: "force",
      reasoning: `${roots.length} root(s), ${leaves.length} leaves — tree-like structure`,
    };
  }

  // Default: force-directed network
  return {
    primary: "force",
    secondary: "flowchart",
    reasoning: "Interconnected network — force-directed best preserves relationships",
  };
}

// ── Dagre layout computation ──

/**
 * Compute node positions using Dagre for directed graph layouts.
 * Works for flowchart, hierarchy, and causal layouts.
 */
export function computeDagreLayout(
  entities: Entity[],
  edges: Edge[],
  layoutType: "flowchart" | "hierarchy" | "causal",
  options: LayoutOptions = {},
): LayoutResult {
  const {
    rankSep = layoutType === "flowchart" ? 100 : 80,
    nodeSep = 60,
    marginX = 40,
    marginY = 40,
    nodeWidth = 50,
    nodeHeight = 50,
    expandedNode,
    expandedHeight = 400,
    visibleDimensions,
  } = options;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: layoutType === "hierarchy" ? "TB" : "LR",
    ranksep: rankSep,
    nodesep: nodeSep,
    marginx: marginX,
    marginy: marginY,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  for (const entity of entities) {
    const isExpanded = entity.id === expandedNode;
    g.setNode(entity.id, {
      width: nodeWidth,
      height: isExpanded ? expandedHeight : nodeHeight,
      entityId: entity.entity_id,
    });
  }

  // Build entity UUID set for edge filtering
  const entityIds = new Set(entities.map((e) => e.id));

  // Add edges (filtered)
  for (const edge of edges) {
    // Skip edges not connecting visible entities
    if (!entityIds.has(edge.source_entity_id) || !entityIds.has(edge.target_entity_id)) continue;

    // Dimension filter
    if (visibleDimensions && !visibleDimensions.has(edge.dimension)) continue;

    // For causal layout, only include causal + functional + temporal edges
    if (layoutType === "causal") {
      if (!["causal", "functional", "temporal"].includes(edge.dimension)) continue;
    }

    g.setEdge(edge.source_entity_id, edge.target_entity_id);
  }

  // Run layout
  dagre.layout(g);

  // Extract positions
  const nodeMap = new Map<string, LayoutNode>();
  for (const nodeId of g.nodes()) {
    const node = g.node(nodeId);
    if (node) {
      nodeMap.set(nodeId, {
        id: nodeId,
        entityId: (node as Record<string, unknown>).entityId as string ?? "",
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      });
    }
  }

  const graphInfo = g.graph();
  return {
    nodes: nodeMap,
    width: (graphInfo.width ?? 800) + marginX * 2,
    height: (graphInfo.height ?? 600) + marginY * 2,
  };
}

// ── Map (Constellation) layout ──

export interface TerritoryInfo {
  category: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  nodeIds: string[];
  label: string;
}

export interface MapLayoutResult extends LayoutResult {
  territories: TerritoryInfo[];
}

const categoryLabelsMap: Record<string, string> = {
  concrete: "Concrete",
  abstract: "Abstract",
  process: "Process",
  relational: "Relational",
  epistemic: "Epistemic",
};

const importanceTierOrder: Record<string, number> = {
  fundamental: 0,
  critical: 1,
  important: 2,
  moderate: 3,
};

/**
 * Compute constellation map layout.
 * Groups entities by category into territories, positions by importance tier in concentric orbits.
 */
export function computeMapLayout(
  entities: Entity[],
  edges: Edge[],
  options: { width?: number; height?: number; visibleDimensions?: Set<string> } = {},
): MapLayoutResult {
  const { width = 1200, height = 800 } = options;
  const cx = width / 2;
  const cy = height / 2;

  // Group entities by category
  const groups = new Map<string, Entity[]>();
  for (const e of entities) {
    const cat = e.entity_category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(e);
  }

  const categoryKeys = Array.from(groups.keys());
  const numCategories = categoryKeys.length;
  if (numCategories === 0) {
    return { nodes: new Map(), width, height, territories: [] };
  }

  // Distribute territory centers evenly in a circle
  const orbitRadius = Math.min(width, height) * 0.3;
  const territoryCenters = new Map<string, { x: number; y: number }>();
  categoryKeys.forEach((cat, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / numCategories;
    territoryCenters.set(cat, {
      x: cx + Math.cos(angle) * orbitRadius,
      y: cy + Math.sin(angle) * orbitRadius,
    });
  });

  const nodeMap = new Map<string, LayoutNode>();
  const territories: TerritoryInfo[] = [];

  // Position nodes within each territory by importance tier
  for (const [cat, catEntities] of groups) {
    const center = territoryCenters.get(cat)!;
    const nodeIds: string[] = [];

    // Sort by importance tier
    const sorted = [...catEntities].sort((a, b) => {
      const aT = importanceTierOrder[a.importance ?? "moderate"] ?? 3;
      const bT = importanceTierOrder[b.importance ?? "moderate"] ?? 3;
      return aT - bT;
    });

    // Scale territory radius by member count
    const maxR = Math.min(width, height) * 0.18;
    const territoryR = maxR * Math.min(1, Math.sqrt(sorted.length / 8));

    let maxNodeDist = 0;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const tier = importanceTierOrder[e.importance ?? "moderate"] ?? 3;

      // Concentric orbits: tier 0 at center, tier 3 at edge
      const orbitFraction = tier / 3;
      const r = orbitFraction * territoryR;

      // Distribute nodes within the same tier around the orbit
      const sameTier = sorted.filter(
        s => (importanceTierOrder[s.importance ?? "moderate"] ?? 3) === tier
      );
      const idx = sameTier.indexOf(e);
      const spread = sameTier.length > 1
        ? (2 * Math.PI) / sameTier.length
        : 0;
      const baseAngle = -Math.PI / 2;
      const angle = baseAngle + idx * spread;

      const nx = center.x + Math.cos(angle) * r;
      const ny = center.y + Math.sin(angle) * r;
      const dist = Math.sqrt((nx - center.x) ** 2 + (ny - center.y) ** 2);
      if (dist > maxNodeDist) maxNodeDist = dist;

      nodeMap.set(e.id, {
        id: e.id,
        entityId: e.entity_id,
        x: nx,
        y: ny,
        width: 50,
        height: 50,
      });
      nodeIds.push(e.id);
    }

    territories.push({
      category: cat,
      cx: center.x,
      cy: center.y,
      rx: Math.max(maxNodeDist + 50, 60),
      ry: Math.max(maxNodeDist + 50, 60),
      nodeIds,
      label: categoryLabelsMap[cat] ?? cat,
    });
  }

  return { nodes: nodeMap, width, height, territories };
}

// ── Layered (Hierarchical Decomposition) layout ──

export interface LaneInfo {
  /** Legacy field — mapped from tier (L1→fundamental, L2→critical, L3→important, L4→moderate). */
  importance: string;
  /** New canonical tier identifier. */
  tier: "L1" | "L2" | "L3" | "L4";
  label: string;
  y: number;
  height: number;
}

export interface ColumnInfo {
  category: string;
  x: number;
  width: number;
  label: string;
}

export interface LayeredLayoutResult extends LayoutResult {
  lanes: LaneInfo[];
  columns: ColumnInfo[];
}

const laneLabels: Record<string, string> = {
  fundamental: "L1 Strategy",
  critical: "L2 Methods",
  important: "L3 Mechanisms",
  moderate: "L4 Atoms",
};

const laneLabelsTier: Record<Tier, string> = {
  L1: "L1 Strategy",
  L2: "L2 Methods",
  L3: "L3 Mechanisms",
  L4: "L4 Atoms",
};

/** Map new tier identifiers to legacy importance strings for backward compatibility. */
const TIER_TO_IMPORTANCE: Record<Tier, string> = {
  L1: "fundamental",
  L2: "critical",
  L3: "important",
  L4: "moderate",
};

/**
 * Infer importance tiers from graph topology when entity importance is homogeneous.
 * Uses BFS from root nodes (no incoming edges) to assign depth-based tiers.
 */
function inferTiersFromTopology(
  entities: Entity[],
  edges: Edge[],
): Map<string, string> {
  const tierMap = new Map<string, string>();
  const tierNames = ["fundamental", "critical", "important", "moderate"];

  // Build adjacency
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();
  const entityIds = new Set(entities.map(e => e.id));

  for (const e of entities) {
    inDegree.set(e.id, 0);
    outDegree.set(e.id, 0);
  }
  for (const edge of edges) {
    if (!entityIds.has(edge.source_entity_id) || !entityIds.has(edge.target_entity_id)) continue;
    inDegree.set(edge.target_entity_id, (inDegree.get(edge.target_entity_id) ?? 0) + 1);
    outDegree.set(edge.source_entity_id, (outDegree.get(edge.source_entity_id) ?? 0) + 1);
    if (!childrenOf.has(edge.source_entity_id)) childrenOf.set(edge.source_entity_id, []);
    childrenOf.get(edge.source_entity_id)!.push(edge.target_entity_id);
  }

  // Classify entities by connectivity
  // TRUE roots: have outgoing edges but no incoming (they feed others)
  // Disconnected: no edges at all → distribute across tiers by degree/type
  const trueRoots: string[] = [];
  const disconnected: string[] = [];
  const connected = new Set<string>();

  for (const e of entities) {
    const inD = inDegree.get(e.id) ?? 0;
    const outD = outDegree.get(e.id) ?? 0;
    if (inD === 0 && outD > 0) {
      trueRoots.push(e.id);
      connected.add(e.id);
    } else if (inD === 0 && outD === 0) {
      disconnected.push(e.id);
    } else {
      connected.add(e.id);
    }
  }

  // BFS from true roots only
  const visited = new Set<string>();
  let currentLevel = trueRoots;
  let depth = 0;

  while (currentLevel.length > 0 && depth < 4) {
    const tier = tierNames[Math.min(depth, 3)];
    const nextLevel: string[] = [];
    for (const id of currentLevel) {
      if (visited.has(id)) continue;
      visited.add(id);
      tierMap.set(id, tier);
      const children = childrenOf.get(id) ?? [];
      for (const child of children) {
        if (!visited.has(child)) nextLevel.push(child);
      }
    }
    currentLevel = nextLevel;
    depth++;
  }

  // Connected entities not reached by BFS (in cycles) → important (L3)
  for (const e of entities) {
    if (connected.has(e.id) && !tierMap.has(e.id)) {
      tierMap.set(e.id, "important");
    }
  }

  // Distribute disconnected entities across L2-L4 based on entity properties
  // This prevents all disconnected nodes from piling into one tier
  const entityLookup = new Map(entities.map(e => [e.id, e]));
  for (let i = 0; i < disconnected.length; i++) {
    const ent = entityLookup.get(disconnected[i]);
    if (!ent) continue;

    // Use entity_category + position in the list to distribute across tiers
    // Abstract/epistemic → more likely L2 (conceptual methods)
    // Process/relational → more likely L3 (mechanisms)
    // Concrete → more likely L4 (atoms/specifics)
    let tier: string;
    if (ent.entity_category === "abstract" || ent.entity_category === "epistemic") {
      tier = i % 3 === 0 ? "critical" : i % 3 === 1 ? "important" : "moderate";
    } else if (ent.entity_category === "process" || ent.entity_category === "relational") {
      tier = i % 3 === 0 ? "important" : i % 3 === 1 ? "moderate" : "critical";
    } else {
      // concrete and others → spread across L2-L4
      tier = i % 3 === 0 ? "moderate" : i % 3 === 1 ? "important" : "critical";
    }
    tierMap.set(disconnected[i], tier);
  }

  return tierMap;
}

/**
 * Compute layered decomposition layout.
 * Horizontal lanes by importance tier, vertical columns by entity category.
 * When importance data is homogeneous, infers tiers from graph topology (BFS depth).
 */
export function computeLayeredLayout(
  entities: Entity[],
  edges: Edge[],
  options: {
    width?: number;
    height?: number;
    visibleDimensions?: Set<string>;
    /** Pre-computed entity scores. If not provided, computed internally. */
    entityScores?: Map<string, EntityScores>;
  } = {},
): LayeredLayoutResult {
  const margin = 60;

  if (entities.length === 0) {
    return { nodes: new Map(), width: 1400, height: 900, lanes: [], columns: [] };
  }

  // Use pre-computed scores when provided; otherwise compute internally (fallback for standalone callers).
  const scores = options.entityScores
    ?? computeEntityScoresMap(entities, edges, options.visibleDimensions);

  function getEntityTier(e: Entity): Tier {
    return scores.get(e.id)?.tier ?? "L4";
  }

  // Determine which tiers and categories are present
  const tiersPresent = new Set<Tier>();
  const catsPresent = new Set<string>();
  for (const e of entities) {
    tiersPresent.add(getEntityTier(e));
    catsPresent.add(e.entity_category);
  }

  const tierOrder: Tier[] = ["L1", "L2", "L3", "L4"];
  const activeTiers = tierOrder.filter(t => tiersPresent.has(t));
  const activeCats = Array.from(catsPresent);

  if (activeTiers.length === 0 || activeCats.length === 0) {
    return { nodes: new Map(), width: 1400, height: 900, lanes: [], columns: [] };
  }

  // Group entities by (tier, category) cell to determine sizing
  const cells = new Map<string, Entity[]>();
  for (const e of entities) {
    const tier = getEntityTier(e);
    const cat = e.entity_category;
    const key = `${tier}:${cat}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(e);
  }

  // Find the max entities in any single cell to determine grid sizing
  let maxCellCount = 0;
  for (const cellEntities of cells.values()) {
    if (cellEntities.length > maxCellCount) maxCellCount = cellEntities.length;
  }

  // Dynamic sizing: expand layout based on entity count
  const nodeSpacing = 65; // px between node centers
  const maxNodesPerRow = Math.max(3, Math.min(12, Math.ceil(Math.sqrt(maxCellCount * 1.5))));
  const maxRowsInCell = Math.ceil(maxCellCount / maxNodesPerRow);

  const colW = Math.max(280, maxNodesPerRow * nodeSpacing + 60);
  const laneH = Math.max(200, maxRowsInCell * nodeSpacing + 100);

  const width = Math.max(options.width ?? 1400, margin * 2 + activeCats.length * colW);
  const height = Math.max(options.height ?? 900, margin * 2 + activeTiers.length * laneH);

  // Compute lane positions (horizontal bands)
  const lanes: LaneInfo[] = activeTiers.map((tier, i) => ({
    tier,
    importance: TIER_TO_IMPORTANCE[tier],
    label: laneLabelsTier[tier],
    y: margin + i * laneH + laneH / 2,
    height: laneH,
  }));

  // Compute column positions (vertical bands)
  const columns: ColumnInfo[] = activeCats.map((cat, i) => ({
    category: cat,
    x: margin + i * colW + colW / 2,
    width: colW,
    label: categoryLabelsMap[cat] ?? cat,
  }));

  // Build lane/column lookup
  const laneMap = new Map<Tier, LaneInfo>(lanes.map(l => [l.tier, l]));
  const colMap = new Map(columns.map(c => [c.category, c]));

  // Position entities within each cell using a grid layout
  const nodeMap = new Map<string, LayoutNode>();
  for (const [key, cellEntities] of cells) {
    const [tier, cat] = key.split(":") as [Tier, string];
    const lane = laneMap.get(tier);
    const col = colMap.get(cat);
    if (!lane || !col) continue;

    const count = cellEntities.length;
    const cols = Math.min(count, maxNodesPerRow);
    const rows = Math.ceil(count / cols);

    // Center the grid within the cell
    const gridW = (cols - 1) * nodeSpacing;
    const gridH = (rows - 1) * nodeSpacing;
    const startX = col.x - gridW / 2;
    const startY = lane.y - gridH / 2;

    // Sort by signalStrength DESC (strong signals first), then centrality rank as tiebreaker
    const sorted = [...cellEntities].sort((a, b) => {
      const sa = scores.get(a.id)?.signalStrength ?? 0.5;
      const sb = scores.get(b.id)?.signalStrength ?? 0.5;
      if (sb !== sa) return sb - sa;
      return (a.centrality_rank ?? 999) - (b.centrality_rank ?? 999);
    });

    sorted.forEach((e, i) => {
      const row = Math.floor(i / cols);
      const c = i % cols;
      nodeMap.set(e.id, {
        id: e.id,
        entityId: e.entity_id,
        x: startX + c * nodeSpacing,
        y: startY + row * nodeSpacing,
        width: 50,
        height: 50,
      });
    });
  }

  return { nodes: nodeMap, width, height, lanes, columns };
}

// ── Sphere (radial) layout ──

export interface SphereRingInfo {
  dimension: string;
  /** Angle (radians) where this dimension's arc begins */
  startAngle: number;
  /** Angle (radians) where this dimension's arc ends */
  endAngle: number;
  /** Radius of this ring */
  radius: number;
  /** Entity IDs placed on this arc */
  entityIds: string[];
}

export interface SphereLayoutResult extends LayoutResult {
  /** Entity ID of the focus node (center) */
  focusEntityId: string;
  /** Rings grouped by dimension */
  rings: SphereRingInfo[];
  /** Entity IDs NOT connected to focus (rendered dim/outer) */
  unconnectedIds: string[];
}

const DIMENSION_ORDER = [
  "causal",
  "functional",
  "structural",
  "temporal",
  "logical",
  "agentive",
  "correlational",
  "comparative",
  "epistemic",
] as const;

/**
 * Compute sphere-of-connection layout: a focus entity at the center, with
 * directly-connected entities arranged on radial arcs grouped by edge dimension.
 * Reveals the "dominant connections" around a single node in the style of a
 * biology knowledge-graph disease/drug radial view.
 */
export function computeSphereLayout(
  entities: Entity[],
  edges: Edge[],
  options: {
    width?: number;
    height?: number;
    visibleDimensions?: Set<string>;
    /** If not provided, picks entity with highest degree as focus */
    focusEntityId?: string;
  } = {},
): SphereLayoutResult {
  const { width = 1200, height = 900, visibleDimensions } = options;
  const cx = width / 2;
  const cy = height / 2;

  if (entities.length === 0) {
    return {
      nodes: new Map(),
      width,
      height,
      focusEntityId: "",
      rings: [],
      unconnectedIds: [],
    };
  }

  // Determine focus entity: user choice, otherwise highest-degree
  let focus: Entity;
  if (options.focusEntityId) {
    focus = entities.find(e => e.id === options.focusEntityId) ?? entities[0];
  } else {
    const degreeMap = new Map<string, number>();
    for (const e of entities) degreeMap.set(e.id, 0);
    for (const edge of edges) {
      if (visibleDimensions && !visibleDimensions.has(edge.dimension)) continue;
      degreeMap.set(edge.source_entity_id, (degreeMap.get(edge.source_entity_id) ?? 0) + 1);
      degreeMap.set(edge.target_entity_id, (degreeMap.get(edge.target_entity_id) ?? 0) + 1);
    }
    let maxDeg = -1;
    let best = entities[0];
    for (const e of entities) {
      const d = degreeMap.get(e.id) ?? 0;
      if (d > maxDeg) {
        maxDeg = d;
        best = e;
      }
    }
    focus = best;
  }

  // Find direct neighbors grouped by edge dimension (dedupe: one entity → one arc)
  const neighborsByDimension = new Map<string, Map<string, Entity>>();
  const entityById = new Map(entities.map(e => [e.id, e]));
  const connectedIds = new Set<string>();

  for (const edge of edges) {
    if (visibleDimensions && !visibleDimensions.has(edge.dimension)) continue;
    let neighbor: Entity | undefined;
    if (edge.source_entity_id === focus.id) {
      neighbor = entityById.get(edge.target_entity_id);
    } else if (edge.target_entity_id === focus.id) {
      neighbor = entityById.get(edge.source_entity_id);
    }
    if (!neighbor) continue;

    connectedIds.add(neighbor.id);
    if (!neighborsByDimension.has(edge.dimension)) {
      neighborsByDimension.set(edge.dimension, new Map());
    }
    // Only count first-seen (avoid duplicates when multiple edges share dimension)
    if (!neighborsByDimension.get(edge.dimension)!.has(neighbor.id)) {
      neighborsByDimension.get(edge.dimension)!.set(neighbor.id, neighbor);
    }
  }

  // Active dimensions in canonical order
  const activeDims = DIMENSION_ORDER.filter(d => neighborsByDimension.has(d));
  // Append any non-canonical dimensions at the end
  for (const d of neighborsByDimension.keys()) {
    if (!activeDims.includes(d as typeof DIMENSION_ORDER[number])) {
      activeDims.push(d as typeof DIMENSION_ORDER[number]);
    }
  }

  const nodeMap = new Map<string, LayoutNode>();

  // Place focus at center
  nodeMap.set(focus.id, {
    id: focus.id,
    entityId: focus.entity_id,
    x: cx,
    y: cy,
    width: 80,
    height: 80,
  });

  // Compute ring radius based on available space
  const baseRadius = Math.min(width, height) * 0.32;

  const rings: SphereRingInfo[] = [];

  if (activeDims.length > 0) {
    // Allocate arc space proportional to neighbor count (min 15° per dim)
    const minAngle = (Math.PI * 15) / 180;
    const totalNeighbors = activeDims.reduce(
      (sum, d) => sum + neighborsByDimension.get(d)!.size,
      0,
    );
    const availableAngle = 2 * Math.PI - minAngle * activeDims.length;

    let currentAngle = -Math.PI / 2; // start at top

    for (const dim of activeDims) {
      const neighbors = Array.from(neighborsByDimension.get(dim)!.values());
      const arcSpan =
        minAngle +
        (neighbors.length / Math.max(totalNeighbors, 1)) * availableAngle;

      const startAngle = currentAngle;
      const endAngle = currentAngle + arcSpan;

      // Place neighbors evenly across this arc
      const entityIds: string[] = [];
      neighbors.forEach((n, i) => {
        const frac = neighbors.length === 1 ? 0.5 : i / (neighbors.length - 1);
        const angle = startAngle + frac * arcSpan;
        const r = baseRadius;
        nodeMap.set(n.id, {
          id: n.id,
          entityId: n.entity_id,
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          width: 50,
          height: 50,
        });
        entityIds.push(n.id);
      });

      rings.push({
        dimension: dim,
        startAngle,
        endAngle,
        radius: baseRadius,
        entityIds,
      });

      currentAngle = endAngle;
    }
  }

  // Place unconnected entities on outer ring, faded
  const unconnectedIds: string[] = [];
  const outerRadius = baseRadius + 180;
  const unconnected = entities.filter(e => e.id !== focus.id && !connectedIds.has(e.id));
  unconnected.forEach((e, i) => {
    const angle = (i / Math.max(unconnected.length, 1)) * 2 * Math.PI - Math.PI / 2;
    nodeMap.set(e.id, {
      id: e.id,
      entityId: e.entity_id,
      x: cx + Math.cos(angle) * outerRadius,
      y: cy + Math.sin(angle) * outerRadius,
      width: 50,
      height: 50,
    });
    unconnectedIds.push(e.id);
  });

  return {
    nodes: nodeMap,
    width,
    height,
    focusEntityId: focus.id,
    rings,
    unconnectedIds,
  };
}

// ── Layout type metadata ──

export const layoutTypeConfig: Record<LayoutType, {
  label: string;
  icon: string;
  description: string;
}> = {
  force: {
    label: "Network",
    icon: "scatter",
    description: "Force-directed — best for ecosystems and interconnected systems",
  },
  flowchart: {
    label: "Flowchart",
    icon: "arrow-right",
    description: "Left-to-right — best for processes, methodologies, sequential flows",
  },
  hierarchy: {
    label: "Hierarchy",
    icon: "git-branch",
    description: "Top-down — best for org charts, decision trees, taxonomies",
  },
  causal: {
    label: "Causal Flow",
    icon: "trending-up",
    description: "Directed flow — best for cause-effect chains and theories",
  },
  dense: {
    label: "Dense Network",
    icon: "globe",
    description: "Canvas-rendered — best for large graphs with 50+ entities and community clustering",
  },
  map: {
    label: "Map",
    icon: "map",
    description: "Constellation — shows knowledge territories and cross-territory bridges",
  },
  layered: {
    label: "Layered",
    icon: "layers",
    description: "Decomposition lanes — shows hierarchy from strategy to mechanisms",
  },
  sphere: {
    label: "Sphere",
    icon: "target",
    description: "Radial view around a focus node — reveals dominant connections by dimension",
  },
  dimensional: {
    label: "Dimensional",
    icon: "layout",
    description: "Hierarchical bands — systems (3D) above domains (2D) above threads (1D). Children placed under their parent so the composes-spine is visible.",
  },
};

// ── Dimensional layout ──
// Purpose-built for hierarchical graphs (systems → domains → threads). Places
// each layer in its own horizontal band, with children positioned directly
// under their parent so the composes-spine is readable at a glance.
// Non-hierarchical entities (faults, flat-decomposition entities without a
// `layer` value) get their own band below threads.

export interface DimensionalBandInfo {
  layer: "system" | "domain" | "thread" | "fault" | "unassigned";
  label: string;
  y: number;
  height: number;
  entityCount: number;
}

export interface DimensionalLayoutResult extends LayoutResult {
  bands: DimensionalBandInfo[];
}

const DIMENSIONAL_BAND_ORDER: Array<DimensionalBandInfo["layer"]> = [
  "system",
  "domain",
  "thread",
  "fault",
  "unassigned",
];

const DIMENSIONAL_BAND_LABELS: Record<DimensionalBandInfo["layer"], string> = {
  system: "Systems (3D blocks)",
  domain: "Domains (2D surfaces)",
  thread: "Threads (1D lines)",
  fault: "Faults",
  unassigned: "Unassigned",
};

export function computeDimensionalLayout(
  entities: Entity[],
  edges: Edge[],
  options: LayoutOptions = {},
): DimensionalLayoutResult {
  const nodeWidth = options.nodeWidth ?? 160;
  const nodeHeight = options.nodeHeight ?? 56;
  const marginX = options.marginX ?? 60;
  const marginY = options.marginY ?? 40;
  const rowGap = 16; // between band rows
  const colGap = 12; // between nodes in same row
  const bandPadding = 24;

  // Group entities by their band assignment.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bandOf = (e: Entity): DimensionalBandInfo["layer"] => {
    // "fault" category added by migration 20260421 (supabase types not yet regenerated).
    if ((e.entity_category as string) === "fault") return "fault";
    const l = (e.layer ?? "").trim();
    if (l === "system") return "system";
    if (l === "domain") return "domain";
    if (l === "thread") return "thread";
    return "unassigned";
  };

  const byBand = new Map<DimensionalBandInfo["layer"], Entity[]>();
  for (const layer of DIMENSIONAL_BAND_ORDER) byBand.set(layer, []);
  for (const e of entities) {
    byBand.get(bandOf(e))!.push(e);
  }

  // Build parent map: entity UUID → parent entity UUID (from composes edges).
  // We prefer edge-derived parents over provenance so the layout reflects the
  // graph as-stored, even if provenance was lost.
  const parentFromEdge = new Map<string, string>();
  for (const edge of edges) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isComposes = (edge as any).topology === "composes" || edge.relationship_type === "has_component";
    if (!isComposes) continue;
    // source composes target → parent is source
    if (!parentFromEdge.has(edge.target_entity_id)) {
      parentFromEdge.set(edge.target_entity_id, edge.source_entity_id);
    }
  }

  // Within each band, order children so that entities sharing a parent are
  // adjacent. We do this by sorting on parent's existing position in the
  // previous band (or by parent UUID as a stable secondary).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentOf = (e: Entity): string | undefined =>
    parentFromEdge.get(e.id) ?? ((e as unknown as { parent_entity_id?: string }).parent_entity_id);

  // Compute band widths. Each band is [N × (nodeWidth + colGap)] wide.
  const bands: DimensionalBandInfo[] = [];
  const nodes = new Map<string, LayoutNode>();
  let currentY = marginY;
  let maxWidth = 0;

  // Store parent → array of children positions so next band can align.
  const parentXByUuid = new Map<string, number>();

  for (const layer of DIMENSIONAL_BAND_ORDER) {
    const ents = byBand.get(layer) ?? [];
    if (ents.length === 0) continue;

    // Sort: by parent's X (if known), else alphabetical by name. This groups
    // siblings under their parent when possible.
    const sorted = [...ents].sort((a, b) => {
      const pa = parentOf(a);
      const pb = parentOf(b);
      const xa = pa ? parentXByUuid.get(pa) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const xb = pb ? parentXByUuid.get(pb) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      if (xa !== xb) return xa - xb;
      return a.name.localeCompare(b.name);
    });

    // For child bands with known parents, cluster children under their parent.
    // We do this by computing each parent's child count, then laying out
    // children centered under the parent position.
    const parentToChildren = new Map<string, Entity[]>();
    const orphanedInBand: Entity[] = [];
    for (const e of sorted) {
      const p = parentOf(e);
      if (p && parentXByUuid.has(p)) {
        const arr = parentToChildren.get(p) ?? [];
        arr.push(e);
        parentToChildren.set(p, arr);
      } else {
        orphanedInBand.push(e);
      }
    }

    let cursorX = marginX;
    const placed: Array<{ entity: Entity; x: number }> = [];

    // First: place children grouped under their parents, centered on parent X.
    // Parents already have a position in parentXByUuid from the previous band.
    const parentsInOrder = Array.from(parentToChildren.keys()).sort((a, b) => {
      return (parentXByUuid.get(a) ?? 0) - (parentXByUuid.get(b) ?? 0);
    });

    for (const parentUuid of parentsInOrder) {
      const children = parentToChildren.get(parentUuid)!;
      const clusterWidth = children.length * nodeWidth + (children.length - 1) * colGap;
      const parentX = parentXByUuid.get(parentUuid) ?? cursorX;
      // Ideal leftmost x to center cluster under parent
      let x = parentX - clusterWidth / 2;
      // But don't back up behind the previous cluster
      if (x < cursorX) x = cursorX;

      for (const child of children) {
        placed.push({ entity: child, x });
        x += nodeWidth + colGap;
      }
      cursorX = x;
    }

    // Then: orphaned-in-band entities (those whose parent wasn't placed).
    for (const e of orphanedInBand) {
      placed.push({ entity: e, x: cursorX });
      cursorX += nodeWidth + colGap;
    }

    // Commit positions.
    for (const p of placed) {
      nodes.set(p.entity.id, {
        id: p.entity.id,
        entityId: p.entity.entity_id,
        x: p.x + nodeWidth / 2,
        y: currentY + nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight,
      });
      parentXByUuid.set(p.entity.id, p.x + nodeWidth / 2);
    }

    const bandContentWidth = cursorX;
    maxWidth = Math.max(maxWidth, bandContentWidth + marginX);

    bands.push({
      layer,
      label: DIMENSIONAL_BAND_LABELS[layer],
      y: currentY,
      height: nodeHeight + bandPadding,
      entityCount: ents.length,
    });

    currentY += nodeHeight + rowGap + bandPadding;
  }

  return {
    nodes,
    width: maxWidth,
    height: currentY + marginY,
    bands,
  };
}
