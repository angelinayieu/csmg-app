"use client";

import React, { useRef, useEffect, useMemo, useCallback, useState } from "react";
import * as d3 from "d3";
import type { Entity, Edge } from "@/types";
import type { OrbitalRing, ExternalCategory, EpistemicNodeType, SourceCredibility, IntelligenceSignal } from "@/types/intelligence";
import { RING_CONFIG, CATEGORY_CONFIG } from "@/types/intelligence";
import type { LandscapeCluster } from "@/types/intelligence-v2";
import { EPISTEMIC_CONFIG, EDGE_STYLE_CONFIG, type GraphLayoutMode } from "./graph-filter-rail";
import { cleanEntityName } from "./orbital-graph";
import { cn } from "@/lib/utils";
import { ZoomIn, ZoomOut, Maximize, LocateFixed, Compass, Target, Route } from "lucide-react";

// ── Types ──

interface KGNode extends d3.SimulationNodeDatum {
  id: string;
  entity: Entity;
  ring: OrbitalRing;
  epistemicType: EpistemicNodeType;
  category?: ExternalCategory;
  credibility: SourceCredibility;
  isFloating: boolean;
  nodeRadius: number;
  color: string;
  strokeColor: string;
  label: string;
  sourceCount: number;
  connCount: number;
  clusterId?: string;
  signalSeverity: "high" | "medium" | "low" | null;
  signalCount: number;
  isHub: boolean;
}

interface KGLink extends d3.SimulationLinkDatum<KGNode> {
  edge: Edge;
  isBridge: boolean;
  edgeColor: string;
  dashArray: string;
  weight: number;
}

export type SemanticZoomLevel = 1 | 2 | 3 | 4;
export type GraphInteractionMode = "explore" | "focus" | "path";

interface KnowledgeGraphProps {
  entities: Entity[];
  edges: Edge[];
  entityRingMap: Map<string, OrbitalRing>;
  epistemicTypeMap: Map<string, EpistemicNodeType>;
  credibilityMap: Map<string, SourceCredibility>;
  clusters: LandscapeCluster[];
  floatingEntities: Entity[];
  signals?: IntelligenceSignal[];

  layout: GraphLayoutMode;
  semanticZoom: SemanticZoomLevel;
  taxonomyMode: "epistemic" | "domain";

  visibleEntityIds: Set<string>;
  visibleEdgeTypes: Set<string>;
  minCredibility: number;

  selectedEntityId: string | null;
  focusedEntityId: string | null;
  onNodeClick: (entity: Entity) => void;
  onEdgeClick?: (edge: Edge, source: Entity, target: Entity) => void;
  onBackgroundClick: () => void;
}

// ── Constants ──

const ZOOM_LABELS: Record<SemanticZoomLevel, string> = {
  1: "Macro",
  2: "Cluster",
  3: "Atoms",
  4: "Sources",
};

const MODE_CONFIG: Record<GraphInteractionMode, { label: string; icon: typeof Compass }> = {
  explore: { label: "Explore", icon: Compass },
  focus:   { label: "Focus",   icon: Target },
  path:    { label: "Path",    icon: Route },
};

const DEFAULT_CREDIBILITY: SourceCredibility = {
  source_authority: 0.2,
  claim_corroboration: 0,
  recency: 0.3,
  effective_confidence: 0.2,
};

// ── Color system: SOLID, saturated, high-contrast fills ──
// No more +"28" alpha — fills are visible, strokes are darker variants

const SOLID_EPISTEMIC_COLORS: Record<EpistemicNodeType, { fill: string; stroke: string; hub: string }> = {
  claim:      { fill: "#DBEAFE", stroke: "#2563EB", hub: "#3B82F6" },   // Blue 100 / Blue 600 / Blue 500
  evidence:   { fill: "#D1FAE5", stroke: "#059669", hub: "#10B981" },   // Emerald 100 / Emerald 600 / Emerald 500
  hypothesis: { fill: "#EDE9FE", stroke: "#7C3AED", hub: "#8B5CF6" },   // Violet 100 / Violet 600 / Violet 500
  pattern:    { fill: "#CFFAFE", stroke: "#0891B2", hub: "#06B6D4" },   // Cyan 100 / Cyan 600 / Cyan 500
  question:   { fill: "#FEF3C7", stroke: "#D97706", hub: "#F59E0B" },   // Amber 100 / Amber 600 / Amber 500
  actor:      { fill: "#FEE2E2", stroke: "#DC2626", hub: "#EF4444" },   // Red 100 / Red 600 / Red 500
};

const SOLID_DOMAIN_COLORS: Record<string, { fill: string; stroke: string; hub: string }> = {
  competitor:   { fill: "#FEE2E2", stroke: "#DC2626", hub: "#EF4444" },
  framework:    { fill: "#EDE9FE", stroke: "#7C3AED", hub: "#8B5CF6" },
  pattern:      { fill: "#CFFAFE", stroke: "#0891B2", hub: "#06B6D4" },
  data_point:   { fill: "#DBEAFE", stroke: "#2563EB", hub: "#3B82F6" },
  analogy:      { fill: "#FCE7F3", stroke: "#DB2777", hub: "#EC4899" },
  risk_pattern: { fill: "#FFEDD5", stroke: "#EA580C", hub: "#F97316" },
  resource:     { fill: "#D1FAE5", stroke: "#059669", hub: "#10B981" },
};

const STRUCTURAL_COLORS = {
  leverage:   { fill: "#DBEAFE", stroke: "#1D4ED8", hub: "#2563EB" },
  risk:       { fill: "#FEE2E2", stroke: "#B91C1C", hub: "#DC2626" },
  bottleneck: { fill: "#FFEDD5", stroke: "#C2410C", hub: "#EA580C" },
};

const SIGNAL_RING_COLORS: Record<string, string> = {
  high: "#DC2626",
  medium: "#F59E0B",
  low: "#3B82F6",
};

function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.5) return truncated.slice(0, lastSpace) + "\u2026";
  return truncated + "\u2026";
}

function getEdgeStyle(relType: string | null): { color: string; dash: string } {
  const lower = (relType ?? "").toLowerCase();
  if (lower.includes("support") || lower.includes("enable"))
    return { color: EDGE_STYLE_CONFIG.supports.color, dash: "" };
  if (lower.includes("contradict") || lower.includes("challenge"))
    return { color: EDGE_STYLE_CONFIG.contradicts.color, dash: "6,3" };
  if (lower.includes("cause") || lower.includes("drive"))
    return { color: EDGE_STYLE_CONFIG.causes.color, dash: "" };
  if (lower.includes("depend") || lower.includes("require"))
    return { color: EDGE_STYLE_CONFIG.depends.color, dash: "" };
  if (lower.includes("correlat"))
    return { color: EDGE_STYLE_CONFIG.correlates.color, dash: "3,3" };
  return { color: "#94A3B8", dash: "" }; // Slate 400 instead of gray 300
}

function getNodeColor(
  entity: Entity,
  taxonomyMode: "epistemic" | "domain",
  epistemicType: EpistemicNodeType,
  category?: ExternalCategory,
  isHub?: boolean,
): { fill: string; stroke: string } {
  // Structural role overrides — these are always vivid
  if (entity.is_leverage_point) return isHub ? { fill: STRUCTURAL_COLORS.leverage.hub, stroke: STRUCTURAL_COLORS.leverage.stroke } : { fill: STRUCTURAL_COLORS.leverage.fill, stroke: STRUCTURAL_COLORS.leverage.stroke };
  if (entity.is_risk_point) return isHub ? { fill: STRUCTURAL_COLORS.risk.hub, stroke: STRUCTURAL_COLORS.risk.stroke } : { fill: STRUCTURAL_COLORS.risk.fill, stroke: STRUCTURAL_COLORS.risk.stroke };
  if (entity.is_master_bottleneck) return isHub ? { fill: STRUCTURAL_COLORS.bottleneck.hub, stroke: STRUCTURAL_COLORS.bottleneck.stroke } : { fill: STRUCTURAL_COLORS.bottleneck.fill, stroke: STRUCTURAL_COLORS.bottleneck.stroke };

  if (taxonomyMode === "epistemic") {
    const cfg = SOLID_EPISTEMIC_COLORS[epistemicType];
    return isHub ? { fill: cfg.hub, stroke: cfg.stroke } : { fill: cfg.fill, stroke: cfg.stroke };
  }

  // Domain mode
  if (category && SOLID_DOMAIN_COLORS[category]) {
    const cfg = SOLID_DOMAIN_COLORS[category];
    return isHub ? { fill: cfg.hub, stroke: cfg.stroke } : { fill: cfg.fill, stroke: cfg.stroke };
  }

  // Fallback to epistemic
  const cfg = SOLID_EPISTEMIC_COLORS[epistemicType];
  return isHub ? { fill: cfg.hub, stroke: cfg.stroke } : { fill: cfg.fill, stroke: cfg.stroke };
}

// ── BFS shortest path ──

function bfsPath(adj: Map<string, Set<string>>, start: string, end: string): string[] | null {
  if (start === end) return [start];
  const visited = new Set<string>([start]);
  const queue: Array<{ node: string; path: string[] }> = [{ node: start, path: [start] }];
  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    const neighbors = adj.get(node);
    if (!neighbors) continue;
    for (const nb of neighbors) {
      if (visited.has(nb)) continue;
      const newPath = [...path, nb];
      if (nb === end) return newPath;
      visited.add(nb);
      queue.push({ node: nb, path: newPath });
    }
  }
  return null;
}

// ── Curved edge path generator ──

function curvedEdgePath(sx: number, sy: number, tx: number, ty: number, curvature: number): string {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return `M${sx},${sy}L${tx},${ty}`;
  const dr = dist * curvature;
  return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`;
}

// ── Component ──

export function KnowledgeGraph({
  entities,
  edges,
  entityRingMap,
  epistemicTypeMap,
  credibilityMap,
  clusters,
  floatingEntities,
  signals = [],
  layout,
  semanticZoom,
  taxonomyMode,
  visibleEntityIds,
  visibleEdgeTypes,
  minCredibility,
  selectedEntityId,
  focusedEntityId,
  onNodeClick,
  onEdgeClick,
  onBackgroundClick,
}: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<KGNode, KGLink> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [interactionMode, setInteractionMode] = useState<GraphInteractionMode>("explore");
  const [pathStart, setPathStart] = useState<string | null>(null);
  const [pathEnd, setPathEnd] = useState<string | null>(null);

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  const floatingSet = useMemo(
    () => new Set(floatingEntities.map((e) => e.entity_id)),
    [floatingEntities]
  );

  // ── Signal map: entity_id → highest severity + count ──
  const signalMap = useMemo(() => {
    const m = new Map<string, { severity: "high" | "medium" | "low"; count: number }>();
    for (const s of signals) {
      if (s.status === "dismissed" || s.status === "resolved") continue;
      const existing = m.get(s.entity_id);
      const sev = s.severity ?? "low";
      if (!existing) {
        m.set(s.entity_id, { severity: sev, count: 1 });
      } else {
        existing.count++;
        // Escalate severity
        if (sev === "high" || (sev === "medium" && existing.severity === "low")) {
          existing.severity = sev;
        }
      }
      // Also tag related internal entities
      for (const relId of s.related_internal_entities ?? []) {
        const re = m.get(relId);
        if (!re) {
          m.set(relId, { severity: sev, count: 1 });
        } else {
          re.count++;
          if (sev === "high" || (sev === "medium" && re.severity === "low")) {
            re.severity = sev;
          }
        }
      }
    }
    return m;
  }, [signals]);

  // ── Build adjacency map ──
  const adjacencyMap = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const edge of edges) {
      const srcEnt = entities.find((e) => e.id === edge.source_entity_id || e.entity_id === edge.source_entity_id);
      const tgtEnt = entities.find((e) => e.id === edge.target_entity_id || e.entity_id === edge.target_entity_id);
      if (!srcEnt || !tgtEnt) continue;
      const sid = srcEnt.entity_id;
      const tid = tgtEnt.entity_id;
      if (!adj.has(sid)) adj.set(sid, new Set());
      if (!adj.has(tid)) adj.set(tid, new Set());
      adj.get(sid)!.add(tid);
      adj.get(tid)!.add(sid);
    }
    return adj;
  }, [entities, edges]);

  // ── Path highlight ──
  const pathHighlightSet = useMemo(() => {
    if (interactionMode !== "path" || !pathStart || !pathEnd) return new Set<string>();
    const path = bfsPath(adjacencyMap, pathStart, pathEnd);
    return path ? new Set(path) : new Set<string>();
  }, [interactionMode, pathStart, pathEnd, adjacencyMap]);

  const pathEdgeSet = useMemo(() => {
    if (pathHighlightSet.size < 2) return new Set<string>();
    const pathArr = Array.from(pathHighlightSet);
    const edgeKeys = new Set<string>();
    for (let i = 0; i < pathArr.length - 1; i++) {
      edgeKeys.add(`${pathArr[i]}→${pathArr[i + 1]}`);
      edgeKeys.add(`${pathArr[i + 1]}→${pathArr[i]}`);
    }
    return edgeKeys;
  }, [pathHighlightSet]);

  // ── Entity map ──
  const entityMap = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const e of entities) {
      m.set(e.entity_id, e);
      m.set(e.id, e);
    }
    return m;
  }, [entities]);

  // ── Cluster maps ──
  const entityClusterMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clusters) {
      for (const eid of c.entity_ids) {
        m.set(eid, c.id ?? c.label);
      }
    }
    return m;
  }, [clusters]);

  // ── Build nodes & links ──
  const { nodes, links } = useMemo(() => {
    const nodeList: KGNode[] = [];
    const nodeIdSet = new Set<string>();

    for (const e of entities) {
      if (!visibleEntityIds.has(e.entity_id)) continue;
      const cred = credibilityMap.get(e.entity_id) ?? DEFAULT_CREDIBILITY;
      if (cred.effective_confidence < minCredibility) continue;

      const ring = entityRingMap.get(e.entity_id) ?? "landscape";
      const epistemicType = epistemicTypeMap.get(e.entity_id) ?? "claim";
      const prov = e.provenance as Record<string, unknown> | null;
      const cat = prov?.category as ExternalCategory | undefined;
      const isFloat = floatingSet.has(e.entity_id);
      const urls = (prov?.citation_urls as string[]) ?? [];
      const sourceCount = urls.length;

      const importance = e.importance ?? "moderate";
      const connCount = adjacencyMap.get(e.entity_id)?.size ?? 0;
      const isStructuralHub = e.is_leverage_point || e.is_risk_point || e.is_master_bottleneck;
      const isImportanceHub = importance === "fundamental" || importance === "critical";
      const isCoreRing = ring === "core" || ring === "conceptual";
      const isHighConn = connCount >= 4;
      const isHub = isImportanceHub || isStructuralHub || (isCoreRing && connCount >= 2) || isHighConn;
      const isMedium = !isHub && (importance === "important" || connCount >= 2 || isCoreRing);

      // Node radius: AGGRESSIVE connection-based scaling
      // Base: hub=28, medium=16, small=10
      // Connection bonus: connCount^0.7 * 4 (powerful scaling)
      // Source bonus: sqrt(sourceCount) * 1.5
      const connBonus = Math.pow(Math.max(0, connCount), 0.7) * 4;
      const srcBonus = Math.sqrt(Math.max(0, sourceCount)) * 1.5;
      const baseR = isHub ? 28 : isMedium ? 16 : 10;
      const rawR = baseR + connBonus + srcBonus;
      // Clamp: min 8, max 48
      const nodeRadius = isFloat ? Math.max(6, rawR * 0.6) : Math.min(48, Math.max(8, rawR));

      const { fill, stroke } = getNodeColor(e, taxonomyMode, epistemicType, cat, isHub);

      // Signal data
      const sig = signalMap.get(e.entity_id);

      nodeList.push({
        id: e.entity_id,
        entity: e,
        ring,
        epistemicType,
        category: cat,
        credibility: cred,
        isFloating: isFloat,
        nodeRadius,
        color: fill,
        strokeColor: stroke,
        label: truncateLabel(cleanEntityName(e), 22),
        sourceCount,
        connCount,
        clusterId: entityClusterMap.get(e.entity_id),
        signalSeverity: sig?.severity ?? null,
        signalCount: sig?.count ?? 0,
        isHub,
      });
      nodeIdSet.add(e.entity_id);
    }

    const linkList: KGLink[] = [];
    for (const edge of edges) {
      const srcId = entityMap.get(edge.source_entity_id)?.entity_id;
      const tgtId = entityMap.get(edge.target_entity_id)?.entity_id;
      if (!srcId || !tgtId || !nodeIdSet.has(srcId) || !nodeIdSet.has(tgtId)) continue;

      const relType = edge.relationship_type ?? "";
      if (visibleEdgeTypes.size > 0) {
        const matchesAny = Array.from(visibleEdgeTypes).some(
          (t) => relType.toLowerCase().includes(t.toLowerCase())
        );
        if (!matchesAny && visibleEdgeTypes.size < 20) continue;
      }

      const isBridge = edge.knowledge_layer === "bridge" ||
        (entityRingMap.get(srcId) !== entityRingMap.get(tgtId));
      const style = getEdgeStyle(relType);

      const conf = edge.confidence ?? 0.5;
      const prov = entityMap.get(srcId)?.provenance as Record<string, unknown> | null;
      const srcCount = ((prov?.citation_urls as string[]) ?? []).length;
      const weight = 0.8 + Math.sqrt(Math.max(1, srcCount)) * 0.6 + conf * 0.4;

      linkList.push({
        source: srcId,
        target: tgtId,
        edge,
        isBridge,
        edgeColor: style.color,
        dashArray: style.dash,
        weight,
      });
    }

    return { nodes: nodeList, links: linkList };
  }, [entities, edges, visibleEntityIds, visibleEdgeTypes, minCredibility, entityRingMap,
      epistemicTypeMap, credibilityMap, taxonomyMode, floatingSet, entityMap, entityClusterMap, adjacencyMap, signalMap]);

  // ── Cluster data ──
  const clusterData = useMemo(() => {
    if (clusters.length === 0) return [];
    return clusters
      .filter((c) => c.entity_ids.length >= 2)
      .map((c) => ({
        ...c,
        nodeIds: new Set(c.entity_ids),
        centroidX: 0,
        centroidY: 0,
        radius: 0,
      }));
  }, [clusters]);

  // ── Top inter-cluster edges ──
  const topInterClusterEdges = useMemo(() => {
    if (clusterData.length < 2) return new Set<string>();
    const interCluster: Array<{ key: string; weight: number }> = [];
    for (const link of links) {
      const srcNode = nodes.find((n) => n.id === (typeof link.source === "string" ? link.source : (link.source as KGNode).id));
      const tgtNode = nodes.find((n) => n.id === (typeof link.target === "string" ? link.target : (link.target as KGNode).id));
      if (!srcNode || !tgtNode) continue;
      if (srcNode.clusterId && tgtNode.clusterId && srcNode.clusterId !== tgtNode.clusterId) {
        interCluster.push({ key: `${srcNode.id}→${tgtNode.id}`, weight: link.weight });
      }
    }
    interCluster.sort((a, b) => b.weight - a.weight);
    return new Set(interCluster.slice(0, 5).map((e) => e.key));
  }, [links, nodes, clusterData]);

  // ── D3 simulation ──

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    const { width, height } = dimensions;
    if (!width || !height || nodes.length === 0) return;

    svg.selectAll("*").remove();

    const defs = svg.append("defs");

    // Arrow markers per edge color
    const edgeColors = new Set(links.map((l) => l.edgeColor));
    edgeColors.forEach((color) => {
      defs.append("marker")
        .attr("id", `kg-arrow-${color.replace("#", "")}`)
        .attr("viewBox", "0 0 8 8")
        .attr("refX", 14)
        .attr("refY", 4)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,0 L8,4 L0,8 Z")
        .attr("fill", color);
    });

    // Default arrow
    defs.append("marker")
      .attr("id", "kg-arrow")
      .attr("viewBox", "0 0 8 8")
      .attr("refX", 14)
      .attr("refY", 4)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,0 L8,4 L0,8 Z")
      .attr("fill", "#94A3B8");

    // Glow filter for selected nodes — stronger
    const glowFilter = defs.append("filter").attr("id", "kg-glow").attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "blur");
    glowFilter.append("feMerge").selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .join("feMergeNode")
      .attr("in", (d) => d);

    // Signal pulse filter — animated ring glow
    const signalGlow = defs.append("filter").attr("id", "kg-signal-glow").attr("x", "-80%").attr("y", "-80%").attr("width", "260%").attr("height", "260%");
    signalGlow.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
    signalGlow.append("feMerge").selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .join("feMergeNode")
      .attr("in", (d) => d);

    // Drop shadow for hub nodes
    const dropShadow = defs.append("filter").attr("id", "kg-shadow").attr("x", "-30%").attr("y", "-30%").attr("width", "160%").attr("height", "160%");
    dropShadow.append("feDropShadow")
      .attr("dx", 0).attr("dy", 1).attr("stdDeviation", 3)
      .attr("flood-color", "rgba(0,0,0,0.12)").attr("flood-opacity", 1);

    const g = svg.append("g").attr("class", "kg-canvas");

    // Zoom behavior
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        transformRef.current = event.transform;
        setZoomLevel(event.transform.k);
      });
    svg.call(zoomBehavior);
    svg.on("click", (event) => {
      if (event.target === svgRef.current) onBackgroundClick();
    });
    svg.call(zoomBehavior.transform, transformRef.current);

    // ── Cluster center targets ──
    const clusterCenters = new Map<string, { x: number; y: number }>();
    if (clusterData.length > 0) {
      const clusterCount = clusterData.length;
      const cRadius = Math.min(width, height) * 0.28;
      clusterData.forEach((c, i) => {
        const angle = (2 * Math.PI * i) / clusterCount - Math.PI / 2;
        const cx = width / 2 + cRadius * Math.cos(angle);
        const cy = height / 2 + cRadius * Math.sin(angle);
        clusterCenters.set(c.id ?? c.label, { x: cx, y: cy });
      });
    }

    const sameCluster = (l: KGLink) => {
      const src = typeof l.source === "string" ? nodes.find((n) => n.id === l.source) : l.source as KGNode;
      const tgt = typeof l.target === "string" ? nodes.find((n) => n.id === l.target) : l.target as KGNode;
      return src?.clusterId && tgt?.clusterId && src.clusterId === tgt.clusterId;
    };

    // ── Simulation ──
    const sim = d3.forceSimulation<KGNode>(nodes);

    if (layout === "force") {
      sim
        .force("link", d3.forceLink<KGNode, KGLink>(links).id((d) => d.id)
          .distance((l) => {
            const sc = sameCluster(l);
            const srcR = (l.source as KGNode).nodeRadius;
            const tgtR = (l.target as KGNode).nodeRadius;
            const isHubEdge = srcR >= 22 || tgtR >= 22;
            if (isHubEdge && !sc) return 380;
            if (!sc) return 260;
            return isHubEdge ? 90 : 65;
          })
          .strength((l) => sameCluster(l) ? 0.85 : 0.1))
        .force("charge", d3.forceManyBody<KGNode>()
          .strength((d) => {
            if (d.isFloating) return -80;
            // Stronger repulsion for larger nodes → prevents overlap
            return d.isHub ? -700 : -(120 + d.nodeRadius * 12);
          })
          .distanceMax(450))
        .force("collision", d3.forceCollide<KGNode>()
          .radius((d) => d.nodeRadius + 18) // More padding than before
          .strength(0.95)
          .iterations(3));

      if (clusterCenters.size > 0) {
        sim
          .force("clusterX", d3.forceX<KGNode>((d) => {
            if (!d.clusterId) return width / 2;
            const c = clusterCenters.get(d.clusterId);
            return c ? c.x : width / 2;
          }).strength((d) => {
            if (!d.clusterId) return 0.08;
            return d.isHub ? 0.55 : d.isFloating ? 0.25 : 0.35;
          }))
          .force("clusterY", d3.forceY<KGNode>((d) => {
            if (!d.clusterId) return height / 2;
            const c = clusterCenters.get(d.clusterId);
            return c ? c.y : height / 2;
          }).strength((d) => {
            if (!d.clusterId) return 0.08;
            return d.isHub ? 0.55 : d.isFloating ? 0.25 : 0.35;
          }));
      } else {
        sim.force("center", d3.forceCenter(width / 2, height / 2).strength(0.05));
      }

      sim.alphaDecay(0.018).velocityDecay(0.5);
    } else if (layout === "radial") {
      const ringRadii: Record<OrbitalRing, number> = {
        core: 0,
        conceptual: Math.min(width, height) * 0.12,
        bridge: Math.min(width, height) * 0.22,
        direct: Math.min(width, height) * 0.33,
        landscape: Math.min(width, height) * 0.42,
      };
      sim
        .force("link", d3.forceLink<KGNode, KGLink>(links).id((d) => d.id).distance(60).strength(0.3))
        .force("charge", d3.forceManyBody().strength(-60))
        .force("radial", d3.forceRadial<KGNode>((d) => ringRadii[d.ring] ?? 200, width / 2, height / 2).strength(0.8))
        .force("collision", d3.forceCollide<KGNode>().radius((d) => d.nodeRadius + 12));
    } else if (layout === "tree") {
      const ringSet = new Set(nodes.map(n => n.ring));
      const allSameRing = ringSet.size <= 1;
      const clusterIds = [...new Set(nodes.map(n => n.clusterId ?? "_none"))];
      sim
        .force("link", d3.forceLink<KGNode, KGLink>(links).id((d) => d.id).distance(80).strength(0.6))
        .force("charge", d3.forceManyBody().strength(-150))
        .force("x", d3.forceX(width / 2).strength(0.05))
        .force("y", d3.forceY<KGNode>((d) => {
          if (allSameRing) {
            const idx = clusterIds.indexOf(d.clusterId ?? "_none");
            return height * (0.15 + 0.7 * idx / Math.max(1, clusterIds.length - 1));
          }
          const ringOrder: Record<OrbitalRing, number> = { core: 0.15, conceptual: 0.3, bridge: 0.5, direct: 0.7, landscape: 0.85 };
          return height * (ringOrder[d.ring] ?? 0.5);
        }).strength(0.4))
        .force("collision", d3.forceCollide<KGNode>().radius((d) => d.nodeRadius + 12));
    } else {
      // Grid
      sim
        .force("link", d3.forceLink<KGNode, KGLink>(links).id((d) => d.id).distance(50).strength(0.1))
        .force("charge", d3.forceManyBody().strength(-30))
        .force("collision", d3.forceCollide<KGNode>().radius((d) => d.nodeRadius + 14));

      const cats = [...new Set(nodes.map((n) => n.category ?? n.ring))];
      const cols = Math.ceil(Math.sqrt(cats.length));
      const cellW = width / (cols + 1);
      const cellH = height / (Math.ceil(cats.length / cols) + 1);
      for (const node of nodes) {
        const catIdx = cats.indexOf(node.category ?? node.ring);
        node.x = cellW * ((catIdx % cols) + 1) + (Math.random() - 0.5) * cellW * 0.4;
        node.y = cellH * (Math.floor(catIdx / cols) + 1) + (Math.random() - 0.5) * cellH * 0.4;
      }
    }

    simulationRef.current = sim;

    // ── Layers ──
    const bubbleGroup = g.append("g").attr("class", "cluster-bubbles");
    const haloGroup = g.append("g").attr("class", "edge-halos");
    const linkGroup = g.append("g").attr("class", "edges");
    const chipGroup = g.append("g").attr("class", "edge-chips");
    const nodeGroup = g.append("g").attr("class", "nodes");

    // ── Edge halos ──
    const haloElements = haloGroup.selectAll("path")
      .data(links)
      .join("path")
      .attr("fill", "none")
      .attr("stroke", "white")
      .attr("stroke-width", (d) => d.weight + 4)
      .attr("stroke-opacity", 0.9)
      .attr("pointer-events", "none");

    // ── Edges ──
    const linkElements = linkGroup.selectAll("path")
      .data(links)
      .join("path")
      .attr("fill", "none")
      .attr("stroke", (d) => d.edgeColor)
      .attr("stroke-width", (d) => Math.max(1.5, d.weight * 0.9))
      .attr("stroke-dasharray", (d) => d.dashArray)
      .attr("stroke-opacity", 0.55)
      .attr("marker-end", (d) => `url(#kg-arrow-${d.edgeColor.replace("#", "")})`)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        const src = entityMap.get((d.source as KGNode).id);
        const tgt = entityMap.get((d.target as KGNode).id);
        if (src && tgt && onEdgeClick) onEdgeClick(d.edge, src, tgt);
      });

    // ── Edge weight chips ──
    const chipElements = chipGroup.selectAll("g")
      .data(links.filter((l) => {
        const srcId = typeof l.source === "string" ? l.source : (l.source as KGNode).id;
        const tgtId = typeof l.target === "string" ? l.target : (l.target as KGNode).id;
        return topInterClusterEdges.has(`${srcId}→${tgtId}`);
      }))
      .join("g")
      .attr("pointer-events", "none");

    chipElements.append("rect")
      .attr("rx", 4).attr("ry", 4)
      .attr("width", 30).attr("height", 16)
      .attr("x", -15).attr("y", -8)
      .attr("fill", "white")
      .attr("stroke", (d) => d.edgeColor)
      .attr("stroke-width", 1);

    chipElements.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "8px")
      .attr("font-weight", "700")
      .attr("fill", (d) => d.edgeColor)
      .text((d) => `${d.weight.toFixed(1)}`);

    // ── Nodes ──
    const nodeElements = nodeGroup.selectAll<SVGGElement, KGNode>("g")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        if (interactionMode === "path") {
          if (!pathStart) setPathStart(d.id);
          else if (!pathEnd && d.id !== pathStart) setPathEnd(d.id);
          else { setPathStart(d.id); setPathEnd(null); }
        } else {
          onNodeClick(d.entity);
        }
      })
      .on("mouseenter", (_, d) => setHoveredNodeId(d.id))
      .on("mouseleave", () => setHoveredNodeId(null))
      .call(
        d3.drag<SVGGElement, KGNode>()
          .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      );

    // Signal ring (outermost ring — animated pulse)
    nodeElements.each(function (d) {
      if (!d.signalSeverity) return;
      const ringColor = SIGNAL_RING_COLORS[d.signalSeverity];
      const ring = d3.select(this).append("circle")
        .attr("class", "signal-ring")
        .attr("r", d.nodeRadius + 6)
        .attr("fill", "none")
        .attr("stroke", ringColor)
        .attr("stroke-width", 2.5)
        .attr("stroke-dasharray", d.signalSeverity === "high" ? "0" : "4,3")
        .attr("opacity", 0.8)
        .attr("filter", "url(#kg-signal-glow)");

      // Pulse animation for high severity
      if (d.signalSeverity === "high") {
        (function pulse() {
          ring.transition()
            .duration(1200)
            .attr("r", d.nodeRadius + 10)
            .attr("opacity", 0.3)
            .transition()
            .duration(1200)
            .attr("r", d.nodeRadius + 6)
            .attr("opacity", 0.8)
            .on("end", pulse);
        })();
      }
    });

    // Selection glow ring
    nodeElements.append("circle")
      .attr("class", "glow-ring")
      .attr("r", (d) => d.nodeRadius + 5)
      .attr("fill", "none")
      .attr("stroke", (d) => d.strokeColor)
      .attr("stroke-width", 3)
      .attr("opacity", 0)
      .attr("filter", "url(#kg-glow)");

    // Main node circle
    nodeElements.append("circle")
      .attr("class", "main-circle")
      .attr("r", (d) => d.nodeRadius)
      .attr("fill", (d) => d.color)
      .attr("stroke", (d) => d.strokeColor)
      .attr("stroke-width", (d) => d.isHub ? 2.5 : 1.8)
      .attr("opacity", (d) => d.isFloating ? 0.35 : 1)
      .attr("filter", (d) => d.isHub ? "url(#kg-shadow)" : null);

    // Connection count badge (bottom-right for hubs with many connections)
    nodeElements.each(function (d) {
      if (d.connCount < 2 || d.isFloating) return;
      const badge = d3.select(this).append("g")
        .attr("class", "conn-badge")
        .attr("transform", `translate(${d.nodeRadius * 0.72}, ${d.nodeRadius * 0.72})`);

      badge.append("circle")
        .attr("r", 8)
        .attr("fill", "#1E293B") // Slate 800
        .attr("stroke", "white")
        .attr("stroke-width", 1.5);

      badge.append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", "8px")
        .attr("font-weight", "700")
        .attr("fill", "white")
        .attr("font-family", "ui-monospace, monospace")
        .text(d.connCount > 9 ? "9+" : String(d.connCount));
    });

    // Source-count badge (top-right)
    nodeElements.each(function (d) {
      if (d.sourceCount < 1) return;
      const badge = d3.select(this).append("g")
        .attr("class", "source-badge")
        .attr("transform", `translate(${d.nodeRadius * 0.72}, ${-d.nodeRadius * 0.72})`);

      badge.append("circle")
        .attr("r", 7)
        .attr("fill", d.strokeColor)
        .attr("stroke", "white")
        .attr("stroke-width", 1.5);

      badge.append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", "8px")
        .attr("font-weight", "700")
        .attr("fill", "white")
        .text(d.sourceCount > 9 ? "9+" : String(d.sourceCount));
    });

    // Signal count indicator (top-left, only if signals)
    nodeElements.each(function (d) {
      if (d.signalCount === 0) return;
      const ringColor = SIGNAL_RING_COLORS[d.signalSeverity ?? "low"];
      const badge = d3.select(this).append("g")
        .attr("class", "signal-badge")
        .attr("transform", `translate(${-d.nodeRadius * 0.72}, ${-d.nodeRadius * 0.72})`);

      badge.append("circle")
        .attr("r", 7)
        .attr("fill", ringColor)
        .attr("stroke", "white")
        .attr("stroke-width", 1.5);

      badge.append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", "7px")
        .attr("font-weight", "800")
        .attr("fill", "white")
        .text(d.signalCount > 9 ? "!" : String(d.signalCount));
    });

    // Node labels
    nodeElements.each(function (d) {
      const gEl = d3.select(this);
      const isHubNode = d.isHub && d.nodeRadius >= 22;

      if (isHubNode) {
        // Hub: bold label INSIDE the circle, white text on colored bg
        const fontSize = Math.max(10, Math.min(12, d.nodeRadius / 2.5));
        const words = d.label.split(" ");
        const half = Math.ceil(words.length / 2);
        const line1 = words.slice(0, half).join(" ");
        const line2 = words.slice(half).join(" ");
        const textColor = d.color === d.strokeColor ? "white" : "#0F172A"; // White text on saturated fill, dark on light fill

        if (words.length > 1 && d.label.length >= 10) {
          const t1 = gEl.append("text").attr("class", "node-label")
            .attr("text-anchor", "middle").attr("font-size", fontSize + "px")
            .attr("font-weight", "800").attr("fill", textColor)
            .attr("dy", "-0.25em").text(line1).attr("pointer-events", "none");
          t1.style("paint-order", "stroke").attr("stroke", d.isHub && d.color === d.strokeColor ? d.strokeColor : "white")
            .attr("stroke-width", 3).attr("stroke-linejoin", "round");
          const t2 = gEl.append("text").attr("class", "node-label")
            .attr("text-anchor", "middle").attr("font-size", fontSize + "px")
            .attr("font-weight", "800").attr("fill", textColor)
            .attr("dy", "0.95em").text(line2).attr("pointer-events", "none");
          t2.style("paint-order", "stroke").attr("stroke", d.isHub && d.color === d.strokeColor ? d.strokeColor : "white")
            .attr("stroke-width", 3).attr("stroke-linejoin", "round");
        } else {
          const t = gEl.append("text").attr("class", "node-label")
            .attr("text-anchor", "middle").attr("font-size", fontSize + "px")
            .attr("font-weight", "800").attr("fill", textColor)
            .attr("dy", "0.35em").text(d.label).attr("pointer-events", "none");
          t.style("paint-order", "stroke").attr("stroke", d.isHub && d.color === d.strokeColor ? d.strokeColor : "white")
            .attr("stroke-width", 3).attr("stroke-linejoin", "round");
        }
      } else {
        // Atom: label BELOW the node — dark text, white stroke halo
        const fontSize = Math.max(8.5, Math.min(10, d.nodeRadius / 1.8));
        const t = gEl.append("text").attr("class", "node-label")
          .text(d.label)
          .attr("dy", d.nodeRadius + 12)
          .attr("text-anchor", "middle")
          .attr("fill", "#1E293B") // Slate 800
          .attr("font-size", fontSize + "px")
          .attr("font-weight", "600")
          .attr("opacity", d.isFloating ? 0.35 : 0.95)
          .attr("pointer-events", "none");
        t.style("paint-order", "stroke").attr("stroke", "white")
          .attr("stroke-width", 3.5).attr("stroke-linejoin", "round");
      }
    });

    // Source badges at zoom level 4
    if (semanticZoom >= 4) {
      nodeElements.each(function (d) {
        const prov = d.entity.provenance as Record<string, unknown> | null;
        const urls = (prov?.citation_urls as string[]) ?? [];
        if (urls.length === 0) return;

        const badgeG = d3.select(this).append("g")
          .attr("transform", `translate(${d.nodeRadius + 8}, ${-d.nodeRadius})`);

        urls.slice(0, 3).forEach((url, i) => {
          const domain = (() => {
            try { return new URL(url).hostname.replace("www.", "").slice(0, 3).toUpperCase(); }
            catch { return "SRC"; }
          })();
          badgeG.append("rect")
            .attr("x", 0).attr("y", i * 15)
            .attr("width", 26).attr("height", 13)
            .attr("rx", 3)
            .attr("fill", "#F8FAFC").attr("stroke", "#CBD5E1").attr("stroke-width", 0.5);
          badgeG.append("text")
            .attr("x", 13).attr("y", i * 15 + 9)
            .attr("text-anchor", "middle")
            .attr("font-size", "7px").attr("font-weight", "600")
            .attr("fill", "#475569")
            .text(domain);
        });
      });
    }

    // ── Tick handler ──
    const tickHandler = () => {
      const pad = 50;
      for (const n of nodes) {
        if (n.x != null) n.x = Math.max(pad, Math.min(width - pad, n.x));
        if (n.y != null) n.y = Math.max(pad, Math.min(height - pad, n.y));
      }

      const _semanticZoom = semanticZoom;
      const _selectedEntityId = selectedEntityId;
      const _hoveredNodeId = hoveredNodeId;
      const _interactionMode = interactionMode;

      const edgePath = (d: KGLink) => {
        const sx = (d.source as KGNode).x ?? 0;
        const sy = (d.source as KGNode).y ?? 0;
        const tx = (d.target as KGNode).x ?? 0;
        const ty = (d.target as KGNode).y ?? 0;
        return curvedEdgePath(sx, sy, tx, ty, 1.8);
      };

      haloElements.attr("d", edgePath);
      linkElements.attr("d", edgePath);

      chipElements.attr("transform", (d) => {
        const sx = (d.source as KGNode).x ?? 0;
        const sy = (d.source as KGNode).y ?? 0;
        const tx = (d.target as KGNode).x ?? 0;
        const ty = (d.target as KGNode).y ?? 0;
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        const dx = tx - sx;
        const dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / dist;
        const ny = dx / dist;
        const offset = dist * 0.08;
        return `translate(${mx + nx * offset},${my + ny * offset})`;
      });

      nodeElements.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

      // ── Cluster bubbles ──
      bubbleGroup.selectAll("*").remove();
      {
        const isMacro = _semanticZoom <= 2;
        for (const cluster of clusterData) {
          const clusterNodes = nodes.filter(
            (n) => cluster.nodeIds.has(n.id) && n.x != null && n.y != null
          );
          if (clusterNodes.length < 2) continue;

          const cx = d3.mean(clusterNodes, (n) => n.x!) ?? 0;
          const cy = d3.mean(clusterNodes, (n) => n.y!) ?? 0;

          let maxDist = 0;
          for (const n of clusterNodes) {
            const dx = (n.x ?? 0) - cx;
            const dy = (n.y ?? 0) - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) + n.nodeRadius;
            if (dist > maxDist) maxDist = dist;
          }
          const bubbleRadius = maxDist + 30;
          const clusterColor = cluster.color ?? "#64748B"; // Slate 500

          // Cluster bubble — visible fill + solid border
          bubbleGroup.append("circle")
            .attr("cx", cx).attr("cy", cy)
            .attr("r", bubbleRadius)
            .attr("fill", clusterColor)
            .attr("fill-opacity", isMacro ? 0.08 : 0.04)
            .attr("stroke", clusterColor)
            .attr("stroke-opacity", isMacro ? 0.45 : 0.25)
            .attr("stroke-width", isMacro ? 2 : 1.5)
            .attr("stroke-dasharray", "8,4");

          // Cluster label badge
          const dxFromCenter = cx - width / 2;
          const dyFromCenter = cy - height / 2;
          const distFromCenter = Math.sqrt(dxFromCenter * dxFromCenter + dyFromCenter * dyFromCenter) || 1;
          const labelX = cx + (dxFromCenter / distFromCenter) * (bubbleRadius + 18);
          const labelY = cy + (dyFromCenter / distFromCenter) * (bubbleRadius + 18);
          const labelText = cluster.label.toUpperCase();
          const countText = `${clusterNodes.length}`;
          const fullLabel = `${labelText}  ${countText}`;

          const fontSize = isMacro ? 11 : 9;
          const charW = fontSize * 0.55;
          const badgeW = fullLabel.length * charW + 18;
          const badgeH = isMacro ? 22 : 18;

          bubbleGroup.append("rect")
            .attr("x", labelX - badgeW / 2)
            .attr("y", labelY - badgeH / 2)
            .attr("width", badgeW).attr("height", badgeH)
            .attr("rx", badgeH / 2)
            .attr("fill", "white")
            .attr("stroke", clusterColor)
            .attr("stroke-opacity", 0.5)
            .attr("stroke-width", 1);

          bubbleGroup.append("text")
            .attr("x", labelX).attr("y", labelY + 1)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("font-size", fontSize + "px")
            .attr("font-weight", "700")
            .attr("letter-spacing", "0.5px")
            .attr("font-family", "ui-monospace, monospace")
            .attr("fill", clusterColor);

          // Separate label and count
          const labelEl = bubbleGroup.append("text")
            .attr("x", labelX).attr("y", labelY + 1)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("font-size", fontSize + "px")
            .attr("font-weight", "700")
            .attr("letter-spacing", "0.5px")
            .attr("font-family", "ui-monospace, monospace")
            .attr("fill", clusterColor);
          labelEl.append("tspan").text(labelText + "  ");
          labelEl.append("tspan")
            .attr("fill", clusterColor)
            .attr("font-weight", "500")
            .attr("font-size", (fontSize - 1) + "px")
            .text(countText);

          // Macro level: large count in center
          if (_semanticZoom === 1) {
            bubbleGroup.append("text")
              .attr("x", cx).attr("y", cy)
              .attr("text-anchor", "middle")
              .attr("dominant-baseline", "central")
              .attr("font-size", "26px")
              .attr("font-weight", "800")
              .attr("fill", clusterColor)
              .attr("opacity", 0.25)
              .text(String(clusterNodes.length));
          }
        }
      }

      // ── Hover highlighting ──
      if (_hoveredNodeId && _interactionMode === "explore" && !_selectedEntityId) {
        const neighbors = adjacencyMap.get(_hoveredNodeId) ?? new Set<string>();
        nodeElements.select(".main-circle")
          .attr("opacity", (d) => {
            if (d.isFloating && d.id !== _hoveredNodeId && !neighbors.has(d.id)) return 0.08;
            if (d.id === _hoveredNodeId || neighbors.has(d.id)) return 1;
            return 0.15;
          });
        nodeElements.each(function (d) {
          const inScope = d.id === _hoveredNodeId || neighbors.has(d.id);
          d3.select(this).selectAll(".node-label").attr("opacity", inScope ? 1 : 0.06);
          d3.select(this).selectAll(".source-badge, .conn-badge, .signal-badge").attr("opacity", inScope ? 1 : 0.06);
        });
        linkElements.attr("stroke-opacity", (d) => {
          const sid = (d.source as KGNode).id;
          const tid = (d.target as KGNode).id;
          if (sid === _hoveredNodeId || tid === _hoveredNodeId) return 0.9;
          return 0.04;
        });
        haloElements.attr("stroke-opacity", (d) => {
          const sid = (d.source as KGNode).id;
          const tid = (d.target as KGNode).id;
          if (sid === _hoveredNodeId || tid === _hoveredNodeId) return 0.9;
          return 0.08;
        });
      }
      // ── Selection highlighting ──
      else if (_selectedEntityId && _interactionMode !== "path") {
        const selNeighbors = adjacencyMap.get(_selectedEntityId) ?? new Set<string>();
        nodeElements.select(".glow-ring")
          .attr("opacity", (d) => d.id === _selectedEntityId ? 0.7 : 0);
        nodeElements.select(".main-circle")
          .attr("opacity", (d) => {
            if (d.isFloating && d.id !== _selectedEntityId && !selNeighbors.has(d.id)) return 0.08;
            if (d.id === _selectedEntityId) return 1;
            if (selNeighbors.has(d.id)) return 0.9;
            return 0.15;
          });
        nodeElements.each(function (d) {
          const inScope = d.id === _selectedEntityId || selNeighbors.has(d.id);
          d3.select(this).selectAll(".node-label").attr("opacity", inScope ? 0.95 : 0.08);
        });
        linkElements.attr("stroke-opacity", (d) => {
          const sid = (d.source as KGNode).id;
          const tid = (d.target as KGNode).id;
          if (sid === _selectedEntityId || tid === _selectedEntityId) return 0.9;
          return 0.04;
        });
        haloElements.attr("stroke-opacity", (d) => {
          const sid = (d.source as KGNode).id;
          const tid = (d.target as KGNode).id;
          if (sid === _selectedEntityId || tid === _selectedEntityId) return 0.9;
          return 0.08;
        });
      }
      // ── Path highlighting ──
      else if (_interactionMode === "path" && pathHighlightSet.size > 0) {
        nodeElements.select(".glow-ring")
          .attr("opacity", (d) => pathHighlightSet.has(d.id) ? 0.6 : 0);
        nodeElements.select(".main-circle")
          .attr("opacity", (d) => {
            if (d.isFloating) return 0.08;
            if (pathHighlightSet.has(d.id)) return 1;
            return 0.12;
          });
        nodeElements.each(function (d) {
          d3.select(this).selectAll(".node-label").attr("opacity", pathHighlightSet.has(d.id) ? 1 : 0.06);
        });
        linkElements
          .attr("stroke-opacity", (d) => {
            const sid = (d.source as KGNode).id;
            const tid = (d.target as KGNode).id;
            if (pathEdgeSet.has(`${sid}→${tid}`) || pathEdgeSet.has(`${tid}→${sid}`)) return 0.9;
            return 0.04;
          })
          .attr("stroke-width", (d) => {
            const sid = (d.source as KGNode).id;
            const tid = (d.target as KGNode).id;
            if (pathEdgeSet.has(`${sid}→${tid}`) || pathEdgeSet.has(`${tid}→${sid}`)) return d.weight * 1.2 + 1;
            return Math.max(0.8, d.weight * 0.7);
          });
        haloElements.attr("stroke-opacity", (d) => {
          const sid = (d.source as KGNode).id;
          const tid = (d.target as KGNode).id;
          if (pathEdgeSet.has(`${sid}→${tid}`) || pathEdgeSet.has(`${tid}→${sid}`)) return 0.95;
          return 0.06;
        });
      }
      // ── Default state with semantic zoom ──
      else {
        nodeElements.select(".glow-ring").attr("opacity", 0);

        const isHubNode = (d: KGNode) => d.isHub;
        const nodeVisible = (d: KGNode) => {
          if (_semanticZoom === 1) return false;
          if (_semanticZoom === 2) return isHubNode(d);
          return true;
        };

        nodeElements.select(".main-circle")
          .attr("opacity", (d) => {
            if (!nodeVisible(d)) return 0;
            if (d.isFloating) return 0.35;
            return 1;
          });
        nodeElements
          .style("pointer-events", (d) => nodeVisible(d) ? "auto" : "none");
        nodeElements.each(function (d) {
          const vis = nodeVisible(d);
          let labelOp = 0;
          if (vis) {
            if (_semanticZoom < 3) labelOp = isHubNode(d) ? 0.95 : 0;
            else if (d.isFloating) labelOp = 0.35;
            else labelOp = 0.95;
          }
          d3.select(this).selectAll(".node-label").attr("opacity", labelOp);
          const badgeOp = (!vis || d.isFloating) ? 0 : (_semanticZoom >= 3 ? 1 : 0);
          d3.select(this).selectAll(".source-badge, .conn-badge, .signal-badge").attr("opacity", badgeOp);
        });

        linkElements.attr("stroke-opacity", (d) => {
          if (_semanticZoom === 1) {
            const sid = (d.source as KGNode).id;
            const tid = (d.target as KGNode).id;
            const srcHub = nodes.find((n) => n.id === sid);
            const tgtHub = nodes.find((n) => n.id === tid);
            if (srcHub && tgtHub && srcHub.isHub && tgtHub.isHub && d.isBridge) return 0.4;
            return 0;
          }
          if (_semanticZoom === 2) {
            const srcHub = (nodes.find((n) => n.id === (d.source as KGNode).id))?.isHub;
            const tgtHub = (nodes.find((n) => n.id === (d.target as KGNode).id))?.isHub;
            return (srcHub || tgtHub) ? 0.55 : 0;
          }
          return 0.55;
        });
        haloElements.attr("stroke-opacity", (d) => {
          if (_semanticZoom <= 2) return 0;
          return 0.9;
        });

        chipElements.attr("opacity", _semanticZoom >= 4 ? 1 : 0);
      }
    };

    sim.on("tick", tickHandler);

    // Pre-position near cluster centers
    if (clusterCenters.size > 0) {
      for (const node of nodes) {
        if (node.x != null && node.y != null) continue;
        const center = node.clusterId ? clusterCenters.get(node.clusterId) : null;
        const cx = center?.x ?? width / 2;
        const cy = center?.y ?? height / 2;
        node.x = cx + (Math.random() - 0.5) * 60;
        node.y = cy + (Math.random() - 0.5) * 60;
      }
    }

    sim.alpha(1);
    for (let i = 0; i < 80; i++) sim.tick();
    tickHandler();
    sim.alpha(0.3).restart();

    return () => { sim.stop(); };
  }, [nodes, links, dimensions, layout, clusterData,
      taxonomyMode, onNodeClick, onEdgeClick, onBackgroundClick, entityMap,
      adjacencyMap, pathStart, pathEnd,
      pathHighlightSet, pathEdgeSet, topInterClusterEdges,
      semanticZoom, selectedEntityId, hoveredNodeId, interactionMode]);

  // ── Zoom controls ──
  const handleZoom = useCallback((direction: "in" | "out" | "fit" | "center") => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 5]);
    const { width, height } = dimensions;

    if (direction === "in") {
      svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.3);
    } else if (direction === "out") {
      svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7);
    } else if (direction === "fit") {
      svg.transition().duration(300).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8).translate(-width / 2, -height / 2)
      );
    } else {
      svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity);
    }
  }, [dimensions]);

  const hoveredNode = useMemo(
    () => (hoveredNodeId ? nodes.find((n) => n.id === hoveredNodeId) : null),
    [hoveredNodeId, nodes]
  );

  const pathStartNode = useMemo(
    () => (pathStart ? nodes.find((n) => n.id === pathStart) : null),
    [pathStart, nodes]
  );
  const pathEndNode = useMemo(
    () => (pathEnd ? nodes.find((n) => n.id === pathEnd) : null),
    [pathEnd, nodes]
  );

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 rounded-xl border border-gray-200/80 overflow-hidden bg-white">
      {/* Subtle dot grid background */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle, rgba(15,23,42,0.04) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }} />
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="w-full h-full relative z-[1]"
        style={{ cursor: "grab" }}
      />

      {/* Mode toggle — top left */}
      <div className="absolute top-3 left-3 flex items-center gap-0.5 bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm p-1 z-10">
        {(Object.entries(MODE_CONFIG) as Array<[GraphInteractionMode, typeof MODE_CONFIG["explore"]]>).map(([mode, cfg]) => {
          const Icon = cfg.icon;
          return (
            <button
              key={mode}
              onClick={() => {
                setInteractionMode(mode);
                if (mode !== "path") { setPathStart(null); setPathEnd(null); }
              }}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all",
                interactionMode === mode
                  ? "bg-gray-900 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-700 hover:bg-gray-50"
              )}
            >
              <Icon className="h-3 w-3" />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Path mode status */}
      {interactionMode === "path" && (
        <div className="absolute top-14 left-3 bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm px-3 py-2.5 z-10">
          <p className="text-[10px] font-bold text-gray-700 mb-1.5">Path Finder</p>
          <div className="flex items-center gap-2 text-[9px]">
            <span className={cn("px-2 py-0.5 rounded-md font-medium", pathStartNode ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-400")}>
              {pathStartNode ? pathStartNode.label : "Click start node"}
            </span>
            <span className="text-gray-300 font-bold">&rarr;</span>
            <span className={cn("px-2 py-0.5 rounded-md font-medium", pathEndNode ? "bg-blue-100 text-blue-700 border border-blue-200" : "bg-gray-100 text-gray-400")}>
              {pathEndNode ? pathEndNode.label : "Click end node"}
            </span>
          </div>
          {pathHighlightSet.size > 0 && (
            <p className="text-[9px] text-emerald-600 font-semibold mt-1.5">{pathHighlightSet.size} nodes in shortest path</p>
          )}
          {pathStart && pathEnd && pathHighlightSet.size === 0 && (
            <p className="text-[9px] text-amber-600 font-semibold mt-1.5">No path found</p>
          )}
          <button
            onClick={() => { setPathStart(null); setPathEnd(null); }}
            className="text-[9px] text-gray-400 hover:text-gray-600 mt-1.5 font-medium underline underline-offset-2"
          >
            Reset
          </button>
        </div>
      )}

      {/* Zoom controls — bottom left */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-0.5 bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm p-1 z-10">
        <button onClick={() => handleZoom("in")} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors" title="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => handleZoom("out")} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors" title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <div className="border-t border-gray-100 mx-1 my-0.5" />
        <button onClick={() => handleZoom("fit")} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors" title="Fit to view">
          <Maximize className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => handleZoom("center")} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors" title="Reset view">
          <LocateFixed className="h-3.5 w-3.5" />
        </button>
        <div className="text-center text-[9px] font-semibold text-gray-500 tabular-nums py-0.5">
          {Math.round(zoomLevel * 100)}%
        </div>
      </div>

      {/* Minimap — bottom right */}
      {nodes.length > 10 && (
        <div className="absolute bottom-3 right-3 w-36 h-28 bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm overflow-hidden z-10">
          <svg viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} className="w-full h-full">
            {nodes.map((n) => (
              <circle
                key={n.id}
                cx={n.x ?? 0}
                cy={n.y ?? 0}
                r={n.isHub ? 3 : 1.5}
                fill={n.strokeColor}
                opacity={n.isFloating ? 0.2 : 0.7}
              />
            ))}
            <rect
              x={-transformRef.current.x / transformRef.current.k}
              y={-transformRef.current.y / transformRef.current.k}
              width={dimensions.width / transformRef.current.k}
              height={dimensions.height / transformRef.current.k}
              fill="none"
              stroke="#2563EB"
              strokeWidth={2 / transformRef.current.k}
              rx={4 / transformRef.current.k}
              opacity={0.6}
            />
          </svg>
        </div>
      )}

      {/* Tooltip */}
      {hoveredNode && interactionMode !== "path" && (
        <div className="absolute top-3 right-44 max-w-72 rounded-xl border border-gray-200/80 bg-white/95 backdrop-blur-sm shadow-lg px-3.5 py-2.5 pointer-events-none z-10">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full flex-shrink-0 border-2 border-white shadow-sm"
              style={{ backgroundColor: hoveredNode.strokeColor }}
            />
            <span className="text-[12px] font-bold text-gray-900 truncate">
              {cleanEntityName(hoveredNode.entity)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className={cn(
              "px-1.5 py-0.5 rounded-md text-[9px] font-semibold border",
              EPISTEMIC_CONFIG[hoveredNode.epistemicType].bg,
              EPISTEMIC_CONFIG[hoveredNode.epistemicType].color
            )}>
              {EPISTEMIC_CONFIG[hoveredNode.epistemicType].label}
            </span>
            <span className="text-gray-600 font-medium">Cred {hoveredNode.credibility.effective_confidence.toFixed(2)}</span>
            <span className="text-gray-400">{hoveredNode.connCount} conn</span>
            {hoveredNode.sourceCount > 0 && (
              <span className="text-gray-400">{hoveredNode.sourceCount} src</span>
            )}
            {hoveredNode.isFloating && <span className="text-amber-600 font-semibold">Floating</span>}
            {hoveredNode.signalCount > 0 && (
              <span className={cn(
                "font-semibold",
                hoveredNode.signalSeverity === "high" ? "text-red-600" :
                hoveredNode.signalSeverity === "medium" ? "text-amber-600" : "text-blue-600"
              )}>
                {hoveredNode.signalCount} signal{hoveredNode.signalCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[9px] text-gray-400 font-medium">Click to inspect</p>
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-400">No entities match current filters</p>
            <p className="text-[11px] text-gray-300 mt-1">Adjust filters or run research to populate the graph</p>
          </div>
        </div>
      )}

      {/* Semantic zoom label */}
      <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-white/95 backdrop-blur-sm border border-gray-200/80 shadow-sm text-[10px] font-semibold text-gray-600 z-10">
        {ZOOM_LABELS[semanticZoom]} · {nodes.length} nodes
      </div>
    </div>
  );
}
