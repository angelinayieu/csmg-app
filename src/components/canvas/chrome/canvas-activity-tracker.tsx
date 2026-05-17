"use client";

// ── CanvasActivityTracker (cinematic Phase 3) ─────────────────────
//
// Watches the tldraw editor store for shape-creation bursts and
// toggles a `data-canvas-unfurl-active="true"` attribute on the
// document body during the active window. A CSS rule in globals.css
// dims chrome elements tagged with `.chrome-dimmable` while the
// attribute is present.
//
// The intent is purely cinematic: during the pipeline unfurl (T+2s
// to T+75s in the typical run timeline) the canvas is busy materializing
// shapes — entities, edges, rooms, synthesis cards, the twin. The
// user's attention should be on THAT, not on the surrounding chrome
// (Connect / Snapshots / Add Room / glass dock). Demoting chrome to
// ~40% opacity removes it from the foreground without removing the
// affordance — the user can still see and use it.
//
// Detection rule: any shape added → mark active, reset a 4s settle
// timer. When the timer fires without interruption, mark inactive
// (chrome restores).
//
// Lives inside the InFrontOfTheCanvas tree so it gets useEditor()
// without prop-drilling.

import { useEffect, useRef } from "react";
import { useEditor } from "tldraw";

const SETTLE_DELAY_MS = 4000;
const BODY_ATTR = "data-canvas-unfurl-active";

export function CanvasActivityTracker() {
  const editor = useEditor();
  const settleTimerRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);

  useEffect(() => {
    if (!editor) return;
    if (typeof document === "undefined") return;

    const setActive = (next: boolean) => {
      if (isActiveRef.current === next) return;
      isActiveRef.current = next;
      if (next) {
        document.body.setAttribute(BODY_ATTR, "true");
      } else {
        document.body.removeAttribute(BODY_ATTR);
      }
    };

    const bumpActivity = () => {
      setActive(true);
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(() => {
        setActive(false);
        settleTimerRef.current = null;
      }, SETTLE_DELAY_MS);
    };

    const unlisten = editor.store.listen(
      (entry) => {
        // Only fires on additions of `shape` records. Removals,
        // updates, and binding changes don't count — they're not
        // the "system is materializing" signal we want to track.
        const additions = Object.values(entry.changes.added);
        let shapeAdded = false;
        for (const record of additions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = record as any;
          if (r?.typeName === "shape") {
            shapeAdded = true;
            break;
          }
        }
        if (shapeAdded) bumpActivity();
      },
      { scope: "all", source: "all" },
    );

    return () => {
      unlisten();
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      // Clear the body attribute on unmount so navigation to a
      // non-canvas route doesn't leave chrome dimmed elsewhere.
      document.body.removeAttribute(BODY_ATTR);
    };
  }, [editor]);

  return null;
}
