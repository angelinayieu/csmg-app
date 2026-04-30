"use client";

// TrailBadge — the collapsed-state chip that lives on the source card
// after a probe trail folds back. Click → re-expands the trail.
//
// Visually compact (single line, 11px), but intentionally with a
// subtle glow ring so the user can spot "this card has past
// reasoning attached" at a glance across the canvas.

import { Sparkles } from "lucide-react";
import { rail } from "@/lib/design-tokens";

export interface TrailBadgeProps {
  /** Short summary, e.g., "Probe · 14m ago" or "Probe · 2 results" */
  label: string;
  resultCount?: number;
  /** When true, shows a small accent dot — meaning the trail
   *  produced new entities/edges still pending review. */
  hasPending?: boolean;
  onClick?: () => void;
}

export function TrailBadge({
  label,
  resultCount,
  hasPending,
  onClick,
}: TrailBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px 3px 6px",
        borderRadius: 999,
        background: "rgba(8,108,232,0.06)",
        border: "1px solid rgba(8,108,232,0.18)",
        color: "#0a1020",
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.005em",
        cursor: onClick ? "pointer" : "default",
        boxShadow: "0 1px 2px rgba(8,108,232,0.08)",
        transition: `transform var(--dur-rail-micro) var(--ease-out-quart),
                     box-shadow var(--dur-rail-micro) var(--ease-out-quart)`,
        fontVariantNumeric: "tabular-nums",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 3px 10px rgba(8,108,232,0.18)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(8,108,232,0.08)";
      }}
    >
      <Sparkles
        style={{
          width: 11,
          height: 11,
          strokeWidth: 1.5,
          color: "#086ce8",
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
      {typeof resultCount === "number" && resultCount > 0 && (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: "#086ce8",
            background: "rgba(8,108,232,0.12)",
            padding: "0 5px",
            borderRadius: 4,
            marginLeft: 1,
          }}
        >
          {resultCount}
        </span>
      )}
      {hasPending && (
        <span
          aria-label="Pending review"
          style={{
            display: "inline-block",
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--rail-live-count)",
            marginLeft: 2,
          }}
        />
      )}
    </button>
  );
}

// Reference suppressed — keeping rail import in scope for any future
// addition that needs `rail.trail.collapseDurationMs`, etc.
void rail;
