"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useCallback, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import type { StickyNoteShape, StickyColor, StickyDimension } from "./types";

const COLOR_PALETTE: Record<
  StickyColor,
  { bg: string; border: string; text: string; shadow: string }
> = {
  yellow: {
    bg: "linear-gradient(155deg, #FEF3C7 0%, #FDE68A 100%)",
    border: "#F59E0B",
    text: "#78350F",
    shadow: "0 1px 3px rgba(245, 158, 11, 0.18), 0 12px 28px -8px rgba(245, 158, 11, 0.22)",
  },
  pink: {
    bg: "linear-gradient(155deg, #FCE7F3 0%, #FBCFE8 100%)",
    border: "#EC4899",
    text: "#831843",
    shadow: "0 1px 3px rgba(236, 72, 153, 0.18), 0 12px 28px -8px rgba(236, 72, 153, 0.22)",
  },
  blue: {
    bg: "linear-gradient(155deg, #DBEAFE 0%, #BFDBFE 100%)",
    border: "#3B82F6",
    text: "#1E3A8A",
    shadow: "0 1px 3px rgba(59, 130, 246, 0.18), 0 12px 28px -8px rgba(59, 130, 246, 0.22)",
  },
  green: {
    bg: "linear-gradient(155deg, #D1FAE5 0%, #A7F3D0 100%)",
    border: "#10B981",
    text: "#064E3B",
    shadow: "0 1px 3px rgba(16, 185, 129, 0.18), 0 12px 28px -8px rgba(16, 185, 129, 0.22)",
  },
  purple: {
    bg: "linear-gradient(155deg, #EDE9FE 0%, #DDD6FE 100%)",
    border: "#8B5CF6",
    text: "#4C1D95",
    shadow: "0 1px 3px rgba(139, 92, 246, 0.18), 0 12px 28px -8px rgba(139, 92, 246, 0.22)",
  },
};

const COLORS: StickyColor[] = ["yellow", "pink", "blue", "green", "purple"];
const DIMENSIONS = ["problem", "solution", "question", "insight", "risk", "evidence"] as const;

export class StickyNoteShapeUtil extends BaseBoxShapeUtil<StickyNoteShape> {
  static override type = "sticky-note" as const;
  static override props: RecordProps<StickyNoteShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
    color: T.literalEnum(...(COLORS as [StickyColor, ...StickyColor[]])),
    dimension: T.nullable(T.literalEnum(...DIMENSIONS)),
    aiTagged: T.boolean,
    entityId: T.nullable(T.string),
  };

  override canResize = () => true;
  override canEdit = () => true;

  override onResize = (shape: StickyNoteShape, info: TLResizeInfo<StickyNoteShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): StickyNoteShape["props"] {
    return {
      w: 200,
      h: 200,
      text: "",
      color: "yellow",
      dimension: null,
      aiTagged: false,
      entityId: null,
    };
  }

  component(shape: StickyNoteShape) {
    return <StickyNoteRenderer shape={shape} util={this} />;
  }

  indicator(shape: StickyNoteShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />;
  }
}

function StickyNoteRenderer({
  shape,
  util,
}: {
  shape: StickyNoteShape;
  util: StickyNoteShapeUtil;
}) {
  const palette = COLOR_PALETTE[shape.props.color];
  const editor = util.editor;
  const isEditing = editor.getEditingShapeId() === shape.id;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [isEditing]);

  const updateText = useCallback(
    (text: string) => {
      editor.updateShape<StickyNoteShape>({
        id: shape.id,
        type: "sticky-note",
        props: { text },
      });
    },
    [editor, shape.id],
  );

  const dimensionBadge = shape.props.dimension ? shape.props.dimension.toUpperCase() : null;

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
          borderRadius: 10,
          background: palette.bg,
          boxShadow: palette.shadow,
          padding: "16px 14px 12px",
          display: "flex",
          flexDirection: "column",
          color: palette.text,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* dimension tag */}
        {dimensionBadge && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 10,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: palette.border,
              padding: "2px 6px",
              background: "rgba(255,255,255,0.55)",
              borderRadius: 3,
              border: `1px solid ${palette.border}33`,
            }}
          >
            {dimensionBadge}
          </div>
        )}

        {/* AI ambient indicator */}
        {shape.props.aiTagged && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 8.5,
              fontWeight: 600,
              color: palette.border,
              animation: "pulse 1.6s ease-in-out infinite",
            }}
            title="AI is analyzing this note"
          >
            <Sparkles className="h-2.5 w-2.5" />
            Thinking…
          </div>
        )}

        {/* Textarea (editable when editing) */}
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={shape.props.text}
            onChange={(e) => updateText(e.target.value)}
            onPointerDown={stopEventPropagation}
            onKeyDown={(e) => {
              // Escape/cmd+enter commit via tldraw editor blur
              if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                editor.setEditingShape(null);
              }
            }}
            placeholder="Type a thought… ⌘↵ to decompose"
            style={{
              flex: 1,
              width: "100%",
              marginTop: dimensionBadge || shape.props.aiTagged ? 18 : 0,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1.4,
              color: palette.text,
              fontFamily: "inherit",
            }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              marginTop: dimensionBadge || shape.props.aiTagged ? 18 : 0,
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1.4,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              opacity: shape.props.text ? 1 : 0.45,
            }}
          >
            {shape.props.text || "Double-click to type…"}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

export const STICKY_COLORS = COLORS;
export const STICKY_DIMENSIONS = DIMENSIONS;
export type { StickyDimension };
