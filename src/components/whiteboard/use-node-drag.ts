"use client";

// ── useNodeDrag ──
//
// Pointer-based drag for whiteboard nodes. The canvas has pan/zoom applied
// via CSS transform, so raw client pixels need to be scaled by the inverse
// transform to produce correct delta-in-canvas-pixels.
//
// Usage:
//   const onDragStart = useNodeDrag({
//     getScale: () => transform.scale,
//     onMove: (entityId, nextX, nextY) => { ... },
//     onEnd:  (entityId, finalX, finalY) => { ... },
//   });
//   <div onPointerDown={e => onDragStart(e, entityId, initialX, initialY)}>

import { useCallback, useRef } from "react";

export interface NodeDragOptions {
  /** Read the current canvas scale when a drag starts (captured once). */
  getScale: () => number;
  /** Called continuously during a drag with the next canvas-space position. */
  onMove: (entityId: string, x: number, y: number) => void;
  /** Called once when the drag ends. */
  onEnd?: (entityId: string, finalX: number, finalY: number) => void;
  /** Minimum pointer travel (in screen px) before drag actually starts — below this, treat as a click. */
  dragThreshold?: number;
}

export function useNodeDrag({ getScale, onMove, onEnd, dragThreshold = 3 }: NodeDragOptions) {
  const activeRef = useRef<null | {
    entityId: string;
    startClientX: number;
    startClientY: number;
    startNodeX: number;
    startNodeY: number;
    scale: number;
    dragging: boolean;
  }>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent, entityId: string, initialX: number, initialY: number) => {
      // Only respond to primary button / touch
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.stopPropagation();

      activeRef.current = {
        entityId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startNodeX: initialX,
        startNodeY: initialY,
        scale: getScale(),
        dragging: false,
      };

      const handleMove = (ev: PointerEvent) => {
        const state = activeRef.current;
        if (!state) return;
        const dxScreen = ev.clientX - state.startClientX;
        const dyScreen = ev.clientY - state.startClientY;

        if (!state.dragging) {
          const travel = Math.hypot(dxScreen, dyScreen);
          if (travel < dragThreshold) return;
          state.dragging = true;
        }

        // Scale screen-space delta to canvas-space delta
        const nextX = state.startNodeX + dxScreen / state.scale;
        const nextY = state.startNodeY + dyScreen / state.scale;
        onMove(state.entityId, nextX, nextY);
      };

      const handleUp = (ev: PointerEvent) => {
        const state = activeRef.current;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        if (!state) return;
        if (state.dragging) {
          const dxScreen = ev.clientX - state.startClientX;
          const dyScreen = ev.clientY - state.startClientY;
          const finalX = state.startNodeX + dxScreen / state.scale;
          const finalY = state.startNodeY + dyScreen / state.scale;
          onEnd?.(state.entityId, finalX, finalY);
        }
        activeRef.current = null;
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [getScale, onMove, onEnd, dragThreshold],
  );

  return onDragStart;
}
