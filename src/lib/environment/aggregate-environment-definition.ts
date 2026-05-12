// ── Environment Definition aggregator ────────────────────────────────────
//
// Pure read. Joins entities + edges + improvement_goals + kg_generation_plans
// + situation_baselines + subjects.conditions + metric_observations + (when
// present) environment_overrides + condition_modulators into a single
// EnvironmentDefinition. Used by the page at /app/space/[id]/environment
// and by the simulator (to stamp prediction_ledger.environment_definition_hash).
//
// The aggregator is robust to missing schema columns. Where a column from
// the spec's "Schema dependencies" list hasn't landed yet, it falls back to
// a documented default and surfaces the gap in confidence_breakdown.callouts.
// This means the page can ship before all migrations land.
//
// Membership rules (per the spec):
//   - State space S = entities WHERE provenance.stop_reason !== "user_controllable"
//                     AND has layer assignment AND not in interventions table
//   - Action space A = entities WHERE provenance.stop_reason = "user_controllable"
//                      ∪ interventions table
//   - Reward R = improvement_goals (primary + sub + cost terms)
//   - Initial state P(s₀) = subjects.conditions JSONB + recent metric_observations
//   - Transition T = edges table (full)
//
// Performance: <300ms p95 for spaces ≤200 entities + 500 edges.
// All source fetches run in parallel via Promise.all.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type {
  AggregatorInput,
  AggregatorResult,
  ActionParameterShape,
  ActionSpace,
  ActionVariable,
  ConditionModulatorBinding,
  ConfidenceBreakdown,
  DiscountFactor,
  EnvironmentDefinition,
  EnvironmentOverride,
  GoalTerm,
  InitialStateDistribution,
  RewardFunction,
  StateSpace,
  StateVariable,
  SystemBoundary,
  TransitionDynamics,
  TransitionEdgeSummary,
  VariableRationale,
} from "@/types/environment-definition";
import { hashEnvironment } from "./hash-environment";
import { evaluateValueMatch } from "@/lib/simulation/condition-modulators";

type Db = SupabaseClient<Database>;

const DEFAULT_DISCOUNT_PER_WEEK = 0.95;
const DEFAULT_GOAL_WEIGHT = 1.0;
// 20 covers most spaces' "interesting edges" budget for the
// transition drawer without bloating the aggregator response.
// Spaces with more than 20 edges show top-20 by leverage AND top-20
// by uncertainty (with overlap); the drawer links to the full edges
// page for the rest.
const TOP_N_EDGES = 20;

/** Spec-mandated weights for the confidence_breakdown weighted average. */
const CONFIDENCE_WEIGHTS = {
  boundary_confidence: 0.10,
  state_coverage: 0.20,
  action_calibration: 0.15,
  transition_coverage: 0.30,
  reward_clarity: 0.10,
  initial_state_calibration: 0.15,
} as const;

// ────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────

export async function aggregateEnvironmentDefinition(
  db: Db,
  input: AggregatorInput,
): Promise<AggregatorResult> {
  const { space_id } = input;

  // 1. Parallel fetch all source data
  const [
    spaceRow,
    kgPlan,
    situationBaseline,
    entities,
    edges,
    interventions,
    goals,
    subject,
    observations,
    overrides,
    modulators,
  ] = await Promise.all([
    fetchSpace(db, space_id),
    fetchKgPlan(db, space_id),
    fetchSituationBaseline(db, space_id),
    fetchEntities(db, space_id),
    fetchEdges(db, space_id),
    fetchInterventions(db, space_id),
    fetchGoals(db, space_id),
    fetchSubject(db, space_id, input.subject_id ?? null),
    fetchLatestObservations(db, space_id),
    input.ignore_overrides ? Promise.resolve([]) : fetchOverrides(db, space_id),
    fetchConditionModulators(db, space_id),
  ]);

  // 2. Validation gates
  if (!spaceRow) {
    return { ok: false, reason: "space_not_found", partial: null };
  }
  if (!kgPlan) {
    return {
      ok: false,
      reason: "no_kg_generation_plan",
      partial: { space_id, subject_id: subject?.id ?? null },
    };
  }
  if (entities.length === 0) {
    return {
      ok: false,
      reason: "no_entities",
      partial: { space_id, subject_id: subject?.id ?? null },
    };
  }
  if (
    input.subject_id &&
    !subject
  ) {
    return { ok: false, reason: "subject_not_in_space", partial: null };
  }

  // 3. Build each MDP component
  const interventionEntityIds = new Set<string>();
  for (const intv of interventions) {
    if (intv.entity_id) interventionEntityIds.add(intv.entity_id);
  }
  const observationsByEntity = indexLatestObservationByEntity(observations);

  const stateSpace = buildStateSpace(
    entities,
    interventionEntityIds,
    observationsByEntity,
  );
  const actionSpace = buildActionSpace(
    entities,
    interventions,
    observationsByEntity,
  );
  const entityNamesById = new Map<string, string>(
    (entities as ReadonlyArray<EntityRow>).map((e) => [e.id, e.name]),
  );
  const transitionDynamics = buildTransitionDynamics(edges, entityNamesById);
  const rewardFunction = buildRewardFunction(goals);
  const discountFactor = buildDiscountFactor(goals);
  const initialState = buildInitialStateDistribution(
    subject,
    observationsByEntity,
    entities,
    modulators,
  );
  const boundary = buildBoundary(kgPlan, situationBaseline);

  // 4. Confidence breakdown (computed after components so it can read them)
  const confidenceBreakdown = buildConfidenceBreakdown({
    boundary,
    stateSpace,
    actionSpace,
    transitionDynamics,
    rewardFunction,
    initialState,
  });

  // 5. Apply overrides (re-derives affected fields; collects audit info)
  const draft: Omit<EnvironmentDefinition, "environment_hash"> = {
    space_id,
    subject_id: subject?.id ?? null,
    computed_at: new Date().toISOString(),
    state_space: stateSpace,
    action_space: actionSpace,
    transition_dynamics: transitionDynamics,
    reward_function: rewardFunction,
    discount_factor: discountFactor,
    initial_state_distribution: initialState,
    boundary,
    confidence: confidenceBreakdown.weighted_score,
    confidence_breakdown: confidenceBreakdown,
    overrides,
  };

  const withOverrides = applyOverrides(draft, overrides);

  // 6. Hash and return
  const environment_hash = hashEnvironment(withOverrides);
  const environment: EnvironmentDefinition = {
    ...withOverrides,
    environment_hash,
  };

  return { ok: true, environment };
}

// ────────────────────────────────────────────────────────────────────────
// Source fetchers
// ────────────────────────────────────────────────────────────────────────

async function fetchSpace(db: Db, space_id: string) {
  const { data } = await db
    .from("spaces")
    .select("id, owner_id, situation_baseline, runtime_settings")
    .eq("id", space_id)
    .maybeSingle();
  return data;
}

async function fetchKgPlan(db: Db, space_id: string) {
  const { data } = await db
    .from("kg_generation_plans")
    .select("*")
    .eq("space_id", space_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function fetchSituationBaseline(db: Db, space_id: string) {
  // spaces.situation_baseline is JSONB added in migration
  // 20260605_assets_and_situation_baseline.sql but not yet in the typed
  // Database schema; cast to bypass.
  const { data } = await (db.from("spaces") as unknown as {
    select: (s: string) => {
      eq: (k: string, v: string) => {
        maybeSingle: () => Promise<{
          data: { situation_baseline: Record<string, unknown> | null } | null;
        }>;
      };
    };
  })
    .select("situation_baseline")
    .eq("id", space_id)
    .maybeSingle();
  return data?.situation_baseline ?? null;
}

async function fetchEntities(db: Db, space_id: string) {
  const { data } = await db
    .from("entities")
    .select("*")
    .eq("space_id", space_id);
  return data ?? [];
}

async function fetchEdges(db: Db, space_id: string) {
  const { data } = await db
    .from("edges")
    .select("*")
    .eq("space_id", space_id);
  return data ?? [];
}

async function fetchInterventions(db: Db, space_id: string) {
  // Some installs may not have an interventions table or it may use
  // a different column for entity linkage. Guard the call.
  try {
    const { data } = await db
      .from("interventions" as never)
      .select("*")
      .eq("space_id", space_id);
    return (data ?? []) as Array<{
      id: string;
      entity_id: string | null;
      effort?: string | null;
      timeframe?: string | null;
      metric_target?: string | null;
      metric_unit?: string | null;
    }>;
  } catch {
    return [];
  }
}

async function fetchGoals(db: Db, space_id: string) {
  const { data } = await db
    .from("improvement_goals")
    .select("*")
    .eq("space_id", space_id);
  return data ?? [];
}

async function fetchSubject(
  db: Db,
  space_id: string,
  subject_id: string | null,
) {
  if (!subject_id) {
    // Fall back to default subject for the space, if any.
    const { data } = await db
      .from("subjects" as never)
      .select("*")
      .eq("space_id", space_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return data as { id: string; name: string; conditions: unknown } | null;
  }

  const { data } = await db
    .from("subjects" as never)
    .select("*")
    .eq("id", subject_id)
    .eq("space_id", space_id)
    .maybeSingle();
  return data as { id: string; name: string; conditions: unknown } | null;
}

async function fetchLatestObservations(db: Db, space_id: string) {
  const { data } = await db
    .from("metric_observations")
    .select("entity_id, value, recorded_at, source")
    .eq("space_id", space_id)
    .order("recorded_at", { ascending: false })
    .limit(1000);
  return data ?? [];
}

async function fetchOverrides(
  db: Db,
  space_id: string,
): Promise<EnvironmentOverride[]> {
  // Schema dep #7. Returns [] gracefully if table doesn't exist yet.
  try {
    const { data } = await db
      .from("environment_overrides" as never)
      .select("*")
      .eq("space_id", space_id)
      .order("created_at", { ascending: true });
    return (data ?? []) as EnvironmentOverride[];
  } catch {
    return [];
  }
}

async function fetchConditionModulators(db: Db, space_id: string) {
  // Schema dep #8 — landed in 20260509_condition_modulators.sql. The
  // try/catch wrapper remains so the aggregator stays compatible with
  // older databases that haven't yet applied the migration.
  try {
    const { data } = await db
      .from("condition_modulators")
      .select(
        "id, space_id, condition_key, value_match, target_edge_id, multiplier_p10, multiplier_p50, multiplier_p90, source_evidence_ids, rationale, population_label",
      )
      .eq("space_id", space_id);
    return data ?? [];
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────
// Builders
// ────────────────────────────────────────────────────────────────────────

function buildStateSpace(
  entities: ReadonlyArray<EntityRow>,
  interventionEntityIds: ReadonlySet<string>,
  observations: ObservationIndex,
): StateSpace {
  const variables: StateVariable[] = [];
  const perLayer: Record<string, number> = {};
  let observable = 0;
  let latent = 0;
  let proxy = 0;

  for (const e of entities) {
    if (isUserControllable(e)) continue;
    if (interventionEntityIds.has(e.id)) continue;
    if (!e.layer && !(e as Record<string, unknown>).layer_slug) continue;

    const observability = inferObservability(e);
    if (observability === "directly_observable") observable++;
    else if (observability === "latent") latent++;
    else if (observability === "inferable_via_proxy") proxy++;

    const layerSlug =
      ((e as Record<string, unknown>).layer_slug as string | undefined) ??
      e.layer ??
      "unspecified";
    perLayer[layerSlug] = (perLayer[layerSlug] ?? 0) + 1;

    const obs = observations.get(e.id);
    variables.push({
      entity_id: e.id,
      name: e.name,
      layer_slug: layerSlug,
      observability,
      proxy_for: (readJson(e, "proxy_for") as string | null) ?? null,
      proxy_quality: readNumber(e, "proxy_quality") ?? null,
      measurement_value_kind:
        (readJson(e, "measurement_value_kind") as
          | StateVariable["measurement_value_kind"]
          | null) ?? null,
      bounds: inferBounds(e),
      healthy_range: readJson(e, "healthy_range") as
        | StateVariable["healthy_range"]
        | null,
      value_directionality:
        (readJson(e, "value_directionality") as
          | StateVariable["value_directionality"]
          | null) ?? null,
      current_value: obs?.value ?? null,
      current_value_recorded_at: obs?.recorded_at ?? null,
      rationale: deriveRationale(e),
    });
  }

  return {
    variables,
    observable_count: observable,
    latent_count: latent,
    proxy_count: proxy,
    per_layer_counts: perLayer,
  };
}

function buildActionSpace(
  entities: ReadonlyArray<EntityRow>,
  interventions: ReadonlyArray<{
    id: string;
    entity_id: string | null;
    effort?: string | null;
    timeframe?: string | null;
    metric_target?: string | null;
    metric_unit?: string | null;
  }>,
  observations: ObservationIndex,
): ActionSpace {
  const actions: ActionVariable[] = [];
  const seenEntityIds = new Set<string>();

  // First pass: entities flagged as user-controllable.
  for (const e of entities) {
    if (!isUserControllable(e)) continue;
    seenEntityIds.add(e.id);
    const matchedIntervention = interventions.find(
      (i) => i.entity_id === e.id,
    );
    actions.push(buildActionVariable(e, matchedIntervention, observations));
  }

  // Second pass: interventions with entity_ids not already in actions.
  for (const intv of interventions) {
    if (!intv.entity_id || seenEntityIds.has(intv.entity_id)) continue;
    const e = entities.find((x) => x.id === intv.entity_id);
    if (!e) continue;
    seenEntityIds.add(e.id);
    actions.push(buildActionVariable(e, intv, observations));
  }

  const total_dimension = actions.reduce(
    (sum, a) => sum + parameterShapeDimension(a.parameter_shape),
    0,
  );

  return { actions, total_dimension };
}

function buildActionVariable(
  e: EntityRow,
  intv:
    | {
        id: string;
        entity_id: string | null;
        effort?: string | null;
        timeframe?: string | null;
        metric_target?: string | null;
        metric_unit?: string | null;
      }
    | undefined,
  observations: ObservationIndex,
): ActionVariable {
  const obs = observations.get(e.id);
  const currentDose = obs?.value ?? null;
  return {
    entity_id: e.id,
    intervention_id: intv?.id ?? null,
    name: e.name,
    parameter_shape: inferParameterShape(e, intv),
    effort: (intv?.effort as ActionVariable["effort"]) ?? null,
    timeframe:
      (intv?.timeframe as ActionVariable["timeframe"]) ?? null,
    currently_active: currentDose !== null && currentDose > 0,
    current_dose: currentDose,
    rationale: deriveRationale(e),
  };
}

function buildTransitionDynamics(
  edges: ReadonlyArray<EdgeRow>,
  entityNamesById: ReadonlyMap<string, string>,
): TransitionDynamics {
  const byStatus = { sparse: 0, mixed: 0, confirmed: 0 };
  const byCausalStatus = {
    established_causal: 0,
    plausible_causal: 0,
    correlational_only: 0,
  };
  let confidenceSum = 0;
  let confidenceCount = 0;
  let temporalCovered = 0;
  let heterogeneitySum = 0;
  let heterogeneityCount = 0;

  for (const e of edges) {
    const status = inferEdgeStatus(e);
    byStatus[status]++;

    // Schema dep #5: read directly. Falls back to "established_causal"
    // for legacy rows where the migration's backfill heuristic left
    // causal_status null (e.g., dimension='structural') so the count
    // remains complete. This is the only place the simulator's
    // "everything is causal" implicit assumption is made explicit.
    const causalStatus = (e.causal_status ?? "established_causal") as
      | keyof typeof byCausalStatus;
    if (causalStatus in byCausalStatus) byCausalStatus[causalStatus]++;

    if (typeof e.confidence === "number") {
      confidenceSum += e.confidence;
      confidenceCount++;
    }
    if (typeof e.onset_days_p50 === "number") temporalCovered++;
    if (typeof e.temporal_heterogeneity_i2 === "number") {
      heterogeneitySum += e.temporal_heterogeneity_i2;
      heterogeneityCount++;
    }
  }

  const avgConfidence =
    confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
  const temporalCoverage =
    edges.length > 0 ? temporalCovered / edges.length : 0;
  const avgHeterogeneity =
    heterogeneityCount > 0 ? heterogeneitySum / heterogeneityCount : null;

  // Top uncertain = highest standard_error among non-zero strength edges.
  const summaries = edges.map((e) => toEdgeSummary(e, entityNamesById));
  const topUncertain = [...summaries]
    .sort((a, b) => b.standard_error - a.standard_error)
    .slice(0, TOP_N_EDGES);
  const topLeverage = [...summaries]
    .sort(
      (a, b) =>
        Math.abs(b.strength) - Math.abs(a.strength),
    )
    .slice(0, TOP_N_EDGES);

  return {
    edge_count: edges.length,
    by_status: byStatus,
    by_causal_status: byCausalStatus,
    avg_confidence: avgConfidence,
    temporal_coverage: temporalCoverage,
    avg_heterogeneity_i2: avgHeterogeneity,
    top_uncertain_edges: topUncertain,
    top_leverage_edges: topLeverage,
  };
}

/** The edges table doesn't carry an explicit (sparse|mixed|confirmed)
 *  status column the way the seed templates do. We derive it from
 *  the existing observable signals: confidence + temporal evidence +
 *  is_low_confidence. Conservative — defaults to "sparse" rather
 *  than promoting weakly-evidenced edges. */
function inferEdgeStatus(e: EdgeRow): "sparse" | "mixed" | "confirmed" {
  if (e.is_low_confidence) return "sparse";
  if (e.requires_user_approval) return "sparse";
  const evidenceCount = e.temporal_evidence_count ?? 0;
  if (evidenceCount >= 3 || e.confidence >= 0.75) return "confirmed";
  if (evidenceCount > 0 || e.confidence >= 0.5) return "mixed";
  return "sparse";
}

function buildRewardFunction(
  goals: ReadonlyArray<GoalRow>,
): RewardFunction {
  const primary = goals.find((g) => !g.parent_goal_id) ?? goals[0];
  if (!primary) {
    return {
      primary_goal: emptyGoalTerm(),
      sub_goals: [],
      cost_terms: [],
      weights_normalized: false,
    };
  }

  const primaryTerm = toGoalTerm(primary);
  const subGoals = goals
    .filter((g) => g.parent_goal_id === primary.id && g.objective_type !== "cost")
    .map(toGoalTerm);
  const costTerms = goals
    .filter((g) => g.objective_type === "cost")
    .map(toGoalTerm);

  // Schema dep #6: weights now come from real column. Normalization
  // check is honest — sums to 1.0 within ε means "user has tuned",
  // anything else means "uniform default" (uniform-weighted multi-goal
  // is fine, just visually flagged).
  const allWeights = [
    primaryTerm.weight,
    ...subGoals.map((g) => g.weight),
    ...costTerms.map((g) => Math.abs(g.weight)),
  ];
  const sum = allWeights.reduce((a, b) => a + b, 0);

  return {
    primary_goal: primaryTerm,
    sub_goals: subGoals,
    cost_terms: costTerms,
    weights_normalized: Math.abs(sum - 1.0) < 0.01,
  };
}

function buildDiscountFactor(goals: ReadonlyArray<GoalRow>): DiscountFactor {
  const primary = goals.find((g) => !g.parent_goal_id) ?? goals[0];
  // Schema dep #6 lands a real column. Until the migration runs,
  // discount_per_week is undefined / null and we fall back to the
  // documented default. is_user_set distinguishes "user explicitly
  // chose 0.95" from "we defaulted because no value was set."
  const explicit =
    primary && typeof primary.discount_per_week === "number"
      ? primary.discount_per_week
      : null;
  const per_week = explicit ?? DEFAULT_DISCOUNT_PER_WEEK;
  const half_life =
    per_week >= 1.0 ? Infinity : Math.log(0.5) / Math.log(per_week);
  return {
    per_week,
    effective_half_life_weeks: Number.isFinite(half_life)
      ? Math.round(half_life * 10) / 10
      : Infinity,
    is_user_set: explicit !== null,
  };
}

function buildInitialStateDistribution(
  subject: { id: string; name: string; conditions: unknown } | null,
  observations: ObservationIndex,
  entities: ReadonlyArray<EntityRow>,
  modulators: ReadonlyArray<{
    condition_key: string;
    value_match?: string | null;
    target_edge_id: string;
    multiplier_p10: number;
    multiplier_p50: number;
    multiplier_p90: number;
    source_evidence_ids: string[];
  }>,
): InitialStateDistribution {
  const conditionsObj =
    (subject?.conditions as Record<string, unknown> | null | undefined) ?? {};
  const conditionKeys = Object.keys(conditionsObj);

  const conditions = conditionKeys.map((key) => ({
    key,
    value: conditionsObj[key] as string | number | boolean,
    unit: null,
    rationale: {
      source: "prompt_extraction" as const,
      source_quote: null,
      evidence_ids: [],
      explanation: `Persona condition '${key}' set on subject ${subject?.name ?? "unknown"}.`,
    },
  }));

  // Filter modulators to those whose condition_key matches AND whose
  // value_match clause (if any) evaluates true against the subject's
  // actual condition value. Fail-open: if value_match can't be parsed,
  // include the modulator and document via rationale.
  const appliedModulators: ConditionModulatorBinding[] = [];
  const calibratedKeys = new Set<string>();
  for (const m of modulators) {
    if (!conditionKeys.includes(m.condition_key)) continue;
    const subjectValue = conditionsObj[m.condition_key];
    if (!evaluateValueMatch(m.value_match ?? null, subjectValue)) continue;
    calibratedKeys.add(m.condition_key);
    appliedModulators.push({
      condition_key: m.condition_key,
      target_edge_id: m.target_edge_id,
      target_edge_label: m.target_edge_id, // resolved by UI; aggregator stays light
      multiplier_p50: m.multiplier_p50,
      multiplier_p10: m.multiplier_p10,
      multiplier_p90: m.multiplier_p90,
      source_evidence_ids: m.source_evidence_ids,
    });
  }
  const uncalibrated = conditionKeys.filter((k) => !calibratedKeys.has(k));

  const baselines = entities
    .map((e) => {
      const obs = observations.get(e.id);
      if (!obs) return null;
      return {
        entity_id: e.id,
        entity_name: e.name,
        value: obs.value,
        unit:
          (readJson(e, "measurement_unit") as string | null) ?? null,
        recorded_at: obs.recorded_at,
        is_inferred: obs.source === "ai_estimated",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    subject_id: subject?.id ?? null,
    subject_name: subject?.name ?? "default",
    conditions,
    applied_modulators: appliedModulators,
    uncalibrated_conditions: uncalibrated,
    baselines,
  };
}

function buildBoundary(
  kgPlan: Record<string, unknown>,
  situationBaseline: Record<string, unknown> | null,
): SystemBoundary {
  const scope = (kgPlan.scope_and_objectives ?? {}) as Record<
    string,
    unknown
  >;
  const goalParsed = (scope.goal_parsed ?? {}) as Record<string, unknown>;
  const domainClass = (goalParsed.domain_classification ?? {}) as Record<
    string,
    unknown
  >;

  return {
    goal_verbatim: (scope.goal_verbatim as string) ?? "",
    primary_objective: (goalParsed.primary_objective as string) ?? "",
    domain_label: (domainClass.label as string) ?? "unclassified",
    domain_confidence: (domainClass.confidence as number) ?? 0,
    decision_horizon_weeks: parseHorizonToWeeks(
      goalParsed.decision_horizon as string | undefined,
    ),
    out_of_scope: (goalParsed.out_of_scope as string[]) ?? [],
    success_criteria: (scope.success_criteria as string[]) ?? [],
    situation_baseline_snapshot:
      (situationBaseline as unknown) as SystemBoundary["situation_baseline_snapshot"],
    scope_snapshot: (scope as unknown) as SystemBoundary["scope_snapshot"],
  };
}

function buildConfidenceBreakdown(args: {
  boundary: SystemBoundary;
  stateSpace: StateSpace;
  actionSpace: ActionSpace;
  transitionDynamics: TransitionDynamics;
  rewardFunction: RewardFunction;
  initialState: InitialStateDistribution;
}): ConfidenceBreakdown {
  const { boundary, stateSpace, actionSpace, transitionDynamics, rewardFunction, initialState } = args;

  const boundary_confidence = clamp01(boundary.domain_confidence);

  // state_coverage = ratio of variables with explicit (prompt or asset) source
  const explicitState = stateSpace.variables.filter(
    (v) =>
      v.rationale.source === "prompt_extraction" ||
      v.rationale.source === "research",
  ).length;
  const state_coverage =
    stateSpace.variables.length > 0
      ? explicitState / stateSpace.variables.length
      : 0;

  // action_calibration = ratio of actions with measured current_dose
  const calibratedActions = actionSpace.actions.filter(
    (a) => a.current_dose !== null,
  ).length;
  const action_calibration =
    actionSpace.actions.length > 0
      ? calibratedActions / actionSpace.actions.length
      : 0;

  // transition_coverage = (confirmed + established_causal) / total
  const denom = transitionDynamics.edge_count;
  const transition_coverage =
    denom > 0
      ? (transitionDynamics.by_status.confirmed +
          transitionDynamics.by_causal_status.established_causal) /
        (denom * 2) // averaged across two dimensions
      : 0;

  // reward_clarity = ratio of goals with both baseline and target set
  const allGoals = [
    rewardFunction.primary_goal,
    ...rewardFunction.sub_goals,
    ...rewardFunction.cost_terms,
  ].filter((g) => g.goal_id !== "");
  const clearGoals = allGoals.filter(
    (g) =>
      Number.isFinite(g.baseline_value) && Number.isFinite(g.target_value),
  ).length;
  const reward_clarity =
    allGoals.length > 0 ? clearGoals / allGoals.length : 0;

  // initial_state_calibration = applied modulators / total conditions
  const totalConditions = initialState.conditions.length;
  const initial_state_calibration =
    totalConditions > 0
      ? initialState.applied_modulators.length / totalConditions
      : 1.0; // no conditions → no miscalibration risk

  const weighted_score = clamp01(
    boundary_confidence * CONFIDENCE_WEIGHTS.boundary_confidence +
      state_coverage * CONFIDENCE_WEIGHTS.state_coverage +
      action_calibration * CONFIDENCE_WEIGHTS.action_calibration +
      transition_coverage * CONFIDENCE_WEIGHTS.transition_coverage +
      reward_clarity * CONFIDENCE_WEIGHTS.reward_clarity +
      initial_state_calibration * CONFIDENCE_WEIGHTS.initial_state_calibration,
  );

  const callouts = generateCallouts({
    boundary_confidence,
    state_coverage,
    action_calibration,
    transition_coverage,
    reward_clarity,
    initial_state_calibration,
  });

  return {
    boundary_confidence,
    state_coverage,
    action_calibration,
    transition_coverage,
    reward_clarity,
    initial_state_calibration,
    weighted_score,
    callouts,
  };
}

function generateCallouts(b: {
  boundary_confidence: number;
  state_coverage: number;
  action_calibration: number;
  transition_coverage: number;
  reward_clarity: number;
  initial_state_calibration: number;
}): string[] {
  const out: string[] = [];
  if (b.transition_coverage < 0.3) {
    out.push(
      `Transition coverage ${b.transition_coverage.toFixed(2)} — most edges still sparse. Run research on top_uncertain_edges to raise this.`,
    );
  }
  if (b.action_calibration < 0.3) {
    out.push(
      `Action calibration ${b.action_calibration.toFixed(2)} — fewer than a third of actions have measured current dose.`,
    );
  }
  if (b.initial_state_calibration < 0.4) {
    out.push(
      `Initial state calibration ${b.initial_state_calibration.toFixed(2)} — most subject conditions have no published modulator. Predictions may use uncalibrated population averages.`,
    );
  }
  if (b.reward_clarity < 0.5) {
    out.push(
      `Reward clarity ${b.reward_clarity.toFixed(2)} — some goals are missing baseline or target.`,
    );
  }
  if (b.boundary_confidence < 0.6) {
    out.push(
      `Boundary confidence ${b.boundary_confidence.toFixed(2)} — domain classification was uncertain. Refine the prompt or pick a domain explicitly.`,
    );
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Override application
// ────────────────────────────────────────────────────────────────────────

function applyOverrides(
  draft: Omit<EnvironmentDefinition, "environment_hash">,
  overrides: ReadonlyArray<EnvironmentOverride>,
): Omit<EnvironmentDefinition, "environment_hash"> {
  // Override application is deliberately conservative in the stub:
  // each override kind has a dedicated apply step, and unknown kinds
  // are skipped (logged in the result via callouts upstream). The
  // payload-typed apply functions below mutate a shallow clone.
  let next = draft;
  for (const ov of overrides) {
    switch (ov.payload.kind) {
      case "reclassify_variable":
        next = applyReclassify(next, ov);
        break;
      case "override_edge_parameters":
        next = applyEdgeOverride(next, ov);
        break;
      case "adjust_goal":
        next = applyGoalAdjust(next, ov);
        break;
      case "set_condition":
        next = applySetCondition(next, ov);
        break;
      // request_baseline_measurement and toggle_action_candidate
      // affect downstream pipelines (metric tracker spawn, action
      // candidate set) but don't directly mutate the definition.
      default:
        break;
    }
  }
  return next;
}

function applyReclassify(
  env: Omit<EnvironmentDefinition, "environment_hash">,
  _ov: EnvironmentOverride,
): Omit<EnvironmentDefinition, "environment_hash"> {
  // Stub: reclassification logic moves entries between state_space
  // and action_space. Implementation lands once the
  // environment_overrides table has real test data.
  return env;
}

function applyEdgeOverride(
  env: Omit<EnvironmentDefinition, "environment_hash">,
  _ov: EnvironmentOverride,
): Omit<EnvironmentDefinition, "environment_hash"> {
  return env;
}

function applyGoalAdjust(
  env: Omit<EnvironmentDefinition, "environment_hash">,
  ov: EnvironmentOverride,
): Omit<EnvironmentDefinition, "environment_hash"> {
  if (ov.payload.kind !== "adjust_goal") return env;
  const { field, value } = ov.payload;
  if (field === "discount_per_week" && typeof value === "number") {
    const half =
      value >= 1.0 ? Infinity : Math.log(0.5) / Math.log(value);
    return {
      ...env,
      discount_factor: {
        per_week: value,
        effective_half_life_weeks: Number.isFinite(half)
          ? Math.round(half * 10) / 10
          : Infinity,
        is_user_set: true,
      },
    };
  }
  return env;
}

function applySetCondition(
  env: Omit<EnvironmentDefinition, "environment_hash">,
  ov: EnvironmentOverride,
): Omit<EnvironmentDefinition, "environment_hash"> {
  if (ov.payload.kind !== "set_condition") return env;
  const idx = env.initial_state_distribution.conditions.findIndex(
    (c) => c.key === ov.payload.kind && c.key === (ov.payload as { condition_key: string }).condition_key,
  );
  if (idx === -1) return env;
  const next = [...env.initial_state_distribution.conditions];
  next[idx] = {
    ...next[idx],
    value: (ov.payload as { value: string | number | boolean }).value,
  };
  return {
    ...env,
    initial_state_distribution: {
      ...env.initial_state_distribution,
      conditions: next,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

type EntityRow = {
  id: string;
  space_id: string;
  name: string;
  layer: string | null;
  confidence: number;
  provenance: unknown;
  source_tag: string;
  [k: string]: unknown;
};

/** Mirrors public.edges row shape from database.types.ts. The
 *  aggregator reads the table via `select("*")` so any column added
 *  in a future migration is also available via the index signature.
 *  source_entity_id / target_entity_id are the canonical column
 *  names (NOT source_id / target_id). */
type EdgeRow = {
  id: string;
  space_id: string;
  source_entity_id: string;
  target_entity_id: string;
  strength: number;
  confidence: number;
  polarity: string | null;
  is_low_confidence: boolean;
  requires_user_approval: boolean;
  standard_error?: number | null;
  // Phase 3 temporal pool
  onset_days_p50?: number | null;
  peak_days_p50?: number | null;
  persistence_days_p50?: number | null;
  decay_kinetics_modal?: string | null;
  temporal_evidence_count?: number;
  temporal_heterogeneity_i2?: number | null;
  // Migration 20260509_edges_causal_status
  causal_status?:
    | "established_causal"
    | "plausible_causal"
    | "correlational_only"
    | null;
  [k: string]: unknown;
};

/** Mirrors public.improvement_goals row shape after the
 *  20260407 hierarchy + source migrations and the 20260509 RL fields
 *  migration. Treated permissively (`[k: string]: unknown`) for any
 *  fields that haven't reached database.types.ts yet. */
type GoalRow = {
  id: string;
  space_id: string;
  parent_goal_id: string | null;
  objective_type: string;
  metric_name: string;
  metric_unit: string | null;
  baseline_value: number;
  target_value: number;
  current_value: number;
  deadline: string | null;
  // Migration 20260509_improvement_goals_rl_fields
  discount_per_week?: number | null;
  weight?: number | null;
  [k: string]: unknown;
};

type ObservationIndex = Map<
  string,
  {
    value: number;
    recorded_at: string;
    source: "manual" | "ai_estimated" | "integration" | "seed";
  }
>;

function indexLatestObservationByEntity(
  observations: ReadonlyArray<{
    entity_id: string | null;
    value: number | null;
    recorded_at: string;
    source: string;
  }>,
): ObservationIndex {
  const map: ObservationIndex = new Map();
  for (const obs of observations) {
    if (!obs.entity_id || obs.value === null) continue;
    const existing = map.get(obs.entity_id);
    if (existing && existing.recorded_at >= obs.recorded_at) continue;
    map.set(obs.entity_id, {
      value: obs.value,
      recorded_at: obs.recorded_at,
      source: normalizeObservationSource(obs.source),
    });
  }
  return map;
}

function isUserControllable(e: EntityRow): boolean {
  const prov = e.provenance as Record<string, unknown> | null;
  if (!prov) return false;
  const stopReason =
    (prov.stop_reason as string | undefined) ??
    ((prov.source as Record<string, unknown> | undefined)?.stop_reason as
      | string
      | undefined);
  return stopReason === "user_controllable";
}

function inferObservability(e: EntityRow): StateVariable["observability"] {
  // Schema dep #1: prefer the spec-shaped `observability` column when
  // it lands. Until then, map the existing
  // `measurement_observability` column from migration 20260609_entity_
  // measurability.sql which uses adjacent (not identical) enum values.
  const specShaped = (e as Record<string, unknown>).observability;
  if (
    specShaped === "directly_observable" ||
    specShaped === "latent" ||
    specShaped === "inferable_via_proxy"
  ) {
    return specShaped;
  }

  const measObs = (e as Record<string, unknown>).measurement_observability;
  switch (measObs) {
    case "directly_observable":
      return "directly_observable";
    case "proxy_required":
      return "inferable_via_proxy";
    case "inferred_only":
    case "unobservable":
      return "latent";
  }

  // Fallback: legacy `observable: boolean` from template seeds.
  const observable = (e as Record<string, unknown>).observable;
  if (observable === false) return "latent";

  // Fallback: proxy_for set means inferable_via_proxy.
  if (readJson(e, "proxy_for")) return "inferable_via_proxy";

  return "directly_observable";
}

function inferBounds(
  e: EntityRow,
): { lower: number | null; upper: number | null } {
  const explicit = readJson(e, "hard_bounds") as
    | { lower?: number; upper?: number }
    | null;
  if (explicit) {
    return {
      lower: explicit.lower ?? null,
      upper: explicit.upper ?? null,
    };
  }
  const kind = readJson(e, "measurement_value_kind") as
    | StateVariable["measurement_value_kind"]
    | null;
  switch (kind) {
    case "probability":
      return { lower: 0, upper: 1 };
    case "concentration":
    case "count":
    case "duration":
    case "rate":
      return { lower: 0, upper: null };
    case "boolean":
      return { lower: 0, upper: 1 };
    default:
      return { lower: null, upper: null };
  }
}

function inferParameterShape(
  e: EntityRow,
  intv:
    | { metric_target?: string | null; metric_unit?: string | null }
    | undefined,
): ActionParameterShape {
  const params = e.parameters as Record<string, unknown> | null;
  if (params && typeof params.min === "number" && typeof params.max === "number") {
    return {
      kind: "continuous",
      min: params.min,
      max: params.max,
      default: (params.default as number) ?? (params.min + params.max) / 2,
      unit: (intv?.metric_unit ?? null) as string | null,
    };
  }
  const kind = readJson(e, "measurement_value_kind") as
    | StateVariable["measurement_value_kind"]
    | null;
  if (kind === "boolean") {
    return { kind: "binary", default: false };
  }
  // Sensible default: continuous 0..1 dose with unit from intervention.
  return {
    kind: "continuous",
    min: 0,
    max: 1,
    default: 0.5,
    unit: (intv?.metric_unit ?? null) as string | null,
  };
}

function parameterShapeDimension(shape: ActionParameterShape): number {
  switch (shape.kind) {
    case "continuous":
      return 1;
    case "binary":
      return 1;
    case "categorical":
      return shape.choices.length;
    case "schedule":
      return 2;
  }
}

function deriveRationale(e: EntityRow): VariableRationale {
  const tag = e.source_tag;
  const prov = e.provenance as Record<string, unknown> | null;
  const provSource = prov?.source as string | undefined;

  let source: VariableRationale["source"];
  if (provSource === "user_override") source = "user_override";
  else if (tag === "explicit") source = "prompt_extraction";
  else if (provSource === "research" || prov?.research_trace) source = "research";
  else source = "template_seed";

  const evidenceIds = (prov?.evidence_ids as string[] | undefined) ?? [];

  return {
    source,
    source_quote: (prov?.source_quote as string | undefined) ?? null,
    evidence_ids: evidenceIds,
    explanation: buildExplanation(e, source),
  };
}

function buildExplanation(
  e: EntityRow,
  source: VariableRationale["source"],
): string {
  const layer = e.layer ?? "unspecified layer";
  switch (source) {
    case "prompt_extraction":
      return `Extracted from user prompt; placed in ${layer}.`;
    case "research":
      return `Derived from research; placed in ${layer}.`;
    case "user_override":
      return `User-authored or user-overridden; placed in ${layer}.`;
    case "template_seed":
    default:
      return `From template ontology; placed in ${layer}.`;
  }
}

function toEdgeSummary(
  e: EdgeRow,
  entityNamesById: ReadonlyMap<string, string>,
): TransitionEdgeSummary {
  return {
    edge_id: e.id,
    source_entity_id: e.source_entity_id,
    source_name: entityNamesById.get(e.source_entity_id) ?? "",
    target_entity_id: e.target_entity_id,
    target_name: entityNamesById.get(e.target_entity_id) ?? "",
    strength: e.strength,
    standard_error:
      typeof e.standard_error === "number"
        ? e.standard_error
        : Math.abs(e.strength) * 0.25,
    polarity:
      (e.polarity as TransitionEdgeSummary["polarity"]) ?? "positive",
    causal_status: e.causal_status ?? null,
    temporal: {
      onset_days_p50: e.onset_days_p50 ?? null,
      peak_days_p50: e.peak_days_p50 ?? null,
      persistence_days_p50: e.persistence_days_p50 ?? null,
      decay_kinetics_modal: e.decay_kinetics_modal ?? null,
    },
    evidence_count: e.temporal_evidence_count ?? 0,
  };
}

function toGoalTerm(g: GoalRow): GoalTerm {
  return {
    goal_id: g.id,
    metric_name: g.metric_name,
    metric_unit: g.metric_unit,
    baseline_value: g.baseline_value,
    target_value: g.target_value,
    current_value: g.current_value,
    direction:
      g.target_value >= g.baseline_value ? "higher_better" : "lower_better",
    // Schema dep #6: read the real column. Pre-migration rows
    // return null and we fall back to uniform weight 1.0.
    weight:
      typeof g.weight === "number" ? g.weight : DEFAULT_GOAL_WEIGHT,
    deadline: g.deadline,
    rationale: {
      source: "prompt_extraction",
      source_quote: null,
      evidence_ids: [],
      explanation: `Goal ${g.metric_name}: from ${g.baseline_value} → ${g.target_value}.`,
    },
  };
}

function emptyGoalTerm(): GoalTerm {
  return {
    goal_id: "",
    metric_name: "",
    metric_unit: null,
    baseline_value: 0,
    target_value: 0,
    current_value: 0,
    direction: "higher_better",
    weight: 0,
    deadline: null,
    rationale: {
      source: "template_seed",
      source_quote: null,
      evidence_ids: [],
      explanation: "No reward defined yet.",
    },
  };
}

function parseHorizonToWeeks(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*(week|wk|month|mo|year|yr|quarter|q)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("week") || unit === "wk") return n;
  if (unit.startsWith("month") || unit === "mo") return n * 4;
  if (unit.startsWith("quarter") || unit === "q") return n * 13;
  if (unit.startsWith("year") || unit === "yr") return n * 52;
  return null;
}

function readJson(row: EntityRow, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function readNumber(row: EntityRow, key: string): number | null {
  const v = (row as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeObservationSource(
  raw: string,
): "manual" | "ai_estimated" | "integration" | "seed" {
  if (
    raw === "manual" ||
    raw === "ai_estimated" ||
    raw === "integration" ||
    raw === "seed"
  ) {
    return raw;
  }
  return "manual";
}

// evaluateValueMatch lives in @/lib/simulation/condition-modulators
// so the simulator and the aggregator share one implementation.
