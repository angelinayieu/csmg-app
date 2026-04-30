"use client";

// StreamingDot — quiet green pulse signaling the auto-indicator is live.
//
// Same 2.4s cadence as kg-drill-halo-pulse and probe-trail glow so
// every "I'm alive and working" surface in the app shares one rhythm.
// Don't add color variants — green = alive, red = error, paused has
// its own component (Paused). Keep the alphabet tight.

import { rail } from "@/lib/design-tokens";

export interface StreamingDotProps {
  /** "running" | "paused" | "error". Default running. */
  status?: "running" | "paused" | "error";
  size?: number;
  label?: string;
}

const STATUS_COLOR: Record<NonNullable<StreamingDotProps["status"]>, string> = {
  running: "var(--rail-live-streaming)",
  paused: "rgba(85,100,121,0.5)",
  error: "#ef4444",
};

export function StreamingDot({
  status = "running",
  size = rail.live.streamingDot.size,
  label,
}: StreamingDotProps) {
  const color = STATUS_COLOR[status];
  const isAnimated = status === "running";
  return (
    <span
      role="status"
      aria-label={label ?? status}
      title={label ?? status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(85,100,121,0.85)",
        letterSpacing: "0.04em",
      }}
    >
      <span
        aria-hidden
        className={isAnimated ? "rail-streaming-breath" : undefined}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          boxShadow: isAnimated ? `0 0 6px ${color}` : "none",
          flexShrink: 0,
        }}
      />
      {label && <span style={{ textTransform: "lowercase" }}>{label}</span>}
    </span>
  );
}
