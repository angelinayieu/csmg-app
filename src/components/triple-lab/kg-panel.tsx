"use client";

// KG panel — middle column. Switches between two modes:
//   - INSIGHTS (default): chronological feed of structural events as
//     the pipeline runs (cycles, bridges, signals, root causes, twin
//     proposals, strategy consensus). The user sees the pipeline
//     THINKING.
//   - GRAPH: live d3-force visualization of the knowledge graph
//     formation. The user sees WHERE in the topology insights land.
//
// Default is INSIGHTS because that's the dominant value — most users
// want to see what the pipeline FOUND, not just where the dots are.
// Graph mode is one click away for users who want the spatial view.

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { Entity, Edge, Cycle, Bridge } from "@/types";
import { useRunEventStoreOptional } from "@/components/canvas/hooks/run-event-store";
import { InsightsFeedMode } from "./insights-feed-mode";
import { colors, tracking } from "./tokens";

type KgViewMode = "insights" | "graph";

// d3-force needs mutable simulation nodes — we shadow Entity / Edge
// onto a simulation-friendly shape. d3 mutates these in place each
// tick to add x/y/vx/vy. We never let those leak back to props.
interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  layer: string;
  isLeverage: boolean;
  isRisk: boolean;
  isBottleneck: boolean;
  edgeCount: number;
  // freshness timestamp — drives the 1.5s "just landed" pulse animation
  landedAt: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  relation: string;
  confidence: number;
  inCycle: boolean;
  isBridge: boolean;
  landedAt: number;
}

interface KgPanelProps {
  // spaceId is part of the prop contract even though this panel doesn't
  // need it yet — keeps the call signature symmetric with the other
  // panels and lets us add space-scoped fetches (e.g. /rail-pulse,
  // node neighborhood lookups) without changing the wrapper.
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  bridges: Bridge[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}

export function KgPanel({
  entities,
  edges,
  cycles,
  bridges,
  selectedEntityId,
  onSelectEntity,
}: KgPanelProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 600 });
  const eventStore = useRunEventStoreOptional();

  // View mode toggle: default to "insights" because the live event
  // feed is the dominant value (users want to see WHAT the pipeline
  // is finding). "graph" stays one click away for the topology view.
  // localStorage-persisted so per-space preference is remembered.
  const [viewMode, setViewMode] = useState<KgViewMode>(() => {
    if (typeof window === "undefined") return "insights";
    try {
      const stored = window.localStorage.getItem("triple-lab:kg-view-mode");
      return stored === "graph" || stored === "insights" ? stored : "insights";
    } catch {
      return "insights";
    }
  });
  const onModeChange = (next: KgViewMode) => {
    setViewMode(next);
    try {
      window.localStorage.setItem("triple-lab:kg-view-mode", next);
    } catch {
      // Private browsing — fine, preference resets next mount.
    }
  };

  // Zoom controller (set by the simulation effect, used by the
  // selection-centering effect). Holds the d3 zoom behavior + svg
  // selection + viewport size so we can compute a centering transform.
  const zoomRef = useRef<{
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    sizeW: number;
    sizeH: number;
  } | null>(null);

  // Sim-node lookup keyed by entity id. d3-force mutates node x/y in
  // place, so the latest position is always on the live SimNode
  // object. We refresh this map on every sim rebuild.
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map());

  // Track "first seen" timestamps per entity/edge id so we can pulse-
  // animate the newly arrived ones. Keyed by id, value = epoch ms.
  // Held as state (not ref) so the render rules don't complain about
  // reading a ref during render — the seen map IS data the memo
  // depends on. We never write to it during render; only the
  // useEffect below promotes newly-seen ids.
  const [firstSeen, setFirstSeen] = useState<Map<string, number>>(
    () => new Map(),
  );

  // ── Resize observer ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Build sim data from entities + edges ───────────────────────────
  // Memo only on entity/edge identity, not on every render. d3-force
  // mutates SimNode in place, so we need stable refs across ticks.
  // The freshness timestamp uses entity insertion order as a proxy
  // rather than Date.now() (which is impure-during-render and would
  // also tick on every memo recompute). The "just-landed" pulse effect
  // is driven by a separate useEffect below that consults Date.now()
  // outside render.
  const { nodes, links, edgeCountById } = useMemo(() => {
    const seen = firstSeen;

    // Count edges per entity for sizing
    const edgeCount = new Map<string, number>();
    for (const e of edges) {
      edgeCount.set(
        e.source_entity_id,
        (edgeCount.get(e.source_entity_id) ?? 0) + 1,
      );
      edgeCount.set(
        e.target_entity_id,
        (edgeCount.get(e.target_entity_id) ?? 0) + 1,
      );
    }

    // Set of (entity_id) in cycles for highlighting
    const cycleEntitySet = new Set<string>();
    for (const c of cycles) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids = (c as any).entity_ids as string[] | null | undefined;
      if (Array.isArray(ids)) for (const id of ids) cycleEntitySet.add(id);
    }

    // Set of (source_id, target_id) pairs that are bridges
    const bridgeEdgeKeys = new Set<string>();
    for (const b of bridges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sid = (b as any).source_entity_id as string | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tid = (b as any).target_entity_id as string | undefined;
      if (sid && tid) bridgeEdgeKeys.add(`${sid}->${tid}`);
    }

    // landedAt timestamps are written by a separate effect below; here
    // we just read whatever's already tracked. New entities get 0 and
    // the effect promotes them to Date.now() on the next paint cycle.
    const simNodes: SimNode[] = entities.map((e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layer = ((e as any).knowledge_layer as string | null | undefined) ?? "internal";
      return {
        id: e.id,
        name: e.name,
        layer,
        isLeverage: Boolean(e.is_leverage_point),
        isRisk: Boolean(e.is_risk_point),
        isBottleneck: Boolean(e.is_master_bottleneck),
        edgeCount: edgeCount.get(e.id) ?? 0,
        landedAt: seen.get(e.id) ?? 0,
      };
    });

    const entityIdSet = new Set(simNodes.map((n) => n.id));
    const simLinks: SimLink[] = edges
      .filter(
        (e) =>
          entityIdSet.has(e.source_entity_id) &&
          entityIdSet.has(e.target_entity_id),
      )
      .map((e) => ({
        id: e.id,
        source: e.source_entity_id,
        target: e.target_entity_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        relation: ((e as any).relationship_type as string | null) ?? "relates_to",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        confidence: typeof (e as any).confidence === "number" ? (e as any).confidence : 0.5,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inCycle: Boolean((e as any).is_part_of_cycle),
        isBridge: bridgeEdgeKeys.has(
          `${e.source_entity_id}->${e.target_entity_id}`,
        ),
        landedAt: seen.get(e.id) ?? 0,
      }));

    return { nodes: simNodes, links: simLinks, edgeCountById: edgeCount };
  }, [entities, edges, cycles, bridges, firstSeen]);

  // Promote freshly-seen entity/edge ids to "landed at now" in an
  // effect (Date.now() is impure-during-render). The state update
  // triggers a memo recompute, which the d3 enter selection picks up
  // and animates as a pulse. We diff first so we don't trigger a
  // pointless re-render when nothing's new.
  useEffect(() => {
    const now = Date.now();
    let changed = false;
    const next = new Map(firstSeen);
    for (const e of entities) {
      if (!next.has(e.id)) {
        next.set(e.id, now);
        changed = true;
      }
    }
    for (const e of edges) {
      if (!next.has(e.id)) {
        next.set(e.id, now);
        changed = true;
      }
    }
    if (changed) setFirstSeen(next);
    // Intentionally NOT depending on firstSeen — that would loop, since
    // we're updating it. We only re-fire when entities/edges change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, edges]);

  // ── d3-force simulation ────────────────────────────────────────────
  // One simulation instance per (size, node-set) pair. We rebuild on
  // node-id change because d3 needs to re-bind the links; we'd lose
  // continuity otherwise. The cost is small (~ms for <200 nodes) and
  // the alpha-target keeps things smooth.
  useEffect(() => {
    if (!svgRef.current) return;
    if (nodes.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // ── Zoom + pan ─────────────────────────────────────────────────
    // We wrap link/node/label groups in a single root <g> so d3.zoom()
    // can apply one transform to everything at once. The zoom behavior
    // is attached to the SVG root, NOT the inner group — clicking
    // empty space pans, wheel zooms, double-click zooms-in. Range
    // 0.25-4× covers "see-the-whole-graph" to "read-a-cluster". We
    // call `setZoomController` once so the panel-level effect for
    // selection-centering can drive the transform later.
    const rootG = svg.append("g").attr("class", "kg-root");
    const linkG = rootG.append("g").attr("class", "links");
    const nodeG = rootG.append("g").attr("class", "nodes");
    const labelG = rootG.append("g").attr("class", "labels");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on("zoom", (event) => {
        rootG.attr("transform", event.transform.toString());
      });
    svg.call(zoom);
    // Park the active zoom controller on a ref so the selection
    // effect can call zoom.transform() to animate-center on click.
    zoomRef.current = { zoom, svg, sizeW: size.w, sizeH: size.h };

    // Edges as paths so we can draw curved bridges differently from
    // straight intra-graph edges. d3 fills source/target with the
    // resolved node objects when forceLink is applied.
    const linkPath = linkG
      .selectAll<SVGPathElement, SimLink>("path")
      .data(links, (d) => d.id)
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d) =>
        d.isBridge ? "#06B6D4" : d.inCycle ? "#F59E0B" : "#94A3B8",
      )
      .attr("stroke-width", (d) => 0.8 + d.confidence * 1.6)
      .attr("stroke-opacity", 0.55)
      .attr("stroke-dasharray", (d) => (d.isBridge ? "4 3" : ""));

    // Refresh the node-id → SimNode map so the selection-centering
    // effect can look up live positions.
    nodeMapRef.current = new Map(nodes.map((n) => [n.id, n]));

    // Node circles. We also attach a transparent larger hit-circle
    // so click + drag targets are easy to grab even on the smallest
    // nodes (4-6px radius is brutal on a trackpad). The hit-circle
    // shares the same SimNode datum so d3.drag()'s `subject` resolves
    // identically whether the user grabbed the visible or the hit
    // ring.
    const nodeCircle = nodeG
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes, (d) => d.id)
      .enter()
      .append("circle")
      .attr("r", (d) => 4 + Math.min(10, Math.sqrt(d.edgeCount) * 2.4))
      .attr("fill", (d) => nodeFill(d))
      .attr("stroke", (d) => nodeStroke(d))
      .attr("stroke-width", (d) => (d.isLeverage || d.isRisk || d.isBottleneck ? 2 : 1))
      .style("cursor", "grab")
      .on("click", (_, d) => onSelectEntity(d.id));

    // ── Drag ───────────────────────────────────────────────────────
    // Standard d3-force drag dance: bump alpha at dragstart so the
    // sim re-energizes, pin the dragged node via fx/fy during drag,
    // release pinning on dragend so the sim reabsorbs the position.
    // (If we wanted "click to pin permanently" semantics we'd skip
    // the fx/fy unset; for triple-lab the looser feel is better.)
    nodeCircle.call(
      d3
        .drag<SVGCircleElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    // Labels — visible for leverage/risk/bottleneck nodes + high-
    // degree nodes by default. Low-degree nodes fade in on hover via
    // the mouseenter/leave handlers below so the user can always ID
    // any node — but the canvas stays uncluttered at rest.
    const label = labelG
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes, (d) => d.id)
      .enter()
      .append("text")
      .attr("data-node-id", (d) => d.id)
      .text((d) => d.name)
      .attr("font-size", 9)
      .attr("font-weight", 600)
      .attr("fill", "#334155")
      .attr("text-anchor", "middle")
      .attr("dy", -10)
      .style("pointer-events", "none")
      .style("transition", "opacity 140ms ease-out")
      .style("opacity", (d) =>
        d.isLeverage || d.isRisk || d.isBottleneck || d.edgeCount > 5 ? 1 : 0,
      );

    // Hover affordance: temporarily fade the label in for any node
    // (even low-degree ones). The transition class above gives it a
    // smooth-feel; mouseleave restores to the resting opacity.
    nodeCircle
      .on("mouseenter", (_, d) => {
        labelG
          .select<SVGTextElement>(`text[data-node-id="${cssEscape(d.id)}"]`)
          .style("opacity", 1);
      })
      .on("mouseleave", (_, d) => {
        if (d.isLeverage || d.isRisk || d.isBottleneck || d.edgeCount > 5) {
          // Keep visible by default
          return;
        }
        labelG
          .select<SVGTextElement>(`text[data-node-id="${cssEscape(d.id)}"]`)
          .style("opacity", 0);
      });

    // Pulse animation for freshly-landed nodes (< 1.5s ago).
    const now = Date.now();
    nodeCircle
      .filter((d) => now - d.landedAt < 1500)
      .style("opacity", 0)
      .transition()
      .duration(380)
      .style("opacity", 1)
      .attr("r", (d) => (4 + Math.min(10, Math.sqrt(d.edgeCount) * 2.4)) * 1.4)
      .transition()
      .duration(200)
      .attr("r", (d) => 4 + Math.min(10, Math.sqrt(d.edgeCount) * 2.4));

    // d3-force setup. Tuned for compact lab-feeling layout, not full-
    // canvas spread. Charge is moderate so nodes don't fly apart;
    // link distance is short so the graph stays dense; collision
    // prevents overlap.
    const sim = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(50)
          .strength((d) => 0.4 + d.confidence * 0.4),
      )
      .force("charge", d3.forceManyBody<SimNode>().strength(-180))
      .force("center", d3.forceCenter(size.w / 2, size.h / 2))
      .force("collision", d3.forceCollide<SimNode>().radius(18))
      .alpha(0.6)
      .alphaDecay(0.04);

    sim.on("tick", () => {
      linkPath.attr("d", (d) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = d.source as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = d.target as any;
        if (typeof s.x !== "number" || typeof t.x !== "number") return "";
        if (d.isBridge) {
          // Quadratic bezier for bridges — visually distinct
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2 - 18;
          return `M ${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}`;
        }
        return `M ${s.x} ${s.y} L ${t.x} ${t.y}`;
      });
      nodeCircle.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
    });

    return () => {
      sim.stop();
    };
  }, [nodes, links, size.w, size.h, onSelectEntity]);

  // ── Selection highlight + pan/zoom-to-node ──────────────────────────
  // When selectedEntityId changes:
  //   1. Outline the matching node with a thick indigo ring
  //   2. Pulse a halo ring once for ~600ms (visual ack)
  //   3. Animate the d3 zoom transform to center on the node at
  //      ~1.4× zoom so it's prominent without losing context
  //
  // The selection effect handles both visual highlight AND spatial
  // navigation — without the pan/zoom, clicking an insight feels
  // broken because the node might be offscreen.
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const circles = svg
      .select("g.nodes")
      .selectAll<SVGCircleElement, SimNode>("circle");

    // 1. Stroke + width
    circles
      .attr("stroke-width", (d) => {
        if (d.id === selectedEntityId) return 3;
        return d.isLeverage || d.isRisk || d.isBottleneck ? 2 : 1;
      })
      .attr("stroke", (d) => {
        if (d.id === selectedEntityId) return "#4F46E5";
        return nodeStroke(d);
      });

    if (!selectedEntityId) {
      // Clear any lingering halo when selection drops
      svg.select("g.kg-root").selectAll("circle.kg-halo").remove();
      return;
    }

    // 2. Pulse halo — a one-shot expanding ring beneath the node.
    // Strip any previous halo before adding a new one (so rapid
    // re-selection doesn't stack rings).
    const rootG = svg.select<SVGGElement>("g.kg-root");
    rootG.selectAll("circle.kg-halo").remove();

    const target = nodeMapRef.current.get(selectedEntityId);
    if (!target || typeof target.x !== "number" || typeof target.y !== "number") {
      return;
    }
    const baseR = 4 + Math.min(10, Math.sqrt(target.edgeCount) * 2.4);
    rootG
      .insert("circle", ":first-child")
      .attr("class", "kg-halo")
      .attr("cx", target.x)
      .attr("cy", target.y)
      .attr("r", baseR + 2)
      .attr("fill", "none")
      .attr("stroke", "#4F46E5")
      .attr("stroke-width", 2)
      .attr("opacity", 0.85)
      .transition()
      .duration(620)
      .attr("r", baseR + 22)
      .attr("opacity", 0)
      .remove();

    // 3. Pan/zoom-to-node. Compute a transform that places the
    // target's position at the center of the viewport and applies a
    // ~1.4× zoom. Animate via the existing zoom behavior so the user
    // can keep panning/zooming naturally afterward (sets the
    // transform's "current" state on the SVG node).
    const zc = zoomRef.current;
    if (!zc) return;
    const scale = 1.4;
    const tx = zc.sizeW / 2 - scale * target.x;
    const ty = zc.sizeH / 2 - scale * target.y;
    zc.svg
      .transition()
      .duration(420)
      .call(zc.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }, [selectedEntityId]);

  // ── Stats footer ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const density = entities.length > 0 ? edges.length / entities.length : 0;
    let orphans = 0;
    for (const e of entities) {
      if ((edgeCountById.get(e.id) ?? 0) === 0) orphans += 1;
    }
    return { density, orphans };
  }, [entities, edges.length, edgeCountById]);

  // ── Live event ticker ────────────────────────────────────────────────
  // Pull the most recent structural event so the user can see "what
  // just happened" in the chain. Filtered to artifact events only.
  const liveTick = useMemo(() => {
    if (!eventStore) return null;
    const ARTIFACT_TYPES = new Set([
      "entity_added",
      "edge_added",
      "cycle_detected",
      "bridge_formed",
      "signal_detected",
      "proposal_ready",
      "twin_proposal_ready",
    ]);
    for (let i = eventStore.events.length - 1; i >= 0; i--) {
      const ev = eventStore.events[i];
      if (ARTIFACT_TYPES.has(ev.event.type)) return ev;
    }
    return null;
  }, [eventStore]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-col"
      style={{
        background:
          "radial-gradient(circle at 50% 50%, #FFFFFF 0%, #F5F7FB 100%)",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/60 px-5 py-4"
        style={{ background: colors.neutral.panelBgFlat }}
      >
        <div>
          <div
            className="text-[9px] font-bold uppercase text-slate-500"
            style={{ letterSpacing: tracking.eyebrow }}
          >
            {viewMode === "insights" ? "✦ Live insights" : "◈ Knowledge graph"}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900">
            {entities.length} ent · {edges.length} edg
            <span className="ml-2 font-mono text-[11px] font-normal text-slate-500">
              {stats.density.toFixed(2)}× density
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {liveTick && viewMode === "graph" && (
            <LiveTickPill type={liveTick.event.type} />
          )}

          {/* ── Mode toggle ──
           *
           * Segmented control with two options. Default highlights
           * Insights (the dominant view). One click swaps to Graph.
           * Keeps the same visual grammar as the dock-mode chips
           * elsewhere in the app. */}
          <ModeToggle mode={viewMode} onChange={onModeChange} />
        </div>
      </div>

      {/* ── Body: feed or graph based on mode ───────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        {viewMode === "insights" ? (
          <InsightsFeedMode
            entities={entities}
            selectedEntityId={selectedEntityId}
            onSelectEntity={onSelectEntity}
          />
        ) : entities.length === 0 ? (
          <KgEmptyState />
        ) : (
          <svg
            ref={svgRef}
            width={size.w}
            height={size.h - 100}
            className="absolute inset-0"
          />
        )}
      </div>

      {/* ── Footer stats strip ─────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-3 border-t border-slate-200/60 px-5 py-2 text-[10px] font-medium text-slate-500"
        style={{ background: "rgba(255, 255, 255, 0.55)" }}
      >
        <span>
          <span className="font-mono text-slate-700">{cycles.length}</span>{" "}
          cycle{cycles.length === 1 ? "" : "s"}
        </span>
        <span className="text-slate-300">·</span>
        <span>
          <span className="font-mono text-slate-700">{bridges.length}</span>{" "}
          bridge{bridges.length === 1 ? "" : "s"}
        </span>
        <span className="text-slate-300">·</span>
        <span>
          <span className="font-mono text-slate-700">{stats.orphans}</span>{" "}
          orphan{stats.orphans === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {/* Legend chips */}
          <LegendDot color="#0EA5E9" label="internal" />
          <LegendDot color="#8B5CF6" label="conceptual" />
          <LegendDot color="#F59E0B" label="external" />
          <LegendDot color="#10B981" label="bridge" />
        </span>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
function KgEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
        Waiting for signal
      </div>
      <div className="mt-2 max-w-[260px] text-xs leading-relaxed text-slate-500">
        Drop a paper or paste a thought into the left panel. The graph
        will form here as the pipeline runs.
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      <span className="text-[9.5px]">{label}</span>
    </span>
  );
}

function LiveTickPill({ type }: { type: string }) {
  const label =
    type === "entity_added"
      ? "Entity"
      : type === "edge_added"
      ? "Edge"
      : type === "cycle_detected"
      ? "Cycle"
      : type === "bridge_formed"
      ? "Bridge"
      : type === "signal_detected"
      ? "Signal"
      : type === "proposal_ready"
      ? "Proposal"
      : type === "twin_proposal_ready"
      ? "Twin"
      : type;
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-600" />
      </span>
      Just landed · {label}
    </div>
  );
}

// ── Mode toggle (Insights / Graph) ───────────────────────────────────
// Segmented control. The active option carries the brand gradient +
// shadow so the user's current mode reads at a glance. Hover on the
// inactive option lifts it slightly to telegraph it's clickable.
function ModeToggle({
  mode,
  onChange,
}: {
  mode: KgViewMode;
  onChange: (next: KgViewMode) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-full p-0.5"
      style={{ background: colors.neutral.chipBgStrong }}
    >
      <ModeButton
        active={mode === "insights"}
        onClick={() => onChange("insights")}
        label="Insights"
        glyph="✦"
      />
      <ModeButton
        active={mode === "graph"}
        onClick={() => onChange("graph")}
        label="Graph"
        glyph="◈"
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  glyph,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  glyph: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-all"
      style={{
        background: active ? colors.brand.gradient : "transparent",
        color: active ? "white" : "rgb(71, 85, 105)",
        boxShadow: active ? `0 4px 10px ${colors.brand.shadow}` : "none",
      }}
    >
      <span className="font-mono text-[10px]">{glyph}</span>
      {label}
    </button>
  );
}

// ── Color helpers ────────────────────────────────────────────────────
function nodeFill(d: SimNode): string {
  if (d.isBottleneck) return "#DC2626";
  if (d.isLeverage) return "#F59E0B";
  if (d.isRisk) return "#EF4444";
  switch (d.layer) {
    case "internal":
      return "#0EA5E9";
    case "conceptual":
      return "#8B5CF6";
    case "external":
      return "#F59E0B";
    case "bridge":
      return "#10B981";
    default:
      return "#64748B";
  }
}

function nodeStroke(d: SimNode): string {
  if (d.isBottleneck || d.isLeverage || d.isRisk) return "#1E293B";
  return "#FFFFFF";
}

// CSS.escape polyfill — d3 selectors with uuid entity ids contain
// hyphens that interact fine with CSS selectors, but other formats
// might have colons or dots that break unescaped. Defensive.
function cssEscape(s: string): string {
  if (typeof window !== "undefined" && typeof window.CSS?.escape === "function") {
    return window.CSS.escape(s);
  }
  return s.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}
