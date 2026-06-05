// ── Global AI thinking settings (the top-bar control cluster) ──
//
// One source of truth for the knobs every canvas AI op reads, persisted to
// localStorage and broadcast on change so open surfaces re-render. Read at
// click time by the run paths (no prop-drilling), mirroring the converge-
// diverge engine toggle. tldraw-free + dependency-free.
//
//   temperature — 0..1 exploratory dial (shared key with the scanner slider)
//   depth       — 1..5 reasoning rigor (quick → deep / probe-assumptions)
//   complexity  — number of questions a diverge/converge pass generates
//   webSearch   — ground the pass with live web search (light, ~4 searches)
//   uiPlanCount — how many UI-plan variants the "Build prototype" fork spawns

export interface AiSettings {
  temperature: number;
  depth: number;
  complexity: number;
  webSearch: boolean;
  uiPlanCount: number;
}

/** Shared with ai-scanner-panel's slider + converge-diverge.getAnalysisTemperature. */
export const TEMPERATURE_KEY = "oc:analysis-temperature";
export const DEPTH_KEY = "oc:thinking-depth";
export const COMPLEXITY_KEY = "oc:complexity";
export const WEB_SEARCH_KEY = "oc:web-search";
export const UI_PLAN_COUNT_KEY = "oc:ui-plan-count";

export const AI_SETTINGS_EVENT = "oc:ai-settings-changed";

export const DEFAULTS: AiSettings = {
  temperature: 0.4,
  depth: 3,
  complexity: 5,
  webSearch: false,
  uiPlanCount: 3,
};

/** Bounds the knobs share with the route validators. */
export const DEPTH_MIN = 1;
export const DEPTH_MAX = 5;
export const COMPLEXITY_MIN = 3;
export const COMPLEXITY_MAX = 10;
export const UI_PLAN_COUNT_MIN = 1;
export const UI_PLAN_COUNT_MAX = 5;

function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = Number(window.localStorage.getItem(key));
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Read the full settings (SSR-safe → DEFAULTS on the server). */
export function getAiSettings(): AiSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  return {
    temperature: readNumber(TEMPERATURE_KEY, DEFAULTS.temperature, 0, 1),
    depth: Math.round(readNumber(DEPTH_KEY, DEFAULTS.depth, DEPTH_MIN, DEPTH_MAX)),
    complexity: Math.round(
      readNumber(COMPLEXITY_KEY, DEFAULTS.complexity, COMPLEXITY_MIN, COMPLEXITY_MAX),
    ),
    uiPlanCount: Math.round(
      readNumber(
        UI_PLAN_COUNT_KEY,
        DEFAULTS.uiPlanCount,
        UI_PLAN_COUNT_MIN,
        UI_PLAN_COUNT_MAX,
      ),
    ),
    webSearch: (() => {
      try {
        return window.localStorage.getItem(WEB_SEARCH_KEY) === "1";
      } catch {
        return DEFAULTS.webSearch;
      }
    })(),
  };
}

/** Persist one setting + broadcast so any open surface re-reads. */
export function setAiSetting<K extends keyof AiSettings>(
  key: K,
  value: AiSettings[K],
): void {
  const storageKey =
    key === "temperature"
      ? TEMPERATURE_KEY
      : key === "depth"
        ? DEPTH_KEY
        : key === "complexity"
          ? COMPLEXITY_KEY
          : key === "uiPlanCount"
            ? UI_PLAN_COUNT_KEY
            : WEB_SEARCH_KEY;
  try {
    const raw =
      typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    window.localStorage.setItem(storageKey, raw);
    window.dispatchEvent(new CustomEvent(AI_SETTINGS_EVENT, { detail: getAiSettings() }));
  } catch {
    /* private mode — in-memory toggle state still drives this session */
  }
}
