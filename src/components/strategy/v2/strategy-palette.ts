// BSC perspective color palette — semantic only.
// Limited to numbox fill + 4px accent bar + proxy chip bg.
// Everything else on the Strategy v2 page uses --accent-* CSS vars (re-theme with blue).

export type PerspectiveKey = "finance" | "customers" | "internal" | "learning";

export interface PerspectivePalette {
  key: PerspectiveKey;
  label: string;
  accent: string;
  deep: string;
  tint: string;
  softBg: string;
  edge: string;
}

export const PERSPECTIVE_PALETTES: Record<PerspectiveKey, PerspectivePalette> = {
  finance: {
    key: "finance",
    label: "Finance",
    accent: "#D97706",
    deep: "#92400E",
    tint: "#FFFBEB",
    softBg: "#FEF3C7",
    edge: "#FDE68A",
  },
  customers: {
    key: "customers",
    label: "Customers",
    accent: "#059669",
    deep: "#065F46",
    tint: "#ECFDF5",
    softBg: "#D1FAE5",
    edge: "#A7F3D0",
  },
  // "internal" uses the accent CSS var (blue) so it re-themes
  internal: {
    key: "internal",
    label: "Internal",
    accent: "var(--accent-600)",
    deep: "var(--accent-700)",
    tint: "var(--accent-50)",
    softBg: "var(--accent-100)",
    edge: "var(--accent-200, #a3c2ff)",
  },
  learning: {
    key: "learning",
    label: "Learning & Growth",
    accent: "#9333EA",
    deep: "#6B21A8",
    tint: "#FAF5FF",
    softBg: "#F3E8FF",
    edge: "#E9D5FF",
  },
};

/**
 * Map a perspective's `name` to one of our 4 keys.
 * Strategies in the wild can have arbitrary perspective names — we match by first keyword
 * and fall back to a rotating index.
 */
export function perspectiveKey(
  name: string | undefined,
  index: number,
): PerspectiveKey {
  const lower = (name ?? "").toLowerCase();
  if (/finan|cost|budget|revenue|roi|profit/.test(lower)) return "finance";
  if (/cust|user|client|exper|adopt|market/.test(lower)) return "customers";
  if (/intern|process|operat|workflow|quality|compliance/.test(lower)) return "internal";
  if (/learn|growth|train|capab|cultur|skill/.test(lower)) return "learning";
  // fallback by slot so 4 rows still get 4 distinct colors
  const order: PerspectiveKey[] = ["finance", "customers", "internal", "learning"];
  return order[index % 4] ?? "internal";
}

export function palette(key: PerspectiveKey): PerspectivePalette {
  return PERSPECTIVE_PALETTES[key];
}
