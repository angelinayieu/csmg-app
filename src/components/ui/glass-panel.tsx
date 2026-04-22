"use client";

// ── Glass primitives (Phase 2A design system) ──
//
// Every surface in the whiteboard-native UI renders through these
// primitives — no component hand-rolls `bg-white/92 backdrop-blur …`
// ever again. Four tiers of elevation, each with its own blur, fill,
// hairline, and shadow, driven by the design tokens in globals.css.
//
// Usage:
//   <GlassPanel tier="float">…</GlassPanel>      // drawer, popovers
//   <GlassCard>…</GlassCard>                      // rows, item cards
//   <GlassPanel tier="modal">…</GlassPanel>       // full dialogs
//
// An inner highlight stroke (1px white inset on the top edge) catches
// light at the lift-line so the surface reads as lifted, not flat.

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type GlassTier = "plate" | "card" | "float" | "modal";

export interface GlassPanelProps
  extends React.HTMLAttributes<HTMLDivElement> {
  tier?: GlassTier;
  /** When true, adds the top-edge inner highlight stroke. Default true
   *  for card/float/modal; false for plate (which is meant to read flush). */
  highlight?: boolean;
  /** Rounded corner size — defaults per tier (plate:10, card:12, float:16, modal:20). */
  radius?: number;
  /** Accent hex — when set, rim the panel with a faint accent border
   *  so the surface has a color identity without being loud. */
  accent?: string | null;
}

const DEFAULT_RADIUS: Record<GlassTier, number> = {
  plate: 10,
  card: 12,
  float: 16,
  modal: 20,
};

const TIER_STYLES: Record<GlassTier, React.CSSProperties> = {
  plate: {
    background: "var(--glass-plate-bg)",
    backdropFilter: "blur(var(--blur-plate)) saturate(1.4)",
    WebkitBackdropFilter: "blur(var(--blur-plate)) saturate(1.4)",
    boxShadow: "var(--shadow-plate)",
    border: "1px solid var(--glass-hairline)",
  },
  card: {
    background: "var(--glass-card-bg)",
    backdropFilter: "blur(var(--blur-card)) saturate(1.5)",
    WebkitBackdropFilter: "blur(var(--blur-card)) saturate(1.5)",
    boxShadow: "var(--shadow-card)",
    border: "1px solid var(--glass-border)",
  },
  float: {
    background: "var(--glass-float-bg)",
    backdropFilter: "blur(var(--blur-float)) saturate(1.5)",
    WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.5)",
    boxShadow: "var(--shadow-float)",
    border: "1px solid var(--glass-border)",
  },
  modal: {
    background: "var(--glass-modal-bg)",
    backdropFilter: "blur(var(--blur-modal)) saturate(1.6)",
    WebkitBackdropFilter: "blur(var(--blur-modal)) saturate(1.6)",
    boxShadow: "var(--shadow-modal)",
    border: "1px solid var(--glass-border-strong)",
  },
};

/**
 * The inner top-edge highlight: a 1px inset stroke at the top that
 * reads as light catching the glass lip. Subtle — if you can SEE it
 * directly the calibration is wrong. You should just feel the depth.
 */
const HIGHLIGHT_STYLE: React.CSSProperties = {
  // Double box-shadow: original + inset top highlight
};

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  function GlassPanel(
    { tier = "float", highlight, radius, accent, className, style, children, ...rest },
    ref,
  ) {
    const showHighlight = highlight ?? tier !== "plate";
    const borderRadius = radius ?? DEFAULT_RADIUS[tier];
    const tierStyle = TIER_STYLES[tier];

    // Compose box-shadow: tier shadow + (optional) inset top highlight +
    // (optional) accent rim. Accent rim uses color-mix so it works with
    // any hex the caller supplies.
    const shadows: string[] = [String(tierStyle.boxShadow)];
    if (showHighlight) {
      shadows.push("inset 0 1px 0 0 var(--glass-highlight)");
    }
    if (accent) {
      shadows.push(
        `inset 0 0 0 1px color-mix(in srgb, ${accent} 14%, transparent)`,
      );
    }

    return (
      <div
        ref={ref}
        className={cn("relative", className)}
        style={{
          ...tierStyle,
          boxShadow: shadows.join(", "),
          borderRadius,
          ...style,
        }}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

/**
 * Card-tier glass with hover-lift baked in. Most row / item surfaces
 * inside the drawer should use this — gives a subtle `translateY(-1px)`
 * on hover that reads as a spatial response to the cursor.
 */
export interface GlassCardProps extends GlassPanelProps {
  interactive?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  function GlassCard(
    { interactive = true, className, style, ...rest },
    ref,
  ) {
    return (
      <GlassPanel
        ref={ref}
        tier="card"
        className={cn(
          interactive &&
            "transition-transform duration-200 ease-[var(--ease-spring-tight)] hover:-translate-y-px",
          className,
        )}
        style={style}
        {...rest}
      />
    );
  },
);
