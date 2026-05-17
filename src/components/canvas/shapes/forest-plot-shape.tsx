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

import { useCallback, useMemo, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { BarChart3, X } from "lucide-react";
import type { ForestPlotShape } from "./types";
import { RigorMark } from "./rigor-mark";
import {
  isAnchoredTier,
  TIER_META,
  type RigorTier,
  type TierCounts,
  emptyTierCounts,
} from "@/lib/evidence/rigor-tier";

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
  /** Phase 0 rigor: classification from /api/spaces/[id]/forest-plot.
   *  Drives per-row RigorMark glyph + dimmed/dashed styling on
   *  drifted (web/legacy) rows. Defaults to "legacy_unsourced" for
   *  historical payloads that predate the field. */
  rigor_tier: RigorTier;
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

const KNOWN_TIERS: ReadonlySet<RigorTier> = new Set<RigorTier>([
  "paper_reviewed",
  "paper_extracted",
  "web_deep_research",
  "web_heuristic",
  "legacy_unsourced",
]);

function safeParseFindings(json: string): ForestFinding[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f): f is Omit<ForestFinding, "rigor_tier"> & { rigor_tier?: unknown } =>
          f &&
          typeof f === "object" &&
          typeof (f as { effect_size?: unknown }).effect_size === "number" &&
          typeof (f as { ci_lower?: unknown }).ci_lower === "number" &&
          typeof (f as { ci_upper?: unknown }).ci_upper === "number" &&
          typeof (f as { label?: unknown }).label === "string",
      )
      .map((f): ForestFinding => {
        const rawTier =
          typeof f.rigor_tier === "string" ? f.rigor_tier : "";
        const tier: RigorTier = KNOWN_TIERS.has(rawTier as RigorTier)
          ? (rawTier as RigorTier)
          : "legacy_unsourced";
        return { ...f, rigor_tier: tier };
      });
  } catch {
    return [];
  }
}

function safeParseTierCounts(json: string): TierCounts {
  const empty = emptyTierCounts();
  if (!json) return empty;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return empty;
    for (const tier of KNOWN_TIERS) {
      const v = (parsed as Record<string, unknown>)[tier];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        empty[tier] = Math.floor(v);
      }
    }
    return empty;
  } catch {
    return empty;
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
    highlightedFindingIds: T.string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    focusedEdgeLabel: T.any as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tierMode: T.any as any,
    tierCountsJson: T.string,
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
      highlightedFindingIds: "[]",
      focusedEdgeLabel: null,
      tierMode: "anchored",
      tierCountsJson: JSON.stringify(emptyTierCounts()),
    };
  }

  component(shape: ForestPlotShape) {
    return <ForestPlotView shape={shape} />;
  }

  indicator(shape: ForestPlotShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function safeParseHighlightIds(json: string): Set<string> {
  if (!json) return new Set();
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) {
      if (typeof v === "string" && v.length > 0) out.add(v);
    }
    return out;
  } catch {
    return new Set();
  }
}

function ForestPlotView({ shape }: { shape: ForestPlotShape }) {
  const {
    w,
    h,
    findingsJson,
    referenceMetric,
    highlightedFindingIds,
    focusedEdgeLabel,
    tierMode: rawTierMode,
    tierCountsJson,
  } = shape.props;
  const tierMode: "anchored" | "all" =
    rawTierMode === "all" ? "all" : "anchored";

  const [toggling, setToggling] = useState(false);

  const findings = useMemo(
    () => safeParseFindings(findingsJson),
    [findingsJson],
  );
  const tierCounts = useMemo(
    () => safeParseTierCounts(tierCountsJson),
    [tierCountsJson],
  );

  const highlightedIds = useMemo(
    () => safeParseHighlightIds(highlightedFindingIds),
    [highlightedFindingIds],
  );
  const isFocusing = highlightedIds.size > 0;
  const matchedCount = useMemo(
    () => findings.filter((f) => highlightedIds.has(f.id)).length,
    [findings, highlightedIds],
  );

  const isRatio = isRatioMetric(referenceMetric);
  const referenceValue = isRatio ? 1 : 0;

  // Phase 0 rigor: total counts across the eligible pool, used for the
  // toggle copy and footer. Anchored = paper-sourced tiers; drifted =
  // web/legacy tiers.
  const anchoredTotal =
    tierCounts.paper_reviewed + tierCounts.paper_extracted;
  const driftedTotal =
    tierCounts.web_deep_research +
    tierCounts.web_heuristic +
    tierCounts.legacy_unsourced;
  const hasAnyDrifted = driftedTotal > 0;

  // Phase 0 rigor: toggle handler — dispatches a window event so the
  // canvas host can re-fetch the route and rewrite the shape props.
  // Mirrors the same pattern used by the focus chip's clear button.
  // The `toggling` flag is a soft debounce to prevent double-clicks
  // during the in-flight fetch; the listener rewrites findingsJson +
  // tierMode through editor.updateShape, which re-renders this view.
  const handleToggleTier = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (toggling) return;
      const nextMode: "anchored" | "all" =
        tierMode === "anchored" ? "all" : "anchored";
      setToggling(true);
      window.dispatchEvent(
        new CustomEvent("forest-plot:set-tier-mode", {
          detail: { shapeId: shape.id, mode: nextMode },
        }),
      );
      window.setTimeout(() => setToggling(false), 1500);
    },
    [shape.id, tierMode, toggling],
  );

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
        <div
          style={{
            paddingLeft: 4,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div>
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
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {findings.length > 0 ? (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <RigorMark
                      tier={tierMode === "anchored" ? "paper_extracted" : "web_heuristic"}
                      size={11}
                      style={{ color: tierMode === "anchored" ? ACCENT : "#94a3b8" }}
                    />
                    {tierMode === "anchored" ? (
                      <>
                        {anchoredTotal} anchored
                      </>
                    ) : (
                      <>
                        {findings.length} of {anchoredTotal + driftedTotal}
                      </>
                    )}
                  </span>
                  <span style={{ color: "#64748b" }}>
                    · {referenceMetric ?? "mixed"}
                    {referenceMetric && ` · ref @ ${referenceValue}`}
                  </span>
                </>
              ) : (
                <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                  no findings with CIs yet
                </span>
              )}
            </div>
            {/* Phase 0 rigor: tier toggle. Only renders when there are
                drifted rows in the eligible pool — otherwise the toggle
                has no behavior to surface. */}
            {hasAnyDrifted && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleToggleTier}
                disabled={toggling}
                title={
                  tierMode === "anchored"
                    ? `Show all ${anchoredTotal + driftedTotal} findings, including ${driftedTotal} drifted (web / legacy). Drifted rows render dimmed.`
                    : `Hide ${driftedTotal} drifted findings (web / legacy). Show only the ${anchoredTotal} paper-sourced rows.`
                }
                style={{
                  marginTop: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 7px",
                  background:
                    tierMode === "anchored"
                      ? "rgba(15, 118, 110, 0.06)"
                      : "rgba(11, 13, 18, 0.04)",
                  border:
                    tierMode === "anchored"
                      ? `1px solid ${ACCENT}33`
                      : "1px solid rgba(11, 13, 18, 0.12)",
                  borderRadius: 4,
                  fontSize: 9.5,
                  fontWeight: 600,
                  color: tierMode === "anchored" ? ACCENT : "#475569",
                  letterSpacing: "-0.005em",
                  cursor: toggling ? "wait" : "pointer",
                  opacity: toggling ? 0.6 : 1,
                  transition:
                    "background 120ms ease-out, border-color 120ms ease-out",
                }}
                aria-label={
                  tierMode === "anchored"
                    ? "Show all tiers"
                    : "Show anchored tiers only"
                }
              >
                <RigorMark
                  tier={tierMode === "anchored" ? "web_heuristic" : "paper_extracted"}
                  size={9}
                />
                {tierMode === "anchored"
                  ? `Show all · ${anchoredTotal + driftedTotal}`
                  : `Anchored · ${anchoredTotal}`}
              </button>
            )}
          </div>
          {/* Phase E: focus chip — appears when an edge focus is active.
              Shows the focused edge label + matched/total ratio. The "×"
              dispatches a custom event the spawner listens to (so the
              shape stays editor-agnostic). */}
          {isFocusing && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 6px 3px 8px",
                background: "rgba(15, 118, 110, 0.08)",
                border: `1px solid ${ACCENT}55`,
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 600,
                color: ACCENT,
                letterSpacing: "-0.005em",
                whiteSpace: "nowrap",
                maxWidth: 200,
              }}
              title={`Focused on edge: ${focusedEdgeLabel ?? "—"} · ${matchedCount} of ${findings.length} findings match`}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 140,
                }}
              >
                {focusedEdgeLabel ?? "focused"}
                <span style={{ color: "#0F766EAA", marginLeft: 4 }}>
                  {matchedCount}/{findings.length}
                </span>
              </span>
              <button
                type="button"
                aria-label="Clear edge focus"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent("forest-plot:clear-focus", {
                      detail: { shapeId: shape.id },
                    }),
                  );
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 14,
                  height: 14,
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: 3,
                  color: ACCENT,
                  cursor: "pointer",
                }}
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
          )}
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
              // Phase 0 rigor: drifted rows render at 0.62 opacity with
              // a dashed CI bar so the tier downgrade is visible without
              // the user reading the glyph. Truncate one character
              // tighter so the inline RigorMark glyph fits before the
              // label without colliding with the CI plot region.
              const tierAnchored = isAnchoredTier(f.rigor_tier);
              const tierMeta = TIER_META[f.rigor_tier];
              const truncatedLabel =
                f.label.length > 17 ? `${f.label.slice(0, 16)}…` : f.label;
              const readout = `${formatEffect(f.effect_size, isRatio)} [${formatEffect(f.ci_lower, isRatio)}, ${formatEffect(f.ci_upper, isRatio)}]`;
              // Phase E focus styling. Only kicks in when focus is active;
              // baseline (no focus) renders identically to pre-Phase-E.
              const isMatch = highlightedIds.has(f.id);
              const focusDim = isFocusing && !isMatch;
              const tierDim = !tierAnchored;
              // Multiplicative dim: drifted-in-focus rows are extra
              // suppressed, but never below 0.18 (still legible).
              const rowOpacity = Math.max(
                0.18,
                (focusDim ? 0.3 : 1) * (tierDim ? 0.62 : 1),
              );
              const labelFill = focusDim
                ? "#94A3B8"
                : tierDim
                  ? "#64748B"
                  : "#475569";
              // Glyph geometry — two stacked horizontal bars, 7×1.4
              // user-units each, 1.4 gap, vertically centered on the
              // row baseline. Matches the RigorMark React component but
              // inlined into this parent SVG so we don't nest <svg>.
              const glyphX = padLR + 2;
              const glyphTopY = yCenter - 1.7 - 1.4;
              const glyphBotY = yCenter + 1.7 - 1.4;
              const glyphW = 7;
              const glyphH = 1.4;
              const labelX = padLR + 12;
              return (
                <g
                  key={f.id}
                  style={{ pointerEvents: "auto", opacity: rowOpacity }}
                >
                  <title>{`${f.label}: ${readout} · ${tierMeta.label}${
                    f.followup_label ? ` · ${f.followup_label}` : ""
                  }${f.n_total ? ` · n=${f.n_total}` : ""}${
                    focusDim
                      ? " · not in focused edge — click × on focus chip to clear"
                      : ""
                  }`}</title>
                  {/* Highlight rail — 2px teal vertical bar at the left
                      edge of the label column for matched rows. Aligns
                      with the drawer's EdgeRow rail pattern for visual
                      consistency across the two surfaces. */}
                  {isFocusing && isMatch && (
                    <line
                      x1={padLR}
                      x2={padLR}
                      y1={yCenter - rowH / 2 + 2}
                      y2={yCenter + rowH / 2 - 2}
                      stroke={ACCENT}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  )}
                  {/* Phase 0 rigor glyph — paired horizontal bars.
                      Anchored = filled; drifted = hairline outline. */}
                  {tierAnchored ? (
                    <>
                      <rect
                        x={glyphX}
                        y={glyphTopY}
                        width={glyphW}
                        height={glyphH}
                        rx={0.4}
                        fill={labelFill}
                      />
                      <rect
                        x={glyphX}
                        y={glyphBotY}
                        width={glyphW}
                        height={glyphH}
                        rx={0.4}
                        fill={labelFill}
                      />
                    </>
                  ) : (
                    <>
                      <rect
                        x={glyphX}
                        y={glyphTopY}
                        width={glyphW}
                        height={glyphH}
                        rx={0.4}
                        fill="none"
                        stroke={labelFill}
                        strokeWidth={0.6}
                      />
                      <rect
                        x={glyphX}
                        y={glyphBotY}
                        width={glyphW}
                        height={glyphH}
                        rx={0.4}
                        fill="none"
                        stroke={labelFill}
                        strokeWidth={0.6}
                      />
                    </>
                  )}
                  {/* Label */}
                  <text
                    x={labelX}
                    y={yCenter}
                    fontSize={10}
                    fill={labelFill}
                    fontWeight={isFocusing && isMatch ? 600 : 400}
                    dominantBaseline="middle"
                  >
                    {truncatedLabel}
                  </text>
                  {/* CI bar — solid for anchored rows, dashed for drifted */}
                  <line
                    x1={xLow}
                    x2={xHigh}
                    y1={yCenter}
                    y2={yCenter}
                    stroke={barColor}
                    strokeWidth={1.5}
                    strokeOpacity={0.55}
                    strokeDasharray={tierDim ? "2 2" : undefined}
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
                    fill={labelFill}
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

        {/* Footer — tier breakdown + ratio/SMD reminder */}
        <div
          style={{
            marginTop: "auto",
            paddingLeft: 4,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            color: "#94A3B8",
            fontSize: 9.5,
          }}
        >
          {/* Phase 0 rigor: tier breakdown of the eligible pool. Always
              reports the full population (independent of active filter)
              so the user can see what's being hidden. Falls back to the
              old metric hint when there are zero rows in the pool. */}
          {anchoredTotal + driftedTotal > 0 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
              title="Per-tier breakdown of the eligible pool. Drifted = web-research or legacy / unsourced rows."
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  color: anchoredTotal > 0 ? ACCENT : "#94A3B8",
                }}
              >
                <RigorMark
                  tier="paper_extracted"
                  size={9}
                  style={{ opacity: anchoredTotal > 0 ? 1 : 0.4 }}
                />
                {anchoredTotal} anchored
              </span>
              {driftedTotal > 0 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    color: "#94A3B8",
                  }}
                >
                  <RigorMark tier="web_heuristic" size={9} />
                  {driftedTotal} drifted
                </span>
              )}
            </span>
          ) : (
            <span>
              {isRatio ? "ratio metric" : "standardized effect"} · ref line at{" "}
              {referenceValue}
            </span>
          )}
          {findings.length > 0 && (
            <span style={{ whiteSpace: "nowrap" }}>
              {formatEffect(domain.min, isRatio)} →{" "}
              {formatEffect(domain.max, isRatio)}
            </span>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
