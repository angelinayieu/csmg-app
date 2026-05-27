// ── Operational Constraints ────────────────────────────────────────
//
// The "without these, optimize is meaningless" piece. The system
// needs to know the user's situation — time horizon, budget tier,
// team size, risk tolerance, compliance requirements — to make
// every downstream prompt meaningfully different across user kinds.
// Otherwise variations / compositions / prototype briefs read the
// same for a solo founder and an enterprise PM.
//
// Storage strategy: nested under spaces.synthesis_data.constraints
// (no migration needed — synthesis_data is already jsonb and the
// canvas state reader already handles it).
//
// Inference strategy: a single LLM call reads the objective text +
// clarifying answers and produces a constraints object. The user
// can override any field in the UI later. Both auto-inference and
// manual override land in the same shape.

import { llmJSON } from "@/lib/llm";

export type TimeHorizon =
  | "days"
  | "weeks"
  | "months"
  | "quarter"
  | "year_plus";

export type BudgetTier = "zero" | "low" | "moderate" | "substantial";

export type TeamSize = "solo" | "small" | "medium" | "large";

export type RiskTolerance =
  | "experimental"
  | "calibrated"
  | "conservative";

/** Phase 11.8 — what kind of work the user is doing in this space.
 *  Drives default tier mix, indicator templates, and whether
 *  baselines are required. Same engine flexes per intent:
 *
 *    consumer_app    — building a product. Rubric default, no
 *                      baseline required, indicators slant toward
 *                      engagement/retention/conversion.
 *    personal_health — designing an intervention for self or
 *                      patient. Ensemble default, BASELINE REQUIRED
 *                      on every outcome before scoring fires,
 *                      indicators slant toward validated psychometrics
 *                      / wearable data / clinical instruments.
 *    scientific      — predicting effects across a population from
 *                      literature. Ensemble + evidence pooling
 *                      default, indicators slant toward meta-analysis-
 *                      ready endpoints (VAS, BPI, ODI, etc.).
 *
 *  Null = mode hasn't been set yet; treat as consumer_app
 *  (current behavior) for backward compat. */
export type UseCaseMode =
  | "consumer_app"
  | "personal_health"
  | "scientific";

export interface OperationalConstraints {
  /** How long the user has to actually act. Drives prototype-lab
   *  cost gates ("you can't afford a 4-week experiment"). */
  time_horizon: TimeHorizon;
  /** Budget envelope category. Same purpose: filter expensive
   *  options out of variations. */
  budget_tier: BudgetTier;
  /** Solo / small / medium / large team. Affects which variations
   *  are even reachable (a solo dev can't ship "third-party audit"
   *  as a feature, but can use it as a principle). */
  team_size: TeamSize;
  /** How much surprise the user can absorb. */
  risk_tolerance: RiskTolerance;
  /** Free-text compliance lines — HIPAA, GDPR, SOC2, accessibility,
   *  whatever the user named. The LLM treats them as hard rejects
   *  for variations that violate them. */
  compliance_requirements: string[];
  /** Phase 11.8 — use-case mode. Drives default scorer + indicator
   *  templates + baseline requirement. Optional for backward compat;
   *  pre-11.8 spaces default to consumer_app at read time. */
  use_case_mode?: UseCaseMode;
  /** Source — auto-inferred from clarifying or hand-set by user. */
  source: "inferred" | "user";
  /** When this constraint set was captured. Used for invalidation
   *  when the objective text shifts substantially. */
  generated_at: string;
}

/** Read constraints from a space's synthesis_data jsonb. Returns
 *  null when no constraints have been captured yet. Caller fans
 *  out to default-fallback behavior in that case (e.g. infer
 *  on-demand or skip the constraints block in prompts). */
export function readConstraints(
  synthesisData: unknown,
): OperationalConstraints | null {
  if (!synthesisData || typeof synthesisData !== "object") return null;
  const sd = synthesisData as Record<string, unknown>;
  const raw = sd.constraints;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // Loose validation — accept the shape, default missing fields.
  return {
    time_horizon: validTimeHorizon(r.time_horizon),
    budget_tier: validBudgetTier(r.budget_tier),
    team_size: validTeamSize(r.team_size),
    risk_tolerance: validRiskTolerance(r.risk_tolerance),
    compliance_requirements: Array.isArray(r.compliance_requirements)
      ? (r.compliance_requirements as unknown[])
          .filter((s): s is string => typeof s === "string")
          .slice(0, 6)
      : [],
    use_case_mode:
      r.use_case_mode === "consumer_app" ||
      r.use_case_mode === "personal_health" ||
      r.use_case_mode === "scientific"
        ? (r.use_case_mode as UseCaseMode)
        : undefined,
    source: r.source === "user" ? "user" : "inferred",
    generated_at:
      typeof r.generated_at === "string"
        ? r.generated_at
        : new Date().toISOString(),
  };
}

/** Phase 11.8 — resolve the mode with the back-compat default.
 *  Returns "consumer_app" when no mode has been set (preserves
 *  pre-11.8 behavior where every space behaved like an app build).
 *  Use this everywhere instead of reading use_case_mode directly so
 *  the fallback stays consistent. */
export function resolveUseCaseMode(
  c: OperationalConstraints | null,
): UseCaseMode {
  return c?.use_case_mode ?? "consumer_app";
}

/** Phase 11.8 — default scoring method for the use case mode.
 *  Score routes call this to pick rubric vs ensemble when the
 *  caller didn't specify method explicitly. */
export function defaultScoringMethodFor(
  mode: UseCaseMode,
): "rubric" | "simulation" {
  // Personal health + scientific use cases benefit from the heavier
  // ensemble path (multi-lens + REML τ² pooling) by default. App
  // builders default to rubric — cheaper, faster, fits the iteration
  // velocity an app team needs.
  // NOTE: "simulation" here is the existing route enum; ensemble is
  // gated by the same param value in the route's branch.
  if (mode === "personal_health" || mode === "scientific") {
    return "simulation";
  }
  return "rubric";
}

/** Phase 11.8 — when set, baselines on outcome indicators are
 *  treated as REQUIRED before scoring fires. The score route can
 *  use this to short-circuit with a friendly "set baselines first"
 *  error rather than producing meaningless abstract scores. */
export function baselinesRequiredFor(mode: UseCaseMode): boolean {
  // Personal-health + scientific use cases need measurable baselines
  // to produce honest projected-delta scores. App-build mode treats
  // baselines as optional (most app indicators are operational
  // metrics the user discovers post-launch). */
  return mode === "personal_health" || mode === "scientific";
}

/** Build the prompt block injected into expand / compose / room
 *  prompts when constraints are present. Compact so it doesn't
 *  inflate token cost on every call. */
export function buildConstraintsBlock(
  c: OperationalConstraints | null,
): string {
  if (!c) return "";
  const lines: string[] = [
    "OPERATIONAL CONSTRAINTS (the user's actual situation — every output must respect these, not generic best-practice):",
    `  Time horizon: ${TIME_LABEL[c.time_horizon]}`,
    `  Budget tier: ${BUDGET_LABEL[c.budget_tier]}`,
    `  Team size: ${TEAM_LABEL[c.team_size]}`,
    `  Risk tolerance: ${RISK_LABEL[c.risk_tolerance]}`,
  ];
  if (c.compliance_requirements.length > 0) {
    lines.push(
      `  Compliance: ${c.compliance_requirements.join(", ")} (HARD constraints — variations that violate these are forbidden, not "consider")`,
    );
  }
  return `\n\n${lines.join("\n")}\n`;
}

const TIME_LABEL: Record<TimeHorizon, string> = {
  days: "days (single week)",
  weeks: "weeks (2-4)",
  months: "months (1-3)",
  quarter: "a quarter (3 months)",
  year_plus: "a year or longer",
};

const BUDGET_LABEL: Record<BudgetTier, string> = {
  zero: "zero (only time + existing tools)",
  low: "low (<$1k or hobby-tier)",
  moderate: "moderate ($1k-$50k)",
  substantial: "substantial ($50k+ or funded)",
};

const TEAM_LABEL: Record<TeamSize, string> = {
  solo: "solo (1 person doing everything)",
  small: "small (2-5 people)",
  medium: "medium (6-20)",
  large: "large (20+)",
};

const RISK_LABEL: Record<RiskTolerance, string> = {
  experimental: "experimental (welcomes surprise, lots of iteration)",
  calibrated: "calibrated (measured bets with kill criteria)",
  conservative: "conservative (proven patterns, low failure tolerance)",
};

// ── LLM inference — single call reading objective + clarifying ────

interface InferenceContext {
  objectiveText: string;
  clarifyingAnswers: Array<{ question: string; answer: string }>;
}

export async function inferConstraints(
  ctx: InferenceContext,
): Promise<OperationalConstraints> {
  const clarifyingBlock =
    ctx.clarifyingAnswers.length > 0
      ? `\n\nCLARIFYING ANSWERS:\n${ctx.clarifyingAnswers
          .map((a, i) => `  ${i + 1}. ${a.question} → ${a.answer}`)
          .join("\n")}`
      : "";

  const system = `You infer the user's operational constraints from their stated objective + clarifying answers.

Pick the SINGLE BEST option for each axis. If the text doesn't reveal the answer, pick the most charitable middle option (don't bias toward extremes). Conservatism error > overreach error — better to under-resource than over-promise.

Axes:

TIME_HORIZON — how long does the user have to act?
  "days"      — a single week or less (urgent, sprint)
  "weeks"     — 2-4 weeks
  "months"    — 1-3 months
  "quarter"   — ~3 months specifically (planning rhythm)
  "year_plus" — open-ended, long arc

BUDGET_TIER — how much money is available?
  "zero"        — only their time + existing tools
  "low"         — <$1k, hobby/bootstrap
  "moderate"    — $1k-$50k, small business / side project
  "substantial" — $50k+, funded / enterprise

TEAM_SIZE — how many people will execute?
  "solo"   — 1 person (the user)
  "small"  — 2-5
  "medium" — 6-20
  "large"  — 20+

RISK_TOLERANCE — appetite for failure?
  "experimental" — welcomes surprise, lots of iteration, learning-oriented
  "calibrated"   — measured bets with explicit kill criteria
  "conservative" — proven patterns, low tolerance for failure

COMPLIANCE_REQUIREMENTS — hard constraints the user mentioned (HIPAA, GDPR, SOC2, FDA, accessibility, etc.). Free-text array. Empty if none surface.

Return strict JSON.`;

  const user = `OBJECTIVE:\n"""\n${ctx.objectiveText.slice(0, 1200)}\n"""${clarifyingBlock}\n\nInfer the operational constraints.`;

  const raw = await llmJSON<{
    time_horizon?: unknown;
    budget_tier?: unknown;
    team_size?: unknown;
    risk_tolerance?: unknown;
    compliance_requirements?: unknown;
  }>({
    system,
    user,
    responseSchema: {
      name: "operational_constraints",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          time_horizon: {
            type: "string",
            enum: ["days", "weeks", "months", "quarter", "year_plus"],
          },
          budget_tier: {
            type: "string",
            enum: ["zero", "low", "moderate", "substantial"],
          },
          team_size: {
            type: "string",
            enum: ["solo", "small", "medium", "large"],
          },
          risk_tolerance: {
            type: "string",
            enum: ["experimental", "calibrated", "conservative"],
          },
          compliance_requirements: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "time_horizon",
          "budget_tier",
          "team_size",
          "risk_tolerance",
          "compliance_requirements",
        ],
      },
    },
    temperature: 0.2,
    maxTokens: 400,
  });

  return {
    time_horizon: validTimeHorizon(raw?.time_horizon),
    budget_tier: validBudgetTier(raw?.budget_tier),
    team_size: validTeamSize(raw?.team_size),
    risk_tolerance: validRiskTolerance(raw?.risk_tolerance),
    compliance_requirements: Array.isArray(raw?.compliance_requirements)
      ? (raw.compliance_requirements as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim().slice(0, 80))
          .slice(0, 6)
      : [],
    source: "inferred",
    generated_at: new Date().toISOString(),
  };
}

// ── Validators ─────────────────────────────────────────────────────

function validTimeHorizon(v: unknown): TimeHorizon {
  if (v === "days" || v === "weeks" || v === "months" || v === "quarter" || v === "year_plus") return v;
  return "months";
}
function validBudgetTier(v: unknown): BudgetTier {
  if (v === "zero" || v === "low" || v === "moderate" || v === "substantial") return v;
  return "low";
}
function validTeamSize(v: unknown): TeamSize {
  if (v === "solo" || v === "small" || v === "medium" || v === "large") return v;
  return "solo";
}
function validRiskTolerance(v: unknown): RiskTolerance {
  if (v === "experimental" || v === "calibrated" || v === "conservative") return v;
  return "calibrated";
}
