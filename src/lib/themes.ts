export type ThemeId = "teal" | "blue" | "dark";

export interface ThemeDefinition {
  label: string;
  swatch: string; // preview color for settings UI
  cssVars: Record<string, string>;
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  teal: {
    label: "Teal",
    swatch: "#00BCD4",
    cssVars: {
      "--accent-50": "#E0F7FA",
      "--accent-100": "#B2EBF2",
      "--accent-200": "#80DEEA",
      "--accent-300": "#4DD0E1",
      "--accent-400": "#26C6DA",
      "--accent-500": "#00BCD4",
      "--accent-600": "#00ACC1",
      "--accent-700": "#0097A7",
      "--accent-rgb": "0, 188, 212",
      "--gradient-name-end": "#0097A7",
      "--gradient-page-start": "#E0F7FA",
      "--gradient-page-mid": "#F0FAFB",
    },
  },
  blue: {
    label: "Deep Blue",
    swatch: "#1a7aff",
    cssVars: {
      "--accent-50": "#e8f0ff",
      "--accent-100": "#c8daff",
      "--accent-200": "#9bb8ff",
      "--accent-300": "#6a94ff",
      "--accent-400": "#4a7dff",
      "--accent-500": "#1a7aff",
      "--accent-600": "#0a6aee",
      "--accent-700": "#0051cc",
      "--accent-rgb": "26, 122, 255",
      "--gradient-name-end": "#0a56d6",
      "--gradient-page-start": "#eef2f8",
      "--gradient-page-mid": "#f4f7fb",
    },
  },
  dark: {
    label: "Dark",
    // Swatch is a tiny slate-navy chip; the accent under dark stays teal
    // so charts/rings don't lose their identity.
    swatch: "#0a0e14",
    cssVars: {
      // Accent kept teal so "InterAxis teal" still reads as the brand,
      // just slightly brighter for contrast against dark surfaces.
      "--accent-50": "#0B2A30",
      "--accent-100": "#0F3B44",
      "--accent-200": "#155460",
      "--accent-300": "#1B6F7E",
      "--accent-400": "#22889C",
      "--accent-500": "#26C6DA",
      "--accent-600": "#4DD0E1",
      "--accent-700": "#80DEEA",
      "--accent-rgb": "77, 208, 225",
      "--gradient-name-end": "#80DEEA",
      // Dark page gradient — two stops of near-black slate
      "--gradient-page-start": "#0a0e14",
      "--gradient-page-mid": "#10161f",
    },
  },
};

export const DEFAULT_THEME: ThemeId = "teal";
export const THEME_STORAGE_KEY = "interaxis-theme";
