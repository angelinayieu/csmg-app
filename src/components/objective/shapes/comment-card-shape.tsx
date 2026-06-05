"use client";

// ── CommentCardShapeUtil ──
//
// A human annotation on the whiteboard. Same "social post" anatomy as the
// voice-note card (avatar + name + time + glyph + body), but the body is
// inline-editable and the card carries a strand to its target shape(s)
// (rendered by comment-strands.tsx). The action toolbar exposes resolve /
// analyze / delete; "analyze" runs the lens extension (the route in
// /api/objective/[spaceId]/comments/[id]/analyze) and drops result cards
// next to the comment.
//
// Identity: the props mirror the DB row 1:1 (commentId is the primary
// key, snapshotted author chip fields are along for the ride). When the
// DB row changes (status flip, body edit) the client patches the shape's
// props so the canvas stays the source of truth for rendering.

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
import { useEffect, useRef, useState } from "react";
import { Check, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  dispatchCommentAnalyze,
  dispatchCommentDelete,
  dispatchCommentResolveToggle,
  dispatchCommentBodyPatch,
} from "@/components/objective/board-bus";

export const COMMENT_COLOR = "#B4734A"; // warm kraft — human-annotation register

export type CommentStatus = "open" | "resolved" | "analyzed";

export type CommentCardShape = TLBaseShape<
  "comment-card",
  {
    w: number;
    h: number;
    commentId: string;
    spaceId: string;
    authorName: string;
    authorAvatarUrl: string;
    body: string;
    /** tldraw shape IDs the comment is attached to. Empty = floating. */
    targetShapeIds: string[];
    status: CommentStatus;
    createdAtIso: string;
    color: string;
  }
>;

export class CommentCardShapeUtil extends BaseBoxShapeUtil<CommentCardShape> {
  static override type = "comment-card" as const;
  static override props: RecordProps<CommentCardShape> = {
    w: T.number,
    h: T.number,
    commentId: T.string,
    spaceId: T.string,
    authorName: T.string,
    authorAvatarUrl: T.string,
    body: T.string,
    targetShapeIds: T.arrayOf(T.string),
    status: T.string,
    createdAtIso: T.string,
    color: T.string,
  };

  override canResize = () => true;
  // Editing is owned by our inline textarea (so the renderer can capture
  // the keystrokes without tldraw stealing focus).
  override canEdit = () => false;
  override onResize = (shape: CommentCardShape, info: TLResizeInfo<CommentCardShape>) =>
    resizeBox(shape, info);

  getDefaultProps(): CommentCardShape["props"] {
    return {
      w: 304,
      h: 192,
      commentId: "",
      spaceId: "",
      authorName: "You",
      authorAvatarUrl: "",
      body: "",
      targetShapeIds: [],
      status: "open",
      createdAtIso: "",
      color: COMMENT_COLOR,
    };
  }

  component(shape: CommentCardShape) {
    return <CommentCardRenderer shape={shape} />;
  }

  indicator(shape: CommentCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function relativeTime(iso: string): string {
  if (!iso) return "now";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "now";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function CommentCardRenderer({ shape }: { shape: CommentCardShape }) {
  const { authorName, authorAvatarUrl, body, status, color, createdAtIso, targetShapeIds } =
    shape.props;
  const initial = (authorName || "You").trim().charAt(0).toUpperCase();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [busyAnalyze, setBusyAnalyze] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the local draft in sync if the DB updates the body (e.g. another
  // surface or a remote sync writes new content).
  useEffect(() => {
    if (!editing) setDraft(body);
  }, [body, editing]);

  // Empty fresh comment → drop straight into edit mode so the user can
  // start typing without a click.
  useEffect(() => {
    if (!body && !editing) {
      setEditing(true);
      window.setTimeout(() => textareaRef.current?.focus(), 30);
    }
    // We deliberately only check on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commitEdit() {
    const next = draft.trim();
    setEditing(false);
    if (next === body) return;
    dispatchCommentBodyPatch(shape.props.commentId, shape.id as string, next);
  }

  async function runAnalyze() {
    if (busyAnalyze) return;
    setBusyAnalyze(true);
    try {
      dispatchCommentAnalyze(shape.props.commentId, shape.id as string);
    } finally {
      // The dispatcher fires the request + drops cards itself; we just need
      // to release the local spinner so a follow-up click works.
      window.setTimeout(() => setBusyAnalyze(false), 600);
    }
  }

  const statusChip = (() => {
    if (status === "analyzed")
      return { label: "Analyzed", tone: "#7C3AED", icon: Sparkles };
    if (status === "resolved")
      return { label: "Resolved", tone: "#16A34A", icon: Check };
    return { label: "Open", tone: appleVibe.text.faint, icon: MessageSquare };
  })();
  const StatusIcon = statusChip.icon;
  const targetCount = targetShapeIds?.length ?? 0;

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow: appleVibe.shadow.card,
          padding: "12px 14px 10px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Header — avatar + name/meta + status chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {authorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={authorAvatarUrl}
              alt=""
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                objectFit: "cover",
                flexShrink: 0,
                border: `1px solid ${appleVibe.stroke.soft}`,
              }}
            />
          ) : (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                background: color,
                color: "white",
                display: "grid",
                placeItems: "center",
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {initial}
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 650,
                color: appleVibe.text.primary,
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {authorName || "You"}
            </div>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: appleVibe.text.faint,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <MessageSquare style={{ width: 10, height: 10, color }} strokeWidth={2.2} />
              comment · {relativeTime(createdAtIso)}
              {targetCount > 0 && <span> · on {targetCount} card{targetCount === 1 ? "" : "s"}</span>}
            </div>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 7px",
              borderRadius: 999,
              background: `${statusChip.tone}14`,
              color: statusChip.tone,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            <StatusIcon style={{ width: 9, height: 9 }} strokeWidth={2.4} />
            {statusChip.label}
          </span>
        </div>

        {/* Body — inline editable */}
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft(body);
                setEditing(false);
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commitEdit();
              }
              e.stopPropagation();
            }}
            onPointerDown={stopEventPropagation}
            placeholder="Write your comment…"
            style={{
              marginTop: 10,
              flex: 1,
              resize: "none",
              border: `1px solid ${appleVibe.stroke.soft}`,
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 12.5,
              lineHeight: 1.45,
              fontFamily: appleVibe.font.stack,
              color: appleVibe.text.primary,
              outline: "none",
              background: "#FFFFFF",
            }}
          />
        ) : (
          <div
            onPointerDown={stopEventPropagation}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
              window.setTimeout(() => textareaRef.current?.focus(), 30);
            }}
            title="Double-click to edit"
            style={{
              marginTop: 10,
              fontSize: 12.5,
              fontWeight: 420,
              lineHeight: 1.5,
              color: body ? appleVibe.text.secondary : appleVibe.text.faint,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 6,
              WebkitBoxOrient: "vertical",
              flex: 1,
              cursor: "text",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {body || "Double-click to write…"}
          </div>
        )}

        {/* Action toolbar */}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={runAnalyze}
            disabled={busyAnalyze}
            title="Analyze on board"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px",
              borderRadius: 999,
              border: "none",
              background: color,
              color: "#FFFFFF",
              fontSize: 11,
              fontWeight: 650,
              fontFamily: appleVibe.font.stack,
              cursor: busyAnalyze ? "wait" : "pointer",
              opacity: busyAnalyze ? 0.7 : 1,
            }}
          >
            <Sparkles style={{ width: 12, height: 12 }} strokeWidth={2.2} />
            {busyAnalyze ? "Analyzing…" : "Analyze"}
          </button>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={() =>
              dispatchCommentResolveToggle(shape.props.commentId, shape.id as string)
            }
            title={status === "resolved" ? "Re-open" : "Mark resolved"}
            style={ghostBtn}
          >
            <Check style={{ width: 12, height: 12 }} strokeWidth={2.2} />
            {status === "resolved" ? "Re-open" : "Resolve"}
          </button>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={() => dispatchCommentDelete(shape.props.commentId, shape.id as string)}
            title="Delete comment"
            style={{ ...ghostBtn, marginLeft: "auto", color: "#B91C1C" }}
          >
            <Trash2 style={{ width: 12, height: 12 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 10px",
  borderRadius: 999,
  border: `1px solid ${appleVibe.stroke.soft}`,
  background: "transparent",
  color: appleVibe.text.secondary,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: appleVibe.font.stack,
  cursor: "pointer",
};
