"use client";

// ── CanvasAltitudeMap (L0) ────────────────────────────────────────
//
// Phase 12.A (12.A.2). The main whiteboard rendered as a layered causal
// graph: sub-objectives as nodes positioned by their ObjectiveStack
// layer ordinal (outcome at top → substrate at bottom), connected by
// cross-room association edges, with feedback loops detected live and a
// toggleable health overlay.
//
// This is THE moment the spec calls out (§17.15): "I'm browsing my work"
// → "I'm looking at the system I'm building."

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  GitBranch,
  Layers as LayersIcon,
  RotateCcw,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { CrossRoomSignals } from "@/lib/objective-canvas/cross-room-signals";
import { buildCanvasGraph } from "../lib/graph-build";
import { useLayoutAlgorithm } from "../hooks/useLayoutAlgorithm";
import { useLoopDetection } from "../hooks/useLoopDetection";
import { useZoomTransition } from "../hooks/useZoomTransition";
import { useLocalPref } from "../hooks/useLocalPref";
import { useMapState } from "../hooks/useMapState";
import { SubObjectiveNode } from "../nodes/SubObjectiveNode";
import { CausalMapEdge } from "../edges/CausalMapEdge";
import { LayerBands } from "../overlays/LayerBands";
import {
  HEALTH_COLORS,
  LOOP_COLORS,
  NODE_KIND_ACCENT,
} from "../lib/visual-grammar";
import type {
  CausalMapNodeData,
  CausalMapEdgeData,
} from "../lib/types";

const nodeTypes: NodeTypes = { subObjective: SubObjectiveNode };
const edgeTypes: EdgeTypes = { causalMap: CausalMapEdge };

interface Props {
  spaceId: string;
  subs: MainCanvasSub[];
  objectiveStack?: ObjectiveStack | null;
  crossRoomSignals?: CrossRoomSignals | null;
  height?: number;
}

export function CanvasAltitudeMap(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasAltitudeMapInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasAltitudeMapInner({
  spaceId,
  subs,
  objectiveStack,
  crossRoomSignals,
  height = 640,
}: Props) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { trigger: triggerZoom, overlay: zoomOverlay } = useZoomTransition();
  const [showHealth, setShowHealth] = useLocalPref<boolean>(
    `causalmap:health:${spaceId}`,
    true,
  );
  // Per-user pinned node positions (server-persisted via causal_map_state).
  const { pins, setPin, resetPins } = useMapState(spaceId);
  // Initial highlight can come from a ?loop= deep-link (12.A.10). Safe as
  // a lazy initializer (no effect, no hydration mismatch) because this
  // component mounts client-side only — the map renders only when
  // canvasView==="map", which itself resolves post-hydration.
  const [highlightedLoop, setHighlightedLoop] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("loop"),
  );
  const rf = useReactFlow();
  const [initialized, setInitialized] = useState(false);

  // 1. Build the graph (pure) from the data the canvas already has.
  const graph = useMemo(
    () =>
      buildCanvasGraph({
        spaceId,
        subs,
        objectiveStack,
        crossRoomSignals,
      }),
    [spaceId, subs, objectiveStack, crossRoomSignals],
  );

  // 2. Lay it out — layered when a stack exists, else dagre fallback.
  const algorithm = graph.hasLayerStack ? "layered" : "force";
  const layout = useLayoutAlgorithm(
    algorithm,
    graph.nodes,
    graph.edges,
    graph.bands,
  );

  // 3. Detect feedback loops (client-side, live).
  const loops = useLoopDetection(layout.nodes, graph.edges);
  const activeLoop = useMemo(
    () => loops.find((l) => l.id === highlightedLoop) ?? null,
    [loops, highlightedLoop],
  );

  // URL-driven focus (12.A.10 foundation). A deep-link or the chat agent
  // can point the map at a node (?focus=) — the ?loop= deep-link is
  // applied as the initial highlight above. No cross-component event bus,
  // so the agent's focus_node / highlight_loop tools become a plain
  // navigation later. window.location (not useSearchParams) → no
  // Suspense/static constraint; the map mounts client-side only.
  useEffect(() => {
    if (!initialized) return;
    const focusId = new URLSearchParams(window.location.search).get("focus");
    if (!focusId || !layout.nodes.some((n) => n.id === focusId)) return;
    rf.fitView({
      nodes: [{ id: focusId }],
      padding: 0.6,
      duration: 600,
      maxZoom: 1.2,
    });
  }, [initialized, layout.nodes, rf]);

  // Mirror the active highlight into the URL (?loop=) via replaceState —
  // a pure client URL update (no navigation / refetch) so the current
  // view is shareable + bookmarkable, completing the N3 URL-state
  // contract (read above, write here).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (highlightedLoop) url.searchParams.set("loop", highlightedLoop);
    else url.searchParams.delete("loop");
    window.history.replaceState(null, "", url.toString());
  }, [highlightedLoop]);

  // 4. Annotate nodes/edges with transient view flags (health overlay +
  //    loop highlight + fade). New objects so React Flow re-renders.
  const flowNodes = useMemo(() => {
    const loopNodeSet = new Set(activeLoop?.nodeIds ?? []);
    return layout.nodes.map((n) => {
      const inLoop = loopNodeSet.has(n.id);
      const data: CausalMapNodeData = {
        ...n.data,
        showHealth,
        loopRing: activeLoop && inLoop ? activeLoop.kind : null,
        faded: activeLoop ? !inLoop : false,
      };
      // A user-pinned position overrides the auto-layout for that node.
      return { ...n, position: pins[n.id] ?? n.position, data } as Node;
    });
  }, [layout.nodes, showHealth, activeLoop, pins]);

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

  // Zoom-into-room: bloom an accent veil out of the clicked node, then
  // navigate. The room map plays a matching scale-in on mount, so the
  // canvas→room hop reads as one continuous zoom (12.A.7).
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const d = node.data as unknown as CausalMapNodeData;
      if (!d.href) return;
      const href = d.href;
      const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const color = NODE_KIND_ACCENT[d.kind] ?? appleVibe.stage.objective;
      triggerZoom(
        { top: r.top, left: r.left, width: r.width, height: r.height },
        color,
        () => router.push(href),
      );
    },
    [router, triggerZoom],
  );

  // Drag-to-pin: capture position changes into per-user map state. The
  // handler is what makes controlled nodes draggable; position changes
  // flow into `pins` → flowNodes recomputes → the node follows the
  // cursor, and the debounced PUT persists it. Position-only is
  // sufficient — React Flow still measures node dimensions internally.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          setPin(c.id, c.position);
        }
      }
    },
    [setPin],
  );

  // ── Empty state ──
  if (subs.length === 0) {
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
        <LayersIcon
          className="h-6 w-6"
          style={{ color: appleVibe.text.faint }}
        />
        <p className="text-sm" style={{ color: appleVibe.text.secondary }}>
          Confirm sub-objectives to populate the map.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      className="relative w-full overflow-hidden rounded-2xl"
      initial={reduce ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
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
        onNodesChange={onNodesChange}
        onInit={() => setInitialized(true)}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.1, minZoom: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        minZoom={0.15}
        maxZoom={1.6}
        panOnDrag
        zoomOnScroll={false}
        zoomOnPinch
      >
        {/* Layer bands sit behind everything (zIndex 0). */}
        <LayerBands bands={layout.bands} width={layout.width} />

        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#E5E7EB" />

        {/* Toolbar */}
        <Panel position="top-left">
          <div
            className="flex items-center gap-2 rounded-full px-2 py-1.5"
            style={{
              background: appleVibe.surface.cardElevated,
              border: `1px solid ${appleVibe.stroke.soft}`,
              boxShadow: appleVibe.shadow.chip,
              fontFamily: appleVibe.font.stack,
              backdropFilter: "blur(8px)",
            }}
          >
            <span
              className="inline-flex items-center gap-1 pl-1 text-[11px] font-semibold"
              style={{ color: appleVibe.text.secondary }}
            >
              <LayersIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
              {algorithm === "layered" ? "Layered" : "Network"}
            </span>
            <span
              aria-hidden
              className="h-3.5 w-px"
              style={{ background: appleVibe.stroke.medium }}
            />
            <button
              type="button"
              onClick={() => setShowHealth(!showHealth)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition-colors"
              style={{
                background: showHealth
                  ? "rgba(22,163,74,0.12)"
                  : appleVibe.surface.chip,
                color: showHealth ? "#15803D" : appleVibe.text.tertiary,
              }}
              title="Toggle health overlay"
            >
              <Activity className="h-3.5 w-3.5" strokeWidth={2.2} />
              Health
            </button>
            {loops.length > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
                style={{
                  background: "rgba(234,88,12,0.10)",
                  color: "#C2410C",
                }}
              >
                <GitBranch className="h-3.5 w-3.5" strokeWidth={2.2} />
                {loops.length} loop{loops.length > 1 ? "s" : ""}
              </span>
            ) : null}
            {Object.keys(pins).length > 0 ? (
              <button
                type="button"
                onClick={resetPins}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition-colors"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.tertiary,
                }}
                title="Reset to auto-layout"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
                Reset
              </button>
            ) : null}
          </div>
        </Panel>

        {/* Loop sidebar — listing + click-to-highlight */}
        {loops.length > 0 ? (
          <Panel position="top-right">
            <div
              className="flex max-h-[80%] w-60 flex-col gap-1.5 overflow-auto rounded-2xl p-2"
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
            return HEALTH_COLORS[d?.healthBand ?? "unknown"].dot;
          }}
          maskColor="rgba(15,23,42,0.06)"
          className="!bg-white/80 !ring-1 !ring-black/5 !rounded-lg !shadow-sm"
        />
      </ReactFlow>
      {zoomOverlay}
    </motion.div>
  );
}
