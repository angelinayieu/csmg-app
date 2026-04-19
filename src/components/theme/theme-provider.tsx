"use client";

import { useEffect } from "react";
import { useAppStore } from "@/stores/store-provider";
import { THEMES, THEME_STORAGE_KEY, DEFAULT_THEME, type ThemeId } from "@/lib/themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useAppStore((s) => s.colorScheme);
  const setColorScheme = useAppStore((s) => s.setColorScheme);

  // On mount: read saved theme from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    if (saved && saved in THEMES && saved !== colorScheme) {
      setColorScheme(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme CSS variables whenever colorScheme changes
  useEffect(() => {
    const root = document.documentElement;
    // Set data-theme attribute
    if (colorScheme === DEFAULT_THEME) {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", colorScheme);
    }
    // Apply CSS variables directly for immediate effect
    const vars = THEMES[colorScheme]?.cssVars;
    if (vars) {
      for (const [key, value] of Object.entries(vars)) {
        root.style.setProperty(key, value);
      }
    }
  }, [colorScheme]);

  return <>{children}</>;
}
