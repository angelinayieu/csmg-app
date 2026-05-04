"use client";

// ── TwinStateRadar ───────────────────────────────────────────────────
//
// 4-axis radar chart of the twin's macro state: Health / Coverage /
// Risk / Dynamics. Replaces the scalar score with a *shape* — at a
// glance you can tell "high coverage, fragile dynamics" vs. "modest
// coverage, strong dynamics" even when the headline score is identical.
//
// Reads the same TwinMacroState the rest of the surface reads. No
// fetches — pure projection.
//
// Two variants:
//   - default (medium): full-size card with axis labels and value pills
//   - tight: 60×60 micro-radar suitable for inline next to a number
//
// Optional `proposed` overlay renders a translucent second polygon so
// the user can see how a proposed strategy would shift the shape — ties
// to compute-proposed-twin-state.ts (already exists, used by strategy
// approval gate).

import { useMemo } from "react";
import type { TwinMacroState } from "@/types/twin";

export interface TwinStateRadarProps {
  state: TwinMacroState;
  /** Optional second state (e.g., proposed strategy) overlaid on the
   *  primary in a contrasting hue so deltas are visible. */
  proposed?: TwinMacroState;
  density?: "tight" | "medium";
  className?: string;
}

interface AxisValue {
  /** 0–100 — chart-space value */
  value: number;
  /** Original raw text for label / tooltip */
  detail: string;
}

interface FourAxes {
  health: AxisValue;
  coverage: AxisValue;
  // Risk axis is INVERTED (high = low risk) so all four axes share a
  // "more is better" semantics — making the polygon shape readable
  // without per-axis cognitive load.
  risk_inv: AxisValue;
  dynamics: AxisValue;
}

function projectAxes(state: TwinMacroState): FourAxes {
  const cov = Math.round((1 - state.coverage.orphan_ratio) * 100);
  const crit = state.risk_exposure.critical_risks ?? 0;
  // Risk inversion: 0 critical → 100; 5+ critical → 0. Linear in between.
  const riskInv = Math.max(0, 100 - Math.min(100, crit * 20));
  const loops = state.dynamics.total_loops ?? 0;
  const lev = state.dynamics.leverage_points ?? 0;
  const dyn = Math.min(100, loops * 10 + lev * 8);
  return {
    health: { value: state.health_score, detail: state.health_label },
    coverage: { value: cov, detail: `${state.coverage.entities_modeled} entities · ${state.coverage.edges_mapped} edges` },
    risk_inv: {
      value: riskInv,
      detail: crit > 0 ? `${crit} critical risk${crit === 1 ? "" : "s"}` : "Clear",
    },
    dynamics: {
      value: dyn,
      detail: loops > 0 ? `${loops} loop${loops === 1 ? "" : "s"}, ${lev} leverage` : "Linear",
    },
  };
}

const HEALTH_COLOR = (score: number): string => {
  if (score >= 85) return "#30D158";
  if (score >= 70) return "#0A84FF";
  if (score >= 50) return "#FF9F0A";
  return "#FF453A";
};

export function TwinStateRadar({
  state,
  proposed,
  density = "medium",
  className,
}: TwinStateRadarProps) {
  const axes = useMemo(() => projectAxes(state), [state]);
  const proposedAxes = useMemo(
    () => (proposed ? projectAxes(proposed) : null),
    [proposed],
  );
  const color = HEALTH_COLOR(state.health_score);

  // 4 axes at top/right/bottom/left. Order in geometry mirrors the
  // mental map: Health (top), Coverage (right), Dynamics (bottom),
  // Risk-inv (left). Counter-clockwise from top.
  const layout = density === "tight"
    ? { size: 64, padding: 6, fontSize: 0, showLabels: false, showRings: 2 }
    : { size: 200, padding: 28, fontSize: 10, showLabels: true, showRings: 4 };

  const cx = layout.size / 2;
  const cy = layout.size / 2;
  const r = (layout.size - layout.padding * 2) / 2;

  const angleFor = (key: keyof FourAxes): number => {
    // Top, right, bottom, left
    switch (key) {
      case "health":
        return -Math.PI / 2;
      case "coverage":
        return 0;
      case "dynamics":
        return Math.PI / 2;
      case "risk_inv":
        return Math.PI;
    }
  };

  const polygonFor = (a: FourAxes): string =>
    (Object.keys(a) as Array<keyof FourAxes>)
      .map((key) => {
        const angle = angleFor(key);
        const ratio = a[key].value / 100;
        return `${cx + Math.cos(angle) * r * ratio},${cy + Math.sin(angle) * r * ratio}`;
      })
      .join(" ");

  const ringRadii = Array.from(
    { length: layout.showRings },
    (_, i) => ((i + 1) / layout.showRings) * r,
  );

  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      <svg
        width={layout.size}
        height={layout.size}
        viewBox={`0 0 ${layout.size} ${layout.size}`}
        role="img"
        aria-label="Twin state radar — Health, Coverage, low-Risk, Dynamics"
      >
        {/* Concentric rings */}
        {ringRadii.map((rr, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={rr}
            fill="none"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth={1}
          />
        ))}

        {/* Axis spokes */}
        {(["health", "coverage", "dynamics", "risk_inv"] as Array<keyof FourAxes>).map((k) => {
          const a = angleFor(k);
          return (
            <line
              key={k}
              x1={cx}
              y1={cy}
              x2={cx + Math.cos(a) * r}
              y2={cy + Math.sin(a) * r}
              stroke="rgba(0,0,0,0.06)"
              strokeWidth={1}
            />
          );
        })}

        {/* Proposed (background overlay) */}
        {proposedAxes ? (
          <polygon
            points={polygonFor(proposedAxes)}
            fill="rgba(0,0,0,0.10)"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ) : null}

        {/* Current */}
        <polygon
          points={polygonFor(axes)}
          fill={`${color}33`}
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />

        {/* Vertex dots */}
        {(["health", "coverage", "dynamics", "risk_inv"] as Array<keyof FourAxes>).map((k) => {
          const a = angleFor(k);
          const ratio = axes[k].value / 100;
          return (
            <circle
              key={k}
              cx={cx + Math.cos(a) * r * ratio}
              cy={cy + Math.sin(a) * r * ratio}
              r={2.2}
              fill={color}
              stroke="white"
              strokeWidth={1}
            >
              <title>{`${labelOf(k)}: ${Math.round(axes[k].value)} — ${axes[k].detail}`}</title>
            </circle>
          );
        })}

        {/* Axis labels */}
        {layout.showLabels
          ? (["health", "coverage", "dynamics", "risk_inv"] as Array<keyof FourAxes>).map((k) => {
              const a = angleFor(k);
              const lr = r + layout.padding * 0.6;
              const x = cx + Math.cos(a) * lr;
              const y = cy + Math.sin(a) * lr + (a === -Math.PI / 2 ? 2 : a === Math.PI / 2 ? 8 : 4);
              return (
                <text
                  key={k}
                  x={x}
                  y={y}
                  textAnchor={a === 0 ? "start" : a === Math.PI ? "end" : "middle"}
                  fontSize={layout.fontSize}
                  fill="rgba(0,0,0,0.55)"
                  fontWeight={600}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  letterSpacing="0.06em"
                  style={{ textTransform: "uppercase" }}
                >
                  {labelOf(k)}
                </text>
              );
            })
          : null}
      </svg>
    </div>
  );
}

function labelOf(k: keyof FourAxes): string {
  switch (k) {
    case "health":
      return "Health";
    case "coverage":
      return "Coverage";
    case "risk_inv":
      return "Low risk";
    case "dynamics":
      return "Dynamics";
  }
}
