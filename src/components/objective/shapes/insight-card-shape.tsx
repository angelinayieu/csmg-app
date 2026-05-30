"use client";

// ── InsightCardShapeUtil ──
//
// The AI's contribution to the board: a "Connect" (relationship between
// two cards) or "Synthesize" (insight across 3+ cards) result. It lands
// as a PROPOSAL — dashed, with Keep / Dismiss — so the human always
// curates. Nothing the AI says is forced onto the board.
//
// Self-contained (no app context, no external event bus): the card owns
// its own accept/reject. Accepting flips status to "accepted" and
// solidifies its linked arrows; dismissing deletes the card AND the
// arrows that tether it to its sources (tagged via meta.proposalFor).
// This keeps the focused objective board free of the heavy canvas
// chrome the main InteraxisCanvas uses for the same lifecycle.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  type TLShapeId,
  resizeBox,
} from "tldraw";
import { Check, X } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export type InsightCardShape = TLBaseShape<
  "insight-card",
  {
    w: number;
    h: number;
    /** proposed → ghost with Keep/Dismiss; accepted → solid, persisted. */
    status: "proposed" | "accepted";
    /** connect = relationship between 2; synthesize = insight across N. */
    kind: "connect" | "synthesize";
    headline: string;
    body: string;
    color: string;
    /** tldraw ids of the source cards this insight links to. */
    sourceIds: string[];
  }
>;

export class InsightCardShapeUtil extends BaseBoxShapeUtil<InsightCardShape> {
  static override type = "insight-card" as const;
  static override props: RecordProps<InsightCardShape> = {
    w: T.number,
    h: T.number,
    status: T.literalEnum("proposed", "accepted"),
    kind: T.literalEnum("connect", "synthesize"),
    headline: T.string,
    body: T.string,
    color: T.string,
    sourceIds: T.arrayOf(T.string),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: InsightCardShape, info: TLResizeInfo<InsightCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): InsightCardShape["props"] {
    return {
      w: 252,
      h: 168,
      status: "proposed",
      kind: "connect",
      headline: "",
      body: "",
      color: "#475569",
      sourceIds: [],
    };
  }

  component(shape: InsightCardShape) {
    return <InsightCardRenderer shape={shape} util={this} />;
  }

  indicator(shape: InsightCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function InsightCardRenderer({
  shape,
  util,
}: {
  shape: InsightCardShape;
  util: InsightCardShapeUtil;
}) {
  const { status, kind, headline, body, color } = shape.props;
  const editor = util.editor;
  const proposed = status === "proposed";

  /** All arrows that tether this insight to its source cards. */
  function linkedArrowIds(): TLShapeId[] {
    return editor
      .getCurrentPageShapes()
      .filter(
        (s) =>
          s.type === "arrow" &&
          (s.meta as { proposalFor?: string })?.proposalFor === shape.id,
      )
      .map((s) => s.id);
  }

  function keep(e: React.MouseEvent) {
    e.stopPropagation();
    editor.updateShape<InsightCardShape>({
      id: shape.id,
      type: "insight-card",
      props: { status: "accepted" },
    });
    // Solidify the tethers so an accepted insight reads as "real".
    for (const id of linkedArrowIds()) {
      editor.updateShape({
        id,
        type: "arrow",
        props: { dash: "solid", color: "grey" },
      });
    }
  }

  function dismiss(e: React.MouseEvent) {
    e.stopPropagation();
    editor.deleteShapes([shape.id, ...linkedArrowIds()]);
  }

  const eyebrow = kind === "connect" ? "Connection" : "Synthesis";

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(249,247,255,0.97) 100%)",
          border: proposed
            ? `1.5px dashed ${color}80`
            : `1px solid ${color}40`,
          boxShadow: proposed
            ? `0 1px 2px rgba(11,18,40,0.04), 0 14px 38px -16px ${color}40`
            : `0 1px 2px rgba(11,18,40,0.05), 0 18px 48px -16px ${color}55, 0 8px 22px -10px rgba(11,18,40,0.16)`,
          padding: "14px 15px 12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          opacity: proposed ? 0.97 : 1,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* Eyebrow — the AI provenance tag. */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Sparkle style={{ width: 12, height: 12, color }} strokeWidth={2.4} />
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
              color,
            }}
          >
            {eyebrow}
          </span>
          {proposed && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: appleVibe.text.tertiary,
              }}
            >
              Proposed
            </span>
          )}
        </div>

        {/* Headline — the relationship / insight, lead element. */}
        <div
          style={{
            marginTop: 10,
            fontSize: kind === "connect" ? 17 : 15.5,
            fontWeight: 650,
            lineHeight: 1.2,
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {headline}
        </div>

        {/* Body — the "why" / the "so what". */}
        {body && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 450,
              lineHeight: 1.42,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: proposed ? 3 : 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {body}
          </div>
        )}

        {/* Footer: Keep / Dismiss while proposed; quiet tag once kept. */}
        {proposed && (
          <div
            style={{
              marginTop: "auto",
              paddingTop: 10,
              display: "flex",
              gap: 7,
            }}
          >
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={keep}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: color,
                color: "white",
                fontSize: 11.5,
                fontWeight: 600,
                boxShadow: `0 4px 12px -3px ${color}88`,
              }}
            >
              <Check style={{ width: 12, height: 12 }} strokeWidth={3} />
              Keep
            </button>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={dismiss}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid rgba(15,23,42,0.12)",
                cursor: "pointer",
                background: "rgba(255,255,255,0.6)",
                color: "rgba(15,23,42,0.55)",
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              <X style={{ width: 12, height: 12 }} strokeWidth={2.6} />
              Dismiss
            </button>
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}
