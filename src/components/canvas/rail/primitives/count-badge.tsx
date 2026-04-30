"use client";

// CountBadge — adaptive: idle dot, dot+number on actual count.
//
// The badge has two visual states gated by the `count` prop:
//   • count === 0 → not rendered (don't lie about activity)
//   • count >= 1  → small filled circle showing the number, with
//                   the rail-count-pop spring animation on first
//                   appearance (key on count to retrigger)
//
// Color: rail-live-count (#ef4444). Resist making it bigger or
// adding a glow — the goal is "noticeable in peripheral vision,
// not anxious."

import { rail } from "@/lib/design-tokens";

export interface CountBadgeProps {
  count: number;
  /** Optional label for accessibility (e.g., "new pairwise findings"). */
  ariaLabel?: string;
}

export function CountBadge({ count, ariaLabel }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      key={count}
      aria-label={ariaLabel ?? `${count} new`}
      className="rail-count-pop"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: rail.live.countBadge.sizeWithNumber,
        height: rail.live.countBadge.sizeWithNumber,
        padding: "0 5px",
        borderRadius: 999,
        background: "var(--rail-live-count)",
        color: "white",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.04em",
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        boxShadow: "0 1px 3px rgba(239,68,68,0.4)",
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
