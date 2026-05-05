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

      {/* Subtitle is the LLM-generated perspective name (domain-adapted),
          not the palette label. Palette stays as color only — falling back to
          p.label only if the recommendation somehow shipped without a name. */}
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
        {row.categoryLabel?.trim() || p.label}
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
      {/* Weight bar — shown ONLY when the LLM provided contribution_to_health
          (a real signal). When absent, we render a confidence chip (or
          nothing) instead of a fake-precise decimal derived from the
          confidence bucket — that fallback rendered "0.70" for any
          'moderate'-confidence perspective and read as fake rigor. */}
      {row.weight !== null ? (
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
      ) : row.confidence ? (
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
            Confidence
          </span>
          <span
            className="font-mono"
            title="LLM-reported confidence — no contribution-to-health signal was provided, so a numeric weight isn't shown."
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              padding: "2px 6px",
              borderRadius: 4,
              background:
                row.confidence === "high"
                  ? "rgba(16,185,129,0.10)"
                  : row.confidence === "moderate"
                    ? "rgba(245,158,11,0.10)"
                    : "rgba(239,68,68,0.10)",
              color:
                row.confidence === "high"
                  ? "#047857"
                  : row.confidence === "moderate"
                    ? "#B45309"
                    : "#B91C1C",
              border: `1px solid ${
                row.confidence === "high"
                  ? "rgba(16,185,129,0.32)"
                  : row.confidence === "moderate"
                    ? "rgba(245,158,11,0.32)"
                    : "rgba(239,68,68,0.32)"
              }`,
            }}
          >
            {row.confidence}
          </span>
        </div>
      ) : null}
    </div>
  );
}
