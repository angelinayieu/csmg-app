"use client";

// ── Thread snapshot shape (Phase 2D) ──
//
// Read-only preview of a shape_threads conversation, frozen at
// drop time. Used when a user drags a thread from the Library's
// Threads folder onto the canvas — gives them a visible "pin" of
// a discussion that lives elsewhere.
//
// Click "Open" → navigate to the canvas + select the root shape
// the thread is anchored on. (The navigation is future work — for
// now the card exposes the root shape id for tooling.)

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { MessageSquare, ChevronRight } from "lucide-react";
import type { ThreadSnapshotShape } from "./types";

export class ThreadSnapshotShapeUtil extends BaseBoxShapeUtil<ThreadSnapshotShape> {
  static override type = "thread-snapshot" as const;
  static override props: RecordProps<ThreadSnapshotShape> = {
    w: T.number,
    h: T.number,
    threadId: T.string,
    spaceId: T.string,
    rootShapeId: T.string,
    rootContent: T.string,
    authorDisplay: T.string,
    replyCount: T.number,
    latestReply: T.string.nullable(),
    latestAt: T.string,
    accent: T.string,
  };

  override getDefaultProps(): ThreadSnapshotShape["props"] {
    return {
      w: 280,
      h: 140,
      threadId: "",
      spaceId: "",
      rootShapeId: "",
      rootContent: "",
      authorDisplay: "Someone",
      replyCount: 1,
      latestReply: null,
      latestAt: new Date().toISOString(),
      accent: "#A855F7",
    };
  }

  override canResize = () => true;
  override onResize = (
    shape: ThreadSnapshotShape,
    info: TLResizeInfo<ThreadSnapshotShape>,
  ) => resizeBox(shape, info);

  override component(shape: ThreadSnapshotShape) {
    const {
      rootContent,
      authorDisplay,
      replyCount,
      latestReply,
      accent,
    } = shape.props;

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
            width: "100%",
            height: "100%",
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(12px) saturate(1.4)",
            WebkitBackdropFilter: "blur(12px) saturate(1.4)",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            borderRadius: 14,
            boxShadow:
              "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 20px -12px rgba(15, 23, 42, 0.12), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <div style={{ height: 3, background: accent, opacity: 0.85 }} />

          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px 6px",
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MessageSquare size={13} strokeWidth={1.75} color={accent} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "rgba(15,23,42,0.55)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {authorDisplay}
              </div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: accent,
                }}
              >
                Thread · {replyCount} message{replyCount === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          {/* Root content */}
          <div
            style={{
              flex: 1,
              padding: "2px 12px 6px",
              fontSize: 12,
              fontWeight: 500,
              color: "#0f172a",
              lineHeight: 1.4,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
            }}
            title={rootContent}
          >
            {rootContent || "(empty thread)"}
          </div>

          {/* Latest reply excerpt */}
          {latestReply && (
            <div
              style={{
                padding: "4px 12px 6px",
                fontSize: 11,
                fontStyle: "italic",
                color: "rgba(15,23,42,0.55)",
                lineHeight: 1.35,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                borderTop: "1px dashed rgba(15,23,42,0.08)",
              }}
              title={latestReply}
            >
              ↳ {latestReply}
            </div>
          )}

          {/* Footer — open link (navigation stub) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px 10px",
              borderTop: "1px solid rgba(15,23,42,0.05)",
            }}
          >
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color: "rgba(15,23,42,0.5)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Linked to shape
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                fontSize: 10,
                fontWeight: 600,
                color: accent,
              }}
            >
              Open
              <ChevronRight size={10} strokeWidth={2} />
            </span>
          </div>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: ThreadSnapshotShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
    );
  }
}
