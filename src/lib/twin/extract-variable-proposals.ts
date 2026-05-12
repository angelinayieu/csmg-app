// Extract VariableProposalDraft[] from a StrategicRecommendation.
//
// Walks four canonical metric-bearing fields in the recommendation and
// produces one draft per variable. The role classifier is rule-based
// (NO LLM call) using simple heuristics over the source field + the
// metric's wording. We err toward "dependent" (what we measure) and
// "unclassified" rather than over-claiming experimental rigor we
// haven't actually established.
//
// Fields walked:
//   1. perspectives[].key_metric            → dependent (the perspective's measured outcome)
//   2. micro_tactics[].metric               → independent | dependent (heuristic; manipulable tactics → IV)
//   3. learning_loop.leading_indicators[]   → dependent (early observable)
//   4. learning_loop.lagging_indicator      → dependent (final outcome)
//
// Pure function — no DB writes, no LLM. Caller persists via persistVariableProposals().

import type {
  StrategicRecommendation,
  StrategyPerspective,
  MicroTactic,
  InfrastructureProposal,
  AppVariableProposal,
  RankedStrategy,
} from "@/types/strategy";
import type {
  VariableMetricDefinition,
  VariableProposalDraft,
  VariableRole,
  VariableSourceField,
} from "@/types/variable-proposals";

export interface ExtractVariableProposalsArgs {
  spaceId: string;
  recommendation: StrategicRecommendation;
  sourceStrategyVersion?: number | null;
  /**
   * Sprint W5.5 — when present, the function additionally walks
   * `rankedStrategies[].infrastructure_proposals[].app_variables[]`
   * and emits per-app variable proposals. Backward-compatible: a
   * caller that only has the StrategicRecommendation can omit this
   * arg and get the legacy 4-source behavior.
   */
  rankedStrategies?: RankedStrategy[];
}

export function extractVariableProposals(
  args: ExtractVariableProposalsArgs,
): VariableProposalDraft[] {
  const {
    spaceId,
    recommendation,
    sourceStrategyVersion = null,
    rankedStrategies,
  } = args;
  const drafts: VariableProposalDraft[] = [];
  const seenNames = new Set<string>(); // dedupe by lowercased name

  const tryPush = (draft: VariableProposalDraft | null) => {
    if (!draft) return;
    const key = draft.proposed_name.trim().toLowerCase();
    if (!key || seenNames.has(key)) return;
    seenNames.add(key);
    drafts.push(draft);
  };

  // 1. perspective.key_metric → dependent (perspective-level outcome we measure)
  for (const p of recommendation.perspectives ?? []) {
    tryPush(fromPerspectiveKeyMetric(p, spaceId, sourceStrategyVersion));
  }

  // 2. micro_tactic.metric → IV-or-DV by tactic-shape heuristic
  for (const t of recommendation.micro_tactics ?? []) {
    tryPush(fromMicroTacticMetric(t, spaceId, sourceStrategyVersion));
  }

  // 3. learning_loop.leading_indicators → dependent (early signals)
  const leading = recommendation.learning_loop?.leading_indicators ?? [];
  leading.forEach((li, i) => {
    tryPush(fromLeadingIndicator(li, i, spaceId, sourceStrategyVersion));
  });

  // 4. learning_loop.lagging_indicator → dependent (final outcome)
  const lagging = recommendation.learning_loop?.lagging_indicator;
  if (lagging) {
    tryPush(fromLaggingIndicator(lagging, spaceId, sourceStrategyVersion));
  }

  // 5. Sprint W5.5 — infrastructure_proposal.app_variables → role-tagged.
  // Walks the matching ranked strategy's infrastructure_proposals so we
  // get per-app variable contracts. Dedup against the 4 strategy-level
  // sources above; if a perspective.key_metric and an app_variable name
  // the same thing, the perspective-level entry wins (it came first).
  const proposals = collectInfrastructureProposals(recommendation, rankedStrategies);
  for (const proposal of proposals) {
    for (const av of proposal.app_variables ?? []) {
      tryPush(fromAppVariable(av, proposal, spaceId, sourceStrategyVersion));
    }
  }

  return drafts;
}

function collectInfrastructureProposals(
  recommendation: StrategicRecommendation,
  rankedStrategies?: RankedStrategy[],
): InfrastructureProposal[] {
  if (!rankedStrategies || rankedStrategies.length === 0) return [];
  // Same matching strategy as app-generator: pick the ranked entry
  // whose recommendation.title equals the recommendation we were
  // handed. Falls back to rank 1 if no match.
  const matching =
    rankedStrategies.find(
      (r) => r.recommendation?.title === recommendation.title,
    ) ?? rankedStrategies[0];
  return matching?.infrastructure_proposals ?? [];
}

function fromAppVariable(
  av: AppVariableProposal,
  proposal: InfrastructureProposal,
  spaceId: string,
  sourceStrategyVersion: number | null,
): VariableProposalDraft | null {
  if (!av?.name || !av.name.trim()) return null;
  const role = asVariableRole(av.role) ?? "unclassified";

  const metric: VariableMetricDefinition | null = av.metric_definition
    ? {
        name: av.metric_definition.name ?? av.name,
        current: av.metric_definition.current ?? null,
        target: av.metric_definition.target ?? null,
        unit: av.metric_definition.unit ?? null,
        measurement_method: av.metric_definition.measurement_method ?? null,
        cadence: av.metric_definition.cadence ?? null,
        threshold_green: av.metric_definition.threshold_green ?? null,
        threshold_yellow: av.metric_definition.threshold_yellow ?? null,
        threshold_red: av.metric_definition.threshold_red ?? null,
      }
    : null;

  return {
    space_id: spaceId,
    proposed_by: "llm",
    source_strategy_version: sourceStrategyVersion,
    source_field: "infrastructure_proposal.app_variable",
    source_perspective_id: proposal.source_perspective ?? null,
    proposed_name: av.name,
    proposed_description: av.description ?? null,
    variable_role: role,
    metric_definition: metric,
    justification:
      av.justification ??
      `Per-app variable for "${proposal.name}" (${proposal.type}).`,
    confidence: typeof av.confidence === "number" ? av.confidence : null,
    depends_on_entity_ids: av.depends_on_entity_ids ?? [],
  };
}

// ── Per-source extractors ─────────────────────────────────────────────

function fromPerspectiveKeyMetric(
  p: StrategyPerspective,
  spaceId: string,
  sourceStrategyVersion: number | null,
): VariableProposalDraft | null {
  const km = p.key_metric;
  if (!km?.name || !km.name.trim()) return null;

  const metric: VariableMetricDefinition = {
    name: km.name,
    current: km.current ?? null,
    target: km.target ?? null,
    unit: km.unit ?? null,
  };

  // Prefer LLM-provided variable_role (added to the prompt schema). Fall
  // back to the heuristic for legacy strategies that ran before the
  // schema update — for those, key_metrics default to "dependent" with
  // an "outcome" override when the name reads as terminal (e.g. "ARR",
  // "lifetime value", "end-of-quarter X").
  const role: VariableRole =
    asVariableRole(km.variable_role) ??
    (looksLikeTerminalOutcome(km.name) ? "outcome" : "dependent");

  return {
    space_id: spaceId,
    proposed_by: "llm",
    source_strategy_version: sourceStrategyVersion,
    source_field: "perspective.key_metric",
    source_perspective_id: p.id ?? null,
    proposed_name: km.name,
    proposed_description: p.objective ?? null,
    variable_role: role,
    metric_definition: metric,
    justification: p.rationale ?? null,
    confidence: confidenceFromBucket(p.confidence),
    depends_on_entity_ids:
      ([...(p.supporting_entities ?? []), ...(p.entity_refs ?? [])]
        .filter(Boolean) as string[]) ?? [],
  };
}

function fromMicroTacticMetric(
  t: MicroTactic,
  spaceId: string,
  sourceStrategyVersion: number | null,
): VariableProposalDraft | null {
  const m = t.metric;
  if (!m?.name || !m.name.trim()) return null;

  const metric: VariableMetricDefinition = {
    name: m.name,
    current:
      m.current_value !== undefined && m.current_value !== null
        ? String(m.current_value)
        : null,
    target: m.target ?? null,
    unit: m.unit ?? null,
  };

  // Prefer LLM-provided variable_role. Fall back to inferring from
  // infrastructure_action: "build" / "configure" / "strengthen" tactics
  // are manipulable inputs (independent); "monitor" tactics observe
  // downstream effects (dependent). Unknown action → "unclassified".
  const action = (t.infrastructure_action ?? "").toLowerCase();
  const role: VariableRole =
    asVariableRole(m.variable_role) ??
    (action === "build" || action === "configure" || action === "strengthen"
      ? "independent"
      : action === "monitor"
        ? "dependent"
        : "unclassified");

  return {
    space_id: spaceId,
    proposed_by: "llm",
    source_strategy_version: sourceStrategyVersion,
    source_field: "micro_tactic.metric",
    source_perspective_id: null,
    proposed_name: m.name,
    proposed_description: t.title ?? null,
    variable_role: role,
    metric_definition: metric,
    justification: t.description ?? null,
    confidence: null, // tactics don't carry a confidence bucket
    depends_on_entity_ids: t.entity_id ? [t.entity_id] : [],
  };
}

function fromLeadingIndicator(
  li: NonNullable<
    StrategicRecommendation["learning_loop"]
  >["leading_indicators"][number],
  index: number,
  spaceId: string,
  sourceStrategyVersion: number | null,
): VariableProposalDraft | null {
  if (!li?.metric || !li.metric.trim()) return null;

  const metric: VariableMetricDefinition = {
    name: li.metric,
    measurement_method: li.measurement_method ?? null,
    cadence: li.cadence ?? null,
    threshold_green: li.green_reading ?? null,
    threshold_yellow: li.yellow_reading ?? null,
    threshold_red: li.red_reading ?? null,
  };

  // Prefer LLM-provided variable_role; otherwise default to "dependent"
  // since leading indicators are typically observed (not manipulated).
  const role: VariableRole = asVariableRole(li.variable_role) ?? "dependent";

  return {
    space_id: spaceId,
    proposed_by: "llm",
    source_strategy_version: sourceStrategyVersion,
    source_field: "learning_loop.leading_indicator",
    source_perspective_id: null,
    proposed_name: li.metric,
    proposed_description: li.connects_to_policy_element ?? null,
    variable_role: role,
    metric_definition: metric,
    justification: `Leading indicator (${index + 1}): predicts the lagging outcome before it moves`,
    confidence: null,
    depends_on_entity_ids: [],
  };
}

function fromLaggingIndicator(
  lag: NonNullable<
    StrategicRecommendation["learning_loop"]
  >["lagging_indicator"],
  spaceId: string,
  sourceStrategyVersion: number | null,
): VariableProposalDraft | null {
  if (!lag?.metric || !lag.metric.trim()) return null;

  const metric: VariableMetricDefinition = {
    name: lag.metric,
    target: lag.target ?? null,
  };

  return {
    space_id: spaceId,
    proposed_by: "llm",
    source_strategy_version: sourceStrategyVersion,
    source_field: "learning_loop.lagging_indicator",
    source_perspective_id: null,
    proposed_name: lag.metric,
    proposed_description: `Final outcome — measured by deadline ${lag.deadline ?? "?"}`,
    variable_role: "dependent",
    metric_definition: metric,
    justification: "Lagging indicator: terminal success measure for the strategy",
    confidence: null,
    depends_on_entity_ids: [],
  };
}

// ── Heuristics ────────────────────────────────────────────────────────

function looksLikeTerminalOutcome(name: string): boolean {
  // Coarse check — terminal outcomes tend to read as accumulated or
  // long-horizon measures. False positives are fine; the user can
  // re-classify via the review panel.
  return /\b(lifetime|cumulative|total|annual|quarterly|terminal|final|end[-_ ]of)\b/i.test(
    name,
  );
}

function confidenceFromBucket(
  bucket: "high" | "moderate" | "low" | undefined,
): number | null {
  if (bucket === "high") return 0.85;
  if (bucket === "moderate") return 0.65;
  if (bucket === "low") return 0.4;
  return null;
}

/**
 * Narrow a free-form string from the LLM into the typed VariableRole
 * union. Returns null when the string is missing or doesn't match —
 * caller falls back to a heuristic in that case. Lower-casing makes
 * us tolerant of "Independent" / "INDEPENDENT" / "independent".
 */
const VALID_ROLES: ReadonlySet<string> = new Set<string>([
  "independent",
  "dependent",
  "controlled",
  "confounding",
  "outcome",
  "mediator",
  "modifier",
  "instrument",
  "condition",
]);
function asVariableRole(raw: string | undefined | null): VariableRole | null {
  if (!raw || typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (VALID_ROLES.has(lower)) return lower as VariableRole;
  return null;
}
