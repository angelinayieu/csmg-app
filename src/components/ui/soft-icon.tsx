"use client";

// ── SoftIcon (Phase 2A) ──
//
// Wraps a lucide icon with normalized stroke weight (1.5) and
// consistent sizing, so icons across the design system read as one
// family regardless of source. All new UI uses this instead of
// raw lucide components.
//
// Reminder: lucide's default strokeWidth is 2. In the Vision-Pro
// aesthetic that's too heavy. 1.5 is the sweet spot for legibility
// at small sizes + feels airy.

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SoftIconSize = "xs" | "sm" | "md" | "lg";

const DIMENSION: Record<SoftIconSize, number> = {
  xs: 10,
  sm: 12,
  md: 16,
  lg: 20,
};

export interface SoftIconProps {
  icon: LucideIcon;
  size?: SoftIconSize;
  /** Hex color — inherits `currentColor` when undefined. */
  color?: string;
  className?: string;
  /** Lucide `strokeWidth` override; default 1.5. */
  strokeWidth?: number;
  /** Treated purely decoratively by screen readers unless label is set. */
  label?: string;
}

export function SoftIcon({
  icon: Icon,
  size = "sm",
  color,
  className,
  strokeWidth = 1.5,
  label,
}: SoftIconProps) {
  const d = DIMENSION[size];
  return (
    <Icon
      width={d}
      height={d}
      strokeWidth={strokeWidth}
      className={cn("flex-shrink-0", className)}
      color={color}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
