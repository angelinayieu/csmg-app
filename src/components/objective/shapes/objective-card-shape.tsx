"use client";

// ── ObjectiveCardShapeUtil ──
//
// The objective on the board — its own card type (replaces the reused
// room-card "__obj"). The chatbox card transforms into this in place on
// submit. Pressing the body opens the objective room; the heart favorites
// it (meta.favorited) so it appears in the left favorites sidebar.

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
import { Heart } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { OPEN_ROOM_EVENT } from "@/components/objective/shapes/room-card-shape";

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

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: ObjectiveCardShape,
    info: TLResizeInfo<ObjectiveCardShape>,
  ) => resizeBox(shape, info);

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
  const { title, objective, color } = shape.props;
  const favorited = !!(shape.meta as { favorited?: boolean })?.favorited;

  function openRoom(e: React.MouseEvent) {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent(OPEN_ROOM_EVENT, { detail: { roomId: "__obj" } }),
    );
  }

  function toggleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    editor.updateShape<ObjectiveCardShape>({
      id: shape.id,
      type: "objective-card",
      meta: { ...shape.meta, favorited: !favorited },
    });
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        onClick={openRoom}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,249,252,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 46px -18px ${color}55, 0 8px 22px -12px rgba(11,18,40,0.16)`,
          padding: "14px 15px 13px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
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

        {/* Title */}
        <div
          style={{
            marginTop: 8,
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.18,
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title || "Objective"}
        </div>

        {/* Objective text */}
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

        <div
          style={{
            marginTop: "auto",
            fontSize: 10.5,
            fontWeight: 600,
            color: appleVibe.text.faint,
          }}
        >
          Press to open ↗
        </div>
      </div>
    </HTMLContainer>
  );
}
