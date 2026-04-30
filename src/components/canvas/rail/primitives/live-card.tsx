"use client";

// LiveCard — interactive, with arrival animation + ambient dim-down.
//
// Differs from StateCard in three ways:
//   1. Uses GlassCard tier (slightly higher elevation, hover lift)
//   2. Plays rail-arrival-enter animation on first mount (`isFresh`)
//   3. Ambient dim — older items fade to 0.7 → 0.4 over 30s/2min so
//      the auto-indicator's stream doesn't drown the canvas
//
// Visual contract: when the user reads the rail, fresh items are
// crisp at top, older items fade out as new ones arrive — like the
// canvas is "letting go" of stale activity gracefully.

import { forwardRef, useEffect, useRef, useState } from "react";
import { GlassCard } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { rail } from "@/lib/design-tokens";

export interface LiveCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Tiny uppercase eyebrow with type tag (e.g., "PAIRWISE"). */
  eyebrow?: string;
  eyebrowAccent?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Plays the arrival animation on mount. Default true. */
  isFresh?: boolean;
  /** Timestamp the item arrived; used to fade older items. */
  arrivedAt?: number;
  /** Action buttons row (rendered at bottom). */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export const LiveCard = forwardRef<HTMLDivElement, LiveCardProps>(
  function LiveCard(
    {
      eyebrow,
      eyebrowAccent = "#086ce8",
      title,
      subtitle,
      isFresh = true,
      arrivedAt,
      actions,
      children,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const [opacity, setOpacity] = useState(1);

    // Ambient dim — recompute once a minute. Cheap.
    useEffect(() => {
      if (!arrivedAt || reduced) return;
      const tick = () => {
        const age = Date.now() - arrivedAt;
        if (age > rail.live.ambientFadeAfterMs) setOpacity(0.4);
        else if (age > rail.live.ambientDimAfterMs) setOpacity(0.7);
        else setOpacity(1);
      };
      tick();
      const id = window.setInterval(tick, 60_000);
      return () => window.clearInterval(id);
    }, [arrivedAt, reduced]);

    return (
      <GlassCard
        ref={ref}
        radius={rail.live.cardRadius}
        interactive
        className={cn(isFresh && !reduced && "rail-arrival-enter", className)}
        style={{
          padding: rail.live.cardPadding,
          opacity,
          transition: "opacity 1200ms linear",
          ...style,
        }}
        {...rest}
      >
        {eyebrow && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: eyebrowAccent,
              marginBottom: 4,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: eyebrowAccent,
              }}
            />
            {eyebrow}
          </div>
        )}
        {title && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#0a1020",
              lineHeight: 1.4,
              letterSpacing: "-0.005em",
            }}
          >
            {title}
          </div>
        )}
        {subtitle && (
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              color: "#556479",
              marginTop: 2,
              lineHeight: 1.4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {subtitle}
          </div>
        )}
        {children && (
          <div style={{ marginTop: title || subtitle ? 6 : 0 }}>{children}</div>
        )}
        {actions && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {actions}
          </div>
        )}
      </GlassCard>
    );
  },
);
