// Color slots for cascade rows. The names "finance" / "customers" / "internal" /
// "learning" are LEGACY identifiers carried for compatibility with the
// PERSPECTIVE_PALETTES record and tldraw shape validators — they carry NO
// semantic meaning. Slot assignment is purely index-based color rotation; the
// row's actual subtitle is the LLM-generated perspective.name (rendered by
// PerspectiveCard, see P0 fix). DO NOT add a regex that maps perspective names
// to slots — that path produced the "FINANCE on a reminder app" bug where a
// hardcoded BSC label silently overrode domain-natural LLM output.

export type PaletteSlot = "finance" | "customers" | "internal" | "learning";

export interface PerspectivePalette {
  key: PaletteSlot;
  label: string;
  accent: string;
  deep: string;
  tint: string;
  softBg: string;
  edge: string;
}

export const PERSPECTIVE_PALETTES: Record<PaletteSlot, PerspectivePalette> = {
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

const PALETTE_ROTATION: PaletteSlot[] = [
  "finance",
  "customers",
  "internal",
  "learning",
];

/**
 * Pick a palette slot by row index. Pure color rotation — does NOT inspect
 * the perspective name. The previous regex-based mapper was removed because
 * it silently coerced LLM-generated names like "Adaptive Quality" into
 * "finance" via cycle-fallback, which then surfaced as a bogus "FINANCE"
 * subtitle on the row.
 */
export function paletteSlot(index: number): PaletteSlot {
  return PALETTE_ROTATION[index % PALETTE_ROTATION.length] ?? "internal";
}

export function palette(key: PaletteSlot): PerspectivePalette {
  return PERSPECTIVE_PALETTES[key];
}
