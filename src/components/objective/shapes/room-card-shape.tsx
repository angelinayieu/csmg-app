"use client";

// ── RoomCardShapeUtil ──
//
// The "collapse-to-card" target. When the user collapses the objective
// (or a sub-objective room) out of its floating window, the shell drops
// one of these onto the whiteboard base. It's a self-contained tldraw
// shape — NO app context dependencies (no useSpaceData / brainstorm
// context), so it mounts safely on the focused objective board which
// lives outside the heavy SpaceDataProvider.
//
// The card carries just enough to re-open the room: a `roomId`
// (`"__obj"` for the objective itself, else a sub-objective id), a
// title/subtitle for the face, and an accent color matching the
// sidebar circle. Its "Expand" button deletes the card and fires
// `objective-board:open-room` — the shell listens and re-inflates the
// window for that room. So collapse ⇄ expand is a clean toggle: the
// room is EITHER a window OR a card, never duplicated.

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
import { Maximize2, GripVertical, ChevronDown } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export type RoomCardShape = TLBaseShape<
  "room-card",
  {
    w: number;
    h: number;
    title: string;
    subtitle: string;
    color: string;
    roomId: string;
    /** Short stat strings ("4 mechanisms", "3 chains", "Ready") rendered
     *  as pills — turns the card from a label into a real artifact
     *  snapshot of the room's content. */
    chips: string[];
  }
>;

/** Event the card fires when its Expand button is pressed. The
 *  ObjectiveCanvasShell listens and re-opens the corresponding room
 *  window. Kept as a string literal in one place so both ends agree. */
export const OPEN_ROOM_EVENT = "objective-board:open-room";

/** Default (collapsed) card height — the compact label face. */
const COLLAPSED_H = 184;

/** Estimate the height needed to show the title + subtitle in FULL (no
 *  line-clamp) so the "see the objective in full" toggle can grow the card to
 *  fit. Deterministic (no DOM measurement) → no resize/layout loop. */
function fullHeight(
  title: string,
  subtitle: string,
  chipCount: number,
  w: number,
): number {
  const textW = Math.max(120, w - 44); // padding 16×2 + marginLeft 6, with slack
  const titleLines = Math.max(2, Math.ceil(title.length / (textW / 8.2)));
  const titleH = titleLines * 20; // 16px × lineHeight 1.25
  const subLines = subtitle
    ? Math.min(4, Math.max(1, Math.ceil(subtitle.length / (textW / 6.2))))
    : 0;
  const subH = subLines ? 6 + subLines * 17 : 0;
  const chipsH = chipCount > 0 ? 10 + 24 : 0;
  // top pad 16 + header 20 + title margin 12 + … + bottom pad 14
  const h = 16 + 20 + 12 + titleH + subH + chipsH + 14;
  return Math.min(480, Math.max(COLLAPSED_H, Math.round(h)));
}

export class RoomCardShapeUtil extends BaseBoxShapeUtil<RoomCardShape> {
  static override type = "room-card" as const;
  static override props: RecordProps<RoomCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    subtitle: T.string,
    color: T.string,
    roomId: T.string,
    chips: T.arrayOf(T.string),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: RoomCardShape, info: TLResizeInfo<RoomCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): RoomCardShape["props"] {
    return {
      w: 268,
      h: 184,
      title: "Room",
      subtitle: "",
      color: "#475569",
      roomId: "",
      chips: [],
    };
  }

  component(shape: RoomCardShape) {
    return <RoomCardRenderer shape={shape} util={this} />;
  }

  indicator(shape: RoomCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function RoomCardRenderer({
  shape,
  util,
}: {
  shape: RoomCardShape;
  util: RoomCardShapeUtil;
}) {
  const { title, subtitle, color, roomId, chips } = shape.props;
  const editor = util.editor;
  // In the unfurl, cards are read-only map nodes — drop the action button
  // + footer chrome (flagged via meta, so no schema change). The collapse-
  // to-card / send-to-board contexts leave it unset → full chrome.
  const compact = !!(shape.meta as { compact?: boolean }).compact;

  // The objective card carries the distilled GOAL (the same headline the
  // Overview goal card shows). Since that one-liner is longer than a room
  // name, it gets a disclosure toggle: collapsed clamps it to 2 lines;
  // expanded grows the card and shows the goal IN FULL.
  const isObjective = roomId === "__obj";
  const expanded = !!(shape.meta as { expanded?: boolean }).expanded;

  function toggleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !expanded;
    editor.updateShape<RoomCardShape>({
      id: shape.id,
      type: "room-card",
      props: {
        h: next
          ? fullHeight(title, subtitle, chips.length, shape.props.w)
          : COLLAPSED_H,
      },
      meta: { ...shape.meta, expanded: next },
    });
  }

  function expand(e: React.MouseEvent) {
    e.stopPropagation();
    // Toggle semantics: the room becomes a window again, so the card
    // disappears. Delete first, then notify the shell.
    editor.deleteShape(shape.id);
    window.dispatchEvent(
      new CustomEvent(OPEN_ROOM_EVENT, { detail: { roomId } }),
    );
  }

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
            "linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(248,249,252,0.96) 100%)",
          border: "1px solid rgba(15,23,42,0.07)",
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 48px -16px ${color}55, 0 8px 22px -10px rgba(11,18,40,0.18)`,
          padding: "16px 16px 14px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* Header row: drag affordance + "Room" eyebrow + expand button. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginLeft: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <GripVertical
              style={{ width: 13, height: 13, color: "rgba(15,23,42,0.28)" }}
            />
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color,
              }}
            >
              {roomId === "__obj" ? "Objective" : "Room"}
            </span>
          </div>

          {!compact && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* See-the-objective-in-full disclosure (objective card only). */}
              {isObjective && (
                <button
                  type="button"
                  onPointerDown={stopEventPropagation}
                  onClick={toggleExpand}
                  title={
                    expanded
                      ? "Show less"
                      : "See the full objective — the goal in full"
                  }
                  aria-label={
                    expanded ? "Collapse objective" : "See the full objective"
                  }
                  aria-pressed={expanded}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    border: "1px solid rgba(15,23,42,0.08)",
                    cursor: "pointer",
                    background: "rgba(255,255,255,0.7)",
                    color: appleVibe.text.tertiary,
                  }}
                >
                  <ChevronDown
                    style={{
                      width: 13,
                      height: 13,
                      transform: expanded ? "rotate(180deg)" : "none",
                      transition: "transform 160ms ease",
                    }}
                    strokeWidth={2.4}
                  />
                </button>
              )}
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={expand}
                title="Expand back into a window"
                aria-label="Expand room"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 9px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: color,
                  color: "white",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                  boxShadow: `0 4px 12px -3px ${color}88`,
                }}
              >
                <Maximize2 style={{ width: 11, height: 11 }} strokeWidth={2.4} />
                Expand
              </button>
            </div>
          )}
        </div>

        {/* Title */}
        <div
          style={{
            marginTop: 12,
            marginLeft: 6,
            fontSize: 16,
            fontWeight: 650,
            lineHeight: 1.25,
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: expanded ? 12 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </div>

        {/* Subtitle / summary */}
        {subtitle && (
          <div
            style={{
              marginTop: 6,
              marginLeft: 6,
              fontSize: 12,
              fontWeight: 450,
              lineHeight: 1.4,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: expanded ? 4 : 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Stat chips — the artifact snapshot. A row of pills carrying
            the room's real content counts/state. */}
        {chips.length > 0 && (
          <div
            style={{
              marginTop: 10,
              marginLeft: 6,
              display: "flex",
              flexWrap: "wrap",
              gap: 5,
              overflow: "hidden",
              maxHeight: 24,
            }}
          >
            {chips.slice(0, 4).map((chip, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: `${color}14`,
                  color,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                  whiteSpace: "nowrap",
                }}
              >
                {chip}
              </span>
            ))}
          </div>
        )}

      </div>
    </HTMLContainer>
  );
}
