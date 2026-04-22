// ── Chart theme ────────────────────────────────────────────────────────
//
// Single source of truth for data-viz colors, scales, and typography.
// Every chart/graph across the app imports from here so visualizations
// speak the same visual language — no off-palette greens on one chart
// and off-palette blues on another.
//
// Usage:
//   import { CHART } from "@/components/viz/chart-theme";
//   fill={CHART.color.primary[500]}

export const CHART = {
  // ── Primary brand scale (indigo) — use for "the main thing" ──
  color: {
    primary: {
      50: "#EEF2FF",
      100: "#E0E7FF",
      200: "#C7D2FE",
      300: "#A5B4FC",
      400: "#818CF8",
      500: "#6366F1",
      600: "#4F46E5",
      700: "#4338CA",
    },
    // Neutral scale — keep charts legible without stealing the stage.
    neutral: {
      50: "#F9FAFB",
      100: "#F3F4F6",
      200: "#E5E7EB",
      300: "#D1D5DB",
      400: "#9CA3AF",
      500: "#6B7280",
      600: "#4B5563",
      700: "#374151",
      800: "#1F2937",
    },
    // Semantic — success / warning / risk. Match existing interaxis-* tokens.
    success: "#059669",
    successBg: "#ECFDF5",
    warn: "#D97706",
    warnBg: "#FFFBEB",
    risk: "#DC2626",
    riskBg: "#FEF2F2",
    // Info (teal) — used for "measured / observed" signals.
    info: "#0891B2",
    infoBg: "#ECFEFF",
  },

  // ── Categorical palette ── mutually distinguishable hues for nominal data.
  // Ordered so the first N are always the most distinct N.
  categorical: [
    "#6366F1", // indigo
    "#0891B2", // cyan
    "#D97706", // amber
    "#059669", // emerald
    "#DC2626", // red
    "#7C3AED", // violet
    "#DB2777", // pink
    "#65A30D", // lime
  ],

  // ── Sequential scale — use for ordinal/quantitative bucketing ──
  sequential: ["#E0E7FF", "#C7D2FE", "#A5B4FC", "#818CF8", "#6366F1", "#4F46E5", "#4338CA"],

  // ── Diverging scale — use for signed quantities (e.g. Δ vs baseline) ──
  diverging: {
    negative: ["#DC2626", "#EF4444", "#F87171", "#FCA5A5"],
    neutral: "#E5E7EB",
    positive: ["#A7F3D0", "#6EE7B7", "#34D399", "#059669"],
  },

  // ── Typography ──
  font: {
    // Match Tailwind tabular-nums + the 10-13px dashboard text scale.
    tick: { size: 10, weight: 500, color: "#6B7280" },
    label: { size: 11, weight: 500, color: "#374151" },
    title: { size: 13, weight: 600, color: "#111827" },
  },

  // ── Motion defaults — align with the existing framer-motion EASE ──
  motion: {
    ease: [0.22, 1, 0.36, 1] as const,
    duration: 0.3,
  },

  // ── Chart container defaults ──
  layout: {
    cardRadius: 12,
    cardPadding: 16,
    strokeWidth: 1.5,
  },
} as const;

/**
 * Map a 0..1 score to the sequential scale. Inputs outside [0, 1] are clamped.
 */
export function sequentialColor(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  const idx = Math.min(
    CHART.sequential.length - 1,
    Math.floor(clamped * CHART.sequential.length),
  );
  return CHART.sequential[idx];
}

/**
 * Map a -1..1 delta to the diverging scale. 0 returns the neutral color.
 */
export function divergingColor(delta: number): string {
  if (delta === 0 || Number.isNaN(delta)) return CHART.diverging.neutral;
  const clamped = Math.max(-1, Math.min(1, delta));
  const scale = clamped > 0 ? CHART.diverging.positive : CHART.diverging.negative;
  const idx = Math.min(
    scale.length - 1,
    Math.floor(Math.abs(clamped) * scale.length),
  );
  return scale[idx];
}
