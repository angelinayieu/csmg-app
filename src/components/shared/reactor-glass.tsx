"use client";

// Phase 33 — Reactor Glass primitives, ergonomic wrappers.
//
// CSS-level material lives in `src/app/globals.css` under the
// "REACTOR GLASS" section. This file exposes:
//
//   <ReactorGlass>               — a dark-theme spatial panel
//   <ReactorSweep>               — adds a one-shot specular sweep
//   <AtmosphericZoom>            — the canvas→lab handshake scrim
//
// All three are typed, ref-forwarding, and accept `className` so callers
// can extend without re-styling. The underlying CSS is authoritative —
// props just flip `data-*` attributes.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";

export type ReactorElevation = "ambient" | "attentive" | "engaged" | "summoned";
export type ReactorTint = "green" | "cyan" | "amber" | "pink" | "violet";

export interface ReactorGlassProps extends ComponentProps<"div"> {
  /**
   * Elevation stratum. `ambient` (default) is the resting state; higher
   * strata lift the panel, brighten its rim, and deepen the underglow.
   */
  elevation?: ReactorElevation;
  /**
   * Ambient color bleed. Subtle radial gradient beneath the glass.
   * Match the panel's dominant semantic color (layer, reaction type).
   */
  tint?: ReactorTint;
  /**
   * Briefly play a specular sweep across the panel. Flips to `false`
   * after the animation duration so it can fire on re-engage. Tie this
   * to engagement transitions (selection, mode switch) — not to hover,
   * which would thrash.
   */
  sweep?: boolean;
  children?: ReactNode;
}

export const ReactorGlass = forwardRef<HTMLDivElement, ReactorGlassProps>(
  function ReactorGlass(
    { elevation = "ambient", tint, sweep, className, children, ...rest },
    ref,
  ) {
    const classes = [
      "reactor-glass",
      sweep ? "reactor-sweep" : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        ref={ref}
        className={classes}
        data-elevation={elevation === "ambient" ? undefined : elevation}
        data-tint={tint}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

export interface AtmosphericZoomHandle {
  /**
   * Show the scrim centered on a viewport point (pixels from top-left
   * of the window). Returns a cleanup that fades it out.
   */
  show: (x: number, y: number) => () => void;
  /** Force-hide immediately. */
  hide: () => void;
}

/**
 * Full-viewport radial scrim used by Phase 34's canvas→lab handshake.
 * Mount once at app root (or route root). Trigger imperatively with a
 * ref so callers don't have to thread state:
 *
 *   const zoomRef = useRef<AtmosphericZoomHandle>(null);
 *   ...
 *   <AtmosphericZoom ref={zoomRef} />
 *   ...
 *   onClick={(e) => { zoomRef.current?.show(e.clientX, e.clientY); }}
 */
export const AtmosphericZoom = forwardRef<
  AtmosphericZoomHandle,
  { className?: string }
>(function AtmosphericZoom({ className }, ref) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      show(x, y) {
        const el = elRef.current;
        if (!el) return () => {};
        if (hideTimerRef.current) {
          window.clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        el.style.setProperty("--rx", `${(x / w) * 100}%`);
        el.style.setProperty("--ry", `${(y / h) * 100}%`);
        el.dataset.active = "true";
        return () => {
          hideTimerRef.current = window.setTimeout(() => {
            if (elRef.current) elRef.current.dataset.active = "false";
          }, 0);
        };
      },
      hide() {
        if (hideTimerRef.current) {
          window.clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        if (elRef.current) elRef.current.dataset.active = "false";
      },
    }),
    [],
  );

  // Clean up a pending timer if the component unmounts mid-fade.
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  return (
    <div
      ref={elRef}
      className={["reactor-atmospheric-zoom", className]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
      data-active="false"
    />
  );
});
