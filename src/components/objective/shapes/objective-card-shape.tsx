"use client";

// ── ObjectiveCardShapeUtil ──
//
// The objective on the board — its own card type (replaces the reused
// room-card "__obj"). The chatbox card transforms into this in place on
// submit. Opening it (the "Open ↗" button, or a double-click anywhere) opens
// the objective as a NODE (the board-sourced ObjectiveNode in the object-detail
// drawer) whose contents are everything on the whiteboard. The heart favorites
// it (meta.favorited) so it appears in the left favorites sidebar.
//
// AUTO-HEIGHT: the card measures its content and grows to fit, so the FULL
// title always shows (no clamp / cropping). Width is the standard 340.

import { useLayoutEffect, useRef } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import { Heart } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  OPEN_CARD_DETAIL_EVENT,
  OBJECTIVE_MARKER,
} from "@/components/objective/canvas-interactions/object-detail-drawer";

export type ObjectiveCardShape = TLBaseShape<
  "objective-card",
  {
    w: number;
    h: number;
    spaceId: string;
    /** distilled / short title */
    title: string;
    /** the full objective text */
    objective: string;
    color: string;
  }
>;

/** Fire the open-objective event (board-sourced ObjectiveNode drawer). */
function openObjective() {
  window.dispatchEvent(
    new CustomEvent(OPEN_CARD_DETAIL_EVENT, {
      detail: { objectId: OBJECTIVE_MARKER },
    }),
  );
}

export class ObjectiveCardShapeUtil extends BaseBoxShapeUtil<ObjectiveCardShape> {
  static override type = "objective-card" as const;
  static override props: RecordProps<ObjectiveCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    title: T.string,
    objective: T.string,
    color: T.string,
  };

  // Auto-sized to its content — no manual resize (keeps the standard width +
  // a height that always fits the full title).
  override canResize = () => false;
  override canEdit = () => false;

  // Double-click anywhere on the card opens it (reliable, unlike a body click
  // which tldraw can swallow as a selection).
  override onDoubleClick = () => {
    openObjective();
  };

  getDefaultProps(): ObjectiveCardShape["props"] {
    return {
      w: 340,
      h: 168,
      spaceId: "",
      title: "Objective",
      objective: "",
      color: appleVibe.stage.objective,
    };
  }

  component(shape: ObjectiveCardShape) {
    return <ObjectiveCardRenderer shape={shape} util={this} />;
  }

  indicator(shape: ObjectiveCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function ObjectiveCardRenderer({
  shape,
  util,
}: {
  shape: ObjectiveCardShape;
  util: ObjectiveCardShapeUtil;
}) {
  const editor = util.editor;
  const { w, h, title, objective, color } = shape.props;
  const favorited = !!(shape.meta as { favorited?: boolean })?.favorited;
  const ref = useRef<HTMLDivElement>(null);

  // Grow (or shrink) the shape's height to fit the rendered content so the full
  // title always shows. Guard on a >1px delta so it converges (no loop).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const needed = Math.ceil(el.offsetHeight);
    if (needed > 0 && Math.abs(needed - h) > 1) {
      editor.updateShape<ObjectiveCardShape>({
        id: shape.id,
        type: "objective-card",
        props: { h: needed },
      });
    }
    // Re-measure when the content or width changes (NOT on h → avoids a loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, title, objective]);

  function toggleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    editor.updateShape<ObjectiveCardShape>({
      id: shape.id,
      type: "objective-card",
      meta: { ...shape.meta, favorited: !favorited },
    });
  }

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        ref={ref}
        onClick={openObjective}
        style={{
          width: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,249,252,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 46px -18px ${color}55, 0 8px 22px -12px rgba(11,18,40,0.16)`,
          padding: "14px 15px 13px",
          display: "flex",
          flexDirection: "column",
          cursor: "pointer",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Eyebrow + heart */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(71,85,105,0.9)",
            }}
          >
            Objective
          </span>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={toggleFavorite}
            aria-label={favorited ? "Unfavorite" : "Favorite"}
            title={favorited ? "Remove from sidebar" : "Add to sidebar"}
            style={{
              marginLeft: "auto",
              display: "inline-grid",
              placeItems: "center",
              width: 26,
              height: 26,
              borderRadius: 999,
              border: "none",
              background: favorited ? "rgba(244,63,94,0.10)" : "rgba(15,23,42,0.04)",
              cursor: "pointer",
            }}
          >
            <Heart
              style={{
                width: 14,
                height: 14,
                color: favorited ? "#F43F5E" : appleVibe.text.faint,
              }}
              fill={favorited ? "#F43F5E" : "none"}
              strokeWidth={2.2}
            />
          </button>
        </div>

        {/* Title — full, no clamp (the card auto-grows to fit it). */}
        <div
          style={{
            marginTop: 8,
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.2,
            color: appleVibe.text.primary,
            overflowWrap: "anywhere",
          }}
        >
          {title || "Objective"}
        </div>

        {/* Objective text (kept to a few lines — only the title must be full). */}
        {objective && objective !== title && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              fontWeight: 450,
              lineHeight: 1.42,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {objective}
          </div>
        )}

        {/* Open affordance — a real button so a single click reliably opens
            (the card body click can be swallowed by tldraw's selection). */}
        <button
          type="button"
          onPointerDown={stopEventPropagation}
          onClick={(e) => {
            e.stopPropagation();
            openObjective();
          }}
          style={{
            marginTop: 10,
            alignSelf: "flex-start",
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            fontSize: 10.5,
            fontWeight: 600,
            color: appleVibe.text.faint,
            fontFamily: appleVibe.font.stack,
          }}
        >
          Press to open ↗
        </button>
      </div>
    </HTMLContainer>
  );
}
