"use client";

// ── Card shell ──────────────────────────────────────────────────────
//
// Common chrome for every archetype: white card, hairline border, soft
// shadow, left rail accent, header row (icon + name + Forecast/Today
// badge), body, optional footer copy. The body slot is filled by the
// archetype renderer.
//
// Two sizes:
//   - "compact" (canvas card): 220×auto, terse padding, smaller type
//   - "expanded" (lab / dashboard widget): ~360 wide, generous padding
//
// Mode switches the badge text only; archetypes decide whether to dim
// vizes or change copy when in "live" mode.

import type { CardHeader } from "@/types/card-spec";
import { resolveIcon } from "./icon-resolver";
import { HAIRLINE, MONO_FONT, SYSTEM_FONT, TEXT_PRIMARY, TEXT_MUTED } from "./tokens";

export type CardMode = "forecast" | "live";
export type CardSize = "compact" | "expanded";

export interface CardShellProps {
  header: CardHeader;
  /** Optional label shown above the title in compact uppercase style. */
  eyebrow?: string;
  /** Body content — provided by the archetype renderer. */
  children: React.ReactNode;
  /** Optional footer line, shown above a hairline divider. */
  footer?: string;
  mode?: CardMode;
  size?: CardSize;
  /** Override the badge text. Default: header.badge or derived from mode. */
  badgeOverride?: string;
}

export function CardShell({
  header,
  eyebrow,
  children,
  footer,
  mode = "forecast",
  size = "expanded",
  badgeOverride,
}: CardShellProps) {
  const Icon = resolveIcon(header.icon);
  const isCompact = size === "compact";
  // Mode is the runtime context (pre-active = forecast, active = live)
  // so it wins over the spec's stored badge — the spec carries the
  // text the agent generated *at* materialization, but render-time
  // truth lives in the prop.
  const badge = badgeOverride ?? (mode === "live" ? "Today" : "Forecast");

  const padding = isCompact ? "12px 14px" : "18px 20px 20px";
  const radius = isCompact ? 14 : 18;
  const titleSize = isCompact ? 13 : 16;
  const iconSize = isCompact ? 20 : 24;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: isCompact ? "100%" : undefined,
        borderRadius: radius,
        background: "#ffffff",
        border: `1px solid ${HAIRLINE}`,
        boxShadow: isCompact
          ? "0 8px 22px -8px rgba(8,30,80,0.10), 0 2px 6px rgba(8,30,80,0.04)"
          : "0 12px 32px -16px rgba(8,30,80,0.14), 0 3px 10px rgba(8,30,80,0.04)",
        padding,
        display: "flex",
        flexDirection: "column",
        gap: isCompact ? 8 : 14,
        color: TEXT_PRIMARY,
        fontFamily: SYSTEM_FONT,
        WebkitFontSmoothing: "antialiased",
        overflow: "hidden",
      }}
    >
      {/* Left rail accent */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: header.iconFg,
          opacity: 0.85,
        }}
      />

      {/* Header row */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: isCompact ? 8 : 10, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: iconSize,
              height: iconSize,
              borderRadius: 6,
              background: header.iconBg,
              color: header.iconFg,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={isCompact ? 12 : 14} strokeWidth={2.4} />
          </span>
          {eyebrow ? (
            <span
              style={{
                padding: "2px 7px",
                borderRadius: 4,
                background: header.iconBg,
                color: header.iconFg,
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              {eyebrow}
            </span>
          ) : null}
        </div>
        <span
          style={{
            fontSize: isCompact ? 10.5 : 12,
            color: mode === "live" ? header.iconFg : TEXT_MUTED,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
      </header>

      {/* Title */}
      <div
        style={{
          fontSize: titleSize,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          lineHeight: 1.25,
          color: TEXT_PRIMARY,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {header.name}
      </div>

      {/* Body slot */}
      <div style={{ display: "flex", flexDirection: "column", gap: isCompact ? 8 : 12 }}>
        {children}
      </div>

      {/* Footer */}
      {footer ? (
        <div
          style={{
            fontSize: isCompact ? 10 : 11,
            color: "rgba(20,30,60,0.45)",
            paddingTop: 8,
            borderTop: `1px solid ${HAIRLINE}`,
            fontFamily: MONO_FONT,
            letterSpacing: "0.01em",
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
