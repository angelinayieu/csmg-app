"use client";

// ── GroundingBadge (Phase 2E · Tier 1) ──
//
// Tiny honesty chip that sits next to any numeric value on a card
// to disclose how that value was produced. Four tiers:
//   measured  — deterministic, computed from data
//   estimated — math with assumptions (Jaccard, BFS, etc.)
//   inferred  — LLM assignment constrained by graph structure
//   narrative — pure LLM plausibility, uncalibrated
//
// Hover reveals a full sentence description so users learn the
// distinction once and internalize it. The badge is intentionally
// quiet — a 1.5x1.5 dot + 3-letter label — to avoid visual noise
// on cards that already carry a lot of content.

import { GROUNDING, type GroundingTier } from "@/lib/grounding";

export interface GroundingBadgeProps {
  tier: GroundingTier;
  /** Override the short label when the default ("LLM" / "est") is
   *  misleading in a specific context. Rare; prefer the default. */
  label?: string;
  /** Compact = dot-only (for space-constrained cards). Default: false. */
  compact?: boolean;
  /** Inline style overrides — primarily for positioning inside tldraw
   *  shape utils that manage their own layout. */
  style?: React.CSSProperties;
}

export function GroundingBadge({
  tier,
  label,
  compact = false,
  style,
}: GroundingBadgeProps) {
  const info = GROUNDING[tier];
  const text = label ?? info.shortLabel;
  const title = `${info.label}: ${info.description}`;

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: compact ? 0 : 4,
    padding: compact ? "0" : "1px 5px",
    borderRadius: 999,
    background: compact
      ? "transparent"
      : `color-mix(in srgb, ${info.color} 10%, transparent)`,
    color: info.color,
    fontSize: compact ? 9 : 8.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.2,
    cursor: "help",
    ...style,
  };

  return (
    <span title={title} style={baseStyle}>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 5,
          height: 5,
          borderRadius: 999,
          background: info.color,
        }}
      />
      {!compact && <span>{text}</span>}
    </span>
  );
}
