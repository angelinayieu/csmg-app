"use client";

import { useEffect, useState } from "react";

/**
 * akiboe brand mark — rendered as inline SVG so it adapts to light / dark
 * with no image swap or flicker.
 *
 * Two variants:
 *   - "mark"   (default): the sun glyph on a theme-matched rounded tile.
 *              Drops into the square logo slots (h-7 w-7, h-8 w-8, …).
 *   - "lockup":           sun glyph + "akiboe." wordmark, laid out
 *              horizontally. Use where there's room for the full lockup.
 *
 * Theme:
 *   - "auto" (default) follows the global `data-theme` attribute that the
 *     root layout / ThemeProvider writes on <html>. `data-theme="dark"`
 *     → dark variant; anything else → light variant. A MutationObserver
 *     keeps it live when the user switches themes.
 *   - pass "light" / "dark" to pin a variant (e.g. on a known dark surface).
 *
 * Source assets: public/akiboe-logo-light.svg, public/akiboe-logo-dark.svg
 */

type LogoTheme = "light" | "dark" | "auto";

const PALETTE = {
  light: { ink: "#1b1a18", accent: "#c2593b", tile: "#ffffff" },
  dark: { ink: "#f3ede2", accent: "#d98b6f", tile: "#1a1815" },
} as const;

/** Resolve "auto" against the live `data-theme` attribute on <html>. */
function useResolvedTheme(theme: LogoTheme): "light" | "dark" {
  const [resolved, setResolved] = useState<"light" | "dark">(
    theme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    if (theme !== "auto") {
      setResolved(theme);
      return;
    }
    const read = () => {
      const attr = document.documentElement.getAttribute("data-theme");
      setResolved(attr === "dark" ? "dark" : "light");
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [theme]);

  return resolved;
}

/** The sun glyph on its own (transparent), sized to fill its container. */
function SunMark({ ink, accent }: { ink: string; accent: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      style={{ display: "block" }}
      aria-hidden
    >
      <g fill="none" stroke={ink} strokeWidth={6} strokeLinecap="round">
        <circle cx="50" cy="50" r="8" />
        <line x1="34" y1="50" x2="20" y2="50" />
        <line x1="38.7" y1="38.7" x2="28.8" y2="28.8" />
        <line x1="61.3" y1="38.7" x2="71.2" y2="28.8" />
        <line x1="38.7" y1="61.3" x2="28.8" y2="71.2" />
        <line x1="61.3" y1="61.3" x2="71.2" y2="71.2" />
      </g>
      <line
        x1="66"
        y1="50"
        x2="80"
        y2="50"
        stroke={accent}
        strokeWidth={6}
        strokeLinecap="round"
      />
    </svg>
  );
}

interface AkiboeLogoProps {
  /** Applied to the outer wrapper — control size via width/height (e.g. `h-8 w-8`). */
  className?: string;
  /** Inline styles applied to the outer wrapper (e.g. shadow, border-radius). */
  style?: React.CSSProperties;
  /** Pixel size — for "lockup" this drives the wordmark/mark height (default 28). */
  size?: number;
  /** "mark" = sun tile (default), "lockup" = sun + "akiboe." wordmark. */
  variant?: "mark" | "lockup";
  /** Color theme — "auto" follows `data-theme` on <html> (default). */
  theme?: LogoTheme;
  /** Drop the tile background, rendering the bare sun glyph (mark variant only). */
  transparent?: boolean;
}

export function AkiboeLogo({
  className,
  style,
  size = 28,
  variant = "mark",
  theme = "auto",
  transparent = false,
}: AkiboeLogoProps) {
  const resolved = useResolvedTheme(theme);
  const { ink, accent, tile } = PALETTE[resolved];

  if (variant === "lockup") {
    return (
      <div
        className={className}
        aria-label="akiboe"
        role="img"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.32em",
          fontSize: size,
          lineHeight: 1,
          ...style,
        }}
      >
        <span
          style={{
            position: "relative",
            display: "inline-block",
            width: "0.95em",
            height: "0.95em",
            flexShrink: 0,
          }}
        >
          <SunMark ink={ink} accent={accent} />
        </span>
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', var(--font-geist-sans), sans-serif",
            fontWeight: 800,
            letterSpacing: "-0.035em",
            color: ink,
            whiteSpace: "nowrap",
          }}
        >
          akiboe<span style={{ color: accent }}>.</span>
        </span>
      </div>
    );
  }

  // "mark" — sun glyph on a theme-matched rounded tile.
  return (
    <div
      className={className}
      aria-label="akiboe"
      role="img"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 8,
        background: transparent ? "transparent" : tile,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      <div style={{ width: "68%", height: "68%" }}>
        <SunMark ink={ink} accent={accent} />
      </div>
    </div>
  );
}
