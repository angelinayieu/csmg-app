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
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { forkAmbiguity } from "@/components/objective/board-bus";
import { SHARPEN_COLOR } from "./prompt-sharpening-card-shape";

const CARD_W = 360;
const CARD_H = 440;

const KIND_STYLE: Record<string, { color: string; label: string }> = {
  pain: { color: "#FF8243", label: "Pain" },
  goal: { color: "#FCE883", label: "Goal" },
  lever: { color: "#069494", label: "Lever" },
  constraint: { color: "#FF8243", label: "Limit" },
  concept: { color: "#FFC0CB", label: "Term" },
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
  const items = parseSalience(shape.props.salienceJson);

  function forkRow(s: SalienceItem, e: React.MouseEvent) {
    e.stopPropagation();
    const headline = s.phrase.trim();
    if (!headline) return;
    const body =
      s.why ||
      (s.candidate_readings && s.candidate_readings.length
        ? `Could mean: ${s.candidate_readings.slice(0, 3).join(" · ")}`
        : "");
    forkAmbiguity({
      sourceId: shape.id,
      headline,
      body,
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
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(246,250,255,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 46px -18px ${color}4D, 0 8px 22px -12px rgba(11,18,40,0.14)`,
          padding: "14px 15px 13px",
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
            marginBottom: 6,
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
          What to optimize for · tap a row to fork it
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {items.length === 0 ? (
            <div
              style={{
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
              return (
                <button
                  key={i}
                  type="button"
                  onPointerDown={stopEventPropagation}
                  onClick={(e) => forkRow(s, e)}
                  title={s.why || s.phrase}
                  style={{
                    padding: "7px 9px",
                    borderRadius: 10,
                    border: `1px solid ${appleVibe.stroke.soft}`,
                    background: "#FFFFFF",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: appleVibe.font.stack,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 8.5,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: appleVibe.text.primary,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: ks.color,
                        flexShrink: 0,
                      }}
                    >
                      {ks.label}
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
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
                      title={`Leverage ${Math.round(s.leverage * 100)}% · Uncertainty ${Math.round(s.uncertainty * 100)}%`}
                      style={{
                        marginLeft: "auto",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      <MiniDot value={s.leverage} color={ks.color} />
                      <MiniDot value={s.uncertainty} color="#94A3B8" />
                    </span>
                  </div>
                  {s.why && (
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 10.5,
                        lineHeight: 1.4,
                        color: appleVibe.text.tertiary,
                      }}
                    >
                      {s.why}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
