"use client";

// ── Variant card shape (VP Project report — Phase 3, Batch 2e) ─────
//
// A ghost flashcard the pipeline-event-painter drops when the writer-
// path's variant_factory emits `variant_proposed`. Sits below the
// taxonomy card and fans out as additional variants land. Intentionally
// compact — the rich, interactive version lives in the VariantCarousel
// widget on the App detail page; this ghost is just "the pipeline is
// materializing variants and here's what they are" feedback.
//
// Not persisted in tldraw — the painter's run-scoped tracker cleans
// these up on completion alongside the other ghosts. The canonical
// row is in `experiment_variants`.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import type { VariantCardShape } from "./types";

const DEFAULT_W = 260;
const DEFAULT_H = 148;

export class VariantCardShapeUtil extends BaseBoxShapeUtil<VariantCardShape> {
  static override type = "variant-card" as const;
  static override props: RecordProps<VariantCardShape> = {
    w: T.number,
    h: T.number,
    variantId: T.string,
    spaceId: T.string,
    appId: T.string.nullable(),
    label: T.string,
    status: T.string,
    summary: T.string.nullable(),
    shortId: T.string.nullable(),
    situationKey: T.string.nullable(),
    aggregateQuality: T.number.nullable(),
    aggregateLift: T.number.nullable(),
    accent: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: VariantCardShape,
    info: TLResizeInfo<VariantCardShape>,
  ) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): VariantCardShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      variantId: "",
      spaceId: "",
      appId: null,
      label: "Variant",
      status: "proposed",
      summary: null,
      shortId: null,
      situationKey: null,
      aggregateQuality: null,
      aggregateLift: null,
      accent: "#8B5CF6",
    };
  }

  component(shape: VariantCardShape) {
    return <VariantCardView shape={shape} />;
  }

  indicator(shape: VariantCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function formatQuality(q: number | null): string {
  if (q == null) return "—";
  return `${Math.round(q * 100)}`;
}

function formatLift(l: number | null): { label: string; color: string } {
  if (l == null) return { label: "—", color: "#94a3b8" };
  const pct = Math.round(l * 100);
  if (pct > 0) return { label: `+${pct}%`, color: "#10b981" };
  if (pct < 0) return { label: `${pct}%`, color: "#ef4444" };
  return { label: "0%", color: "#64748b" };
}

function VariantCardView({ shape }: { shape: VariantCardShape }) {
  const {
    w,
    h,
    label,
    status,
    summary,
    shortId,
    situationKey,
    aggregateQuality,
    aggregateLift,
    accent,
  } = shape.props;

  const lift = formatLift(aggregateLift);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 14,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,249,253,0.96) 100%)",
          border: "1px solid rgba(15, 40, 90, 0.08)",
          boxShadow:
            "0 14px 40px -16px rgba(15, 40, 90, 0.22), 0 3px 12px rgba(15, 40, 90, 0.05)",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Accent bar on the left — seeded from taxonomy palette */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: accent,
          }}
        />

        <div
          style={{
            padding: "11px 14px 10px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flex: 1,
          }}
        >
          {/* Header row: shortId + status pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              {shortId ?? "V-?"}
            </span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "2px 7px",
                borderRadius: 99,
                background: `${accent}18`,
                color: accent,
                border: `1px solid ${accent}33`,
              }}
            >
              {status}
            </span>
          </div>

          {/* Label */}
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              lineHeight: 1.25,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {label}
          </div>

          {/* Situation */}
          {situationKey && (
            <div
              style={{
                fontSize: 10,
                color: "#64748b",
                fontStyle: "italic",
              }}
            >
              for {situationKey}
            </div>
          )}

          {/* Summary preview */}
          {summary && (
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                color: "#475569",
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {summary}
            </div>
          )}

          {/* Footer row — aggregate quality + lift */}
          <div
            style={{
              marginTop: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingTop: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#0a1020",
                  letterSpacing: "-0.02em",
                }}
              >
                {formatQuality(aggregateQuality)}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "#94a3b8",
                }}
              >
                quality
              </span>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: lift.color,
                fontFeatureSettings: '"tnum"',
              }}
            >
              {lift.label}
            </span>
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}
