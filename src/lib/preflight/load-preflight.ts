// ── Preflight aggregator — A2 ────────────────────────────────────────
//
// Joins ~10 data sources into one PreflightView object the page can
// render without further fetches:
//
//   entities + edges                     (the graph)
//   improvement_goals + goals_extra      (reward function)
//   subjects.conditions                  (initial state)
//   situation_baseline                   (knowns/unknowns)
//   variable_proposals                   (LLM-proposed roles)
//   experiment_taxonomies                (IV decomposition)
//   kg_generation_plans                  (boundary + scope)
//   environment_overrides                (user edits)
//   detectOrphanClusters + propose       (mediator preview, in-memory)
//
// Pure read except the M1+M2 preview pass, which is also stateless
// (no DB writes). Returns a fully-formed PreflightView with hash and
// confidence already computed — caller (A4 GET route) just JSON-serializes.
//
// Defensive against partial schema:
//   - Missing observability enum  → derive from entity.observable boolean
//   - Missing causal_status enum  → treat all edges as established_causal
//   - Missing discount_per_week   → 0.95 default
//   - Missing goals_extra          → uniform weights
//   - Missing condition_modulators → all conditions uncalibrated
//   - Missing environment_overrides → empty array
// Each fallback surfaces in confidence_breakdown.callouts so the user
// sees what's incomplete, not a silent default.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entity, Edge } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { VariableRole } from "@/types/variable-proposals";
import type {
  PreflightView,
  PreflightQuestion,
  PreflightVariables,
  PreflightCausalMap,
  PreflightGoals,
  PreflightInitialState,
  PreflightDownstreamPlan,
  PreflightConfidenceBreakdown,
  PreflightOverride,
  VariableEntry,
  VariableRationale,
  PreviewBridge,
  PlanItem,
  ConfidenceComponent,
  ConfidenceCallout,
  RoleInferenceNote,
} from "@/types/preflight";
import {
  detectOrphanClusters,
  type OrphanCluster,
} from "@/lib/mediator-proposal/detect-orphan-clusters";
import { proposeMediatorsForClusters } from "@/lib/mediator-proposal/propose-mediator";
import { validateMediatorProposals } from "@/lib/mediator-proposal/validate-mediator";
import { hashPreflight } from "./hash-preflight";
import { partitionVariablesByRole } from "./partition-variables-by-role";

// ── Public types ────────────────────────────────────────────────────

export interface LoadPreflightArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  space_id: string;
  /** Optional persona/subject — when null, defaults to no-persona context. */
  subject_id?: string | null;
  /** When false, skip the M1+M2+M3 preview pass (faster; for non-blocking
   *  refresh use cases). Default true. */
  include_mediator_preview?: boolean;
  /** Override the user_id check; useful for server-side automation.
   *  In normal flow the route reads user.id from safeAuth and passes it. */
  user_id: string;
}

export type LoadPreflightResult =
  | { ok: true; preflight: PreflightView }
  | { ok: false; reason: "space_not_found" | "not_authorized" | "internal_error"; detail?: string };

// ── Main entry point ────────────────────────────────────────────────

export async function loadPreflightView(
  args: LoadPreflightArgs,
): Promise<LoadPreflightResult> {
  const { db, space_id, subject_id = null, user_id } = args;
  const includeMediatorPreview = args.include_mediator_preview !== false;

  // Cast to any so the new columns from in-flight migrations don't
  // wedge against generated types. Same pattern as EnvironmentDefinition.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any;

  // ── Parallel load ─────────────────────────────────────────────────
  let space: SpaceRow | null = null;
  let entities: Entity[] = [];
  let edges: Edge[] = [];
  let goals: ImprovementGoal[] = [];
  let goalsExtra: GoalsExtraRow[] = [];
  let subject: SubjectRow | null = null;
  let conditionModulators: ConditionModulatorRow[] = [];
  let kgPlan: KgPlanRow | null = null;
  let variableProposals: VariableProposalRow[] = [];
  let experimentTaxonomies: ExperimentTaxonomyRow[] = [];
  let environmentOverrides: EnvironmentOverrideRow[] = [];
  let metricObservations: MetricObservationRow[] = [];

  try {
    const [
      spaceRes,
      entRes,
      edgeRes,
      goalsRes,
      goalsExtraRes,
      subjectRes,
      modRes,
      kgPlanRes,
      vpRes,
      taxRes,
      ovRes,
      obsRes,
    ] = await Promise.all([
      dbAny.from("spaces").select("*").eq("id", space_id).maybeSingle(),
      dbAny
        .from("entities")
        .select("*")
        .eq("space_id", space_id)
        // Skip rejected mediators outright — they're audit-only.
        .neq("proposal_status", "rejected_mediator"),
      dbAny.from("edges").select("*").eq("space_id", space_id),
      dbAny.from("improvement_goals").select("*").eq("space_id", space_id),
      dbAny.from("goals_extra").select("*").eq("space_id", space_id),
      subject_id
        ? dbAny
            .from("subjects")
            .select("*")
            .eq("id", subject_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      dbAny.from("condition_modulators").select("*"),
      dbAny
        .from("kg_generation_plans")
        .select("*")
        .eq("space_id", space_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      dbAny.from("variable_proposals").select("*").eq("space_id", space_id),
      dbAny.from("experiment_taxonomies").select("*").eq("space_id", space_id),
      dbAny
        .from("environment_overrides")
        .select("*")
        .eq("space_id", space_id),
      dbAny
        .from("metric_observations")
        .select("metric_entity_id,value,recorded_at,source")
        .eq("space_id", space_id)
        .order("recorded_at", { ascending: false }),
    ]);

    if (!spaceRes?.data) {
      return { ok: false, reason: "space_not_found" };
    }
    space = spaceRes.data as SpaceRow;
    if (space.user_id !== user_id) {
      return { ok: false, reason: "not_authorized" };
    }

    entities = (entRes?.data ?? []) as Entity[];
    edges = (edgeRes?.data ?? []) as Edge[];
    goals = (goalsRes?.data ?? []) as ImprovementGoal[];
    goalsExtra = (goalsExtraRes?.data ?? []) as GoalsExtraRow[];
    subject = (subjectRes?.data ?? null) as SubjectRow | null;
    conditionModulators = (modRes?.data ?? []) as ConditionModulatorRow[];
    kgPlan = (kgPlanRes?.data ?? null) as KgPlanRow | null;
    variableProposals = (vpRes?.data ?? []) as VariableProposalRow[];
    experimentTaxonomies = (taxRes?.data ?? []) as ExperimentTaxonomyRow[];
    environmentOverrides = (ovRes?.data ?? []) as EnvironmentOverrideRow[];
    metricObservations = (obsRes?.data ?? []) as MetricObservationRow[];
  } catch (e) {
    return {
      ok: false,
      reason: "internal_error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // Some columns may not exist yet (mid-migration); fall back gracefully.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthesisData = parseSynthesisData((space as any)?.synthesis_data);

  // ── Build sections ────────────────────────────────────────────────

  const overridesNormalized: PreflightOverride[] = environmentOverrides.map(
    (o) => ({
      override_id: o.id,
      override_kind: (o.override_kind as PreflightOverride["override_kind"]) ?? "reclassify_variable",
      target_id: o.target_id ?? "",
      value: o.override_value,
      applied_at: o.created_at,
      applied_by: o.created_by ?? user_id,
      reasoning: o.reasoning ?? null,
    }),
  );

  const question = buildQuestion({
    space,
    kgPlan,
    synthesisData,
    overrides: overridesNormalized,
  });

  const variables = await partitionVariablesByRole({
    entities,
    edges,
    goals,
    variableProposals,
    overrides: overridesNormalized,
    metricObservations,
  });

  // ── M1 + M2 + M3 in preview mode (no persistence) ─────────────────
  let previewBridges: PreviewBridge[] = [];
  let orphanClustersCount = 0;
  if (includeMediatorPreview && entities.length >= 3) {
    const clusters = detectOrphanClusters(entities, edges);
    orphanClustersCount = clusters.length;
    previewBridges = await runMediatorPreview({
      clusters,
      entities,
      domain: question.domain.label,
      userPrompt: question.prompt_verbatim,
      overrides: overridesNormalized,
    });
  }

  const causalMap = buildCausalMap({
    entities,
    edges,
    previewBridges,
    orphanClustersCount,
    overrides: overridesNormalized,
  });

  const goalsSection = buildGoals({ goals, goalsExtra, overrides: overridesNormalized });

  const initialState = buildInitialState({
    subject,
    conditions: subject?.conditions ?? null,
    conditionModulators,
    metricObservations,
    goals,
    overrides: overridesNormalized,
  });

  const downstream = buildDownstreamPlan({
    entities,
    edges,
    causalMap,
    overrides: overridesNormalized,
  });

  // ── Confidence ────────────────────────────────────────────────────

  const confidenceBreakdown = computeConfidenceBreakdown({
    question,
    variables,
    causalMap,
    goals: goalsSection,
    initialState,
  });

  const confidenceOverall = clamp01(
    confidenceBreakdown.question_clarity.score *
      confidenceBreakdown.question_clarity.weight +
      confidenceBreakdown.variable_coverage.score *
        confidenceBreakdown.variable_coverage.weight +
      confidenceBreakdown.causal_map_density.score *
        confidenceBreakdown.causal_map_density.weight +
      confidenceBreakdown.goal_specificity.score *
        confidenceBreakdown.goal_specificity.weight +
      confidenceBreakdown.initial_state_calibration.score *
        confidenceBreakdown.initial_state_calibration.weight,
  );

  // ── Compose + hash ────────────────────────────────────────────────

  const computedAt = new Date().toISOString();
  const partial: Omit<PreflightView, "preflight_hash"> = {
    space_id,
    subject_id,
    computed_at: computedAt,
    question,
    variables,
    causal_map: causalMap,
    goals: goalsSection,
    initial_state: initialState,
    downstream,
    confidence_overall: confidenceOverall,
    confidence_breakdown: confidenceBreakdown,
    overrides_applied: overridesNormalized,
  };

  const preflight_hash = hashPreflight(partial);

  return {
    ok: true,
    preflight: { ...partial, preflight_hash },
  };
}

// ── Section builders ────────────────────────────────────────────────

function buildQuestion(args: {
  space: SpaceRow;
  kgPlan: KgPlanRow | null;
  synthesisData: SynthesisData | null;
  overrides: PreflightOverride[];
}): PreflightQuestion {
  const { space, kgPlan, synthesisData } = args;

  const promptRaw = (space.input_text ?? "").trim();
  const prompt_truncated = promptRaw.length > 4000;
  const prompt_verbatim = prompt_truncated ? promptRaw.slice(0, 4000) + "…" : promptRaw;

  // ScopeAndObjectives lives on kg_generation_plans.scope_and_objectives JSONB.
  const scope = kgPlan?.scope_and_objectives ?? null;
  const goalParsed = scope?.goal_parsed ?? null;

  const primary_objective =
    goalParsed?.primary_objective?.toString().trim() ||
    space.name?.trim() ||
    "(objective not yet parsed)";
  const primary_objective_source_quote =
    goalParsed?.primary_source_quote?.toString() ?? null;

  const subObjectivesRaw = Array.isArray(goalParsed?.sub_objectives)
    ? (goalParsed.sub_objectives as Array<Record<string, unknown>>)
    : [];
  const sub_objectives = subObjectivesRaw.map((s) => ({
    text: typeof s.text === "string" ? s.text : "",
    source_quote: typeof s.source_quote === "string" ? s.source_quote : null,
    evidence_ids: Array.isArray(s.evidence_ids) ? (s.evidence_ids as string[]) : [],
    confidence:
      typeof s.confidence === "number" ? clamp01(s.confidence) : 0.6,
  }));

  const domain = {
    label:
      typeof goalParsed?.domain_classification?.label === "string"
        ? goalParsed.domain_classification.label
        : (space.use_case_template_id ?? "general"),
    confidence:
      typeof goalParsed?.domain_classification?.confidence === "number"
        ? clamp01(goalParsed.domain_classification.confidence)
        : 0.5,
    rationale:
      typeof goalParsed?.domain_classification?.rationale === "string"
        ? goalParsed.domain_classification.rationale
        : null,
  };

  const decision_horizon_weeks =
    typeof goalParsed?.decision_horizon_weeks === "number"
      ? goalParsed.decision_horizon_weeks
      : null;

  const out_of_scope = Array.isArray(goalParsed?.out_of_scope)
    ? (goalParsed.out_of_scope as string[])
    : [];

  // Success criteria can come from goalParsed OR from synthesisData's
  // benchmark — prefer goalParsed since it's user-driven.
  // synthesisData has a typed shape; treat as opaque Record for the
  // benchmark-fallback path and let JSON shape variance pass through.
  const synthAsRecord =
    (synthesisData as unknown as Record<string, unknown> | null) ?? null;
  const benchmark = synthAsRecord?.benchmark as
    | { success_criteria?: unknown }
    | undefined;
  const successCriteriaRaw: Array<Record<string, unknown>> = Array.isArray(
    goalParsed?.success_criteria,
  )
    ? (goalParsed.success_criteria as Array<Record<string, unknown>>)
    : Array.isArray(benchmark?.success_criteria)
      ? (benchmark.success_criteria as Array<Record<string, unknown>>)
      : [];
  const success_criteria = successCriteriaRaw.map((s) => {
    const priority: "primary" | "secondary" =
      s.priority === "secondary" ? "secondary" : "primary";
    return {
      criterion: typeof s.criterion === "string" ? s.criterion : "",
      threshold: typeof s.threshold === "string" ? s.threshold : null,
      priority,
    };
  });

  return {
    prompt_verbatim,
    prompt_truncated,
    primary_objective,
    primary_objective_source_quote,
    sub_objectives,
    domain,
    decision_horizon_weeks,
    decision_horizon_source: decision_horizon_weeks !== null ? "prompt" : null,
    out_of_scope,
    success_criteria,
  };
}

async function runMediatorPreview(args: {
  clusters: OrphanCluster[];
  entities: Entity[];
  domain: string;
  userPrompt: string;
  overrides: PreflightOverride[];
}): Promise<PreviewBridge[]> {
  const { clusters, entities, domain, userPrompt, overrides } = args;
  if (clusters.length === 0) return [];

  // Read pre-decisions from overrides so previously-approved or
  // previously-rejected bridges remember their state across reloads.
  const preDecisions = new Map<string, "preview_approved" | "preview_rejected">();
  for (const o of overrides) {
    if (o.override_kind === "approve_preview_bridge") {
      preDecisions.set(o.target_id, "preview_approved");
    } else if (o.override_kind === "reject_preview_bridge") {
      preDecisions.set(o.target_id, "preview_rejected");
    }
  }

  const layerSlugs = Array.from(
    new Set(entities.map((e) => e.layer).filter((l): l is string => !!l)),
  );
  const entityNames = entities.map((e) => e.name);

  const proposals = await proposeMediatorsForClusters(clusters, {
    domain_label: domain,
    user_prompt: userPrompt,
    existing_layer_slugs: layerSlugs,
    existing_entity_names: entityNames,
  });

  // Build a per-proposal validation context. M3 needs cluster
  // member names + cluster layer per proposal — derive from the
  // matching cluster.
  const clusterById = new Map(clusters.map((c) => [c.cluster_id, c]));
  const validatedList = await Promise.all(
    proposals.map(async (p) => {
      const cluster = clusterById.get(p.cluster_id);
      const validated = await validateMediatorProposals(
        [p],
        {
          domain_label: domain,
          existing_entity_names: entityNames,
          cluster_member_names: cluster?.member_entity_names ?? [],
          cluster_layer: cluster?.shared_signal.layer ?? null,
        },
      );
      return validated[0];
    }),
  );

  return validatedList
    .filter((v) => v.proposal.proposed_entity != null)
    .filter((v) => v.verdict.status === "validated" || v.verdict.status === "speculative")
    .map((v) => {
      const cluster = clusterById.get(v.proposal.cluster_id);
      return {
        cluster_id: v.proposal.cluster_id,
        proposed_entity_name: v.proposal.proposed_entity!.name,
        proposed_entity_layer: v.proposal.proposed_entity!.layer,
        proposed_entity_category: v.proposal.proposed_entity!.entity_category,
        bridges_member_names: cluster?.member_entity_names ?? [],
        proposed_edge_count: v.proposal.proposed_edges.length,
        confidence: v.confidence_final,
        speculative: v.verdict.status === "speculative",
        mechanism_explanation: v.proposal.mechanism_explanation,
        verdict: v.verdict,
        preview_decision: preDecisions.get(v.proposal.cluster_id) ?? "pending",
      };
    });
}

function buildCausalMap(args: {
  entities: Entity[];
  edges: Edge[];
  previewBridges: PreviewBridge[];
  orphanClustersCount: number;
  overrides: PreflightOverride[];
}): PreflightCausalMap {
  const { entities, edges, previewBridges, orphanClustersCount, overrides } = args;

  const edge_status_counts = { confirmed: 0, mixed: 0, sparse: 0 };
  const edge_causal_status_counts = {
    established_causal: 0,
    plausible_causal: 0,
    correlational_only: 0,
    unknown: 0,
  };
  let explicit_relations_from_prompt = 0;
  let template_seed_relations = 0;
  let research_added_relations = 0;

  for (const e of edges) {
    // Status (confirmed/mixed/sparse) — schema column on edges.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = ((e as any).status as string | undefined) ?? "sparse";
    if (status === "confirmed") edge_status_counts.confirmed++;
    else if (status === "mixed") edge_status_counts.mixed++;
    else edge_status_counts.sparse++;

    // Causal status — defensive against missing column.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cstatus = (e as any).causal_status as string | undefined;
    if (cstatus === "established_causal") edge_causal_status_counts.established_causal++;
    else if (cstatus === "plausible_causal") edge_causal_status_counts.plausible_causal++;
    else if (cstatus === "correlational_only") edge_causal_status_counts.correlational_only++;
    else {
      // No column or null → fall through. Treat as established for
      // back-compat; surface the gap in confidence callouts.
      edge_causal_status_counts.unknown++;
    }

    // Provenance origin.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provenance = (e as any).provenance as Record<string, unknown> | undefined;
    const source = provenance?.source as string | undefined;
    if (source === "prompt_extraction") explicit_relations_from_prompt++;
    else if (source === "template_seed") template_seed_relations++;
    else if (source === "research" || source === "deep_research") research_added_relations++;
  }

  // Depth setting from override if user adjusted it.
  let depth_setting: 1 | 2 | 3 = 2; // default mid
  for (const o of overrides) {
    if (o.override_kind === "toggle_plan_item" && o.target_id === "kg_depth") {
      const d = Number((o.value as Record<string, unknown> | null)?.depth ?? 2);
      if (d === 1 || d === 2 || d === 3) depth_setting = d;
    }
  }

  return {
    current_entities: entities.length,
    current_edges: edges.length,
    edge_status_counts,
    edge_causal_status_counts,
    explicit_relations_from_prompt,
    template_seed_relations,
    research_added_relations,
    preview_bridges: previewBridges,
    orphan_clusters_count: orphanClustersCount,
    depth_setting,
  };
}

function buildGoals(args: {
  goals: ImprovementGoal[];
  goalsExtra: GoalsExtraRow[];
  overrides: PreflightOverride[];
}): PreflightGoals {
  const { goals, goalsExtra, overrides } = args;
  const extraByGoal = new Map(goalsExtra.map((g) => [g.goal_id, g]));

  // Build per-goal weight overrides BEFORE sorting so the sort respects
  // the user's most-recent edits. The slider in preflight-page-client
  // writes `{ override_kind: "adjust_goal", target_id: <goal_id>,
  // value: { weight: <new> } }` rows; we replay them here so subsequent
  // pages render the overridden weight, and the planner downstream
  // consumes the same number.
  const weightOverrideByGoalId = new Map<string, number>();
  for (const o of overrides) {
    if (o.override_kind !== "adjust_goal" || !o.target_id) continue;
    const v = (o.value as Record<string, unknown> | null) ?? {};
    if (typeof v.weight === "number" && Number.isFinite(v.weight)) {
      weightOverrideByGoalId.set(o.target_id, v.weight);
    }
  }

  const resolveWeight = (goalId: string): number => {
    const overridden = weightOverrideByGoalId.get(goalId);
    if (typeof overridden === "number") return overridden;
    const extra = extraByGoal.get(goalId);
    return typeof extra?.weight === "number" ? extra.weight : 1.0;
  };

  const sorted = [...goals].sort((a, b) => {
    return resolveWeight(b.id) - resolveWeight(a.id);
  });

  const allMapped = sorted.map((g) => {
    const extra = extraByGoal.get(g.id);
    const weight = resolveWeight(g.id);
    // baseline_value / target_value are typed as `number | null` on
    // ImprovementGoal but live data sometimes carries strings (legacy
    // rows) — cast through unknown to handle both safely.
    const rawBaseline = g.baseline_value as unknown;
    const rawTarget = g.target_value as unknown;
    const baseline =
      rawBaseline != null && rawBaseline !== "" ? Number(rawBaseline) : null;
    const target =
      rawTarget != null && rawTarget !== "" ? Number(rawTarget) : null;
    const direction: "increase" | "decrease" | "stabilize" =
      baseline != null && target != null
        ? target > baseline
          ? "increase"
          : target < baseline
            ? "decrease"
            : "stabilize"
        : "increase";
    return {
      goal_id: g.id,
      title: g.title,
      metric_name: g.metric_name ?? "",
      // Sprint W5.7b — typed via ImprovementGoal.metric_entity_id.
      metric_entity_id: g.metric_entity_id ?? null,
      baseline_value: baseline != null && Number.isFinite(baseline) ? baseline : null,
      target_value: target != null && Number.isFinite(target) ? target : null,
      unit: g.metric_unit ?? null,
      direction,
      weight,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      horizon_weeks: ((g as any).horizon_weeks as number) ?? null,
      baseline_measured: baseline != null,
      target_user_set: target != null,
    };
  });

  const primary = allMapped[0] ?? null;
  const sub_goals = allMapped.slice(1, 4); // up to 3 sub-goals

  // Discount factor — pull from primary goal's goals_extra row, else default.
  const primaryExtra = primary ? extraByGoal.get(primary.goal_id) : null;
  let discount_per_week =
    typeof primaryExtra?.discount_per_week === "number"
      ? primaryExtra.discount_per_week
      : 0.95;

  // Apply override
  for (const o of overrides) {
    if (o.override_kind === "adjust_goal" && primary && o.target_id === primary.goal_id) {
      const v = (o.value as Record<string, unknown> | null) ?? {};
      if (typeof v.discount_per_week === "number") discount_per_week = v.discount_per_week;
    }
  }

  const discount_label: PreflightGoals["discount_label"] =
    discount_per_week >= 0.97
      ? "patient"
      : discount_per_week >= 0.92
        ? "balanced"
        : "urgent";

  // Effective half-life: ln(0.5) / ln(γ)
  const effective_half_life_weeks =
    discount_per_week >= 1
      ? Number.POSITIVE_INFINITY
      : Math.log(0.5) / Math.log(discount_per_week);

  // Cost terms — pulled from goalsExtra if available; else empty.
  const cost_terms = (primaryExtra?.cost_terms ?? []) as PreflightGoals["cost_terms"];

  // Stop conditions: not yet wired to a table; surface empty.
  const stop_conditions: PreflightGoals["stop_conditions"] = [];

  // Weight normalization check.
  const totalWeight = allMapped.reduce((acc, g) => acc + g.weight, 0);
  const weights_normalized = Math.abs(totalWeight - 1.0) < 0.01;

  return {
    primary,
    sub_goals,
    cost_terms,
    discount_per_week,
    discount_label,
    effective_half_life_weeks: Number.isFinite(effective_half_life_weeks)
      ? Math.round(effective_half_life_weeks * 10) / 10
      : 9999,
    stop_conditions,
    weights_normalized,
  };
}

function buildInitialState(args: {
  subject: SubjectRow | null;
  conditions: Record<string, unknown> | null;
  conditionModulators: ConditionModulatorRow[];
  metricObservations: MetricObservationRow[];
  goals: ImprovementGoal[];
  overrides: PreflightOverride[];
}): PreflightInitialState {
  const { subject, conditions, conditionModulators, metricObservations, goals, overrides } = args;

  // Conditions partition by calibrated/uncalibrated.
  const conditionEntries: PreflightInitialState["conditions"] = [];
  if (conditions && typeof conditions === "object") {
    for (const [key, value] of Object.entries(conditions)) {
      if (key === "_meta") continue;
      const matchingMods = conditionModulators.filter(
        (m) => m.condition_key === key,
      );
      conditionEntries.push({
        key,
        label: humanizeKey(key),
        value: (value as string | number | boolean | null) ?? null,
        is_calibrated: matchingMods.length > 0,
        modulator_count: matchingMods.length,
        source: applyConditionSource(key, overrides),
        source_quote: null,
      });
    }
  }

  const calibrated_count = conditionEntries.filter((c) => c.is_calibrated).length;
  const uncalibrated_count = conditionEntries.length - calibrated_count;

  // Baselines — derived from improvement_goals. A baseline is "measured"
  // when the goal carries a baseline_value AND there's a recent
  // metric_observation row from a non-template source.
  const baselines: PreflightInitialState["baselines"] = [];
  let baselines_measured = 0;
  let baselines_pending = 0;
  for (const g of goals) {
    // Sprint W5.7b — typed via ImprovementGoal.metric_entity_id.
    const metricEntityId = g.metric_entity_id ?? "";
    if (!metricEntityId) continue;

    const obs = metricObservations.find((o) => o.metric_entity_id === metricEntityId);
    const measured = obs != null && obs.source !== "seed" && obs.source !== "ai_estimated";
    if (measured) baselines_measured++;
    else baselines_pending++;

    baselines.push({
      metric_entity_id: metricEntityId,
      metric_name: g.metric_name ?? "",
      value:
        obs != null
          ? String(obs.value)
          : g.baseline_value != null
            ? String(g.baseline_value)
            : null,
      unit: g.metric_unit ?? null,
      measured_at: obs?.recorded_at ?? null,
      source: measured
        ? "measured"
        : obs?.source === "seed"
          ? "template_default"
          : g.baseline_value != null
            ? "user_inferred"
            : "population_average",
      suggested_action: !measured ? "measure_now" : null,
      // Heuristic — unmeasured baselines for primary metric have higher
      // variance reduction. Refined later with actual sensitivity analysis.
      variance_reduction_if_measured: measured ? 0 : 0.4,
    });
  }

  const pending_baselines_to_measure = baselines
    .filter((b) => b.suggested_action === "measure_now")
    .sort((a, b) => b.variance_reduction_if_measured - a.variance_reduction_if_measured)
    .slice(0, 5)
    .map((b) => b.metric_name);

  return {
    persona_id: subject?.id ?? null,
    persona_name: subject?.name ?? null,
    conditions: conditionEntries,
    calibrated_count,
    uncalibrated_count,
    baselines,
    baselines_measured,
    baselines_pending,
    pending_baselines_to_measure,
  };
}

// ── Downstream plan ─────────────────────────────────────────────────

function buildDownstreamPlan(args: {
  entities: Entity[];
  edges: Edge[];
  causalMap: PreflightCausalMap;
  overrides: PreflightOverride[];
}): PreflightDownstreamPlan {
  const { entities, edges, causalMap, overrides } = args;

  // Read user toggle overrides for plan items.
  const enabledOptIns = new Set<string>();
  for (const o of overrides) {
    if (o.override_kind === "toggle_plan_item") {
      const v = o.value as { enabled?: boolean } | null;
      if (v?.enabled) enabledOptIns.add(o.target_id);
    }
  }

  // ── WILL items ────────────────────────────────────────────────────
  const will: PlanItem[] = [];
  let order = 0;
  const push = (
    items: PlanItem[],
    item: Omit<PlanItem, "order" | "enabled">,
    forceEnabled?: boolean,
  ) => {
    items.push({
      ...item,
      enabled:
        forceEnabled !== undefined
          ? forceEnabled
          : item.default_enabled || enabledOptIns.has(item.id),
      order: order++,
    });
  };

  // KG decompose — always-on. Estimates scale with current entity count
  // (more entities → fewer to extract from prompt; fewer → more research).
  const estEntitiesAdd = clamp(80 - entities.length, 20, 100);
  push(will, {
    id: "kg_decompose",
    label: "Knowledge graph decomposition",
    description: "Extract entities + causal edges from your prompt and assets.",
    default_enabled: true,
    toggleable: false,
    estimated_seconds: 12,
    estimated_cost_usd: 0.04,
    estimated_artifacts: [
      { kind: "entity", count: estEntitiesAdd },
      { kind: "edge", count: Math.round(estEntitiesAdd * 0.4) },
    ],
    depends_on: [],
  });

  push(will, {
    id: "multi_pass_research",
    label: "Multi-pass research",
    description:
      "Run outcome-breadth + triangulation + cycle-close research passes against your decomposed KG.",
    default_enabled: true,
    toggleable: true,
    estimated_seconds: 18,
    estimated_cost_usd: 0.06,
    estimated_artifacts: [
      { kind: "evidence_extraction", count: 12 },
      { kind: "edge", count: 15 },
    ],
    depends_on: ["kg_decompose"],
  });

  push(will, {
    id: "synthesis",
    label: "Synthesis (bottleneck + leverage + risk)",
    description:
      "Identify the master bottleneck, top leverage points, and critical risks.",
    default_enabled: true,
    toggleable: false,
    estimated_seconds: 8,
    estimated_cost_usd: 0.03,
    estimated_artifacts: [
      { kind: "bottleneck", count: 1 },
      { kind: "leverage", count: 3 },
      { kind: "risk", count: 2 },
    ],
    depends_on: ["kg_decompose", "multi_pass_research"],
  });

  push(will, {
    id: "mediator_proposal_engine",
    label: "Mediator proposal engine",
    description:
      "Detect orphan clusters and propose canonical bridging entities. Approved bridges land in the graph.",
    default_enabled: true,
    toggleable: true,
    estimated_seconds: causalMap.orphan_clusters_count * 1.5 + 2,
    estimated_cost_usd: causalMap.orphan_clusters_count * 0.02,
    estimated_artifacts: [
      { kind: "proposed_mediator", count: causalMap.orphan_clusters_count },
    ],
    depends_on: ["kg_decompose"],
  });

  push(will, {
    id: "strategy_generation",
    label: "Strategy generation",
    description: "Synthesize 3 ranked strategy alternatives with reasoning.",
    default_enabled: true,
    toggleable: false,
    estimated_seconds: 25,
    estimated_cost_usd: 0.10,
    estimated_artifacts: [{ kind: "strategy", count: 3 }],
    depends_on: ["synthesis"],
  });

  push(will, {
    id: "twin_proposal",
    label: "Digital twin proposal",
    description:
      "Compose the workflow twin from the chosen strategy + mechanism cascade.",
    default_enabled: true,
    toggleable: false,
    estimated_seconds: 15,
    estimated_cost_usd: 0.05,
    estimated_artifacts: [{ kind: "twin_proposal", count: 1 }],
    depends_on: ["strategy_generation"],
  });

  push(will, {
    id: "lab_apps",
    label: "Lab apps",
    description: "Materialize the simulator + measurement tools as apps.",
    default_enabled: true,
    toggleable: false,
    estimated_seconds: 10,
    estimated_cost_usd: 0.04,
    estimated_artifacts: [{ kind: "app", count: 5 }],
    depends_on: ["twin_proposal"],
  });

  push(will, {
    id: "trajectory_simulation",
    label: "Trajectory simulation",
    description:
      "12-week Monte Carlo projection (1000 iterations) of expected outcomes per strategy.",
    default_enabled: true,
    toggleable: true,
    estimated_seconds: 8,
    estimated_cost_usd: 0.02,
    estimated_artifacts: [{ kind: "prediction", count: 3 }],
    depends_on: ["lab_apps"],
  });

  // ── COULD items (opt-in) ──────────────────────────────────────────
  const could: PlanItem[] = [];

  push(could, {
    id: "deep_research_pass",
    label: "Deep research pass",
    description:
      "Run an extended research cycle against the most uncertain edges (5-10 additional papers).",
    default_enabled: false,
    toggleable: true,
    estimated_seconds: 25,
    estimated_cost_usd: 0.06,
    estimated_artifacts: [{ kind: "evidence_extraction", count: 8 }],
    depends_on: ["multi_pass_research"],
  });

  push(could, {
    id: "mechanism_decomposition",
    label: "Mechanism decomposition",
    description:
      "Insert intermediate mediators for each well-evidenced edge (e.g., exercise → lactate → PGC-1α → BDNF).",
    default_enabled: false,
    toggleable: true,
    estimated_seconds: 20,
    estimated_cost_usd: 0.05,
    estimated_artifacts: [{ kind: "entity", count: 30 }],
    depends_on: ["kg_decompose"],
  });

  push(could, {
    id: "counterfactual_scenarios",
    label: "Counterfactual scenarios",
    description: "Generate 3 alternative-path strategies for what-if exploration.",
    default_enabled: false,
    toggleable: true,
    estimated_seconds: 10,
    estimated_cost_usd: 0.03,
    estimated_artifacts: [{ kind: "scenario", count: 3 }],
    depends_on: ["strategy_generation"],
  });

  push(could, {
    id: "adversarial_premortem",
    label: "Adversarial pre-mortem",
    description:
      "Stress-test the chosen strategy against failure modes from the literature.",
    default_enabled: false,
    toggleable: true,
    estimated_seconds: 8,
    estimated_cost_usd: 0.03,
    estimated_artifacts: [{ kind: "failure_mode", count: 5 }],
    depends_on: ["strategy_generation"],
  });

  push(could, {
    id: "synergy_detection",
    label: "Synergy detection (3-way ANOVA)",
    description:
      "Detect emergent interactions among intervention combinations.",
    default_enabled: false,
    toggleable: true,
    estimated_seconds: 12,
    estimated_cost_usd: 0.02,
    estimated_artifacts: [{ kind: "reaction", count: 4 }],
    depends_on: ["lab_apps"],
  });

  push(could, {
    id: "insight_algorithms",
    label: "Insight algorithms (PageRank, k-core, cascade)",
    description: "Run structural graph analyses to surface hub variables and bottlenecks.",
    default_enabled: false,
    toggleable: true,
    estimated_seconds: 5,
    estimated_cost_usd: 0,
    estimated_artifacts: [{ kind: "analysis", count: 4 }],
    depends_on: ["kg_decompose"],
  });

  push(could, {
    id: "per_app_substrategies",
    label: "Per-app sub-strategies",
    description: "Generate a focused sub-strategy spec per lab app.",
    default_enabled: false,
    toggleable: true,
    estimated_seconds: 30,
    estimated_cost_usd: 0.08,
    estimated_artifacts: [{ kind: "app_strategy", count: 5 }],
    depends_on: ["lab_apps"],
  });

  // ── WON'T items ───────────────────────────────────────────────────
  const will_not_generate = [
    {
      label: "Cross-space bridges",
      reason: "Single-space mode — no other spaces with shared variables.",
      unlock_path: "Open another space and link them via the bridge tool.",
    },
    {
      label: "Wearable / continuous biomarker integration",
      reason: "No consent on file for continuous device data.",
      unlock_path: "Settings → Integrations → grant device access.",
    },
    {
      label: "Real-subject recruitment",
      reason: "Lab simulation only — no protocol or IRB workflow attached.",
      unlock_path: null,
    },
  ];

  // ── Aggregate totals ──────────────────────────────────────────────
  const enabled = [...will, ...could].filter((i) => i.enabled);
  const estimated_total_seconds = enabled.reduce(
    (acc, i) => acc + i.estimated_seconds,
    0,
  );
  const estimated_total_cost_usd =
    Math.round(
      enabled.reduce((acc, i) => acc + i.estimated_cost_usd, 0) * 100,
    ) / 100;
  let estimated_entities_added = 0;
  let estimated_edges_added = 0;
  const artifactsAggregate = new Map<string, number>();
  for (const item of enabled) {
    for (const a of item.estimated_artifacts) {
      artifactsAggregate.set(
        a.kind,
        (artifactsAggregate.get(a.kind) ?? 0) + a.count,
      );
      if (a.kind === "entity") estimated_entities_added += a.count;
      if (a.kind === "edge") estimated_edges_added += a.count;
    }
  }
  const estimated_artifacts_added = Array.from(artifactsAggregate.entries()).map(
    ([kind, count]) => ({ kind, count }),
  );

  return {
    will_generate: will,
    could_generate: could,
    will_not_generate,
    estimated_total_seconds: Math.round(estimated_total_seconds),
    estimated_total_cost_usd,
    estimated_entities_added,
    estimated_edges_added,
    estimated_artifacts_added,
  };
}

// ── Confidence ──────────────────────────────────────────────────────

function computeConfidenceBreakdown(args: {
  question: PreflightQuestion;
  variables: PreflightVariables;
  causalMap: PreflightCausalMap;
  goals: PreflightGoals;
  initialState: PreflightInitialState;
}): PreflightConfidenceBreakdown {
  const { question, variables, causalMap, goals, initialState } = args;
  const callouts: ConfidenceCallout[] = [];

  // Question clarity — driven by domain confidence + sub-objective count.
  const subObjScore = clamp01(question.sub_objectives.length / 3);
  const question_clarity_score = clamp01(
    question.domain.confidence * 0.6 + subObjScore * 0.4,
  );
  const question_clarity: ConfidenceComponent = {
    score: question_clarity_score,
    weight: 0.15,
    warn_threshold: 0.5,
    label: "How well we parsed your intent.",
  };
  if (question_clarity_score < question_clarity.warn_threshold) {
    callouts.push({
      component: "question_clarity",
      severity: "warn",
      message: `Domain confidence ${Math.round(question.domain.confidence * 100)}% — the system isn't sure what kind of problem this is.`,
      suggested_action: "Refine the prompt or pick a closer-fitting template.",
    });
  }

  // Variable coverage — fraction of role buckets with ≥1 entry.
  const filledRoles = [
    variables.independent.length > 0,
    variables.dependent.length > 0,
    variables.controls.length > 0,
    variables.confounders.length > 0,
    variables.mediators.length > 0,
    variables.moderators.length > 0,
  ].filter(Boolean).length;
  const variable_coverage_score = filledRoles / 6;
  const variable_coverage: ConfidenceComponent = {
    score: variable_coverage_score,
    weight: 0.2,
    warn_threshold: 0.5,
    label: "Coverage of variable roles (IV / DV / Controls / etc).",
  };
  if (variable_coverage_score < variable_coverage.warn_threshold) {
    callouts.push({
      component: "variable_coverage",
      severity: "info",
      message: `Only ${filledRoles} of 6 variable roles populated — some roles will be filled by downstream synthesis.`,
      suggested_action:
        "Expected — confounders/mediators auto-detect after the KG forms. You can also manually classify any unclassified entity below.",
    });
  }

  // Causal map density — fraction of edges that are well-evidenced.
  const totalEdges = causalMap.current_edges;
  const evidencedShare =
    totalEdges > 0
      ? (causalMap.edge_status_counts.confirmed + causalMap.edge_status_counts.mixed * 0.5) /
        totalEdges
      : 0;
  const causal_map_density_score = clamp01(evidencedShare);
  const causal_map_density: ConfidenceComponent = {
    score: causal_map_density_score,
    weight: 0.2,
    warn_threshold: 0.4,
    label: "Edge density and evidence quality of the causal map.",
  };
  if (causal_map_density_score < causal_map_density.warn_threshold) {
    callouts.push({
      component: "causal_map_density",
      severity: "info",
      message: `${causalMap.edge_status_counts.sparse} of ${totalEdges} edges are sparse — research pipeline will populate them.`,
      suggested_action: "Opt-in to deep research pass for higher edge confidence.",
    });
  }

  // Goal specificity — driven by primary goal having target + baseline.
  let goalScore = 0;
  if (goals.primary) {
    if (goals.primary.target_user_set) goalScore += 0.4;
    if (goals.primary.baseline_measured) goalScore += 0.3;
    if (goals.primary.horizon_weeks != null) goalScore += 0.2;
    if (goals.weights_normalized) goalScore += 0.1;
  }
  const goal_specificity: ConfidenceComponent = {
    score: clamp01(goalScore),
    weight: 0.2,
    warn_threshold: 0.6,
    label: "Goal targets, baselines, weights, and horizon.",
  };
  if (goalScore < goal_specificity.warn_threshold) {
    callouts.push({
      component: "goal_specificity",
      severity: "warn",
      message: `Primary goal lacks ${
        !goals.primary?.baseline_measured ? "a measured baseline" : "a clear target"
      }.`,
      suggested_action:
        "Set the target value and measure the baseline to anchor predictions.",
    });
  }

  // Initial state calibration — fraction of conditions calibrated.
  const conditionShare =
    initialState.conditions.length > 0
      ? initialState.calibrated_count / initialState.conditions.length
      : 0;
  const baselineShare =
    initialState.baselines.length > 0
      ? initialState.baselines_measured / initialState.baselines.length
      : 0;
  const initial_state_score = clamp01(conditionShare * 0.6 + baselineShare * 0.4);
  const initial_state_calibration: ConfidenceComponent = {
    score: initial_state_score,
    weight: 0.25,
    warn_threshold: 0.4,
    label: "Conditions calibrated; baselines measured.",
  };
  if (initial_state_score < initial_state_calibration.warn_threshold) {
    callouts.push({
      component: "initial_state_calibration",
      severity: "warn",
      message: `${initialState.uncalibrated_count} conditions use uncalibrated population averages — predictions may be over- or under-stated for this persona.`,
      suggested_action:
        "Confirm conditions or measure pending baselines before approving.",
    });
  }

  return {
    question_clarity,
    variable_coverage,
    causal_map_density,
    goal_specificity,
    initial_state_calibration,
    callouts,
  };
}

// ── Internal types ──────────────────────────────────────────────────

interface SpaceRow {
  id: string;
  user_id: string;
  name: string | null;
  input_text: string | null;
  use_case_template_id: string | null;
}

interface KgPlanRow {
  id: string;
  space_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope_and_objectives: any;
  created_at: string;
}

interface SubjectRow {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conditions: Record<string, any> | null;
}

interface ConditionModulatorRow {
  condition_key: string;
}

interface VariableProposalRow {
  entity_id: string;
  variable_role: VariableRole;
}

interface ExperimentTaxonomyRow {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slots: any;
}

interface EnvironmentOverrideRow {
  id: string;
  override_kind: string;
  target_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override_value: any;
  created_at: string;
  created_by: string | null;
  reasoning: string | null;
}

interface MetricObservationRow {
  metric_entity_id: string;
  value: string | number | null;
  recorded_at: string;
  source: string;
}

interface GoalsExtraRow {
  goal_id: string;
  weight?: number;
  discount_per_week?: number;
  cost_terms?: PreflightGoals["cost_terms"];
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseSynthesisData(raw: unknown): SynthesisData | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as SynthesisData;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as SynthesisData;
    } catch {
      return null;
    }
  }
  return null;
}

function applyConditionSource(
  key: string,
  overrides: PreflightOverride[],
): "prompt" | "template_default" | "user_override" {
  for (const o of overrides) {
    if (o.override_kind === "set_condition" && o.target_id === key) {
      return "user_override";
    }
  }
  // No reliable per-condition source tracking yet; default to prompt.
  return "prompt";
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Re-exports for ergonomics.
export type { PreflightView, RoleInferenceNote, VariableEntry, VariableRationale };
