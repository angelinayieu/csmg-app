"use client";

// ── useZoomTransition ─────────────────────────────────────────────
//
// Phase 12.A (12.A.7). The canvas ⇄ room "zoom" feel. True
// shared-element transitions (framer-motion `layoutId`) can't span a
// Next.js App Router navigation — the source tree unmounts and the
// destination mounts across a server round-trip. So instead of fighting
// that, we coordinate TWO animations on either side of the nav:
//
//   • Source side (here): a "bloom" — an accent-colored veil that grows
//     out of the clicked node to fill the viewport, then fades. On
//     completion we run the navigation callback.
//   • Destination side (RoomAltitudeMap / CanvasAltitudeMap): a quick
//     scale + fade-in on mount, so arriving reads as "landing inside."
//
// Together they give a continuous zoom illusion without experimental
// View-Transition config or cross-route layoutId. Honors prefers-
// reduced-motion: when set, we skip the bloom and navigate immediately.

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ZoomState {
  rect: Rect;
  color: string;
  /** Scale factor that guarantees the veil covers the viewport even
   *  when the source node sits near an edge. */
  scale: number;
}

export interface ZoomTransition {
  /** Fire the bloom from `rect` in `color`, then run `onComplete`
   *  (typically the navigation). */
  trigger: (rect: Rect, color: string, onComplete: () => void) => void;
  /** Render this somewhere in the consumer's tree (it's position:fixed,
   *  so placement doesn't matter). */
  overlay: React.ReactNode;
}

export function useZoomTransition(): ZoomTransition {
  const reduce = useReducedMotion();
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const cbRef = useRef<(() => void) | null>(null);

  const trigger = useCallback(
    (rect: Rect, color: string, onComplete: () => void) => {
      if (reduce || typeof window === "undefined") {
        onComplete();
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Generous factor so an off-center node's bloom still covers the
      // screen before it fades.
      const scale =
        2.4 *
        Math.max(vw / Math.max(rect.width, 1), vh / Math.max(rect.height, 1));
      cbRef.current = onComplete;
      setZoom({ rect, color, scale });
    },
    [reduce],
  );

  const overlay = (
    <AnimatePresence>
      {zoom ? (
        <motion.div
          key="zoom-bloom"
          initial={{ scale: 1, opacity: 0.16 }}
          animate={{ scale: zoom.scale, opacity: [0.16, 0.42, 0] }}
          transition={{ duration: 0.34, ease: [0.4, 0, 0.2, 1] }}
          onAnimationComplete={() => {
            const cb = cbRef.current;
            cbRef.current = null;
            setZoom(null);
            cb?.();
          }}
          style={{
            position: "fixed",
            top: zoom.rect.top,
            left: zoom.rect.left,
            width: zoom.rect.width,
            height: zoom.rect.height,
            background: zoom.color,
            borderRadius: 14,
            transformOrigin: "center",
            zIndex: 9999,
            pointerEvents: "none",
            willChange: "transform, opacity",
          }}
        />
      ) : null}
    </AnimatePresence>
  );

  return { trigger, overlay };
}
