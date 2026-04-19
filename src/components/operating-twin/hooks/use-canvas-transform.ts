"use client";

import { useState, useCallback, useRef, useEffect, type RefObject } from "react";

export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

export interface UseCanvasTransformResult {
  transform: CanvasTransform;
  setTransform: (t: CanvasTransform) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  isPanning: boolean;
  noTransition: boolean;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const ZOOM_STEP = 0.15;
const WHEEL_STEP = 0.08;

/**
 * Pan & zoom canvas transform hook.
 * Attach `canvasRef` to the outer canvas div (the pannable surface).
 * Apply `transform` via CSS `translate(${x}px, ${y}px) scale(${scale})` on the inner container.
 */
export function useCanvasTransform(
  canvasRef: RefObject<HTMLElement | null>,
): UseCanvasTransformResult {
  const [transform, setTransform] = useState<CanvasTransform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [noTransition, setNoTransition] = useState(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  // ── Pan (mouse drag on blank canvas area) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => {
      // Don't start pan if the click was on a lab card, core ring, or controls
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-pan]")) return;
      setIsPanning(true);
      setNoTransition(true);
      panStartRef.current = {
        x: e.clientX - transform.x,
        y: e.clientY - transform.y,
      };
      e.preventDefault();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    return () => canvas.removeEventListener("mousedown", onMouseDown);
  }, [canvasRef, transform.x, transform.y]);

  useEffect(() => {
    if (!isPanning) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!panStartRef.current) return;
      setTransform((prev) => ({
        ...prev,
        x: e.clientX - (panStartRef.current?.x ?? 0),
        y: e.clientY - (panStartRef.current?.y ?? 0),
      }));
    };
    const onMouseUp = () => {
      setIsPanning(false);
      setNoTransition(false);
      panStartRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isPanning]);

  // ── Wheel zoom (centered on cursor) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-zoom]")) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -WHEEL_STEP : WHEEL_STEP;

      setTransform((prev) => {
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale + delta));
        if (newScale === prev.scale) return prev;
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const k = newScale / prev.scale;
        return {
          x: cx - (cx - prev.x) * k,
          y: cy - (cy - prev.y) * k,
          scale: newScale,
        };
      });
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvasRef]);

  const zoomIn = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.min(MAX_SCALE, prev.scale + ZOOM_STEP) }));
  }, []);

  const zoomOut = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.max(MIN_SCALE, prev.scale - ZOOM_STEP) }));
  }, []);

  const reset = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  return { transform, setTransform, zoomIn, zoomOut, reset, isPanning, noTransition };
}
