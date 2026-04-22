"use client";

// ── AccentChip (Phase 2A) ──
//
// Small pill / tag primitive. Replaces the inline <span> with hex-
// hardcoded background/color pairs that were scattered across the
// drawer + insights renderers. Always uses an accent color with
// design-token alpha multipliers.
//
// Variants:
//   "soft"    — light fill + accent text (default, most common)
//   "strong"  — accent fill + white text (for active/selected states)
//   "ghost"   — transparent bg + accent border + accent text

import { cn } from "@/lib/utils";

export type AccentChipVariant = "soft" | "strong" | "ghost";
export type AccentChipSize = "xs" | "sm";

export interface AccentChipProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  accent: string;
  variant?: AccentChipVariant;
  size?: AccentChipSize;
  /** Optional left-slotted icon. */
  icon?: React.ReactNode;
}

const SIZE_STYLES: Record<AccentChipSize, React.CSSProperties> = {
  xs: { fontSize: 8.5, padding: "1px 5px", lineHeight: 1.25, borderRadius: 3 },
  sm: { fontSize: 10, padding: "2px 7px", lineHeight: 1.3, borderRadius: 4 },
};

export function AccentChip({
  accent,
  variant = "soft",
  size = "xs",
  icon,
  className,
  style,
  children,
  ...rest
}: AccentChipProps) {
  const base: React.CSSProperties = { ...SIZE_STYLES[size] };
  const variantStyle: React.CSSProperties =
    variant === "strong"
      ? { background: accent, color: "#ffffff" }
      : variant === "ghost"
        ? {
            background: "transparent",
            color: accent,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} var(--accent-border-soft), transparent)`,
          }
        : {
            background: `color-mix(in srgb, ${accent} calc(var(--accent-fill-medium) * 100%), transparent)`,
            color: accent,
          };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold uppercase tracking-[0.08em]",
        "font-mono",
        className,
      )}
      style={{ ...base, ...variantStyle, ...style }}
      {...rest}
    >
      {icon && <span className="inline-flex items-center">{icon}</span>}
      {children}
    </span>
  );
}
