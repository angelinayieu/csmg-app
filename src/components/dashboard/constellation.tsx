"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as d3 from "d3";
import { domainColors } from "@/lib/design-tokens";
import type { Space, Bridge } from "@/types";

interface ConstellationNode extends d3.SimulationNodeDatum {
  space: Space;
  id: string;
}

interface ConstellationLink extends d3.SimulationLinkDatum<ConstellationNode> {
  bridgeCount: number;
}

export function Constellation({
  spaces,
  bridges,
}: {
  spaces: Space[];
  bridges: Bridge[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const router = useRouter();
  const [nodes, setNodes] = useState<ConstellationNode[]>([]);
  const [links, setLinks] = useState<ConstellationLink[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const dimsRef = useRef({ width: 600, height: 280 });
  const rafRef = useRef<number>(0);

  const navigateToSpace = useCallback(
    (spaceId: string) => router.push(`/app/space/${spaceId}`),
    [router]
  );

  useEffect(() => {
    if (spaces.length === 0 || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 600;
    const height = svgRef.current.clientHeight || 280;
    dimsRef.current = { width, height };

    // Zoom/pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        setTransform(event.transform);
      });
    svg.call(zoom);

    // Build nodes with initial positions in a circle
    const simNodes: ConstellationNode[] = spaces.map((s, i) => {
      const angle = (2 * Math.PI * i) / spaces.length - Math.PI / 2;
      const r = Math.min(width, height) * 0.3;
      return {
        space: s,
        id: s.id,
        x: width / 2 + r * Math.cos(angle),
        y: height / 2 + r * Math.sin(angle),
      };
    });

    // Build links from bridges
    const pairCounts = new Map<string, number>();
    for (const bridge of bridges) {
      const key = [bridge.source_space_id, bridge.target_space_id].sort().join("-");
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }

    const simLinks: ConstellationLink[] = [];
    const nodeIdSet = new Set(simNodes.map((n) => n.id));
    for (const [key, count] of pairCounts) {
      const [a, b] = key.split("-");
      if (nodeIdSet.has(a) && nodeIdSet.has(b)) {
        simLinks.push({ source: a, target: b, bridgeCount: count });
      }
    }

    const padding = 50;
    const simulation = d3
      .forceSimulation<ConstellationNode>(simNodes)
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(50))
      .force("x", d3.forceX(width / 2).strength(0.1))
      .force("y", d3.forceY(height / 2).strength(0.1))
      .force(
        "link",
        d3.forceLink<ConstellationNode, ConstellationLink>(simLinks)
          .id((d) => d.id)
          .distance(120)
      );

    simulation.on("tick", () => {
      // Clamp nodes to visible area
      for (const node of simNodes) {
        node.x = Math.max(padding, Math.min(width - padding, node.x ?? width / 2));
        node.y = Math.max(padding, Math.min(height - padding, node.y ?? height / 2));
      }
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setNodes([...simNodes]);
        setLinks([...simLinks]);
      });
    });

    return () => {
      simulation.stop();
      cancelAnimationFrame(rafRef.current);
      svg.on(".zoom", null);
    };
  }, [spaces, bridges]);

  if (spaces.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-400">No spaces yet</div>;
  }

  return (
    <svg ref={svgRef} className="h-full w-full" style={{ cursor: "grab" }}>
      <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
        {/* Links */}
        {links.map((link, i) => {
          const src = link.source as ConstellationNode;
          const tgt = link.target as ConstellationNode;
          if (!src.x || !tgt.x) return null;
          const mx = ((src.x ?? 0) + (tgt.x ?? 0)) / 2;
          const my = ((src.y ?? 0) + (tgt.y ?? 0)) / 2;

          return (
            <g key={i}>
              <line
                x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                stroke="#B2EBF2" strokeWidth={1.5} strokeDasharray="4 3"
              />
              <text x={mx} y={my - 4} textAnchor="middle" fontSize={9} fill="#86868B">
                {link.bridgeCount} shared
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node, i) => {
          const color = domainColors[i % domainColors.length];
          const r = Math.max(18, Math.min(30, 14 + (node.space.entity_count ?? 0) * 0.4));
          const isHovered = hoveredId === node.id;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x ?? 0},${node.y ?? 0})`}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={(e) => { e.stopPropagation(); navigateToSpace(node.id); }}
              style={{ cursor: "pointer" }}
            >
              <circle
                r={isHovered ? r + 3 : r}
                fill={color.fill}
                stroke={color.stroke}
                strokeWidth={isHovered ? 2.5 : 1.5}
                style={{ transition: "all 200ms ease" }}
              />
              <text
                textAnchor="middle" dominantBaseline="central"
                fontSize={11} fontWeight={600} fill={color.stroke}
                style={{ pointerEvents: "none" }}
              >
                {node.space.space_prefix}
              </text>
              <text
                y={r + 14} textAnchor="middle"
                fontSize={10} fill="#48484A"
                style={{ pointerEvents: "none" }}
              >
                {node.space.name.length > 22
                  ? node.space.name.slice(0, 20) + "..."
                  : node.space.name}
              </text>
              <text
                y={r + 25} textAnchor="middle"
                fontSize={8} fill="#AEAEB2"
                style={{ pointerEvents: "none" }}
              >
                {node.space.entity_count} entities · {node.space.edge_count} edges
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
