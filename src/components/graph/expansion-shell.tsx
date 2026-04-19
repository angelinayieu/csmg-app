"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import { Network, ListTree } from "lucide-react";
import { cn } from "@/lib/utils";
import { PathwaysTable } from "@/components/entity/pathways-table";
import type {
  Expansion,
  ExpansionBreadcrumb,
  DepthBudget,
  SubComponent,
  InternalPathway,
  InternalDynamic,
} from "@/types/expansion";

/* ─── Props ──────────────────────────────────────────────────────── */

interface ExpansionShellProps {
  expansion: Expansion;
  breadcrumbs: ExpansionBreadcrumb[];
  budget: DepthBudget;
  loading: boolean;
  error: string | null;
  onDrillInto: (subComponent: SubComponent) => void;
  onGoBack: () => void;
  onGoToLevel: (index: number) => void;
  onClose: () => void;
}

/* ─── Constants ──────────────────────────────────────────────────── */

const NODE_W = 160;
const NODE_H = 65;

const TYPE_COLORS: Record<string, string> = {
  milestone: "#3b82f6",
  capability: "#22c55e",
  condition: "#f59e0b",
  metric: "#a855f7",
  process: "#14b8a6",
  variable: "#6b7280",
  gate: "#ef4444",
};

const DYNAMIC_COLORS: Record<InternalDynamic["type"], string> = {
  bottleneck: "#ef4444",
  feedback_loop: "#a855f7",
  gate: "#f59e0b",
  amplifier: "#22c55e",
  decay: "#6b7280",
};

const DYNAMIC_LABELS: Record<InternalDynamic["type"], string> = {
  bottleneck: "Bottleneck",
  feedback_loop: "Feedback Loop",
  gate: "Gate",
  amplifier: "Amplifier",
  decay: "Decay",
};

const IMPORTANCE_BORDER: Record<string, number> = {
  critical: 3,
  important: 2,
  moderate: 1,
  minor: 1,
};

/* ─── Helpers ────────────────────────────────────────────────────── */

function probColor(p: number): string {
  if (p > 0.7) return "#22c55e";
  if (p >= 0.4) return "#f59e0b";
  return "#ef4444";
}

function manifoldPill(label: string, value: string | undefined) {
  if (!value) return null;
  const short =
    value === "direct"
      ? "Dir"
      : value === "indirect"
        ? "Ind"
        : value === "uncontrollable"
          ? "Unc"
          : value === "observable"
            ? "Obs"
            : value === "latent"
              ? "Lat"
              : value === "hidden"
                ? "Hid"
                : value === "stable"
                  ? "Stb"
                  : value === "fluctuating"
                    ? "Flu"
                    : value === "chaotic"
                      ? "Cha"
                      : value.slice(0, 3);
  return (
    <span
      key={label}
      className="inline-block rounded px-1 text-[8px] leading-[14px] font-medium bg-gray-100 text-gray-500 border border-gray-200"
      title={`${label}: ${value}`}
    >
      {short}
    </span>
  );
}

/** Build a smooth SVG path through dagre edge points. */
function buildEdgePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  const [start, ...rest] = points;
  let d = `M ${start.x} ${start.y}`;
  if (rest.length === 1) {
    d += ` L ${rest[0].x} ${rest[0].y}`;
  } else {
    for (let i = 0; i < rest.length - 1; i++) {
      const cp = rest[i];
      const end = rest[i + 1];
      const midX = (cp.x + end.x) / 2;
      const midY = (cp.y + end.y) / 2;
      d += ` Q ${cp.x} ${cp.y} ${midX} ${midY}`;
    }
    const last = rest[rest.length - 1];
    d += ` L ${last.x} ${last.y}`;
  }
  return d;
}

/* ─── Layout computation ─────────────────────────────────────────── */

interface LayoutResult {
  nodes: Map<string, { x: number; y: number; width: number; height: number }>;
  edges: { key: string; points: { x: number; y: number }[] }[];
  width: number;
  height: number;
}

function computeLayout(expansion: Expansion): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    ranksep: 80,
    nodesep: 50,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const sc of expansion.sub_components) {
    g.setNode(sc.id, { width: NODE_W, height: NODE_H });
  }

  for (const pw of expansion.internal_pathways) {
    g.setEdge(pw.source_id, pw.target_id);
  }

  dagre.layout(g);

  const nodes = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const id of g.nodes()) {
    const n = g.node(id);
    if (n) nodes.set(id, { x: n.x, y: n.y, width: n.width, height: n.height });
  }

  const edges: LayoutResult["edges"] = [];
  for (const e of g.edges()) {
    const edge = g.edge(e);
    if (edge?.points) {
      edges.push({ key: `${e.v}->${e.w}`, points: edge.points });
    }
  }

  const graphLabel = g.graph();
  const width = graphLabel?.width ?? 400;
  const height = graphLabel?.height ?? 300;

  return { nodes, edges, width, height };
}

/* ─── Sub-Component Node ─────────────────────────────────────────── */

function SubComponentNode({
  sc,
  x,
  y,
  onDrillInto,
}: {
  sc: SubComponent;
  x: number;
  y: number;
  onDrillInto: (sc: SubComponent) => void;
}) {
  const borderColor = TYPE_COLORS[sc.component_type] ?? "#6b7280";
  const leftBorder = IMPORTANCE_BORDER[sc.importance] ?? 1;
  const pColor = probColor(sc.probability);
  const pct = Math.round(sc.probability * 100);
  const ringR = 10;

  return (
    <foreignObject
      x={x - NODE_W / 2}
      y={y - NODE_H / 2}
      width={NODE_W}
      height={NODE_H}
    >
      <div
        className="h-full w-full rounded-lg bg-white border overflow-hidden flex flex-col justify-between relative select-none"
        style={{
          borderColor,
          borderWidth: `1px 1px 1px ${leftBorder}px`,
          borderStyle: "solid",
        }}
      >
        {/* Header row */}
        <div className="flex items-start gap-1 px-2 pt-1.5 min-w-0">
          <span
            className="text-[11px] font-bold text-gray-900 truncate flex-1 leading-tight"
            title={sc.name}
          >
            {sc.name}
          </span>
          {sc.is_expandable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDrillInto(sc);
              }}
              className="text-[10px] text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0 leading-none mt-px"
              title="Expand sub-component"
            >
              ⊕
            </button>
          )}
        </div>

        {/* Type badge + manifold pills */}
        <div className="flex items-center gap-1 px-2 flex-wrap">
          <span
            className="inline-block rounded-full px-1.5 text-[8px] leading-[14px] font-semibold text-white"
            style={{ backgroundColor: borderColor }}
          >
            {sc.component_type}
          </span>
          {sc.manifold && (
            <>
              {manifoldPill("Controllability", sc.manifold.controllability)}
              {manifoldPill("Visibility", sc.manifold.visibility)}
              {manifoldPill("Volatility", sc.manifold.volatility)}
            </>
          )}
        </div>

        {/* Probability ring — bottom-right */}
        <svg
          width={ringR * 2 + 4}
          height={ringR * 2 + 4}
          className="absolute bottom-0.5 right-1"
        >
          <circle
            cx={ringR + 2}
            cy={ringR + 2}
            r={ringR}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={2}
          />
          <circle
            cx={ringR + 2}
            cy={ringR + 2}
            r={ringR}
            fill="none"
            stroke={pColor}
            strokeWidth={2}
            strokeDasharray={`${sc.probability * 2 * Math.PI * ringR} ${(1 - sc.probability) * 2 * Math.PI * ringR}`}
            strokeDashoffset={Math.PI * ringR / 2}
            strokeLinecap="round"
          />
          <text
            x={ringR + 2}
            y={ringR + 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={pColor}
            fontSize={7}
            fontWeight={700}
          >
            {pct}%
          </text>
        </svg>

        {/* Bottom spacer so content doesn't overlap ring */}
        <div className="h-2" />
      </div>
    </foreignObject>
  );
}

/* ─── Edge with tooltip ──────────────────────────────────────────── */

function PathwayEdge({
  pw,
  points,
}: {
  pw: InternalPathway;
  points: { x: number; y: number }[];
}) {
  const [hovered, setHovered] = useState(false);
  const pathD = buildEdgePath(points);
  const opacity = 0.3 + pw.probability * 0.7;
  const width = 0.3 + pw.strength * 2.2;
  const isDashed =
    pw.dynamics === "conditional" || pw.dynamics === "probabilistic";

  // Tooltip position: midpoint of the path
  const mid = points[Math.floor(points.length / 2)];

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Invisible wider hit area */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        className="cursor-pointer"
      />
      <path
        d={pathD}
        fill="none"
        stroke="#6b7280"
        strokeWidth={width}
        strokeOpacity={opacity}
        strokeDasharray={isDashed ? "5 3" : undefined}
        markerEnd="url(#arrowhead)"
      />
      {hovered && mid && (
        <foreignObject
          x={mid.x - 100}
          y={mid.y - 50}
          width={200}
          height={100}
          className="pointer-events-none"
        >
          <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-[10px] text-gray-700 space-y-0.5">
            <p className="font-semibold text-gray-900">{pw.mechanism}</p>
            {pw.conditions && (
              <p className="text-gray-500">
                <span className="font-medium">When:</span> {pw.conditions}
              </p>
            )}
            {pw.failure_mode && (
              <p className="text-red-600">
                <span className="font-medium">Failure:</span> {pw.failure_mode}
              </p>
            )}
            <p className="text-gray-400">
              {pw.dynamics} · strength {Math.round(pw.strength * 100)}% · prob{" "}
              {Math.round(pw.probability * 100)}%
            </p>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

/* ─── Dynamics Card ──────────────────────────────────────────────── */

function DynamicCard({
  dynamic,
  componentNames,
}: {
  dynamic: InternalDynamic;
  componentNames: Map<string, string>;
}) {
  const color = DYNAMIC_COLORS[dynamic.type];
  const label = DYNAMIC_LABELS[dynamic.type];

  return (
    <div
      className="rounded-lg border p-3 text-sm"
      style={{ borderColor: color, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {label}
        </span>
        <span className="text-[10px] text-gray-400">
          {dynamic.component_ids
            .map((id) => componentNames.get(id) ?? id)
            .join(", ")}
        </span>
      </div>
      <p className="text-gray-700 text-xs leading-relaxed">
        {dynamic.description}
      </p>
      <p className="text-gray-500 text-[11px] mt-1">
        <span className="font-medium text-gray-600">Impact:</span>{" "}
        {dynamic.impact}
      </p>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────── */

export function ExpansionShell({
  expansion,
  breadcrumbs,
  budget,
  loading,
  error,
  onDrillInto,
  onGoBack,
  onGoToLevel,
  onClose,
}: ExpansionShellProps) {
  const [dynamicsOpen, setDynamicsOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"graph" | "pathways">("graph");
  const graphRef = useRef<HTMLDivElement>(null);

  /* Layout */
  const layout = useMemo(() => computeLayout(expansion), [expansion]);

  /* Name lookup for dynamics cards */
  const componentNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const sc of expansion.sub_components) {
      m.set(sc.id, sc.name);
    }
    return m;
  }, [expansion.sub_components]);

  /* Pathway lookup by edge key */
  const pathwayMap = useMemo(() => {
    const m = new Map<string, InternalPathway>();
    for (const pw of expansion.internal_pathways) {
      m.set(`${pw.source_id}->${pw.target_id}`, pw);
    }
    return m;
  }, [expansion.internal_pathways]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const svgPadding = 40;
  const svgW = layout.width + svgPadding * 2;
  const svgH = layout.height + svgPadding * 2;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        {/* ── Top Bar ────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-2.5 flex items-center gap-3">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-hidden">
            <button
              onClick={() => onGoToLevel(0)}
              className="text-gray-400 hover:text-indigo-600 transition-colors shrink-0 font-medium"
            >
              Graph
            </button>
            {breadcrumbs.map((bc, idx) => (
              <span key={bc.entity_id + idx} className="flex items-center gap-1 min-w-0">
                <span className="text-gray-300 shrink-0">/</span>
                <button
                  onClick={() => onGoToLevel(idx + 1)}
                  className={`truncate transition-colors ${
                    idx === breadcrumbs.length - 1
                      ? "text-gray-900 font-semibold"
                      : "text-gray-500 hover:text-indigo-600"
                  }`}
                  title={bc.entity_name}
                >
                  {bc.entity_name}
                </button>
              </span>
            ))}
          </nav>

          {/* Depth budget */}
          <div className="text-[11px] text-gray-400 whitespace-nowrap shrink-0">
            Depth {budget.current_depth}/{budget.max_depth} ·{" "}
            {budget.max_expansions - budget.expansions_used} expansions remaining
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="ml-1 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Close expansion"
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* ── Error banner ───────────────────────────────────────── */}
        {error && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 flex items-center gap-2">
            <svg
              width={14}
              height={14}
              viewBox="0 0 16 16"
              fill="currentColor"
              className="shrink-0"
            >
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0V5zm.75 6.25a.75.75 0 100-1.5.75.75 0 000 1.5z" />
            </svg>
            {error}
          </div>
        )}

        {/* ── Summary banner ─────────────────────────────────────── */}
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2 text-sm text-indigo-800">
          {expansion.summary}
        </div>

        {/* ── View-mode toggle (graph vs pathways) ──────────────── */}
        <div className="border-b border-gray-100 bg-white px-4 py-1.5 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">View</span>
          <div className="inline-flex rounded-md border border-gray-200 p-0.5 text-[11px] font-semibold">
            <button
              onClick={() => setViewMode("graph")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 transition-all",
                viewMode === "graph"
                  ? "bg-interaxis-100 text-interaxis-700"
                  : "text-gray-500 hover:text-gray-800",
              )}
            >
              <Network className="h-3 w-3" />
              Graph
            </button>
            <button
              onClick={() => setViewMode("pathways")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 transition-all",
                viewMode === "pathways"
                  ? "bg-interaxis-100 text-interaxis-700"
                  : "text-gray-500 hover:text-gray-800",
              )}
            >
              <ListTree className="h-3 w-3" />
              Pathways
            </button>
          </div>
          {viewMode === "pathways" && (
            <span className="text-[11px] text-gray-500">
              Every source→sink route, counterfactually adjustable
            </span>
          )}
        </div>

        {/* ── Pathways view (if selected) ───────────────────────── */}
        {viewMode === "pathways" && (
          <div className="flex-1 overflow-auto px-4 py-3">
            <PathwaysTable
              sub_components={expansion.sub_components}
              internal_pathways={expansion.internal_pathways}
              internal_dynamics={expansion.internal_dynamics}
            />
          </div>
        )}

        {/* ── Graph area ─────────────────────────────────────────── */}
        <div
          ref={graphRef}
          style={{ display: viewMode === "graph" ? undefined : "none" }}
          className="flex-1 overflow-auto relative min-h-[250px]"
        >
          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 z-20 bg-white/70 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <svg
                  className="animate-spin h-7 w-7 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx={12}
                    cy={12}
                    r={10}
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeDasharray="50 20"
                  />
                </svg>
                <span className="text-sm text-gray-500">
                  Expanding internal structure...
                </span>
              </div>
            </div>
          )}

          {expansion.sub_components.length === 0 && !loading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm py-16">
              No sub-components found for this entity.
            </div>
          ) : (
            <div className="flex items-center justify-center p-4">
              <svg
                width={svgW}
                height={svgH}
                viewBox={`0 0 ${svgW} ${svgH}`}
                className="select-none"
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth={8}
                    markerHeight={6}
                    refX={8}
                    refY={3}
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <polygon
                      points="0 0, 8 3, 0 6"
                      fill="#6b7280"
                      fillOpacity={0.6}
                    />
                  </marker>
                </defs>

                <g transform={`translate(${svgPadding}, ${svgPadding})`}>
                  {/* Edges */}
                  {layout.edges.map((edge) => {
                    const pw = pathwayMap.get(edge.key);
                    if (!pw) return null;
                    return (
                      <PathwayEdge key={edge.key} pw={pw} points={edge.points} />
                    );
                  })}

                  {/* Nodes */}
                  {expansion.sub_components.map((sc) => {
                    const pos = layout.nodes.get(sc.id);
                    if (!pos) return null;
                    return (
                      <SubComponentNode
                        key={sc.id}
                        sc={sc}
                        x={pos.x}
                        y={pos.y}
                        onDrillInto={onDrillInto}
                      />
                    );
                  })}
                </g>
              </svg>
            </div>
          )}
        </div>

        {/* ── Internal Dynamics panel ────────────────────────────── */}
        {expansion.internal_dynamics.length > 0 && (
          <div className="border-t border-gray-200">
            <button
              onClick={() => setDynamicsOpen((v) => !v)}
              className="w-full px-4 py-2 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span>
                Internal Dynamics ({expansion.internal_dynamics.length})
              </span>
              <svg
                width={14}
                height={14}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                className={`transition-transform ${dynamicsOpen ? "rotate-180" : ""}`}
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>

            {dynamicsOpen && (
              <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[200px] overflow-auto">
                {expansion.internal_dynamics.map((dyn, idx) => (
                  <DynamicCard
                    key={idx}
                    dynamic={dyn}
                    componentNames={componentNames}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
