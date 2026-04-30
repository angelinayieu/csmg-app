"use client";

// StateCard — anchored, low-elevation, quiet.
//
// Reads as "this is settled, glance and move on." No hover lift unless
// the card is actually interactive (`interactive` prop). The optional
// `accent` rim gives the card a color identity for active strategy or
// pinned-insight without adding a loud border.
//
// Wraps the existing GlassPanel (tier="plate") so we share the
// material vocabulary with the rest of the app — no new shadow recipe.

import { forwardRef } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";
import { rail } from "@/lib/design-tokens";

export interface StateCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Tiny uppercase eyebrow above the card body. Optional. */
  eyebrow?: string;
  /** Card title — primary content, 12px / 700. */
  title?: React.ReactNode;
  /** Subdued line under title — 11px / 600 / slate. */
  subtitle?: React.ReactNode;
  /** Optional accent color for the rim (one per zone). */
  accent?: string;
  /** When true, card lifts on hover (use only when whole-card click). */
  interactive?: boolean;
  /** Trailing slot — e.g., open-detail arrow. */
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}

export const StateCard = forwardRef<HTMLDivElement, StateCardProps>(
  function StateCard(
    {
      eyebrow,
      title,
      subtitle,
      accent,
      interactive = false,
      trailing,
      children,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    return (
      <GlassPanel
        ref={ref}
        tier="plate"
        radius={rail.state.cardRadius}
        accent={accent}
        className={cn(
          interactive &&
            "transition-transform duration-[var(--dur-rail-short)] ease-[var(--ease-spring-tight)] hover:-translate-y-px",
          className,
        )}
        style={{
          padding: rail.state.cardPadding,
          ...style,
        }}
        {...rest}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--rail-state-title)",
                  marginBottom: 3,
                }}
              >
                {eyebrow}
              </div>
            )}
            {title && (
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "#0a1020",
                  lineHeight: 1.3,
                  letterSpacing: "-0.01em",
                }}
              >
                {title}
              </div>
            )}
            {subtitle && (
              <div
                style={{
                  fontSize: 11,
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
              <div style={{ marginTop: title || subtitle ? 8 : 0 }}>
                {children}
              </div>
            )}
          </div>
          {trailing && (
            <div style={{ flexShrink: 0, marginTop: 1 }}>{trailing}</div>
          )}
        </div>
      </GlassPanel>
    );
  },
);
