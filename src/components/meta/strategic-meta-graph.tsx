"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as d3 from "d3";
import { domainColors } from "@/lib/design-tokens";
import type { Space, Entity, Bridge, Contradiction } from "@/types";

interface SpaceSummary {
  space: Space;
  topEntities: Entity[];
  leveragePoints: Entity[];
  riskPoints: Entity[];
  bottleneck: Entity | null;
  edgeDensity: number;
}

interface AutoBridge {
  sourceSpaceId: string;
  targetSpaceId: string;
  sourceEntityName: string;
  targetEntityName: string;
  sourceEntityId: string;
  targetEntityId: string;
  matchType: "exact" | "similar" | "parent_child";
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  summary: SpaceSummary;
  colorIndex: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  bridges: AutoBridge[];
  label: string;
}

export function StrategicMetaGraph({
  spaceSummaries,
  autoBridges,
  manualBridges,
  contradictions,
}: {
  spaceSummaries: SpaceSummary[];
  autoBridges: AutoBridge[];
  manualBridges: Bridge[];
  contradictions: Contradiction[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const router = useRouter();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number } | null>(null);

  const navigateToSpace = useCallback(
    (spaceId: string) => router.push(`/app/space/${spaceId}`),
    [router]
  );

  // Build graph data
  useEffect(() => {
    if (spaceSummaries.length === 0 || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 700;
    const height = svgRef.current.clientHeight || 500;

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => setTransform(event.transform));
    svg.call(zoom);

    // Build nodes
    const simNodes: GraphNode[] = spaceSummaries.map((s, i) => {
      const angle = (2 * Math.PI * i) / spaceSummaries.length - Math.PI / 2;
      const r = Math.min(width, height) * 0.28;
      return {
        id: s.space.id,
        summary: s,
        colorIndex: i,
        x: width / 2 + r * Math.cos(angle),
        y: height / 2 + r * Math.sin(angle),
      };
    });

    // Build links from auto-bridges (grouped by space pair)
    const pairMap = new Map<string, AutoBridge[]>();
    for (const ab of autoBridges) {
      const key = [ab.sourceSpaceId, ab.targetSpaceId].sort().join("-");
      const list = pairMap.get(key) ?? [];
      list.push(ab);
      pairMap.set(key, list);
    }

    const nodeIdSet = new Set(simNodes.map((n) => n.id));
    const simLinks: GraphLink[] = [];
    for (const [, bridges] of pairMap) {
      const src = bridges[0].sourceSpaceId;
      const tgt = bridges[0].targetSpaceId;
      if (nodeIdSet.has(src) && nodeIdSet.has(tgt)) {
        // Build a meaningful label from the shared concepts
        const names = bridges
          .filter((b) => b.matchType !== "parent_child")
          .map((b) => b.sourceEntityName)
          .filter((n, idx, arr) => arr.indexOf(n) === idx) // dedupe
          .slice(0, 2);
        const label = names.length > 0 ? names.join(" · ") : `${bridges.length} shared`;
        simLinks.push({
          source: src,
          target: tgt,
          bridges,
          label,
        });
      }
    }

    // Also add manual bridges
    const manualPairs = new Map<string, string[]>();
    for (const b of manualBridges) {
      const key = [b.source_space_id, b.target_space_id].sort().join("-");
      const list = manualPairs.get(key) ?? [];
      if (!list.includes(b.shared_variable_name)) list.push(b.shared_variable_name);
      manualPairs.set(key, list);
    }
    for (const [key, vars] of manualPairs) {
      const [a, b] = key.split("-");
      if (nodeIdSet.has(a) && nodeIdSet.has(b)) {
        // Check if already have auto-bridge for this pair
        const existingLink = simLinks.find((l) => {
          const lSrc = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
          const lTgt = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
          return [lSrc, lTgt].sort().join("-") === key;
        });
        if (!existingLink) {
          simLinks.push({
            source: a,
            target: b,
            bridges: [],
            label: vars.slice(0, 2).join(", "),
          });
        }
      }
    }

    const padding = 90;
    const simulation = d3
      .forceSimulation<GraphNode>(simNodes)
      .force("charge", d3.forceManyBody().strength(-800))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(100))
      .force("x", d3.forceX(width / 2).strength(0.03))
      .force("y", d3.forceY(height / 2).strength(0.03))
      .force(
        "link",
        d3.forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance(300)
          .strength(0.15)
      );

    simulationRef.current = simulation;

    simulation.on("tick", () => {
      for (const node of simNodes) {
        node.x = Math.max(padding, Math.min(width - padding, node.x ?? width / 2));
        node.y = Math.max(padding, Math.min(height - padding, node.y ?? height / 2));
      }
      setNodes([...simNodes]);
      setLinks([...simLinks]);
    });

    return () => {
      simulation.stop();
      svg.on(".zoom", null);
    };
  }, [spaceSummaries, autoBridges, manualBridges]);

  // Drag handlers
  const handleDragStart = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY };
    const sim = simulationRef.current;
    if (sim) {
      sim.alphaTarget(0.3).restart();
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
      }
    }
  }, [nodes]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !svgRef.current) return;
    const node = nodes.find((n) => n.id === dragRef.current!.nodeId);
    if (!node) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - svgRect.left - transform.x) / transform.k;
    const y = (e.clientY - svgRect.top - transform.y) / transform.k;
    node.fx = x;
    node.fy = y;
  }, [nodes, transform]);

  const handleDragEnd = useCallback(() => {
    if (!dragRef.current) return;
    const sim = simulationRef.current;
    if (sim) sim.alphaTarget(0);
    const node = nodes.find((n) => n.id === dragRef.current!.nodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
    dragRef.current = null;
  }, [nodes]);

  const selectedSummary = selectedId
    ? spaceSummaries.find((s) => s.space.id === selectedId)
    : null;

  const totalBridges = autoBridges.length + manualBridges.length;

  return (
    <div className="flex h-full gap-4">
      {/* Graph */}
      <div className="flex flex-1 flex-col">
        <div className="mb-3">
          <h1 className="text-2xl font-bold">Strategic Landscape</h1>
          <p className="text-sm text-gray-500">
            {spaceSummaries.length} areas · {totalBridges} connections · {contradictions.length} contradictions
          </p>
        </div>

        <div className="flex-1 min-h-[400px] rounded-xl border border-gray-200 bg-white overflow-hidden">
          <svg
            ref={svgRef}
            className="h-full w-full"
            style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerLeave={handleDragEnd}
          >
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
              {/* Links with labels */}
              {links.map((link, i) => {
                const src = link.source as GraphNode;
                const tgt = link.target as GraphNode;
                if (!src.x || !tgt.x) return null;
                // Offset labels along the edge to avoid stacking at midpoint
                const t = 0.35 + (i % 3) * 0.15; // spread labels at 35%, 50%, 65% along edge
                const mx = (src.x ?? 0) + ((tgt.x ?? 0) - (src.x ?? 0)) * t;
                const my = (src.y ?? 0) + ((tgt.y ?? 0) - (src.y ?? 0)) * t;

                return (
                  <g key={i}>
                    <line
                      x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                      stroke="#00ACC1" strokeWidth={1.5} strokeDasharray="6 3"
                      opacity={0.5}
                    />
                    {/* Bridge label */}
                    <g transform={`translate(${mx},${my})`}>
                      <rect
                        x={-(Math.min(link.label.length * 3.2, 90) + 6)}
                        y={-9}
                        width={Math.min(link.label.length * 6.4, 180) + 12}
                        height={18}
                        rx={5}
                        fill="white"
                        stroke="#B2EBF2"
                        strokeWidth={0.8}
                        opacity={0.95}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={9}
                        fill="#0097A7"
                        fontWeight={500}
                      >
                        {link.label.length > 30 ? link.label.slice(0, 28) + "..." : link.label}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Nodes — rich space cards */}
              {nodes.map((node) => {
                const color = domainColors[node.colorIndex % domainColors.length];
                const s = node.summary;
                const isHovered = hoveredId === node.id;
                const isSelected = selectedId === node.id;
                const r = Math.max(28, Math.min(42, 22 + (s.space.entity_count ?? 0) * 0.4));
                const isHealthy = s.edgeDensity >= 1.0;

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x ?? 0},${node.y ?? 0})`}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onPointerDown={(e) => handleDragStart(node.id, e)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!dragRef.current) setSelectedId(selectedId === node.id ? null : node.id);
                    }}
                    onDoubleClick={() => navigateToSpace(node.id)}
                    style={{ cursor: "grab" }}
                  >
                    {/* Main circle */}
                    <circle
                      r={isHovered || isSelected ? r + 4 : r}
                      fill={color.fill}
                      stroke={isSelected ? "#00ACC1" : color.stroke}
                      strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
                      style={{ transition: "all 200ms ease" }}
                    />

                    {/* Health indicator ring */}
                    {!isHealthy && (
                      <circle
                        r={r + 6}
                        fill="none"
                        stroke="#FF9500"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        opacity={0.6}
                      />
                    )}

                    {/* Prefix */}
                    <text
                      textAnchor="middle"
                      y={-4}
                      fontSize={13}
                      fontWeight={700}
                      fill={color.stroke}
                      style={{ pointerEvents: "none" }}
                    >
                      {s.space.space_prefix}
                    </text>

                    {/* Entity count */}
                    <text
                      textAnchor="middle"
                      y={10}
                      fontSize={8}
                      fill={color.stroke}
                      opacity={0.7}
                      style={{ pointerEvents: "none" }}
                    >
                      {s.space.entity_count}·{s.space.edge_count}
                    </text>

                    {/* Space name below */}
                    <text
                      y={r + 14}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={500}
                      fill="#1D1D1F"
                      style={{ pointerEvents: "none" }}
                    >
                      {s.space.name.length > 22 ? s.space.name.slice(0, 20) + "..." : s.space.name}
                    </text>

                    {/* Bottleneck/leverage label */}
                    {s.bottleneck && (
                      <text
                        y={r + 26}
                        textAnchor="middle"
                        fontSize={8}
                        fill="#FF3B30"
                        style={{ pointerEvents: "none" }}
                      >
                        ⚠ {s.bottleneck.name.length > 20 ? s.bottleneck.name.slice(0, 18) + "..." : s.bottleneck.name}
                      </text>
                    )}
                    {!s.bottleneck && s.leveragePoints[0] && (
                      <text
                        y={r + 26}
                        textAnchor="middle"
                        fontSize={8}
                        fill="#007AFF"
                        style={{ pointerEvents: "none" }}
                      >
                        ★ {s.leveragePoints[0].name.length > 20 ? s.leveragePoints[0].name.slice(0, 18) + "..." : s.leveragePoints[0].name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      {/* Right panel — strategic intelligence */}
      <div className="hidden lg:flex w-72 flex-col gap-3 overflow-y-auto">
        {/* Selected space detail */}
        {selectedSummary ? (
          <div className="rounded-xl border border-interaxis-200 bg-interaxis-50/30 p-4">
            <h3 className="text-sm font-semibold">{selectedSummary.space.name}</h3>
            <p className="mt-1 text-xs text-gray-500">{selectedSummary.space.description}</p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white p-2">
                <div className="text-lg font-bold text-gray-900">{selectedSummary.space.entity_count}</div>
                <div className="text-[9px] text-gray-400">entities</div>
              </div>
              <div className="rounded-lg bg-white p-2">
                <div className="text-lg font-bold text-gray-900">{selectedSummary.edgeDensity.toFixed(1)}×</div>
                <div className="text-[9px] text-gray-400">density</div>
              </div>
            </div>

            {selectedSummary.bottleneck && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2">
                <div className="text-[9px] font-semibold text-red-600 uppercase">Bottleneck</div>
                <div className="mt-0.5 text-xs font-medium">{selectedSummary.bottleneck.name}</div>
              </div>
            )}

            {selectedSummary.leveragePoints.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] font-semibold text-gray-500 uppercase mb-1">Leverage points</div>
                {selectedSummary.leveragePoints.map((lp) => (
                  <div key={lp.id} className="text-xs text-gray-700 py-0.5">
                    <span className="text-blue-500 font-medium">{lp.entity_id}</span> {lp.name}
                  </div>
                ))}
              </div>
            )}

            {selectedSummary.topEntities.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] font-semibold text-gray-500 uppercase mb-1">Key entities</div>
                {selectedSummary.topEntities.map((e) => (
                  <div key={e.id} className="text-[11px] text-gray-600 py-0.5 truncate">
                    {e.entity_id} {e.name}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => navigateToSpace(selectedSummary.space.id)}
              className="mt-3 w-full rounded-lg bg-interaxis-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-interaxis-700"
            >
              Open this space
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-400">Click a space to see details. Double-click to open it.</p>
          </div>
        )}

        {/* Activation sequence */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Recommended order
          </h3>
          <div className="space-y-1.5">
            {spaceSummaries
              .sort((a, b) => {
                const order: Record<string, number> = { actionable_now: 0, waiting_on_dependency: 1, theoretical: 2, blocked: 3 };
                return (order[a.space.maturity] ?? 2) - (order[b.space.maturity] ?? 2);
              })
              .map((s, i) => (
                <div key={s.space.id} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-interaxis-100 text-[9px] font-bold text-interaxis-700">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{s.space.name}</div>
                    <div className="text-[9px] text-gray-400">
                      {s.space.maturity === "actionable_now" ? "Ready" : s.space.maturity.replace(/_/g, " ")}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Auto-detected connections */}
        {autoBridges.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Shared concepts ({autoBridges.length})
            </h3>
            <div className="space-y-1.5">
              {autoBridges.slice(0, 8).map((ab, i) => {
                const srcSpace = spaceSummaries.find((s) => s.space.id === ab.sourceSpaceId);
                const tgtSpace = spaceSummaries.find((s) => s.space.id === ab.targetSpaceId);
                return (
                  <div key={i} className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[10px] font-medium text-interaxis-600">
                      {ab.sourceEntityName}
                    </div>
                    <div className="text-[9px] text-gray-400">
                      {srcSpace?.space.name ?? "?"} ↔ {tgtSpace?.space.name ?? "?"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contradictions */}
        {contradictions.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-2">
              Contradictions ({contradictions.length})
            </h3>
            {contradictions.map((c) => (
              <div key={c.id} className="rounded-lg border border-amber-200 bg-white p-2 mb-1.5">
                <span className={`rounded px-1 py-0.5 text-[8px] font-medium ${
                  c.severity === "critical" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
                }`}>{c.severity}</span>
                <div className="mt-1 text-[10px] text-gray-700">{c.assumption_text}</div>
                <div className="text-[10px] text-gray-500">vs: {c.conclusion_text}</div>
              </div>
            ))}
          </div>
        )}

        {/* Health overview */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Health
          </h3>
          {spaceSummaries.map((s) => {
            const isHealthy = s.edgeDensity >= 1.0;
            const hasEdges = s.space.edge_count > 0;
            return (
              <div key={s.space.id} className="flex items-center justify-between py-1 text-xs">
                <span className="truncate max-w-[120px] text-gray-700">{s.space.name}</span>
                <span className={
                  !hasEdges ? "text-red-500 font-medium" :
                  isHealthy ? "text-green-600" : "text-amber-500"
                }>
                  {!hasEdges ? "No edges!" : `${s.edgeDensity.toFixed(1)}×`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
