"use client";

// ── Proposal snapshot shape (Phase 2E · PR 4) ──
//
// Forked card that appears to the side of an entity when a
// `proposal_ready` event fires with that entity as its target.
// Implements the "tree of roots forking out to both sides" vision
// — strategy / experiment / variant proposals literally branch off
// their source entity as live cards showing title + headline +
// distribution (p10/p50/p90).
//
// Painted by pipeline-event-painter in response to proposal_ready
// events carrying a `targetEntityId` that already has a ghost on
// the canvas. Alternates left / right side per proposal so the
// layout stays balanced.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Sparkles, TrendingUp, FlaskConical, GitBranch } from "lucide-react";
import type { ProposalSnapshotShape } from "./types";
import { AXIS_CATALOG } from "@/lib/probability-space/axis-catalog";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

const KIND_META: Record<
  ProposalSnapshotShape["props"]["kind"],
  {
    label: string;
    icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
    accent: string;
  }
> = {
  strategy: { label: "Strategy", icon: TrendingUp, accent: "#D97706" },
  experiment: { label: "Experiment", icon: FlaskConical, accent: "#0891B2" },
  variant: { label: "Variant", icon: GitBranch, accent: "#8B5CF6" },
};

export class ProposalSnapshotShapeUtil extends BaseBoxShapeUtil<ProposalSnapshotShape> {
  static override type = "proposal-snapshot" as const;
  static override props: RecordProps<ProposalSnapshotShape> = {
    w: T.number,
    h: T.number,
    proposalId: T.string,
    kind: T.literalEnum("strategy", "experiment", "variant"),
    title: T.string,
    headline: T.string,
    targetEntityId: T.string.nullable(),
    p10: T.number.nullable(),
    p50: T.number.nullable(),
    p90: T.number.nullable(),
    accent: T.string,
    axesUsed: T.arrayOf(T.string),
  };

  override getDefaultProps(): ProposalSnapshotShape["props"] {
    return {
      w: 260,
      h: 140,
      proposalId: "",
      kind: "strategy",
      title: "Proposal",
      headline: "",
      targetEntityId: null,
      p10: null,
      p50: null,
      p90: null,
      accent: "#D97706",
      axesUsed: [],
    };
  }

  override canResize = () => true;
  override onResize = (
    shape: ProposalSnapshotShape,
    info: TLResizeInfo<ProposalSnapshotShape>,
  ) => resizeBox(shape, info);

  override component(shape: ProposalSnapshotShape) {
    const { kind, title, headline, p10, p50, p90, accent, axesUsed } = shape.props;
    const meta = KIND_META[kind];
    const Icon = meta.icon;
    const hasDistribution =
      typeof p10 === "number" &&
      typeof p50 === "number" &&
      typeof p90 === "number";
    // PR 5 — filter to known axes (catalog lookup). Unknown strings
    // get silently dropped rather than crashing the shape render.
    const validAxes = (axesUsed ?? []).filter(
      (a): a is ProbabilitySpaceAxis => a in AXIS_CATALOG,
    );

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
        }}
      >
        <div
          className="proposal-snapshot-enter"
          style={{
            width: "100%",
            height: "100%",
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(12px) saturate(1.4)",
            WebkitBackdropFilter: "blur(12px) saturate(1.4)",
            border: `1px solid color-mix(in srgb, ${accent} 20%, rgba(15, 23, 42, 0.06))`,
            borderRadius: 14,
            boxShadow: `0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 20px -12px color-mix(in srgb, ${accent} 40%, transparent), inset 0 1px 0 0 rgba(255, 255, 255, 0.85)`,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          {/* Top accent rail with subtle shine */}
          <div style={{ height: 3, background: accent, opacity: 0.88 }} />

          {/* Header: icon tile + kind badge + title */}
          <div style={{ padding: "10px 12px 6px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={11} strokeWidth={1.9} color={accent} />
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: accent,
                }}
              >
                {meta.label}
              </span>
              <Sparkles
                size={9}
                strokeWidth={2}
                color={accent}
                style={{ marginLeft: "auto", opacity: 0.6 }}
              />
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#0f172a",
                lineHeight: 1.25,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
              title={title}
            >
              {title}
            </div>
          </div>

          {/* Headline */}
          {headline && (
            <div
              style={{
                padding: "2px 12px 6px",
                fontSize: 11,
                fontWeight: 400,
                color: "rgba(15,23,42,0.62)",
                lineHeight: 1.4,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
              title={headline}
            >
              {headline}
            </div>
          )}

          {/* PR 5 — axis provenance strip. Shows which probability-space
              lenses contributed supporting entities to this proposal.
              Each chip uses that axis's canonical accent so the color
              codes align with the shells upstream on the rail. When no
              axes resolved, the strip is hidden entirely rather than
              showing "0 lenses" (which would be misleading — an empty
              list could mean no coverage OR a legacy-run event from
              before the resolver existed). */}
          {validAxes.length > 0 && (
            <div
              style={{
                padding: "0 12px 6px",
                display: "flex",
                flexWrap: "wrap",
                gap: 3,
                alignItems: "center",
              }}
              title={`Supported by ${validAxes.length} lens${validAxes.length === 1 ? "" : "es"}: ${validAxes
                .map((a) => AXIS_CATALOG[a].label)
                .join(", ")}`}
            >
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(15,23,42,0.4)",
                  marginRight: 2,
                }}
              >
                lenses
              </span>
              {validAxes.slice(0, 5).map((axis) => {
                const axisMeta = AXIS_CATALOG[axis];
                return (
                  <span
                    key={axis}
                    style={{
                      fontSize: 8.5,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: `color-mix(in srgb, ${axisMeta.accent} 12%, transparent)`,
                      color: axisMeta.accent,
                      border: `1px solid color-mix(in srgb, ${axisMeta.accent} 25%, transparent)`,
                    }}
                  >
                    {axisMeta.label}
                  </span>
                );
              })}
              {validAxes.length > 5 && (
                <span
                  style={{
                    fontSize: 8.5,
                    color: "rgba(15,23,42,0.45)",
                  }}
                >
                  +{validAxes.length - 5}
                </span>
              )}
            </div>
          )}

          {/* Distribution band — p10 / p50 / p90 */}
          {hasDistribution && (
            <div
              style={{
                marginTop: "auto",
                padding: "8px 12px 10px",
                borderTop: "1px solid rgba(15,23,42,0.05)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(15,23,42,0.45)",
                  marginBottom: 5,
                }}
              >
                <span>p10–p90</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: accent,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p50 !== null && p50.toFixed(2)}
                </span>
              </div>
              {/* Horizontal distribution visualization:
                  outer rail = p10→p90 band, inner tick = p50 */}
              <DistributionBar
                p10={p10 as number}
                p50={p50 as number}
                p90={p90 as number}
                accent={accent}
              />
            </div>
          )}
        </div>
        <style jsx>{`
          .proposal-snapshot-enter {
            animation: proposal-fade-in 420ms cubic-bezier(0.25, 0.8, 0.25, 1)
              both;
          }
          @keyframes proposal-fade-in {
            from {
              opacity: 0;
              transform: scale(0.92) translateY(-4px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }
        `}</style>
      </HTMLContainer>
    );
  }

  override indicator(shape: ProposalSnapshotShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
    );
  }
}

// ── Distribution bar ──
//
// Renders the p10–p90 band as a horizontal track with a p50 marker.
// Values can be any numeric range (not just 0–1) so we normalize
// relative to the band itself, not absolute. This keeps the visual
// meaningful regardless of the metric's units.

function DistributionBar({
  p10,
  p50,
  p90,
  accent,
}: {
  p10: number;
  p50: number;
  p90: number;
  accent: string;
}) {
  // Guard against pathological inputs (p10 == p90, or p50 outside
  // the band). Clamp p50 to band edges if it's outside.
  const bandWidth = Math.max(0.0001, p90 - p10);
  const p50Pct = Math.max(0, Math.min(100, ((p50 - p10) / bandWidth) * 100));
  return (
    <div
      style={{
        position: "relative",
        height: 6,
        background: "rgba(15, 23, 42, 0.06)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      {/* Full band gradient from accent-14% at p10 to accent-solid at p90 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 28%, transparent), ${accent})`,
          borderRadius: 3,
        }}
      />
      {/* p50 tick — vertical marker at median position */}
      <div
        style={{
          position: "absolute",
          top: -2,
          left: `calc(${p50Pct}% - 1px)`,
          width: 2,
          height: 10,
          background: "#0f172a",
          borderRadius: 1,
        }}
        aria-label={`p50 = ${p50.toFixed(2)}`}
      />
      {/* Labels — small p10 / p90 values at the ends */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 0,
          fontSize: 8.5,
          fontWeight: 600,
          color: "rgba(15,23,42,0.5)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {p10.toFixed(2)}
      </div>
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 0,
          fontSize: 8.5,
          fontWeight: 600,
          color: "rgba(15,23,42,0.5)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {p90.toFixed(2)}
      </div>
    </div>
  );
}
