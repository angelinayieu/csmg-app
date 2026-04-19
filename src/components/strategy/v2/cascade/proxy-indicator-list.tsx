"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import type { CascadeRowVM } from "../strategy-view-model";
import { palette } from "../strategy-palette";

const SIG_COLORS: Record<string, string> = {
  ok: "#10B981",
  warn: "#F59E0B",
  bad: "#EF4444",
};

export function ProxyIndicatorList({ row }: { row: CascadeRowVM }) {
  const p = palette(row.paletteKey);
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? row.proxies : row.proxies.slice(0, 3);
  const hidden = Math.max(0, row.proxies.length - 3);

  return (
    <div
      className="rounded-[10px] p-3.5 self-start"
      style={{
        background: "#fff",
        border: "1px solid rgba(11,13,18,0.08)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between pb-2 mb-1"
        style={{ borderBottom: "1px solid rgba(11,13,18,0.08)" }}
      >
        <div
          className="flex items-center gap-1.5 font-mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(11,13,18,0.48)",
          }}
        >
          <BarChart3 className="w-2.5 h-2.5" style={{ color: p.accent }} />
          Proxy indicators
        </div>
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: "9.5px",
            color: "rgba(11,13,18,0.48)",
            background: p.tint,
            padding: "2px 6px",
            borderRadius: 4,
            fontWeight: 700,
            border: `1px solid ${p.edge}`,
          }}
        >
          {row.proxies.length} tracked
        </span>
      </div>

      {row.proxies.length === 0 && (
        <div
          className="text-center py-2"
          style={{ fontSize: 10.5, color: "rgba(11,13,18,0.34)" }}
        >
          No proxies yet
        </div>
      )}

      {visible.map((m, i) => {
        const TrendIcon =
          m.trend === "up" ? TrendingUp : m.trend === "down" ? TrendingDown : Minus;
        return (
          <div
            key={`${m.name}-${i}`}
            className="flex items-center gap-2 py-1.5"
            style={i > 0 ? { borderTop: "1px solid rgba(11,13,18,0.06)" } : undefined}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: SIG_COLORS[m.sig] }}
            />
            <span
              className="flex-1 truncate"
              style={{
                fontSize: 11,
                color: "rgba(11,13,18,0.92)",
                fontWeight: 500,
                letterSpacing: "-0.005em",
              }}
            >
              {m.name}
            </span>
            <span
              className="tabular-nums"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#0B0D12",
                letterSpacing: "-0.02em",
              }}
            >
              {m.value}
              {m.unit && (
                <span
                  style={{
                    fontSize: 9.5,
                    color: "rgba(11,13,18,0.48)",
                    fontWeight: 500,
                    marginLeft: 1,
                  }}
                >
                  {m.unit}
                </span>
              )}
            </span>
            <span
              className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
              style={{
                background: "rgba(11,13,18,0.04)",
                color: "rgba(11,13,18,0.48)",
              }}
              title={`Trend: ${m.trend ?? "unknown"}`}
            >
              <TrendIcon className="w-2 h-2" />
            </span>
          </div>
        );
      })}

      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full mt-1 py-1 rounded-md text-center hover:bg-gray-50 transition-colors"
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: p.accent,
          }}
        >
          + {hidden} more
        </button>
      )}
    </div>
  );
}
