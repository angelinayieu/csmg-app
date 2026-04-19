"use client";

import type { FlowchartVM, FlowNode, FlowEdge } from "../strategy-view-model";

interface VariantFlowchartProps {
  fc: FlowchartVM;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}

const COLUMNS = ["driver", "rule", "action", "outcome", "proxy"] as const;

const COLUMN_COLORS = {
  driver: { bg: "#FAF5FF", stroke: "#9333EA", sub: "#6B21A8" },
  rule: { bg: "var(--accent-50, #EEF2FF)", stroke: "var(--accent-600)", sub: "var(--accent-700)" },
  action: { bg: "#FFFBEB", stroke: "#D97706", sub: "#92400E" },
  outcome: { bg: "#ECFDF5", stroke: "#059669", sub: "#065F46" },
  proxy: { bg: "#F7F8FA", stroke: "#6B7280", sub: "#0B0D12" },
} as const;

const COL_LABELS = {
  driver: "DRIVERS",
  rule: "RULES",
  action: "ACTIONS",
  outcome: "OUTCOMES",
  proxy: "PROXIES",
} as const;

export function VariantFlowchart({ fc, selectedNodeId, onSelect }: VariantFlowchartProps) {
  // Column layout — 5 columns across 1260 units wide, 380 tall
  const W = 1260;
  const H = 380;
  const colXs: Record<string, number> = {
    driver: 95,
    rule: 332,
    action: 612,
    outcome: 900,
    proxy: 1155,
  };
  const nodeWidth = { driver: 95, rule: 195, action: 195, outcome: 200, proxy: 150 } as const;

  const columnNodes: Record<string, FlowNode[]> = {
    driver: fc.drivers,
    rule: fc.rules,
    action: fc.actions,
    outcome: fc.outcomes,
    proxy: fc.proxies,
  };

  // Assign y per node evenly within vertical padding
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const col of COLUMNS) {
    const nodes = columnNodes[col];
    const h = col === "proxy" ? 30 : 40;
    const totalHeight = H - 40;
    const n = Math.max(1, nodes.length);
    const spacing = totalHeight / (n + 1);
    nodes.forEach((node, i) => {
      const y = 40 + spacing * (i + 1) - h / 2;
      positions.set(node.id, {
        x: colXs[col] - nodeWidth[col] / 2,
        y,
        w: nodeWidth[col],
        h,
      });
    });
  }

  return (
    <div
      className="relative overflow-hidden rounded-[10px] p-4"
      style={{
        background: "#fff",
        border: "1px solid rgba(11,13,18,0.08)",
      }}
    >
      {/* Grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(11,13,18,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(11,13,18,0.025) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          pointerEvents: "none",
        }}
      />

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full relative z-[1]"
        style={{ height: 380 }}
      >
        <defs>
          <marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#94A3B8" />
          </marker>
          <marker id="fc-arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#10B981" />
          </marker>
        </defs>

        {/* Column headers */}
        {COLUMNS.map((col) => (
          <text
            key={col}
            x={colXs[col]}
            y={22}
            textAnchor="middle"
            fontSize="9"
            fontWeight={700}
            fill="rgba(11,13,18,0.42)"
            letterSpacing="0.14em"
          >
            {COL_LABELS[col]}
          </text>
        ))}

        {/* Edges */}
        {fc.edges.map((edge, i) => renderEdge(edge, positions, i))}

        {/* Nodes */}
        {COLUMNS.flatMap((col) =>
          columnNodes[col].map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const c = COLUMN_COLORS[col];
            const selected = selectedNodeId === node.id;
            return (
              <g
                key={node.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(node.id);
                }}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={pos.w}
                  height={pos.h}
                  rx={6}
                  fill={c.bg}
                  stroke={c.stroke}
                  strokeWidth={selected ? 2 : 1}
                  style={
                    selected
                      ? { filter: "drop-shadow(0 0 0 2px rgba(var(--accent-rgb), 0.25))" }
                      : undefined
                  }
                />
                <text
                  x={pos.x + pos.w / 2}
                  y={pos.y + (col === "proxy" ? 14 : 17)}
                  textAnchor="middle"
                  fontSize={col === "proxy" ? 9.5 : 11}
                  fontWeight={700}
                  fill="#0B0D12"
                >
                  {truncate(node.title, col === "proxy" ? 20 : 30)}
                </text>
                {node.sub && (
                  <text
                    x={pos.x + pos.w / 2}
                    y={pos.y + (col === "proxy" ? 25 : 31)}
                    textAnchor="middle"
                    fontSize={col === "proxy" ? 9 : 8}
                    fontWeight={700}
                    fill={col === "proxy" ? "#047857" : c.sub}
                    letterSpacing="0.1em"
                  >
                    {truncate(node.sub, 24)}
                  </text>
                )}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

function renderEdge(
  edge: FlowEdge,
  positions: Map<string, { x: number; y: number; w: number; h: number }>,
  i: number,
) {
  const a = positions.get(edge.from);
  const b = positions.get(edge.to);
  if (!a || !b) return null;
  const ax = a.x + a.w;
  const ay = a.y + a.h / 2;
  const bx = b.x;
  const by = b.y + b.h / 2;

  const stroke = edge.tint === "success" ? "#10B981" : "#94A3B8";
  const marker = edge.tint === "success" ? "url(#fc-arrow-green)" : "url(#fc-arrow)";

  return (
    <path
      key={i}
      d={`M ${ax} ${ay} L ${bx} ${by}`}
      fill="none"
      stroke={stroke}
      strokeWidth={1.2}
      strokeOpacity={0.4}
      markerEnd={marker}
    />
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
