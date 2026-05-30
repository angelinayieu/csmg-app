// ── Custom sparkle icon ──
//
// Replaces lucide-react's Sparkles across the Objective Canvas
// module. Reference: design ask 2026-05-24 — a 4-pointed twinkle
// star with concave edges + a smaller secondary star offset to the
// lower-right. Matches the pill-icon style the user shared.
//
// API parity with lucide icons: accepts `className` (sized via
// h-* w-*) and `strokeWidth` (ignored since the shape is filled,
// kept so callers can swap without prop edits). Inherits color
// from `currentColor`.

import * as React from "react";
import type { LucideProps } from "lucide-react";

// Typed with `LucideProps` so Sparkle is a true drop-in for any
// lucide-react icon (including in ternaries like `cond ? RefreshCw : Sparkle`).
// `size`/`color`/`absoluteStrokeWidth` are accepted for API parity even though
// this filled shape sizes via className and inherits `currentColor`.

export const Sparkle = React.forwardRef<SVGSVGElement, LucideProps>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function Sparkle({ className, strokeWidth, size, color, absoluteStrokeWidth, ...rest }, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="none"
        className={className}
        aria-hidden="true"
        {...rest}
      >
        {/* Primary 4-point twinkle, weighted toward upper-left.
            Quadratic curves give the sparkle its concave waist. */}
        <path d="M9 1.5 Q10 9.2 16.8 10.2 Q10 11.2 9 18.9 Q8 11.2 1.2 10.2 Q8 9.2 9 1.5 Z" />
        {/* Secondary smaller twinkle, lower-right.
            Subtler — establishes the sparkle "cluster" feel. */}
        <path d="M18 13.5 Q18.45 17.4 22.6 17.9 Q18.45 18.4 18 22.3 Q17.55 18.4 13.4 17.9 Q17.55 17.4 18 13.5 Z" />
      </svg>
    );
  },
);
Sparkle.displayName = "Sparkle";
