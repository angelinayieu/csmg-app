"use client";

// ── Edge drift heatmap shape ────────────────────────────────────────
//
// Visualizes `edge_calibrations` rows aggregated by edge × week as a
// signed heatmap. Rows = top edges by |cumulative drift|; columns =
// weekly buckets (oldest left, newest right); cells colored by signed
// delta_strength: amber for negative drift (edge de-rated by reality)
// and emerald for positive (edge reinforced by reality). White cells =
// no movement that week.
//
// Spawned inside the reflexive room of the operational cascade. The
// reflexive room is the audit room — the heatmap answers "where did
// the model lose confidence in what it knows?" at a glance.

import { useMemo } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Activity } from "lucide-react";
import type { EdgeDriftHeatmapShape } from "./types";

export const EDGE_DRIFT_DEFAULT_W = 380;
export const EDGE_DRIFT_DEFAULT_H = 320;

interface EdgeDriftRow {
  edgeId: string;
  label: string;
  cells: number[];
  cumulativeAbs: number;
  netSigned: number;
  lastConfidenceDelta: number;
}

interface DriftPayload {
  edges: EdgeDriftRow[];
  weekLabels: string[];
}

const ACCENT = "#0EA5E9"; // sky-500 — distinct from forest-plot teal / trajectory blue
const POSITIVE = "#10B981"; // emerald — edge reinforced
const NEGATIVE = "#D97706"; // amber-600 — edge de-rated
const NEUTRAL = "#F1F5F9"; // slate-100 — zero movement

function safeParseDrift(json: string): DriftPayload {
  if (!json) return { edges: [], weekLabels: [] };
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") {
      return { edges: [], weekLabels: [] };
    }
    const edges = Array.isArray(parsed.edges)
      ? (parsed.edges.filter(
          (e: unknown) =>
            e &&
            typeof e === "object" &&
            typeof (e as { edgeId?: unknown }).edgeId === "string" &&
            Array.isArray((e as { cells?: unknown }).cells),
        ) as EdgeDriftRow[])
      : [];
    const weekLabels = Array.isArray(parsed.weekLabels)
      ? (parsed.weekLabels.filter(
          (l: unknown): l is string => typeof l === "string",
        ) as string[])
      : [];
    return { edges, weekLabels };
  } catch {
    return { edges: [], weekLabels: [] };
  }
}

/** Map a signed cell value to an HSL-ish color. magnitude in [0, 1]. */
function cellColor(value: number, maxAbs: number): string {
  if (!Number.isFinite(value) || maxAbs <= 0) return NEUTRAL;
  const norm = Math.max(-1, Math.min(1, value / maxAbs));
  if (Math.abs(norm) < 0.04) return NEUTRAL;
  // Linear interpolation between NEUTRAL and POSITIVE/NEGATIVE
  const target = norm > 0 ? POSITIVE : NEGATIVE;
  const intensity = Math.abs(norm); // 0..1
  // Mix from a near-white base toward target. Cheap RGB lerp.
  // Parse target hex.
  const hex = target.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Base = #F8FAFC (slate-50)
  const baseR = 0xf8;
  const baseG = 0xfa;
  const baseB = 0xfc;
  const mr = Math.round(baseR + (r - baseR) * intensity);
  const mg = Math.round(baseG + (g - baseG) * intensity);
  const mb = Math.round(baseB + (b - baseB) * intensity);
  return `rgb(${mr}, ${mg}, ${mb})`;
}

function formatCell(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.005) return "·";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

function shortWeek(iso: string): string {
  // "2026-04-12" → "04/12"
  if (!iso || iso.length < 10) return iso;
  return iso.slice(5, 10).replace("-", "/");
}

export class EdgeDriftHeatmapShapeUtil extends BaseBoxShapeUtil<EdgeDriftHeatmapShape> {
  static override type = "edge-drift-heatmap" as const;
  static override props: RecordProps<EdgeDriftHeatmapShape> = {
    w: T.number,
    h: T.number,
    driftJson: T.string,
    maxAbsCell: T.number,
    edgeCount: T.number,
    weekCount: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: EdgeDriftHeatmapShape,
    info: TLResizeInfo<EdgeDriftHeatmapShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): EdgeDriftHeatmapShape["props"] {
    return {
      w: EDGE_DRIFT_DEFAULT_W,
      h: EDGE_DRIFT_DEFAULT_H,
      driftJson: '{"edges":[],"weekLabels":[]}',
      maxAbsCell: 0,
      edgeCount: 0,
      weekCount: 0,
    };
  }

  component(shape: EdgeDriftHeatmapShape) {
    return <EdgeDriftHeatmapView shape={shape} />;
  }

  indicator(shape: EdgeDriftHeatmapShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function EdgeDriftHeatmapView({ shape }: { shape: EdgeDriftHeatmapShape }) {
  const { w, h, driftJson, maxAbsCell } = shape.props;

  const drift = useMemo(() => safeParseDrift(driftJson), [driftJson]);
  const { edges, weekLabels } = drift;

  // Layout: header ~50px, footer ~22px, label column ~140px, week-
  // header row ~16px. Heatmap region fills the rest.
  const headerH = 50;
  const footerH = 22;
  const padLR = 14;
  const labelW = 140;
  const weekHeaderH = 18;
  const gridLeft = padLR + labelW + 4;
  const gridRight = w - padLR;
  const gridTop = headerH + weekHeaderH;
  const gridBottom = h - footerH;
  const gridW = Math.max(60, gridRight - gridLeft);
  const gridH = Math.max(60, gridBottom - gridTop);
  const colCount = Math.max(1, weekLabels.length);
  const rowCount = Math.max(1, edges.length);
  const cellW = gridW / colCount;
  const cellH = Math.min(28, gridH / rowCount);

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 14,
          overflow: "hidden",
          background: "rgba(255, 255, 255, 0.97)",
          backdropFilter: "blur(14px)",
          border: `1px solid ${ACCENT}33`,
          boxShadow: `0 12px 28px -10px ${ACCENT}22, 0 4px 10px rgba(8, 60, 180, 0.05)`,
          padding: "12px 14px",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          color: "#0a1020",
          display: "flex",
          flexDirection: "column",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Left accent rail */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: ACCENT,
          }}
        />

        {/* Header */}
        <div style={{ paddingLeft: 4 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: ACCENT,
            }}
            title="edge_calibrations aggregated by edge × week"
          >
            <Activity style={{ width: 10, height: 10 }} />
            Edge drift · {weekLabels.length}w window
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: "#0a1020",
              fontWeight: 500,
            }}
          >
            {edges.length > 0 ? (
              <>
                {edges.length} edge{edges.length === 1 ? "" : "s"} ·{" "}
                <span style={{ color: "#64748b" }}>
                  signed Δ strength per week
                </span>
              </>
            ) : (
              <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                no calibrations recorded
              </span>
            )}
          </div>
        </div>

        {edges.length > 0 && (
          <svg
            width={w}
            height={gridBottom - headerH}
            style={{ display: "block", marginTop: 0 }}
            viewBox={`0 0 ${w} ${gridBottom - headerH}`}
            preserveAspectRatio="none"
          >
            {/* Week labels along top of grid */}
            {weekLabels.map((iso, i) => (
              <text
                key={iso}
                x={gridLeft + i * cellW + cellW / 2}
                y={weekHeaderH - 4 + (gridTop - headerH - weekHeaderH)}
                fontSize={8.5}
                fill="#94A3B8"
                textAnchor="middle"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {shortWeek(iso)}
              </text>
            ))}
            {/* Edge labels + cells */}
            {edges.map((edge, ri) => {
              const yTop = gridTop - headerH + ri * cellH;
              const yCenter = yTop + cellH / 2;
              const trunc =
                edge.label.length > 20
                  ? `${edge.label.slice(0, 19)}…`
                  : edge.label;
              return (
                <g key={edge.edgeId}>
                  {/* Row label */}
                  <text
                    x={padLR + 4}
                    y={yCenter}
                    fontSize={9.5}
                    fill="#475569"
                    dominantBaseline="middle"
                  >
                    {trunc}
                  </text>
                  {/* Cells for this row */}
                  {edge.cells.map((cell, ci) => {
                    const cx = gridLeft + ci * cellW;
                    const fill = cellColor(cell, maxAbsCell);
                    return (
                      <g key={`${edge.edgeId}-${ci}`}>
                        <title>{`${edge.label} · ${weekLabels[ci] ?? "?"} · Δstrength=${formatCell(cell)}`}</title>
                        <rect
                          x={cx + 1}
                          y={yTop + 1}
                          width={Math.max(1, cellW - 2)}
                          height={Math.max(1, cellH - 2)}
                          fill={fill}
                          stroke="#FFFFFF"
                          strokeWidth={0.5}
                          rx={2}
                          ry={2}
                        />
                        {/* Numeric value when cell is non-trivial AND wide enough to read */}
                        {Math.abs(cell) >= 0.04 && cellW >= 28 && (
                          <text
                            x={cx + cellW / 2}
                            y={yCenter}
                            fontSize={8}
                            fill={
                              Math.abs(cell) / Math.max(maxAbsCell, 0.0001) >
                              0.55
                                ? "#FFFFFF"
                                : "#0F172A"
                            }
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          >
                            {formatCell(cell)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}

        {edges.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#94A3B8",
              fontSize: 11,
              fontStyle: "italic",
            }}
          >
            no edge calibrations recorded yet
          </div>
        )}

        {/* Footer — color legend */}
        <div
          style={{
            marginTop: "auto",
            paddingLeft: 4,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#94A3B8",
            fontSize: 9.5,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: NEGATIVE,
                }}
              />
              de-rated
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: POSITIVE,
                }}
              />
              reinforced
            </span>
          </span>
          {edges.length > 0 && (
            <span>max |Δ| = {maxAbsCell.toFixed(2)}</span>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
