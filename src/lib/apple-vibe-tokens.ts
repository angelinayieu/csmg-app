// ── Apple-vibe design tokens ──
//
// Shared visual tokens for the Objective Canvas module. White,
// translucent, soft-shadowed, large radii, restrained accent use.
// Centralized so every shape + chrome surface in the new module reads
// from one place.

export const appleVibe = {
  // Backgrounds (light, sit on a white/off-white canvas)
  surface: {
    base: "var(--av-surface-base, #fafafa)",
    card: "var(--av-surface-card, #ffffff)",
    cardElevated: "var(--av-surface-card-elevated, rgba(255,255,255,0.92))",
    chip: "var(--av-surface-chip, rgba(15,23,42,0.04))",
    chipHover: "var(--av-surface-chip-hover, rgba(15,23,42,0.06))",
  },

  // Text — a black-forward slate ramp. `primary` is true slate-900
  // (#0F172A), so titles + body read as near-black for clarity instead
  // of the old washed 0.92 alpha. `secondary` is slate-700 (dark + fully
  // legible) — the ONE subtitle / secondary-body color. `tertiary`
  // slate-500 for meta + counts; `faint` slate-400 for the quietest
  // hints. Hierarchy comes from weight + size, NOT from bleaching text
  // toward the background (which is what made the UI look cheap).
  text: {
    primary: "var(--av-text-primary, #0F172A)",
    secondary: "var(--av-text-secondary, #334155)",
    tertiary: "var(--av-text-tertiary, #64748B)",
    faint: "var(--av-text-faint, #94A3B8)",
    onAccent: "var(--av-text-on-accent, white)",
  },

  // Accent — used sparingly for the primary CTA and active states.
  // Defaults to a near-black "graphite" so the design reads as
  // restrained product first, marketing second.
  accent: {
    primary: "var(--av-accent-primary, rgba(15,23,42,0.92))",
    primaryHover: "var(--av-accent-primary-hover, rgba(15,23,42,1))",
  },

  // Strokes — never harsh borders. Always low-alpha overlays on the
  // current surface so they recede.
  stroke: {
    hairline: "var(--av-stroke-hairline, rgba(15,23,42,0.06))",
    soft: "var(--av-stroke-soft, rgba(15,23,42,0.08))",
    medium: "var(--av-stroke-medium, rgba(15,23,42,0.12))",
  },

  // Radius scale — 16–20 is the sweet spot. We use 24 for the
  // outermost containers (full cards) and 12 for nested controls.
  radius: {
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    pill: 999,
  },

  // Shadows — soft, long, low-opacity. The "1px 0 inset" highlight
  // is what gives the cards their subtle Apple-vibe top sheen.
  shadow: {
    card: "var(--av-shadow-card, 0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 32px -16px rgba(11,18,40,0.18))",
    chip: "var(--av-shadow-chip, 0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -10px rgba(11,18,40,0.18))",
    cardHover:
      "var(--av-shadow-card-hover, 0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 40px -16px rgba(11,18,40,0.22))",
  },

  // Per-stage colors for the 4-stage layering (Pain → Features →
  // Outcomes → Objective). Sourced from the migration's
  // objective_brainstorm template so visual + data agree.
  stage: {
    pain: "var(--av-stage-pain, #DC2626)",
    features: "var(--av-stage-features, #2563EB)",
    process: "var(--av-stage-process, #0D9488)",
    outcomes: "var(--av-stage-outcomes, #16A34A)",
    // Apex layer reads as restrained graphite-slate, NOT purple — the
    // objective frames the stack, it shouldn't shout in violet.
    objective: "var(--av-stage-objective, #475569)",
  },

  // Typography stack — SF on Apple, Inter on the rest. Both render
  // crisp at small sizes with -0.01em letter-spacing.
  font: {
    stack:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
    display:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif',
  },

  // Standardized section "overline" — the ONE label treatment for
  // section headers / eyebrows across the module. Replaces ~6 ad-hoc
  // variants (9.5–10.5px, 0.1–0.14em tracking, 0.28-alpha all-caps)
  // that read as "many fonts" + low-contrast cheap. Modern Apple /
  // visionOS section headers are sentence case at readable contrast —
  // hierarchy comes from weight + spacing, not from shouting in caps.
  // Apply `className` + `color` together; pass the raw title in its
  // natural case (e.g. "Analysis signals", not "ANALYSIS SIGNALS").
  label: {
    className: "text-[11px] font-semibold tracking-[0.02em]",
    color: "var(--av-label-color, #475569)",
  },

  // Standardized small-text scale — the ONE place item type is defined,
  // so "subtitles" stop drifting across 9.5 / 10 / 11 / 12px ad hoc.
  // Pair each className with the matching `text.*` color. Titles read as
  // near-black; the single `subtitle` size keeps every secondary line
  // visually identical across cards, lanes, and chrome.
  type: {
    title: "text-[13px] font-semibold leading-tight",
    subtitle: "text-[11px] font-normal leading-snug",
    body: "text-[13px] font-normal leading-relaxed",
    meta: "text-[11px] font-medium tracking-[0.01em]",
  },
} as const;

/**
 * Apply an alpha to any color token — including the themed `var(--av-*)`
 * tokens, where the old `${appleVibe.x}HH` hex8-append trick no longer works
 * (you can't string-concat an alpha onto a `var()`). Uses `color-mix`, which
 * resolves the variable first, so the result tracks light/dark automatically.
 *
 * @param color  any CSS color or `var(--av-*)` token
 * @param alpha  0–1 fraction, OR the legacy 2-char hex alpha (e.g. "14", "1A")
 */
export function withAlpha(color: string, alpha: number | string): string {
  const a = typeof alpha === "number" ? alpha : parseInt(alpha, 16) / 255;
  const pct = Math.max(0, Math.min(100, a * 100));
  return `color-mix(in srgb, ${color} ${pct.toFixed(2)}%, transparent)`;
}
