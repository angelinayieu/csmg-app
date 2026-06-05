// ── Spark — clean AI mark ──
//
// A refined, SYMMETRIC four-point spark (with a small secondary shimmer)
// for AI actions in the Objective Canvas. Replaces the older lopsided
// twinkle (`./sparkle`) on the Resolution Studio's "let AI answer"
// controls — same idea, better balanced: equal arms, a gentle concave
// waist, one understated accent.
//
// Filled, inherits `currentColor`. API-compatible with lucide / the
// Sparkle icon (accepts `className`, `strokeWidth`, `size`, `color`) so
// it's a true drop-in (including in `cond ? Spark : X` ternaries).

import * as React from "react";
import type { LucideProps } from "lucide-react";

export const Spark = React.forwardRef<SVGSVGElement, LucideProps>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function Spark({ className, strokeWidth, size, color, absoluteStrokeWidth, ...rest }, ref) {
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
        {/* Primary four-point spark — symmetric arms, centered upper-left,
            with a soft concave waist (control points pulled toward center). */}
        <path d="M10 1.8 C10.42 6.5 11.5 7.58 16.2 8 C11.5 8.42 10.42 9.5 10 14.2 C9.58 9.5 8.5 8.42 3.8 8 C8.5 7.58 9.58 6.5 10 1.8 Z" />
        {/* Secondary shimmer — smaller, lower-right, establishes the cluster. */}
        <path d="M18 13.4 C18.24 16.36 19.04 17.16 22 17.4 C19.04 17.64 18.24 18.44 18 21.4 C17.76 18.44 16.96 17.64 14 17.4 C16.96 17.16 17.76 16.36 18 13.4 Z" />
      </svg>
    );
  },
);
Spark.displayName = "Spark";
