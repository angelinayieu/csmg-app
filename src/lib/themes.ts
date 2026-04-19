export type ThemeId = "teal" | "blue";

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
};

export const DEFAULT_THEME: ThemeId = "teal";
export const THEME_STORAGE_KEY = "interaxis-theme";
