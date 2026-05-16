"use client";

// ── CanvasShapeGlass ─────────────────────────────────────────────────
//
// The canonical glass surface for tldraw canvas shapes. Replaces the
// 34+ hand-rolled background+blur+border+boxShadow recipes scattered
// across individual shape files (room-shape, situation-card,
// origin-prompt, kg-node, probability-space-shell, final-plan-card,
// strategy-hero-card, mechanism-card, …).
//
// Why a canvas-specific primitive instead of <GlassPanel> directly:
//   1. Canvas shapes have an accent-aware top-edge wash that GlassPanel
//      doesn't model (it's the visual signature that says "this card
//      belongs to a stage / mode").
//   2. Canvas shapes have a tri-state (pending / active / complete)
//      that drives border tint + optional breathing ring — same idiom
//      across rooms, probability shells, proposal cards.
//   3. Mount entrance is standardized via the `canvas-shape-enter`
//      keyframe in globals.css; previously each shape carried its own
//      <style jsx> block.
//
// All visual decisions route through CSS variables defined in
// globals.css (--glass-*, --blur-*, --shadow-*, --accent-fill-*).
// No new tokens are introduced.

import { forwardRef, useMemo } from "react";
import { cn } from "@/lib/utils";

export type CanvasShapeTier = "plate" | "card" | "float";
export type CanvasShapeState = "pending" | "active" | "complete";
export type CanvasShapeTopAccent = "none" | "soft" | "medium";

export interface CanvasShapeGlassProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "color"> {
  /** Elevation tier. plate=flush (kg nodes), card=standard (most
   *  shapes), float=elevated (rooms). */
  tier?: CanvasShapeTier;
  /** Hex accent. Drives border tint, optional top wash, active-state
   *  ring. Falls back to `var(--canvas-accent)` when not supplied so
   *  the per-mode accent picks up automatically. */
  accent?: string;
  /** Lifecycle hint. `active` adds a breathing-ring tint + slightly
   *  stronger accent border. `complete` quiets the border. `pending`
   *  is the default settled state. */
  state?: CanvasShapeState;
  /** Top-edge accent wash. soft = barely-there color identity (rooms),
   *  medium = visible accent gradient (hero cards). */
  topAccent?: CanvasShapeTopAccent;
  /** Corner radius. Defaults per tier (plate:10, card:14, float:28). */
  radius?: number;
  /** Internal padding. Defaults sensible for tier. */
  padding?: string | number;
  /** Apply the one-shot mount entrance animation. Gate this from the
   *  consumer so it only runs on real mounts, not re-renders. */
  entrance?: boolean;
  /** Apply the one-shot data-tick pulse animation. Gate this from the
   *  consumer so it runs on subtitle/count changes only. */
  pulsing?: boolean;
  children?: React.ReactNode;
}

const TIER_DEFAULTS: Record<
  CanvasShapeTier,
  {
    bg: string;
    blur: string;
    border: string;
    radius: number;
    padding: string;
    shadow: string;
  }
> = {
  plate: {
    bg: "var(--glass-plate-bg)",
    blur: "blur(var(--blur-plate)) saturate(1.4)",
    border: "var(--glass-hairline)",
    radius: 10,
    padding: "8px 10px",
    shadow: "var(--shadow-plate)",
  },
  card: {
    bg: "var(--glass-card-bg)",
    blur: "blur(var(--blur-card)) saturate(1.5)",
    border: "var(--glass-border)",
    radius: 14,
    padding: "12px 14px",
    shadow: "var(--shadow-card)",
  },
  float: {
    bg: "var(--glass-float-bg)",
    blur: "blur(var(--blur-float)) saturate(1.5)",
    border: "var(--glass-border)",
    radius: 28,
    padding: "20px 28px 24px",
    shadow: "var(--shadow-float)",
  },
};

export const CanvasShapeGlass = forwardRef<
  HTMLDivElement,
  CanvasShapeGlassProps
>(function CanvasShapeGlass(
  {
    tier = "card",
    accent,
    state = "pending",
    topAccent = "none",
    radius,
    padding,
    entrance,
    pulsing,
    className,
    style,
    children,
    ...rest
  },
  ref,
) {
  const defaults = TIER_DEFAULTS[tier];
  // When no accent supplied, route through the mode-level CSS var.
  // CanvasAccentProvider sets --canvas-accent on a wrapping div; the
  // value falls back to --accent-500 (system blue) when no provider
  // is mounted, so out-of-canvas usage stays sane.
  const effectiveAccent = accent ?? "var(--canvas-accent, var(--accent-500))";

  const finalRadius = radius ?? defaults.radius;
  const finalPadding = padding ?? defaults.padding;

  // Border: stronger tint on active, hairline on pending/complete.
  const borderColor =
    state === "active"
      ? `color-mix(in srgb, ${effectiveAccent} calc(var(--accent-border-strong) * 100%), transparent)`
      : defaults.border;

  // Shadow recipe: tier default + always-on top-edge highlight + accent
  // glow only on active. Layered so depth reads correctly at any zoom.
  const shadow = useMemo(() => {
    const parts = [
      defaults.shadow,
      "inset 0 1px 0 var(--glass-highlight)",
    ];
    if (state === "active") {
      parts.push(
        `0 0 0 6px color-mix(in srgb, ${effectiveAccent} calc(var(--accent-fill-soft) * 100%), transparent)`,
      );
    }
    return parts.join(", ");
  }, [defaults.shadow, state, effectiveAccent]);

  // Top accent wash: a radial gradient that paints the upper edge with
  // the accent color, fading to neutral. Only renders when requested —
  // most shapes use `none` and rely on the border for color identity.
  const background = useMemo(() => {
    if (topAccent === "none") return defaults.bg;
    const intensity = topAccent === "soft" ? 6 : 12;
    const reach = topAccent === "soft" ? 60 : 70;
    return `radial-gradient(ellipse 70% 50% at 50% 0%,
              color-mix(in srgb, ${effectiveAccent} ${intensity}%, transparent) 0%,
              transparent ${reach}%),
            ${defaults.bg}`;
  }, [topAccent, defaults.bg, effectiveAccent]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative",
        entrance && "canvas-shape-enter",
        pulsing && "canvas-shape-pulse",
        className,
      )}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: finalRadius,
        background,
        backdropFilter: defaults.blur,
        WebkitBackdropFilter: defaults.blur,
        border: `1px solid ${borderColor}`,
        boxShadow: shadow,
        padding: finalPadding,
        transition:
          "border 220ms var(--ease-spring-tight), box-shadow 220ms var(--ease-spring-tight)",
        overflow: "hidden",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});
