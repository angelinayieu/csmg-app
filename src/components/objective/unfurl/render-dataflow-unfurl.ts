"use client";

// ── syncDataFlowUnfurl ──
//
// Materializes a DataFlowGraph (build-data-flow-graph.ts) onto the tldraw
// board as REAL shapes: every data unit + feature operator becomes an
// `artifact-card` (the already-registered shape — no new ShapeUtil), and
// every consume/produce edge becomes a bound `arrow` via createUnfurlArrow
// (the same machinery the canvas/room unfurls use). Laid out left→right
// with dagre — sources → operators → outputs — the same flow the in-panel
// DataFlowGraphView shows, but now as editable, connectable board objects
// the user can brainstorm around (the "drop the map in to expand on it"
// move).
//
// Every shape carries meta.unfurl, so the board's unmount sweep +
// exitUnfurl (clearUnfurl) remove them — they never leak into the saved
// store. Re-running clears the prior unfurl first (clean replace). Unlike
// the anchor-based OPEN_UNFURL path, the graph is passed in directly (the
// caller fires SEND_DATAFLOW_EVENT with the {nodes,edges} payload).

import { type Editor, type TLShapeId, type TLShapePartial } from "tldraw";
import dagre from "@dagrejs/dagre";
import type { ArtifactCardShape } from "@/components/objective/shapes/artifact-card-shape";
import { createUnfurlArrow } from "./render-canvas-unfurl";
import { clearUnfurl } from "./render-unfurl";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  DataFlowGraph,
  DataFlowUnitRole,
} from "@/lib/objective-canvas/build-data-flow-graph";

// ── layout constants ──
const UNIT_W = 188;
const UNIT_H = 60;
const OP_W = 224;
const OP_H = 92;
const RANK_SEP = 130;
const NODE_SEP = 36;

const DATA_BLUE = "rgba(10,132,255,1)";

// Stable, data-flow-namespaced ids so a re-run diffs cleanly and the clear
// sweep (meta.unfurl) still catches them.
function dfId(s: string): TLShapeId {
  return `shape:unfurl-df-${s.replace(/[^a-zA-Z0-9_-]/g, "_")}` as TLShapeId;
}

function unitColor(role: DataFlowUnitRole | undefined): string {
  if (role === "source") return DATA_BLUE;
  if (role === "sink") return appleVibe.stage.outcomes;
  return "rgba(71,85,105,0.9)";
}
function unitSubtitle(role: DataFlowUnitRole | undefined): string {
  if (role === "source") return "source · external input";
  if (role === "sink") return "output · final data";
  return "data unit";
}

export function syncDataFlowUnfurl(editor: Editor, graph: DataFlowGraph): void {
  // Clean replace — drop any prior unfurl (canvas / room / data-flow) so the
  // board shows just this map.
  clearUnfurl(editor);
  if (graph.nodes.length === 0) return;

  // ── dagre LR layout (sources left → operators → outputs right) ──
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) {
    const isOp = n.kind === "operator";
    g.setNode(n.id, {
      width: isOp ? OP_W : UNIT_W,
      height: isOp ? OP_H : UNIT_H,
    });
  }
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }
  dagre.layout(g);

  // ── nodes → artifact-card shapes ──
  for (const n of graph.nodes) {
    const isOp = n.kind === "operator";
    const w = isOp ? OP_W : UNIT_W;
    const h = isOp ? OP_H : UNIT_H;
    const p = g.node(n.id);
    const shape: TLShapePartial<ArtifactCardShape> = {
      id: dfId(n.id),
      type: "artifact-card",
      x: (p?.x ?? 0) - w / 2,
      y: (p?.y ?? 0) - h / 2,
      props: {
        w,
        h,
        kind: isOp ? "feature" : "outcome",
        title: n.label,
        subtitle: isOp ? n.roomTitle ?? "operator" : unitSubtitle(n.role),
        color: isOp ? appleVibe.stage.features : unitColor(n.role),
        entityId: n.id,
        roomId: "__dataflow",
      },
      meta: { unfurl: true, compact: true },
    };
    editor.createShape(shape);
  }

  // ── edges → bound arrows (endpoints exist now) ──
  for (const e of graph.edges) {
    const fromId = dfId(e.source);
    const toId = dfId(e.target);
    if (!editor.getShape(fromId) || !editor.getShape(toId)) continue;
    createUnfurlArrow(editor, dfId(`edge-${e.id}`), fromId, toId, "neutral");
  }
}
