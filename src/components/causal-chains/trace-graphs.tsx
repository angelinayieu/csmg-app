"use client";

// Primitive SVG renderers for inline step graphs. Each primitive takes the
// `data` payload from TraceGraphData and draws a compact 88×28 visualization.

import type { TraceGraphData } from "@/types/causal-chains";

type NumArray = number[];

interface GraphProps {
  graph: TraceGraphData;
  color: string;
}

export function TraceGraph({ graph, color }: GraphProps) {
  switch (graph.primitive) {
    case "distribution":
      return <Distribution data={graph.data} color={color} />;
    case "density":
      return <Density data={graph.data} color={color} />;
    case "number_line":
      return <NumberLine data={graph.data} color={color} />;
    case "scatter":
      return <Scatter data={graph.data} color={color} />;
    case "overlap":
      return <Overlap data={graph.data} color={color} />;
    case "comparison":
      return <Comparison data={graph.data} color={color} />;
    default:
      return null;
  }
}

function Distribution({ data, color }: { data: Record<string, unknown>; color: string }) {
  const bins = ((data.bins as NumArray) ?? [0.2, 0.4, 0.7, 0.9, 1, 0.9, 0.6, 0.35, 0.15]).slice(0, 9);
  const meanIndex = (data.mean_index as number) ?? Math.floor(bins.length / 2);
  return (
    <svg width="88" height="28" viewBox="0 0 88 28">
      <g fill={color} opacity="0.85">
        {bins.map((h, i) => {
          const height = Math.max(1, h * 24);
          return (
            <rect
              key={i}
              x={2 + i * 9}
              y={26 - height}
              width={6}
              height={height}
              rx={0.5}
            />
          );
        })}
      </g>
      <line
        x1={5 + meanIndex * 9}
        y1="0"
        x2={5 + meanIndex * 9}
        y2="26"
        stroke={color}
        strokeWidth="1"
        strokeDasharray="2 1.5"
      />
    </svg>
  );
}

function Density({ data, color }: { data: Record<string, unknown>; color: string }) {
  const centerPct = Math.max(0, Math.min(100, (data.center_pct as number) ?? 50));
  const cx = (centerPct / 100) * 88;
  const peak = 4; // y=4 is visual peak
  return (
    <svg width="88" height="28" viewBox="0 0 88 28">
      <path
        d={`M 2,26 Q ${cx - 28},26 ${cx - 20},22 Q ${cx - 8},${peak + 4} ${cx},${peak} Q ${cx + 8},${peak + 4} ${cx + 20},22 Q ${cx + 28},26 86,26 L 86,28 L 2,28 Z`}
        fill={color}
        fillOpacity="0.18"
      />
      <path
        d={`M 2,26 Q ${cx - 28},26 ${cx - 20},22 Q ${cx - 8},${peak + 4} ${cx},${peak} Q ${cx + 8},${peak + 4} ${cx + 20},22 Q ${cx + 28},26 86,26`}
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      <line
        x1={cx}
        y1="0"
        x2={cx}
        y2="26"
        stroke={color}
        strokeWidth="1"
        strokeDasharray="2 1.5"
      />
      <circle cx={cx} cy={peak} r="1.8" fill={color} />
    </svg>
  );
}

function NumberLine({ data, color }: { data: Record<string, unknown>; color: string }) {
  const min = (data.min as number) ?? 0;
  const max = (data.max as number) ?? 1;
  const marker = (data.marker as number) ?? 0.5;
  const range = max - min;
  const x = 4 + ((marker - min) / range) * 80;
  return (
    <svg width="88" height="28" viewBox="0 0 88 28">
      <line x1="4" y1="14" x2="84" y2="14" stroke="#e2e8f0" strokeWidth="1" />
      <line x1="4" y1="14" x2={x} y2="14" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <circle cx="4" cy="14" r="2.5" fill={color} />
      <circle cx={x} cy="14" r="3.5" fill={color} />
      <circle cx="84" cy="14" r="2.5" fill="#fff" stroke="#cbd5e1" strokeWidth="1" />
    </svg>
  );
}

function Scatter({ data, color }: { data: Record<string, unknown>; color: string }) {
  const pts =
    (data.points as Array<[number, number]>) ??
    [[6, 20], [14, 14], [22, 10], [30, 8], [38, 9], [46, 6], [54, 7], [62, 11], [70, 8], [78, 6]];
  return (
    <svg width="88" height="28" viewBox="0 0 88 28">
      <g fill={color} opacity="0.55">
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2" />
        ))}
      </g>
      <path d="M 4 22 Q 30 8 84 6" stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function Overlap({ data, color }: { data: Record<string, unknown>; color: string }) {
  const labels = (data.labels as string[]) ?? ["A", "B"];
  const overlap = Math.max(0, Math.min(1, (data.overlap_ratio as number) ?? 0.4));
  // Larger overlap → circles closer together
  const gap = 56 - overlap * 30; // 26 (max overlap) .. 56 (no overlap)
  const cx1 = 44 - gap / 2;
  const cx2 = 44 + gap / 2;
  return (
    <svg width="88" height="28" viewBox="0 0 88 28">
      <ellipse cx={cx1} cy="14" rx="20" ry="9" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1" />
      <ellipse cx={cx2} cy="14" rx="20" ry="9" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1" />
      <text x={cx1} y="17" fontSize="7.5" fill="#64748b" textAnchor="middle" fontWeight="700">
        {(labels[0] ?? "A").slice(0, 3)}
      </text>
      <text x={cx2} y="17" fontSize="7.5" fill="#64748b" textAnchor="middle" fontWeight="700">
        {(labels[1] ?? "B").slice(0, 3)}
      </text>
    </svg>
  );
}

function Comparison({ data, color }: { data: Record<string, unknown>; color: string }) {
  const before = (data.before as number) ?? 14.2;
  const after = (data.after as number) ?? 8.4;
  const maxVal = Math.max(before, after) || 1;
  const beforeW = (before / maxVal) * 36;
  const afterW = (after / maxVal) * 36 * 0.8;
  return (
    <svg width="88" height="28" viewBox="0 0 88 28">
      <rect
        x="6"
        y="6"
        width={beforeW}
        height="16"
        fill={color}
        fillOpacity="0.18"
        stroke={color}
        strokeWidth="1"
        rx="1"
      />
      <rect
        x="50"
        y="12"
        width={afterW}
        height="10"
        fill="#16a34a"
        fillOpacity="0.25"
        stroke="#16a34a"
        strokeWidth="1"
        rx="1"
      />
      <text x={6 + beforeW / 2} y="17" fontSize="7" fill={color} textAnchor="middle" fontWeight="700">
        {before}
      </text>
      <text x={50 + afterW / 2} y="20" fontSize="7" fill="#16a34a" textAnchor="middle" fontWeight="700">
        {after}
      </text>
    </svg>
  );
}
