"use client";

// ── FloatingCard ──
//
// The reusable "glowing pane floating in space" primitive. This is the
// canonical surface for the Vision-Pro-adjacent layered-rooms language:
// a frosted-glass card that picks up whatever ambient backdrop sits
// behind it, lifted off the page by a soft neutral shadow, with a
// barely-visible top-edge highlight (the "light from above" cue) and an
// optional cursor-driven parallax tilt.
//
// It reads ALL of its surface values from the glass design tokens in
// globals.css (--glass-{tier}-bg, --shadow-{tier}, --blur-{tier},
// --glass-border, --glass-highlight) so no caller ever hand-rolls these
// again. Extracted from the hand-rolled panel in synergy-strategy.tsx.
//
//   tier="plate"  — flush surfaces (section headers, inline cards)
//   tier="card"   — standard raised card (drawer rows, item cards)
//   tier="float"  — primary floating surface (room cards, popovers) ← default
//   tier="modal"  — blocking surface (full dialogs, overlays)
//
// Pass `parallax` to enable the visionOS tilt (self-disables on touch /
// reduced-motion). Pass `glow` to add a wider ambient halo for surfaces
// that should feel like they're hovering well above the substrate.

import {
  forwardRef,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import { useParallax } from "@/hooks/synergy/use-parallax";

export type FloatingCardTier = "plate" | "card" | "float" | "modal";

const TIER_RADIUS: Record<FloatingCardTier, number> = {
  plate: 16,
  card: 20,
  float: 24,
  modal: 28,
};

interface FloatingCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Depth tier — drives fill opacity, blur, shadow + radius. Default "float". */
  tier?: FloatingCardTier;
  /** Cursor-driven 3D tilt (visionOS pane feel). Off by default. */
  parallax?: boolean;
  /** Wider ambient halo — for surfaces hovering well above the page. */
  glow?: boolean;
  /** Top-edge "light from above" hairline. On by default. */
  highlight?: boolean;
  /** Override the tier's default corner radius. */
  radius?: number;
}

export const FloatingCard = forwardRef<HTMLDivElement, FloatingCardProps>(
  function FloatingCard(
    {
      tier = "float",
      parallax = false,
      glow = false,
      highlight = true,
      radius,
      className = "",
      style,
      children,
      ...rest
    },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLDivElement>(null);
    // Parallax always needs a live ref; merge with any forwarded ref so
    // callers can still measure / animate the element themselves.
    useParallax(innerRef, { enabled: parallax, maxTiltDeg: 0.5 });

    const cornerRadius = radius ?? TIER_RADIUS[tier];

    // Layered shadow: the tier shadow does the base lift; `glow` adds a
    // wide, very low-opacity neutral halo so the card reads as hovering.
    const shadow = [
      `var(--shadow-${tier})`,
      glow ? "0 40px 120px -44px rgba(15,23,42,0.20)" : null,
    ]
      .filter(Boolean)
      .join(", ");

    const mergedStyle: CSSProperties = {
      background: `var(--glass-${tier}-bg)`,
      backdropFilter: `blur(var(--blur-${tier}))`,
      WebkitBackdropFilter: `blur(var(--blur-${tier}))`,
      border: "1px solid var(--glass-border)",
      borderRadius: cornerRadius,
      boxShadow: shadow,
      ...style,
    };

    return (
      <div
        ref={(node) => {
          innerRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        className={`relative ${className}`}
        style={mergedStyle}
        {...rest}
      >
        {highlight && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px"
            style={{
              borderTopLeftRadius: cornerRadius,
              borderTopRightRadius: cornerRadius,
              background:
                "linear-gradient(90deg, transparent, var(--glass-highlight), transparent)",
            }}
          />
        )}
        {children}
      </div>
    );
  },
);
