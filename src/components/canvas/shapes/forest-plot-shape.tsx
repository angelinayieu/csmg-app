"use client";

// ── Forest plot shape ───────────────────────────────────────────────
//
// Meta-analysis-style canvas card. Renders the top N evidence_registries
// rows (effect_size + CI) ranked by |effect_size| desc. Each row: label
// on the left, horizontal CI bar with point-estimate dot in the middle,
// numeric readout on the right. Vertical reference line at 0 (SMD
// family) or 1 (ratio family) per the dominant effect_metric.
//
// Spawned inside the kg room next to the synthesis insight cards
// (bottleneck / leverage / risk) so users see "the strongest evidence-
// based effect sizes" alongside the qualitative insights.

import { useMemo } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { BarChart3 } from "lucide-react";
import type { ForestPlotShape } from "./types";

export const FOREST_PLOT_DEFAULT_W = 360;
export const FOREST_PLOT_DEFAULT_H = 320;

interface ForestFinding {
  id: string;
  label: string;
  effect_size: number;
  effect_metric: string | null;
  ci_lower: number;
  ci_upper: number;
  ci_level: number | null;
  n_total: number | null;
  followup_label: string | null;
  population_label: string | null;
}

const SMD_METRICS = new Set([
  "cohens_d",
  "hedges_g",
  "smd",
  "raw_mean_diff",
  "beta",
]);
const RATIO_METRICS = new Set(["rr", "or", "hr", "irr"]);

function isRatioMetric(m: string | null | undefined): boolean {
  if (!m) return false;
  return RATIO_METRICS.has(m.toLowerCase());
}

function safeParseFindings(json: string): ForestFinding[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is ForestFinding =>
        f &&
        typeof f === "object" &&
        typeof (f as { effect_size?: unknown }).effect_size === "number" &&
        typeof (f as { ci_lower?: unknown }).ci_lower === "number" &&
        typeof (f as { ci_upper?: unknown }).ci_upper === "number" &&
        typeof (f as { label?: unknown }).label === "string",
    );
  } catch {
    return [];
  }
}

function formatEffect(v: number, isRatio: boolean): string {
  if (!Number.isFinite(v)) return "—";
  if (isRatio) {
    if (Math.abs(v) >= 100) return v.toFixed(0);
    return v.toFixed(2);
  }
  return v.toFixed(2);
}

const ACCENT = "#0F766E"; // teal-700 — distinct from trajectory blue / hypothesis violet
const BAR_POSITIVE = "#0F766E"; // teal — favors intervention
const BAR_NEGATIVE = "#B45309"; // amber-700 — disfavors intervention
const BAR_NULL = "#94A3B8"; // slate when CI crosses null

export class ForestPlotShapeUtil extends BaseBoxShapeUtil<ForestPlotShape> {
  static override type = "forest-plot" as const;
  static override props: RecordProps<ForestPlotShape> = {
    w: T.number,
    h: T.number,
    findingsJson: T.string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    referenceMetric: T.any as any,
    findingCount: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: ForestPlotShape,
    info: TLResizeInfo<ForestPlotShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): ForestPlotShape["props"] {
    return {
      w: FOREST_PLOT_DEFAULT_W,
      h: FOREST_PLOT_DEFAULT_H,
      findingsJson: "[]",
      referenceMetric: null,
      findingCount: 0,
    };
  }

  component(shape: ForestPlotShape) {
    return <ForestPlotView shape={shape} />;
  }

  indicator(shape: ForestPlotShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function ForestPlotView({ shape }: { shape: ForestPlotShape }) {
  const { w, h, findingsJson, referenceMetric } = shape.props;

  const findings = useMemo(
    () => safeParseFindings(findingsJson),
    [findingsJson],
  );

  const isRatio = isRatioMetric(referenceMetric);
  const referenceValue = isRatio ? 1 : 0;

  // Layout: header ~52px, footer ~22px, label column ~110px on left,
  // numeric readout column ~70px on right. Bar plotting region is
  // whatever's between, scaled to global x-domain.
  const headerH = 52;
  const footerH = 22;
  const padLR = 14;
  const labelW = 110;
  const readoutW = 78;
  const barLeft = padLR + labelW + 6;
  const barRight = w - padLR - readoutW - 6;
  const barW = Math.max(40, barRight - barLeft);
  const bodyTop = headerH;
  const bodyH = Math.max(60, h - headerH - footerH);
  const rowH = findings.length > 0 ? Math.max(16, bodyH / findings.length) : 0;

  // Compute x-axis domain. Use min(ci_lower) and max(ci_upper) across
  // all findings, padded slightly so the outermost bars don't touch
  // the chart edges. Always include the reference value so the
  // reference line is visible.
  const domain = useMemo(() => {
    if (findings.length === 0) return { min: -1, max: 1 };
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const f of findings) {
      if (f.ci_lower < lo) lo = f.ci_lower;
      if (f.ci_upper > hi) hi = f.ci_upper;
    }
    if (lo === Number.POSITIVE_INFINITY || hi === Number.NEGATIVE_INFINITY) {
      return { min: referenceValue - 1, max: referenceValue + 1 };
    }
    if (lo > referenceValue) lo = referenceValue;
    if (hi < referenceValue) hi = referenceValue;
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.08;
    return { min: lo - pad, max: hi + pad };
  }, [findings, referenceValue]);

  const xToPx = (v: number): number =>
    barLeft + ((v - domain.min) / (domain.max - domain.min)) * barW;

  const refX = xToPx(referenceValue);

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
            title="Effect sizes from evidence_registries, ranked by |effect|"
          >
            <BarChart3 style={{ width: 10, height: 10 }} />
            Forest plot
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: "#0a1020",
              fontWeight: 500,
            }}
          >
            {findings.length > 0 ? (
              <>
                {findings.length} finding{findings.length === 1 ? "" : "s"} ·{" "}
                <span style={{ color: "#64748b" }}>
                  {referenceMetric ?? "mixed"}
                  {referenceMetric && ` · ref @ ${referenceValue}`}
                </span>
              </>
            ) : (
              <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                no findings with CIs yet
              </span>
            )}
          </div>
        </div>

        {/* Body — SVG forest */}
        {findings.length > 0 && (
          <svg
            width={w}
            height={bodyH}
            style={{ display: "block" }}
            viewBox={`0 0 ${w} ${bodyH}`}
            preserveAspectRatio="none"
          >
            {/* Vertical reference line */}
            <line
              x1={refX}
              x2={refX}
              y1={0}
              y2={bodyH}
              stroke="#CBD5E1"
              strokeWidth={1}
              strokeDasharray="2 3"
            />

            {findings.map((f, i) => {
              const yCenter = i * rowH + rowH / 2;
              const xLow = xToPx(f.ci_lower);
              const xHigh = xToPx(f.ci_upper);
              const xPoint = xToPx(f.effect_size);
              const crossesNull =
                f.ci_lower < referenceValue && f.ci_upper > referenceValue;
              const above = f.effect_size > referenceValue;
              const barColor = crossesNull
                ? BAR_NULL
                : above
                  ? BAR_POSITIVE
                  : BAR_NEGATIVE;
              const truncatedLabel =
                f.label.length > 18 ? `${f.label.slice(0, 17)}…` : f.label;
              const readout = `${formatEffect(f.effect_size, isRatio)} [${formatEffect(f.ci_lower, isRatio)}, ${formatEffect(f.ci_upper, isRatio)}]`;
              return (
                <g key={f.id} style={{ pointerEvents: "auto" }}>
                  <title>{`${f.label}: ${readout}${
                    f.followup_label ? ` · ${f.followup_label}` : ""
                  }${f.n_total ? ` · n=${f.n_total}` : ""}`}</title>
                  {/* Label */}
                  <text
                    x={padLR + 4}
                    y={yCenter}
                    fontSize={10}
                    fill="#475569"
                    dominantBaseline="middle"
                  >
                    {truncatedLabel}
                  </text>
                  {/* CI bar */}
                  <line
                    x1={xLow}
                    x2={xHigh}
                    y1={yCenter}
                    y2={yCenter}
                    stroke={barColor}
                    strokeWidth={1.5}
                    strokeOpacity={0.55}
                  />
                  {/* CI caps */}
                  <line
                    x1={xLow}
                    x2={xLow}
                    y1={yCenter - 3}
                    y2={yCenter + 3}
                    stroke={barColor}
                    strokeWidth={1.2}
                    strokeOpacity={0.7}
                  />
                  <line
                    x1={xHigh}
                    x2={xHigh}
                    y1={yCenter - 3}
                    y2={yCenter + 3}
                    stroke={barColor}
                    strokeWidth={1.2}
                    strokeOpacity={0.7}
                  />
                  {/* Point estimate */}
                  <circle
                    cx={xPoint}
                    cy={yCenter}
                    r={3}
                    fill={barColor}
                    stroke="#FFFFFF"
                    strokeWidth={1}
                  />
                  {/* Readout */}
                  <text
                    x={w - padLR}
                    y={yCenter}
                    fontSize={9.5}
                    fill="#475569"
                    dominantBaseline="middle"
                    textAnchor="end"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatEffect(f.effect_size, isRatio)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {findings.length === 0 && (
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
            Awaiting evidence with confidence intervals
          </div>
        )}

        {/* Footer — domain hint + ratio/SMD reminder */}
        <div
          style={{
            marginTop: "auto",
            paddingLeft: 4,
            display: "flex",
            justifyContent: "space-between",
            color: "#94A3B8",
            fontSize: 9.5,
          }}
        >
          <span>
            {isRatio ? "ratio metric" : "standardized effect"} · ref line at{" "}
            {referenceValue}
          </span>
          {findings.length > 0 && (
            <span>
              {formatEffect(domain.min, isRatio)} →{" "}
              {formatEffect(domain.max, isRatio)}
            </span>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
