"use client";

// ── LayerBandShapeUtil ──
//
// A wide, translucent horizontal band behind the unfurl — one per
// ObjectiveStack layer (ordinal 1 substrate → N outcome). Sub-objective
// cards sit on top of their layer's band. Purely a backdrop: clicks pass
// through (pointerEvents none) so the cards on top stay interactive.
// Self-contained, no app context.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";

export type LayerBandShape = TLBaseShape<
  "layer-band",
  {
    w: number;
    h: number;
    ordinal: number;
    name: string;
    archetype: string;
    /** No sub-objective sits in this layer → pulsing "open lane" hint. */
    uncovered: boolean;
    accent: string;
  }
>;

/** Archetype → accent, so each band reads as its role at a glance. */
const ARCHETYPE_COLOR: Record<string, string> = {
  substrate: "#64748B",
  mechanism: "#7C3AED",
  process: "#2563EB",
  output: "#0891B2",
  outcome: "#059669",
};

export function bandAccentFor(archetype: string): string {
  return ARCHETYPE_COLOR[archetype] ?? "#7C3AED";
}

export class LayerBandShapeUtil extends BaseBoxShapeUtil<LayerBandShape> {
  static override type = "layer-band" as const;
  static override props: RecordProps<LayerBandShape> = {
    w: T.number,
    h: T.number,
    ordinal: T.number,
    name: T.string,
    archetype: T.string,
    uncovered: T.boolean,
    accent: T.string,
  };

  override canResize = () => false;
  override canEdit = () => false;
  // Backdrop: not bindable, and clicks pass through to cards on top.
  override canBind = () => false;
  override hideRotateHandle = () => true;

  getDefaultProps(): LayerBandShape["props"] {
    return {
      w: 1280,
      h: 220,
      ordinal: 1,
      name: "Layer",
      archetype: "mechanism",
      uncovered: false,
      accent: "#7C3AED",
    };
  }

  component(shape: LayerBandShape) {
    const { ordinal, name, archetype, uncovered, accent } = shape.props;
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          // Backdrop — let clicks reach the cards rendered on top.
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 22,
            background: uncovered
              ? `repeating-linear-gradient(135deg, ${accent}08, ${accent}08 10px, transparent 10px, transparent 20px)`
              : `linear-gradient(180deg, ${accent}0E 0%, ${accent}06 100%)`,
            border: uncovered
              ? `1.5px dashed ${accent}55`
              : `1px solid ${accent}24`,
            overflow: "hidden",
            fontFamily:
              '-apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
          }}
        >
          {/* Layer label — top-left eyebrow. */}
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                display: "inline-grid",
                placeItems: "center",
                minWidth: 26,
                height: 20,
                padding: "0 7px",
                borderRadius: 7,
                background: accent,
                color: "white",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              L{ordinal}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 650,
                color: "#0B1228",
                letterSpacing: "-0.01em",
              }}
            >
              {name}
            </span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: accent,
                opacity: 0.8,
              }}
            >
              {archetype}
            </span>
          </div>

          {uncovered && (
            <div
              style={{
                position: "absolute",
                bottom: 12,
                left: 16,
                fontSize: 11,
                fontWeight: 500,
                color: `${accent}`,
                opacity: 0.7,
              }}
            >
              No bet here yet — an open lane to fill.
            </div>
          )}
        </div>
      </HTMLContainer>
    );
  }

  indicator(shape: LayerBandShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={22} ry={22} />;
  }
}
