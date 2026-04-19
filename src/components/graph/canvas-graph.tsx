"use client";

import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
} from "react";
import * as d3 from "d3";
import type { Entity, Edge } from "@/types";
import { detectCommunities } from "@/lib/graph/community-detection";

// ── Visual constants ──

const COMMUNITY_PALETTE = [
  "#29B6F6", // sky blue
  "#26A69A", // teal
  "#AB47BC", // purple
  "#EF5350", // coral red
  "#66BB6A", // green
  "#FFA726", // amber
  "#5C6BC0", // indigo
  "#EC407A", // pink
  "#8D6E63", // brown
  "#78909C", // blue-grey
  "#42A5F5", // light blue
  "#009688", // dark teal
  "#7E57C2", // deep purple
  "#FF7043", // deep orange
  "#9CCC65", // light green
];

const BG_COLOR = "#FAFBFC";
const EDGE_COLOR = "#94A3B8";
const EDGE_HIGHLIGHT_COLOR = "#3B82F6";
const LABEL_COLOR = "#1E293B";
const TOOLTIP_BG = "#1E293B";
const TOOLTIP_TEXT = "#FFFFFF";

// ── Types ──

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  entity: Entity;
  community: number;
  degree: number;
  radius: number;
  color: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  edge: Edge;
}

interface CanvasGraphProps {
  entities: Entity[];
  edges: Edge[];
  onNodeClick?: (entity: Entity) => void;
  onNodeHover?: (entity: Entity | null) => void;
}

function CanvasGraphInner({
  entities,
  edges,
  onNodeClick,
  onNodeHover,
}: CanvasGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const hoveredRef = useRef<SimNode | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const quadtreeRef = useRef<d3.Quadtree<SimNode> | null>(null);
  const dimRef = useRef({ width: 800, height: 600 });
  const [stats, setStats] = useState({ nodes: 0, edges: 0, clusters: 0 });

  // ── Build sim data with community detection ──
  const { simNodes, simLinks, communityCount } = useMemo(() => {
    if (entities.length === 0)
      return { simNodes: [], simLinks: [], communityCount: 0 };

    // Edges reference entities by UUID (entity.id), not entity_id string
    const commResult = detectCommunities(
      entities.map((e) => e.id),
      edges.map((e) => ({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
        confidence: e.confidence,
      }))
    );

    const nodeCount = entities.length;

    // Degree map — keyed by UUID since edges use UUIDs
    const deg = new Map<string, number>();
    for (const e of edges) {
      deg.set(e.source_entity_id, (deg.get(e.source_entity_id) ?? 0) + 1);
      deg.set(e.target_entity_id, (deg.get(e.target_entity_id) ?? 0) + 1);
    }
    const maxDeg = Math.max(1, ...deg.values());

    const nodes: SimNode[] = entities.map((e) => {
      const d = deg.get(e.id) ?? 0;
      const comm = commResult.communities.get(e.id) ?? 0;
      return {
        id: e.id, // Use UUID for linking with edges
        entity: e,
        community: comm,
        degree: d,
        // Size scales with graph: small graphs get bigger nodes
        radius: (nodeCount < 30 ? 8 : 4) + Math.sqrt(d / maxDeg) * (nodeCount < 30 ? 16 : 14),
        color: COMMUNITY_PALETTE[comm % COMMUNITY_PALETTE.length],
      };
    });

    const nodeMap = new Map(nodes.map((nd) => [nd.id, nd]));
    const links: SimLink[] = edges
      .filter(
        (e) =>
          nodeMap.has(e.source_entity_id) && nodeMap.has(e.target_entity_id)
      )
      .map((e) => ({
        source: nodeMap.get(e.source_entity_id)!,
        target: nodeMap.get(e.target_entity_id)!,
        edge: e,
      }));

    return {
      simNodes: nodes,
      simLinks: links,
      communityCount: commResult.communityCount,
    };
  }, [entities, edges]);

  // ── Canvas draw ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = dimRef.current;
    const dpr = window.devicePixelRatio || 1;
    const t = transformRef.current;
    const zoom = t.k;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const hovered = hoveredRef.current;

    ctx.save();
    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    // Apply transform
    ctx.translate(t.x, t.y);
    ctx.scale(zoom, zoom);

    // ─── Edges ───
    ctx.lineWidth = Math.max(0.5, (links.length < 30 ? 1.5 : 0.5) / zoom);
    for (const link of links) {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null)
        continue;

      const isHoveredEdge =
        hovered && (src === hovered || tgt === hovered);

      const fewEdges = links.length < 30;
      ctx.strokeStyle = isHoveredEdge ? EDGE_HIGHLIGHT_COLOR : EDGE_COLOR;
      ctx.globalAlpha = isHoveredEdge ? 0.8 : fewEdges ? 0.5 : Math.min(0.35, 0.08 + zoom * 0.04);

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.stroke();

      // Arrowheads when zoomed in
      if (zoom > 0.7) {
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1) {
          const ux = dx / len;
          const uy = dy / len;
          const aSize = Math.max(2, 3.5 / zoom);
          const ax = tgt.x - ux * (tgt.radius + 1.5);
          const ay = tgt.y - uy * (tgt.radius + 1.5);

          ctx.fillStyle = isHoveredEdge ? EDGE_HIGHLIGHT_COLOR : EDGE_COLOR;
          ctx.globalAlpha = isHoveredEdge ? 0.9 : 0.25;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(
            ax - ux * aSize - uy * aSize * 0.45,
            ay - uy * aSize + ux * aSize * 0.45
          );
          ctx.lineTo(
            ax - ux * aSize + uy * aSize * 0.45,
            ay - uy * aSize - ux * aSize * 0.45
          );
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ─── Nodes ───
    ctx.globalAlpha = 1;
    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;

      const isHov = node === hovered;
      const r = isHov ? node.radius * 1.35 : node.radius;

      // Glow halo for hub nodes (degree > median)
      if (node.degree >= 3 && zoom > 0.3) {
        const grad = ctx.createRadialGradient(
          node.x,
          node.y,
          r * 0.4,
          node.x,
          node.y,
          r * 2.5
        );
        grad.addColorStop(0, node.color + "30");
        grad.addColorStop(1, node.color + "00");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isHov ? "#FFFFFF" : node.color;
      ctx.fill();
      ctx.strokeStyle = isHov ? node.color : node.color + "80";
      ctx.lineWidth = isHov ? Math.max(1.5, 2 / zoom) : Math.max(0.5, 0.8 / zoom);
      ctx.stroke();

      // Dark center dot for hub nodes
      if (node.degree >= 5) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = node.color + "90";
        ctx.fill();
      }
    }

    // ─── Labels (progressive: hubs first, then all on zoom) ───
    const smallGraph = nodes.length < 40;
    if (zoom > 0.4 || smallGraph) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      // For small graphs, always show all labels; for large graphs, progressive reveal
      const degThreshold = smallGraph
        ? 0
        : zoom > 3 ? 0 : zoom > 2 ? 1 : zoom > 1.2 ? 3 : zoom > 0.8 ? 6 : 999;

      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        const isHov = node === hovered;
        if (node.degree < degThreshold && !isHov) continue;

        const fontSize = Math.max(
          3,
          Math.min(11, (isHov ? 10 : 8) / zoom)
        );
        ctx.font = `${isHov ? "600" : "400"} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.fillStyle = LABEL_COLOR;
        ctx.globalAlpha = isHov ? 1 : 0.75;

        const name = node.entity.name;
        const maxChars = zoom > 2 ? 30 : 18;
        const label =
          name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;

        ctx.fillText(label, node.x, node.y + node.radius + 2 / zoom);
      }
      ctx.globalAlpha = 1;
    }

    // ─── Hover tooltip ───
    if (hovered && hovered.x != null && hovered.y != null) {
      const name = hovered.entity.name;
      const sub = `${hovered.degree} connections · ${hovered.entity.entity_category}`;
      const fontSize = Math.max(8, 11 / zoom);
      const subFontSize = fontSize * 0.8;
      const pad = 6 / zoom;

      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const nameW = ctx.measureText(name).width;
      ctx.font = `400 ${subFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const subW = ctx.measureText(sub).width;
      const boxW = Math.max(nameW, subW) + pad * 2;
      const boxH = fontSize + subFontSize + pad * 3;
      const bx = hovered.x - boxW / 2;
      const by = hovered.y - hovered.radius - boxH - 4 / zoom;

      ctx.globalAlpha = 0.92;
      ctx.fillStyle = TOOLTIP_BG;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 4 / zoom);
      ctx.fill();

      ctx.fillStyle = TOOLTIP_TEXT;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillText(name, hovered.x, by + pad);
      ctx.font = `400 ${subFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = "#94A3B8";
      ctx.fillText(sub, hovered.x, by + pad + fontSize + 2 / zoom);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, []);

  // ── Force simulation ──
  useEffect(() => {
    nodesRef.current = simNodes;
    linksRef.current = simLinks;
    setStats({
      nodes: simNodes.length,
      edges: simLinks.length,
      clusters: communityCount,
    });

    const { width, height } = dimRef.current;
    const n = simNodes.length;

    // Scale forces based on graph size
    const chargeStrength = n > 100 ? -60 : n > 50 ? -80 : n > 20 ? -120 : -200;
    const linkDistance = n > 100 ? 20 : n > 50 ? 35 : n > 20 ? 50 : 70;
    const radialRadius = Math.min(width, height) * (n > 100 ? 0.42 : n > 30 ? 0.35 : 0.22);

    // Custom cluster cohesion force
    function clusterForce(alpha: number) {
      // Compute community centroids
      const centroids = new Map<
        number,
        { x: number; y: number; count: number }
      >();
      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue;
        const c = centroids.get(node.community) ?? {
          x: 0,
          y: 0,
          count: 0,
        };
        c.x += node.x;
        c.y += node.y;
        c.count++;
        centroids.set(node.community, c);
      }
      for (const c of centroids.values()) {
        c.x /= c.count;
        c.y /= c.count;
      }

      const strength = 0.25;
      for (const node of nodesRef.current) {
        const c = centroids.get(node.community);
        if (!c || node.x == null || node.y == null) continue;
        node.vx = (node.vx ?? 0) + (c.x - node.x) * strength * alpha;
        node.vy = (node.vy ?? 0) + (c.y - node.y) * strength * alpha;
      }
    }

    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(linkDistance)
          .strength(0.5)
      )
      .force(
        "charge",
        d3
          .forceManyBody<SimNode>()
          .strength((d) => chargeStrength - d.degree * 5)
          .theta(0.8)
          .distanceMax(400)
      )
      .force(
        "center",
        d3.forceCenter(width / 2, height / 2).strength(0.04)
      )
      .force(
        "collision",
        d3
          .forceCollide<SimNode>()
          .radius((d) => d.radius + 1.5)
          .strength(0.7)
      )
      .force(
        "radial",
        d3
          .forceRadial(radialRadius, width / 2, height / 2)
          .strength(0.03)
      )
      .force("cluster", clusterForce as unknown as d3.Force<SimNode, SimLink>)
      .alpha(1)
      .alphaDecay(0.015)
      .velocityDecay(0.35)
      .on("tick", () => {
        // Update quadtree for hit-testing
        quadtreeRef.current = d3
          .quadtree<SimNode>()
          .x((d) => d.x ?? 0)
          .y((d) => d.y ?? 0)
          .addAll(nodesRef.current.filter((n) => n.x != null));
        draw();
      });

    simulationRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [simNodes, simLinks, communityCount, draw]);

  // ── Zoom + mouse interactions ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.08, 12])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        draw();
      });

    const selection = d3.select(canvas);
    selection.call(zoom);

    // Double-click to reset zoom
    selection.on("dblclick.zoom", () => {
      selection
        .transition()
        .duration(500)
        .call(zoom.transform, d3.zoomIdentity);
    });

    // Mouse move → hover detection via quadtree
    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const mx = (event.clientX - rect.left - t.x) / t.k;
      const my = (event.clientY - rect.top - t.y) / t.k;

      // Find nearest node via linear scan (fast enough for <2000 nodes)
      let closest: SimNode | null = null;
      let closestDist = Infinity;

      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue;
        const dx = mx - node.x;
        const dy = my - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < node.radius * 1.8 && dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
      }

      if (hoveredRef.current !== closest) {
        hoveredRef.current = closest;
        canvas.style.cursor = closest ? "pointer" : "grab";
        onNodeHover?.(closest?.entity ?? null);
        draw();
      }
    };

    const handleClick = () => {
      if (hoveredRef.current) {
        onNodeClick?.(hoveredRef.current.entity);
      }
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("click", handleClick);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("click", handleClick);
    };
  }, [draw, onNodeClick, onNodeHover]);

  // ── Resize observer ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width < 10 || height < 10) continue;
        dimRef.current = { width, height };

        const canvas = canvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }

        // Re-center forces
        const sim = simulationRef.current;
        if (sim) {
          sim.force(
            "center",
            d3.forceCenter(width / 2, height / 2).strength(0.04)
          );
          sim.force(
            "radial",
            d3
              .forceRadial(
                Math.min(width, height) * 0.38,
                width / 2,
                height / 2
              )
              .strength(0.03)
          );
          sim.alpha(0.2).restart();
        }

        draw();
      }
    });

    observer.observe(container);
    // Trigger initial size
    const rect = container.getBoundingClientRect();
    if (rect.width > 10 && rect.height > 10) {
      dimRef.current = { width: rect.width, height: rect.height };
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
    }

    return () => observer.disconnect();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: BG_COLOR,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          cursor: "grab",
        }}
      />
      {/* Stats overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: 10,
          background: "rgba(255,255,255,0.88)",
          backdropFilter: "blur(8px)",
          borderRadius: 8,
          padding: "5px 12px",
          fontSize: 11,
          color: "#64748B",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontWeight: 500,
          pointerEvents: "none",
          display: "flex",
          gap: 12,
        }}
      >
        <span>
          <strong style={{ color: "#1E293B" }}>{stats.nodes}</strong> entities
        </span>
        <span>
          <strong style={{ color: "#1E293B" }}>{stats.edges}</strong> edges
        </span>
        <span>
          <strong style={{ color: "#1E293B" }}>{stats.clusters}</strong>{" "}
          clusters
        </span>
      </div>
      {/* Zoom hint */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          background: "rgba(255,255,255,0.75)",
          backdropFilter: "blur(6px)",
          borderRadius: 6,
          padding: "3px 8px",
          fontSize: 10,
          color: "#94A3B8",
          pointerEvents: "none",
        }}
      >
        Scroll to zoom · Drag to pan · Double-click to reset
      </div>
    </div>
  );
}

export const CanvasGraph = React.memo(CanvasGraphInner);
