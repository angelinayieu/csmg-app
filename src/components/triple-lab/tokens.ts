// Triple-lab design tokens.
//
// Single source of truth for the rgba color values that were duplicated
// across panels (audit cross-cutting item #1). Each token reads as
// SEMANTIC intent — `colors.brand.fg` not `#4F46E5` — so future palette
// shifts touch one file, not 30 inline styles.
//
// Two layers:
//   - `colors` — semantic palette tokens
//   - `surfaces` — pre-mixed background / border / shadow combos for
//     common UI primitives (card, chip, overlay, etc.)
//
// All values are plain strings — these are consumed by inline `style`
// props (because we have a lot of dynamic alpha + gradient cases that
// don't quite map to Tailwind classes). Keep them stable; importing
// consumers expect referential identity for memo keys.

export const colors = {
  // ── Brand (indigo) — for primary actions, axiom emphasis, focus rings
  brand: {
    fg: "#4F46E5",
    fgDark: "#4338CA",
    fgDarker: "#3730A3",
    halo: "rgba(79, 70, 229, 0.5)",
    haloSoft: "rgba(79, 70, 229, 0.18)",
    bgSoft: "rgba(79, 70, 229, 0.08)",
    bgChip: "rgba(79, 70, 229, 0.12)",
    bgPanel: "rgba(79, 70, 229, 0.05)",
    bgPanelStrong: "rgba(79, 70, 229, 0.10)",
    fadeStart: "rgba(79, 70, 229, 0.025)",
    fadeEnd: "rgba(79, 70, 229, 0.06)",
    shadow: "rgba(79, 70, 229, 0.18)",
    shadowStrong: "rgba(79, 70, 229, 0.28)",
    gradient: "linear-gradient(135deg, #818CF8 0%, #4F46E5 100%)",
  },

  // ── Knowledge-layer accents — used by the KG legend + card eyebrows
  layer: {
    internal: "#0EA5E9",
    conceptual: "#8B5CF6",
    external: "#F59E0B",
    bridge: "#10B981",
    unknown: "#64748B",
  },

  // ── Semantic state (severity, leverage, risk, etc.)
  state: {
    bottleneck: "#DC2626",
    bottleneckSoft: "rgba(220, 38, 38, 0.07)",
    bottleneckChip: "rgba(220, 38, 38, 0.10)",
    bottleneckFg: "rgb(127, 29, 29)",
    bottleneckFgChip: "#991B1B",

    leverage: "#F59E0B",
    leverageSoft: "rgba(245, 158, 11, 0.08)",
    leverageChip: "rgba(245, 158, 11, 0.14)",
    leverageBadgeBg: "rgba(245, 158, 11, 0.15)",
    leverageFg: "#B45309",
    leverageFgDark: "#92400E",

    risk: "#EF4444",
    riskSoft: "rgba(239, 68, 68, 0.08)",

    ok: "#10B981",
    okSoft: "rgba(13, 148, 136, 0.12)",
    okFg: "#0F766E",

    info: "#0891B2",
    infoChip: "rgba(8, 145, 178, 0.12)",
    infoFg: "#0E7490",

    cycle: "#F59E0B",
    bridgeEdge: "#06B6D4",
    edgeMuted: "#94A3B8",
  },

  // ── Severity for the guardrail queue (one-dim heat)
  severity: {
    critical: "#DC2626",
    important: "#F59E0B",
    nice: "#94A3B8",
  },

  // ── Drop-zone (green, signals positive ingress)
  drop: {
    fg: "#4ade80",
    halo: "rgba(74, 222, 128, 0.10)",
    border: "rgba(74, 222, 128, 0.45)",
    borderStrong: "rgba(74, 222, 128, 0.6)",
    bgVignetteEnd: "rgba(2, 5, 10, 0.42)",
  },

  // ── Neutrals — borders, backgrounds, scrim
  neutral: {
    fg900: "#0F172A",
    fg700: "#334155",
    fg500: "#64748B",
    fg400: "#94A3B8",
    fg300: "#CBD5E1",
    bg100: "#F1F5F9",
    bg50: "#F8FAFC",
    panelBg: "rgba(255, 255, 255, 0.78)",
    panelBgFlat: "rgba(255, 255, 255, 0.65)",
    panelBgLighter: "rgba(255, 255, 255, 0.85)",
    panelBgLightest: "rgba(248, 250, 252, 0.85)",
    borderSoft: "rgba(15, 23, 42, 0.06)",
    borderFaint: "rgba(15, 23, 42, 0.08)",
    borderInput: "rgba(15, 23, 42, 0.12)",
    chipBg: "rgba(15, 23, 42, 0.03)",
    chipBgStrong: "rgba(15, 23, 42, 0.04)",
    scrim: "rgba(15, 23, 42, 0.45)",
    cardShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
    cardShadowHover: "0 4px 12px rgba(15, 23, 42, 0.06)",
    cardShadowFloating: "0 12px 28px rgba(15, 23, 42, 0.18)",
  },
} as const;

// ── Backgrounds (gradients + radial canvases used across the lab) ────
export const backgrounds = {
  pageRoot:
    "radial-gradient(circle at 50% 0%, #FAFBFE 0%, #F3F5FA 60%, #EDF0F7 100%)",
  insightsPanel:
    "linear-gradient(180deg, #FBFCFE 0%, #F4F6FB 100%)",
  rawSignalPanel:
    "radial-gradient(circle at 30% 20%, #F8FAFF 0%, #F0F4FB 40%, #E9EEF8 100%)",
  kgPanel:
    "radial-gradient(circle at 50% 50%, #FFFFFF 0%, #F5F7FB 100%)",
  expansionStrip: `linear-gradient(90deg, ${colors.brand.fadeStart} 0%, ${colors.brand.fadeEnd} 100%)`,
  guardrailQueue:
    "linear-gradient(180deg, rgba(255, 255, 255, 0.65) 0%, rgba(245, 247, 251, 0.95) 100%)",
} as const;

// ── Common letter-spacing values for the eyebrow style ───────────────
export const tracking = {
  eyebrow: "0.22em",
  eyebrowTight: "0.18em",
  eyebrowLoose: "0.28em",
} as const;
