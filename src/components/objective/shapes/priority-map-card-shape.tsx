"use client";

// ── PriorityMapCardShape ──
//
// Forked-out card that mirrors the priority map ("Optimize for") panel from
// the sharpening card — but as its own surface so the user can lay it next to
// other thinking. Each salience row is tap-to-fork; the resulting insight-card
// is connected back to THIS card by the bezier overlay. Salience is a JSON
// payload stamped at fork time (the sharpening card already has it loaded).

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
import { useMemo, useState } from "react";
import { appleVibe, withAlpha } from "@/lib/apple-vibe-tokens";
import { forkAmbiguity } from "@/components/objective/board-bus";
import { SHARPEN_COLOR } from "./prompt-sharpening-card-shape";

const CARD_W = 340;
const CARD_H = 340; // square — mirrors the ambiguity heatmap card

// Distinct, contrast-on-white kind colors (the old palette collided pain+limit
// on the same orange and used a near-invisible pale yellow for goal).
const KIND_STYLE: Record<string, { color: string; label: string }> = {
  pain: { color: "#EF4444", label: "Pain" },
  goal: { color: "#F59E0B", label: "Goal" },
  lever: { color: "#0D9488", label: "Lever" },
  constraint: { color: "#6366F1", label: "Limit" },
  concept: { color: "#EC4899", label: "Term" },
};

interface SalienceItem {
  phrase: string;
  kind: string;
  leverage: number;
  uncertainty: number;
  why?: string;
  candidate_readings?: string[];
}

export type PriorityMapCardShape = TLBaseShape<
  "priority-map-card",
  {
    w: number;
    h: number;
    /** Sharpening card this priority map forked off — for upstream lineage. */
    sourceId: string;
    spaceId: string;
    /** Salience annotations, JSON-encoded — snapshot of the sharpening card's. */
    salienceJson: string;
    color: string;
  }
>;

export class PriorityMapCardShapeUtil extends BaseBoxShapeUtil<PriorityMapCardShape> {
  static override type = "priority-map-card" as const;
  static override props: RecordProps<PriorityMapCardShape> = {
    w: T.number,
    h: T.number,
    sourceId: T.string,
    spaceId: T.string,
    salienceJson: T.string,
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: PriorityMapCardShape,
    info: TLResizeInfo<PriorityMapCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): PriorityMapCardShape["props"] {
    return {
      w: CARD_W,
      h: CARD_H,
      sourceId: "",
      spaceId: "",
      salienceJson: "[]",
      color: SHARPEN_COLOR,
    };
  }

  component(shape: PriorityMapCardShape) {
    return <PriorityMapRenderer shape={shape} />;
  }

  indicator(shape: PriorityMapCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function parseSalience(json: string): SalienceItem[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as SalienceItem[]) : [];
  } catch {
    return [];
  }
}

function MiniDot({ value, color }: { value: number; color: string }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        opacity: 0.25 + v * 0.75,
        display: "inline-block",
      }}
    />
  );
}

function PriorityMapRenderer({ shape }: { shape: PriorityMapCardShape }) {
  const { color } = shape.props;
  // Highest-leverage / most-uncertain first — "what to optimize for" should
  // lead with the points that move the answer most.
  const items = useMemo(() => {
    const raw = parseSalience(shape.props.salienceJson);
    return raw
      .map((s) => ({
        ...s,
        _priority: (s.leverage || 0) * (0.5 + 0.5 * (s.uncertainty || 0)),
      }))
      .sort((a, b) => b._priority - a._priority);
  }, [shape.props.salienceJson]);
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered != null ? items[hovered] : null;
  const activeKind = active ? KIND_STYLE[active.kind] ?? KIND_STYLE.concept : null;

  function forkRow(s: SalienceItem, e: React.MouseEvent) {
    e.stopPropagation();
    const headline = s.phrase.trim();
    if (!headline) return;
    const body =
      s.why ||
      (s.candidate_readings && s.candidate_readings.length
        ? `Could mean: ${s.candidate_readings.slice(0, 3).join(" · ")}`
        : "");
    forkAmbiguity({ sourceId: shape.id, headline, body, color });
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
        {/* header */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}
        >
          <span
            style={{ width: 7, height: 7, borderRadius: 999, background: color }}
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
            Priority map
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
          What to optimize for · tap a tile to fork it
        </div>

        {/* 2-column grid — title-only tiles, no descriptions at rest */}
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
          {items.length === 0 ? (
            <div
              style={{
                gridColumn: "1 / -1",
                fontSize: 11,
                color: appleVibe.text.faint,
                padding: "10px 4px",
              }}
            >
              No salience yet.
            </div>
          ) : (
            items.map((s, i) => {
              const ks = KIND_STYLE[s.kind] ?? KIND_STYLE.concept;
              const isH = hovered === i;
              return (
                <button
                  key={i}
                  type="button"
                  onPointerDown={stopEventPropagation}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                  onClick={(e) => forkRow(s, e)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: isH
                      ? `1px solid ${withAlpha(ks.color, 0.38)}`
                      : `1px solid ${appleVibe.stroke.hairline}`,
                    background: isH ? withAlpha(ks.color, 0.07) : "#FFFFFF",
                    boxShadow: isH
                      ? `0 8px 18px -10px ${withAlpha(ks.color, 0.5)}`
                      : "0 1px 2px rgba(11,18,40,0.04)",
                    transition:
                      "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
                    cursor: "pointer",
                    textAlign: "left",
                    minHeight: 0,
                    fontFamily: appleVibe.font.stack,
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 999,
                      background: ks.color,
                      boxShadow: `0 0 0 3px ${withAlpha(ks.color, 0.16)}`,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontWeight: 650,
                      color: appleVibe.text.primary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.phrase}
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <MiniDot value={s.leverage} color={ks.color} />
                    <MiniDot value={s.uncertainty} color="#94A3B8" />
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* hover-detail footer — the description, surfaced only on hover */}
        <div
          style={{
            height: 52,
            flexShrink: 0,
            marginTop: 9,
            paddingTop: 8,
            borderTop: `1px solid ${appleVibe.stroke.hairline}`,
            display: "flex",
            flexDirection: "column",
            gap: 3,
            overflow: "hidden",
          }}
        >
          {active && activeKind ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: activeKind.color,
                  }}
                >
                  {activeKind.label}
                </span>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 500,
                    color: appleVibe.text.faint,
                  }}
                >
                  Leverage {Math.round((active.leverage || 0) * 100)}% · Uncertainty{" "}
                  {Math.round((active.uncertainty || 0) * 100)}%
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.4,
                  color: appleVibe.text.secondary,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {active.why ||
                  (active.candidate_readings && active.candidate_readings.length
                    ? `Could mean: ${active.candidate_readings.slice(0, 3).join(" · ")}`
                    : active.phrase)}
              </div>
            </>
          ) : (
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: appleVibe.text.faint,
              }}
            >
              Hover a tile for the stakes · tap to fork it as its own card
            </div>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
