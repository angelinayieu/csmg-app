"use client";

// ── Data-Flow Graph View ───────────────────────────────────────────
//
// The whole-app data-unit flow map: data units are nodes, features are the
// OPERATORS that transform them. Left → right reads as initial data points
// (sources) → operators → final transformed points (sinks). React Flow +
// dagre LR, mirroring mechanism-dataflow-view's rendering vocabulary so the
// look is consistent across the app's two dataflow surfaces.
//
// Fed by feature-level data tokens (Foundation B: causal_chain.data_io +
// mechanism_spec.runtime_flow). Display-only here; the SAME {nodes,edges}
// model is what the whiteboard-export adapter will materialize as real
// bound tldraw arrows (export task), so this view never hand-rolls SVG.

import { memo, useMemo, useState } from "react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  buildDataFlowGraph,
  type DataFlowFeature,
  type DataFlowUnitRole,
} from "@/lib/objective-canvas/build-data-flow-graph";
import { sendDataFlowToBoard } from "@/components/objective/board-bus";
import { Frame } from "lucide-react";

// ── Layout config ─────────────────────────────────────────────────

const UNIT_W = 160;
const UNIT_H = 42;
const OP_W = 190;
const OP_H = 66;
const RANK_SEP = 88;
const NODE_SEP = 22;

const DATA_BLUE = "rgba(10,132,255,1)";

// role → accent for unit nodes (source = inbound blue, sink = outcome
// green, intermediate = neutral slate).
function roleAccent(role: DataFlowUnitRole): string {
  if (role === "source") return DATA_BLUE;
  if (role === "sink") return appleVibe.stage.outcomes;
  return "rgba(71,85,105,0.9)";
}
function roleLabel(role: DataFlowUnitRole): string {
  if (role === "source") return "source";
  if (role === "sink") return "output";
  return "data";
}

// ── Node data shapes ──────────────────────────────────────────────

interface UnitNodeData {
  label: string;
  role: DataFlowUnitRole;
}
interface OperatorNodeData {
  label: string;
  roomTitle: string | null;
}

// ── Dagre layout ──────────────────────────────────────────────────

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 18,
    marginy: 18,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const w = n.type === "operator" ? OP_W : UNIT_W;
    const h = n.type === "operator" ? OP_H : UNIT_H;
    g.setNode(n.id, { width: w, height: h });
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    if (!p) return n;
    const w = n.type === "operator" ? OP_W : UNIT_W;
    const h = n.type === "operator" ? OP_H : UNIT_H;
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } };
  });
}

// ── Custom node: data unit ────────────────────────────────────────

function UnitNodeInner({ data }: NodeProps) {
  const d = data as unknown as UnitNodeData;
  const accent = roleAccent(d.role);
  return (
    <div
      style={{
        width: UNIT_W,
        minHeight: UNIT_H,
        borderRadius: 9999,
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(16px) saturate(140%)",
        WebkitBackdropFilter: "blur(16px) saturate(140%)",
        border: `1px solid ${accent}66`,
        boxShadow: `0 1px 0 rgba(255,255,255,0.7) inset, 0 6px 18px -12px ${accent}66`,
        padding: "6px 12px",
        display: "flex",
        alignItems: "center",
        gap: 7,
        overflow: "hidden",
      }}
      title={`${roleLabel(d.role)} · ${d.label}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: `${accent}99`, width: 6, height: 6, border: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: `${accent}99`, width: 6, height: 6, border: "none" }}
      />
      <span
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: accent }}
        aria-hidden
      />
      <span
        className="truncate text-[11px] font-medium"
        style={{
          color: appleVibe.text.primary,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {d.label}
      </span>
    </div>
  );
}
const UnitNode = memo(UnitNodeInner);

// ── Custom node: feature operator ─────────────────────────────────

function OperatorNodeInner({ data }: NodeProps) {
  const d = data as unknown as OperatorNodeData;
  const [hover, setHover] = useState(false);
  const accent = appleVibe.stage.features;

  const restShadow = `0 1px 0 rgba(255,255,255,0.7) inset, 0 8px 24px -14px rgba(11,18,40,0.20), 0 0 0 1px ${accent}0D`;
  const liftShadow = `0 1px 0 rgba(255,255,255,0.7) inset, 0 16px 38px -14px rgba(11,18,40,0.26), 0 0 22px -6px ${accent}40`;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: OP_W,
        height: OP_H,
        borderRadius: 14,
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        border: `1px solid ${hover ? `${accent}55` : appleVibe.stroke.hairline}`,
        boxShadow: hover ? liftShadow : restShadow,
        padding: "8px 10px",
        transition: "border-color 200ms ease, box-shadow 200ms ease",
        overflow: "hidden",
      }}
      title={d.roomTitle ? `${d.label} · ${d.roomTitle}` : d.label}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: appleVibe.stroke.hairline, width: 6, height: 6, border: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: appleVibe.stroke.hairline, width: 6, height: 6, border: "none" }}
      />
      <div className="flex items-start gap-1.5">
        <span
          className="mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px]"
          style={{ background: `${accent}1A`, color: accent }}
          aria-hidden
        >
          ⚙
        </span>
        <span
          className="line-clamp-2 flex-1 text-[11.5px] font-semibold leading-tight"
          style={{ color: appleVibe.text.primary }}
        >
          {d.label}
        </span>
      </div>
      {d.roomTitle && (
        <div
          className="mt-1 truncate text-[9.5px] font-light"
          style={{ color: appleVibe.text.faint }}
        >
          {d.roomTitle}
        </div>
      )}
    </div>
  );
}
const OperatorNode = memo(OperatorNodeInner);

const NODE_TYPES: NodeTypes = { unit: UnitNode, operator: OperatorNode };

// ── Custom edge: dataflow (hover reveals token) ───────────────────

function DataflowEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } =
    props;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  const token = ((data as { token?: string } | undefined)?.token ?? "").trim();
  const isProduce = (data as { kind?: string } | undefined)?.kind === "produce";
  const [hover, setHover] = useState(false);
  const base = isProduce ? "rgba(10,132,255,0.5)" : "rgba(15,23,42,0.18)";

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: hover ? "rgba(10,132,255,0.7)" : base,
          strokeWidth: hover ? 2 : 1.5,
          transition: "stroke 160ms ease, stroke-width 160ms ease",
        }}
        interactionWidth={20}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      {token.length > 0 && hover && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 9,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              background: "rgba(15,23,42,0.92)",
              color: "white",
              padding: "2px 6px",
              borderRadius: 4,
              pointerEvents: "none",
              zIndex: 10,
              whiteSpace: "nowrap",
            }}
          >
            {token}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const EDGE_TYPES: EdgeTypes = { dataflow: DataflowEdge };

// ── Main component ────────────────────────────────────────────────

interface Props {
  features: DataFlowFeature[];
  height?: number;
}

export function DataFlowGraphView({ features, height = 420 }: Props) {
  const graph = useMemo(() => buildDataFlowGraph(features), [features]);
  const result = useMemo(() => {
    if (graph.nodes.length === 0) return null;
    const rfNodes: Node[] = graph.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      data:
        n.kind === "operator"
          ? ({ label: n.label, roomTitle: n.roomTitle ?? null } satisfies OperatorNodeData)
          : ({ label: n.label, role: n.role ?? "intermediate" } satisfies UnitNodeData),
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }));
    const rfEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "dataflow",
      data: { token: e.token, kind: e.kind },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: e.kind === "produce" ? "rgba(10,132,255,0.6)" : "rgba(15,23,42,0.3)",
      },
    }));
    return { nodes: layoutNodes(rfNodes, rfEdges), edges: rfEdges, stats: graph.stats };
  }, [graph]);

  if (!result) {
    return (
      <div
        className="rounded-2xl px-4 py-8 text-center text-[12px] font-light italic"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          color: appleVibe.text.tertiary,
        }}
      >
        No data flow yet — generate or deepen rooms so features declare the
        data they read and produce.
      </div>
    );
  }

  const { sources, sinks, units, operators } = result.stats;

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        height,
        background: "rgba(255,255,255,0.55)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        boxShadow: "0 1px 0 rgba(255,255,255,0.7) inset",
      }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={result.nodes}
          edges={result.edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1.2, minZoom: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="rgba(15,23,42,0.06)"
            gap={20}
            size={1}
          />
        </ReactFlow>
      </ReactFlowProvider>
      {/* legend / stats */}
      <div
        className="absolute left-2 top-2 flex items-center gap-2 rounded-lg px-2 py-1 text-[9.5px] font-medium"
        style={{
          background: "rgba(255,255,255,0.86)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          color: appleVibe.text.tertiary,
        }}
      >
        <span style={{ color: DATA_BLUE }}>● {sources} source</span>
        <span style={{ color: "rgba(71,85,105,0.9)" }}>● {units} units</span>
        <span style={{ color: appleVibe.stage.features }}>⚙ {operators} ops</span>
        <span style={{ color: appleVibe.stage.outcomes }}>● {sinks} output</span>
      </div>
      {/* Send to whiteboard — materialize this exact graph as real bound
          tldraw nodes the user can brainstorm around (reuses the unfurl
          arrow machinery; cleared by the board's unfurl sweep). */}
      <button
        type="button"
        onClick={() => sendDataFlowToBoard(graph)}
        className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10.5px] font-semibold transition-all duration-150"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          color: appleVibe.text.primary,
          boxShadow: appleVibe.shadow.chip,
        }}
        title="Drop this map onto the whiteboard as real connected nodes to brainstorm on"
      >
        <Frame className="h-3 w-3" strokeWidth={2} />
        Send to whiteboard
      </button>
    </div>
  );
}
