"use client";

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import { useRouter } from "next/navigation";
import type { Space, Bridge } from "@/types";

interface MetaGraphProps {
  spaces: Space[];
  bridges: Bridge[];
}

interface SpaceNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  prefix: string;
  entityCount: number;
  maturity: string;
}

interface BridgeEdge extends d3.SimulationLinkDatum<SpaceNode> {
  id: string;
  sharedVariable: string;
  bridgeType: string;
}

const maturityColors: Record<string, string> = {
  actionable_now: "#34C759",
  waiting_on_dependency: "#FF9500",
  theoretical: "#AF52DE",
  blocked: "#FF3B30",
};

const maturityStroke: Record<string, string> = {
  actionable_now: "",
  waiting_on_dependency: "6 3",
  theoretical: "3 2",
  blocked: "2 2",
};

export function MetaGraph({ spaces, bridges }: MetaGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const router = useRouter();

  const handleNodeClick = useCallback(
    (spaceId: string) => {
      router.push(`/app/space/${spaceId}`);
    },
    [router]
  );

  useEffect(() => {
    if (!svgRef.current || spaces.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 500;

    svg.selectAll("*").remove();

    // Build nodes with initial position spread
    const nodes: SpaceNode[] = spaces.map((s, i) => {
      const angle = (2 * Math.PI * i) / spaces.length;
      const r = Math.min(width, height) * 0.25;
      return {
        id: s.id,
        name: s.name,
        prefix: s.space_prefix,
        entityCount: s.entity_count,
        maturity: s.maturity,
        x: width / 2 + r * Math.cos(angle),
        y: height / 2 + r * Math.sin(angle),
      };
    });

    // Build edges — deduplicate by space pair
    const edgeMap = new Map<string, BridgeEdge>();
    for (const b of bridges) {
      const key = [b.source_space_id, b.target_space_id].sort().join("-");
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source: b.source_space_id,
          target: b.target_space_id,
          id: b.id,
          sharedVariable: b.shared_variable_name,
          bridgeType: b.bridge_type,
        });
      }
    }
    const edges: BridgeEdge[] = Array.from(edgeMap.values());

    // Simulation with boundary clamping
    const padding = 60;
    const simulation = d3
      .forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(-250))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(55))
      .force("x", d3.forceX(width / 2).strength(0.1))
      .force("y", d3.forceY(height / 2).strength(0.1))
      .force(
        "link",
        d3.forceLink<SpaceNode, BridgeEdge>(edges).id((d) => d.id).distance(200).strength(0.3)
      );

    const g = svg.append("g");

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 3]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);

    // Edges
    const edgeGroup = g
      .append("g")
      .selectAll("g")
      .data(edges)
      .join("g");

    const edgeLines = edgeGroup
      .append("line")
      .attr("stroke", "#B2EBF2")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4 3");

    // Edge labels
    edgeGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", -6)
      .style("font-size", "9px")
      .style("fill", "#86868b")
      .style("pointer-events", "none")
      .text((d) => d.sharedVariable);

    // Nodes
    const nodeGroup = g
      .append("g")
      .selectAll<SVGGElement, SpaceNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, SpaceNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Node circles
    const radius = (d: SpaceNode) => Math.max(20, Math.min(40, 15 + d.entityCount * 0.5));

    nodeGroup
      .append("circle")
      .attr("r", radius)
      .attr("fill", "white")
      .attr("stroke", (d) => maturityColors[d.maturity] ?? "#86868b")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", (d) => maturityStroke[d.maturity] ?? "")
      .style("filter", "drop-shadow(0 1px 3px rgba(0,0,0,0.08))");

    // Node prefix text
    nodeGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .style("font-size", "12px")
      .style("font-weight", "600")
      .style("fill", (d) => maturityColors[d.maturity] ?? "#86868b")
      .style("pointer-events", "none")
      .text((d) => d.prefix);

    // Node name label below
    nodeGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => radius(d) + 14)
      .style("font-size", "10px")
      .style("fill", "#48484a")
      .style("pointer-events", "none")
      .text((d) => d.name.length > 25 ? d.name.slice(0, 22) + "..." : d.name);

    // Click handler
    nodeGroup.on("click", (_, d) => handleNodeClick(d.id));

    // Hover effects
    nodeGroup
      .on("mouseenter", function () {
        d3.select(this).select("circle").attr("stroke-width", 3);
      })
      .on("mouseleave", function () {
        d3.select(this).select("circle").attr("stroke-width", 2);
      });

    // Tick with boundary clamping
    simulation.on("tick", () => {
      for (const node of nodes) {
        node.x = Math.max(padding, Math.min(width - padding, node.x ?? width / 2));
        node.y = Math.max(padding, Math.min(height - padding, node.y ?? height / 2));
      }

      edgeLines
        .attr("x1", (d) => (d.source as SpaceNode).x ?? 0)
        .attr("y1", (d) => (d.source as SpaceNode).y ?? 0)
        .attr("x2", (d) => (d.target as SpaceNode).x ?? 0)
        .attr("y2", (d) => (d.target as SpaceNode).y ?? 0);

      edgeGroup
        .selectAll("text")
        .attr("x", (d) => {
          const dd = d as BridgeEdge;
          return (((dd.source as SpaceNode).x ?? 0) + ((dd.target as SpaceNode).x ?? 0)) / 2;
        })
        .attr("y", (d) => {
          const dd = d as BridgeEdge;
          return (((dd.source as SpaceNode).y ?? 0) + ((dd.target as SpaceNode).y ?? 0)) / 2;
        });

      nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [spaces, bridges, handleNodeClick]);

  if (spaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        No spaces yet. Analyze some text first.
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      className="h-full w-full"
      style={{ minHeight: 500 }}
    />
  );
}
