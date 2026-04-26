"use client";

// ── Synthesis intersection card ──
//
// THE final-ranking anchor on the canvas. Sits below the row of
// probability-space-shells (per-axis landscapes) and shows entities
// ranked by cross-axis convergence — the "intersection" geometry
// that closes the unfurl: prompt → axis landscapes → intersection →
// proposals.
//
// This card replaces the prior architecture where proposals forked
// off individual entity ghosts on a global canvas. Instead, all
// proposals (snapshot + chain ribbon + experiment-design) anchor
// here, and this card carries the cross-axis composite score that
// motivated each one.
//
// Data lifecycle:
//   1. Painter creates the card in "computing" state when the first
//      proposal_ready event arrives (axes have settled by then).
//   2. Painter computes top entities by cross-axis convergence from
//      its `spaceShellState` map, packs into `rowsJson`, flips
//      isComputing → false.
//   3. Each subsequent proposal_ready bumps `appsProposedCount`.
//
// Run-scoped — cleared with the rest of the painter's overlay.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Network, Sparkles } from "lucide-react";
import type { SynthesisIntersectionCardShape } from "./types";
import { useCanvasFilter } from "../hooks/use-canvas-filter";

export const SYNTHESIS_DEFAULT_W = 540;
export const SYNTHESIS_DEFAULT_H = 320;

export interface SynthesisRow {
  entityId: string;
  name: string;
  compositeScore: number;
  convergenceCount: number;
  axes: Array<{ axis: string; accent: string; weight: number }>;
}

export class SynthesisIntersectionCardShapeUtil extends BaseBoxShapeUtil<SynthesisIntersectionCardShape> {
  static override type = "synthesis-intersection-card" as const;
  static override props: RecordProps<SynthesisIntersectionCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    title: T.string,
    totalAxes: T.number,
    rowsJson: T.string,
    appsProposedCount: T.number,
    isComputing: T.boolean,
    accent: T.string,
    version: T.number,
  };

  override getDefaultProps(): SynthesisIntersectionCardShape["props"] {
    return {
      w: SYNTHESIS_DEFAULT_W,
      h: SYNTHESIS_DEFAULT_H,
      spaceId: "",
      title: "Synthesis · final ranking",
      totalAxes: 0,
      rowsJson: "[]",
      appsProposedCount: 0,
      isComputing: true,
      accent: "#7C3AED",
      version: 0,
    };
  }

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: SynthesisIntersectionCardShape,
    info: TLResizeInfo<SynthesisIntersectionCardShape>,
  ) => resizeBox(shape, info);

  override component(shape: SynthesisIntersectionCardShape) {
    const {
      w,
      h,
      title,
      totalAxes,
      rowsJson,
      appsProposedCount,
      isComputing,
      accent,
    } = shape.props;

    let rows: SynthesisRow[] = [];
    try {
      const parsed = JSON.parse(rowsJson) as unknown;
      if (Array.isArray(parsed)) {
        rows = parsed.filter(
          (r): r is SynthesisRow =>
            !!r &&
            typeof r === "object" &&
            typeof (r as SynthesisRow).name === "string",
        );
      }
    } catch {
      /* malformed json — render empty */
    }

    const visibleRows = rows.slice(0, 6);
    const overflow = Math.max(0, rows.length - visibleRows.length);
    const maxScore = Math.max(0.001, ...rows.map((r) => r.compositeScore));

    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          pointerEvents: "all",
        }}
      >
        <div
          className="synthesis-card-enter"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 16,
            overflow: "hidden",
            background: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(16px) saturate(1.3)",
            WebkitBackdropFilter: "blur(16px) saturate(1.3)",
            border: `1px solid color-mix(in srgb, ${accent} 22%, rgba(15,23,42,0.06))`,
            boxShadow: `0 1px 2px rgba(15,23,42,0.04), 0 16px 36px -16px color-mix(in srgb, ${accent} 45%, transparent)`,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: "#0f172a",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 14px 10px",
              borderBottom: "1px solid rgba(15,23,42,0.06)",
              background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 6%, transparent) 0%, transparent 100%)`,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Network size={14} color={accent} strokeWidth={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 8.5,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  color: accent,
                  textTransform: "uppercase",
                }}
              >
                synthesis
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#0f172a",
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={title}
              >
                {title}
              </div>
            </div>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "rgba(15,23,42,0.5)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {totalAxes > 0 ? `${totalAxes} axes` : "—"}
            </div>
          </div>

          {/* Body */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              padding: "8px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {isComputing && rows.length === 0 ? (
              <ComputingSkeleton accent={accent} />
            ) : rows.length === 0 ? (
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(15,23,42,0.45)",
                  fontStyle: "italic",
                  padding: "12px 0",
                }}
              >
                no cross-axis convergence resolved
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "20px 1fr 56px 80px",
                    gap: 8,
                    padding: "0 4px 4px",
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "rgba(15,23,42,0.4)",
                  }}
                >
                  <span>#</span>
                  <span>entity</span>
                  <span style={{ textAlign: "right" }}>score</span>
                  <span>axes</span>
                </div>
                {visibleRows.map((row, i) => (
                  <SynthesisRowView
                    key={row.entityId}
                    row={row}
                    rank={i + 1}
                    relativeWidth={row.compositeScore / maxScore}
                  />
                ))}
                {overflow > 0 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "rgba(15,23,42,0.45)",
                      fontStyle: "italic",
                      padding: "4px 4px 0",
                    }}
                  >
                    +{overflow} more entity{overflow === 1 ? "" : "s"} below
                    threshold
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              borderTop: "1px solid rgba(15,23,42,0.06)",
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(15,23,42,0.02)",
            }}
          >
            <Sparkles size={11} color={accent} strokeWidth={2.2} />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(15,23,42,0.6)",
              }}
            >
              proposals materialized
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                fontWeight: 800,
                color: accent,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {appsProposedCount}
            </span>
          </div>
        </div>
        <style jsx>{`
          .synthesis-card-enter {
            animation: synthesis-fade-in 600ms cubic-bezier(0.25, 0.8, 0.25, 1)
              both;
          }
          @keyframes synthesis-fade-in {
            from {
              opacity: 0;
              transform: translateY(10px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>
      </HTMLContainer>
    );
  }

  override indicator(shape: SynthesisIntersectionCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />
    );
  }
}

function SynthesisRowView({
  row,
  rank,
  relativeWidth,
}: {
  row: SynthesisRow;
  rank: number;
  relativeWidth: number;
}) {
  const visibleAxes = row.axes.slice(0, 4);
  const overflow = Math.max(0, row.axes.length - visibleAxes.length);
  // Phase 3 — sidebar filter. Dim rows whose axes don't intersect
  // the user-selected axis set. Empty selection = no dimming.
  const selectedAxes = useCanvasFilter((s) => s.selectedAxes);
  const dim =
    selectedAxes.size > 0 &&
    !row.axes.some((a) => selectedAxes.has(a.axis));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr 56px 80px",
        gap: 8,
        alignItems: "center",
        padding: "5px 4px",
        borderRadius: 6,
        position: "relative",
        background: "rgba(15,23,42,0.02)",
        opacity: dim ? 0.32 : 1,
        transition: "opacity 240ms ease",
      }}
    >
      {/* Background score bar */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.max(8, Math.round(relativeWidth * 100))}%`,
          background: "rgba(124, 58, 237, 0.06)",
          borderRadius: 6,
          pointerEvents: "none",
        }}
      />
      {/* Rank */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "rgba(15,23,42,0.45)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: "tabular-nums",
          position: "relative",
          zIndex: 1,
        }}
      >
        {rank}
      </span>
      {/* Name */}
      <span
        title={row.name}
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: "#0f172a",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          position: "relative",
          zIndex: 1,
        }}
      >
        {row.name}
      </span>
      {/* Score */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#0f172a",
          textAlign: "right",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: "tabular-nums",
          position: "relative",
          zIndex: 1,
        }}
      >
        {Math.round(row.compositeScore * 100)}
      </span>
      {/* Axis dots */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          position: "relative",
          zIndex: 1,
        }}
      >
        {visibleAxes.map((a, i) => (
          <span
            key={`${i}-${a.axis}`}
            title={`${a.axis} (weight ${a.weight.toFixed(2)})`}
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: a.accent,
              flexShrink: 0,
              opacity: 0.4 + 0.6 * Math.min(1, a.weight),
            }}
          />
        ))}
        {overflow > 0 && (
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 700,
              color: "rgba(15,23,42,0.45)",
              marginLeft: 2,
            }}
          >
            +{overflow}
          </span>
        )}
        <span
          style={{
            marginLeft: 4,
            fontSize: 8.5,
            fontWeight: 700,
            color: "rgba(15,23,42,0.5)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ×{row.convergenceCount}
        </span>
      </div>
    </div>
  );
}

function ComputingSkeleton({ accent }: { accent: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 4px",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        ✦ computing intersection…
      </span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="synth-skeleton-shimmer"
          style={{
            height: 18,
            borderRadius: 4,
            background:
              "linear-gradient(90deg, rgba(15,23,42,0.04) 0%, rgba(15,23,42,0.08) 50%, rgba(15,23,42,0.04) 100%)",
            backgroundSize: "200% 100%",
            opacity: 1 - i * 0.18,
          }}
        />
      ))}
      <style jsx>{`
        .synth-skeleton-shimmer {
          animation: synth-shimmer 1.6s linear infinite;
        }
        @keyframes synth-shimmer {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}
