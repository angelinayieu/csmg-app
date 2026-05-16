// ── useParallax ──
//
// Applies a subtle 3D tilt to the target element based on global
// cursor position. The element rotates around its center such that
// the corner farthest from the cursor tips slightly toward the viewer
// — the same gentle "responding to where you're looking" affordance
// visionOS uses on floating panels.
//
// The motion is intentionally restrained: max 0.5° on each axis by
// default. Anything more starts to feel gimmicky.
//
// Wired off automatically when:
//   - The user has `prefers-reduced-motion: reduce` set
//   - The device is touch-primary (no hover support)
//
// Animation runs on RAF with an exponential follow toward the target
// tilt, so the panel eases into position rather than snapping. When
// the cursor leaves the viewport (or the tab loses focus) the target
// returns to 0,0 and the panel settles flat.

"use client";

import { useEffect, type RefObject } from "react";

interface ParallaxOptions {
  /** Max degrees of tilt on each axis. Default 0.5. */
  maxTiltDeg?: number;
  /** Perspective distance for the 3D projection. Default 1200px. */
  perspective?: number;
  /** Easing factor 0-1; higher = snappier. Default 0.08. */
  followSpeed?: number;
  /** Opt out of the effect without removing the hook. Default true. */
  enabled?: boolean;
}

export function useParallax(
  ref: RefObject<HTMLElement | null>,
  options: ParallaxOptions = {},
) {
  const {
    maxTiltDeg = 0.5,
    perspective = 1200,
    followSpeed = 0.08,
    enabled = true,
  } = options;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    // Guard: respect reduced-motion preference + skip touch devices
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isTouch =
      typeof window !== "undefined" &&
      window.matchMedia("(hover: none)").matches;
    if (prefersReduced || isTouch) return;

    // Render the panel as a 3D-aware layer. Setting transformStyle on
    // the parent (here) lets the child glyph tiles + cards retain
    // their own depth when the parent tilts.
    el.style.transformStyle = "preserve-3d";
    el.style.willChange = "transform";

    let rafId = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const tick = () => {
      currentX += (targetX - currentX) * followSpeed;
      currentY += (targetY - currentY) * followSpeed;
      el.style.transform = `perspective(${perspective}px) rotateY(${currentX.toFixed(3)}deg) rotateX(${(-currentY).toFixed(3)}deg)`;
      // Keep stepping while there's meaningful distance left to travel.
      if (
        Math.abs(currentX - targetX) > 0.002 ||
        Math.abs(currentY - targetY) > 0.002
      ) {
        rafId = requestAnimationFrame(tick);
      } else {
        // Snap exactly to target and stop; avoids forever-running RAF.
        currentX = targetX;
        currentY = targetY;
        el.style.transform = `perspective(${perspective}px) rotateY(${targetX.toFixed(3)}deg) rotateX(${(-targetY).toFixed(3)}deg)`;
        rafId = 0;
      }
    };

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      // Compute cursor distance from the element's center, normalized
      // to a [-1, +1] range using a 2.5× viewport "reach radius" so
      // movement outside the panel still produces meaningful tilt —
      // makes the panel feel like it's tracking the entire room, not
      // just hover-state on itself.
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const reachX = Math.max(rect.width / 2, window.innerWidth / 2);
      const reachY = Math.max(rect.height / 2, window.innerHeight / 2);
      const nx = (e.clientX - cx) / reachX;
      const ny = (e.clientY - cy) / reachY;
      // Clamp + scale to maxTiltDeg
      targetX = Math.max(-1, Math.min(1, nx)) * maxTiltDeg;
      targetY = Math.max(-1, Math.min(1, ny)) * maxTiltDeg;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    const settle = () => {
      // Cursor left the viewport or tab lost focus — return to flat
      targetX = 0;
      targetY = 0;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", settle);
    window.addEventListener("blur", settle);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", settle);
      window.removeEventListener("blur", settle);
      if (rafId) cancelAnimationFrame(rafId);
      // Reset inline styles so the element doesn't get stuck tilted
      // if the hook unmounts mid-animation.
      el.style.transform = "";
      el.style.willChange = "";
    };
  }, [ref, enabled, maxTiltDeg, perspective, followSpeed]);
}
