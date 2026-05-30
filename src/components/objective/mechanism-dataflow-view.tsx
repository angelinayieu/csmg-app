"use client";

// ── Mechanism Data Flow View (L3 Tab A) ───────────────────────────
//
// Directed DAG over MechanismSpec.runtime_flow[], wired via the new
// produces / consumes token fields added in
// MECHANISM_EXPERIENCE_SPEC.md §2a. Finishes the L3 deliverable
// from MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md §6b.
//
// Scope decision: this view renders the STEP DAG only — input_data
// items (free-text descriptions) and user_visible_behavior already
// have dedicated textual surfaces in the drawer. The graph stays
// focused on the engineering spine. The right-most "User sees" node
// anchors the chain so it doesn't look truncated.
//
// Backward-compat: old stored specs predate produces / consumes. If
// none of the steps carry either array, we fall back to a sequential
// chain (step N → step N+1) and surface an "Auto-chained" badge so
// the user knows to regenerate for the real DAG.
//
// Visual: minimal chrome — no Controls, no MiniMap. Glass-card
// container; nodes carry the established glass + accent-glow
// vocabulary (mirrors RoomItemNode). Hover an edge to reveal its
// token. panOnScroll + zoomOnScroll=false so the drawer scrolls
// normally past the embedded view.

import { memo, useMemo, useState } from "react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  EdgeLabelRenderer,
  Handle,
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
import type { MechanismSpec } from "@/lib/objective-canvas/enrich-mechanism-spec";

// ── Layout config ─────────────────────────────────────────────────

const STEP_W = 196;
const STEP_H = 88;
const OUTCOME_W = 184;
const OUTCOME_H = 72;
const RANK_SEP = 76;
const NODE_SEP = 26;

// ── Node data shapes ──────────────────────────────────────────────

interface StepNodeData {
  index: number;
  step: string;
  component: string;
  user_sees: string;
  produces: string[];
  consumes: string[];
  hasVisualIntent: boolean;
}

interface OutcomeNodeData {
  text: string;
}

// ── Build the graph from MechanismSpec ────────────────────────────

interface BuildResult {
  nodes: Node[];
  edges: Edge[];
  isAutoChained: boolean;
}

function buildGraph(spec: MechanismSpec): BuildResult {
  const steps = spec.runtime_flow;
  const outcomeText = spec.user_visible_behavior?.trim() ?? "";

  // Detect whether the spec was generated under the v3 schema
  // (produces / consumes populated). If neither array is non-empty
  // anywhere, fall back to a sequential chain.
  const hasAnyStructured = steps.some(
    (s) =>
      (Array.isArray(s.produces) && s.produces.length > 0) ||
      (Array.isArray(s.consumes) && s.consumes.length > 0),
  );
  const isAutoChained = !hasAnyStructured && steps.length > 1;

  const nodes: Node[] = steps.map((s, i) => ({
    id: `step-${i}`,
    type: "step",
    data: {
      index: i + 1,
      step: s.step,
      component: s.component,
      user_sees: s.user_sees,
      produces: s.produces ?? [],
      consumes: s.consumes ?? [],
      hasVisualIntent: !!s.visual_intent,
    } satisfies StepNodeData,
    position: { x: 0, y: 0 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));

  if (outcomeText.length > 0) {
    nodes.push({
      id: "outcome",
      type: "outcome",
      data: { text: outcomeText } satisfies OutcomeNodeData,
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
  }

  const edges: Edge[] = [];

  if (isAutoChained) {
    // Sequential fallback: step N → step N+1.
    for (let i = 0; i < steps.length - 1; i++) {
      edges.push({
        id: `seq-${i}`,
        source: `step-${i}`,
        target: `step-${i + 1}`,
        type: "dataflow",
        data: { token: "" },
      });
    }
  } else {
    // Token-matched DAG: for each step's consumes[], find the
    // CLOSEST earlier producer of that token. Closest, not first —
    // mirrors how runtime values get re-bound: the last write wins.
    for (let i = 0; i < steps.length; i++) {
      const consumes = steps[i].consumes ?? [];
      const wiredFrom = new Set<number>();
      for (const token of consumes) {
        for (let j = i - 1; j >= 0; j--) {
          const produces = steps[j].produces ?? [];
          if (produces.includes(token)) {
            if (!wiredFrom.has(j)) {
              edges.push({
                id: `e-${j}-${i}-${token}`,
                source: `step-${j}`,
                target: `step-${i}`,
                type: "dataflow",
                data: { token },
              });
              wiredFrom.add(j);
            }
            break;
          }
        }
      }
    }
  }

  // Step → outcome edges: any step with user-visible behavior feeds
  // the sink. Fallback to the LAST step when no step is visible, so
  // the outcome node is never orphaned.
  if (outcomeText.length > 0 && steps.length > 0) {
    let wiredOutcome = false;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].user_sees && steps[i].user_sees !== "—") {
        edges.push({
          id: `outcome-${i}`,
          source: `step-${i}`,
          target: "outcome",
          type: "dataflow",
          data: { token: "" },
        });
        wiredOutcome = true;
      }
    }
    if (!wiredOutcome) {
      edges.push({
        id: "outcome-fallback",
        source: `step-${steps.length - 1}`,
        target: "outcome",
        type: "dataflow",
        data: { token: "" },
      });
    }
  }

  return { nodes, edges, isAutoChained };
}

// ── Dagre layout ──────────────────────────────────────────────────

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 16,
    marginy: 16,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const w = n.type === "outcome" ? OUTCOME_W : STEP_W;
    const h = n.type === "outcome" ? OUTCOME_H : STEP_H;
    g.setNode(n.id, { width: w, height: h });
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    if (!p) return n;
    const w = n.type === "outcome" ? OUTCOME_W : STEP_W;
    const h = n.type === "outcome" ? OUTCOME_H : STEP_H;
    return {
      ...n,
      position: { x: p.x - w / 2, y: p.y - h / 2 },
    };
  });
}

// ── Custom node: step ─────────────────────────────────────────────

function StepNodeInner({ data }: NodeProps) {
  const d = data as unknown as StepNodeData;
  const [hover, setHover] = useState(false);
  const accent = appleVibe.stage.features; // mechanism lane

  const restShadow = `0 1px 0 rgba(255,255,255,0.7) inset, 0 8px 24px -14px rgba(11,18,40,0.20), 0 0 0 1px rgba(10,132,255,0.05)`;
  const liftShadow = `0 1px 0 rgba(255,255,255,0.7) inset, 0 16px 38px -14px rgba(11,18,40,0.26), 0 0 22px -6px rgba(10,132,255,0.25)`;

  const userSeesTitle =
    d.user_sees && d.user_sees !== "—" ? `User sees: ${d.user_sees}` : undefined;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={userSeesTitle}
      style={{
        width: STEP_W,
        height: STEP_H,
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
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: appleVibe.stroke.hairline,
          width: 6,
          height: 6,
          border: "none",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: appleVibe.stroke.hairline,
          width: 6,
          height: 6,
          border: "none",
        }}
      />

      <div className="flex items-start gap-1.5">
        <span
          className="mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
          style={{ background: `${accent}1A`, color: accent }}
        >
          {d.index}
        </span>
        <span
          className="line-clamp-2 flex-1 text-[11.5px] font-semibold leading-tight"
          style={{ color: appleVibe.text.primary }}
        >
          {d.step}
        </span>
        {d.hasVisualIntent && (
          <span
            className="ml-0.5 mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: accent }}
            title="This step has a user-visible surface"
          />
        )}
      </div>
      <div
        className="mt-1 line-clamp-1 text-[10px] font-light"
        style={{ color: appleVibe.text.faint }}
      >
        ⚙ {d.component}
      </div>
      {(d.consumes.length > 0 || d.produces.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
          {d.consumes.slice(0, 2).map((t) => (
            <span
              key={`c-${t}`}
              className="rounded px-1 py-px"
              style={{
                background: "rgba(15,23,42,0.05)",
                color: appleVibe.text.tertiary,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
              title={`consumes ${t}`}
            >
              ↘ {t}
            </span>
          ))}
          {d.produces.slice(0, 2).map((t) => (
            <span
              key={`p-${t}`}
              className="rounded px-1 py-px"
              style={{
                background: `${accent}14`,
                color: accent,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
              title={`produces ${t}`}
            >
              ↗ {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
const StepNode = memo(StepNodeInner);

// ── Custom node: outcome sink ─────────────────────────────────────

function OutcomeNodeInner({ data }: NodeProps) {
  const d = data as unknown as OutcomeNodeData;
  const accent = appleVibe.stage.outcomes;
  return (
    <div
      style={{
        width: OUTCOME_W,
        height: OUTCOME_H,
        borderRadius: 12,
        background: `${accent}0F`,
        border: `1px solid ${accent}55`,
        boxShadow: `0 0 0 1px ${accent}1A, 0 8px 22px -12px ${accent}55`,
        padding: "8px 10px",
        overflow: "hidden",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: accent, width: 6, height: 6, border: "none" }}
      />
      <div
        className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: accent }}
      >
        User sees
      </div>
      <div
        className="line-clamp-2 text-[10.5px] font-light leading-tight"
        style={{ color: appleVibe.text.primary }}
      >
        {d.text}
      </div>
    </div>
  );
}
const OutcomeNode = memo(OutcomeNodeInner);

const NODE_TYPES: NodeTypes = {
  step: StepNode,
  outcome: OutcomeNode,
};

// ── Custom edge: dataflow (hover reveals token) ───────────────────

function DataflowEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  } = props;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  const token = (
    (data as { token?: string } | undefined)?.token ?? ""
  ).trim();
  const [hover, setHover] = useState(false);

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: hover
            ? "rgba(10,132,255,0.65)"
            : "rgba(15,23,42,0.18)",
          strokeWidth: hover ? 2 : 1.5,
          transition: "stroke 160ms ease, stroke-width 160ms ease",
        }}
        interactionWidth={20}
      />
      {/* invisible thick path → bigger hover hit-box without
          inflating the visible stroke */}
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
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
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
const EDGE_TYPES: EdgeTypes = {
  dataflow: DataflowEdge,
};

// ── Main component ────────────────────────────────────────────────

interface Props {
  spec: MechanismSpec | null | undefined;
}

export function MechanismDataflowView({ spec }: Props) {
  const result = useMemo(() => {
    if (!spec || !spec.runtime_flow || spec.runtime_flow.length === 0) {
      return null;
    }
    const built = buildGraph(spec);
    return {
      nodes: layoutNodes(built.nodes, built.edges),
      edges: built.edges,
      isAutoChained: built.isAutoChained,
    };
  }, [spec]);

  if (!spec) {
    return (
      <div
        className="rounded-xl px-3 py-4 text-center text-[11.5px] font-light italic"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          color: appleVibe.text.tertiary,
        }}
      >
        Generate the mechanism spec to see the runtime data flow.
      </div>
    );
  }

  if (!result || result.nodes.length === 0) {
    return (
      <div
        className="rounded-xl px-3 py-4 text-center text-[11.5px] font-light italic"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: `1px solid ${appleVibe.stroke.hairline}`,
          color: appleVibe.text.tertiary,
        }}
      >
        This spec has no runtime steps yet.
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        height: 360,
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
          fitViewOptions={{ padding: 0.15, maxZoom: 1.2, minZoom: 0.4 }}
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
      {result.isAutoChained && (
        <div
          className="absolute right-2 top-2 rounded-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
          style={{
            background: "rgba(217,119,6,0.15)",
            color: "rgba(120,53,15,0.95)",
            border: "1px solid rgba(217,119,6,0.3)",
          }}
          title="No structured produces/consumes tokens on this spec. Steps were chained sequentially. Regenerate the mechanism spec to wire the real DAG."
        >
          Auto-chained
        </div>
      )}
    </div>
  );
}
