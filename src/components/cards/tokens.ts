// ── Card design tokens ──────────────────────────────────────────────
//
// Shared color + typography vocabulary for the archetype-driven app
// cards. Centralized here so the canvas shape, lab panel, dashboard
// widget, and the preflight all draw from one source. Anything that
// reads "look-and-feel" should resolve through this module — never
// hardcode hex inside a renderer.

export type Polarity = "positive" | "negative" | "neutral";

/** Polarity color set. `fg` for text, `bg` for soft pill backgrounds,
 *  `soft` for mid-weight strokes/dots. */
export const POLARITY_COLOR: Record<Polarity, { fg: string; bg: string; soft: string }> = {
  positive: { fg: "#3f6b54", bg: "rgba(126,168,147,0.14)", soft: "#7ea893" },
  negative: { fg: "#7d4f49", bg: "rgba(192,140,134,0.14)", soft: "#c08c86" },
  neutral: { fg: "#5d6470", bg: "rgba(155,166,182,0.14)", soft: "#9aa3b1" },
};

export const TEXT_PRIMARY = "#1a1f2c";
export const TEXT_MUTED = "rgba(20,30,60,0.55)";
export const TEXT_SUBTLE = "rgba(20,30,60,0.42)";
export const HAIRLINE = "rgba(20,30,60,0.06)";

/** Decide polarity from a p10/p50/p90 triple. Crosses-zero → neutral
 *  (we genuinely don't know the sign), else follows p50. */
export function polarityFor(p10: number, p50: number, p90: number): Polarity {
  const crossesZero = p10 < -0.005 && p90 > 0.005;
  if (crossesZero) return "neutral";
  if (p50 > 0.005) return "positive";
  if (p50 < -0.005) return "negative";
  return "neutral";
}

/** Format a 0..1 fractional value as a signed percentage. */
export function fmtPct(v: number, opts: { sign?: boolean; decimals?: number } = {}): string {
  const { sign = true, decimals = 0 } = opts;
  const s = sign && v >= 0 ? "+" : "";
  return `${s}${(v * 100).toFixed(decimals)}%`;
}

/** Day-of-week labels for 7-slot visualizations (M T W T F S S). */
export const DAYS_M_S = ["M", "T", "W", "T", "F", "S", "S"] as const;

export const MONO_FONT = '"SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SYSTEM_FONT =
  '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';
