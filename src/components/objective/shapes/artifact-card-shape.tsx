"use client";

// ── ArtifactCardShapeUtil ──
//
// A single room item (a pain, feature/mechanism, or outcome) sent to the
// objective whiteboard so the user can mix items from DIFFERENT rooms and
// Connect/Synthesize across them — the cross-room "mix and match" move.
//
// Distinct from `room-card` (which IS a whole room, collapsed) — this is a
// reference to one item. Its "Open room" action reopens the source room's
// window (it does NOT delete itself; the artifact stays on the board).
// Self-contained, no app context.

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
import { ArrowUpRight, GripVertical } from "lucide-react";
import { OPEN_ROOM_EVENT } from "./room-card-shape";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export type ArtifactCardShape = TLBaseShape<
  "artifact-card",
  {
    w: number;
    h: number;
    kind: "pain" | "feature" | "outcome" | "lab";
    title: string;
    subtitle: string;
    color: string;
    /** Source entity id (the room item this references). */
    entityId: string;
    /** Source sub-objective room id — "Open room" reopens it. */
    roomId: string;
  }
>;

const KIND_LABEL: Record<ArtifactCardShape["props"]["kind"], string> = {
  pain: "Pain",
  feature: "Feature",
  outcome: "Outcome",
  lab: "Lab",
};

export class ArtifactCardShapeUtil extends BaseBoxShapeUtil<ArtifactCardShape> {
  static override type = "artifact-card" as const;
  static override props: RecordProps<ArtifactCardShape> = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum("pain", "feature", "outcome", "lab"),
    title: T.string,
    subtitle: T.string,
    color: T.string,
    entityId: T.string,
    roomId: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: ArtifactCardShape,
    info: TLResizeInfo<ArtifactCardShape>,
  ) => {
    return resizeBox(shape, info);
  };

  // A "lab" result node with a backfilled library objectId (in meta) opens its
  // object detail drawer on a single click — same as the oc-cards, so AI
  // results aren't dead ends. A modifier-click is left for multi-select.
  override onClick = (shape: ArtifactCardShape) => {
    const i = this.editor.inputs;
    if (i.shiftKey || i.ctrlKey || i.altKey) return;
    const objectId = (shape.meta as { objectId?: unknown }).objectId;
    if (typeof objectId === "string" && objectId) {
      window.dispatchEvent(
        new CustomEvent("objective-board:open-card-detail", {
          detail: { objectId },
        }),
      );
    }
  };

  getDefaultProps(): ArtifactCardShape["props"] {
    return {
      w: 240,
      h: 150,
      kind: "pain",
      title: "Item",
      subtitle: "",
      color: "#EC4899",
      entityId: "",
      roomId: "",
    };
  }

  component(shape: ArtifactCardShape) {
    return <ArtifactCardRenderer shape={shape} />;
  }

  indicator(shape: ArtifactCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

function ArtifactCardRenderer({ shape }: { shape: ArtifactCardShape }) {
  const { kind, title, subtitle, color, roomId } = shape.props;
  // Compact = an unfurl map node — drop the Open-room button + footer
  // (flagged via meta, no schema change). Send-to-board leaves it unset.
  const compact = !!(shape.meta as { compact?: boolean }).compact;

  function openRoom(e: React.MouseEvent) {
    e.stopPropagation();
    // Reopen the source room's window — the artifact stays on the board.
    if (roomId) {
      window.dispatchEvent(
        new CustomEvent(OPEN_ROOM_EVENT, { detail: { roomId } }),
      );
    }
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
          borderRadius: 18,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(248,249,252,0.96) 100%)",
          border: "1px solid rgba(15,23,42,0.07)",
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 14px 36px -16px ${color}55, 0 6px 18px -10px rgba(11,18,40,0.16)`,
          padding: "13px 14px 11px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* Header: grip + kind eyebrow + Open-room. */}
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
              style={{ width: 12, height: 12, color: "rgba(15,23,42,0.26)" }}
            />
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color,
              }}
            >
              {KIND_LABEL[kind]}
            </span>
          </div>
          {roomId && !compact && (
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={openRoom}
              title="Open the source room"
              aria-label="Open source room"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid ${color}33`,
                cursor: "pointer",
                background: `${color}12`,
                color,
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              Room
              <ArrowUpRight style={{ width: 10, height: 10 }} strokeWidth={2.4} />
            </button>
          )}
        </div>

        {/* Title */}
        <div
          style={{
            marginTop: 10,
            marginLeft: 6,
            fontSize: 14.5,
            fontWeight: 600,
            lineHeight: 1.22,
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </div>

        {/* Subtitle (the item's outcome / measure). */}
        {subtitle && (
          <div
            style={{
              marginTop: 5,
              marginLeft: 6,
              fontSize: 11.5,
              fontWeight: 450,
              lineHeight: 1.4,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {subtitle}
          </div>
        )}

      </div>
    </HTMLContainer>
  );
}
