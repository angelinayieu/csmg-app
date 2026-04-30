"use client";

// Rail section — vertical rhythm + tracking-driven section header.
//
// Section weight in this design system comes from letter-spacing
// (0.14em caps), not size. Resist the urge to bump the title up to
// 14px or 16px — that's what makes it look like a marketing page.
// Stay at 9-10px with caps + tracking + slate color.
//
// Zone="live" tints the section in the subtle blue gradient and
// adds the streaming-dot region. Zone="state" is the default
// (no fill, no animation, anchor-grade quiet).

import { cn } from "@/lib/utils";
import { rail } from "@/lib/design-tokens";

export interface RailSectionProps {
  title?: string;
  /** When provided, rendered as a small chip in the section header. */
  count?: number;
  /** "live" sections show streaming indicator + animated bg tint. */
  zone?: "state" | "live";
  /** Trailing element on the right of the title (settings cog, etc). */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function RailSection({
  title,
  count,
  zone = "state",
  trailing,
  children,
  className,
}: RailSectionProps) {
  const isLive = zone === "live";
  return (
    <section
      className={cn("relative", className)}
      style={{
        marginBottom: rail.state.sectionGap,
      }}
    >
      {title && (
        <header
          className="flex items-center gap-2"
          style={{
            marginBottom: rail.state.titleBottomGap,
            paddingLeft: 2,
          }}
        >
          {isLive && (
            <span
              aria-hidden
              className="rail-streaming-breath"
              style={{
                display: "inline-block",
                width: rail.live.streamingDot.size,
                height: rail.live.streamingDot.size,
                borderRadius: "50%",
                background: rail.live.streamingDot.color,
                boxShadow: `0 0 6px ${rail.live.streamingDot.color}66`,
                flexShrink: 0,
              }}
            />
          )}
          <span
            style={{
              fontSize: rail.state.titleSize,
              fontWeight: rail.state.titleWeight,
              letterSpacing: rail.state.titleTracking,
              textTransform: "uppercase",
              color: "var(--rail-state-title)",
              fontVariantNumeric: "tabular-nums",
              flex: 1,
            }}
          >
            {title}
          </span>
          {typeof count === "number" && count > 0 && (
            <span
              aria-label={`${count} new`}
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: "white",
                background: "var(--rail-live-count)",
                borderRadius: 8,
                padding: "1px 5px",
                lineHeight: 1.2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {count}
            </span>
          )}
          {trailing}
        </header>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isLive ? rail.live.cardGap : rail.state.cardGap,
        }}
      >
        {children}
      </div>
    </section>
  );
}
