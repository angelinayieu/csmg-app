"use client";

// ── CommentBoardMount ──────────────────────────────────────────────────
//
// Board-level orchestrator for the comment-card feature. The shape itself
// is pure-render; this mount handles every network round-trip and applies
// the result back onto the canvas:
//
//   · OPEN_BOARD_COMMENT_EVENT (toolbox sphere → "Comment")
//       → snapshot the current selection as targets, POST /comments,
//         drop a fresh comment-card next to the targets (or viewport
//         centre when floating), focus it for editing.
//
//   · COMMENT_BODY_PATCH_EVENT   → PATCH body
//   · COMMENT_RESOLVE_TOGGLE     → PATCH status open ⟷ resolved
//   · COMMENT_DELETE_EVENT       → DELETE row + remove shape (+ strands)
//   · COMMENT_ANALYZE_EVENT      → POST /analyze with target snapshot,
//                                   drop result insight-cards next to the
//                                   comment, persist analysis_card_ids,
//                                   flip status → analyzed.
//
// All writes are optimistic (we patch the shape FIRST, then send) and
// soft-fail (we log + leave the shape in its new visual state — the
// canonical snapshot will catch up on the next page load).

import { useEffect, useRef } from "react";
import { createShapeId, type Editor, type TLShape, type TLShapeId } from "tldraw";
import {
  COMMENT_ANALYZE_EVENT,
  COMMENT_BODY_PATCH_EVENT,
  COMMENT_DELETE_EVENT,
  COMMENT_RESOLVE_TOGGLE_EVENT,
  OPEN_BOARD_COMMENT_EVENT,
  type CommentBodyPatchDetail,
  type CommentEventDetail,
} from "@/components/objective/board-bus";
import type { CommentCardShape, CommentStatus } from "../shapes/comment-card-shape";
import { COMMENT_COLOR } from "../shapes/comment-card-shape";
import type { InsightCardShape } from "../shapes/insight-card-shape";

const COMMENT_W = 304;
const COMMENT_H = 192;
const ANALYSIS_CARD_W = 240;
const ANALYSIS_CARD_H = 132;
const ANALYSIS_GAP = 18;

interface AnalysisCard {
  headline: string;
  body: string;
  role: "angle" | "gap" | "contradiction" | "next-step" | "evidence-need";
}

const ROLE_COLOR: Record<AnalysisCard["role"], string> = {
  angle: "#069494",
  gap: "#FF8243",
  contradiction: "#B91C1C",
  "next-step": "#7C3AED",
  "evidence-need": "#0EA5E9",
};

interface CommentRow {
  id: string;
  spaceId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: string;
  targetShapeIds: string[];
  status: CommentStatus;
  analysisCardIds: string[];
  createdAt: string;
}

// ── shape helpers ────────────────────────────────────────────────────────

function findCommentShape(editor: Editor, shapeId: string): CommentCardShape | null {
  return (
    (editor.getShape(shapeId as TLShapeId) as CommentCardShape | undefined) ?? null
  );
}

function commentShapeByCommentId(editor: Editor, commentId: string): CommentCardShape | null {
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== "comment-card") continue;
    if ((s as CommentCardShape).props.commentId === commentId) {
      return s as CommentCardShape;
    }
  }
  return null;
}

/** Where to anchor a fresh comment so it sits beside (not on top of) its
 *  targets. With no targets, fall back to the viewport centre. */
function anchorPointForTargets(
  editor: Editor,
  targetIds: string[],
): { x: number; y: number } {
  if (targetIds.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let found = false;
    for (const id of targetIds) {
      const b = editor.getShapePageBounds(id as TLShapeId);
      if (!b) continue;
      found = true;
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.w);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (found) {
      // Drop the comment just to the RIGHT of the target group, vertically
      // aligned with its top — close enough to read as paired, far enough
      // not to overlap.
      return { x: maxX + 48, y: minY };
    }
  }
  const v = editor.getViewportPageBounds();
  return { x: v.x + v.w / 2 - COMMENT_W / 2, y: v.y + v.h / 2 - COMMENT_H / 2 };
}

/** Text snapshot of a target shape — what the analyze route will see. */
function shapeToTargetSnap(s: TLShape): { kind: string; title: string; body?: string } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = s.props as any;
  switch (s.type) {
    case "objective-card":
      return { kind: "Objective", title: String(p?.title ?? ""), body: p?.body ? String(p.body) : undefined };
    case "room-card":
      return { kind: "Room", title: String(p?.title ?? ""), body: p?.subtitle ? String(p.subtitle) : undefined };
    case "oc-card":
      return { kind: `Card · ${p?.kind ?? "Card"}`, title: String(p?.name ?? ""), body: p?.body ? String(p.body) : undefined };
    case "insight-card":
      return { kind: "Insight", title: String(p?.headline ?? ""), body: p?.body ? String(p.body) : undefined };
    case "prompt-sharpening":
      return p?.sharpenedPrompt ? { kind: "Sharpened prompt", title: String(p?.title ?? ""), body: String(p.sharpenedPrompt) } : null;
    case "voice-note-card":
      return p?.transcript ? { kind: "Voice note", title: "Voice note", body: String(p.transcript) } : null;
    case "note":
    case "text":
    case "geo": {
      const text = String(p?.text ?? "").trim();
      return text ? { kind: s.type === "note" ? "Sticky note" : s.type === "text" ? "Text" : "Geo", title: text.slice(0, 160) } : null;
    }
    default:
      return null;
  }
}

// ── component ─────────────────────────────────────────────────────────────

export function CommentBoardMount({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor | null;
}) {
  // Bootstrap: pull all existing comments once per (spaceId, editor) and
  // make sure each has a corresponding comment-card on the page. The
  // canonical snapshot persists the shapes; this hydrate is a safety net
  // for rows that exist in the DB but somehow aren't on the page yet
  // (e.g. a fresh open after a brief save crash).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!editor || !spaceId || hydratedRef.current) return;
    hydratedRef.current = true;
    let alive = true;
    fetch(`/api/objective/${spaceId}/comments`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((j) => {
        if (!alive || !Array.isArray(j.comments)) return;
        const known = new Set(
          editor
            .getCurrentPageShapes()
            .filter((s) => s.type === "comment-card")
            .map((s) => (s as CommentCardShape).props.commentId),
        );
        for (const c of j.comments as CommentRow[]) {
          if (known.has(c.id)) continue;
          dropCommentCard(editor, spaceId, c);
        }
      })
      .catch(() => {
        /* hydrate is best-effort */
      });
    return () => {
      alive = false;
    };
  }, [editor, spaceId]);

  // OPEN — toolbox sphere "Comment" pill.
  useEffect(() => {
    if (!editor) return;
    async function onOpen() {
      if (!editor) return;
      const targets = editor
        .getSelectedShapes()
        .filter((s) => s.type !== "comment-card")
        .map((s) => s.id as string)
        .slice(0, 24);
      try {
        const res = await fetch(`/api/objective/${spaceId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "", targetShapeIds: targets }),
        });
        if (!res.ok) throw new Error(`create ${res.status}`);
        const { comment } = (await res.json()) as { comment: CommentRow };
        if (!editor) return;
        dropCommentCard(editor, spaceId, comment);
      } catch (err) {
        console.warn("[comment] create failed", err);
      }
    }
    window.addEventListener(OPEN_BOARD_COMMENT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_BOARD_COMMENT_EVENT, onOpen);
  }, [editor, spaceId]);

  // EDIT body — optimistic patch + PATCH.
  useEffect(() => {
    if (!editor) return;
    function onPatch(e: Event) {
      const d = (e as CustomEvent<CommentBodyPatchDetail>).detail;
      if (!d || !editor) return;
      const shape = findCommentShape(editor, d.shapeId);
      if (shape && shape.props.body !== d.body) {
        editor.updateShape<CommentCardShape>({
          id: shape.id,
          type: "comment-card",
          props: { body: d.body },
        });
      }
      void fetch(`/api/objective/${spaceId}/comments/${d.commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: d.body }),
      }).catch((err) => console.warn("[comment] body patch failed", err));
    }
    window.addEventListener(COMMENT_BODY_PATCH_EVENT, onPatch);
    return () => window.removeEventListener(COMMENT_BODY_PATCH_EVENT, onPatch);
  }, [editor, spaceId]);

  // RESOLVE toggle — flip open ⟷ resolved.
  useEffect(() => {
    if (!editor) return;
    function onResolveToggle(e: Event) {
      const d = (e as CustomEvent<CommentEventDetail>).detail;
      if (!d || !editor) return;
      const shape = findCommentShape(editor, d.shapeId);
      if (!shape) return;
      const next: CommentStatus =
        shape.props.status === "resolved" ? "open" : "resolved";
      editor.updateShape<CommentCardShape>({
        id: shape.id,
        type: "comment-card",
        props: { status: next },
      });
      void fetch(`/api/objective/${spaceId}/comments/${d.commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      }).catch((err) => console.warn("[comment] resolve patch failed", err));
    }
    window.addEventListener(COMMENT_RESOLVE_TOGGLE_EVENT, onResolveToggle);
    return () =>
      window.removeEventListener(COMMENT_RESOLVE_TOGGLE_EVENT, onResolveToggle);
  }, [editor, spaceId]);

  // DELETE — remove shape (strands vanish with it) + delete row.
  useEffect(() => {
    if (!editor) return;
    function onDelete(e: Event) {
      const d = (e as CustomEvent<CommentEventDetail>).detail;
      if (!d || !editor) return;
      editor.deleteShape(d.shapeId as TLShapeId);
      void fetch(`/api/objective/${spaceId}/comments/${d.commentId}`, {
        method: "DELETE",
      }).catch((err) => console.warn("[comment] delete failed", err));
    }
    window.addEventListener(COMMENT_DELETE_EVENT, onDelete);
    return () => window.removeEventListener(COMMENT_DELETE_EVENT, onDelete);
  }, [editor, spaceId]);

  // ANALYZE — the lens extension.
  useEffect(() => {
    if (!editor) return;
    async function onAnalyze(e: Event) {
      const d = (e as CustomEvent<CommentEventDetail>).detail;
      if (!d || !editor) return;
      const shape = findCommentShape(editor, d.shapeId);
      if (!shape) return;

      // Pull target snapshots from the live page.
      const targets = shape.props.targetShapeIds
        .map((id) => editor.getShape(id as TLShapeId) as TLShape | undefined)
        .filter((s): s is TLShape => !!s)
        .map(shapeToTargetSnap)
        .filter((t): t is { kind: string; title: string; body?: string } => !!t);

      try {
        const res = await fetch(
          `/api/objective/${spaceId}/comments/${d.commentId}/analyze`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targets }),
          },
        );
        if (!res.ok) throw new Error(`analyze ${res.status}`);
        const data = (await res.json()) as { cards: AnalysisCard[] };
        const cards = (data.cards ?? []).slice(0, 6);
        if (cards.length === 0) return;

        if (!editor) return;
        // Wipe any prior analysis cluster — re-analyze REPLACES (matches the
        // route doc) rather than stacking, so the comment never grows a
        // hairball. shape.props.targetShapeIds are USER targets, leave them.
        const prevIds = (shape.meta as { analysisCardIds?: string[] })?.analysisCardIds ?? [];
        for (const prevId of prevIds) {
          try {
            editor.deleteShape(prevId as TLShapeId);
          } catch {
            /* shape might already be gone */
          }
        }

        // Drop the new cluster vertically to the RIGHT of the comment card.
        const cBounds = editor.getShapePageBounds(shape.id);
        const ax = (cBounds ? cBounds.x + cBounds.w : shape.x + COMMENT_W) + 56;
        const ay = cBounds ? cBounds.y : shape.y;
        const newIds: string[] = [];
        for (let i = 0; i < cards.length; i++) {
          const c = cards[i];
          const id = createShapeId();
          editor.createShape<InsightCardShape>({
            id,
            type: "insight-card",
            x: ax,
            y: ay + i * (ANALYSIS_CARD_H + ANALYSIS_GAP),
            props: {
              w: ANALYSIS_CARD_W,
              h: ANALYSIS_CARD_H,
              status: "accepted",
              kind: "synthesize",
              role: "single",
              headline: c.headline,
              body: c.body,
              color: ROLE_COLOR[c.role] ?? "#475569",
              sourceIds: [shape.id as string],
              citations: [],
            },
            meta: {
              commentId: shape.props.commentId,
              analysisRole: c.role,
            },
          });
          newIds.push(id as string);
        }

        // Flip the comment to analyzed + remember the cluster IDs (in both
        // the shape's meta so the next re-analyze can clean up AND the DB
        // so a fresh load can do the same).
        editor.updateShape<CommentCardShape>({
          id: shape.id,
          type: "comment-card",
          props: { status: "analyzed" },
          meta: { ...(shape.meta ?? {}), analysisCardIds: newIds },
        });
        void fetch(`/api/objective/${spaceId}/comments/${d.commentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "analyzed",
            analysisCardIds: newIds,
          }),
        }).catch((err) => console.warn("[comment] analyze persist failed", err));
      } catch (err) {
        console.warn("[comment] analyze failed", err);
      }
    }
    window.addEventListener(COMMENT_ANALYZE_EVENT, onAnalyze);
    return () => window.removeEventListener(COMMENT_ANALYZE_EVENT, onAnalyze);
  }, [editor, spaceId]);

  return null;
}

// ── helpers shared between events ────────────────────────────────────────

function dropCommentCard(editor: Editor, spaceId: string, row: CommentRow): void {
  // Don't double-create if the row's shape is already on the page (the
  // hydrate path can race the create path during a refresh).
  if (commentShapeByCommentId(editor, row.id)) return;
  const { x, y } = anchorPointForTargets(editor, row.targetShapeIds);
  const id = createShapeId();
  editor.createShape<CommentCardShape>({
    id,
    type: "comment-card",
    x,
    y,
    props: {
      w: COMMENT_W,
      h: COMMENT_H,
      commentId: row.id,
      spaceId,
      authorName: row.authorName || "You",
      authorAvatarUrl: row.authorAvatarUrl || "",
      body: row.body,
      targetShapeIds: row.targetShapeIds,
      status: row.status,
      createdAtIso: row.createdAt,
      color: COMMENT_COLOR,
    },
    meta: {
      analysisCardIds: row.analysisCardIds,
    },
  });
  editor.select(id);
  editor.centerOnPoint(
    { x: x + COMMENT_W / 2, y: y + COMMENT_H / 2 },
    { animation: { duration: 240 } },
  );
}
