// ── Apple-vibe design tokens ──
//
// Shared visual tokens for the Objective Canvas module. White,
// translucent, soft-shadowed, large radii, restrained accent use.
// Centralized so every shape + chrome surface in the new module reads
// from one place.

export const appleVibe = {
  // Backgrounds (light, sit on a white/off-white canvas)
  surface: {
    base: "#fafafa",
    card: "#ffffff",
    cardElevated: "rgba(255,255,255,0.92)",
    chip: "rgba(15,23,42,0.04)",
    chipHover: "rgba(15,23,42,0.06)",
  },

  // Text — only ever rgba(15,23,42,...) at varying alphas. No pure
  // black anywhere. Matches Apple system text on light backgrounds.
  text: {
    primary: "rgba(15,23,42,0.92)",
    secondary: "rgba(15,23,42,0.62)",
    tertiary: "rgba(15,23,42,0.45)",
    faint: "rgba(15,23,42,0.28)",
    onAccent: "white",
  },

  // Accent — used sparingly for the primary CTA and active states.
  // Defaults to a near-black "graphite" so the design reads as
  // restrained product first, marketing second.
  accent: {
    primary: "rgba(15,23,42,0.92)",
    primaryHover: "rgba(15,23,42,1)",
  },

  // Strokes — never harsh borders. Always low-alpha overlays on the
  // current surface so they recede.
  stroke: {
    hairline: "rgba(15,23,42,0.06)",
    soft: "rgba(15,23,42,0.08)",
    medium: "rgba(15,23,42,0.12)",
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
    card: "0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 32px -16px rgba(11,18,40,0.18)",
    chip: "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -10px rgba(11,18,40,0.18)",
    cardHover:
      "0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 40px -16px rgba(11,18,40,0.22)",
  },

  // Per-stage colors for the 4-stage layering (Pain → Features →
  // Outcomes → Objective). Sourced from the migration's
  // objective_brainstorm template so visual + data agree.
  stage: {
    pain: "#DC2626",
    features: "#2563EB",
    process: "#0D9488",
    outcomes: "#16A34A",
    objective: "#7C3AED",
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
    color: "rgba(15,23,42,0.62)",
  },
} as const;
