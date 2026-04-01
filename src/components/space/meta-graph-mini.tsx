"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { Space, Bridge } from "@/types";

interface MetaGraphMiniProps {
  spaces: Space[];
  bridges: Bridge[];
}

const maturityColors: Record<string, string> = {
  actionable_now: "#34C759",
  waiting_on_dependency: "#FF9500",
  theoretical: "#AF52DE",
  blocked: "#FF3B30",
};

export function MetaGraphMini({ spaces, bridges }: MetaGraphMiniProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || spaces.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = 220;
    const height = 140;
    svg.selectAll("*").remove();

    interface MiniNode extends d3.SimulationNodeDatum {
      id: string;
      prefix: string;
      entityCount: number;
      maturity: string;
    }

    const nodes: MiniNode[] = spaces.map((s) => ({
      id: s.id,
      prefix: s.space_prefix,
      entityCount: s.entity_count,
      maturity: s.maturity,
    }));

    // Dedupe edges
    const edgeSet = new Set<string>();
    const edges: { source: string; target: string }[] = [];
    for (const b of bridges) {
      const key = [b.source_space_id, b.target_space_id].sort().join("-");
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: b.source_space_id, target: b.target_space_id });
      }
    }

    const simulation = d3
      .forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(-80))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(20))
      .force(
        "link",
        d3
          .forceLink<MiniNode, { source: string; target: string }>(edges)
          .id((d) => d.id)
          .distance(50)
      );

    const edgeGroup = svg
      .append("g")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", "#B2EBF2")
      .attr("stroke-width", 1);

    const nodeGroup = svg
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g");

    const r = (d: MiniNode) => Math.max(8, Math.min(16, 6 + d.entityCount * 0.3));

    nodeGroup
      .append("circle")
      .attr("r", r)
      .attr("fill", "white")
      .attr("stroke", (d) => maturityColors[d.maturity] ?? "#86868b")
      .attr("stroke-width", 1.5);

    nodeGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .style("font-size", "7px")
      .style("font-weight", "600")
      .style("fill", (d) => maturityColors[d.maturity] ?? "#86868b")
      .style("pointer-events", "none")
      .text((d) => d.prefix);

    simulation.on("tick", () => {
      edgeGroup
        .attr("x1", (d) => ((d.source as unknown as MiniNode).x ?? 0))
        .attr("y1", (d) => ((d.source as unknown as MiniNode).y ?? 0))
        .attr("x2", (d) => ((d.target as unknown as MiniNode).x ?? 0))
        .attr("y2", (d) => ((d.target as unknown as MiniNode).y ?? 0));

      nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { simulation.stop(); };
  }, [spaces, bridges]);

  if (spaces.length < 2) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Topology
      </p>
      <svg ref={svgRef} width={220} height={140} />
    </div>
  );
}
