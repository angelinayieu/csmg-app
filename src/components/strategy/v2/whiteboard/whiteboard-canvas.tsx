"use client";

import {
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useCanvasTransform } from "@/components/operating-twin/hooks/use-canvas-transform";
import { WhiteboardNode } from "./whiteboard-node";
import { WhiteboardEdge, WhiteboardEdgeMarkers } from "./whiteboard-edge";
import { PostItNoteView } from "./post-it-note";
import { WhiteboardControls } from "./whiteboard-controls";
import { WhiteboardInspector } from "./whiteboard-inspector";
import { useWhiteboardPhysics } from "./use-whiteboard-physics";
import { useWhiteboardPersistence } from "./use-whiteboard-persistence";
import {
  LAYER_Y,
  LAYER_ORDER,
  LAYER_BAND_HEIGHT,
  LAYER_BAND_FILL,
  LAYER_LABELS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "./layers";
import type {
  WhiteboardModel,
  WhiteboardLayer,
  PostItColor,
  PostItNote as PostItType,
  WhiteboardNode as WBNode,
} from "@/types/whiteboard";

interface CanvasProps {
  model: WhiteboardModel;
  spaceId: string;
}

export function WhiteboardCanvas({ model, spaceId }: CanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const { transform, zoomIn, zoomOut, reset, noTransition } = useCanvasTransform(canvasRef);

  const {
    postits,
    userEdges,
    pins,
    addPostIt,
    updatePostIt,
    removePostIt,
    setPin,
    clearAllPins,
  } = useWhiteboardPersistence(spaceId);

  const [hiddenLayers, setHiddenLayers] = useState<Set<WhiteboardLayer>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const visibleNodes = useMemo(
    () => model.nodes.filter((n) => !hiddenLayers.has(n.layer)),
    [model.nodes, hiddenLayers]
  );

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return [...model.edges, ...userEdges].filter(
      (e) => ids.has(e.source) && ids.has(e.target)
    );
  }, [visibleNodes, model.edges, userEdges]);

  const physics = useWhiteboardPhysics({
    nodes: visibleNodes,
    edges: model.edges,
    width: CANVAS_WIDTH,
    pins,
    hiddenLayers,
  });

  const nodeById = useMemo(() => {
    const m = new Map<string, WBNode>();
    for (const n of physics.nodes) m.set(n.id, n);
    return m;
  }, [physics.nodes]);

  // ── Node dragging ──
  const dragState = useRef<{
    id: string;
    pointerId: number;
    startClient: { x: number; y: number };
    startNode: { x: number; y: number };
  } | null>(null);

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      const n = nodeById.get(id);
      if (!n) return;
      const startX = n.x ?? 0;
      const startY = n.y ?? 0;
      dragState.current = {
        id,
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startNode: { x: startX, y: startY },
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
    },
    [nodeById]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds || e.pointerId !== ds.pointerId) return;
      const dx = (e.clientX - ds.startClient.x) / transform.scale;
      const dy = (e.clientY - ds.startClient.y) / transform.scale;
      physics.pinDuringDrag(ds.id, ds.startNode.x + dx, ds.startNode.y + dy);
    };
    const onUp = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds || e.pointerId !== ds.pointerId) return;
      const n = nodeById.get(ds.id);
      if (n && n.x != null && n.y != null) {
        setPin(ds.id, { x: n.x, y: n.y });
      }
      physics.endDrag();
      dragState.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [physics, setPin, nodeById, transform.scale]);

  // ── Post-it dragging ──
  const postitDragRef = useRef<{
    id: string;
    pointerId: number;
    startClient: { x: number; y: number };
    startPos: { x: number; y: number };
  } | null>(null);

  const handlePostItPointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      const p = postits.find((p) => p.id === id);
      if (!p) return;
      postitDragRef.current = {
        id,
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startPos: { x: p.x, y: p.y },
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
    },
    [postits]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const ds = postitDragRef.current;
      if (!ds || e.pointerId !== ds.pointerId) return;
      const dx = (e.clientX - ds.startClient.x) / transform.scale;
      const dy = (e.clientY - ds.startClient.y) / transform.scale;
      updatePostIt(ds.id, { x: ds.startPos.x + dx, y: ds.startPos.y + dy });
    };
    const onUp = (e: PointerEvent) => {
      const ds = postitDragRef.current;
      if (!ds || e.pointerId !== ds.pointerId) return;
      postitDragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updatePostIt, transform.scale]);

  // ── Double-click canvas: spawn post-it ──
  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!innerRef.current) return;
      const rect = innerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / transform.scale;
      const y = (e.clientY - rect.top) / transform.scale;
      const note: PostItType = {
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        x: x - 90,
        y: y - 65,
        text: "",
        color: "yellow",
        createdAt: Date.now(),
      };
      addPostIt(note);
    },
    [addPostIt, transform.scale]
  );

  const handleAddPostItButton = useCallback(() => {
    const colors: PostItColor[] = ["yellow", "pink", "blue", "green"];
    const note: PostItType = {
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      x: 700 + (Math.random() - 0.5) * 200,
      y: 200 + (Math.random() - 0.5) * 100,
      text: "",
      color: colors[Math.floor(Math.random() * colors.length)],
      createdAt: Date.now(),
    };
    addPostIt(note);
  }, [addPostIt]);

  const toggleLayer = useCallback((layer: WhiteboardLayer) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedNodeId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;

  return (
    <div
      ref={canvasRef}
      className="relative h-full w-full overflow-hidden select-none"
      style={{
        background: "linear-gradient(180deg, #FAFBFC 0%, #F4F5F8 100%)",
        cursor: "grab",
      }}
    >
      {/* Fine grid background (stays in place during zoom via CSS size) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(11, 13, 18, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(11, 13, 18, 0.035) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* Pannable/zoomable inner container */}
      <div
        ref={innerRef}
        onDoubleClick={handleCanvasDoubleClick}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
          transition: noTransition ? "none" : "transform 180ms ease-out",
        }}
      >
        {/* ── Layer background bands (hidden layers still drawn at low opacity) ── */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ zIndex: 0 }}
        >
          {LAYER_ORDER.map((layer) => {
            const hidden = hiddenLayers.has(layer);
            return (
              <g key={`band-${layer}`} opacity={hidden ? 0.3 : 1}>
                <rect
                  x={0}
                  y={LAYER_Y[layer] - LAYER_BAND_HEIGHT / 2}
                  width={CANVAS_WIDTH}
                  height={LAYER_BAND_HEIGHT}
                  fill={LAYER_BAND_FILL[layer]}
                />
                {/* Subtle top/bottom divider lines */}
                <line
                  x1={0}
                  x2={CANVAS_WIDTH}
                  y1={LAYER_Y[layer] - LAYER_BAND_HEIGHT / 2}
                  y2={LAYER_Y[layer] - LAYER_BAND_HEIGHT / 2}
                  stroke="rgba(11, 13, 18, 0.04)"
                  strokeWidth={1}
                />
                <text
                  x={28}
                  y={LAYER_Y[layer] - LAYER_BAND_HEIGHT / 2 + 18}
                  fontSize="10"
                  fontWeight="700"
                  fill="rgba(11, 13, 18, 0.38)"
                  letterSpacing="0.2em"
                  style={{ textTransform: "uppercase" }}
                >
                  {LAYER_LABELS[layer].toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>

        {/* ── Edges (SVG, between bands and nodes) ── */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ zIndex: 5 }}
        >
          <WhiteboardEdgeMarkers />
          {visibleEdges.map((e) => {
            const s = nodeById.get(e.source);
            const t = nodeById.get(e.target);
            if (!s || !t) return null;
            return <WhiteboardEdge key={e.id} edge={e} source={s} target={t} />;
          })}
        </svg>

        {/* Nodes */}
        {physics.nodes.map((n) => (
          <WhiteboardNode
            key={n.id}
            node={n}
            pinned={!!pins[n.id]}
            selected={selectedNodeId === n.id}
            onPointerDown={handleNodePointerDown}
            onClick={setSelectedNodeId}
          />
        ))}

        {/* Post-its */}
        {postits.map((p) => (
          <PostItNoteView
            key={p.id}
            note={p}
            onUpdate={updatePostIt}
            onRemove={removePostIt}
            onDragStart={handlePostItPointerDown}
          />
        ))}
      </div>

      {/* Floating controls (outside the transform) */}
      <WhiteboardControls
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        reset={reset}
        onAddPostIt={handleAddPostItButton}
        hiddenLayers={hiddenLayers}
        onToggleLayer={toggleLayer}
        onResetPins={clearAllPins}
      />

      {/* Inspector */}
      <WhiteboardInspector
        node={selectedNode}
        spaceId={spaceId}
        pinned={selectedNodeId ? !!pins[selectedNodeId] : false}
        onClose={() => setSelectedNodeId(null)}
        onTogglePin={() => {
          if (!selectedNode || selectedNode.x == null || selectedNode.y == null) return;
          if (pins[selectedNode.id]) {
            setPin(selectedNode.id, null);
          } else {
            setPin(selectedNode.id, { x: selectedNode.x, y: selectedNode.y });
          }
        }}
      />
    </div>
  );
}
