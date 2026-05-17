"use client";

// ── CanvasSceneDirector (cinematic Phase 4) ───────────────────────
//
// Turns "lots of animations happening" into "I am being shown a
// story." The director maintains a queue of pending "spotlight"
// moments — when a high-value shape lands on the canvas, instead
// of the user noticing it in their peripheral vision, the camera
// pans to it, holds, then returns to the wide view.
//
// What gets spotlighted (configured in SPOTLIGHT_CONFIG below):
//
//   synthesis-card        — Bottleneck / leverage / risk / cycle /
//                           bridge / insight. The AI's analytical
//                           conclusions. The biggest "this is the
//                           takeaway" moments in the pipeline.
//
//   hypothesis-ladder     — Cause→effect chains. The structured
//                           argument form that justifies a strategy.
//
//   strategy-hero-card    — The strategy crystallization. Lands
//                           late in the run; tells the user "here's
//                           the decisive plan."
//
// Sequence per spotlight (1.5s holds, ~3.2s total per moment):
//   T+0     — zoom + pan to the target shape (800ms easeInOutQuart)
//   T+0.8s  — hold (1500ms) — user reads the shape
//   T+2.3s  — zoom back to fit (700ms easeInOutQuart)
//   T+3.0s  — settle delay before next spotlight (200ms breath)
//
// Coordination rules:
//   - Mutual exclusion with CanvasTwinRevealOrchestrator. If the
//     twin reveal is active (we detect via the `data-canvas-twin-
//     reveal-active` body attribute it sets), we PAUSE the queue
//     until the twin moment finishes.
//   - Idempotent per shape ID — if the same shape gets added twice
//     (re-spawn, store-replay), we only spotlight it once per
//     mount lifetime.
//   - User-pan detection: if the user touches the camera during a
//     spotlight, the spotlight is cancelled and the queue continues.
//     (Not implemented in v1; we trust the user not to pan during
//     a 3-second moment. Easy to add later via editor.getCamera()
//     polling against our last-set camera.)
//   - Reduced-motion: spotlights still happen but with 0ms
//     animation durations (instant cuts) so the FUNCTION (drawing
//     attention to a shape) survives without the motion.
//
// Lives inside the InFrontOfTheCanvas tree so it gets useEditor().

import { useEffect, useRef } from "react";
import { useEditor, type Editor, type TLShapeId } from "tldraw";

interface SpotlightConfig {
  /** tldraw shape `.type` to spotlight. */
  shapeType: string;
  /** Higher priority items move to the front of the queue. */
  priority: number;
  /** ms to hold the camera on the shape so the user can read it. */
  holdMs: number;
  /** Padding added to the shape's bounds during zoom-in (extra
   *  room around the shape so it doesn't crowd the viewport). */
  pad: number;
}

const SPOTLIGHT_CONFIG: SpotlightConfig[] = [
  // Highest priority — the AI's analytical conclusions deserve the
  // most attention. The pipeline emits bottleneck → leverage → risk
  // in that order, so the queue's FIFO behavior preserves narrative
  // flow.
  { shapeType: "synthesis-card", priority: 3, holdMs: 1500, pad: 120 },
  // High — strategy crystallization is the climax of pipeline runs
  // that don't culminate in a twin (e.g., brainstorm modes).
  { shapeType: "strategy-hero-card", priority: 3, holdMs: 1800, pad: 140 },
  // Medium — hypothesis ladders carry causal structure. Worth a
  // moment but shorter than synthesis since they're more visual.
  { shapeType: "hypothesis-ladder", priority: 2, holdMs: 1200, pad: 120 },
];

function findConfig(shapeType: string): SpotlightConfig | null {
  return SPOTLIGHT_CONFIG.find((c) => c.shapeType === shapeType) ?? null;
}

const ZOOM_IN_MS = 800;
const ZOOM_OUT_MS = 700;
const BREATH_MS = 200;

interface QueueItem {
  shapeId: TLShapeId;
  config: SpotlightConfig;
}

export function CanvasSceneDirector() {
  const editor = useEditor();
  const queueRef = useRef<QueueItem[]>([]);
  const seenShapeIdsRef = useRef<Set<string>>(new Set());
  const isProcessingRef = useRef(false);
  const timeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!editor) return;
    if (typeof document === "undefined") return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const clearTimeouts = () => {
      for (const id of timeoutsRef.current) window.clearTimeout(id);
      timeoutsRef.current = [];
    };

    const scheduleTimeout = (fn: () => void, delay: number) => {
      const id = window.setTimeout(fn, delay);
      timeoutsRef.current.push(id);
      return id;
    };

    /** True if the twin reveal orchestrator is currently animating —
     *  we pause our queue while it owns the camera. */
    const twinRevealActive = (): boolean =>
      document.body.hasAttribute("data-canvas-twin-reveal-active");

    /** Run a single spotlight against a target shape. Resolves when
     *  the camera has fully returned to fit-view + the post-spotlight
     *  breath has elapsed. */
    const runSpotlight = (item: QueueItem): Promise<void> =>
      new Promise((resolve) => {
        const { shapeId, config } = item;
        try {
          // Mark director-active on the body so other orchestrators
          // (twin reveal) can detect overlap and defer to us.
          document.body.setAttribute(
            "data-canvas-scene-director-active",
            "true",
          );

          const bounds = editor.getShapePageBounds(shapeId);
          if (!bounds) {
            resolve();
            return;
          }
          // Pad the bounds so the shape doesn't press against the
          // viewport edges during the spotlight.
          const padded = {
            x: bounds.x - config.pad,
            y: bounds.y - config.pad,
            w: bounds.w + config.pad * 2,
            h: bounds.h + config.pad * 2,
          };
          editor.zoomToBounds(padded, {
            animation: {
              duration: reducedMotion ? 0 : ZOOM_IN_MS,
              easing: easeInOutQuart,
            },
            inset: 0,
          });
        } catch (err) {
          console.warn("[scene-director] zoomToBounds failed:", err);
          resolve();
          return;
        }

        // Phase: hold the camera on the shape
        scheduleTimeout(
          () => {
            // Phase: zoom back to fit-all
            try {
              editor.zoomToFit({
                animation: {
                  duration: reducedMotion ? 0 : ZOOM_OUT_MS,
                  easing: easeInOutQuart,
                },
              });
            } catch {
              // No-op — if fit fails the camera just stays on the
              // spotlight target. Better than a crash.
            }

            // Phase: breath before next spotlight
            scheduleTimeout(() => {
              document.body.removeAttribute(
                "data-canvas-scene-director-active",
              );
              resolve();
            }, ZOOM_OUT_MS + BREATH_MS);
          },
          ZOOM_IN_MS + config.holdMs,
        );
      });

    /** Process the queue. Re-entrant-safe via isProcessingRef. */
    const processQueue = async () => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      try {
        while (queueRef.current.length > 0) {
          // If the twin reveal grabs the camera, wait for it.
          // Poll every 200ms — cheap and only runs during contention.
          while (twinRevealActive()) {
            await new Promise((r) => window.setTimeout(r, 200));
          }
          const next = queueRef.current.shift();
          if (!next) break;
          // Verify shape still exists — could have been deleted
          // between enqueue and dequeue.
          const stillThere = editor.getShape(next.shapeId);
          if (!stillThere) continue;
          await runSpotlight(next);
        }
      } finally {
        isProcessingRef.current = false;
      }
    };

    const enqueue = (shapeId: TLShapeId, config: SpotlightConfig) => {
      // Dedupe — same shape spawning twice (re-paint, history replay)
      // shouldn't spotlight twice in one session.
      const key = String(shapeId);
      if (seenShapeIdsRef.current.has(key)) return;
      seenShapeIdsRef.current.add(key);

      // Insert by priority (higher first), preserving FIFO within
      // a priority tier so the bottleneck → leverage → risk ordering
      // the pipeline emits is preserved.
      const item: QueueItem = { shapeId, config };
      const insertIdx = queueRef.current.findIndex(
        (q) => q.config.priority < config.priority,
      );
      if (insertIdx === -1) queueRef.current.push(item);
      else queueRef.current.splice(insertIdx, 0, item);

      // Kick off processing if not already running.
      void processQueue();
    };

    const unlisten = editor.store.listen(
      (entry) => {
        for (const record of Object.values(entry.changes.added)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = record as any;
          if (r?.typeName !== "shape") continue;
          const config = findConfig(r.type);
          if (!config) continue;
          enqueue(r.id as TLShapeId, config);
        }
      },
      { scope: "all", source: "all" },
    );

    return () => {
      unlisten();
      clearTimeouts();
      queueRef.current = [];
      document.body.removeAttribute("data-canvas-scene-director-active");
    };
  }, [editor]);

  return null;
}

// ── easing ──
function easeInOutQuart(t: number): number {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}
