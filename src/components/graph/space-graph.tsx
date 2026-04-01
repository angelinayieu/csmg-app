"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { GraphNode } from "./graph-node";
import { GraphEdge } from "./graph-edge";
import { EdgeExplanationPopover } from "./edge-explanation-popover";
import type { Entity, Edge, Cycle } from "@/types";

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
  visibleDimensions?: Set<string>;
  spaceDescription?: string;
}

export function SpaceGraph({
  entities,
  edges,
  cycles,
  onNodeClick,
  visibleDimensions,
  spaceDescription = "",
}: SpaceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [clickedEdge, setClickedEdge] = useState<{ edge: Edge; position: { x: number; y: number } } | null>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  // Build entity UUID → SimNode lookup
  const entityMap = useRef(new Map<string, SimNode>());

  // Initialize simulation
  useEffect(() => {
    if (entities.length === 0) return;

    // Create nodes from entities
    const simNodes: SimNode[] = entities.map((e) => ({
      entity: e,
      id: e.id,
      x: e.graph_x ?? undefined,
      y: e.graph_y ?? undefined,
    }));

    // Build lookup
    const lookup = new Map<string, SimNode>();
    for (const node of simNodes) {
      lookup.set(node.id, node);
    }
    entityMap.current = lookup;

    // Create links from edges (only for visible dimensions)
    const simLinks: SimLink[] = edges
      .filter((e) => {
        if (visibleDimensions && !visibleDimensions.has(e.dimension)) return false;
        return lookup.has(e.source_entity_id) && lookup.has(e.target_entity_id);
      })
      .map((e) => ({
        source: lookup.get(e.source_entity_id)!,
        target: lookup.get(e.target_entity_id)!,
        edge: e,
      }));

    // Create simulation
    const width = svgRef.current?.clientWidth ?? 800;
    const height = svgRef.current?.clientHeight ?? 600;

    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "charge",
        d3.forceManyBody<SimNode>().strength(-200)
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius(40)
      )
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(120)
          .strength(0.5)
      )
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05));

    simulation.on("tick", () => {
      setNodes([...simNodes]);
      setLinks([...simLinks]);
    });

    // Run simulation for a bit then slow down
    simulation.alpha(1).restart();
    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [entities, edges, visibleDimensions]);

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

    // Double-click to reset
    d3.select(svgRef.current).on("dblclick.zoom", () => {
      d3.select(svgRef.current!).transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    });

    return () => {
      d3.select(svgRef.current!).on(".zoom", null);
    };
  }, []);

  // Drag behavior
  const handleDragStart = useCallback(
    (nodeId: string, event: React.MouseEvent) => {
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
    },
    [transform.k]
  );

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

  return (
    <div className="relative h-full w-full">
    <svg
      ref={svgRef}
      className="h-full w-full"
      style={{ background: "transparent" }}
      onClick={() => setClickedEdge(null)}
    >
      <g
        transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
      >
        {/* Edges */}
        {links.map((link) => {
          const src = link.source as SimNode;
          const tgt = link.target as SimNode;
          const edgeId = link.edge.id;
          const isDimmed =
            hasHover && !connectedEdgeIds.has(edgeId);

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
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isDimmed =
            hasHover && !neighborIds.has(node.id);
          const isNeighbor =
            hasHover && neighborIds.has(node.id) && node.id !== hoveredNodeId;

          return (
            <GraphNode
              key={node.id}
              entity={node.entity}
              x={node.x ?? 0}
              y={node.y ?? 0}
              isHovered={hoveredNodeId === node.id}
              isNeighbor={isNeighbor}
              isDimmed={isDimmed}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onClick={() => onNodeClick(node.entity)}
            />
          );
        })}
      </g>
    </svg>

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
