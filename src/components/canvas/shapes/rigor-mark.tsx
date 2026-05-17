"use client";

// ── RigorMark — custom typographic glyph for evidence rigor ─────────
//
// A two-state SVG primitive that signals whether a piece of evidence
// is paper-anchored (solid) or web/legacy-drifted (hollow). Designed
// as an editorial citation primitive, not iconography — two parallel
// stacked bars sharing a center line, rendered either as filled rects
// (anchored) or hairline outlines (drifted).
//
// Design discipline:
//   • Same primitive across both states — reads as a family
//   • Scales cleanly from 10px (inline chip) to 16px (drawer key)
//   • Color inherits from `currentColor` so callers control tone
//   • Never raster, never emoji, never lucide — owned shape
//   • Stroke widths in SVG user units; no fractional pixels at 12px

import type { CSSProperties } from "react";
import type { RigorTier } from "@/lib/evidence/rigor-tier";
import { TIER_META } from "@/lib/evidence/rigor-tier";

interface RigorMarkProps {
  /** Specific tier — drives tone (solid/hollow) and tooltip text. */
  tier: RigorTier;
  /** Display size in CSS pixels. Default 12. */
  size?: number;
  /** Optional aria label override. Default = tier label. */
  ariaLabel?: string;
  /** Whether to render the native tooltip. Default true. */
  showTitle?: boolean;
  /** Extra style overrides — usually just margin/color tweaks. */
  style?: CSSProperties;
  /** Inline className passthrough. */
  className?: string;
}

/**
 * Two horizontal bars, stacked. 8 user units wide, 1.5 tall each,
 * 1.5 gap between, centered vertically in a 12×12 viewBox.
 *
 *   ░░░░░░░░░░░░░    (1.25 pad top)
 *   ▓▓▓▓▓▓▓▓░░░░░    (bar — y=3.5..5)
 *   ░░░░░░░░░░░░░    (gap — y=5..6.5)
 *   ▓▓▓▓▓▓▓▓░░░░░    (bar — y=6.5..8)
 *   ░░░░░░░░░░░░░    (1.25 pad bottom; bars share x=2..10)
 *
 * Solid: both bars are filled rects.
 * Hollow: both bars are 0.75-stroke outline-only rects.
 */
export function RigorMark({
  tier,
  size = 12,
  ariaLabel,
  showTitle = true,
  style,
  className,
}: RigorMarkProps) {
  const meta = TIER_META[tier];
  const isSolid = meta.tone === "solid";

  const barX = 2;
  const barW = 8;
  const barH = 1.5;
  const topY = 3.5;
  const botY = 7;

  const fill = isSolid ? "currentColor" : "none";
  const stroke = isSolid ? "none" : "currentColor";
  const strokeWidth = isSolid ? 0 : 0.75;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      role="img"
      aria-label={ariaLabel ?? meta.label}
      className={className}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
    >
      {showTitle && <title>{`${meta.label} — ${meta.description}`}</title>}
      <rect
        x={barX}
        y={topY}
        width={barW}
        height={barH}
        rx={0.4}
        ry={0.4}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        shapeRendering="geometricPrecision"
      />
      <rect
        x={barX}
        y={botY}
        width={barW}
        height={barH}
        rx={0.4}
        ry={0.4}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        shapeRendering="geometricPrecision"
      />
    </svg>
  );
}

// ── Headline-tier variant ──────────────────────────────────────────
//
// Shortcut for callers that only know the binary anchored/drifted
// split. Picks `paper_extracted` for solid and `web_heuristic` for
// hollow as the canonical representatives. Useful when rendering a
// chip indicator for a pool dominated by one family without picking a
// specific sub-tier.

export function RigorMarkBinary(
  props: Omit<RigorMarkProps, "tier"> & { anchored: boolean },
) {
  const { anchored, ...rest } = props;
  return (
    <RigorMark
      tier={anchored ? "paper_extracted" : "web_heuristic"}
      {...rest}
    />
  );
}
