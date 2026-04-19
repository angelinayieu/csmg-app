"use client";

import React, { useRef, useEffect, useMemo, useCallback, useState } from "react";
import * as d3 from "d3";
import type { Entity, Edge } from "@/types";
import type { OrbitalRing, ExternalCategory, RadarFilterState } from "@/types/intelligence";
import { RING_CONFIG, CATEGORY_CONFIG } from "@/types/intelligence";

// ── Types ──

interface OrbitalNode extends d3.SimulationNodeDatum {
  id: string;
  entity: Entity;
  ring: OrbitalRing;
  targetRadius: number;
  category?: ExternalCategory;
  color: string;
  strokeColor: string;
  nodeRadius: number;
  opacity: number;
  tier?: "embedded" | "observatory";
  isMaterialized?: boolean;
  authority?: string;
  confidence?: number;
  parentNodeId?: string; // For SC_ cluster children — their parent's entity_id
}

interface OrbitalLink extends d3.SimulationLinkDatum<OrbitalNode> {
  edge: Edge;
  isBridge: boolean;
  isCrossLayer: boolean;
  label?: string;
  edgeColor?: string;
}

interface OrbitalGraphProps {
  internalEntities: Entity[];
  externalEntities: Entity[];
  conceptualEntities?: Entity[];
  bridgeEdges: Edge[];
  internalEdges: Edge[];
  externalEdges?: Edge[];
  entityRingMap: Map<string, OrbitalRing>;
  filters: RadarFilterState;
  onNodeClick?: (entity: Entity) => void;
  onNodeHover?: (entity: Entity | null) => void;
  onEdgeClick?: (edge: Edge, sourceEntity: Entity, targetEntity: Entity) => void;
  compact?: boolean;
  selectedEntityId?: string | null;
  /** Edge ID to visually highlight as "expanded" (probability space active) */
  expandedEdgeId?: string | null;
}

// ── Helpers ──

/** Clean up entity names: strip XSIG_ prefixes, un-snake-case, titleize */
export function cleanEntityName(entity: Entity): string {
  let name = entity.name ?? entity.entity_id;
  // Strip XSIG_ / KG_ prefixes
  if (/^(XSIG_|KG_)/i.test(name)) {
    name = name.replace(/^(XSIG_|KG_)/i, "");
  }
  // If it's still snake_case, convert to title case
  if (name.includes("_") && !name.includes(" ")) {
    name = name
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }
  return name;
}

/** Truncate cleanly at word boundary when possible */
function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.5) {
    return truncated.slice(0, lastSpace) + "\u2026";
  }
  return truncated + "\u2026";
}

function getEntityCategory(entity: Entity): ExternalCategory {
  const prov = entity.provenance as Record<string, unknown> | null;
  return (prov?.category as ExternalCategory) ?? "pattern";
}

// Category fill colors
const CATEGORY_FILLS: Record<ExternalCategory, string> = {
  competitor: "#FEF2F2",
  framework: "#F5F3FF",
  pattern: "#EFF6FF",
  data_point: "#ECFDF5",
  analogy: "#FFFBEB",
  risk_pattern: "#FFF7ED",
  resource: "#F0FDFA",
};

// Bridge edge colors by relationship type
const EDGE_TYPE_COLORS: Record<string, string> = {
  validates_bridge: "#22C55E",
  challenges_bridge: "#EF4444",
  extends_bridge: "#3B82F6",
  analogous_bridge: "#8B5CF6",
  hint_bridge: "#94A3B8",
  risk_bridge: "#F97316",
  risk_source: "#EF4444",
  mediates: "#007AFF",
  measures: "#0EA5E9",
  validates: "#22C55E",
  challenges: "#EF4444",
  // Decomposition edge types
  has_component: "#8B5CF6",
  causes: "#F59E0B",
  interaction_amplifying: "#22C55E",
  interaction_dampening: "#EF4444",
  interaction_enabling: "#3B82F6",
  interaction_blocking: "#DC2626",
  interaction_transforming: "#8B5CF6",
};

function getEdgeLabel(type: string): string {
  const labels: Record<string, string> = {
    validates_bridge: "validates",
    challenges_bridge: "challenges",
    extends_bridge: "extends",
    analogous_bridge: "analogous",
    hint_bridge: "hints",
    risk_bridge: "risk",
    risk_source: "risk source",
    mediates: "mediates",
    measures: "measures",
    competes_with: "competes",
    enables: "enables",
    validates: "validates",
    contradicts: "contradicts",
    influences: "influences",
    depends_on: "depends",
    relates_to: "",
    // Decomposition edge labels
    has_component: "component",
    causes: "causes",
    interaction_amplifying: "amplifies",
    interaction_dampening: "dampens",
    interaction_enabling: "enables",
    interaction_blocking: "blocks",
    interaction_transforming: "transforms",
  };
  return labels[type] ?? "";
}

function getNodeAppearance(
  entity: Entity,
  ring: OrbitalRing,
): { fill: string; stroke: string; radius: number; opacity: number } {
  if (ring === "core") {
    if (entity.is_master_bottleneck) return { fill: "#FEE2E2", stroke: "#E24B4A", radius: 18, opacity: 1 };
    if (entity.is_leverage_point) return { fill: "#FEF3C7", stroke: "#EF9F27", radius: 16, opacity: 1 };
    if (entity.is_risk_point) return { fill: "#FEE2E2", stroke: "#D85A30", radius: 14, opacity: 0.95 };
    return { fill: "#E6F1FB", stroke: "#378ADD", radius: 12, opacity: 0.9 };
  }

  if (ring === "conceptual") {
    return { fill: "#CCFBF1", stroke: "#14B8A6", radius: 10, opacity: 0.85 };
  }

  if (ring === "bridge") {
    return { fill: "#FEF3C7", stroke: "#EF9F27", radius: 11, opacity: 0.85 };
  }

  // External entities — by category + tier
  const cat = getEntityCategory(entity);
  const conf = CATEGORY_CONFIG[cat];
  const prov = (entity.provenance as Record<string, unknown>) ?? {};
  const tier = (prov.intelligence_tier_manual ?? prov.intelligence_tier ?? "observatory") as string;
  const isEmbedded = tier === "embedded";
  const isMaterialized = prov.source_type === "signal_materialization";

  const isSubComponent = entity.entity_id?.startsWith("SUB_") || entity.entity_id?.startsWith("SC_");
  const baseRadius = isSubComponent ? 7 : ring === "direct" ? 13 : 10;
  const confidence = entity.confidence ?? 0.5;
  const tierBonus = isEmbedded ? 3 : 0;
  const materializedBonus = isMaterialized ? 2 : 0;
  const confBonus = confidence > 0.8 ? 2 : confidence > 0.6 ? 1 : 0;
  const opacity = isEmbedded ? 0.95 : ring === "direct" ? 0.8 : 0.6;

  return {
    fill: CATEGORY_FILLS[cat] ?? conf?.bg.replace("bg-", "").replace("-50", "") ?? "#F3F4F6",
    stroke: isEmbedded ? (conf?.stroke ?? "#4F46E5") : (conf?.stroke ?? "#86868B"),
    radius: baseRadius + confBonus + tierBonus + materializedBonus,
    opacity,
  };
}

// ── Main Component ──

export function OrbitalGraph({
  internalEntities,
  externalEntities,
  conceptualEntities = [],
  bridgeEdges,
  internalEdges,
  externalEdges = [],
  entityRingMap,
  filters,
  onNodeClick,
  onNodeHover,
  onEdgeClick,
  compact = false,
  selectedEntityId,
  expandedEdgeId,
}: OrbitalGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<OrbitalNode, OrbitalLink> | null>(null);

  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onNodeHoverRef = useRef(onNodeHover);
  onNodeHoverRef.current = onNodeHover;
  const onEdgeClickRef = useRef(onEdgeClick);
  onEdgeClickRef.current = onEdgeClick;

  const [hoveredNode, setHoveredNode] = useState<OrbitalNode | null>(null);

  // ── Adaptive scaling ──
  // Compress rings when there are few nodes to avoid empty space
  const totalNodes = internalEntities.length + externalEntities.length + conceptualEntities.length;
  const densityFactor = Math.max(0.5, Math.min(1, totalNodes / 20));

  const scale = compact ? 0.55 * densityFactor : densityFactor;
  const width = compact ? 380 : 850;
  const height = compact ? 380 : 850;
  const centerX = width / 2;
  const centerY = height / 2;

  // ── Build nodes ──

  // Detect external-only mode: no core entities
  const coreEntities = useMemo(
    () => internalEntities.filter((e) => entityRingMap.get(e.entity_id) === "core"),
    [internalEntities, entityRingMap],
  );
  const externalOnly = coreEntities.length === 0;

  const nodes: OrbitalNode[] = useMemo(() => {
    const result: OrbitalNode[] = [];

    // Core nodes (internal high-importance)
    for (const e of internalEntities) {
      const ring = entityRingMap.get(e.entity_id);
      if (ring !== "core") continue;
      const { fill, stroke, radius, opacity } = getNodeAppearance(e, "core");
      result.push({
        id: e.entity_id,
        entity: e,
        ring: "core",
        targetRadius: RING_CONFIG.core.radius * scale,
        color: fill,
        strokeColor: stroke,
        nodeRadius: radius * scale,
        opacity,
        authority: e.authority_level ?? undefined,
        confidence: e.confidence ?? undefined,
      });
    }

    // Conceptual nodes (expansion-derived mechanisms)
    // First pass: detect SC_ entities and group by parent
    const scChildrenByParent = new Map<string, string[]>();
    for (const e of conceptualEntities) {
      const match = e.entity_id.match(/^SC_(.+?)_[^_]+$/);
      if (match) {
        const parentId = match[1];
        if (!scChildrenByParent.has(parentId)) scChildrenByParent.set(parentId, []);
        scChildrenByParent.get(parentId)!.push(e.entity_id);
      }
    }

    for (const e of conceptualEntities) {
      const ring = entityRingMap.get(e.entity_id) ?? "conceptual";
      const isSC = e.entity_id.startsWith("SC_");
      const parentMatch = isSC ? e.entity_id.match(/^SC_(.+?)_[^_]+$/) : null;
      const parentEntityId = parentMatch ? parentMatch[1] : undefined;

      const { fill, stroke, radius, opacity } = getNodeAppearance(e, ring as OrbitalRing);

      // SC_ nodes get smaller radius and will be pulled toward parent by cluster force
      const scRadius = isSC ? Math.max(4, 5 * scale) : radius * scale;

      result.push({
        id: e.entity_id,
        entity: e,
        ring: ring as OrbitalRing,
        targetRadius: (RING_CONFIG[ring as OrbitalRing]?.radius ?? RING_CONFIG.conceptual.radius) * scale,
        color: fill,
        strokeColor: stroke,
        nodeRadius: scRadius,
        opacity: isSC ? 0.75 : opacity,
        authority: e.authority_level ?? undefined,
        confidence: e.confidence ?? undefined,
        parentNodeId: parentEntityId,
      });
    }

    // External + bridge nodes
    for (const e of externalEntities) {
      const ring = entityRingMap.get(e.entity_id) ?? "landscape";
      const { fill, stroke, radius, opacity } = getNodeAppearance(e, ring);
      const cat = getEntityCategory(e);

      const eProv = (e.provenance as Record<string, unknown>) ?? {};
      const eTier = ((eProv.intelligence_tier_manual ?? eProv.intelligence_tier ?? "observatory") as "embedded" | "observatory");

      // Adaptive radius: when no core entities, spread externals across full area
      // using confidence to assign ring placement (higher confidence = closer to center)
      let targetRadius: number;
      if (externalOnly) {
        const conf = e.confidence ?? 0.5;
        const innerRing = 100 * scale;  // "High Confidence" ring
        const outerRing = 280 * scale;  // "Landscape" ring
        // Higher confidence → inner ring, lower → outer ring
        targetRadius = conf >= 0.65 ? innerRing : outerRing;
      } else {
        targetRadius = (RING_CONFIG[ring]?.radius ?? 380) * scale;
      }

      result.push({
        id: e.entity_id,
        entity: e,
        ring,
        targetRadius,
        category: cat,
        color: CATEGORY_FILLS[cat] ?? fill,
        strokeColor: CATEGORY_CONFIG[cat]?.stroke ?? stroke,
        nodeRadius: radius * scale,
        opacity,
        tier: eTier,
        isMaterialized: eProv.source_type === "signal_materialization",
        authority: e.authority_level ?? undefined,
        confidence: e.confidence ?? undefined,
      });
    }

    return result;
  }, [internalEntities, externalEntities, conceptualEntities, entityRingMap, scale, externalOnly]);

  // ── Build links ──

  const links: OrbitalLink[] = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    // Build UUID → entity_id map for fallback matching
    // (edges may reference UUID `id` while nodes are keyed by `entity_id`)
    const uuidToEntityId = new Map<string, string>();
    for (const n of nodes) {
      const uuid = n.entity.id;
      if (uuid && uuid !== n.id) uuidToEntityId.set(uuid, n.id);
    }

    const resolveId = (id: string): string | undefined => {
      if (nodeIds.has(id)) return id;
      return uuidToEntityId.get(id);
    };

    const result: OrbitalLink[] = [];
    const addedPairs = new Set<string>();

    // Build node lookup for cross-layer detection
    const nodeById = new Map<string, OrbitalNode>();
    for (const n of nodes) nodeById.set(n.id, n);

    const tryAdd = (edge: Edge, isBridge: boolean) => {
      const src = resolveId(edge.source_entity_id) ?? edge.source_entity_id;
      const tgt = resolveId(edge.target_entity_id) ?? edge.target_entity_id;
      if (!nodeIds.has(src) || !nodeIds.has(tgt)) return;
      const key = `${src}-${tgt}`;
      const keyR = `${tgt}-${src}`;
      if (addedPairs.has(key) || addedPairs.has(keyR)) return;
      addedPairs.add(key);

      const relType = edge.relationship_type ?? "";
      const srcNode = nodeById.get(src);
      const tgtNode = nodeById.get(tgt);
      const srcLayer = srcNode?.entity.knowledge_layer ?? "internal";
      const tgtLayer = tgtNode?.entity.knowledge_layer ?? "internal";
      const isCrossLayer = srcLayer !== tgtLayer;

      result.push({
        source: src,
        target: tgt,
        edge,
        isBridge,
        isCrossLayer,
        label: getEdgeLabel(relType),
        edgeColor: isBridge
          ? (EDGE_TYPE_COLORS[relType] ?? "#EF9F27")
          : undefined,
      });
    };

    for (const edge of bridgeEdges) tryAdd(edge, true);
    for (const edge of externalEdges) tryAdd(edge, false);
    // Scale internal edge limit with graph size — don't silently drop connectivity.
    // Internal edges include expansion pathway edges (SC_→SC_) that create real graph density.
    const internalLimit = compact
      ? Math.max(40, nodes.length * 3)
      : Math.max(100, nodes.length * 5);
    // Prioritize high-strength/high-confidence edges when limit is reached
    const sortedInternal = [...internalEdges].sort((a, b) => {
      const scoreA = (a.strength ?? 0.5) * (a.confidence ?? 0.5);
      const scoreB = (b.strength ?? 0.5) * (b.confidence ?? 0.5);
      return scoreB - scoreA;
    });
    for (const edge of sortedInternal.slice(0, internalLimit)) tryAdd(edge, false);

    return result;
  }, [nodes, bridgeEdges, internalEdges, externalEdges, compact]);

  // ── D3 simulation ──

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Defs
    const defs = svg.append("defs");

    // Glow filter
    const glowFilter = defs.append("filter").attr("id", "orbital-glow");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
    glowFilter.append("feMerge")
      .selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .join("feMergeNode")
      .attr("in", (d) => d);

    // Arrow markers for bridge + cross-layer edges
    const markerColors = ["#22C55E", "#EF4444", "#3B82F6", "#8B5CF6", "#F97316", "#007AFF", "#0EA5E9", "#EF9F27", "#94A3B8", "#14B8A6"];
    for (const color of markerColors) {
      defs.append("marker")
        .attr("id", `arrow-${color.replace("#", "")}`)
        .attr("viewBox", "0 -4 8 8")
        .attr("refX", 8)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-3L8,0L0,3")
        .attr("fill", color)
        .attr("opacity", 0.7);
    }

    // Main group with zoom
    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .filter((event) => {
        if (event.type === "wheel" || event.type === "touchstart") return true;
        const target = event.target as Element;
        if (target.closest?.(".node-group")) return false;
        return true;
      })
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });

    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity.translate(centerX, centerY));

    // ── Ring guides ──
    const ringGuides = g.append("g").attr("class", "ring-guides");

    if (externalOnly) {
      // External-only mode: show two adaptive rings instead of the standard 4
      const adaptiveRings = [
        { label: "High Confidence", radius: 100 * scale, color: "#7F77DD" },
        { label: "Landscape",       radius: 280 * scale, color: "#86868B" },
      ];
      for (const ring of adaptiveRings) {
        if (ring.radius < 5) continue;
        ringGuides
          .append("circle")
          .attr("cx", 0).attr("cy", 0).attr("r", ring.radius)
          .attr("fill", "none")
          .attr("stroke", ring.color)
          .attr("stroke-width", 0.5)
          .attr("stroke-dasharray", "4 6")
          .attr("opacity", 0.2);

        ringGuides
          .append("text")
          .attr("x", 0)
          .attr("y", -ring.radius - 4)
          .attr("text-anchor", "middle")
          .attr("font-size", compact ? "7px" : "10px")
          .attr("font-weight", "600")
          .attr("fill", ring.color)
          .attr("opacity", compact ? 0.35 : 0.5)
          .text(ring.label);
      }
    } else {
      for (const [key, config] of Object.entries(RING_CONFIG)) {
        if (key === "core") continue;
        const r = config.radius * scale;
        if (r < 5) continue; // Skip if ring is too small due to density scaling

        ringGuides
          .append("circle")
          .attr("cx", 0).attr("cy", 0).attr("r", r)
          .attr("fill", "none")
          .attr("stroke", config.color)
          .attr("stroke-width", 0.5)
          .attr("stroke-dasharray", "4 6")
          .attr("opacity", 0.2);

        // Ring labels — always shown (smaller in compact)
        ringGuides
          .append("text")
          .attr("x", 0)
          .attr("y", -r - 4)
          .attr("text-anchor", "middle")
          .attr("font-size", compact ? "7px" : "10px")
          .attr("font-weight", "600")
          .attr("fill", config.color)
          .attr("opacity", compact ? 0.35 : 0.5)
          .text(config.label);
      }
    }

    // ── Cluster boundary rings ──
    // For parent nodes that have SC_ children, draw a faint dashed circle showing expansion area
    const CLUSTER_RADIUS = 25 * scale; // satellite orbit distance (also used by cluster force)
    const clusterBoundaryGroup = g.append("g").attr("class", "cluster-boundaries");
    const parentIdsWithChildren = new Set(nodes.filter((n) => n.parentNodeId).map((n) => n.parentNodeId!));
    const parentNodesWithClusters = nodes.filter((n) => parentIdsWithChildren.has(n.id));

    const clusterBoundaries = clusterBoundaryGroup
      .selectAll("circle")
      .data(parentNodesWithClusters)
      .join("circle")
      .attr("r", CLUSTER_RADIUS + 10 * scale)
      .attr("fill", "none")
      .attr("stroke", (d) => d.strokeColor)
      .attr("stroke-width", 0.8)
      .attr("stroke-dasharray", "3 3")
      .attr("opacity", 0.2);

    // ── Edges ──
    const linkGroup = g.append("g").attr("class", "links");

    // Edge lines
    const linkElements = linkGroup
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("cursor", (d) => d.isBridge ? "pointer" : "default")
      .on("click", (event, d) => {
        event.stopPropagation();
        if (!d.isBridge || !onEdgeClickRef.current) return;
        const srcId = typeof d.source === "object" ? (d.source as OrbitalNode).id : d.source;
        const tgtId = typeof d.target === "object" ? (d.target as OrbitalNode).id : d.target;
        const srcEntity = [...internalEntities, ...externalEntities].find((e) => e.entity_id === srcId);
        const tgtEntity = [...internalEntities, ...externalEntities].find((e) => e.entity_id === tgtId);
        if (srcEntity && tgtEntity) onEdgeClickRef.current(d.edge, srcEntity, tgtEntity);
      })
      .attr("stroke", (d) => {
        if (d.edgeColor) return d.edgeColor;
        if (d.isBridge) return "#EF9F27";
        // SC_ internal edges: subtle gray
        const srcId = typeof d.source === "object" ? (d.source as OrbitalNode).id : (d.source as string);
        const tgtId = typeof d.target === "object" ? (d.target as OrbitalNode).id : (d.target as string);
        const isSCInternal = srcId.startsWith("SC_") && tgtId.startsWith("SC_");
        const isSCParent = d.edge.relationship_type === "has_component";
        if (isSCInternal || isSCParent) return "#D1D5DB";
        // Cross-layer non-bridge edges get a teal tint for visibility
        if (d.isCrossLayer) return "#14B8A6";
        const srcNode = nodes.find((n) => n.id === srcId);
        if (srcNode && srcNode.ring !== "core") return srcNode.strokeColor ?? "#A5B4C8";
        return "#D1D5DB";
      })
      .attr("stroke-width", (d) => {
        // SC_ internal edges: thinner
        const srcId = typeof d.source === "object" ? (d.source as OrbitalNode).id : (d.source as string);
        const tgtId = typeof d.target === "object" ? (d.target as OrbitalNode).id : (d.target as string);
        const isSCInternal = srcId.startsWith("SC_") && tgtId.startsWith("SC_");
        const isSCParent = d.edge.relationship_type === "has_component";
        if (isSCInternal || isSCParent) return 0.5 * scale;
        if (d.isBridge) return 2 * scale;
        // Cross-layer edges are slightly thicker than same-layer
        if (d.isCrossLayer) return 1.2 * scale;
        return 0.8 * scale;
      })
      .attr("stroke-dasharray", (d) => {
        if (d.isBridge) return "";
        // Cross-layer non-bridge edges: alternating dash pattern
        if (d.isCrossLayer) return "5 3 2 3";
        return "3 4";
      })
      .attr("opacity", (d) => {
        // SC_ internal edges: hidden by default, shown on hover
        const srcId = typeof d.source === "object" ? (d.source as OrbitalNode).id : (d.source as string);
        const tgtId = typeof d.target === "object" ? (d.target as OrbitalNode).id : (d.target as string);
        const isSCInternal = srcId.startsWith("SC_") && tgtId.startsWith("SC_");
        const isSCParent = d.edge.relationship_type === "has_component";
        if (isSCInternal || isSCParent) return 0;
        if (d.isBridge) return 0.65;
        // Cross-layer edges are more visible than same-layer
        if (d.isCrossLayer) return 0.5;
        // When no bridge edges exist, boost external edges to be the primary visual
        return bridgeEdges.length === 0 ? 0.5 : 0.25;
      })
      .attr("marker-end", (d) => {
        if (!d.isBridge && !d.isCrossLayer) return "";
        const color = d.edgeColor ?? (d.isCrossLayer ? "#14B8A6" : "#EF9F27");
        return `url(#arrow-${color.replace("#", "")})`;
      });

    // Edge labels for bridge + cross-layer edges (fullscreen only, or compact with few)
    const labelableLinks = links.filter((l) => (l.isBridge || l.isCrossLayer) && l.label);
    const showEdgeLabels = !compact || labelableLinks.length <= 6;
    const edgeLabelGroup = g.append("g").attr("class", "edge-labels");

    if (showEdgeLabels) {
      edgeLabelGroup
        .selectAll("text")
        .data(labelableLinks)
        .join("text")
        .attr("class", "edge-label")
        .attr("text-anchor", "middle")
        .attr("font-size", compact ? "6px" : "8px")
        .attr("font-weight", "500")
        .attr("fill", (d) => d.edgeColor ?? (d.isCrossLayer ? "#14B8A6" : "#EF9F27"))
        .attr("opacity", 0.7)
        .text((d) => d.label ?? "");
    }

    // ── Bridge edge label chips (fullscreen only) ──
    // Small rounded label chips at bridge edge midpoints: "A1 → C3"
    const bridgeLabelGroup = g.append("g").attr("class", "bridge-label-chips");
    const bridgeLinksForChips = !compact ? links.filter((l) => l.isBridge) : [];

    if (bridgeLinksForChips.length > 0) {
      const chipGroups = bridgeLabelGroup
        .selectAll("g")
        .data(bridgeLinksForChips)
        .join("g")
        .attr("class", "bridge-label-chip")
        .attr("opacity", 0.7);

      // Rounded rect background
      chipGroups
        .append("rect")
        .attr("rx", 4)
        .attr("ry", 4)
        .attr("height", 14)
        .attr("fill", "#FFFFFF")
        .attr("stroke", (d) => d.edgeColor ?? "#EF9F27")
        .attr("stroke-width", 0.5)
        .attr("opacity", 0.9);

      // Label text: sourceId → targetId
      chipGroups
        .append("text")
        .attr("class", "bridge-chip-text")
        .attr("text-anchor", "middle")
        .attr("dy", 10)
        .attr("font-size", "7px")
        .attr("font-weight", "600")
        .attr("fill", (d) => d.edgeColor ?? "#EF9F27")
        .text((d) => {
          const srcId = typeof d.source === "object" ? (d.source as OrbitalNode).id : (d.source as string);
          const tgtId = typeof d.target === "object" ? (d.target as OrbitalNode).id : (d.target as string);
          // Shorten IDs: take last meaningful segment
          const shortSrc = srcId.split("_").pop() ?? srcId;
          const shortTgt = tgtId.split("_").pop() ?? tgtId;
          return `${shortSrc} \u2192 ${shortTgt}`;
        });

      // Size the rect to fit the text (post-render adjustment in tick)
      chipGroups.each(function () {
        const group = d3.select(this);
        const textEl = group.select("text").node() as SVGTextElement | null;
        if (textEl) {
          const bbox = textEl.getBBox();
          group.select("rect")
            .attr("width", bbox.width + 8)
            .attr("x", -(bbox.width + 8) / 2)
            .attr("y", 0);
        }
      });
    }

    // ── Nodes ──
    const nodeGroup = g.append("g").attr("class", "nodes");
    const nodeElements = nodeGroup
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", "node-group")
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        onNodeClickRef.current?.(d.entity);
      })
      .on("mouseenter", function (_, d) {
        onNodeHoverRef.current?.(d.entity);
        setHoveredNode(d);

        // Determine cluster context: if hovering a parent or SC_ child,
        // collect all node IDs in that cluster for edge visibility
        const clusterParentId = d.parentNodeId ?? (parentIdsWithChildren.has(d.id) ? d.id : null);
        const clusterNodeIds = clusterParentId
          ? new Set([clusterParentId, ...nodes.filter((n) => n.parentNodeId === clusterParentId).map((n) => n.id)])
          : new Set<string>();

        linkElements.attr("opacity", (l) => {
          const src = typeof l.source === "object" ? (l.source as OrbitalNode).id : String(l.source);
          const tgt = typeof l.target === "object" ? (l.target as OrbitalNode).id : String(l.target);
          // Direct connections to hovered node
          if (src === d.id || tgt === d.id) return 0.95;
          // SC_ internal/component edges: show when hovering cluster
          const isSCEdge = (src.startsWith("SC_") && tgt.startsWith("SC_")) || l.edge.relationship_type === "has_component";
          if (isSCEdge && clusterNodeIds.size > 0 && (clusterNodeIds.has(src) || clusterNodeIds.has(tgt))) return 0.55;
          return l.isBridge ? 0.1 : 0.03;
        }).attr("stroke-width", (l) => {
          const src = typeof l.source === "object" ? (l.source as OrbitalNode).id : String(l.source);
          const tgt = typeof l.target === "object" ? (l.target as OrbitalNode).id : String(l.target);
          if (src === d.id || tgt === d.id) return 3 * scale;
          // SC_ edges in hovered cluster: slightly thicker than default
          const isSCEdge = (src.startsWith("SC_") && tgt.startsWith("SC_")) || l.edge.relationship_type === "has_component";
          if (isSCEdge && clusterNodeIds.size > 0 && (clusterNodeIds.has(src) || clusterNodeIds.has(tgt))) return 0.8 * scale;
          return l.isBridge ? 0.8 * scale : 0.3 * scale;
        });

        // Highlight cluster boundary on hover
        clusterBoundaries.attr("opacity", (n) => {
          if (clusterParentId && n.id === clusterParentId) return 0.45;
          return 0.2;
        });

        // Show edge labels for connected edges
        edgeLabelGroup.selectAll<SVGTextElement, OrbitalLink>(".edge-label")
          .attr("opacity", (l) => {
            const src = typeof l.source === "object" ? (l.source as OrbitalNode).id : l.source;
            const tgt = typeof l.target === "object" ? (l.target as OrbitalNode).id : l.target;
            return (src === d.id || tgt === d.id) ? 1 : 0.2;
          })
          .attr("font-size", (l) => {
            const src = typeof l.source === "object" ? (l.source as OrbitalNode).id : l.source;
            const tgt = typeof l.target === "object" ? (l.target as OrbitalNode).id : l.target;
            return (src === d.id || tgt === d.id) ? (compact ? "7px" : "10px") : (compact ? "6px" : "8px");
          });

        // Show bridge label chips for connected bridge edges
        bridgeLabelGroup.selectAll<SVGGElement, OrbitalLink>(".bridge-label-chip")
          .attr("opacity", (l) => {
            const src = typeof l.source === "object" ? (l.source as OrbitalNode).id : l.source;
            const tgt = typeof l.target === "object" ? (l.target as OrbitalNode).id : l.target;
            return (src === d.id || tgt === d.id) ? 1 : 0.3;
          });

        nodeElements.select(".node-circle").attr("opacity", (n) => {
          if (n.id === d.id) return 1;
          // SC_ cluster siblings: highlight too
          if (clusterNodeIds.size > 0 && clusterNodeIds.has(n.id)) return 0.9;
          const connected = links.some((l) => {
            const src = typeof l.source === "object" ? (l.source as OrbitalNode).id : l.source;
            const tgt = typeof l.target === "object" ? (l.target as OrbitalNode).id : l.target;
            return (src === d.id && tgt === n.id) || (tgt === d.id && src === n.id);
          });
          return connected ? 1 : 0.15;
        });
      })
      .on("mouseleave", () => {
        onNodeHoverRef.current?.(null);
        setHoveredNode(null);
        linkElements
          .attr("opacity", (d) => {
            // SC_ internal edges: hidden again on mouseleave
            const srcId = typeof d.source === "object" ? (d.source as OrbitalNode).id : (d.source as string);
            const tgtId = typeof d.target === "object" ? (d.target as OrbitalNode).id : (d.target as string);
            const isSCEdge = (srcId.startsWith("SC_") && tgtId.startsWith("SC_")) || d.edge.relationship_type === "has_component";
            if (isSCEdge) return 0;
            if (d.isBridge) return 0.65;
            if (d.isCrossLayer) return 0.5;
            return bridgeEdges.length === 0 ? 0.5 : 0.2;
          })
          .attr("stroke-width", (d) => {
            const srcId = typeof d.source === "object" ? (d.source as OrbitalNode).id : (d.source as string);
            const tgtId = typeof d.target === "object" ? (d.target as OrbitalNode).id : (d.target as string);
            const isSCEdge = (srcId.startsWith("SC_") && tgtId.startsWith("SC_")) || d.edge.relationship_type === "has_component";
            if (isSCEdge) return 0.5 * scale;
            if (d.isBridge) return 2 * scale;
            if (d.isCrossLayer) return 1.2 * scale;
            return 0.8 * scale;
          });
        clusterBoundaries.attr("opacity", 0.2);
        edgeLabelGroup.selectAll(".edge-label").attr("opacity", 0.7).attr("font-size", compact ? "6px" : "8px");
        bridgeLabelGroup.selectAll(".bridge-label-chip").attr("opacity", (d: unknown) => !compact ? 0.7 : 0);
        nodeElements.select(".node-circle").attr("opacity", (d) => d.opacity);
      });

    // Hit area
    nodeElements
      .append("circle")
      .attr("class", "hit-area")
      .attr("r", (d) => Math.max(d.nodeRadius + 4, 10 * scale))
      .attr("fill", "transparent")
      .attr("stroke", "none");

    // Node circles
    nodeElements
      .append("circle")
      .attr("class", "node-circle")
      .attr("r", (d) => d.nodeRadius)
      .attr("fill", (d) => d.color)
      .attr("stroke", (d) => d.strokeColor)
      .attr("stroke-width", (d) =>
        d.ring === "core" ? 2 * scale
        : d.tier === "embedded" ? 2.5 * scale
        : 1 * scale
      )
      .attr("stroke-dasharray", (d) =>
        d.tier === "observatory" && d.ring === "landscape" ? "2 2" : ""
      )
      .attr("opacity", (d) => d.opacity);

    // Embedded glow ring
    nodeElements
      .filter((d) => d.tier === "embedded" && d.ring !== "core")
      .append("circle")
      .attr("class", "embedded-glow")
      .attr("r", (d) => d.nodeRadius + 4 * scale)
      .attr("fill", "none")
      .attr("stroke", "#007AFF")
      .attr("stroke-width", 1 * scale)
      .attr("opacity", 0.35);

    // Materialized indicator (inner dot)
    nodeElements
      .filter((d) => d.isMaterialized === true)
      .append("circle")
      .attr("r", 2.5 * scale)
      .attr("fill", "#06B6D4")
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .attr("cx", (d) => d.nodeRadius * 0.6)
      .attr("cy", (d) => -d.nodeRadius * 0.6);

    // Selection ring
    nodeElements
      .append("circle")
      .attr("class", "selection-ring")
      .attr("r", (d) => d.nodeRadius + 5)
      .attr("fill", "none")
      .attr("stroke", "#007AFF")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "3 2")
      .attr("opacity", 0);

    // Role indicators for core nodes
    nodeElements
      .filter((d) => d.ring === "core" && d.entity.is_master_bottleneck)
      .append("circle")
      .attr("r", (d) => d.nodeRadius + 4)
      .attr("fill", "none")
      .attr("stroke", "#E24B4A")
      .attr("stroke-width", 2.5 * scale);

    nodeElements
      .filter((d) => d.ring === "core" && d.entity.is_leverage_point && !d.entity.is_master_bottleneck)
      .append("circle")
      .attr("r", (d) => d.nodeRadius + 3)
      .attr("fill", "none")
      .attr("stroke", "#EF9F27")
      .attr("stroke-width", 1.5 * scale)
      .attr("stroke-dasharray", "3 2");

    // Category icon inside node (both modes — key visual cue)
    nodeElements
      .filter((d) => d.ring !== "core" && !!d.category)
      .append("text")
      .attr("dy", 1)
      .attr("text-anchor", "middle")
      .attr("font-size", (d) => `${Math.max(d.nodeRadius * 0.8, 8)}px`)
      .text((d) => CATEGORY_CONFIG[d.category!]?.icon ?? "");

    // Primary label (name) — cleaned, word-boundary truncated
    nodeElements
      .append("text")
      .attr("class", "node-label")
      .attr("dy", (d) => d.nodeRadius + (compact ? 9 : 14))
      .attr("text-anchor", "middle")
      .attr("font-size", compact ? "7px" : (d) => d.ring === "core" ? "10px" : "9px")
      .attr("font-weight", (d) => d.ring === "core" || d.tier === "embedded" ? "600" : "400")
      .attr("fill", (d) => d.ring === "core" ? "#1F2937" : d.tier === "embedded" ? "#312E81" : "#6B7280")
      .attr("opacity", compact ? 0.7 : 0.9)
      .text((d) => {
        const name = cleanEntityName(d.entity);
        const maxLen = compact ? 16 : 22;
        return truncateLabel(name, maxLen);
      });

    // Secondary label (confidence + authority) — fullscreen only, or compact for embedded
    if (!compact) {
      nodeElements
        .filter((d) => d.ring !== "core")
        .append("text")
        .attr("class", "node-sublabel")
        .attr("dy", (d) => d.nodeRadius + 24)
        .attr("text-anchor", "middle")
        .attr("font-size", "7px")
        .attr("font-weight", "400")
        .attr("fill", "#9CA3AF")
        .attr("opacity", 0.7)
        .text((d) => {
          const parts: string[] = [];
          if (d.isMaterialized) parts.push("Signal");
          else if (d.confidence !== undefined) parts.push(`${Math.round(d.confidence * 100)}%`);
          if (d.authority) parts.push(d.authority.charAt(0).toUpperCase() + d.authority.slice(1, 3));
          if (d.tier === "embedded") parts.push("Emb");
          return parts.join(" · ");
        });
    }

    // Tier indicator badge (compact mode — small dot)
    if (compact) {
      nodeElements
        .filter((d) => d.tier === "embedded" && d.ring !== "core")
        .append("circle")
        .attr("r", 2 * scale)
        .attr("fill", "#007AFF")
        .attr("cx", (d) => -d.nodeRadius * 0.6)
        .attr("cy", (d) => -d.nodeRadius * 0.6);
    }

    // Tooltip title
    nodeElements
      .append("title")
      .text((d) => {
        const name = cleanEntityName(d.entity);
        const ring = RING_CONFIG[d.ring].label;
        const cat = d.category ? CATEGORY_CONFIG[d.category]?.label ?? "" : "";
        const conf = d.entity.confidence ? ` (${Math.round(d.entity.confidence * 100)}%)` : "";
        const roles: string[] = [];
        if (d.entity.is_master_bottleneck) roles.push("Bottleneck");
        if (d.entity.is_leverage_point) roles.push("Leverage");
        if (d.entity.is_risk_point) roles.push("Risk");
        const roleStr = roles.length > 0 ? `\n${roles.join(", ")}` : "";
        const tierStr = d.tier ? `\nTier: ${d.tier}` : "";
        const materializedStr = d.isMaterialized ? "\nMaterialized Signal" : "";
        return `${name}${conf}\n${ring}${cat ? ` · ${cat}` : ""}${roleStr}${tierStr}${materializedStr}`;
      });

    // ── Force simulation ──
    // Wider collision, adaptive link distance, stronger charge for density
    const nodeCount = nodes.length;
    const chargeStrength = nodeCount < 10 ? -30 : nodeCount < 20 ? -20 : -12;

    // Build parent node lookup for cluster force
    const nodeById = new Map<string, OrbitalNode>();
    for (const n of nodes) nodeById.set(n.id, n);

    // Custom cluster force: pulls SC_ children toward their parent node position
    function clusterForce(alpha: number) {
      for (const d of nodes) {
        if (!d.parentNodeId) continue;
        const parent = nodeById.get(d.parentNodeId);
        if (!parent || parent.x == null || parent.y == null) continue;
        const dx = (parent.x ?? 0) - (d.x ?? 0);
        const dy = (parent.y ?? 0) - (d.y ?? 0);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Pull toward parent but maintain CLUSTER_RADIUS offset
        const targetDist = CLUSTER_RADIUS;
        const strength = alpha * 0.6;
        if (dist > targetDist * 1.5) {
          // Too far — pull inward
          d.vx = (d.vx ?? 0) + dx * strength * 0.3;
          d.vy = (d.vy ?? 0) + dy * strength * 0.3;
        } else if (dist < targetDist * 0.3) {
          // Too close — push outward slightly
          d.vx = (d.vx ?? 0) - dx * strength * 0.1;
          d.vy = (d.vy ?? 0) - dy * strength * 0.1;
        }
      }
    }

    // Materialized nodes should be pulled toward their connected entities
    // rather than sitting at their ring radius — weaken radial for them
    const simulation = d3
      .forceSimulation<OrbitalNode>(nodes)
      .force(
        "radial",
        d3.forceRadial<OrbitalNode>(
          (d) => d.targetRadius,
          0, 0,
        ).strength((d) => {
          // SC_ cluster children: very weak radial — cluster force dominates
          if (d.parentNodeId) return 0.05;
          // Materialized signals that have bridge links: weaken radial so link force dominates
          if (d.isMaterialized) {
            const hasLinks = links.some((l) => {
              const src = typeof l.source === "string" ? l.source : (l.source as OrbitalNode).id;
              const tgt = typeof l.target === "string" ? l.target : (l.target as OrbitalNode).id;
              return src === d.id || tgt === d.id;
            });
            return hasLinks ? 0.25 : 0.6;
          }
          return 0.75;
        })
      )
      .force(
        "collide",
        d3.forceCollide<OrbitalNode>()
          .radius((d) => {
            // SC_ cluster children: smaller collision radius for tight clustering
            if (d.parentNodeId) return d.nodeRadius + (compact ? 6 : 10);
            return d.nodeRadius + (compact ? 14 : 28);
          })
          .strength(0.85)
          .iterations(3)
      )
      .force(
        "link",
        d3.forceLink<OrbitalNode, OrbitalLink>(links)
          .id((d) => d.id)
          .distance((d) => {
            // SC_ internal edges: very short distance for tight clustering
            const srcNode = typeof d.source === "object" ? d.source as OrbitalNode : null;
            const tgtNode = typeof d.target === "object" ? d.target as OrbitalNode : null;
            if (srcNode?.parentNodeId && tgtNode?.parentNodeId) return 15 * scale;
            // has_component edges (parent→SC_): short distance
            if (srcNode?.parentNodeId || tgtNode?.parentNodeId) return 20 * scale;
            // Shorter distance for materialized signal bridges so they cluster near parents
            const hasMaterialized = srcNode?.isMaterialized || tgtNode?.isMaterialized;
            if (hasMaterialized) return 35 * scale;
            return d.isBridge ? 60 * scale : 25 * scale;
          })
          .strength((d) => {
            const srcNode = typeof d.source === "object" ? d.source as OrbitalNode : null;
            const tgtNode = typeof d.target === "object" ? d.target as OrbitalNode : null;
            // SC_ internal edges: strong pull to keep cluster tight
            if (srcNode?.parentNodeId && tgtNode?.parentNodeId) return 0.8;
            if (srcNode?.parentNodeId || tgtNode?.parentNodeId) return 0.6;
            const hasMaterialized = srcNode?.isMaterialized || tgtNode?.isMaterialized;
            if (hasMaterialized) return 0.5; // Strong pull to cluster near parent
            return d.isBridge ? 0.15 : 0.05;
          })
      )
      .force("charge", d3.forceManyBody().strength((d: d3.SimulationNodeDatum) => {
        // SC_ children: weaker charge repulsion for tighter clusters
        if ((d as OrbitalNode).parentNodeId) return (chargeStrength * 0.3) * scale;
        return chargeStrength * scale;
      }))
      .force("cluster", clusterForce)
      .alpha(0.8)
      .alphaDecay(0.02)
      .on("tick", () => {
        linkElements
          .attr("x1", (d) => (d.source as OrbitalNode).x ?? 0)
          .attr("y1", (d) => (d.source as OrbitalNode).y ?? 0)
          .attr("x2", (d) => (d.target as OrbitalNode).x ?? 0)
          .attr("y2", (d) => (d.target as OrbitalNode).y ?? 0);

        // Edge labels positioned at midpoint
        edgeLabelGroup.selectAll<SVGTextElement, OrbitalLink>(".edge-label")
          .attr("x", (d) => {
            const sx = (d.source as OrbitalNode).x ?? 0;
            const tx = (d.target as OrbitalNode).x ?? 0;
            return (sx + tx) / 2;
          })
          .attr("y", (d) => {
            const sy = (d.source as OrbitalNode).y ?? 0;
            const ty = (d.target as OrbitalNode).y ?? 0;
            return ((sy + ty) / 2) - 4;
          });

        // Cluster boundary circles follow parent nodes
        clusterBoundaries
          .attr("cx", (d) => d.x ?? 0)
          .attr("cy", (d) => d.y ?? 0);

        // Bridge label chips positioned at edge midpoints
        bridgeLabelGroup.selectAll<SVGGElement, OrbitalLink>(".bridge-label-chip")
          .attr("transform", (d) => {
            const sx = (d.source as OrbitalNode).x ?? 0;
            const sy = (d.source as OrbitalNode).y ?? 0;
            const tx = (d.target as OrbitalNode).x ?? 0;
            const ty = (d.target as OrbitalNode).y ?? 0;
            return `translate(${(sx + tx) / 2},${((sy + ty) / 2) - 10})`;
          });

        nodeElements.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    simulationRef.current = simulation;

    return () => { simulation.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, scale, width, height, centerX, centerY, compact, externalOnly, bridgeEdges.length]);

  // ── Expanded edge highlight ──
  useEffect(() => {
    if (!svgRef.current || !expandedEdgeId) return;
    const svg = d3.select(svgRef.current);
    // Highlight the expanded edge with a pulsing glow
    svg.selectAll<SVGLineElement, OrbitalLink>("line")
      .attr("stroke-width", (d) => {
        const edgeId = d.edge?.id ?? `${d.edge?.source_entity_id}_${d.edge?.target_entity_id}`;
        if (edgeId === expandedEdgeId) return 4 * scale;
        if (d.isBridge) return 2 * scale;
        if (d.isCrossLayer) return 1.2 * scale;
        return 0.8 * scale;
      })
      .attr("opacity", (d) => {
        const edgeId = d.edge?.id ?? `${d.edge?.source_entity_id}_${d.edge?.target_entity_id}`;
        if (edgeId === expandedEdgeId) return 1;
        if (d.isBridge) return 0.3;
        if (d.isCrossLayer) return 0.25;
        return 0.1;
      });
  }, [expandedEdgeId, scale]);

  // ── Selection highlight ──
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGCircleElement, OrbitalNode>(".node-circle")
      .attr("filter", (d) => selectedEntityId === d.id ? "url(#orbital-glow)" : "");

    svg.selectAll<SVGCircleElement, OrbitalNode>(".selection-ring")
      .attr("opacity", (d) => selectedEntityId === d.id ? 0.8 : 0);
  }, [selectedEntityId]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: compact ? 380 : "100%" }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        className="select-none"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,122,255,0.04) 0%, rgba(139,92,246,0.02) 40%, transparent 70%)" }}
      />

      {/* Compact overlay: entity count + tier breakdown */}
      {compact && (
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 text-[9px] font-medium text-gray-500 backdrop-blur-sm border border-gray-200/50">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
          {externalEntities.length} external
          <span className="text-gray-300">|</span>
          {internalEntities.filter((e) => entityRingMap.get(e.entity_id) === "core").length} core
          <span className="text-gray-300">|</span>
          <span className="text-blue-500">{nodes.filter((n) => n.tier === "embedded").length} emb</span>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="pointer-events-none absolute top-2 right-2 z-10 max-w-[220px] rounded-lg border border-gray-200 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-sm">
          <div className="text-[11px] font-semibold text-gray-800">{cleanEntityName(hoveredNode.entity)}</div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[8px] text-gray-500">
            <span className="rounded-full px-1.5 py-0.5 font-medium border" style={{ backgroundColor: hoveredNode.color, color: hoveredNode.strokeColor, borderColor: hoveredNode.strokeColor }}>
              {RING_CONFIG[hoveredNode.ring].label}
            </span>
            {hoveredNode.category && (
              <span className="rounded-full px-1.5 py-0.5 bg-gray-100 text-gray-600">
                {CATEGORY_CONFIG[hoveredNode.category]?.icon} {CATEGORY_CONFIG[hoveredNode.category]?.label}
              </span>
            )}
          </div>
          {hoveredNode.tier && hoveredNode.ring !== "core" && (
            <div className="mt-1.5 flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${hoveredNode.tier === "embedded" ? "bg-blue-500" : "bg-purple-300"}`} />
              <span className={`text-[8px] font-semibold ${hoveredNode.tier === "embedded" ? "text-blue-600" : "text-purple-400"}`}>
                {hoveredNode.tier === "embedded" ? "Embedded Intel" : "Observatory"}
              </span>
              {hoveredNode.isMaterialized && (
                <span className="text-[7px] text-cyan-500 font-medium">| Materialized Signal</span>
              )}
            </div>
          )}
          {hoveredNode.confidence !== undefined && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1">
                <div className="flex items-center justify-between text-[7px] text-gray-400 mb-0.5">
                  <span>Confidence</span>
                  <span className="font-medium text-gray-600">{Math.round(hoveredNode.confidence * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-gray-300 to-blue-400"
                    style={{ width: `${hoveredNode.confidence * 100}%` }}
                  />
                </div>
              </div>
              {hoveredNode.authority && (
                <span className={`rounded px-1 py-0.5 text-[7px] font-medium ${
                  hoveredNode.authority === "high" ? "bg-green-100 text-green-700" :
                  hoveredNode.authority === "moderate" ? "bg-blue-100 text-blue-700" :
                  "bg-gray-100 text-gray-500"
                }`}>
                  {hoveredNode.authority}
                </span>
              )}
            </div>
          )}
          {hoveredNode.entity.description && (
            <p className="mt-1.5 text-[8px] leading-snug text-gray-400 line-clamp-3">{hoveredNode.entity.description}</p>
          )}
          {/* Connected edges summary */}
          {(() => {
            const connectedBridges = links.filter((l) => {
              const src = typeof l.source === "object" ? (l.source as OrbitalNode).id : l.source;
              const tgt = typeof l.target === "object" ? (l.target as OrbitalNode).id : l.target;
              return l.isBridge && (src === hoveredNode.id || tgt === hoveredNode.id);
            });
            if (connectedBridges.length === 0) return null;
            return (
              <div className="mt-1.5 border-t border-gray-100 pt-1.5">
                <div className="text-[7px] font-semibold text-gray-500 mb-0.5">Bridges ({connectedBridges.length})</div>
                {connectedBridges.slice(0, 3).map((b, i) => {
                  const tgtId = typeof b.target === "object" ? (b.target as OrbitalNode).id : b.target;
                  const srcId = typeof b.source === "object" ? (b.source as OrbitalNode).id : b.source;
                  const otherId = srcId === hoveredNode.id ? tgtId : srcId;
                  const otherNode = nodes.find((n) => n.id === otherId);
                  return (
                    <div key={i} className="text-[7px] text-gray-400 flex items-center gap-1">
                      <span style={{ color: b.edgeColor ?? "#EF9F27" }}>{b.label || "bridge"}</span>
                      <span className="text-gray-300">→</span>
                      <span className="text-gray-600 font-medium truncate">{otherNode ? cleanEntityName(otherNode.entity) : otherId}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <div className="mt-1.5 text-[7px] text-blue-400 font-medium">Click to inspect →</div>
        </div>
      )}
    </div>
  );
}
