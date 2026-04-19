"use client";

import type { CascadeRowVM } from "../strategy-view-model";
import { palette } from "../strategy-palette";

export function PerspectiveCard({ row }: { row: CascadeRowVM }) {
  const p = palette(row.paletteKey);
  return (
    <div
      className="rounded-[10px] p-3.5 self-start relative overflow-hidden"
      style={{
        background: p.tint,
        border: `1px solid ${p.edge}`,
      }}
    >
      {/* 4px accent bar on left */}
      <span
        className="absolute top-0 left-0 bottom-0"
        style={{ width: 4, background: p.accent }}
      />

      <div
        className="font-mono"
        style={{
          fontSize: "9.5px",
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: p.deep,
          marginLeft: 6,
          marginBottom: 7,
        }}
      >
        {p.label}
      </div>
      <p
        style={{
          fontSize: "12.5px",
          fontWeight: 600,
          lineHeight: 1.4,
          color: "#0B0D12",
          letterSpacing: "-0.005em",
          marginLeft: 6,
          marginBottom: 12,
        }}
      >
        {row.question || row.perspective.objective}
      </p>
      {/* Weight bar */}
      <div className="flex items-center gap-2" style={{ marginLeft: 6 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(11,13,18,0.34)",
          }}
        >
          Weight
        </span>
        <div
          className="flex-1 h-[3px] rounded-full overflow-hidden relative"
          style={{ background: "rgba(11,13,18,0.08)" }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 rounded-full"
            style={{
              width: `${Math.round(row.weight * 100)}%`,
              background: p.accent,
            }}
          />
        </div>
        <span
          className="tabular-nums"
          style={{
            fontSize: "11.5px",
            fontWeight: 700,
            color: "#0B0D12",
            letterSpacing: "-0.02em",
            minWidth: 26,
            textAlign: "right",
          }}
        >
          {row.weight.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
