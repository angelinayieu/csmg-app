"use client";

// ActionChip — outlined-thin button. Background fills only on hover.
//
// Three variants share one geometry; only the accent color changes.
// "primary" = brand blue (the affirmative action)
// "secondary" = neutral slate (the side-step)
// "danger" = quiet red (dismiss/reject; never loud)
//
// Stroke is intentionally 1px hairline at rest. On hover it gains a
// subtle bg tint at 8-10% opacity. Apple-grade restraint = the chip
// reads as a *suggestion* until the cursor confirms it's a button.

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type ActionChipVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ActionChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionChipVariant;
  /** Optional leading icon (lucide). 11-13px stroke 1.5 reads best. */
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  /** Compact = no padding, used in tight rows. */
  compact?: boolean;
}

const VARIANT_COLORS: Record<
  ActionChipVariant,
  { fg: string; ring: string; hoverBg: string; hoverFg: string }
> = {
  primary: {
    fg: "#086ce8",
    ring: "rgba(8,108,232,0.25)",
    hoverBg: "rgba(8,108,232,0.08)",
    hoverFg: "#0856b8",
  },
  secondary: {
    fg: "#556479",
    ring: "rgba(85,100,121,0.18)",
    hoverBg: "rgba(85,100,121,0.06)",
    hoverFg: "#0a1020",
  },
  danger: {
    fg: "#b42318",
    ring: "rgba(180,35,24,0.18)",
    hoverBg: "rgba(180,35,24,0.06)",
    hoverFg: "#8a1a12",
  },
  ghost: {
    fg: "#556479",
    ring: "transparent",
    hoverBg: "rgba(85,100,121,0.06)",
    hoverFg: "#0a1020",
  },
};

export const ActionChip = forwardRef<HTMLButtonElement, ActionChipProps>(
  function ActionChip(
    {
      variant = "secondary",
      icon: Icon,
      compact,
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    const palette = VARIANT_COLORS[variant];
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex items-center gap-1 rounded-md transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
          className,
        )}
        style={{
          padding: compact ? "3px 7px" : "4px 9px",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.01em",
          color: palette.fg,
          background: "transparent",
          border: `1px solid ${palette.ring}`,
          transitionDuration: "var(--dur-rail-micro)",
          transitionTimingFunction: "var(--ease-out-quart)",
          ...style,
        }}
        onMouseEnter={(e) => {
          if (rest.disabled) return;
          e.currentTarget.style.background = palette.hoverBg;
          e.currentTarget.style.color = palette.hoverFg;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = palette.fg;
        }}
        {...rest}
      >
        {Icon && (
          <Icon
            style={{
              width: 11,
              height: 11,
              strokeWidth: 1.5,
              flexShrink: 0,
            }}
          />
        )}
        {children}
      </button>
    );
  },
);
