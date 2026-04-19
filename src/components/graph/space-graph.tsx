"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { GraphNode } from "./graph-node";
import { GraphEdge } from "./graph-edge";
import { EdgeExplanationPopover } from "./edge-explanation-popover";
import type { Entity, Edge, Cycle } from "@/types";
import type { InteractionMetadata } from "@/types/interactions";
import type { LayoutType, MapLayoutResult, LayeredLayoutResult, SphereLayoutResult, DimensionalLayoutResult } from "@/lib/graph/layout-engine";
import { computeDagreLayout, computeMapLayout, computeLayeredLayout, computeSphereLayout, computeDimensionalLayout } from "@/lib/graph/layout-engine";
import { edgeDimensionStyles } from "@/lib/design-tokens";
import { computeEntityScoresMap } from "@/lib/graph/compute-entity-scores";
import { getNodeColor } from "@/lib/design-tokens";

interface SimNode extends d3.SimulationNodeDatum {
  entity: Entity;
  id: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  edge: Edge;
}

interface SpaceGraphProps {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  onNodeClick: (entity: Entity) => void;
  /** Double-click on a node — typically navigates to the entity detail page */
  onNodeDoubleClick?: (entity: Entity) => void;
  visibleDimensions?: Set<string>;
  spaceDescription?: string;
  domainMap?: Record<string, { name: string; index: number }>;
  /** Layout type — "force" (default), "flowchart", "hierarchy", "causal" */
  layoutType?: LayoutType;
  /** Interaction metadata from synthesis — powers field strength glow, tension zones, corridor edges */
  interactionMetadata?: InteractionMetadata | null;
  /** Currently selected entity UUID — auto-pan to this node on layout switch */
  selectedEntityId?: string | null;
}

export function SpaceGraph({
  entities,
  edges,
  cycles,
  onNodeClick,
  onNodeDoubleClick,
  visibleDimensions,
  spaceDescription = "",
  domainMap,
  layoutType = "force",
  interactionMetadata = null,
  selectedEntityId = null,
}: SpaceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  // Sphere-layout focus node (only meaningful when layoutType === "sphere")
  const [sphereFocusId, setSphereFocusId] = useState<string | null>(null);

  // Reset sphere focus when leaving sphere layout so re-entering starts fresh
  useEffect(() => {
    if (layoutType !== "sphere") {
      setSphereFocusId(null);
    }
  }, [layoutType]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [clickedEdge, setClickedEdge] = useState<{ edge: Edge; position: { x: number; y: number } } | null>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const rafRef = useRef<number>(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const transitionRafRef = useRef<number>(0);
  // Store previous node positions for layout transition animation
  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Build entity UUID → SimNode lookup
  const entityMap = useRef(new Map<string, SimNode>());

  // Build cycle intervention point map: entity_id → cycle classification
  // This identifies which entities are the leverage/intervention point of a detected feedback loop
  const cycleInterventionMap = useMemo(() => {
    const map = new Map<string, Cycle["classification"]>();
    for (const cycle of cycles) {
      if (cycle.intervention_point_entity_id) {
        // Store by entity_id (the semantic ID like "E01") not UUID
        map.set(cycle.intervention_point_entity_id, cycle.classification);
      }
    }
    return map;
  }, [cycles]);

  // Build set of edge IDs that are part of cycles (for visual highlighting)
  const cycleEdgeIds = useMemo(() => {
    const set = new Set<string>();
    for (const edge of edges) {
      if (edge.is_part_of_cycle) {
        set.add(edge.id);
      }
    }
    return set;
  }, [edges]);

  // Interaction field maps — computed from synthesis interaction_metadata
  const fieldStrengthMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!interactionMetadata?.fields) return map;
    for (const f of interactionMetadata.fields) {
      map.set(f.entity_id, f.field_strength);
    }
    return map;
  }, [interactionMetadata]);

  const tensionZoneMap = useMemo(() => {
    const map = new Map<string, number>(); // entity_id → tension_magnitude
    if (!interactionMetadata?.tension_zones) return map;
    for (const tz of interactionMetadata.tension_zones) {
      map.set(tz.entity_id, tz.tension_magnitude);
    }
    return map;
  }, [interactionMetadata]);

  // Build degree map: entity UUID → connection count (for connectivity-tier sizing)
  const { degreeMap, maxDegree } = useMemo(() => {
    const map = new Map<string, number>();
    for (const entity of entities) map.set(entity.id, 0);
    for (const edge of edges) {
      if (visibleDimensions && !visibleDimensions.has(edge.dimension)) continue;
      map.set(edge.source_entity_id, (map.get(edge.source_entity_id) ?? 0) + 1);
      map.set(edge.target_entity_id, (map.get(edge.target_entity_id) ?? 0) + 1);
    }
    let max = 0;
    for (const v of map.values()) if (v > max) max = v;
    return { degreeMap: map, maxDegree: max };
  }, [entities, edges, visibleDimensions]);

  // Entity scores: abstraction tier + signal strength for layered view + noise fading
  const entityScoresMap = useMemo(
    () => computeEntityScoresMap(entities, edges, visibleDimensions),
    [entities, edges, visibleDimensions],
  );

  // Build corridor edge set: edges that appear in any strategic corridor path
  const corridorEdgeMap = useMemo(() => {
    const map = new Map<string, "enabling" | "constraining" | "complex">();
    if (!interactionMetadata?.strategic_corridors) return map;
    // Build a lookup: "sourceEntityId->targetEntityId" → edge.id
    const edgeLookup = new Map<string, string>();
    for (const edge of edges) {
      edgeLookup.set(`${edge.source_entity_id}->${edge.target_entity_id}`, edge.id);
      // Also reverse for undirected matching
      edgeLookup.set(`${edge.target_entity_id}->${edge.source_entity_id}`, edge.id);
    }
    for (const corridor of interactionMetadata.strategic_corridors) {
      for (let i = 0; i < corridor.path.length - 1; i++) {
        const key = `${corridor.path[i]}->${corridor.path[i + 1]}`;
        const edgeId = edgeLookup.get(key);
        if (edgeId) {
          map.set(edgeId, corridor.polarity);
        }
      }
    }
    return map;
  }, [interactionMetadata, edges]);

  // Build convergence node map: entity_id → convergence depth (for layered view highlighting)
  const convergenceNodeMap = useMemo(() => {
    const map = new Map<string, { depth: string; branchCount: number }>();
    if (!interactionMetadata?.convergences) return map;
    for (const c of interactionMetadata.convergences) {
      map.set(c.shared_element.entity_id, {
        depth: c.depth,
        branchCount: c.converging_branches.length,
      });
    }
    return map;
  }, [interactionMetadata]);

  // ── DAGRE LAYOUT (flowchart / hierarchy / causal) ──
  const dagreResult = useMemo(() => {
    if (layoutType === "force" || layoutType === "dense" || layoutType === "map" || layoutType === "layered" || layoutType === "sphere" || layoutType === "dimensional" || entities.length === 0) return null;
    return computeDagreLayout(entities, edges, layoutType as Exclude<LayoutType, "force" | "dense" | "map" | "layered" | "sphere" | "dimensional">, {
      visibleDimensions,
      nodeWidth: 50,
      nodeHeight: 50,
    });
  }, [entities, edges, layoutType, visibleDimensions]);

  // ── MAP LAYOUT (constellation territories) ──
  const mapResult = useMemo((): MapLayoutResult | null => {
    if (layoutType !== "map" || entities.length === 0) return null;
    const width = svgRef.current?.clientWidth ?? 1200;
    const height = svgRef.current?.clientHeight ?? 800;
    return computeMapLayout(entities, edges, { width, height, visibleDimensions });
  }, [entities, edges, layoutType, visibleDimensions]);

  // ── LAYERED LAYOUT (importance-tier lanes × category columns) ──
  const layeredResult = useMemo((): LayeredLayoutResult | null => {
    if (layoutType !== "layered" || entities.length === 0) return null;
    const width = svgRef.current?.clientWidth ?? 1400;
    const height = svgRef.current?.clientHeight ?? 900;
    return computeLayeredLayout(entities, edges, {
      width,
      height,
      visibleDimensions,
      entityScores: entityScoresMap,
    });
  }, [entities, edges, layoutType, visibleDimensions, entityScoresMap]);

  // ── SPHERE LAYOUT (radial view around a focus node) ──
  const sphereResult = useMemo((): SphereLayoutResult | null => {
    if (layoutType !== "sphere" || entities.length === 0) return null;
    const width = svgRef.current?.clientWidth ?? 1200;
    const height = svgRef.current?.clientHeight ?? 900;
    return computeSphereLayout(entities, edges, {
      width,
      height,
      visibleDimensions,
      focusEntityId: sphereFocusId ?? undefined,
    });
  }, [entities, edges, layoutType, visibleDimensions, sphereFocusId]);

  // ── DIMENSIONAL LAYOUT (hierarchical bands: systems / domains / threads) ──
  // Purpose-built for hierarchical graphs. Places each layer in its own
  // horizontal band with children under their parent, making the composes
  // spine visible at a glance.
  const dimensionalResult = useMemo((): DimensionalLayoutResult | null => {
    if (layoutType !== "dimensional" || entities.length === 0) return null;
    return computeDimensionalLayout(entities, edges, { visibleDimensions });
  }, [entities, edges, layoutType, visibleDimensions]);

  // ── FORCE LAYOUT ──
  useEffect(() => {
    if (entities.length === 0) return;

    // For Dagre layouts, we still create nodes/links for rendering but positions come from Dagre
    const simNodes: SimNode[] = entities.map((e) => {
      const dagreNode = dagreResult?.nodes.get(e.id);
      const mapNode = mapResult?.nodes.get(e.id);
      const layeredNode = layeredResult?.nodes.get(e.id);
      const sphereNode = sphereResult?.nodes.get(e.id);
      const dimensionalNode = dimensionalResult?.nodes.get(e.id);
      return {
        entity: e,
        id: e.id,
        x: dimensionalNode?.x ?? sphereNode?.x ?? mapNode?.x ?? layeredNode?.x ?? dagreNode?.x ?? e.graph_x ?? undefined,
        y: dimensionalNode?.y ?? sphereNode?.y ?? mapNode?.y ?? layeredNode?.y ?? dagreNode?.y ?? e.graph_y ?? undefined,
      };
    });

    // Build lookup — index by BOTH UUID (e.id) and entity_id (e.g. "X1")
    // Edges normally reference UUIDs, but fallback to entity_id for robustness
    const lookup = new Map<string, SimNode>();
    for (const node of simNodes) {
      lookup.set(node.id, node);
      if (node.entity.entity_id) {
        lookup.set(node.entity.entity_id, node);
      }
    }
    entityMap.current = lookup;

    // Create links from edges (only for visible dimensions)
    const simLinks: SimLink[] = edges
      .filter((e) => {
        if (visibleDimensions && !visibleDimensions.has(e.dimension)) return false;
        const hasSource = lookup.has(e.source_entity_id);
        const hasTarget = lookup.has(e.target_entity_id);
        if (!hasSource || !hasTarget) {
          console.warn(`[SpaceGraph] Edge ${e.id} filtered: source=${e.source_entity_id} (${hasSource ? 'found' : 'MISSING'}), target=${e.target_entity_id} (${hasTarget ? 'found' : 'MISSING'})`);
        }
        return hasSource && hasTarget;
      })
      .map((e) => ({
        source: lookup.get(e.source_entity_id)!,
        target: lookup.get(e.target_entity_id)!,
        edge: e,
      }));

    if (layoutType !== "force") {
      // Stop any running simulation
      simulationRef.current?.stop();
      simulationRef.current = null;
      cancelAnimationFrame(transitionRafRef.current);

      // Check if we have old positions to animate from
      const prevPos = prevPositionsRef.current;
      const hasPrev = prevPos.size > 0;

      if (hasPrev) {
        // Animate from previous positions to new target positions over 400ms
        const targetMap = new Map<string, { x: number; y: number }>();
        for (const n of simNodes) {
          targetMap.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
        }
        const startTime = performance.now();
        const duration = 400;
        const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // cubic ease-in-out

        const animate = (now: number) => {
          const elapsed = now - startTime;
          const raw = Math.min(elapsed / duration, 1);
          const t = ease(raw);

          for (const n of simNodes) {
            const prev = prevPos.get(n.id);
            const target = targetMap.get(n.id);
            if (prev && target) {
              n.x = prev.x + (target.x - prev.x) * t;
              n.y = prev.y + (target.y - prev.y) * t;
            }
          }
          setNodes([...simNodes]);
          if (raw < 1) {
            transitionRafRef.current = requestAnimationFrame(animate);
          } else {
            // Animation complete — save final positions
            const finalPos = new Map<string, { x: number; y: number }>();
            for (const n of simNodes) finalPos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
            prevPositionsRef.current = finalPos;
          }
        };
        setLinks([...simLinks]);
        transitionRafRef.current = requestAnimationFrame(animate);
      } else {
        // No previous positions — set directly
        setNodes([...simNodes]);
        setLinks([...simLinks]);
        // Save positions for next transition
        const posMap = new Map<string, { x: number; y: number }>();
        for (const n of simNodes) posMap.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
        prevPositionsRef.current = posMap;
      }
      return;
    }

    // Force layout — run D3 simulation
    // Use fallback dimensions that are reasonable even if SVG hasn't laid out yet
    const rawWidth = svgRef.current?.clientWidth;
    const rawHeight = svgRef.current?.clientHeight;
    const width = rawWidth && rawWidth > 100 ? rawWidth : 800;
    const height = rawHeight && rawHeight > 100 ? rawHeight : 600;

    // Seed initial positions near center so nodes don't start at (0,0)
    for (const node of simNodes) {
      if (node.x == null || node.x === 0) node.x = width / 2 + (Math.random() - 0.5) * width * 0.5;
      if (node.y == null || node.y === 0) node.y = height / 2 + (Math.random() - 0.5) * height * 0.5;
    }

    // Adaptive parameters based on graph density
    const nodeCount = simNodes.length;
    const linkCount = simLinks.length;
    const density = nodeCount > 0 ? linkCount / nodeCount : 0;
    const isSparse = density < 1.5 || nodeCount < 15;

    // Sparse graphs: weaker repulsion, shorter links, stronger centering → compact cluster
    // Dense graphs: stronger repulsion, longer links → spread out to avoid overlap
    // Very large graphs (80+): STRONG repulsion + wide links + label-aware collision
    const isLarge = nodeCount > 80;
    const isMassive = nodeCount > 120;
    const chargeStrength = isSparse ? -120 : isMassive ? -600 : isLarge ? -500 : nodeCount > 30 ? -300 : -200;
    const linkDistance = isSparse ? 80 : isMassive ? 240 : isLarge ? 200 : nodeCount > 30 ? 150 : 110;
    const linkStrength = isSparse ? 0.8 : isMassive ? 0.2 : isLarge ? 0.25 : 0.5;
    const centerStrength = isSparse ? 0.15 : isMassive ? 0.012 : isLarge ? 0.02 : 0.05;
    // Collision radius includes label height (~25px below node)
    const collisionRadius = isSparse ? 35 : isMassive ? 58 : isLarge ? 52 : 45;

    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "charge",
        d3.forceManyBody<SimNode>().strength((d) => {
          // Hub nodes get much stronger repulsion to claim visual space
          const deg = degreeMap.get(d.id) ?? 0;
          const ratio = deg / Math.max(maxDegree, 1);
          if (ratio >= 0.6 || deg >= 5) return chargeStrength * 2;
          if (ratio >= 0.3 || deg >= 3) return chargeStrength * 1.4;
          return chargeStrength;
        }).distanceMax(isMassive ? 600 : isLarge ? 500 : 400)
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((d) => {
          // Collision includes label height (~25px below node) to prevent text overlap
          const deg = degreeMap.get(d.id) ?? 0;
          const labelPad = 20; // approximate label height padding
          if (deg >= 5) return collisionRadius * 1.5 + labelPad;
          if (deg >= 3) return collisionRadius * 1.1 + labelPad;
          return collisionRadius * 0.8 + labelPad * 0.7;
        }).strength(0.9).iterations(isLarge ? 3 : 2)
      )
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(linkDistance)
          .strength(linkStrength)
      )
      .force("x", d3.forceX(width / 2).strength(centerStrength))
      .force("y", d3.forceY(height / 2).strength(centerStrength));

    // Alpha decay: large graphs need more iterations to settle, not fewer
    const alphaDecay = isMassive ? 0.025 : isLarge ? 0.03 : nodeCount > 30 ? 0.04 : 0.0228;
    const alphaMin = 0.008;

    simulation
      .alphaDecay(alphaDecay)
      .alphaMin(alphaMin)
      .velocityDecay(isLarge ? 0.45 : 0.4);

    simulation.on("tick", () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setNodes([...simNodes]);
        setLinks([...simLinks]);
        // Save positions for layout transition animation
        const posMap = new Map<string, { x: number; y: number }>();
        for (const n of simNodes) posMap.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
        prevPositionsRef.current = posMap;
      });
    });

    // Stop updating React state once simulation has settled
    simulation.on("end", () => {
      cancelAnimationFrame(rafRef.current);
      // Final position snapshot
      setNodes([...simNodes]);
      setLinks([...simLinks]);
    });

    simulation.alpha(1).restart();
    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(transitionRafRef.current);
    };
  }, [entities, edges, visibleDimensions, layoutType, dagreResult, mapResult, layeredResult, sphereResult, dimensionalResult, degreeMap, maxDegree]);

  // ResizeObserver — recenter simulation when SVG container gets its real dimensions
  useEffect(() => {
    if (!svgRef.current) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width < 100 || height < 100) return; // Skip tiny/collapsed sizes

      // Debounce resize to avoid restarting simulation repeatedly
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (simulationRef.current && layoutType === "force") {
          simulationRef.current
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("x", d3.forceX(width / 2).strength(0.1))
            .force("y", d3.forceY(height / 2).strength(0.1))
            .alpha(0.15) // Lower alpha so it settles faster after resize
            .restart();
        }
      }, 200);
    });

    observer.observe(svgRef.current);
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      observer.disconnect();
    };
  }, [layoutType]);

  // Zoom behavior
  useEffect(() => {
    if (!svgRef.current) return;

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        setTransform(event.transform);
      });

    d3.select(svgRef.current).call(zoom);
    zoomRef.current = zoom;

    // Auto-fit for static layouts (Dagre, Map, Layered)
    const staticResult = dagreResult ?? mapResult ?? layeredResult ?? sphereResult ?? dimensionalResult;
    if (layoutType !== "force" && staticResult && svgRef.current) {
      const svgW = svgRef.current.clientWidth;
      const svgH = svgRef.current.clientHeight;
      const gW = staticResult.width;
      const gH = staticResult.height;
      const scale = Math.min(svgW / gW, svgH / gH, 1.2) * 0.9;
      const tx = (svgW - gW * scale) / 2;
      const ty = (svgH - gH * scale) / 2;
      let initialTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);

      // Auto-pan to selected node if one is active
      if (selectedEntityId) {
        const targetNode = staticResult.nodes.get(selectedEntityId);
        if (targetNode) {
          const panScale = scale;
          const panTx = svgW / 2 - targetNode.x * panScale;
          const panTy = svgH / 2 - targetNode.y * panScale;
          initialTransform = d3.zoomIdentity.translate(panTx, panTy).scale(panScale);
        }
      }

      d3.select(svgRef.current).call(zoom.transform, initialTransform);
    }

    // Double-click to reset
    d3.select(svgRef.current).on("dblclick.zoom", () => {
      d3.select(svgRef.current!).transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    });

    return () => {
      d3.select(svgRef.current!).on(".zoom", null);
    };
  }, [layoutType, dagreResult, mapResult, layeredResult, sphereResult, dimensionalResult, selectedEntityId]);

  // Drag behavior — only for force layout (Dagre positions are fixed)
  const handleDragStart = useCallback(
    (nodeId: string, event: React.MouseEvent) => {
      if (layoutType !== "force") return; // No dragging in Dagre layouts
      if (!simulationRef.current) return;
      const node = entityMap.current.get(nodeId);
      if (!node) return;

      simulationRef.current.alphaTarget(0.3).restart();
      node.fx = node.x;
      node.fy = node.y;

      const startX = event.clientX;
      const startY = event.clientY;

      const handleMove = (e: MouseEvent) => {
        const dx = (e.clientX - startX) / transform.k;
        const dy = (e.clientY - startY) / transform.k;
        node.fx = (node.x ?? 0) + dx;
        node.fy = (node.y ?? 0) + dy;
      };

      const handleUp = () => {
        simulationRef.current?.alphaTarget(0);
        node.fx = null;
        node.fy = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);

      dragCleanupRef.current = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
    },
    [transform.k, layoutType]
  );

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  // Compute neighbor set for hover highlighting
  const neighborIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();
  if (hoveredNodeId) {
    for (const link of links) {
      const src =
        typeof link.source === "object" ? (link.source as SimNode).id : "";
      const tgt =
        typeof link.target === "object" ? (link.target as SimNode).id : "";
      if (src === hoveredNodeId || tgt === hoveredNodeId) {
        neighborIds.add(src);
        neighborIds.add(tgt);
        connectedEdgeIds.add(link.edge.id);
      }
    }
    neighborIds.add(hoveredNodeId);
  }

  const hasHover = hoveredNodeId !== null;

  const handleExplanationCached = useCallback((edgeId: string, explanation: string) => {
    // Update the edge in local state so subsequent clicks don't re-fetch
    setLinks((prev) =>
      prev.map((l) =>
        l.edge.id === edgeId
          ? { ...l, edge: { ...l.edge, conditions: explanation } }
          : l
      )
    );
  }, []);

  // ── Edge path rendering for Dagre layouts ──
  // For Dagre, we draw curved paths that look like proper flowchart connectors
  const isDagre = layoutType !== "force" && layoutType !== "map" && layoutType !== "layered" && layoutType !== "sphere" && layoutType !== "dimensional";
  const isStaticLayout = layoutType !== "force";

  // ── Force view: cluster bubble ellipses behind each category group ──
  const clusterBubbles = useMemo(() => {
    if (layoutType !== "force" || nodes.length === 0) return [];
    const groups = new Map<string, { xs: number[]; ys: number[] }>();
    for (const node of nodes) {
      const cat = node.entity.entity_category;
      if (!groups.has(cat)) groups.set(cat, { xs: [], ys: [] });
      const g = groups.get(cat)!;
      if (node.x != null) g.xs.push(node.x);
      if (node.y != null) g.ys.push(node.y);
    }
    return Array.from(groups.entries())
      .filter(([, g]) => g.xs.length >= 2)
      .map(([category, g]) => {
        const cx = g.xs.reduce((a, b) => a + b, 0) / g.xs.length;
        const cy = g.ys.reduce((a, b) => a + b, 0) / g.ys.length;
        const rx = Math.max(...g.xs.map(x => Math.abs(x - cx))) + 50;
        const ry = Math.max(...g.ys.map(y => Math.abs(y - cy))) + 50;
        return { category, cx, cy, rx, ry };
      });
  }, [layoutType, nodes]);

  // Check for disconnected graph state
  const externalCount = entities.filter(e => e.knowledge_layer === "external").length;
  const allExternal = entities.length > 0 && externalCount === entities.length;
  // When most entities are external, render them at full opacity/color instead of faded
  const externalAsPrimary = entities.length > 0 && externalCount > entities.length * 0.5;
  const noConnections = links.length === 0 && nodes.length > 0;

  return (
    <div className="relative h-full w-full">
      {/* Disconnected graph warning */}
      {noConnections && nodes.length > 1 && (
        <div className="absolute top-3 left-3 right-3 z-10 rounded-lg border border-amber-200 bg-amber-50/95 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-start gap-2">
            <span className="text-amber-500 text-sm mt-0.5">⚠</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-800">
                No connections between entities
              </p>
              <p className="text-[11px] text-amber-600 mt-0.5 leading-relaxed">
                {allExternal
                  ? "These are external research entities with no relationships mapped yet. Re-run research to generate connections, or run decomposition first to create your core analysis graph."
                  : "Entities exist but no edges connect them. This may indicate a pipeline issue — try re-running the analysis."
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {/* External-only graph notice */}
      {allExternal && links.length > 0 && (
        <div className="absolute top-3 left-3 z-10 rounded-md bg-blue-50/90 border border-blue-200 px-3 py-1.5 text-[10px] text-blue-700 backdrop-blur-sm">
          Showing external research entities only — run decomposition to see your core analysis graph
        </div>
      )}

      {/* Layout type indicator */}
      {isStaticLayout && (
        <div className="absolute top-2 left-2 z-10 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-[9px] font-medium text-gray-500 backdrop-blur-sm">
          {layoutType === "map" ? "Constellation Map" :
           layoutType === "layered" ? "Layered Decomposition" :
           layoutType === "sphere" ? (
             sphereResult?.focusEntityId
               ? `Sphere · ${entities.find(e => e.id === sphereResult.focusEntityId)?.name?.slice(0, 40) ?? "focus"}`
               : "Sphere of Connection"
           ) :
           layoutType === "flowchart" ? "Flowchart View" :
           layoutType === "hierarchy" ? "Hierarchy View" :
           "Causal Flow View"}
        </div>
      )}

      {/* Sphere view: hint to click a node to refocus */}
      {layoutType === "sphere" && sphereResult && (
        <div className="absolute top-2 right-2 z-10 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-[9px] font-medium text-gray-500 backdrop-blur-sm">
          Click any node to refocus · {sphereResult.rings.length} dimensions · {sphereResult.unconnectedIds.length} unconnected
        </div>
      )}

    <svg
      ref={svgRef}
      className="h-full w-full"
      style={{ background: "transparent" }}
      onClick={() => setClickedEdge(null)}
    >
      {/* Arrow marker definitions for Dagre layouts */}
      {isDagre && (
        <defs>
          <marker
            id="dagre-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8" />
          </marker>
          <marker
            id="dagre-arrow-hover"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3B82F6" />
          </marker>
        </defs>
      )}

      <g
        transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
      >
        {/* ── Force view: cluster bubble backgrounds ── */}
        {layoutType === "force" && clusterBubbles.map((bubble) => {
          const colors = getNodeColor(bubble.category);
          return (
            <ellipse
              key={`bubble-${bubble.category}`}
              cx={bubble.cx}
              cy={bubble.cy}
              rx={bubble.rx}
              ry={bubble.ry}
              fill={colors.fill}
              fillOpacity={0.03}
              stroke={colors.stroke}
              strokeOpacity={0.08}
              strokeWidth={0.8}
              strokeDasharray="6 4"
              style={{ pointerEvents: "none" }}
            />
          );
        })}

        {/* ── Dimensional view: band backgrounds + labels ── */}
        {layoutType === "dimensional" && dimensionalResult && (
          <g style={{ pointerEvents: "none" }}>
            {dimensionalResult.bands.map((band, idx) => {
              const bandColors: Record<string, { fill: string; stroke: string; text: string }> = {
                system:     { fill: "#EEF2FF", stroke: "#A5B4FC", text: "#3730A3" },
                domain:     { fill: "#F0FDF4", stroke: "#86EFAC", text: "#166534" },
                thread:     { fill: "#FEF3C7", stroke: "#FCD34D", text: "#92400E" },
                fault:      { fill: "#FEE2E2", stroke: "#FCA5A5", text: "#991B1B" },
                unassigned: { fill: "#F9FAFB", stroke: "#E5E7EB", text: "#6B7280" },
              };
              const colors = bandColors[band.layer] ?? bandColors.unassigned;
              return (
                <g key={`band-${band.layer}-${idx}`}>
                  <rect
                    x={0}
                    y={band.y - 8}
                    width={dimensionalResult.width}
                    height={band.height + 8}
                    fill={colors.fill}
                    fillOpacity={0.3}
                    stroke={colors.stroke}
                    strokeOpacity={0.25}
                    strokeWidth={1}
                    strokeDasharray="4 6"
                  />
                  <text
                    x={16}
                    y={band.y + 8}
                    fontSize={11}
                    fontWeight={600}
                    fill={colors.text}
                    style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
                  >
                    {band.label} · {band.entityCount}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* ── Sphere view: dimension arcs (colored rings grouped by edge dimension) ── */}
        {layoutType === "sphere" && sphereResult && (() => {
          const cx = sphereResult.width / 2;
          const cy = sphereResult.height / 2;
          return (
            <g style={{ pointerEvents: "none" }}>
              {/* Outer "unconnected" ring */}
              {sphereResult.unconnectedIds.length > 0 && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={sphereResult.rings[0]?.radius ? sphereResult.rings[0].radius + 180 : 400}
                  fill="none"
                  stroke="#E5E7EB"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  opacity={0.5}
                />
              )}
              {/* Dimension arcs */}
              {sphereResult.rings.map((ring) => {
                const style = edgeDimensionStyles[ring.dimension];
                const color = style?.color ?? "#6B7280";
                const r = ring.radius;
                // Compute arc path
                const x1 = cx + Math.cos(ring.startAngle) * r;
                const y1 = cy + Math.sin(ring.startAngle) * r;
                const x2 = cx + Math.cos(ring.endAngle) * r;
                const y2 = cy + Math.sin(ring.endAngle) * r;
                const arcSpan = ring.endAngle - ring.startAngle;
                const largeArc = arcSpan > Math.PI ? 1 : 0;
                // Arc label at midpoint
                const midAngle = (ring.startAngle + ring.endAngle) / 2;
                const labelR = r + 22;
                const labelX = cx + Math.cos(midAngle) * labelR;
                const labelY = cy + Math.sin(midAngle) * labelR;
                return (
                  <g key={`ring-${ring.dimension}`}>
                    {/* Arc */}
                    <path
                      d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={3}
                      opacity={0.35}
                      strokeLinecap="round"
                    />
                    {/* Dimension label */}
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={10}
                      fontWeight={700}
                      fill={color}
                      letterSpacing="0.08em"
                      style={{ textTransform: "uppercase" }}
                    >
                      {ring.dimension}
                    </text>
                    {/* Count badge */}
                    <text
                      x={labelX}
                      y={labelY + 11}
                      textAnchor="middle"
                      fontSize={8}
                      fontWeight={500}
                      fill={color}
                      opacity={0.6}
                    >
                      {ring.entityIds.length} {ring.entityIds.length === 1 ? "node" : "nodes"}
                    </text>
                  </g>
                );
              })}
              {/* Focus crosshair */}
              <circle cx={cx} cy={cy} r={4} fill="#1D1D1F" opacity={0.6} />
              <circle
                cx={cx}
                cy={cy}
                r={sphereResult.rings[0]?.radius ?? 300}
                fill="none"
                stroke="#1D1D1F"
                strokeWidth={0.5}
                opacity={0.1}
              />
            </g>
          );
        })()}

        {/* ── Map view: territory ellipse backgrounds ── */}
        {layoutType === "map" && mapResult?.territories.map((territory) => {
          const colors = getNodeColor(territory.category);
          return (
            <g key={`territory-${territory.category}`}>
              <ellipse
                cx={territory.cx}
                cy={territory.cy}
                rx={territory.rx}
                ry={territory.ry}
                fill={colors.fill}
                fillOpacity={0.08}
                stroke={colors.stroke}
                strokeOpacity={0.2}
                strokeWidth={1.5}
                strokeDasharray="8 4"
                style={{ pointerEvents: "none" }}
              />
              <text
                x={territory.cx}
                y={territory.cy - territory.ry - 10}
                textAnchor="middle"
                fontSize={12}
                fontWeight={700}
                fill={colors.stroke}
                opacity={0.7}
                letterSpacing="0.05em"
                style={{ pointerEvents: "none", textTransform: "uppercase" }}
              >
                {territory.label}
              </text>
            </g>
          );
        })}

        {/* ── Layered view: lane backgrounds + column backgrounds ── */}
        {layoutType === "layered" && layeredResult && (
          <g style={{ pointerEvents: "none" }}>
            {/* Lane backgrounds (horizontal importance-tier bands) */}
            {layeredResult.lanes.map((lane, i) => (
              <g key={`lane-${lane.importance}`}>
                <rect
                  x={0}
                  y={lane.y - lane.height / 2}
                  width={layeredResult.width}
                  height={lane.height}
                  fill={i % 2 === 0 ? "rgba(0,0,0,0.02)" : "transparent"}
                />
                <line
                  x1={0}
                  y1={lane.y - lane.height / 2}
                  x2={layeredResult.width}
                  y2={lane.y - lane.height / 2}
                  stroke="#E5E7EB"
                  strokeWidth={0.5}
                  strokeDasharray="4 4"
                />
                <text
                  x={30}
                  y={lane.y - lane.height / 2 + 16}
                  fontSize={9.5}
                  fontWeight={700}
                  fill="#9CA3AF"
                  letterSpacing="0.06em"
                >
                  {lane.label.toUpperCase()}
                  {lane.importance === "fundamental" && (
                    <tspan dx={8} fontWeight={500} fontSize={8.5} letterSpacing="0.02em"> — WHAT WE WANT TO ACHIEVE</tspan>
                  )}
                  {lane.importance === "critical" && (
                    <tspan dx={8} fontWeight={500} fontSize={8.5} letterSpacing="0.02em"> — HOW WE APPROACH IT</tspan>
                  )}
                  {lane.importance === "important" && (
                    <tspan dx={8} fontWeight={500} fontSize={8.5} letterSpacing="0.02em"> — WHY IT WORKS</tspan>
                  )}
                  {lane.importance === "moderate" && (
                    <tspan dx={8} fontWeight={500} fontSize={8.5} letterSpacing="0.02em"> — IRREDUCIBLE TRUTHS AND OUTPUTS</tspan>
                  )}
                </text>
              </g>
            ))}
            {/* Direction guide — left: ↓ Analysis, right: ↑ Synthesis */}
            <g opacity={0.45}>
              {/* Left side — Analysis arrow */}
              <line x1={6} y1={60} x2={6} y2={layeredResult.height - 20} stroke="#6B7280" strokeWidth={1} markerEnd="url(#layered-arrow-down)" />
              <text x={14} y={layeredResult.height / 2} fontSize={8} fontWeight={600} fill="#6B7280" letterSpacing="0.06em" transform={`rotate(-90, 14, ${layeredResult.height / 2})`} textAnchor="middle" style={{ textTransform: "uppercase" }}>
                ↓ Analysis · Decompose
              </text>
              {/* Right side — Synthesis arrow */}
              <line x1={layeredResult.width - 6} y1={layeredResult.height - 20} x2={layeredResult.width - 6} y2={60} stroke="#6B7280" strokeWidth={1} markerEnd="url(#layered-arrow-up)" />
              <text x={layeredResult.width - 14} y={layeredResult.height / 2} fontSize={8} fontWeight={600} fill="#6B7280" letterSpacing="0.06em" transform={`rotate(90, ${layeredResult.width - 14}, ${layeredResult.height / 2})`} textAnchor="middle" style={{ textTransform: "uppercase" }}>
                ↑ Synthesis · Compose
              </text>
            </g>
            {/* Arrow markers for direction guide */}
            <defs>
              <marker id="layered-arrow-down" viewBox="0 0 10 6" refX="5" refY="3" markerWidth="8" markerHeight="6" orient="auto">
                <path d="M0,0 L10,3 L0,6 Z" fill="#6B7280" />
              </marker>
              <marker id="layered-arrow-up" viewBox="0 0 10 6" refX="5" refY="3" markerWidth="8" markerHeight="6" orient="auto">
                <path d="M0,0 L10,3 L0,6 Z" fill="#6B7280" />
              </marker>
            </defs>

            {/* Column backgrounds (vertical category bands) */}
            {layeredResult.columns.map((col) => {
              const colors = getNodeColor(col.category);
              return (
                <g key={`col-${col.category}`}>
                  <rect
                    x={col.x - col.width / 2}
                    y={0}
                    width={col.width}
                    height={layeredResult.height}
                    fill={colors.fill}
                    fillOpacity={0.04}
                    rx={12}
                  />
                  <text
                    x={col.x}
                    y={24}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={colors.stroke}
                    letterSpacing="0.05em"
                    style={{ textTransform: "uppercase" }}
                  >
                    {col.label}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* Edges */}
        {links.map((link) => {
          const src = link.source as SimNode;
          const tgt = link.target as SimNode;
          const edgeId = link.edge.id;
          const isDimmed =
            hasHover && !connectedEdgeIds.has(edgeId);
          const isCrossCategory = src.entity.entity_category !== tgt.entity.entity_category;

          return (
            <GraphEdge
              key={edgeId}
              edge={link.edge}
              x1={src.x ?? 0}
              y1={src.y ?? 0}
              x2={tgt.x ?? 0}
              y2={tgt.y ?? 0}
              isDimmed={isDimmed}
              isHovered={hoveredEdgeId === edgeId}
              externalAsPrimary={externalAsPrimary}
              isCycleEdge={cycleEdgeIds.has(edgeId)}
              isCorridorEdge={corridorEdgeMap.has(edgeId)}
              corridorPolarity={corridorEdgeMap.get(edgeId)}
              isCrossCategoryEdge={isCrossCategory}
              showCrossBridgeLabel={layoutType === "map" && isCrossCategory && link.edge.confidence >= 0.7}
              onMouseEnter={() => setHoveredEdgeId(edgeId)}
              onMouseLeave={() => setHoveredEdgeId(null)}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                const svgRect = svgRef.current?.getBoundingClientRect();
                if (svgRect) {
                  setClickedEdge({
                    edge: link.edge,
                    position: {
                      x: e.clientX - svgRect.left,
                      y: e.clientY - svgRect.top,
                    },
                  });
                }
              }}
              layoutType={layoutType}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isDimmed =
            hasHover && !neighborIds.has(node.id);
          const isNeighbor =
            hasHover && neighborIds.has(node.id) && node.id !== hoveredNodeId;

          const interventionClassification = cycleInterventionMap.get(node.entity.entity_id);

          return (
            <GraphNode
              key={node.id}
              entity={node.entity}
              x={node.x ?? 0}
              y={node.y ?? 0}
              domainIndex={domainMap?.[node.entity.space_id]?.index}
              isHovered={hoveredNodeId === node.id}
              isNeighbor={isNeighbor}
              isDimmed={isDimmed}
              externalAsPrimary={externalAsPrimary}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onClick={() => {
                // In sphere mode, clicking a node refocuses the sphere on it
                if (layoutType === "sphere") {
                  setSphereFocusId(node.id);
                } else {
                  onNodeClick(node.entity);
                }
              }}
              onDoubleClick={
                onNodeDoubleClick ? () => onNodeDoubleClick(node.entity) : undefined
              }
              layoutType={layoutType}
              isCycleInterventionPoint={!!interventionClassification}
              cycleClassification={interventionClassification}
              fieldStrength={fieldStrengthMap.get(node.entity.entity_id) ?? 0}
              isTensionZone={tensionZoneMap.has(node.entity.entity_id)}
              tensionMagnitude={tensionZoneMap.get(node.entity.entity_id) ?? 0}
              degree={degreeMap.get(node.id) ?? 0}
              maxDegree={maxDegree}
              signalStrength={entityScoresMap.get(node.id)?.signalStrength ?? 1}
            />
          );
        })}

        {/* ── Convergence indicators (layered view) — multi-colored ring on convergence nodes ── */}
        {layoutType === "layered" && convergenceNodeMap.size > 0 && nodes.map((node) => {
          const conv = convergenceNodeMap.get(node.entity.id);
          if (!conv) return null;
          const nx = node.x ?? 0;
          const ny = node.y ?? 0;
          const depthColor = conv.depth === "L4" ? "#007AFF" : conv.depth === "L3" ? "#F59E0B" : conv.depth === "L2" ? "#8B5CF6" : "#6B7280";
          return (
            <g key={`conv-${node.id}`} transform={`translate(${nx},${ny})`} style={{ pointerEvents: "none" }}>
              <circle
                r={28}
                fill="none"
                stroke={depthColor}
                strokeWidth={2.5}
                strokeDasharray="4 2"
                opacity={0.7}
              />
              <g transform="translate(0,-32)">
                <rect
                  x={-20}
                  y={-7}
                  width={40}
                  height={14}
                  rx={4}
                  fill={depthColor}
                  opacity={0.9}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={8}
                  fontWeight={700}
                  fill="white"
                  letterSpacing="0.05em"
                >
                  {conv.depth} &cap;{conv.branchCount}
                </text>
              </g>
            </g>
          );
        })}
      </g>
    </svg>

    {/* Minimap — bottom-right overview for orientation in large graphs */}
    {nodes.length > 8 && (
      (() => {
        const mmW = 140;
        const mmH = 90;
        const pad = 10;
        // Compute bounding box of all nodes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes) {
          const nx = n.x ?? 0;
          const ny = n.y ?? 0;
          if (nx < minX) minX = nx;
          if (ny < minY) minY = ny;
          if (nx > maxX) maxX = nx;
          if (ny > maxY) maxY = ny;
        }
        const gW = Math.max(maxX - minX, 1);
        const gH = Math.max(maxY - minY, 1);
        const scale = Math.min((mmW - pad * 2) / gW, (mmH - pad * 2) / gH);
        const ox = pad + ((mmW - pad * 2) - gW * scale) / 2;
        const oy = pad + ((mmH - pad * 2) - gH * scale) / 2;
        // Viewport rectangle in minimap coords (inverse of current zoom transform)
        const svgW = svgRef.current?.clientWidth ?? 800;
        const svgH = svgRef.current?.clientHeight ?? 600;
        const invK = 1 / (transform.k || 1);
        const vpX = (-transform.x * invK - minX) * scale + ox;
        const vpY = (-transform.y * invK - minY) * scale + oy;
        const vpW = svgW * invK * scale;
        const vpH = svgH * invK * scale;
        return (
          <div
            className="absolute bottom-2 right-2 z-10 rounded-lg border border-gray-200 bg-white/90 backdrop-blur-sm shadow-sm"
            style={{ width: mmW, height: mmH, pointerEvents: "none" }}
          >
            <svg width={mmW} height={mmH}>
              {/* Node dots */}
              {nodes.map(n => {
                const cx = (((n.x ?? 0) - minX) * scale) + ox;
                const cy = (((n.y ?? 0) - minY) * scale) + oy;
                const colors = getNodeColor(n.entity.entity_category);
                return (
                  <circle
                    key={n.id}
                    cx={cx}
                    cy={cy}
                    r={1.5}
                    fill={colors.fill}
                    opacity={0.8}
                  />
                );
              })}
              {/* Viewport rectangle */}
              <rect
                x={Math.max(0, vpX)}
                y={Math.max(0, vpY)}
                width={Math.min(vpW, mmW)}
                height={Math.min(vpH, mmH)}
                fill="rgba(0,122,255,0.08)"
                stroke="#007AFF"
                strokeWidth={1}
                rx={2}
              />
            </svg>
          </div>
        );
      })()
    )}

    {/* Edge explanation popover */}
    {clickedEdge && (
      <EdgeExplanationPopover
        edge={clickedEdge.edge}
        entities={entities}
        position={clickedEdge.position}
        spaceDescription={spaceDescription}
        onClose={() => setClickedEdge(null)}
        onExplanationCached={handleExplanationCached}
      />
    )}
    </div>
  );
}
