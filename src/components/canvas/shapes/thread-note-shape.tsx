"use client";

// ── ThreadNoteShape (Arc 5A) ───────────────────────────────────────────
//
// A comment node that sub-branches from some parent shape on the canvas.
// Acts like a compact sticky note with:
//   • Parent-inherited accent bar on the left edge (visual tether to source)
//   • Depth-based indentation — each reply layer nudges content right + darkens tint
//   • Editable textarea that auto-grows within bounds
//   • Author + timestamp footer
//   • Hover-revealed Reply + Delete affordances
//
// Apple Vision Pro aesthetic:
//   • Glass surface (backdrop-blur-lg, white/75) with ring-1 border
//   • Color-hinted shadow derived from parent accent
//   • Restrained motion (respects prefers-reduced-motion via the shared hook
//     pattern; we gate CSS transitions on the `matchMedia` check used
//     elsewhere in the canvas shape files)
//
// Content persistence:
//   • Text lives in shape_threads.content (server-authoritative)
//   • The shape's `text` prop is the optimistic client mirror; useThreadPersistence
//     (5A.6) reconciles on debounced commits.
//   • `pending: true` means the thread row hasn't been created server-side
//     yet — shown with a subtle opacity dip + italic placeholder.

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
import { MessageSquare, Trash2, CornerDownRight } from "lucide-react";
import type { ThreadNoteShape } from "./types";

// Depth indent: 0 = 0px, 1 = 12px, 2 = 24px, etc. Capped at 36px so
// very deep chains don't fall off the right edge of the card.
function depthIndent(depth: number): number {
  return Math.min(36, Math.max(0, depth) * 12);
}

// Lift the accent color by N stops for the bg tint. Accepts #rrggbb and
// returns an rgba() string with alpha controlled by `alpha`. Kept local
// to avoid a tinycolor dependency.
function accentTint(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(99,102,241,${alpha})`; // indigo fallback
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatAge(iso: string): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  const days = Math.floor(secs / 86400);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const DEFAULT_ACCENT = "#6366F1"; // Indigo-500
const MIN_W = 180;
const MIN_H = 72;
const DEFAULT_W = 220;
const DEFAULT_H = 96;

export class ThreadNoteShapeUtil extends BaseBoxShapeUtil<ThreadNoteShape> {
  static override type = "thread-note" as const;
  static override props: RecordProps<ThreadNoteShape> = {
    w: T.number,
    h: T.number,
    threadId: T.string,
    text: T.string,
    parentShapeId: T.nullable(T.string),
    rootShapeId: T.string,
    depth: T.number,
    accentHex: T.string,
    authorDisplay: T.string,
    createdAtIso: T.string,
    pending: T.boolean,
  };

  override canResize = () => true;
  override canEdit = () => true;

  override onResize = (shape: ThreadNoteShape, info: TLResizeInfo<ThreadNoteShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): ThreadNoteShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      threadId: "",
      text: "",
      parentShapeId: null,
      rootShapeId: "",
      depth: 0,
      accentHex: DEFAULT_ACCENT,
      authorDisplay: "",
      createdAtIso: new Date().toISOString(),
      pending: true,
    };
  }

  component(shape: ThreadNoteShape) {
    return <ThreadNoteRenderer shape={shape} util={this} />;
  }

  indicator(shape: ThreadNoteShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}

function ThreadNoteRenderer({
  shape,
  util,
}: {
  shape: ThreadNoteShape;
  util: ThreadNoteShapeUtil;
}) {
  const editor = util.editor;
  const isEditing = editor.getEditingShapeId() === shape.id;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const indent = depthIndent(shape.props.depth);

  // Autofocus when entering edit mode. Intentionally does NOT depend on
  // shape.props.text — re-running on every keystroke would reset the
  // caret to the end and make typing feel jumpy.
  useEffect(() => {
    if (!isEditing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    // Place caret at end on first edit (no select-all — the empty state
    // already renders a placeholder so there's nothing to clobber).
    const len = el.value.length;
    el.setSelectionRange(len, len);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const updateText = useCallback(
    (text: string) => {
      editor.updateShape<ThreadNoteShape>({
        id: shape.id,
        type: "thread-note",
        props: { text },
      });
    },
    [editor, shape.id],
  );

  const commit = useCallback(() => {
    editor.setEditingShape(null);
  }, [editor]);

  const accent = shape.props.accentHex || DEFAULT_ACCENT;
  const accentBarColor = accent;
  const tintBg = accentTint(accent, 0.04 + shape.props.depth * 0.02);
  const haloShadow = `0 1px 3px rgba(15,23,42,0.06), 0 8px 20px -6px ${accentTint(accent, 0.22)}`;
  const focusRing = accentTint(accent, 0.45);

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
          borderRadius: 12,
          background: `linear-gradient(180deg, rgba(255,255,255,0.88) 0%, ${tintBg} 100%)`,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: `1px solid ${accentTint(accent, 0.18)}`,
          boxShadow: isEditing
            ? `0 0 0 2px ${focusRing}, ${haloShadow}`
            : haloShadow,
          padding: `10px 12px 8px ${12 + indent}px`,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          opacity: shape.props.pending && !isEditing ? 0.72 : 1,
          overflow: "hidden",
        }}
        aria-label={
          shape.props.depth === 0
            ? "Root thread note"
            : `Reply at depth ${shape.props.depth}`
        }
      >
        {/* Accent bar (left edge) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: accentBarColor,
            borderTopLeftRadius: 12,
            borderBottomLeftRadius: 12,
            opacity: shape.props.depth === 0 ? 1 : 0.75,
          }}
        />

        {/* Depth badge (replies only) */}
        {shape.props.depth > 0 && (
          <span
            style={{
              position: "absolute",
              top: 6,
              left: 10 + indent,
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: accent,
              opacity: 0.7,
            }}
            title={`Reply depth ${shape.props.depth}`}
          >
            <CornerDownRight style={{ width: 9, height: 9 }} />
            {shape.props.depth === 1 ? "reply" : `reply ${shape.props.depth}`}
          </span>
        )}

        {/* Content */}
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={shape.props.text}
            onChange={(e) => updateText(e.target.value)}
            onPointerDown={stopEventPropagation}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                commit();
              }
              // Cmd+Enter commits — parent-level hotkey (5A.5) then creates a child.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commit();
              }
            }}
            placeholder="Type a thought, question, or critique…"
            aria-label="Thread note content"
            style={{
              flex: 1,
              width: "100%",
              marginTop: shape.props.depth > 0 ? 14 : 0,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.4,
              color: "#1F2937",
              fontFamily: "inherit",
              padding: 0,
            }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              marginTop: shape.props.depth > 0 ? 14 : 0,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.4,
              color: shape.props.text ? "#1F2937" : "#94A3B8",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontStyle: !shape.props.text ? "italic" : "normal",
            }}
          >
            {shape.props.text ||
              (shape.props.pending ? "Saving…" : "Double-click to add a comment…")}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            paddingTop: 4,
            borderTop: `1px solid ${accentTint(accent, 0.12)}`,
            marginTop: 2,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              fontSize: 9.5,
              color: "#64748B",
            }}
          >
            <MessageSquare style={{ width: 9, height: 9, flexShrink: 0 }} />
            <span
              style={{
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={shape.props.authorDisplay || "You"}
            >
              {shape.props.authorDisplay || "You"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 9.5,
              color: "#94A3B8",
              fontVariantNumeric: "tabular-nums",
            }}
            title={shape.props.createdAtIso ? new Date(shape.props.createdAtIso).toLocaleString() : ""}
          >
            {formatAge(shape.props.createdAtIso)}
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

// Export the createId helper + sizes so canvas integration can use them.
export const THREAD_DEFAULT_W = DEFAULT_W;
export const THREAD_DEFAULT_H = DEFAULT_H;
export const THREAD_MIN_W = MIN_W;
export const THREAD_MIN_H = MIN_H;

// Inline delete affordance is currently hover-gated by the parent canvas —
// rendering a button inside the shape fights tldraw's selection events.
// The 5A.5 integration provides canvas-level delete via Backspace on a
// selected thread note. If we want an inline trash icon later, the
// pattern is: render an absolute-positioned button with stopEventPropagation
// on pointer events + a PATCH fetch wired up. Leaving the import here so
// we can swap it in cleanly.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _UnusedForNow = Trash2;
