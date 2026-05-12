"use client";

// ── Trajectory fan shape ────────────────────────────────────────────
//
// Renders one row from `prediction_ledger` where
// `prediction_kind = "trajectory"` as a compact p10/p50/p90 fan chart
// over time. Spawned inside the twin room of the operational cascade so
// users see "what the simulator predicts will happen" right next to
// the twin-snapshot, without navigating to the dedicated TrajectoryPanel
// side-page.
//
// Why this matters: the trajectory engine is real (`/api/trajectory/project`
// + persistTrajectory writing to prediction_ledger), but its output has
// only ever been visualized on a separate page. The data comes back to
// the canvas as JSON-stringified per-week steps; this shape parses + draws
// the fan inline.
//
// Visual:
//   [metric label]                        [conf chip]
//   ┌─ horizon: "in 12 weeks" ──────────────────────┐
//   │   <svg fan chart>                             │
//   │     light blue = p10–p90 envelope             │
//   │     solid blue line = p50 median              │
//   │     dot at right edge = terminal p50          │
//   └────────────────────────────────────────────────┘

import { useMemo } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { TrendingUp, ArrowUpRight } from "lucide-react";
import type { TrajectoryFanShape } from "./types";

export const TRAJECTORY_FAN_DEFAULT_W = 320;
export const TRAJECTORY_FAN_DEFAULT_H = 200;

/** One step in the persisted trajectory — week index + percentiles. */
interface TrajectoryStep {
  week: number;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
}

interface FinalDistribution {
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
  mean?: number | null;
  stddev?: number | null;
}

function safeParseTrajectory(json: string): TrajectoryStep[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is TrajectoryStep =>
          s &&
          typeof s === "object" &&
          typeof (s as { week?: unknown }).week === "number",
      )
      // Sort by week ascending so the line draws left-to-right even if
      // the persisted array was unordered.
      .sort((a, b) => a.week - b.week);
  } catch {
    return [];
  }
}

function safeParseFinalDist(json: string): FinalDistribution | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as FinalDistribution;
  } catch {
    return null;
  }
}

/** Format the horizon label as "in N weeks" or "N weeks ago" relative to now. */
function formatHorizon(horizonAtIso: string | null): string {
  if (!horizonAtIso) return "horizon: —";
  const t = new Date(horizonAtIso).getTime();
  if (Number.isNaN(t)) return "horizon: —";
  const days = Math.round((t - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < -7) return `horizon: ${Math.round(-days / 7)}w ago`;
  if (days < 0) return `horizon: ${Math.abs(days)}d ago`;
  if (days < 7) return `horizon: in ${days}d`;
  if (days < 365) return `horizon: in ${Math.round(days / 7)}w`;
  return `horizon: in ${Math.round(days / 365)}y`;
}

export class TrajectoryFanShapeUtil extends BaseBoxShapeUtil<TrajectoryFanShape> {
  static override type = "trajectory-fan" as const;
  static override props: RecordProps<TrajectoryFanShape> = {
    w: T.number,
    h: T.number,
    predictionId: T.string,
    metricLabel: T.string,
    // T.any for nullable strings (same pattern mechanism-card uses for
    // its rationale field — tldraw's T.string can't be inline-nullable).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metricUnit: T.any as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    horizonAt: T.any as any,
    predictedAt: T.string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    confidence: T.any as any,
    trajectoryJson: T.string,
    finalDistributionJson: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: TrajectoryFanShape,
    info: TLResizeInfo<TrajectoryFanShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): TrajectoryFanShape["props"] {
    return {
      w: TRAJECTORY_FAN_DEFAULT_W,
      h: TRAJECTORY_FAN_DEFAULT_H,
      predictionId: "",
      metricLabel: "",
      metricUnit: null,
      horizonAt: null,
      predictedAt: new Date().toISOString(),
      confidence: null,
      trajectoryJson: "[]",
      finalDistributionJson: "",
    };
  }

  component(shape: TrajectoryFanShape) {
    return <TrajectoryFanView shape={shape} />;
  }

  indicator(shape: TrajectoryFanShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
    );
  }
}

const ACCENT = "#2563EB"; // blue-600 — same family the existing TrajectoryPanel uses
const ACCENT_LIGHT = "rgba(37, 99, 235, 0.18)";
const ACCENT_FAINT = "rgba(37, 99, 235, 0.08)";

function TrajectoryFanView({ shape }: { shape: TrajectoryFanShape }) {
  const {
    w,
    h,
    metricLabel,
    metricUnit,
    horizonAt,
    confidence,
    trajectoryJson,
    finalDistributionJson,
  } = shape.props;

  const steps = useMemo(
    () => safeParseTrajectory(trajectoryJson),
    [trajectoryJson],
  );
  const finalDist = useMemo(
    () => safeParseFinalDist(finalDistributionJson),
    [finalDistributionJson],
  );

  // Fan-chart geometry. Body region: header takes ~52px, footer ~28px,
  // padding 12px each side. Compute domain min/max across all percentile
  // values so the y-axis fits the fan envelope tightly.
  const headerH = 52;
  const footerH = 28;
  const padLR = 14;
  const chartW = Math.max(80, w - padLR * 2);
  const chartH = Math.max(60, h - headerH - footerH);
  const chartTop = headerH;
  const chartLeft = padLR;

  const path = useMemo(() => {
    if (steps.length < 2) {
      return { p50: "", envelope: "", terminalY: null as number | null };
    }
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const s of steps) {
      for (const v of [s.p10, s.p50, s.p90]) {
        if (typeof v === "number" && Number.isFinite(v)) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      return { p50: "", envelope: "", terminalY: null };
    }
    if (yMin === yMax) {
      // Avoid divide-by-zero — pad a tiny range so the line is visible.
      yMin -= 1;
      yMax += 1;
    }
    const wMin = steps[0].week;
    const wMax = steps[steps.length - 1].week;
    const wRange = Math.max(1, wMax - wMin);

    const x = (week: number) =>
      chartLeft + ((week - wMin) / wRange) * chartW;
    const y = (val: number) =>
      chartTop + (1 - (val - yMin) / (yMax - yMin)) * chartH;

    // p50 path
    const p50Pts = steps
      .filter((s) => typeof s.p50 === "number")
      .map((s) => `${x(s.week).toFixed(1)},${y(s.p50 as number).toFixed(1)}`);
    const p50Path =
      p50Pts.length > 1 ? `M ${p50Pts[0]} L ${p50Pts.slice(1).join(" L ")}` : "";

    // Envelope (p10/p90 area). Forward p90, reverse p10, close.
    const upper = steps
      .filter((s) => typeof s.p90 === "number")
      .map((s) => `${x(s.week).toFixed(1)},${y(s.p90 as number).toFixed(1)}`);
    const lower = steps
      .filter((s) => typeof s.p10 === "number")
      .reverse()
      .map((s) => `${x(s.week).toFixed(1)},${y(s.p10 as number).toFixed(1)}`);
    const envelopePath =
      upper.length > 1 && lower.length > 1
        ? `M ${upper[0]} L ${upper.slice(1).join(" L ")} L ${lower.join(" L ")} Z`
        : "";

    // Terminal p50 marker for the right-edge dot.
    const terminal = steps[steps.length - 1];
    const terminalY =
      typeof terminal.p50 === "number" ? y(terminal.p50) : null;

    return { p50: p50Path, envelope: envelopePath, terminalY };
  }, [steps, chartLeft, chartW, chartTop, chartH]);

  const horizonLabel = formatHorizon(horizonAt);
  const finalP50 = finalDist?.p50 ?? steps[steps.length - 1]?.p50 ?? null;
  const finalP10 = finalDist?.p10 ?? steps[steps.length - 1]?.p10 ?? null;
  const finalP90 = finalDist?.p90 ?? steps[steps.length - 1]?.p90 ?? null;
  const confPct =
    typeof confidence === "number" && Number.isFinite(confidence)
      ? Math.round(confidence * 100)
      : null;

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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            paddingLeft: 4,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
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
              title="Monte-Carlo trajectory projection"
            >
              <TrendingUp style={{ width: 10, height: 10 }} />
              Trajectory · {horizonLabel}
            </div>
            <div
              style={{
                marginTop: 2,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.005em",
                color: "#0a1020",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={metricLabel}
            >
              {metricLabel || "(unnamed metric)"}
            </div>
          </div>
          {confPct !== null && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: `${ACCENT}11`,
                color: ACCENT,
                letterSpacing: "0.06em",
              }}
              title={`Simulator confidence: ${confPct}%`}
            >
              {confPct}% conf
            </span>
          )}
        </div>

        {/* Fan chart */}
        <svg
          width={chartW + padLR * 2}
          height={chartH + 8}
          style={{ marginTop: 6 }}
        >
          {/* Faint baseline at chartTop+chartH/2 for visual anchor */}
          <line
            x1={chartLeft}
            x2={chartLeft + chartW}
            y1={chartTop + chartH / 2}
            y2={chartTop + chartH / 2}
            stroke="#E2E8F0"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
          {/* Envelope (p10–p90) */}
          {path.envelope && (
            <path d={path.envelope} fill={ACCENT_LIGHT} stroke="none" />
          )}
          {/* p50 line */}
          {path.p50 && (
            <path
              d={path.p50}
              fill="none"
              stroke={ACCENT}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {/* Terminal marker */}
          {path.terminalY !== null && (
            <circle
              cx={chartLeft + chartW}
              cy={path.terminalY}
              r={3.5}
              fill={ACCENT}
              stroke="#FFFFFF"
              strokeWidth={1.5}
            />
          )}
          {steps.length < 2 && (
            <text
              x={chartLeft + chartW / 2}
              y={chartTop + chartH / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fill="#94A3B8"
              fontStyle="italic"
            >
              insufficient trajectory data
            </text>
          )}
        </svg>

        {/* Footer — final horizon distribution + open-detail CTA */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            paddingLeft: 4,
            fontSize: 10.5,
            color: "#475569",
          }}
        >
          {finalP50 !== null ? (
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              <span style={{ color: "#94A3B8" }}>p10</span>{" "}
              {formatNumber(finalP10)}
              {" · "}
              <span style={{ fontWeight: 700, color: "#0a1020" }}>
                {formatNumber(finalP50)}
              </span>
              {" · "}
              <span style={{ color: "#94A3B8" }}>p90</span>{" "}
              {formatNumber(finalP90)}
              {metricUnit ? ` ${metricUnit}` : ""}
            </span>
          ) : (
            <span style={{ color: "#94A3B8", fontStyle: "italic" }}>
              no terminal distribution
            </span>
          )}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              color: ACCENT,
              fontSize: 10,
              fontWeight: 600,
            }}
            title="Trajectory detail panel (full per-week table)"
          >
            detail
            <ArrowUpRight style={{ width: 10, height: 10 }} />
          </span>
        </div>

        {/* Background tint */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(180deg, ${ACCENT_FAINT} 0%, transparent 60%)`,
            pointerEvents: "none",
          }}
        />
      </div>
    </HTMLContainer>
  );
}

function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
