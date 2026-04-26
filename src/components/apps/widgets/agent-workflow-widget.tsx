"use client";

// ── AgentWorkflowGraph widget — the "Experiment Digital Twin" ────────
//
// Renders an AgentWorkflow as a grid-laid-out DAG:
//   - Agent nodes are filled ovals with the accent gradient
//   - Data nodes are outlined rounded rects
//   - Criteria nodes are outlined hexagon-ish shapes
//   - Input / output nodes get a subtle distinct tint
//   - Edges are bent-corner SVG paths routed through grid cells
//   - Live status (running/done/failed/idle) animates the node outline
//
// No dagre/elkjs dependency. The workflow carries (row, col) hints on every
// node; the renderer resolves them into viewBox coordinates. This keeps the
// widget lightweight and the layout authoritative at the data layer — if an
// agent wants to propose a different layout via `apply_agent_patch`, it
// patches `row`/`col` in the manifest's workflow data, not via layout code.

import { motion } from "framer-motion";
import { useMemo } from "react";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type {
  AgentWorkflow,
  AgentWorkflowNode,
  AgentWorkflowEdge,
} from "@/types/agent-workflow";
import { workflowDimensions } from "@/types/agent-workflow";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";

const EASE = [0.22, 1, 0.36, 1] as const;

// ── Layout constants ──
const CELL_W = 160;   // viewBox units per column
const CELL_H = 90;    // viewBox units per row
const NODE_W = 124;
const NODE_H = 54;
const EDGE_CORNER_R = 10;
const PAD_X = 20;
const PAD_Y = 20;

// ── VP DigitalTwin signal palette ──
// Downward (command) flow: blue solid; upward (signal) flow: teal dashed.
// `evaluates` is the only edge kind that conceptually carries an upward
// signal (criteria → scored output returns up to the agent that consumes it);
// everything else flows downward. Edges whose target.row < source.row are
// also treated as upward regardless of kind.
const CMD_COLOR = "#0a5ad4";
const SIG_COLOR = "#65c9e0";

interface AgentWorkflowGraphConfig {
  /** Override the card title — default "Experiment Digital Twin". */
  title?: string;
  /** Show the edge labels on hover only (default), always, or never. */
  edge_label_mode?: "hover" | "always" | "never";
  /** Max rows shown before the widget scrolls vertically. Default unlimited. */
  max_visible_rows?: number;
  /** Turn off pulse particles (accessibility / perf). Default true. */
  pulse?: boolean;
}

export function AgentWorkflowGraph({
  instance,
  context,
}: WidgetComponentProps<AgentWorkflowGraphConfig>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<AgentWorkflow>(instance.bindings?.workflow);
  const workflow = res.value ?? null;

  const layout = useMemo(() => {
    if (!workflow) return null;
    return layoutWorkflow(workflow);
  }, [workflow]);

  if (!workflow || !layout) {
    return (
      <Surface accent="rgb(var(--accent-rgb))">
        <WidgetTitle
          eyebrow="Experiment"
          title={cfg.title ?? "Experiment Digital Twin"}
          subtitle="Agent orchestration graph"
        />
        <WidgetEmpty>
          No agent workflow defined for this space yet. A default pipeline
          will appear once synthesis has run.
        </WidgetEmpty>
      </Surface>
    );
  }

  return (
    <Surface accent="rgb(var(--accent-rgb))">
      <WidgetTitle
        eyebrow="Experiment"
        title={cfg.title ?? workflow.name}
        subtitle={workflow.description ?? "Agent orchestration graph"}
      />

      <div
        className="relative mt-3 overflow-x-auto overflow-y-hidden rounded-xl bg-gradient-to-br from-white/40 via-white/20 to-transparent px-1 py-2"
        style={{
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <svg
          width="100%"
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMin meet"
          style={{ minWidth: layout.width }}
        >
          <defs>
            <linearGradient id="agent-node-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.95" />
              <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.75" />
            </linearGradient>
            {/* Arrow head — command (blue, downward) */}
            <marker
              id="agent-arrow-cmd"
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="5.5"
              markerHeight="5.5"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill={CMD_COLOR} />
            </marker>
            {/* Arrow head — signal (teal, upward) */}
            <marker
              id="agent-arrow-sig"
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="5.5"
              markerHeight="5.5"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill={SIG_COLOR} />
            </marker>
          </defs>

          {/* Edges first so nodes sit on top */}
          {layout.edges.map((edgeLayout, idx) => (
            <EdgePath
              key={edgeLayout.edge.id}
              layout={edgeLayout}
              edgeLabelMode={cfg.edge_label_mode ?? "hover"}
              delay={idx * 0.04}
              pulse={cfg.pulse !== false}
            />
          ))}

          {/* Nodes */}
          {layout.nodes.map((nodeLayout, idx) => (
            <NodeShape
              key={nodeLayout.node.id}
              layout={nodeLayout}
              delay={0.15 + idx * 0.05}
            />
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10.5px] text-[color:var(--muted-fg,#86868b)]">
        <LegendSwatch kind="agent" label="Agent" />
        <LegendSwatch kind="data" label="Artifact" />
        <LegendSwatch kind="criteria" label="Criterion" />
        <LegendSwatch kind="output" label="Output" />
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden>
            <line x1="1" y1="3" x2="21" y2="3" stroke={CMD_COLOR} strokeWidth={1.4} />
          </svg>
          command
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden>
            <line
              x1="1"
              y1="3"
              x2="21"
              y2="3"
              stroke={SIG_COLOR}
              strokeWidth={1.4}
              strokeDasharray="4 2.5"
            />
          </svg>
          signal
        </span>
        <span className="italic opacity-70">top-down command · bottom-up signal</span>
        <div className="ml-auto flex items-center gap-2">
          <StatusDot status="running" />
          <span>Running</span>
          <StatusDot status="done" />
          <span>Done</span>
          <StatusDot status="failed" />
          <span>Failed</span>
        </div>
      </div>
    </Surface>
  );
}

// ── Layout engine ────────────────────────────────────────────────────

interface NodeLayout {
  node: AgentWorkflowNode;
  x: number;
  y: number;
  cx: number; // center
  cy: number;
  w: number;
  h: number;
}

interface EdgeLayout {
  edge: AgentWorkflowEdge;
  d: string;           // SVG path d attribute
  labelX: number;
  labelY: number;
  /** True if this edge carries a bottom-up signal (teal dashed). */
  upward: boolean;
}

interface LayoutResult {
  width: number;
  height: number;
  nodes: NodeLayout[];
  edges: EdgeLayout[];
}

function layoutWorkflow(workflow: AgentWorkflow): LayoutResult {
  const { rows, cols } = workflowDimensions(workflow);
  const width = PAD_X * 2 + cols * CELL_W;
  const height = PAD_Y * 2 + rows * CELL_H;

  const nodeLayouts: NodeLayout[] = workflow.nodes.map((node) => {
    const cx = PAD_X + (node.col - 0.5) * CELL_W;
    const cy = PAD_Y + (node.row - 0.5) * CELL_H;
    return {
      node,
      cx,
      cy,
      x: cx - NODE_W / 2,
      y: cy - NODE_H / 2,
      w: NODE_W,
      h: NODE_H,
    };
  });

  const nodeById = new Map<string, NodeLayout>();
  for (const n of nodeLayouts) nodeById.set(n.node.id, n);

  const edgeLayouts: EdgeLayout[] = [];
  for (const edge of workflow.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    edgeLayouts.push(buildEdgeLayout(edge, from, to));
  }

  return { width, height, nodes: nodeLayouts, edges: edgeLayouts };
}

function buildEdgeLayout(
  edge: AgentWorkflowEdge,
  from: NodeLayout,
  to: NodeLayout
): EdgeLayout {
  // An edge is "upward" (bottom-up signal) when either:
  //   - its kind is `evaluates` (criteria returning a score), or
  //   - it routes against the grid flow (target row < source row).
  const upward = edge.kind === "evaluates" || to.node.row < from.node.row;

  const dx = to.cx - from.cx;

  // Downward edges anchor bottom→top; upward edges anchor top→bottom so the
  // arrowhead reads correctly when flowing against the grid.
  const startX = from.cx;
  const startY = upward ? from.y : from.y + from.h;
  const endX = to.cx;
  const endY = upward ? to.y + to.h : to.y;

  const labelX = (startX + endX) / 2;
  const labelY = (startY + endY) / 2;

  let d: string;
  if (Math.abs(dx) < 1) {
    // Straight vertical
    d = `M ${startX} ${startY} L ${endX} ${endY}`;
  } else {
    // Bent-corner: vertical descent to midY, horizontal run, vertical to endY.
    const midY = (startY + endY) / 2;
    const dir = dx > 0 ? 1 : -1;
    const rx = Math.min(EDGE_CORNER_R, Math.abs(dx) / 2);
    const toSign = endY > startY ? 1 : -1;
    d = [
      `M ${startX} ${startY}`,
      `L ${startX} ${midY - toSign * rx}`,
      `Q ${startX} ${midY} ${startX + dir * rx} ${midY}`,
      `L ${endX - dir * rx} ${midY}`,
      `Q ${endX} ${midY} ${endX} ${midY + toSign * rx}`,
      `L ${endX} ${endY}`,
    ].join(" ");
  }

  return { edge, d, labelX, labelY, upward };
}

// ── Node component ──────────────────────────────────────────────────

function NodeShape({
  layout,
  delay,
}: {
  layout: NodeLayout;
  delay: number;
}) {
  const { node, x, y, w, h, cx } = layout;
  const statusStyle = statusStrokeStyle(node.status);

  // Primary-artifact highlight: a running data/artifact node is the active
  // iteration (e.g. "Prompt Design v4.2 — running"). Borrow VP's primary
  // styling (blue frame + pale blue wash) so users can find the current
  // artifact at a glance — even when the graph is busy.
  const isPrimaryArtifact =
    (node.kind === "data" || node.kind === "output") && node.status === "running";

  // Per-kind visual treatment
  const fillStyle = isPrimaryArtifact ? "rgba(26,122,255,0.10)" : fillForKind(node.kind);
  const strokeStyle = isPrimaryArtifact ? CMD_COLOR : strokeForKind(node.kind);
  const labelColor = isPrimaryArtifact ? "#0a4a99" : labelColorForKind(node.kind);

  // Pill-y rects. Data/criteria nodes get slightly taller font + left accent bar.
  return (
    <motion.g
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay }}
    >
      {/* Soft glow when running */}
      {node.status === "running" ? (
        <motion.rect
          x={x - 2}
          y={y - 2}
          width={w + 4}
          height={h + 4}
          rx={h / 2 + 2}
          fill="rgb(var(--accent-rgb))"
          opacity={0.18}
          animate={{ opacity: [0.12, 0.32, 0.12] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}

      {/* Main shape */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={node.kind === "agent" ? h / 2 : 10}
        fill={fillStyle}
        stroke={isPrimaryArtifact ? strokeStyle : (statusStyle?.stroke ?? strokeStyle)}
        strokeWidth={isPrimaryArtifact ? 1.8 : (statusStyle?.width ?? 1)}
        strokeDasharray={isPrimaryArtifact ? undefined : statusStyle?.dasharray}
      />

      {/* Status dot on top-right corner */}
      {node.status && node.status !== "idle" ? (
        <StatusCorner cx={x + w - 8} cy={y + 8} status={node.status} />
      ) : null}

      {/* Label */}
      <text
        x={cx}
        y={node.sublabel ? y + h / 2 - 3 : y + h / 2 + 4}
        textAnchor="middle"
        className="pointer-events-none select-none"
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          fill: labelColor,
          fontFamily: "inherit",
        }}
      >
        {node.label}
      </text>
      {node.sublabel ? (
        <text
          x={cx}
          y={y + h / 2 + 12}
          textAnchor="middle"
          className="pointer-events-none select-none"
          style={{
            fontSize: 9.5,
            fontWeight: 400,
            fill: labelColor,
            opacity: 0.75,
            fontFamily: "inherit",
          }}
        >
          {node.sublabel}
        </text>
      ) : null}
    </motion.g>
  );
}

function StatusCorner({
  cx,
  cy,
  status,
}: {
  cx: number;
  cy: number;
  status: AgentWorkflowNode["status"];
}) {
  const color = statusColor(status);
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill="#fff" />
      <circle cx={cx} cy={cy} r={2.5} fill={color} />
      {status === "running" ? (
        <motion.circle
          cx={cx}
          cy={cy}
          r={2.5}
          fill={color}
          animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        />
      ) : null}
    </g>
  );
}

// ── Edge component ──────────────────────────────────────────────────

function EdgePath({
  layout,
  edgeLabelMode,
  delay,
  pulse,
}: {
  layout: EdgeLayout;
  edgeLabelMode: "hover" | "always" | "never";
  delay: number;
  pulse: boolean;
}) {
  const label = layout.edge.label;
  const up = layout.upward;
  const stroke = up ? "rgba(101,201,224,0.78)" : "rgba(10,90,212,0.62)";
  const dash = up ? "4 2.5" : undefined;
  const marker = up ? "url(#agent-arrow-sig)" : "url(#agent-arrow-cmd)";

  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE, delay }}
    >
      <motion.path
        d={layout.d}
        stroke={stroke}
        strokeWidth={1.4}
        fill="none"
        strokeDasharray={dash}
        markerEnd={marker}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease: EASE, delay: delay + 0.1 }}
      />

      {/* Pulse particle — rides the full edge. Downward edges get a command
          packet (blue); upward edges get a signal packet (teal). Staggered
          per-edge so the whole graph looks alive. */}
      {pulse ? (
        <circle
          r={2.2}
          fill={up ? SIG_COLOR : CMD_COLOR}
          opacity={0.9}
          style={{
            filter: `drop-shadow(0 0 3px ${up ? SIG_COLOR : CMD_COLOR}cc)`,
          }}
        >
          <animateMotion
            dur={up ? "3.4s" : "2.6s"}
            repeatCount="indefinite"
            begin={`${(delay * 1.5).toFixed(2)}s`}
            path={layout.d}
            keyPoints="0;1"
            keyTimes="0;1"
          />
        </circle>
      ) : null}

      {label && edgeLabelMode !== "never" ? (
        <g className={edgeLabelMode === "hover" ? "opacity-0 group-hover:opacity-100" : ""}>
          <rect
            x={layout.labelX - label.length * 3.1}
            y={layout.labelY - 7}
            width={label.length * 6.2}
            height={14}
            rx={4}
            fill="rgba(255,255,255,0.9)"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth={0.5}
          />
          <text
            x={layout.labelX}
            y={layout.labelY + 3}
            textAnchor="middle"
            style={{
              fontSize: 9,
              fontWeight: 500,
              fill: "#48484a",
              fontFamily: "inherit",
            }}
          >
            {label}
          </text>
        </g>
      ) : null}
    </motion.g>
  );
}

// ── Style helpers ───────────────────────────────────────────────────

function fillForKind(kind: AgentWorkflowNode["kind"]): string {
  switch (kind) {
    case "agent": return "url(#agent-node-grad)";
    case "data": return "rgba(255,255,255,0.92)";
    case "criteria": return "rgba(175,82,222,0.10)";
    case "input": return "rgba(0,0,0,0.04)";
    case "output": return "rgba(48,209,88,0.14)";
  }
}

function strokeForKind(kind: AgentWorkflowNode["kind"]): string {
  switch (kind) {
    case "agent": return "rgba(255,255,255,0.55)";
    case "data": return "rgba(0,0,0,0.12)";
    case "criteria": return "rgba(175,82,222,0.45)";
    case "input": return "rgba(0,0,0,0.22)";
    case "output": return "rgba(48,209,88,0.5)";
  }
}

function labelColorForKind(kind: AgentWorkflowNode["kind"]): string {
  if (kind === "agent") return "#fff";
  if (kind === "criteria") return "#6a28a3";
  if (kind === "output") return "#1d7a3a";
  return "#1d1d1f";
}

function statusColor(status: AgentWorkflowNode["status"]): string {
  if (status === "running") return "#30D158";
  if (status === "done") return "#0A84FF";
  if (status === "failed") return "#FF453A";
  return "#86868B";
}

function statusStrokeStyle(
  status: AgentWorkflowNode["status"]
): { stroke: string; width: number; dasharray?: string } | null {
  if (!status || status === "idle") return null;
  if (status === "running") {
    return { stroke: "#30D158", width: 2 };
  }
  if (status === "done") {
    return { stroke: "#0A84FF", width: 1.5 };
  }
  if (status === "failed") {
    return { stroke: "#FF453A", width: 2, dasharray: "3 2" };
  }
  return null;
}

// ── Legend ──────────────────────────────────────────────────────────

function LegendSwatch({
  kind,
  label,
}: {
  kind: AgentWorkflowNode["kind"];
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
        <rect
          x={0.5}
          y={0.5}
          width={21}
          height={9}
          rx={kind === "agent" ? 4.5 : 2}
          fill={fillForKind(kind)}
          stroke={strokeForKind(kind)}
          strokeWidth={0.5}
        />
      </svg>
      {label}
    </span>
  );
}

function StatusDot({ status }: { status: AgentWorkflowNode["status"] }) {
  const color = statusColor(status);
  return (
    <span
      className="inline-block h-[7px] w-[7px] rounded-full"
      style={{ background: color, boxShadow: `0 0 4px ${color}80` }}
    />
  );
}
