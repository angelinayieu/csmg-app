"use client";

// ── useGroupFrameReflow ─────────────────────────────────────────────────
//
// Keeps a grouping underlay (sys-frame) fitted to its member cards as you
// rearrange them, so the group stays coherent instead of detaching from a
// static box. Listens to the store ONLY for deliberate user drag/resize
// (`select.translating` / `select.resizing`) — restore + remote sync run idle,
// so this never fires during a snapshot load and never fights the board loader
// (the restore-buffer hazard behind "cards disappearing"). Non-destructive: a
// card yanked far from the group is excluded from the fit (so one pulled card
// can't balloon the frame) but is NOT removed from membership — drag it back and
// it rejoins. Frame self-updates are ignored, so the resize can't loop.

import { useEffect } from "react";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import {
  groupFrameRect,
  type ForkGroupMeta,
} from "./group-frame";

/** A member whose center is farther than this from the group's median center is
 *  treated as "pulled out" and left out of the frame fit. */
const OUTLIER_DIST = 520;

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Refit one frame to the (inlier) members it wraps. No-ops when nothing moved
 *  enough to matter, so it doesn't churn the store mid-drag. */
function reflowFrame(editor: Editor, frame: TLShape): void {
  const meta = frame.meta as Partial<ForkGroupMeta>;
  if (!meta?.forkGroup || !Array.isArray(meta.memberIds)) return;

  const boxes = meta.memberIds
    .map((id) => editor.getShapePageBounds(id as TLShapeId))
    .filter((b): b is NonNullable<typeof b> => !!b);
  if (boxes.length < 2) return; // nothing meaningful left to wrap

  // Drop an outlier yanked far from the cluster so it doesn't balloon the frame.
  const mcx = median(boxes.map((b) => (b.minX + b.maxX) / 2));
  const mcy = median(boxes.map((b) => (b.minY + b.maxY) / 2));
  let inliers = boxes.filter(
    (b) =>
      Math.hypot((b.minX + b.maxX) / 2 - mcx, (b.minY + b.maxY) / 2 - mcy) <=
      OUTLIER_DIST,
  );
  if (inliers.length < 2) inliers = boxes; // never let the frame vanish

  const rect = groupFrameRect(inliers);
  if (!rect) return;

  const cur = editor.getShapePageBounds(frame.id);
  if (
    cur &&
    Math.abs(cur.x - rect.x) < 1 &&
    Math.abs(cur.y - rect.y) < 1 &&
    Math.abs(cur.w - rect.w) < 1 &&
    Math.abs(cur.h - rect.h) < 1
  ) {
    return; // already fitted — skip the no-op update
  }

  editor.updateShape({
    id: frame.id,
    type: "sys-frame",
    x: rect.x,
    y: rect.y,
    props: { w: rect.w, h: rect.h },
  });
}

/** Mount once on the board (called by GroupForkConnectorsOverlay) to keep every
 *  grouping underlay fitted to its cards during user drags. */
export function useGroupFrameReflow(editor: Editor): void {
  useEffect(() => {
    const unsub = editor.store.listen(
      (entry) => {
        // Only while the user is actively dragging/resizing — gates out restore,
        // remote sync, and programmatic deploys (all run idle).
        if (
          !editor.isIn("select.translating") &&
          !editor.isIn("select.resizing")
        ) {
          return;
        }

        // Which non-frame shapes actually moved/resized this tick? (Ignoring
        // frame self-updates is what prevents the resize from looping.)
        const moved = new Set<string>();
        for (const [from, to] of Object.values(entry.changes.updated)) {
          if (!to || to.typeName !== "shape") continue;
          const cur = to as TLShape;
          if (cur.type === "sys-frame") continue;
          const prev = from as TLShape;
          const pw = (prev.props as { w?: number }).w;
          const cw = (cur.props as { w?: number }).w;
          const ph = (prev.props as { h?: number }).h;
          const ch = (cur.props as { h?: number }).h;
          if (prev.x !== cur.x || prev.y !== cur.y || pw !== cw || ph !== ch) {
            moved.add(cur.id);
          }
        }
        if (moved.size === 0) return;

        for (const s of editor.getCurrentPageShapes()) {
          if (s.type !== "sys-frame") continue;
          const m = s.meta as Partial<ForkGroupMeta>;
          if (
            Array.isArray(m.memberIds) &&
            m.memberIds.some((id) => moved.has(id))
          ) {
            reflowFrame(editor, s);
          }
        }
      },
      { source: "user", scope: "document" },
    );
    return () => unsub();
  }, [editor]);
}
