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
    concrete: { bg: "#EFF6FF", text: "#1D4ED8", stroke: "#3B82F6" },
    abstract: { bg: "#F5F3FF", text: "#6D28D9", stroke: "#8B5CF6" },
    process: { bg: "#ECFDF5", text: "#047857", stroke: "#10B981" },
    relational: { bg: "#FFF7ED", text: "#C2410C", stroke: "#F97316" },
    epistemic: { bg: "#FDF2F8", text: "#BE185D", stroke: "#EC4899" },
  },
} as const;

export const typography = {
  fontFamily:
    '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
  monoFamily:
    '"SF Mono", "Fira Code", "JetBrains Mono", ui-monospace, monospace',

  h1: { size: 20, weight: 600, tracking: "-0.02em" },
  h2: { size: 15, weight: 600, tracking: "-0.01em" },
  section: {
    size: 11,
    weight: 600,
    tracking: "0.04em",
    transform: "uppercase" as const,
  },
  body: { size: 13.5, weight: 400, lineHeight: 1.65 },
  caption: { size: 11, weight: 400, lineHeight: 1.4 },
  label: {
    size: 10,
    weight: 600,
    tracking: "0.05em",
    transform: "uppercase" as const,
  },
  mono: { size: 10, weight: 400, lineHeight: 1.6 },
  entityId: { size: 11, weight: 600, tracking: "0.03em" },
  value: { size: 20, weight: 700, lineHeight: 1 },
} as const;

export const spacing = {
  card: { padding: "22px 24px", radius: 14, gap: 16 },
  insetCard: { padding: "20px 22px", radius: 12 },
  callout: { padding: "11px 14px", radius: 9, borderLeft: 2.5 },
  metricCell: { padding: "13px 14px", radius: 10 },
  listItem: { padding: "10px 12px", radius: 10 },
  badge: { padding: "2px 7px", radius: 4 },
  button: { padding: "9px 0", radius: 8 },
  sidebar: { width: 272 },
  rightPanel: { width: 288 },
  sectionGap: 16,
  cardGap: 6,
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

// Graph: node fill/stroke colors by entity category (for D3 SVG rendering)
export const nodeColors = {
  concrete: { fill: "#E6F1FB", stroke: "#378ADD" },
  abstract: { fill: "#EEEDFE", stroke: "#7F77DD" },
  process: { fill: "#E1F5EE", stroke: "#1D9E75" },
  relational: { fill: "#FAECE7", stroke: "#D85A30" },
  epistemic: { fill: "#FBEAF0", stroke: "#D4537E" },
} as const;

// Graph: edge dimension styles (color, dash pattern, width)
export const edgeDimensionStyles: Record<
  string,
  { color: string; dash: string; width: number }
> = {
  structural: { color: "#888780", dash: "", width: 0.5 },
  functional: { color: "#1D9E75", dash: "", width: 1 },
  temporal: { color: "#BA7517", dash: "4 3", width: 0.5 },
  causal: { color: "#D85A30", dash: "", width: 1.5 },
  correlational: { color: "#888780", dash: "2 2", width: 0.5 },
  logical: { color: "#7F77DD", dash: "", width: 1 },
  epistemic: { color: "#D4537E", dash: "4 3", width: 0.5 },
  comparative: { color: "#378ADD", dash: "2 2", width: 0.5 },
  agentive: { color: "#639922", dash: "", width: 1 },
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

// Domain colors for multi-space unified graph
export const domainColors: Array<{ fill: string; stroke: string; label: string }> = [
  { fill: "#E6F1FB", stroke: "#378ADD", label: "blue" },     // Space A
  { fill: "#EEEDFE", stroke: "#7F77DD", label: "purple" },   // Space B
  { fill: "#FAECE7", stroke: "#D85A30", label: "coral" },    // Space C
  { fill: "#E1F5EE", stroke: "#1D9E75", label: "teal" },     // Space D
  { fill: "#FFF8E6", stroke: "#BA7517", label: "amber" },    // Space E
  { fill: "#FBEAF0", stroke: "#D4537E", label: "pink" },     // Space F
  { fill: "#F0FFF4", stroke: "#639922", label: "green" },    // Space G
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
