"use client";

// ── RoomAltitudeMap (L1) ──────────────────────────────────────────
//
// Phase 12.A (12.A.4). The room rendered as a Causal Loop Diagram:
// pain → mechanism → outcome as left-to-right lanes, edges carrying
// polarity + strength + a mediator pill (the LLM-named mechanism), with
// feedback loops (balancing / reinforcing) detected live and listed in a
// sidebar. The "Map" option alongside the room's Categories / Variables
// views — it reads the SAME lanes + edges, just as a graph.

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { NODE_KIND_ACCENT, LOOP_COLORS } from "../lib/visual-grammar";
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

  // L1→L2 drill-down: clicking a mechanism node blooms + opens its Lab
  // page (the existing item altitude). Only feature nodes carry an href.
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const d = node.data as unknown as CausalMapNodeData;
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
    [router, triggerZoom],
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
      const data: CausalMapNodeData = {
        ...n.data,
        loopRing: activeLoop && inLoop ? activeLoop.kind : null,
        faded: activeLoop ? !inLoop : false,
      };
      return { ...n, data } as Node;
    });
  }, [graph.nodes, activeLoop]);

  const flowEdges = useMemo(() => {
    const loopEdgeSet = new Set(activeLoop?.edgeIds ?? []);
    return graph.edges.map((e) => {
      const inLoop = loopEdgeSet.has(e.id);
      const data: CausalMapEdgeData = {
        ...(e.data as CausalMapEdgeData),
        loopActive: activeLoop ? inLoop : false,
        loopKind: activeLoop?.kind ?? null,
        faded: activeLoop ? !inLoop : false,
      };
      return {
        ...e,
        data,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      } as Edge;
    });
  }, [graph.edges, activeLoop]);

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
      </ReactFlow>
      {zoomOverlay}
    </motion.div>
  );
}
