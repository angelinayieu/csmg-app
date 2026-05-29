"use client";

// ── RoomAltitudeMap (L1) ──────────────────────────────────────────
//
// Phase 12.A (12.A.4). The room rendered as a Causal Loop Diagram:
// pain → mechanism → outcome as left-to-right lanes, edges carrying
// polarity + strength + a mediator pill (the LLM-named mechanism), with
// feedback loops (balancing / reinforcing) detected live and listed in a
// sidebar. The "Map" option alongside the room's Categories / Variables
// views — it reads the SAME lanes + edges, just as a graph.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  MarkerType,
  useReactFlow,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, useReducedMotion } from "framer-motion";
import { GitBranch, Workflow } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  RoomLane,
  RoomEdge,
} from "@/components/objective/sub-objective-room-view";
import { buildRoomGraph } from "../lib/build-room-graph";
import { useLoopDetection } from "../hooks/useLoopDetection";
import { useZoomTransition } from "../hooks/useZoomTransition";
import { RoomItemNode } from "../nodes/RoomItemNode";
import { CausalMapEdge } from "../edges/CausalMapEdge";
import { LaneColumns } from "../overlays/LaneColumns";
import { AltitudeBreadcrumb } from "../controls/AltitudeBreadcrumb";
import { NODE_KIND_ACCENT, LOOP_COLORS, POLARITY_COLORS } from "../lib/visual-grammar";
import type {
  CausalMapNodeData,
  CausalMapEdgeData,
} from "../lib/types";

const nodeTypes: NodeTypes = { roomItem: RoomItemNode };
const edgeTypes: EdgeTypes = { causalMap: CausalMapEdge };

interface Props {
  /** For the breadcrumb's "‹ Canvas" back link. */
  spaceId: string;
  lanes: RoomLane[];
  edges: RoomEdge[];
  height?: number;
  /** Altitude 3 — open the item drawer in place for a clicked node.
   *  When provided, a node click opens this entity's detail drawer
   *  (keeping the user inside the system view) instead of navigating
   *  away to the Lab route. Omit → legacy L1→L2 route navigation. */
  onOpenItem?: (entityId: string) => void;
  /** Altitude 2 — open the focused chain frame for a clicked edge.
   *  Edges in the room map ARE chain hops (problem→mechanism or
   *  mechanism→result), so clicking one is the natural "show me this
   *  bet" gesture. The room view resolves the edge id to its chain
   *  (it owns `allChains`) and zooms into the Chains frame to approve. */
  onOpenChainForEdge?: (edgeId: string) => void;
}

export function RoomAltitudeMap(props: Props) {
  return (
    <ReactFlowProvider>
      <RoomAltitudeMapInner {...props} />
    </ReactFlowProvider>
  );
}

function RoomAltitudeMapInner({
  spaceId,
  lanes,
  edges,
  height = 560,
  onOpenItem,
  onOpenChainForEdge,
}: Props) {
  const reduce = useReducedMotion();
  // Initial highlight can come from a ?loop= deep-link (12.A.10). Lazy
  // init is safe — the room map mounts client-side only (roomView==="map"
  // resolves post-hydration).
  const [highlightedLoop, setHighlightedLoop] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("loop"),
  );
  const rf = useReactFlow();
  const [initialized, setInitialized] = useState(false);
  // Hover-to-trace focus: id of the node under the cursor. Hovering lights
  // that node's whole causal thread and quiets everything else.
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  // ── Reliable initial framing ──
  // RoomItemNode carries a fixed width but a content-driven height (only
  // minHeight is set), so React Flow measures its real size AFTER the
  // first paint. The declarative `fitView` prop runs once on initial
  // render — before that measurement — so it frames against wrong bounds
  // and strands the nodes outside the viewport (the lane overlays still
  // paint because they redraw purely from the viewport transform, which
  // is the "empty colored columns, no nodes" symptom). `useNodesInitialized`
  // flips true once every node has real dimensions; we fit then. Ref-guarded
  // so this only governs entry framing and never hijacks the view after the
  // user has panned or zoomed. (Ported from CanvasAltitudeMap.)
  const nodesInitialized = useNodesInitialized();
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || didInitialFit.current) return;
    didInitialFit.current = true;
    rf.fitView({ padding: 0.2, maxZoom: 1.2, minZoom: 0.25, duration: 300 });
  }, [nodesInitialized, rf]);

  const router = useRouter();
  // subId comes from the route (/app/objective/[spaceId]/sub/[subId]) so
  // we don't have to thread a prop through the (other-session) room view.
  const params = useParams();
  const subId = typeof params?.subId === "string" ? params.subId : "";
  const { trigger: triggerZoom, overlay: zoomOverlay } = useZoomTransition();

  const graph = useMemo(
    () => buildRoomGraph({ lanes, edges, spaceId, subObjectiveId: subId }),
    [lanes, edges, spaceId, subId],
  );

  const loops = useLoopDetection(graph.nodes, graph.edges);
  const activeLoop = useMemo(
    () => loops.find((l) => l.id === highlightedLoop) ?? null,
    [loops, highlightedLoop],
  );

  // Directed adjacency, built once per graph. A hovered node lights its
  // WHOLE thread — every ancestor that feeds it + every descendant it
  // reaches. Following edges only OUTWARD from the hovered node keeps
  // sibling problems that merely share a mechanism out of the highlight,
  // which is exactly the "why does everything connect to everything"
  // confusion we're trying to dissolve.
  const { fwd, bwd } = useMemo(() => {
    const fwd = new Map<string, string[]>();
    const bwd = new Map<string, string[]>();
    const add = (m: Map<string, string[]>, k: string, v: string) => {
      const a = m.get(k);
      if (a) a.push(v);
      else m.set(k, [v]);
    };
    for (const e of graph.edges) {
      add(fwd, e.source, e.target);
      add(bwd, e.target, e.source);
    }
    return { fwd, bwd };
  }, [graph.edges]);

  const focusSet = useMemo(() => {
    if (!focusNodeId) return null;
    const reach = (adj: Map<string, string[]>): Set<string> => {
      const seen = new Set<string>([focusNodeId]);
      const stack = [focusNodeId];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const n of adj.get(cur) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      return seen;
    };
    const set = reach(fwd);
    for (const n of reach(bwd)) set.add(n);
    return set;
  }, [focusNodeId, fwd, bwd]);

  // Node click → drill to the item altitude. Two modes:
  //   • In-place (preferred): when the room view passes onOpenItem, EVERY
  //     node opens its detail drawer (Altitude 3) without leaving the
  //     system view. The drawer links onward to the deeper Lab.
  //   • Legacy route nav: with no in-place host, only mechanism nodes
  //     (which carry an href) bloom + navigate to their Lab page.
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const d = node.data as unknown as CausalMapNodeData;
      if (onOpenItem) {
        onOpenItem(node.id);
        return;
      }
      if (!d.href) return;
      const href = d.href;
      const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const color = NODE_KIND_ACCENT[d.kind] ?? appleVibe.stage.features;
      triggerZoom(
        { top: r.top, left: r.left, width: r.width, height: r.height },
        color,
        () => router.push(href),
      );
    },
    [router, triggerZoom, onOpenItem],
  );

  // Edge click → Altitude 2 (the focused chain frame). The edge id is
  // the room edge id (build-room-graph passes it through verbatim), so
  // the room view can map it to the chain that owns this hop.
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      onOpenChainForEdge?.(edge.id);
    },
    [onOpenChainForEdge],
  );

  // URL-driven focus (?focus=<entityId>) — a deep-link / the chat agent
  // can center a specific pain/mechanism/outcome once the flow inits.
  useEffect(() => {
    if (!initialized) return;
    const focusId = new URLSearchParams(window.location.search).get("focus");
    if (!focusId || !graph.nodes.some((n) => n.id === focusId)) return;
    rf.fitView({
      nodes: [{ id: focusId }],
      padding: 0.6,
      duration: 600,
      maxZoom: 1.3,
    });
  }, [initialized, graph.nodes, rf]);

  // Mirror the active highlight into the URL (?loop=) via replaceState —
  // pure client update (no nav/refetch) so the room loop view is
  // shareable, completing the N3 URL-state contract.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (highlightedLoop) url.searchParams.set("loop", highlightedLoop);
    else url.searchParams.delete("loop");
    window.history.replaceState(null, "", url.toString());
  }, [highlightedLoop]);

  const flowNodes = useMemo(() => {
    const loopNodeSet = new Set(activeLoop?.nodeIds ?? []);
    return graph.nodes.map((n) => {
      const inLoop = loopNodeSet.has(n.id);
      // Loop highlight wins; otherwise a hovered thread drives the fade.
      const faded = activeLoop
        ? !inLoop
        : focusSet
          ? !focusSet.has(n.id)
          : false;
      const data: CausalMapNodeData = {
        ...n.data,
        loopRing: activeLoop && inLoop ? activeLoop.kind : null,
        faded,
      };
      return { ...n, data } as Node;
    });
  }, [graph.nodes, activeLoop, focusSet]);

  const flowEdges = useMemo(() => {
    const loopEdgeSet = new Set(activeLoop?.edgeIds ?? []);
    return graph.edges.map((e) => {
      const inLoop = loopEdgeSet.has(e.id);
      const ed = e.data as CausalMapEdgeData;
      // An edge is part of the traced thread when BOTH its endpoints are in
      // the hovered node's reachable set.
      const focused =
        !activeLoop && !!focusSet && focusSet.has(e.source) && focusSet.has(e.target);
      const faded = activeLoop ? !inLoop : focusSet ? !focused : false;
      const data: CausalMapEdgeData = {
        ...ed,
        loopActive: activeLoop ? inLoop : false,
        loopKind: activeLoop?.kind ?? null,
        faded,
        focused,
      };
      // Arrowhead tracks the edge's polarity color (not React Flow's default
      // gray) and fades with the wire so dimmed edges don't keep bright tips.
      const markerColor = faded
        ? "rgba(15,23,42,0.10)"
        : POLARITY_COLORS[ed.polarity] ?? POLARITY_COLORS.neutral;
      return {
        ...e,
        data,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 13,
          height: 13,
          color: markerColor,
        },
      } as Edge;
    });
  }, [graph.edges, activeLoop, focusSet]);

  // ── Empty state ──
  if (graph.nodes.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-2xl"
        style={{
          height,
          background: appleVibe.surface.base,
          border: `1px solid ${appleVibe.stroke.soft}`,
          fontFamily: appleVibe.font.stack,
        }}
      >
        <Workflow className="h-6 w-6" style={{ color: appleVibe.text.faint }} />
        <p className="text-sm" style={{ color: appleVibe.text.secondary }}>
          Generate this room to see its causal loop diagram.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      className="relative w-full overflow-hidden rounded-2xl"
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
      style={{
        height,
        border: `1px solid ${appleVibe.stroke.soft}`,
        background: appleVibe.surface.base,
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_, node) => setFocusNodeId(node.id)}
        onNodeMouseLeave={() => setFocusNodeId(null)}
        onEdgeClick={onEdgeClick}
        onInit={() => setInitialized(true)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2, minZoom: 0.25 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        minZoom={0.2}
        maxZoom={1.6}
        panOnDrag
        zoomOnScroll={false}
        zoomOnPinch
      >
        <LaneColumns columns={graph.columns} height={graph.height} />
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#E5E7EB" />

        <Panel position="top-left">
          <div className="flex items-center gap-1.5">
            <AltitudeBreadcrumb
              segments={[
                { label: "Canvas", href: `/app/objective/${spaceId}` },
                { label: "Room" },
              ]}
            />
            {loops.length > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  background: "rgba(234,88,12,0.10)",
                  color: "#C2410C",
                  border: `1px solid ${appleVibe.stroke.soft}`,
                  fontFamily: appleVibe.font.stack,
                  backdropFilter: "blur(8px)",
                }}
              >
                <GitBranch className="h-3.5 w-3.5" strokeWidth={2.2} />
                {loops.length} feedback loop{loops.length > 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
        </Panel>
        {loops.length > 0 ? (
          <Panel position="top-right">
              <div
                className="flex max-h-[80%] w-56 flex-col gap-1.5 overflow-auto rounded-2xl p-2"
                style={{
                  background: appleVibe.surface.cardElevated,
                  border: `1px solid ${appleVibe.stroke.soft}`,
                  boxShadow: appleVibe.shadow.card,
                  fontFamily: appleVibe.font.stack,
                  backdropFilter: "blur(8px)",
                }}
              >
                <span
                  className="px-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Feedback loops
                </span>
                {loops.map((loop) => {
                  const c = LOOP_COLORS[loop.kind];
                  const active = loop.id === highlightedLoop;
                  return (
                    <button
                      key={loop.id}
                      type="button"
                      onClick={() =>
                        setHighlightedLoop(active ? null : loop.id)
                      }
                      className="flex items-start gap-2 rounded-xl px-2 py-1.5 text-left transition-colors"
                      style={{
                        background: active ? c.tint : "transparent",
                        border: `1px solid ${active ? c.ring : "transparent"}`,
                      }}
                    >
                      <span
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ background: c.ring }}
                      >
                        {c.label}
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span
                          className="text-[11px] font-semibold leading-tight"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {loop.label}
                        </span>
                        <span
                          className="text-[9.5px]"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          {loop.kind === "reinforcing"
                            ? "Reinforcing"
                            : "Balancing"}{" "}
                          · {loop.nodeIds.length} nodes
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Panel>
        ) : null}

        <Controls
          position="bottom-right"
          showInteractive={false}
          className="!bg-white/80 !ring-1 !ring-black/5 !rounded-lg !shadow-sm"
        />
        {/* The minimap only earns its space when the room is big enough to
            pan around. For a typical room the whole graph fits on screen, so
            it was just an empty box in the corner — hide it under that size. */}
        {graph.nodes.length > 16 ? (
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeStrokeWidth={2}
            nodeColor={(n) => {
              const d = n.data as unknown as CausalMapNodeData;
              return NODE_KIND_ACCENT[d?.kind ?? "feature"];
            }}
            maskColor="rgba(15,23,42,0.06)"
            className="!bg-white/80 !ring-1 !ring-black/5 !rounded-lg !shadow-sm"
          />
        ) : null}
      </ReactFlow>
      {zoomOverlay}
    </motion.div>
  );
}
