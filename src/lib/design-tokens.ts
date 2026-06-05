// CSMG Design System — Single source of truth
// Every color, font size, radius, and shadow references these tokens.
// Nothing gets a hardcoded hex value.

export const colors = {
  // Semantic colors
  leverage: { light: "#007AFF", dark: "#0A84FF" },
  risk: { light: "#FF3B30", dark: "#FF453A" },
  success: { light: "#34C759", dark: "#30D158" },
  warning: { light: "#FF9500", dark: "#FF9F0A" },
  theory: { light: "#AF52DE", dark: "#BF5AF2" },

  // Surfaces
  background: { light: "#F2F2F7", dark: "#1C1C1E" },
  card: { light: "#FFFFFF", dark: "#2C2C2E" },
  cardHover: { light: "#F9F9FB", dark: "#3A3A3C" },
  cardActive: { light: "#F8FBFF", dark: "#1C2A3D" },
  inset: { light: "#F9F9FB", dark: "#1C1C1E" },

  // Text
  primary: { light: "#1D1D1F", dark: "#F5F5F7" },
  secondary: { light: "#48484A", dark: "#AEAEB2" },
  tertiary: { light: "#86868B", dark: "#636366" },
  quaternary: { light: "#AEAEB2", dark: "#48484A" },

  // Borders
  border: { light: "rgba(0,0,0,0.08)", dark: "rgba(255,255,255,0.08)" },
  borderHover: { light: "rgba(0,0,0,0.12)", dark: "rgba(255,255,255,0.12)" },
  borderFocus: { light: "#007AFF", dark: "#0A84FF" },

  // Tinted backgrounds
  tint: {
    blue: { light: "#EFF6FF", dark: "#0A2A4A" },
    red: { light: "#FFF0F0", dark: "#3A1A1A" },
    green: { light: "#F0FFF4", dark: "#1A3A1A" },
    amber: { light: "#FFF8F0", dark: "#3A2A0A" },
    purple: { light: "#F8F0FF", dark: "#2A1A3A" },
  },

  // Tinted borders
  tintBorder: {
    blue: { light: "#D1E3FF", dark: "#1A3A5A" },
    red: { light: "#FCEAEA", dark: "#4A2A2A" },
    green: { light: "#D1F0D9", dark: "#1A3A1A" },
    amber: { light: "#F0E0C0", dark: "#3A2A0A" },
    purple: { light: "#E8D8F8", dark: "#2A1A3A" },
  },

  // Entity category colors (for graph nodes and badges)
  entity: {
    concrete: { bg: "#DBEAFE", text: "#1E40AF", stroke: "#3B82F6" },
    abstract: { bg: "#EDE9FE", text: "#5B21B6", stroke: "#8B5CF6" },
    process: { bg: "#D1FAE5", text: "#065F46", stroke: "#10B981" },
    relational: { bg: "#FFEDD5", text: "#9A3412", stroke: "#F97316" },
    epistemic: { bg: "#FCE7F3", text: "#9D174D", stroke: "#EC4899" },
  },
} as const;

export const typography = {
  fontFamily:
    '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
  monoFamily:
    '"SF Mono", "Fira Code", "JetBrains Mono", ui-monospace, monospace',

  hero: { size: 32, weight: 700, tracking: "-0.03em", lineHeight: 1.2 },
  h1: { size: 28, weight: 600, tracking: "-0.02em" },
  h2: { size: 20, weight: 600, tracking: "-0.01em" },
  section: {
    size: 12,
    weight: 600,
    tracking: "-0.01em",
  },
  body: { size: 15, weight: 400, lineHeight: 1.65 },
  caption: { size: 13, weight: 400, lineHeight: 1.4 },
  label: {
    size: 11,
    weight: 600,
    tracking: "0.02em",
  },
  mono: { size: 12, weight: 400, lineHeight: 1.6 },
  entityId: { size: 13, weight: 600, tracking: "0.02em" },
  value: { size: 22, weight: 700, lineHeight: 1 },
} as const;

export const spacing = {
  card: { padding: "24px 28px", radius: 14, gap: 16 },
  insetCard: { padding: "22px 24px", radius: 12 },
  callout: { padding: "11px 14px", radius: 9, borderLeft: 2.5 },
  metricCell: { padding: "13px 14px", radius: 10 },
  listItem: { padding: "10px 12px", radius: 10 },
  badge: { padding: "2px 7px", radius: 4 },
  button: { padding: "9px 0", radius: 8 },
  sidebar: { width: 272 },
  rightPanel: { width: 288 },
  sectionGap: 24,
  cardGap: 12,
} as const;

export const shadows = {
  card: "0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.03)",
  active: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.04)",
  tab: "0 1px 2px rgba(0,0,0,0.06)",
  button: "0 0.5px 1px rgba(0,0,0,0.03)",
} as const;

export const animation = {
  curve: "cubic-bezier(0.22, 1, 0.36, 1)",
  durations: {
    cardEntrance: 500,
    accordion: 350,
    accordionFade: 250,
    chevron: 250,
    ringFill: 1000,
    graphHover: 250,
    hoverSlide: 200,
    tabSwitch: 200,
    slidePanel: 300,
    buttonHover: 150,
  },
  stagger: {
    card: 60,
    sidebar: 30,
    ring: 80,
    cascade: 50,
  },
} as const;

// Strategy layer colors (L1-L4 visual ladder)
export const layerColors = {
  l1: "#22C55E",
  l2: "#3B82F6",
  l3: "#F59E0B",
  l4: "#A855F7",
} as const;

// Graph: node fill/stroke colors by entity category (for D3 SVG rendering)
// Solid, saturated fills — text inside nodes should be white
export const nodeColors = {
  concrete: { fill: "#3B82F6", stroke: "#2563EB" },
  abstract: { fill: "#8B5CF6", stroke: "#7C3AED" },
  process: { fill: "#10B981", stroke: "#059669" },
  relational: { fill: "#F97316", stroke: "#EA580C" },
  epistemic: { fill: "#EC4899", stroke: "#DB2777" },
} as const;

// Connectivity tier visual config — drives node size/opacity by degree
export const connectivityTiers = {
  hub:    { opacityMult: 1.0,  radiusMult: 1.7,  strokeWidth: 2.5 },
  bridge: { opacityMult: 0.95, radiusMult: 1.25, strokeWidth: 2.0 },
  leaf:   { opacityMult: 0.8,  radiusMult: 0.85, strokeWidth: 1.4 },
  orphan: { opacityMult: 0.6,  radiusMult: 0.65, strokeWidth: 1.0 },
} as const;

export type ConnectivityTier = keyof typeof connectivityTiers;

export function getConnectivityTier(degree: number, maxDegree: number): ConnectivityTier {
  if (degree === 0) return "orphan";
  const ratio = degree / Math.max(maxDegree, 1);
  if (ratio >= 0.6 || degree >= 5) return "hub";
  if (ratio >= 0.3 || degree >= 3) return "bridge";
  return "leaf";
}

// Graph: edge dimension styles (color, dash pattern, width)
export const edgeDimensionStyles: Record<
  string,
  { color: string; dash: string; width: number }
> = {
  structural: { color: "#6B7280", dash: "", width: 0.8 },
  functional: { color: "#059669", dash: "", width: 1.2 },
  temporal: { color: "#D97706", dash: "4 3", width: 0.8 },
  causal: { color: "#DC2626", dash: "", width: 1.8 },
  correlational: { color: "#6B7280", dash: "2 2", width: 0.8 },
  logical: { color: "#7C3AED", dash: "", width: 1.2 },
  epistemic: { color: "#DB2777", dash: "4 3", width: 0.8 },
  comparative: { color: "#2563EB", dash: "2 2", width: 0.8 },
  agentive: { color: "#16A34A", dash: "", width: 1.2 },
} as const;

// Graph: special overlay colors
export const graphOverlays = {
  leverage: { ring: "#EF9F27", dash: "3 2", width: 2 },
  risk: { ring: "#E24B4A", dash: "3 2", width: 2 },
  bottleneck: { ring: "#E24B4A", dash: "", width: 2.5 },
  tradeoff: { color: "#E24B4A", dash: "4 3", width: 1.2 },
  predicted: { color: "#7F77DD", dash: "5 4", width: 1 },
  bridge: { color: "#378ADD", dash: "2 2", width: 1 },
  resolves: { color: "#1D9E75", dash: "", width: 1.5 },
  cyclePositive: "#34C759",
  cycleNegative: "#FF3B30",
  cycleBalancing: "#FF9500",
  cycleIntervention: { ring: "#7C3AED", dash: "2 2 6 2", width: 2.5 },
  // Interaction field overlays
  fieldStrength: { color: "#6366F1", maxOpacity: 0.18 },
  tensionZone: { ring: "#DC2626", dash: "1 2", width: 1.5, opacity: 0.5 },
  corridor: { color: "#059669", width: 2.5, dash: "", opacity: 0.6 },
} as const;

// Graph: edge dynamics visual encoding
// Each dynamics type gets a distinctive glow color and icon indicator
export const edgeDynamicsStyles: Record<
  string,
  { color: string; glowOpacity: number; label: string; symbol: string }
> = {
  threshold:     { color: "#F59E0B", glowOpacity: 0.35, label: "Threshold",     symbol: "⊥" },
  compounding:   { color: "#10B981", glowOpacity: 0.30, label: "Compounding",   symbol: "∞" },
  exponential:   { color: "#EF4444", glowOpacity: 0.40, label: "Exponential",   symbol: "⤴" },
  logarithmic:   { color: "#8B5CF6", glowOpacity: 0.25, label: "Logarithmic",   symbol: "∿" },
  decay:         { color: "#F97316", glowOpacity: 0.30, label: "Decay",          symbol: "↘" },
  step_function: { color: "#06B6D4", glowOpacity: 0.30, label: "Step Function",  symbol: "⌐" },
  delayed:       { color: "#3B82F6", glowOpacity: 0.25, label: "Delayed",        symbol: "◷" },
  linear:        { color: "#6B7280", glowOpacity: 0.15, label: "Linear",         symbol: "→" },
} as const;

// View-specific styling tokens
export const mapViewTokens = {
  territoryFillOpacity: 0.08,
  territoryStrokeOpacity: 0.2,
  territoryStrokeWidth: 1.5,
  territoryStrokeDash: "8 4",
} as const;

export const layeredViewTokens = {
  laneFillOpacity: 0.02,
  laneDividerColor: "#E5E7EB",
  laneLabelColor: "#9CA3AF",
  columnFillOpacity: 0.04,
} as const;

export const forceViewTokens = {
  clusterBubbleFillOpacity: 0.06,
  clusterBubbleStrokeOpacity: 0.12,
  clusterBubblePadding: 50,
} as const;

// Helper: get edge dimension style
export function getEdgeDimensionStyle(
  dimension: string
): { color: string; dash: string; width: number } {
  return (
    edgeDimensionStyles[dimension] ?? {
      color: "#888780",
      dash: "",
      width: 0.5,
    }
  );
}

// Domain colors for multi-space unified graph (solid fills for graph nodes)
export const domainColors: Array<{ fill: string; stroke: string; label: string }> = [
  { fill: "#3B82F6", stroke: "#2563EB", label: "blue" },     // Space A
  { fill: "#8B5CF6", stroke: "#7C3AED", label: "purple" },   // Space B
  { fill: "#F97316", stroke: "#EA580C", label: "coral" },    // Space C
  { fill: "#10B981", stroke: "#059669", label: "teal" },     // Space D
  { fill: "#F59E0B", stroke: "#D97706", label: "amber" },    // Space E
  { fill: "#EC4899", stroke: "#DB2777", label: "pink" },     // Space F
  { fill: "#22C55E", stroke: "#16A34A", label: "green" },    // Space G
];

export function getDomainColor(index: number): { fill: string; stroke: string } {
  return domainColors[index % domainColors.length];
}

// Helper: get node fill/stroke for a category
export function getNodeColor(
  category: string
): { fill: string; stroke: string } {
  return (
    nodeColors[category as keyof typeof nodeColors] ?? {
      fill: "#F9F9FB",
      stroke: "#86868B",
    }
  );
}

// Helper: get ring color based on value
export function getRingColor(value: number): string {
  if (value >= 0.9) return colors.success.light;
  if (value >= 0.8) return colors.leverage.light;
  if (value >= 0.5) return colors.warning.light;
  return colors.risk.light;
}

// Helper: get entity category color set
export function getEntityColor(
  category: string
): { bg: string; text: string; stroke: string } {
  return (
    colors.entity[category as keyof typeof colors.entity] ?? {
      bg: "#F9F9FB",
      text: "#48484A",
      stroke: "#86868B",
    }
  );
}

// ── Canvas scope colors (Sprint 1) ──
//
// One shared visual language for canvas scope — used in library cards,
// scope dots, proposal rail, inline span underlines (Sprint 3), universal
// canvas frame chrome (Sprint 4), and synthesis cross-area headers.
//
//   universal = teal (akiboe primary, spans everything)
//   project   = purple (one level down from universal)
//   objective = blue (sub-objective layer)
//   app       = amber (leaf, most concrete)

export type CanvasScopeToken = "universal" | "project" | "objective" | "app";

export const canvasScopeColors: Record<
  CanvasScopeToken,
  { dot: string; tintBg: string; tintBorder: string; text: string; label: string }
> = {
  universal: {
    dot: "#00ACC1",      // akiboe teal
    tintBg: "#E0F7FA",
    tintBorder: "#B2EBF2",
    text: "#00838F",
    label: "Universal",
  },
  project: {
    dot: colors.theory.light,                  // #AF52DE
    tintBg: colors.tint.purple.light,
    tintBorder: colors.tintBorder.purple.light,
    text: "#5B21B6",
    label: "Project",
  },
  objective: {
    dot: colors.leverage.light,                // #007AFF
    tintBg: colors.tint.blue.light,
    tintBorder: colors.tintBorder.blue.light,
    text: "#1E40AF",
    label: "Objective",
  },
  app: {
    dot: colors.warning.light,                 // #FF9500
    tintBg: colors.tint.amber.light,
    tintBorder: colors.tintBorder.amber.light,
    text: "#9A3412",
    label: "App",
  },
};

export function getCanvasScopeColor(scope: CanvasScopeToken) {
  return canvasScopeColors[scope];
}

// ── Convergence Workspace tokens ──

export const workspaceTokens = {
  detailsPanel: { width: 340 },
  goalStrip: { height: 56 },
  findingRow: { height: 56 },
} as const;

export const findingTypeColors = {
  leverage: {
    bg: colors.tint.blue.light,
    border: colors.tintBorder.blue.light,
    accent: colors.leverage.light,
    text: "#1E40AF",
  },
  risk: {
    bg: colors.tint.red.light,
    border: colors.tintBorder.red.light,
    accent: colors.risk.light,
    text: "#991B1B",
  },
  convergence: {
    bg: colors.tint.purple.light,
    border: colors.tintBorder.purple.light,
    accent: colors.theory.light,
    text: "#5B21B6",
  },
  bottleneck: {
    bg: colors.tint.amber.light,
    border: colors.tintBorder.amber.light,
    accent: colors.warning.light,
    text: "#92400E",
  },
} as const;

export type FindingColorKey = keyof typeof findingTypeColors;

// ── Right-rail tokens (State / Live / Probe-Trail) ───────────────────
//
// Single source of truth for the persistent right rail's visual grammar.
// Anchored on the existing GlassPanel material vocabulary (plate / card /
// float / modal) — these tokens add the rail-specific dimensions: section
// rhythm, live-zone tint, streaming/count indicators, and the probe-trail
// node geometry.
//
// Apple-grade rules baked in here so the rail can't drift in usage:
//   • One accent per zone (not multiple)
//   • Hairlines, never solid borders (--glass-hairline / --glass-border)
//   • Section headers are tracking-driven (0.14em caps), not size-driven
//   • Tabular numerics for any number that changes
//
// All raw rgba/hex live in this file or in globals.css — never inline.

export const rail = {
  width: 340,

  state: {
    sectionGap: 18,
    cardGap: 8,
    cardPadding: "12px 14px",
    cardRadius: 12,
    titleSize: 9,
    titleWeight: 700,
    titleTracking: "0.14em",
    titleColor: "rgba(85,100,121,0.85)",
    titleBottomGap: 8,
    surfaceTier: "plate" as const, // GlassPanel tier
  },

  live: {
    // Subtle gradient tint distinguishes the zone without a heavy fill.
    bgGradient:
      "linear-gradient(180deg, rgba(8,108,232,0.04) 0%, rgba(8,108,232,0.01) 60%, transparent 100%)",
    sectionGap: 14,
    cardGap: 6,
    cardPadding: "10px 12px",
    cardRadius: 10,
    surfaceTier: "card" as const, // GlassCard (interactive) for live items

    // Streaming indicator — quiet green dot, breath cycle.
    streamingDot: {
      color: "#22c55e",
      size: 6,
      breathDurationMs: 2400,
      breathOpacityFrom: 0.55,
      breathOpacityTo: 1.0,
    },

    // Count badge — appears in the zone header when new items arrive.
    countBadge: {
      color: "#ef4444",
      sizeIdle: 6,
      sizeWithNumber: 16,
      enterDurationMs: 320,
    },

    // Item fade-in (new arrivals) and ambient dim (old items).
    arrivalEnterDurationMs: 360,
    arrivalEnterTranslateY: -6,
    ambientDimAfterMs: 30_000, // → 0.7 opacity
    ambientFadeAfterMs: 120_000, // → 0.4 opacity
  },

  // Probe rabbit hole — spatial trail rendered ON the canvas (not in rail).
  trail: {
    nodeWidth: 56,
    nodeHeight: 40,
    nodeRadius: 12,
    nodeGapX: 28, // horizontal spacing between sibling nodes
    nodeGapY: 14, // vertical spacing on a branch
    edgeStrokeWidth: 1.5,
    edgeColor: "rgba(85,100,121,0.4)",
    edgeDashWhileWorking: "4 4",
    edgeDashWhenDone: "0 0",
    drawOnDurationMs: 600, // stroke-dashoffset draw

    // Active node glow — radial gradient that breathes during work.
    activeGlow: {
      color: "rgba(8,108,232,0.4)",
      radiusPx: 16,
      breathDurationMs: 2400,
    },

    // Result node accent (final terminal of a trail).
    resultAccent: {
      ring: "rgba(255, 184, 0, 0.5)",
      ringOpacity: 0.7,
    },

    // Collapse: trail folds back into a small badge on the source card.
    collapseDurationMs: 480,
  },

  // Probe chip — small floating bubble above a selected card on canvas.
  probeChip: {
    width: 220,
    radius: 10,
    paddingX: 10,
    paddingY: 6,
    bgGlassTier: "float" as const,
    enterDurationMs: 240,
  },
} as const;

// ── Motion grammar ───────────────────────────────────────────────────
//
// Named curves + durations so JSX never carries inline cubic-beziers.
// Two curves cover 95% of cases:
//   easeOut → out-of-rest motion (entrances, fades). One direction.
//   spring  → settles to rest with overshoot (pins, count badge pop).
//
// Durations in ms. Skip 200/300 (default-y) intentionally.

export const motion = {
  curves: {
    easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
    spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    springTight: "cubic-bezier(0.25, 0.8, 0.25, 1)",
    // CSS variable names already wired in globals.css for parity:
    //   var(--ease-spring-soft) → spring
    //   var(--ease-spring-tight) → springTight
  },
  durations: {
    micro: 140,
    short: 240,
    medium: 360,
    cinematic: 480,
    breath: 2400,
  },
} as const;

export type RailZone = "state" | "live";
