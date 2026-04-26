// ── Reasoning settings ──────────────────────────────────────────────
//
// User-controllable customization of how the pipeline reasons. Surfaced
// as a "Reasoning Settings" panel in the prompt intake; persisted to
// `spaces.reasoning_settings` on bootstrap so downstream stages can
// read them.
//
// Three categories:
//   - lenses[]       — which framing personas are active (multi-select)
//   - process flags  — per-toggle behavior switches (askQuestions,
//                      buildBaselineFirst, showAlternatives)
//   - depth          — already-existing tier system surfaced here
//                      for one cohesive panel UX
//
// Defaults are smart for first-time users (3 lenses on, askQuestions
// off) so the panel can be fully collapsed without losing analysis
// quality. Power users open it to dial in.

export type ReasoningLens =
  | "systems_analyst"
  | "skeptic"
  | "operator"
  | "engineer"
  | "historian";

export type ReasoningDepth = "quick" | "standard" | "deep";

export interface ReasoningSettings {
  /** Multi-select of framing personas. Defaults: systems_analyst,
   *  skeptic, operator (the historical defaults the framing-panel
   *  hardcoded). Engineer + Historian are off by default — they're
   *  high-signal for some domains but noise for casual prompts. */
  lenses: ReasoningLens[];
  /** Tier — already wired into credit cost + research pass count.
   *  Surfaced in the same panel for one cohesive control. */
  depth: ReasoningDepth;
  /** Pre-flight clarifier: when on, before the pipeline fires, the
   *  system generates 3-5 questions and pauses for user answers.
   *  Answers append to input_text before bootstrap runs. */
  askClarifyingQuestions: boolean;
  /** Force the situation analyzer to run even when twin_mode would
   *  normally skip (vague/idea-only intake). When false (default),
   *  vague intakes go straight to landscape generation. When true,
   *  the analyzer runs regardless and produces best-effort output. */
  buildBaselineFirst: boolean;
  /** Generate 3 strategy variants in parallel (vs single best). The
   *  pipeline currently always does this — surfacing the toggle
   *  so users know it's on, and so a future "single proposal only"
   *  mode has a hook. */
  showAlternatives: boolean;
}

export const DEFAULT_REASONING_SETTINGS: ReasoningSettings = {
  lenses: ["systems_analyst", "skeptic", "operator"],
  depth: "standard",
  askClarifyingQuestions: false,
  buildBaselineFirst: false,
  showAlternatives: true,
};

export const LENS_META: Record<
  ReasoningLens,
  {
    label: string;
    description: string;
    /** Hex accent — drives chip color in the settings panel. */
    accent: string;
  }
> = {
  systems_analyst: {
    label: "Systems Analyst",
    description: "Feedback loops, mechanisms, emergence",
    accent: "#0891B2",
  },
  skeptic: {
    label: "Skeptic",
    description: "Challenge assumptions, find blind spots",
    accent: "#9333EA",
  },
  operator: {
    label: "Operator",
    description: "Day-to-day execution friction, edge cases",
    accent: "#D97706",
  },
  engineer: {
    label: "Engineer",
    description: "Physical and structural constraints",
    accent: "#2563EB",
  },
  historian: {
    label: "Historian",
    description: "Precedents and reference classes",
    accent: "#059669",
  },
};

export const DEPTH_META: Record<
  ReasoningDepth,
  { label: string; hint: string }
> = {
  quick: { label: "Fast", hint: "1 research pass, ~30s" },
  standard: { label: "Balanced", hint: "2 research passes, ~60s" },
  deep: { label: "Deep", hint: "3 research passes, ~120s" },
};

/**
 * Defensive coercer — runtime data (URL params, persisted localStorage,
 * server JSON) can be malformed. Always returns a valid settings object.
 */
export function coerceReasoningSettings(raw: unknown): ReasoningSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_REASONING_SETTINGS };
  const r = raw as Record<string, unknown>;

  const lenses = Array.isArray(r.lenses)
    ? (r.lenses as unknown[])
        .filter((l): l is ReasoningLens =>
          typeof l === "string" &&
          ["systems_analyst", "skeptic", "operator", "engineer", "historian"].includes(l),
        )
    : DEFAULT_REASONING_SETTINGS.lenses;

  const depth: ReasoningDepth =
    r.depth === "quick" || r.depth === "standard" || r.depth === "deep"
      ? r.depth
      : DEFAULT_REASONING_SETTINGS.depth;

  return {
    lenses: lenses.length > 0 ? lenses : DEFAULT_REASONING_SETTINGS.lenses,
    depth,
    askClarifyingQuestions: r.askClarifyingQuestions === true,
    buildBaselineFirst: r.buildBaselineFirst === true,
    showAlternatives: r.showAlternatives !== false, // default true
  };
}
