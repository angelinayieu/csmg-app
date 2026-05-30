// ── Smart-marker icon ──
//
// NOTE (2026-05-30): the design direction reversed — no sparkle/twinkle
// glyphs anywhere in the product. This component keeps the `Sparkle`
// export name purely for API stability across its many importers (so we
// don't churn unrelated files), but renders a restrained, theme-neutral
// straight-edged diamond instead of a twinkle. It inherits `currentColor`,
// so callers' graphite/slate accents apply unchanged. New code should NOT
// reach for a decorative glyph here — prefer a functional lucide icon for
// the specific affordance.
//
// Typed + shaped as a lucide `LucideIcon` (forwardRef, LucideProps) so it
// is a true drop-in: it renders as `<Sparkle className=… strokeWidth=… />`
// AND is assignable to `icon={…}` props typed as `LucideIcon`.

import * as React from "react";
import type { LucideIcon } from "lucide-react";

export const Sparkle = React.forwardRef<
  SVGSVGElement,
  React.ComponentProps<LucideIcon>
>(function Sparkle(
  // Strip lucide-only props so they don't land on the SVG as invalid
  // attributes; `size` maps to width/height, `color` to the CSS color
  // that `currentColor` reads. `strokeWidth` is intentionally ignored
  // (the shape is filled), kept for API parity.
  { className, size, color, strokeWidth, absoluteStrokeWidth, style, ...rest },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size ?? undefined}
      height={size ?? undefined}
      fill="currentColor"
      stroke="none"
      className={className}
      style={color ? { color, ...(style as React.CSSProperties) } : style}
      aria-hidden="true"
      {...rest}
    >
      {/* Straight-edged diamond (rotated rounded square) — a neutral
          marker with NO concave waist, so it can't read as a twinkle. */}
      <path d="M12 3.2 L20.8 12 L12 20.8 L3.2 12 Z" strokeLinejoin="round" />
    </svg>
  );
}) as LucideIcon;
