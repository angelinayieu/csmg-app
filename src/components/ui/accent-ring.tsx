"use client";

// ── AccentRing (Phase 2A) ──
//
// Replaces the ASCII dominance bar (▓▓▓░░) with a proper circular
// progress ring. One gradient stroke, rounded caps, animated on
// change. Used wherever a score or percent needs to render at a
// small size (drawer rows, table cells, summary cards).
//
// Sizes: xs(14) / sm(20) / md(28) / lg(40). The ring scales its
// stroke width proportionally so all sizes read consistently.
//
// Usage:
//   <AccentRing value={0.82} accent="#0891b2" size="sm" />
//   <AccentRing value={0.55} accent="#0891b2" size="md" showLabel />

import { cn } from "@/lib/utils";

export type AccentRingSize = "xs" | "sm" | "md" | "lg";

export interface AccentRingProps {
  /** 0–1 progress value. Clamped to [0, 1]. */
  value: number;
  /** Hex color for the progress stroke. */
  accent: string;
  size?: AccentRingSize;
  /** Show the value as a number in the center. Default false for xs. */
  showLabel?: boolean;
  /** Override the label (e.g. "A+" or "HIGH"). */
  label?: string;
  /** Track color — defaults to a faint neutral. */
  track?: string;
  className?: string;
  /** Accessible description for screen readers. */
  ariaLabel?: string;
}

const DIMENSIONS: Record<
  AccentRingSize,
  { size: number; stroke: number; fontSize: number }
> = {
  xs: { size: 14, stroke: 1.5, fontSize: 7 },
  sm: { size: 20, stroke: 2, fontSize: 8 },
  md: { size: 28, stroke: 2.5, fontSize: 9.5 },
  lg: { size: 40, stroke: 3, fontSize: 11 },
};

export function AccentRing({
  value,
  accent,
  size = "sm",
  showLabel,
  label,
  track,
  className,
  ariaLabel,
}: AccentRingProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const { size: s, stroke, fontSize } = DIMENSIONS[size];
  const r = (s - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = clamped * c;

  // Auto-show label on md+, auto-hide on xs, explicit on sm.
  const labelVisible = showLabel ?? size !== "xs";

  return (
    <div
      className={cn("relative inline-flex flex-shrink-0", className)}
      style={{ width: s, height: s }}
      role="img"
      aria-label={
        ariaLabel ??
        `Dominance: ${Math.round(clamped * 100)}%`
      }
    >
      <svg width={s} height={s} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient
            id={`ring-${accent}-${size}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop
              offset="0%"
              stopColor={accent}
              stopOpacity="0.6"
            />
            <stop offset="100%" stopColor={accent} stopOpacity="1" />
          </linearGradient>
        </defs>
        <circle
          cx={s / 2}
          cy={s / 2}
          r={r}
          stroke={track ?? "rgba(15,23,42,0.08)"}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={s / 2}
          cy={s / 2}
          r={r}
          stroke={`url(#ring-${accent}-${size})`}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeDashoffset={c / 4}
          strokeLinecap="round"
          transform={`rotate(-90 ${s / 2} ${s / 2})`}
          style={{
            transition: "stroke-dasharray var(--dur-normal) var(--ease-spring-tight)",
          }}
        />
      </svg>
      {labelVisible && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center font-semibold"
          style={{
            fontSize,
            color: accent,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {label ?? Math.round(clamped * 100)}
        </div>
      )}
    </div>
  );
}
