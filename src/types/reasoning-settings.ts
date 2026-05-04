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
  // ── Output-shape toggles (intake-prominent) ─────────────────────
  // These three controls live ON THE CHATBOX ROW (not in the
  // collapsed advanced panel) because they materially change the
  // shape and cost of the pipeline output. Defaults are OFF for
  // apps + lab so the strategy hero card is the single primary
  // payload; users opt in to downstream materialization.
  /** When true, materialize Apps (and their interventions) on
   *  strategy confirm. Default false — strategy-only mode. Sourced
   *  by /api/pipeline/strategy-refresh as the inverse of `deferApps`. */
  generateApps: boolean;
  /** When true, run inline Monte Carlo simulation during app
   *  generation AND kick off the variant factory / writer-path
   *  background work. Default false — no lab pre-runs unless asked. */
  runLab: boolean;
  /** How many ranked strategies to generate (1..5). Default 3.
   *  Plumbs into getSynthesisPrompt's option count and a final
   *  slice on ranked_strategies in strategy-engine. */
  strategyCount: number;
  // ── D3 · cost / time budget constraints ─────────────────────────
  // Optional user-facing constraints the strategizer reads to
  // hard-filter or down-rank candidates whose intervention_cost
  // exceeds the budget or whose time_to_effect overshoots the
  // deadline. Both fields default to undefined — when both are
  // absent, the strategizer behaves identically to pre-D3.
  //
  // See docs/KG_DEPTH_CRITIQUE.md §9 D3 + the
  // ControllabilityProfile schema in src/types/controllability.ts.
  /** USD-equivalent ceiling on a single intervention's direct cost.
   *  Levers whose `manifold.operational.controllability.intervention_cost.estimate`
   *  exceeds this value get hard-filtered from the candidate pool
   *  (or down-weighted, depending on the strategizer mode — see
   *  cost_budget_strictness). Optional. */
  costBudget?: number;
  /** How aggressively to enforce costBudget. "soft" applies a
   *  log-cost penalty to over-budget candidates; "hard" filters
   *  them out entirely. Defaults to "soft" so the user always
   *  sees alternatives even when budget-tight, with the
   *  over-budget ones visibly de-prioritized. */
  costBudgetStrictness?: "soft" | "hard";
  /** Free-form deadline string interpreted as the user's solve-by
   *  time horizon. Examples: "end of Q3", "2026-08-15", "this week",
   *  "in two months". The strategizer maps it to the existing
   *  outcome_horizon enum (immediate | short_term | medium_term |
   *  long_term) so horizon-weights.ts already-shipped modulation
   *  applies uniformly. When set, it OVERRIDES the LLM-inferred
   *  outcome_horizon — explicit user constraint wins. */
  solveBy?: string;
}

export const DEFAULT_REASONING_SETTINGS: ReasoningSettings = {
  lenses: ["systems_analyst", "skeptic", "operator"],
  depth: "standard",
  askClarifyingQuestions: false,
  buildBaselineFirst: false,
  showAlternatives: true,
  // Default true: strategy → apps is the natural completion of a project's
  // intake flow. Without this, every fresh project ends with "0 apps" and
  // the dashboard's apps surfaces stay empty until the user discovers the
  // separate "generate apps" action. Power users can still opt out by
  // toggling generateApps=false explicitly in the intake settings.
  generateApps: true,
  runLab: false,
  strategyCount: 3,
};

/** Bounds for the strategyCount stepper. Keep tight so the LLM
 *  doesn't fan out into low-quality alternatives; >5 strategies
 *  is rarely actionable. */
export const STRATEGY_COUNT_MIN = 1;
export const STRATEGY_COUNT_MAX = 5;
export const STRATEGY_COUNT_DEFAULT = 3;

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

  // strategyCount: clamp to [MIN, MAX]; default to DEFAULT when missing
  // or non-numeric. We intentionally floor non-integers (3.7 → 3).
  let strategyCount = STRATEGY_COUNT_DEFAULT;
  if (typeof r.strategyCount === "number" && Number.isFinite(r.strategyCount)) {
    strategyCount = Math.min(
      STRATEGY_COUNT_MAX,
      Math.max(STRATEGY_COUNT_MIN, Math.floor(r.strategyCount)),
    );
  }

  // ── D3 · cost budget + solve-by deadline ──────────────────────
  let costBudget: number | undefined;
  if (
    typeof r.costBudget === "number" &&
    Number.isFinite(r.costBudget) &&
    r.costBudget >= 0
  ) {
    costBudget = r.costBudget;
  }
  const costBudgetStrictness =
    r.costBudgetStrictness === "hard" || r.costBudgetStrictness === "soft"
      ? (r.costBudgetStrictness as "hard" | "soft")
      : undefined;
  const solveBy =
    typeof r.solveBy === "string" && r.solveBy.trim().length > 0
      ? r.solveBy.trim().slice(0, 200)
      : undefined;

  return {
    lenses: lenses.length > 0 ? lenses : DEFAULT_REASONING_SETTINGS.lenses,
    depth,
    askClarifyingQuestions: r.askClarifyingQuestions === true,
    buildBaselineFirst: r.buildBaselineFirst === true,
    showAlternatives: r.showAlternatives !== false, // default true
    // generateApps defaults to TRUE (strategy → apps is the natural
    // completion of intake; explicit opt-out via generateApps=false).
    // runLab still defaults to FALSE (heavier; explicit opt-in only).
    generateApps: r.generateApps !== false,
    runLab: r.runLab === true,
    strategyCount,
    ...(costBudget !== undefined ? { costBudget } : {}),
    ...(costBudgetStrictness !== undefined ? { costBudgetStrictness } : {}),
    ...(solveBy !== undefined ? { solveBy } : {}),
  };
}

// ── D3 · solve-by → horizon mapping ──────────────────────────────────
//
// Maps the user's free-form deadline string onto the existing
// `outcome_horizon` enum that horizon-weights.ts already understands.
// Conservative — when the string is ambiguous, returns null so the
// strategizer falls back to the LLM-inferred horizon rather than
// asserting a guess.

export type SolveByHorizon =
  | "immediate"
  | "short_term"
  | "medium_term"
  | "long_term";

const NOW_KEYWORDS = /\b(now|today|asap|urgent|tonight)\b/i;
const SHORT_KEYWORDS =
  /\b(this\s+week|next\s+week|days?|few days|in\s+\d+\s*days?|by\s+friday|by\s+monday)\b/i;
const MEDIUM_KEYWORDS =
  /\b(month|months|quarter|quarters|q[1-4]|by\s+(end\s+of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))\b/i;
const LONG_KEYWORDS = /\b(year|years|annual|long-?term|fy\d{2,4})\b/i;

export function mapSolveByToHorizon(
  raw: string | null | undefined,
): SolveByHorizon | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  if (s.length === 0) return null;
  if (NOW_KEYWORDS.test(s)) return "immediate";
  if (SHORT_KEYWORDS.test(s)) return "short_term";
  if (MEDIUM_KEYWORDS.test(s)) return "medium_term";
  if (LONG_KEYWORDS.test(s)) return "long_term";
  // Try to detect explicit dates and bucket by distance from now.
  // Cheap heuristic — don't try to parse every format. When parsing
  // fails, return null so the LLM-inferred horizon wins.
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const daysOut = (parsed - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysOut <= 1) return "immediate";
    if (daysOut <= 14) return "short_term";
    if (daysOut <= 90) return "medium_term";
    if (daysOut > 90) return "long_term";
  }
  return null;
}
