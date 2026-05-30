// ── Smart-marker icon ──
//
// NOTE (2026-05-30): the design direction reversed — no sparkle/twinkle
// glyphs anywhere in the product. This component keeps the `Sparkle`
// export name purely for API stability across its ~5 importers (so we
// don't churn unrelated files), but now renders a restrained, theme-
// neutral marker (a straight-edged diamond) instead of a twinkle. It
// inherits `currentColor`, so callers' graphite/slate accents apply
// unchanged. New code should NOT reach for a decorative glyph here —
// prefer a functional lucide icon for the specific affordance.
//
// API parity with lucide icons: accepts `className` (sized via h-*/w-*)
// and `strokeWidth` (ignored — the shape is filled, kept so callers can
// swap without prop edits).

import * as React from "react";

interface SparkleProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  /** Ignored — kept for API parity with lucide-react icons. */
  strokeWidth?: number;
}

export function Sparkle({
  className,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  strokeWidth,
  ...rest
}: SparkleProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {/* Straight-edged diamond (rotated rounded square) — a neutral
          marker with NO concave waist, so it can't read as a twinkle. */}
      <path d="M12 3.2 L20.8 12 L12 20.8 L3.2 12 Z" strokeLinejoin="round" />
    </svg>
  );
}
