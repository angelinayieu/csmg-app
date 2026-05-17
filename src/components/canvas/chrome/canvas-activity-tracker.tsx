"use client";

// ── CanvasActivityTracker (cinematic Phases 3 + 5) ─────────────────
//
// Two-job orchestrator. Both jobs key off the same signal — "are
// shapes being added to the editor right now" — but serve different
// cinematic moments.
//
// Phase 3: chrome dimming during unfurl.
//   While shapes are being added in a burst (pipeline materialization,
//   manual auth, etc.) we set `data-canvas-unfurl-active="true"` on
//   the body. A CSS rule in globals.css demotes elements tagged with
//   `.chrome-dimmable` to ~40% opacity so the user's attention stays
//   on the canvas materialization, not the surrounding chrome. The
//   attribute clears 4 seconds after the last shape-add.
//
// Phase 5: auto-fit camera on settle.
//   When the settle timer fires AND the just-ended burst was
//   substantial (5+ shapes added), we also call editor.zoomToFit so
//   the user sees the whole landscape without having to pan. Brief
//   shape adds (e.g., a single sticky note) don't trigger the fit —
//   it would feel intrusive. Substantial unfurls do.
//
// Both jobs respect prefers-reduced-motion via the CSS transition
// suppression and the animation duration override below.
//
// Lives inside the InFrontOfTheCanvas tree so it gets useEditor()
// without prop-drilling.

import { useEffect, useRef } from "react";
import { useEditor } from "tldraw";

const SETTLE_DELAY_MS = 4000;
const BODY_ATTR = "data-canvas-unfurl-active";

/** Auto-fit threshold — number of shape adds in a burst before the
 *  settle handler will call zoomToFit. Calibrated so single-shape
 *  user gestures (drag a sticky on, hand-place a subject card)
 *  never trigger the auto-fit; pipeline unfurls (which add dozens
 *  of shapes) always do. */
const AUTO_FIT_THRESHOLD = 5;

/** Camera fit animation duration. 800ms reads as "settling" rather
 *  than abruptly snapping; matches the chrome restore transition
 *  cadence (600ms) so they feel like one coordinated moment. */
const AUTO_FIT_DURATION_MS = 800;

export function CanvasActivityTracker() {
  const editor = useEditor();
  const settleTimerRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);
  /** Number of shape additions accumulated since the last settle.
   *  Used by Phase 5 to decide whether the burst was substantial
   *  enough to warrant an auto-fit. */
  const burstShapeCountRef = useRef(0);

  useEffect(() => {
    if (!editor) return;
    if (typeof document === "undefined") return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const setActive = (next: boolean) => {
      if (isActiveRef.current === next) return;
      isActiveRef.current = next;
      if (next) {
        document.body.setAttribute(BODY_ATTR, "true");
      } else {
        document.body.removeAttribute(BODY_ATTR);
      }
    };

    /** Phase 5 — fit the viewport to the canvas content. Called
     *  ONLY when the just-ended burst was substantial. Wrapped in
     *  try/catch because tldraw's zoomToFit will throw if the page
     *  has no shapes (e.g., on a fresh empty canvas). */
    const autoFit = () => {
      try {
        // Skip if there are literally no shapes (zoomToFit would
        // either no-op or zoom out indefinitely).
        const shapes = editor.getCurrentPageShapes();
        if (shapes.length === 0) return;
        editor.zoomToFit({
          animation: {
            duration: reducedMotion ? 0 : AUTO_FIT_DURATION_MS,
          },
        });
      } catch (err) {
        console.warn("[canvas-activity-tracker] autoFit failed:", err);
      }
    };

    const bumpActivity = (countAdded: number) => {
      setActive(true);
      burstShapeCountRef.current += countAdded;
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(() => {
        setActive(false);
        settleTimerRef.current = null;

        // Phase 5 — auto-fit if the burst was substantial. Capture
        // + reset the count before calling autoFit so a fast
        // burst-during-fit doesn't double-trigger.
        const burstSize = burstShapeCountRef.current;
        burstShapeCountRef.current = 0;
        if (burstSize >= AUTO_FIT_THRESHOLD) {
          autoFit();
        }
      }, SETTLE_DELAY_MS);
    };

    const unlisten = editor.store.listen(
      (entry) => {
        // Only fires on additions of `shape` records. Removals,
        // updates, and binding changes don't count — they're not
        // the "system is materializing" signal we want to track.
        const additions = Object.values(entry.changes.added);
        let shapeAddCount = 0;
        for (const record of additions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = record as any;
          if (r?.typeName === "shape") shapeAddCount++;
        }
        if (shapeAddCount > 0) bumpActivity(shapeAddCount);
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
