"use client";

// ── Strategy objective card shape ─────────────────────────────────────
//
// One CascadeObjective dragged out of the strategy drawer onto the
// canvas. Visual mirrors the in-drawer card head: title, progress bar,
// progress %, lead/lag tag, perspective accent. Compact 280×96 fits
// alongside other cards without dominating the canvas.
//
// Drag source: src/components/strategy/v2/cascade/cascade-objective.tsx
// MIME + payload: src/components/canvas/strategy-objective-drag.ts
// Drop dispatcher: src/components/canvas/interaxis-canvas.tsx (handleDrop)

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import type { StrategyObjectiveCardShape } from "./types";

const COMPACT_W = 280;
const COMPACT_H = 96;

const PALETTE_ACCENT: Record<string, string> = {
  finance: "#10b981",
  customers: "#0ea5e9",
  internal: "#0d9488",
  learning: "#a855f7",
};

const PALETTE_TINT: Record<string, string> = {
  finance: "rgba(16,185,129,0.10)",
  customers: "rgba(14,165,233,0.10)",
  internal: "rgba(13,148,136,0.10)",
  learning: "rgba(168,85,247,0.10)",
};

function paletteAccent(key: string): string {
  return PALETTE_ACCENT[key] ?? "#6366f1";
}

function paletteTint(key: string): string {
  return PALETTE_TINT[key] ?? "rgba(99,102,241,0.10)";
}

export class StrategyObjectiveShapeUtil extends BaseBoxShapeUtil<StrategyObjectiveCardShape> {
  static override type = "strategy-objective-card" as const;
  static override props: RecordProps<StrategyObjectiveCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    objectiveId: T.string,
    title: T.string,
    description: T.nullable(T.string),
    progressPct: T.number,
    tag: T.literalEnum("lead", "lag"),
    valueLabel: T.nullable(T.string),
    paletteKey: T.literalEnum("finance", "customers", "internal", "learning"),
    perspectiveLabel: T.string,
    pinnedAt: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: StrategyObjectiveCardShape,
    info: TLResizeInfo<StrategyObjectiveCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): StrategyObjectiveCardShape["props"] {
    return {
      w: COMPACT_W,
      h: COMPACT_H,
      spaceId: "",
      objectiveId: "",
      title: "Objective",
      description: null,
      progressPct: 0,
      tag: "lead",
      valueLabel: null,
      paletteKey: "internal",
      perspectiveLabel: "Internal",
      pinnedAt: new Date().toISOString(),
    };
  }

  component(shape: StrategyObjectiveCardShape) {
    const accent = paletteAccent(shape.props.paletteKey);
    const tint = paletteTint(shape.props.paletteKey);
    const tagBg =
      shape.props.tag === "lead"
        ? "rgba(99,102,241,0.10)"
        : "rgba(251,191,36,0.14)";
    const tagColor = shape.props.tag === "lead" ? "#4338ca" : "#B45309";
    const tagBorder =
      shape.props.tag === "lead"
        ? "1px solid rgba(99,102,241,0.25)"
        : "1px solid rgba(251,191,36,0.32)";

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
        }}
      >
        <div
          role="button"
          aria-label={`Strategy objective: ${shape.props.title}`}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 10,
            background: "#fff",
            border: `1px solid color-mix(in srgb, ${accent} 24%, rgba(15,23,42,0.06))`,
            boxShadow: `0 1px 2px rgba(15,23,42,0.04), 0 8px 18px -10px ${accent}33`,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontFamily:
              '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
            overflow: "hidden",
          }}
        >
          {/* Accent bar (left) */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              background: accent,
              borderTopLeftRadius: 10,
              borderBottomLeftRadius: 10,
            }}
          />

          {/* Header row: perspective label + tag + progress % */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                padding: "1.5px 6px",
                borderRadius: 5,
                background: tint,
                color: accent,
              }}
            >
              {shape.props.perspectiveLabel}
            </span>
            <span
              style={{
                padding: "1.5px 6px",
                borderRadius: 5,
                background: tagBg,
                color: tagColor,
                border: tagBorder,
              }}
            >
              {shape.props.tag}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontVariantNumeric: "tabular-nums",
                color: "#0B0D12",
                letterSpacing: "-0.01em",
                fontSize: 11,
              }}
            >
              {Math.round(shape.props.progressPct)}%
            </span>
          </div>

          {/* Title */}
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.3,
              color: "#0B0D12",
              letterSpacing: "-0.005em",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {shape.props.title}
          </p>

          {/* Progress bar */}
          <div
            style={{
              height: 3,
              borderRadius: 999,
              background: "rgba(11,13,18,0.06)",
              position: "relative",
              overflow: "hidden",
              marginTop: "auto",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.max(0, Math.min(100, shape.props.progressPct))}%`,
                background: accent,
                borderRadius: 999,
              }}
            />
          </div>

          {shape.props.valueLabel && (
            <p
              style={{
                margin: 0,
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", monospace',
                fontSize: 9.5,
                color: "rgba(11,13,18,0.48)",
                fontWeight: 500,
              }}
            >
              {shape.props.valueLabel}
            </p>
          )}
        </div>
      </HTMLContainer>
    );
  }

  indicator(shape: StrategyObjectiveCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />
    );
  }
}

export {
  COMPACT_W as STRATEGY_OBJECTIVE_COMPACT_W,
  COMPACT_H as STRATEGY_OBJECTIVE_COMPACT_H,
};
