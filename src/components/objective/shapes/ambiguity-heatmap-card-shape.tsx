"use client";

// ── AmbiguityHeatmapCardShape ──
//
// Square card that forks out of the prompt-sharpening card on user request.
// Pulls the same 10-zone heatmap the sharpening card shows internally and
// renders it as its own standalone surface, so the user can lay the heatmap
// next to other thinking on the board. Each zone tile remains tap-to-fork —
// the resulting insight-card is connected back to THIS card (not the
// sharpening card) by the bezier overlay, so the lineage is visible.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useState } from "react";
import { appleVibe, withAlpha } from "@/lib/apple-vibe-tokens";
import { forkAmbiguity } from "@/components/objective/board-bus";
import { ZONE_LABEL, SHARPEN_COLOR } from "./prompt-sharpening-card-shape";

const CARD_SIZE = 340; // square

const SEV_COLOR: Record<string, string> = {
  high: "#EF4444",
  medium: "#F59E0B",
  low: "#94A3B8",
};

interface HeatZone {
  severity?: string;
  ambiguity?: string;
  question_to_resolve?: string;
}

export type AmbiguityHeatmapCardShape = TLBaseShape<
  "ambiguity-heatmap-card",
  {
    w: number;
    h: number;
    /** Sharpening card this heatmap forked off — for upstream lineage. */
    sourceId: string;
    spaceId: string;
    /** ambiguity_heatmap, JSON-encoded (10 zones) — mirrors the sharpening card. */
    heatmapJson: string;
    color: string;
  }
>;

export class AmbiguityHeatmapCardShapeUtil extends BaseBoxShapeUtil<AmbiguityHeatmapCardShape> {
  static override type = "ambiguity-heatmap-card" as const;
  static override props: RecordProps<AmbiguityHeatmapCardShape> = {
    w: T.number,
    h: T.number,
    sourceId: T.string,
    spaceId: T.string,
    heatmapJson: T.string,
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: AmbiguityHeatmapCardShape,
    info: TLResizeInfo<AmbiguityHeatmapCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): AmbiguityHeatmapCardShape["props"] {
    return {
      w: CARD_SIZE,
      h: CARD_SIZE,
      sourceId: "",
      spaceId: "",
      heatmapJson: "{}",
      color: SHARPEN_COLOR,
    };
  }

  component(shape: AmbiguityHeatmapCardShape) {
    return <AmbiguityHeatmapRenderer shape={shape} />;
  }

  indicator(shape: AmbiguityHeatmapCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function parseHeatmap(json: string): Record<string, HeatZone> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, HeatZone>) : {};
  } catch {
    return {};
  }
}

function AmbiguityHeatmapRenderer({ shape }: { shape: AmbiguityHeatmapCardShape }) {
  const { color, sourceId } = shape.props;
  const heatmap = parseHeatmap(shape.props.heatmapJson);
  const keys = Object.keys(ZONE_LABEL);
  const [hovered, setHovered] = useState<string | null>(null);

  function forkZone(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    const z = heatmap[key] ?? {};
    const headline = (z.ambiguity || ZONE_LABEL[key]).trim();
    if (!headline) return;
    forkAmbiguity({
      sourceId: shape.id,
      headline,
      body: z.question_to_resolve || "",
      color,
    });
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background: "linear-gradient(180deg, #FFFFFF 0%, #FBFCFE 100%)",
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow: `0 1px 0 rgba(255,255,255,0.9) inset, 0 1px 2px rgba(11,18,40,0.04), 0 20px 44px -24px rgba(11,18,40,0.20), 0 8px 22px -18px ${color}33`,
          padding: "14px 14px 12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginBottom: 3,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: color,
            }}
          />
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: appleVibe.text.primary,
            }}
          >
            Ambiguity heatmap
          </div>
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: appleVibe.text.tertiary,
            marginBottom: 10,
          }}
        >
          Tap a zone to fork it as its own card
          {sourceId ? " · linked back to your sharpened prompt" : ""}
        </div>
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridAutoRows: "1fr",
            gap: 6,
            minHeight: 0,
          }}
        >
          {keys.map((key) => {
            const z = heatmap[key] ?? {};
            const sev = (z.severity as string) || "low";
            const sc = SEV_COLOR[sev] ?? SEV_COLOR.low;
            const isH = hovered === key;
            return (
              <button
                key={key}
                type="button"
                onPointerDown={stopEventPropagation}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
                onClick={(e) => forkZone(key, e)}
                title={z.ambiguity || ZONE_LABEL[key]}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  gap: 4,
                  padding: "7px 10px",
                  borderRadius: 12,
                  border: isH
                    ? `1px solid ${withAlpha(sc, 0.4)}`
                    : `1px solid ${appleVibe.stroke.hairline}`,
                  background: isH ? withAlpha(sc, 0.07) : "#FFFFFF",
                  boxShadow: isH
                    ? `0 8px 18px -10px ${withAlpha(sc, 0.5)}`
                    : "0 1px 2px rgba(11,18,40,0.04)",
                  transition:
                    "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
                  cursor: "pointer",
                  textAlign: "left",
                  minHeight: 0,
                  fontFamily: appleVibe.font.stack,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: sc,
                      boxShadow: `0 0 0 3px ${withAlpha(sc, 0.16)}`,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 650,
                      color: appleVibe.text.primary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ZONE_LABEL[key]}
                  </span>
                </div>
                {z.ambiguity ? (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 450,
                      lineHeight: 1.3,
                      color: appleVibe.text.tertiary,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {z.ambiguity}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </HTMLContainer>
  );
}
