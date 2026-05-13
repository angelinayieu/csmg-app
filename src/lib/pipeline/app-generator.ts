// App + Intervention materialization — the missing pipeline stage.
//
// Runs after strategy-refresh. Converts the strategy's `infrastructure_proposals[]`
// and `micro_tactics[]` into persistent, addressable rows in the `apps` and
// `interventions` tables. This is what turns the app from an "analysis tool"
// into a "product that generates things you actually use."
//
// Stable identity on regen:
//   apps: (space_id, source_infrastructure_proposal_id)
//   interventions: (space_id, source_tactic_id)
//
// Preservation on regen: agent-authored fields (config.agent_hints,
// state.last_agent_update, state.recent_signals) are merged in from the
// existing row so that Sprint 3's continuous-update loop is not clobbered
// every time strategy-refresh runs.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Entity } from "@/types";
import type {
  StrategicRecommendation,
  RankedStrategy,
  InfrastructureProposal,
  MicroTactic,
} from "@/types/strategy";
import type {
  AppRow,
  AppInsert,
  AppUpdate,
  AppConfig,
  AppState,
  AppVersionInsert,
  AppType,
  AppComplexity,
} from "@/types/app";
import type {
  InterventionRow,
  InterventionInsert,
} from "@/types/intervention";
import { asAppConfig, asAppState } from "@/types/app";
import { buildDefaultManifest } from "./app-manifest-builder";
import type { AppManifest } from "@/types/app-manifest";
import type { AppSeed } from "@/types/use-case";
import { getTemplate } from "@/lib/use-cases/library";
import type { StructuralEvent } from "@/types/pipeline-events";
// Sprint W5.2 — derive each app's variable contract (IV/DV/control/
// mediator/moderator) from the preflight partition and persist on
// apps.config.variables. Computed once per generate-apps run; reused
// per-app inside materializeApps.
import { partitionVariablesByRole } from "@/lib/preflight/partition-variables-by-role";
import { deriveAppVariables } from "./derive-app-variables";
import type { PreflightVariables, PreflightOverride } from "@/types/preflight";
import type { Edge } from "@/types";
import type { ImprovementGoal } from "@/types/goals";
// Sprint W5.2.5 — chosen lab influences variable role assignment.
// When the user picked an approved lab, its primary_iv/primary_dv
// override the partition's role for those specific entities
// (lab beats LLM proposal; user override still wins).
import { loadChosenLabForSpace, type LoadedLab } from "./load-chosen-lab";

// ── Types ─────────────────────────────────────────────────────────────

export interface GenerateAppsInput {
  spaceId: string;
  userId: string;
  recommendation: StrategicRecommendation;
  /** Top-ranked strategy's infrastructure proposals. Required for app generation. */
  rankedStrategies?: RankedStrategy[];
  /** All entities in the space — used to resolve code → UUID and dominant factors. */
  entities: Entity[];
  /** Active goal this strategy targets (drives apps.serves_goal_id). */
  activeGoalId?: string | null;
  /** Strategy version from strategy_snapshots.version, for provenance. */
  strategyVersion?: number;
  /**
   * Map from InfrastructureProposal.id → mechanism row IDs that were
   * materialized for it. When present, the generator sets
   * `apps.parent_mechanism_id` to the first mechanism in the list, attaching
   * each app to its parent mechanism (apps as sub-branches of mechanisms).
   * Optional for back-compat — when omitted, parent_mechanism_id stays null.
   */
  mechanismIdsByProposal?: Map<string, string[]>;
  /** DB client — caller passes an authenticated supabase client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database> | any;
  /** Who triggered this generation — 'pipeline:strategy-refresh' typical. */
  triggeredBy: string;
  /**
   * Current pipeline run id. When present, the generator emits a
   * `proposal_ready` structural event per materialized app AFTER the
   * MC distribution lands on `apps.state.simulation_distribution`.
   * This is what makes the canvas paint per-app cards live during an
   * auto-chain run (vs only surfacing them after a page reload that
   * reads from `apps` directly).
   *
   * Null / omitted when the caller has no run context (e.g. manual
   * app-generation from a user action outside the pipeline). In that
   * case events are silently skipped — apps still land in the DB.
   */
  pipelineRunId?: string | null;
  /**
   * When true, skip the inline Monte Carlo simulation block that
   * normally runs ~400 iterations per app to enrich
   * `apps.state.simulation_distribution`. Sourced from
   * spaces.reasoning_settings.runLab. Default behavior (undefined or
   * false) preserves the legacy "always simulate" pipeline. When
   * skipped, apps still materialize cleanly — they just don't carry a
   * pre-computed distribution; the user can later run on-demand sims
   * via the Lab UI.
   */
  skipLabSimulation?: boolean;
}

export interface GenerateAppsResult {
  apps_created: number;
  apps_updated: number;
  apps_total: number;
  interventions_created: number;
  interventions_updated: number;
  interventions_total: number;
  apps_with_interventions: number;
  orphan_interventions: number;    // tactics we couldn't cluster
  app_ids: string[];
  intervention_ids: string[];
}

// ── Entry point ───────────────────────────────────────────────────────

export async function generateAppsAndInterventions(
  input: GenerateAppsInput
): Promise<GenerateAppsResult> {
  const {
    spaceId,
    userId,
    recommendation,
    rankedStrategies,
    entities,
    activeGoalId,
    strategyVersion,
    mechanismIdsByProposal,
    db,
    triggeredBy,
    pipelineRunId,
    skipLabSimulation,
  } = input;

  // Code (e.g. "C1", "X3") → entities table UUID lookup.
  const codeToUuid = new Map<string, string>();
  const codeToEntity = new Map<string, Entity>();
  for (const e of entities) {
    codeToUuid.set(e.entity_id, e.id);
    codeToEntity.set(e.entity_id, e);
  }

  // Tier 1 fix: pull proposals from the strategy entry that MATCHES the
  // `recommendation` we were handed, not blindly from rank 1. Rationale:
  // when a user selects an alternative variant via /strategy-refresh
  // action=select_alternative, the route now re-ranks so the selected
  // variant is rank 1 — but if anything upstream forgets to re-rank (older
  // saved data, manual DB edits, future code paths) we still pick the
  // proposals attached to the recommendation that's actually being
  // committed instead of silently approving a different variant.
  // Match strategy: title equality is reliable for a single space (the
  // 3 variants always have distinct titles by prompt design) and survives
  // JSON round-trips that drop reference identity.
  const matchingRanked =
    rankedStrategies?.find((r) => r.recommendation?.title === recommendation.title) ??
    rankedStrategies?.[0];
  const proposals: InfrastructureProposal[] =
    matchingRanked?.infrastructure_proposals ?? [];

  // ── Load existing rows (for upsert + merge preservation) ─────────────
  const { data: existingApps } = (await db
    .from("apps")
    .select("*")
    .eq("space_id", spaceId)) as { data: AppRow[] | null };

  const existingAppByProposalId = new Map<string, AppRow>();
  for (const a of existingApps ?? []) {
    if (a.source_infrastructure_proposal_id) {
      existingAppByProposalId.set(a.source_infrastructure_proposal_id, a);
    }
  }

  // ── Sprint W5.3: mechanism lookup for mediator lights ────────────────
  // Fetch all mechanisms in the space once → build a per-mechanism
  // name+kind map. Per-app, when parent_mechanism_id resolves, the
  // matching row is snapshotted into config.mediator_light so the
  // App detail card can render "Mediator: <name>" without a join at
  // render time. Soft-fail: empty map means no mediator lights this
  // run (legacy apps still work).
  const mechanismMetaById = new Map<
    string,
    { name: string; kind: string }
  >();
  try {
    const { data: mechRows } = (await db
      .from("mechanisms")
      .select("id, name, kind")
      .eq("space_id", spaceId)) as {
      data: Array<{ id: string; name: string; kind: string }> | null;
    };
    for (const m of mechRows ?? []) {
      mechanismMetaById.set(m.id, { name: m.name, kind: m.kind });
    }
  } catch (err) {
    console.warn(
      "[app-generator] mechanism prefetch failed; mediator lights skipped:",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Seam 2: load use-case app_seeds as manifest priors ───────────────
  // If this space was created from a UseCaseTemplate, the template may
  // ship app_seeds[] — hand-authored starter manifests for the kinds of
  // apps this domain typically produces. The generator uses those as
  // priors when they match a proposal by type/name, keeping app output
  // recognizable per domain instead of reinvented each run.
  let appSeeds: AppSeed[] = [];
  try {
    const { data: spaceRow } = await db
      .from("spaces")
      .select("use_case_template_id")
      .eq("id", spaceId)
      .maybeSingle();
    const templateId = spaceRow?.use_case_template_id as string | null | undefined;
    if (templateId) {
      const template = getTemplate(templateId);
      if (template?.app_seeds) appSeeds = template.app_seeds;
    }
  } catch {
    /* template lookup is non-critical — generator still works with zero seeds */
  }

  // ── Sprint W5.2: variable contract derivation prep ──────────────────
  //
  // Fetch the same five inputs preflight uses for its variable-role
  // partition (edges, goals, variable_proposals, environment_overrides,
  // metric_observations), then compute the partition ONCE for the whole
  // generate-apps run. Each app's contract is filtered out of this
  // shared partition inside materializeApps via deriveAppVariables.
  //
  // Soft-fail end-to-end: if any of the queries fail or return null,
  // we fall back to a synthetic empty partition. Apps still materialize,
  // they just don't get a populated `variables` array (legacy behavior).
  let variablePartition: PreflightVariables | null = null;
  let goalMetricByGoalId: Map<string, string> = new Map();
  let chosenLab: LoadedLab | null = null;
  // Sprint W5.8c — hoisted so materializeApps can thread `edges` into
  // deriveAppVariables for per-app mediator/confounder scoping.
  let partitionEdges: Edge[] = [];
  try {
    const [edgeRes, goalRes, vpRes, ovRes, obsRes] = await Promise.all([
      db.from("edges").select("*").eq("space_id", spaceId),
      db
        .from("improvement_goals")
        .select("*")
        .eq("space_id", spaceId)
        .eq("status", "active"),
      db.from("variable_proposals").select("*").eq("space_id", spaceId),
      db
        .from("environment_overrides")
        .select("*")
        .eq("space_id", spaceId),
      db
        .from("metric_observations")
        .select("metric_entity_id,value,recorded_at,source")
        .eq("space_id", spaceId)
        .order("recorded_at", { ascending: false }),
    ]);
    const edges = (edgeRes?.data ?? []) as Edge[];
    partitionEdges = edges;
    const goals = (goalRes?.data ?? []) as ImprovementGoal[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const variableProposals = ((vpRes?.data ?? []) as Array<any>).map((vp) => ({
      entity_id: vp.entity_id as string,
      variable_role: vp.variable_role as "independent" | "dependent" | "controlled" | "confounding" | "outcome" | "mediator" | "modifier" | "instrument" | "condition" | "unclassified",
    }));
    const overrides: PreflightOverride[] = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ovRes?.data ?? []) as Array<any>
    ).map((o) => ({
      override_id: o.id as string,
      override_kind: (o.override_kind ?? "reclassify_variable") as PreflightOverride["override_kind"],
      target_id: (o.target_id ?? "") as string,
      value: o.override_value,
      applied_at: o.created_at as string,
      applied_by: (o.created_by ?? userId) as string,
      reasoning: (o.reasoning ?? null) as string | null,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metricObservations = ((obsRes?.data ?? []) as Array<any>).map((m) => ({
      metric_entity_id: m.metric_entity_id as string,
      value: m.value as string | number | null,
      recorded_at: m.recorded_at as string,
    }));

    // W6.8 — load canonical_code per entity's linked canonical_concept_id
    // so partition entries can carry the canonical_code for the
    // CanonicalConceptBadge URL. Soft-fails to empty map.
    const canonicalConceptIds = entities
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e) => ((e as any).canonical_concept_id as string | null) ?? null)
      .filter((id): id is string => typeof id === "string");
    const canonicalCodeById = new Map<string, string>();
    if (canonicalConceptIds.length > 0) {
      try {
        const { data: codeRows } = await db
          .from("canonical_concepts")
          .select("id, canonical_code")
          .in("id", Array.from(new Set(canonicalConceptIds)));
        for (const r of (codeRows ?? []) as Array<{ id: string; canonical_code: string }>) {
          canonicalCodeById.set(r.id, r.canonical_code);
        }
      } catch (err) {
        console.warn(
          "[app-generator] canonical_code lookup failed (badges will render without code):",
          err instanceof Error ? err.message : err,
        );
      }
    }

    variablePartition = partitionVariablesByRole({
      entities,
      edges,
      goals,
      variableProposals,
      overrides,
      metricObservations,
      canonicalCodeById,
    });

    for (const g of goals) {
      // Sprint W5.7b — typed via ImprovementGoal.metric_entity_id.
      const metricEntityId = g.metric_entity_id ?? null;
      if (metricEntityId) goalMetricByGoalId.set(g.id, metricEntityId);
    }

    // Sprint W5.2.5 — load the chosen lab (if any) once per run so
    // each app's variable contract can promote the lab's IV/DV.
    // Soft-fail: a load failure means apps fall back to partition
    // priority (LLM proposal beats heuristics).
    chosenLab = await loadChosenLabForSpace(db, spaceId, userId);
  } catch (err) {
    console.warn(
      "[app-generator] variable-partition prep failed; apps will skip variable contract:",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Step 1: materialize Apps from infrastructure_proposals ───────────
  const appResults = await materializeApps({
    spaceId,
    userId,
    proposals,
    recommendation,
    codeToUuid,
    codeToEntity,
    activeGoalId: activeGoalId ?? null,
    strategyVersion: strategyVersion ?? null,
    existingAppByProposalId,
    appSeeds,
    mechanismIdsByProposal,
    db,
    triggeredBy,
    pipelineRunId: pipelineRunId ?? null,
    skipLabSimulation,
    variablePartition,
    goalMetricByGoalId,
    chosenLab,
    mechanismMetaById,
    partitionEdges,
  });

  // ── Step 2: materialize Interventions from micro_tactics ─────────────
  const tactics = recommendation.micro_tactics ?? [];
  const interventionResults = await materializeInterventions({
    spaceId,
    userId,
    tactics,
    apps: appResults.apps,
    codeToUuid,
    strategyVersion: strategyVersion ?? null,
    db,
  });

  // ── Step 3: write app_versions audit rows ────────────────────────────
  if (appResults.apps.length > 0) {
    await recordAppVersions({
      apps: appResults.apps,
      existingAppByProposalId,
      triggeredBy,
      strategyVersion: strategyVersion ?? null,
      db,
    });
  }

  // ── Step 4: ensure each app has a sub-space whiteboard ───────────────
  // Each App gets its own child space — used as the per-app whiteboard
  // (URL: /app/space/:id/app/:appId/whiteboard). Idempotent: skips apps
  // that already have a sub_space_id.
  await ensureAppSubSpaces({
    apps: appResults.apps,
    parentSpaceId: spaceId,
    userId,
    db,
  });

  const appsWithInterventions = new Set<string>();
  for (const iv of interventionResults.interventions) {
    if (iv.app_id) appsWithInterventions.add(iv.app_id);
  }

  return {
    apps_created: appResults.created,
    apps_updated: appResults.updated,
    apps_total: appResults.apps.length,
    interventions_created: interventionResults.created,
    interventions_updated: interventionResults.updated,
    interventions_total: interventionResults.interventions.length,
    apps_with_interventions: appsWithInterventions.size,
    orphan_interventions: interventionResults.orphans,
    app_ids: appResults.apps.map((a) => a.id),
    intervention_ids: interventionResults.interventions.map((i) => i.id),
  };
}

// ── Tier 2: batch entry point ────────────────────────────────────────
//
// Iterates a StrategyBatch (one entry per active objective) and generates
// apps + interventions for each. Each per-entry call uses the existing
// generateAppsAndInterventions function — no duplication of materialization
// logic — but with the entry's own recommendation, ranked_strategies, and
// goal_id so apps land tagged with the right objective.
//
// Side effects:
//   - apps.source_infrastructure_proposal_id is the unique key, so
//     proposals from different strategies (different IDs) never collide,
//     even when two strategies happen to share a proposal name.
//   - apps.serves_goal_id gets the per-entry goal id (root vs each child),
//     so the deliverables view (Tier 2.5) can group apps by objective.
//   - apps.serves_sub_objective_ids gets the entry's parent_goal_id when
//     the entry is a sub-objective — this is the chain back to the root
//     that lets cross-objective rollups work.
//
// What this does NOT do (deferred):
//   - Per-entry baseline capture (only the primary entry currently has its
//     T0 baseline written; sub-objective baselines come in Tier 2.5).
//   - Cross-strategy app deduplication when two strategies propose
//     identical infrastructure. Today they create two apps; agents can
//     manually merge or the user can retire duplicates.

import type { StrategyBatch } from "@/types/strategy-batch";

export interface GenerateAppsForBatchInput {
  spaceId: string;
  userId: string;
  batch: StrategyBatch;
  entities: Entity[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database> | any;
  triggeredBy: string;
  /** Strategy version from strategy_snapshots.version, for provenance. */
  strategyVersion?: number;
  /** Forwarded to each per-entry generateAppsAndInterventions call. See
   *  field-level docs on GenerateAppsInput.skipLabSimulation. */
  skipLabSimulation?: boolean;
}

export interface GenerateAppsForBatchResult {
  /** Aggregate counts across all entries. */
  apps_created: number;
  apps_updated: number;
  apps_total: number;
  interventions_total: number;
  orphan_interventions: number;
  /** Per-entry breakdown so callers can surface "X apps for objective Y" UX. */
  per_entry: Array<{
    objective_id: string | null;
    objective_title: string;
    apps_total: number;
    interventions_total: number;
  }>;
}

export async function generateAppsForBatch(
  input: GenerateAppsForBatchInput,
): Promise<GenerateAppsForBatchResult> {
  const agg: GenerateAppsForBatchResult = {
    apps_created: 0,
    apps_updated: 0,
    apps_total: 0,
    interventions_total: 0,
    orphan_interventions: 0,
    per_entry: [],
  };

  // Sequential — not parallel — because each entry's app upsert reads
  // existing apps and we want a deterministic write order. The cost is
  // small (each entry produces 1-3 apps; 5 entries = ~10-15 apps total).
  for (const entry of input.batch.strategies) {
    const result = await generateAppsAndInterventions({
      spaceId: input.spaceId,
      userId: input.userId,
      recommendation: entry.recommendation,
      rankedStrategies: entry.ranked_strategies,
      entities: input.entities,
      activeGoalId: entry.objective_id,
      strategyVersion: input.strategyVersion,
      db: input.db,
      triggeredBy: input.triggeredBy,
      skipLabSimulation: input.skipLabSimulation,
    });

    agg.apps_created += result.apps_created;
    agg.apps_updated += result.apps_updated;
    agg.apps_total += result.apps_total;
    agg.interventions_total += result.interventions_total;
    agg.orphan_interventions += result.orphan_interventions;
    agg.per_entry.push({
      objective_id: entry.objective_id,
      objective_title: entry.objective_title,
      apps_total: result.apps_total,
      interventions_total: result.interventions_total,
    });

    // For sub-objective entries, also stamp serves_sub_objective_ids on the
    // apps we just created/updated. The base materializer doesn't know
    // about sub-objectives — it only sees activeGoalId — so we patch the
    // hierarchy backlink in here. parent_goal_id is the root the entry
    // is a child of.
    if (entry.parent_goal_id && result.app_ids.length > 0) {
      try {
        await input.db
          .from("apps")
          .update({
            serves_sub_objective_ids: [entry.parent_goal_id],
          })
          .in("id", result.app_ids);
      } catch (err) {
        console.warn(
          `[generateAppsForBatch] failed to stamp serves_sub_objective_ids for entry ${entry.objective_title}:`,
          err,
        );
      }
    }
  }

  console.log(
    `[generateAppsForBatch] batch ${input.batch.batch_id}: ${agg.apps_total} apps ` +
    `across ${input.batch.strategies.length} objectives (${agg.apps_created} new, ${agg.apps_updated} updated)`,
  );

  return agg;
}

// ── App materialization ───────────────────────────────────────────────

interface MaterializeAppsArgs {
  spaceId: string;
  userId: string;
  proposals: InfrastructureProposal[];
  recommendation: StrategicRecommendation;
  codeToUuid: Map<string, string>;
  codeToEntity: Map<string, Entity>;
  activeGoalId: string | null;
  strategyVersion: number | null;
  existingAppByProposalId: Map<string, AppRow>;
  appSeeds: AppSeed[];
  /** Optional proposal_id → mechanism_ids[] map; first mechanism becomes parent. */
  mechanismIdsByProposal?: Map<string, string[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  triggeredBy: string;
  /** When present, emit `proposal_ready` per materialized app after the
   *  MC simulation enrichment lands on apps.state. */
  pipelineRunId: string | null;
  /** When true, skip the inline ~400-iteration Monte Carlo enrichment.
   *  Forwarded from GenerateAppsInput.skipLabSimulation (sourced from
   *  spaces.reasoning_settings.runLab). When skipped, apps still
   *  materialize cleanly but apps.state.simulation_distribution is
   *  not populated; per-app proposal_ready events fire without
   *  distribution data. */
  skipLabSimulation?: boolean;
  /** Sprint W5.2 — pre-computed preflight variable partition shared
   *  across all apps in this batch. When null, the variable-contract
   *  derivation soft-fails to an empty array. */
  variablePartition: PreflightVariables | null;
  /** Sprint W5.2 — goal_id → metric_entity_id lookup for resolving
   *  each app's DV during variable derivation. */
  goalMetricByGoalId: Map<string, string>;
  /** Sprint W5.2.5 — chosen lab_twin (if any). Threaded into
   *  deriveAppVariables so its primary_iv/primary_dv override the
   *  partition's role for those entities. */
  chosenLab: LoadedLab | null;
  /** Sprint W5.3 — mechanism_id → {name, kind} lookup for snapshotting
   *  config.mediator_light on apps with parent_mechanism_id. */
  mechanismMetaById: Map<string, { name: string; kind: string }>;
  /** Sprint W5.8c — edges used for per-app mediator/confounder
   *  scoping inside deriveAppVariables. Empty array disables scoping
   *  (legacy behavior: include the full bucket per app). */
  partitionEdges: Edge[];
}

async function materializeApps(args: MaterializeAppsArgs) {
  const {
    spaceId,
    userId,
    proposals,
    recommendation,
    codeToUuid,
    codeToEntity,
    activeGoalId,
    strategyVersion,
    existingAppByProposalId,
    appSeeds,
    mechanismIdsByProposal,
    db,
    triggeredBy,
    pipelineRunId,
    skipLabSimulation,
    variablePartition,
    goalMetricByGoalId,
    chosenLab,
    mechanismMetaById,
    partitionEdges,
  } = args;

  // Build a perspective → entities map so dominant factors can fall back
  // to perspective-linked entities when a proposal lacks source_components.
  const perspectiveEntities = new Map<string, string[]>(); // perspective → entity codes
  for (const p of recommendation.perspectives ?? []) {
    const codes = [
      ...(p.supporting_entities ?? []),
      ...(p.entity_refs ?? []),
    ];
    perspectiveEntities.set(p.name, codes.filter(Boolean));
  }

  const rowsToUpsert: AppInsert[] = [];

  for (const proposal of proposals) {
    const existing = existingAppByProposalId.get(proposal.id);

    // Resolve dominant entities — prefer proposal.source_components, fall back to perspective
    const sourceCodes = proposal.source_components?.length
      ? proposal.source_components
      : perspectiveEntities.get(proposal.source_perspective) ?? [];

    const dominantUuids: string[] = [];
    const dominantCodes: string[] = [];
    for (const code of sourceCodes) {
      if (!code || code === "NEW") continue;
      dominantCodes.push(code);
      const uuid = codeToUuid.get(code);
      if (uuid) dominantUuids.push(uuid);
    }

    // Build config — preserve any agent-authored fields that live under existing.config
    const priorConfig: AppConfig = existing ? asAppConfig(existing.config) : {};

    // Manifest: preserve an agent-patched manifest if it exists; otherwise
    // generate a type-appropriate default (seeded by a use-case prior when
    // available). Sprint 0 integration — the UI consumes config.manifest,
    // and Sprint 3's agent write-back patches this field via the
    // `apply_agent_patch` action.
    const appType = coerceAppType(proposal.type);
    const priorManifest = priorConfig.manifest;
    const wasAgentPatched =
      priorManifest?.provenance?.produced_by?.startsWith("agent:") ?? false;
    const seedMatch = matchAppSeed(appSeeds, proposal.name, appType);
    const nextManifest: AppManifest = wasAgentPatched && priorManifest
      ? priorManifest // don't clobber agent-authored manifest on regen
      : buildDefaultManifest({
          proposal,
          appType,
          appName: proposal.name,
          recommendation,
          tacticsForApp: [], // clustering runs after app materialization; provenance is a second-pass concern
          seedManifest: seedMatch?.manifest ?? null,
          strategyVersion,
        });

    // ── Reasoning provenance (Phase 6 of strategy rework) ──
    // Compute the union of provenance fields across all tactics that will
    // cluster under this proposal (by source_perspective or dominant entity
    // match), plus the proposal's own infrastructure-map component references.
    // Persist into config.reasoning_provenance — schema-compatible (config is
    // Json), queryable at read-time, preserved across regen.
    const proposalTactics = (recommendation.micro_tactics ?? []).filter((t) => {
      if (t.macro_link && t.macro_link === proposal.source_perspective) return true;
      if (t.entity_id && sourceCodes.includes(t.entity_id)) return true;
      return false;
    });
    const reasoningProvenance = {
      axiom_ids_respected: uniqueStrings(proposalTactics.flatMap((t) => t.axiom_ids_respected ?? [])),
      axiom_ids_challenged: uniqueStrings(proposalTactics.flatMap((t) => t.axiom_ids_challenged ?? [])),
      convergence_ids_addressed: uniqueStrings(proposalTactics.flatMap((t) => t.convergence_ids_addressed ?? [])),
      coverage_gap_ids_closed: uniqueStrings(proposalTactics.flatMap((t) => t.coverage_gap_ids_closed ?? [])),
      inversion_ids_tested: uniqueStrings(proposalTactics.flatMap((t) => t.inversion_ids_tested ?? [])),
      hidden_signal_refs: uniqueStrings(proposalTactics.flatMap((t) => t.hidden_signal_refs ?? [])),
      // Source-tactic IDs so UI can walk back to the specific tactic rows that motivated this app
      source_tactic_ids: proposalTactics.map((t) => t.id).filter(Boolean),
      // Snapshot of strategy-level provenance at generation time
      strategy_provenance_score: recommendation.provenance?.overall_provenance_score,
      strategy_coverage_at_generation: recommendation.provenance?.coverage_pct_at_generation,
    };

    // Sprint W5.2 — variable contract for this specific app. Derived
    // from the shared preflight partition + this app's dominant
    // entities + the goal-metric resolution. Empty array is valid
    // (no partition / no resolvable dominants); legacy reads tolerate
    // absent or empty.
    const appGoalMetricEntityId = activeGoalId
      ? goalMetricByGoalId.get(activeGoalId) ?? null
      : null;
    const variables = variablePartition
      ? deriveAppVariables({
          partition: variablePartition,
          appDominantEntityIds: dominantUuids,
          appGoalMetricEntityId,
          chosenLab,
          // W5.8c — pass edges so mediator/confounder buckets are
          // scoped to entities on this app's IV → DV path.
          edges: partitionEdges,
        })
      : [];

    const config: AppConfig = {
      // agent-authored fields survive regen
      agent_hints: priorConfig.agent_hints ?? [],
      tags: priorConfig.tags,
      theme: priorConfig.theme,
      // fields we regenerate from strategy each run
      tagline: deriveTagline(proposal),
      rationale: proposal.description,
      serves_objectives: deriveServedObjectives(proposal, recommendation),
      channels: deriveChannelsForProposal(proposal, recommendation, codeToEntity),
      surfaced_metrics: (proposal.metrics_tracked ?? []).map((m) => ({ name: m })),
      // Declarative UI + behavior spec — what AppRenderer consumes.
      manifest: nextManifest,
      // Reasoning provenance — backlinks to axioms/convergences/gaps/inversions
      // this app's parent tactics respect/address. Empty arrays are valid.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reasoning_provenance: reasoningProvenance as any,
      // Sprint W5.2 — IV/DV/control/mediator/moderator contract.
      variables,
    };

    // Sprint W5.3 — denormalize the parent mechanism's name + kind onto
    // config.mediator_light so the App detail card can render the
    // mediator without joining the mechanisms table at read time.
    const mechIdsForLight = mechanismIdsByProposal?.get(proposal.id) ?? [];
    const lightMechId = mechIdsForLight.length > 0 ? mechIdsForLight[0] : null;
    if (lightMechId) {
      const meta = mechanismMetaById.get(lightMechId);
      if (meta) {
        config.mediator_light = {
          mechanism_id: lightMechId,
          mechanism_name: meta.name,
          mechanism_kind: meta.kind,
        };
      }
    }

    // Preserve agent-written runtime state; only reset things we own.
    const priorState: AppState = existing ? asAppState(existing.state) : {};
    const state: AppState = {
      headline: priorState.headline,
      health_breakdown: priorState.health_breakdown,
      last_agent_update: priorState.last_agent_update,
      recent_signals: priorState.recent_signals ?? [],
    };

    // Mechanism parent: take the first mechanism row materialized for this
    // proposal (apps as sub-branches of mechanisms). Multi-mechanism
    // proposals: V1 picks the first; future iterations may split apps
    // across mechanisms or re-parent based on widget content.
    const mechIds = mechanismIdsByProposal?.get(proposal.id) ?? [];
    const parentMechanismId = mechIds.length > 0 ? mechIds[0] : null;

    // The `parent_mechanism_id` column was added in 20260509_mechanisms.sql
    // but database.types.ts hasn't been regenerated yet. We cast through
    // unknown to bypass the literal-property check while keeping the field
    // strongly typed at the call site.
    const row: AppInsert = {
      space_id: spaceId,
      user_id: userId,
      name: proposal.name,
      description: proposal.description,
      app_type: coerceAppType(proposal.type),
      source_strategy_version: strategyVersion,
      source_perspective: proposal.source_perspective,
      source_infrastructure_proposal_id: proposal.id,
      dominant_entity_ids: dominantUuids,
      dominant_entity_codes: dominantCodes,
      serves_goal_id: activeGoalId,
      serves_sub_objective_ids: existing?.serves_sub_objective_ids ?? [],
      tracked_metric_tracker_ids: existing?.tracked_metric_tracker_ids ?? [],
      ...({ parent_mechanism_id: parentMechanismId } as unknown as Partial<AppInsert>),
      config: config as unknown as AppInsert["config"],
      state: state as unknown as AppInsert["state"],
      status: existing?.status ?? (proposal.status === "proposed" ? "proposed" : "proposed"),
      health_score: existing?.health_score ?? null,
      priority: proposal.priority ?? 999,
      complexity: coerceComplexity(proposal.complexity),
      last_updated_by: triggeredBy,
      last_refreshed_at: new Date().toISOString(),
      // sub_space_id, stale_reason, stale_since — left to existing or null
      sub_space_id: existing?.sub_space_id ?? null,
      stale_reason: null,
      stale_since: null,
    };

    // If there was a previous id, preserve it so updated_at trigger fires on update
    if (existing?.id) (row as AppInsert & { id?: string }).id = existing.id;

    rowsToUpsert.push(row);
  }

  // Edge case: no proposals — create one umbrella app so the pipeline never
  // produces a strategy without at least one App to surface.
  if (rowsToUpsert.length === 0 && recommendation.title) {
    const fallbackId = `fallback:${stableSlug(recommendation.title)}`;
    const existing = existingAppByProposalId.get(fallbackId);
    const priorConfig: AppConfig = existing ? asAppConfig(existing.config) : {};
    const priorState: AppState = existing ? asAppState(existing.state) : {};

    // Dominant entities = all entity_references from the recommendation, capped.
    const codes = (recommendation.entity_references ?? []).slice(0, 6);
    const uuids = codes
      .map((c) => codeToUuid.get(c))
      .filter((v): v is string => typeof v === "string");

    // Umbrella app gets a dashboard manifest too. Same agent-patched
    // preservation rule as the proposal path.
    const priorUmbrellaManifest = priorConfig.manifest;
    const umbrellaAgentPatched =
      priorUmbrellaManifest?.provenance?.produced_by?.startsWith("agent:") ?? false;
    const umbrellaManifest: AppManifest =
      umbrellaAgentPatched && priorUmbrellaManifest
        ? priorUmbrellaManifest
        : buildDefaultManifest({
            proposal: null,
            appType: "dashboard",
            appName: recommendation.title,
            recommendation,
            tacticsForApp: [],
            seedManifest: null,
            strategyVersion,
          });

    // Sprint W5.2 — derive variables for the umbrella app too, using
    // the recommendation's entity_references as the proxy "dominants."
    const umbrellaGoalMetricEntityId = activeGoalId
      ? goalMetricByGoalId.get(activeGoalId) ?? null
      : null;
    const umbrellaVariables = variablePartition
      ? deriveAppVariables({
          partition: variablePartition,
          appDominantEntityIds: uuids,
          appGoalMetricEntityId: umbrellaGoalMetricEntityId,
          chosenLab,
          edges: partitionEdges,
        })
      : [];

    rowsToUpsert.push({
      space_id: spaceId,
      user_id: userId,
      name: recommendation.title,
      description: recommendation.summary,
      app_type: "dashboard",
      source_strategy_version: strategyVersion,
      source_perspective: null,
      source_infrastructure_proposal_id: fallbackId,
      dominant_entity_ids: uuids,
      dominant_entity_codes: codes,
      serves_goal_id: activeGoalId,
      serves_sub_objective_ids: existing?.serves_sub_objective_ids ?? [],
      tracked_metric_tracker_ids: existing?.tracked_metric_tracker_ids ?? [],
      config: {
        agent_hints: priorConfig.agent_hints ?? [],
        tagline: recommendation.summary,
        rationale: recommendation.summary,
        serves_objectives: recommendation.target_objective
          ? [recommendation.target_objective.title]
          : [],
        manifest: umbrellaManifest,
        variables: umbrellaVariables,
      } as unknown as AppInsert["config"],
      state: priorState as unknown as AppInsert["state"],
      status: existing?.status ?? "proposed",
      health_score: existing?.health_score ?? null,
      priority: 1,
      complexity: "medium",
      last_updated_by: triggeredBy,
      last_refreshed_at: new Date().toISOString(),
      sub_space_id: existing?.sub_space_id ?? null,
      stale_reason: null,
      stale_since: null,
      ...(existing?.id ? { id: existing.id } : {}),
    } as AppInsert);
  }

  if (rowsToUpsert.length === 0) {
    return { apps: [] as AppRow[], created: 0, updated: 0 };
  }

  const { data: upserted, error } = (await db
    .from("apps")
    .upsert(rowsToUpsert, { onConflict: "space_id,source_infrastructure_proposal_id" })
    .select("*")) as { data: AppRow[] | null; error: unknown };

  if (error) {
    throw new Error(`App upsert failed: ${formatError(error)}`);
  }

  const apps = upserted ?? [];
  const existingIds = new Set(
    Array.from(existingAppByProposalId.values()).map((a) => a.id)
  );
  let created = 0;
  let updated = 0;
  for (const a of apps) {
    if (existingIds.has(a.id)) updated++;
    else created++;
  }

  // Wire p10/p50/p90 simulation onto each app's state. Soft-fails per app:
  // if the Monte Carlo subgraph fetch fails or the app has no dominant
  // entity, we simply skip that app. Batched state merge avoids N round
  // trips to PostgREST.
  //
  // Per-app distribution cache used by the proposal_ready emitter below.
  // app.id → { p10, p50, p90, mean, stddev, iterations, targetEntityId }
  // Entries absent for apps with no dominant entity or soft-failed MC —
  // we emit a distribution-less proposal_ready event in that case so
  // the canvas still paints a card.
  const MC_ITERATIONS = 400;
  const perAppDistribution = new Map<
    string,
    {
      p10: number;
      p50: number;
      p90: number;
      mean?: number;
      stddev?: number;
      sampleCount: number;
      targetEntityId: string;
    }
  >();
  // Inline Monte Carlo enrichment is gated by the user's runLab toggle.
  // When false (default for the new strategy-only flow), apps still
  // materialize but skip the ~400-iteration sim that adds
  // simulation_distribution to apps.state. The Lab UI can run on-demand
  // sims later if the user wants them.
  if (apps.length > 0 && !skipLabSimulation) {
    try {
      const { simulateEntityChain } = await import(
        "@/lib/simulation/simulate-entity-chain"
      );
      const now = new Date().toISOString();
      const simResults = await Promise.all(
        apps.map(async (a) => {
          const targetEntityId = (a.dominant_entity_ids ?? [])[0];
          if (!targetEntityId) return { app: a, dist: null };
          try {
            const res = await simulateEntityChain(db, {
              spaceId,
              targetEntityId,
              depthHops: 3,
              iterations: MC_ITERATIONS,
              timesteps: 8,
            });
            return {
              app: a,
              dist: res.targetDistribution,
              gates: res.gateDecisions,
              targetEntityId,
            };
          } catch {
            return { app: a, dist: null, gates: [] };
          }
        }),
      );
      const updates = simResults.filter((r) => r.dist !== null);
      for (const { app: a, dist, gates, targetEntityId } of updates) {
        if (!dist) continue;
        // Persist per-conditional-edge gate verdicts alongside the
        // distribution so the app detail page can render the audit
        // panel without re-running the simulation. Snake-cased on the
        // wire (matches AppState shape conventions); empty arrays are
        // dropped so legacy rows without gates don't grow noise.
        const gateRows = (gates ?? []).map((g) => ({
          source_id: g.sourceId,
          target_id: g.targetId,
          gate: g.gate,
          source: g.source,
          certainty: g.certainty,
          condition_text: g.conditionText,
        }));
        const nextState: AppState = {
          ...asAppState(a.state),
          simulation_distribution: {
            p10: dist.p10,
            p50: dist.p50,
            p90: dist.p90,
            mean: dist.mean,
            stddev: dist.stddev,
            computed_at: now,
            ...(gateRows.length > 0 ? { gate_decisions: gateRows } : {}),
          },
        };
        await db
          .from("apps")
          .update({ state: nextState as unknown as AppInsert["state"] })
          .eq("id", a.id);
        // Mirror onto the in-memory row so the caller / memory indexer
        // sees the enriched state without a second fetch.
        (a as AppRow).state = nextState as unknown as AppRow["state"];
        // Cache distribution for proposal_ready emission downstream.
        if (targetEntityId) {
          perAppDistribution.set(a.id, {
            p10: dist.p10,
            p50: dist.p50,
            p90: dist.p90,
            mean: dist.mean,
            stddev: dist.stddev,
            sampleCount: MC_ITERATIONS,
            targetEntityId,
          });
        }
      }
    } catch (simErr) {
      console.warn("[app-generator] simulation enrichment failed (non-fatal):", simErr);
    }
  }

  // ── Per-app proposal_ready emission ──────────────────────────────────
  //
  // When the caller passed a pipelineRunId (auto-chain from
  // strategy-refresh, or generate-apps route with run context), emit one
  // `proposal_ready` structural event per materialized app so the canvas
  // live-paints per-app proposal-snapshot cards during the run. This
  // replaces the post-hoc batch emit that used to live in the
  // generate-apps route — by emitting from inside the generator we
  // guarantee the MC distribution (when it exists) rides along on the
  // event, not just on apps.state where a page reload would be needed
  // to see it.
  //
  // Soft-fail: emission failures are non-fatal. Apps still land in the
  // DB; users just won't see per-app cards flash during this run.
  if (pipelineRunId && apps.length > 0) {
    try {
      const { emitBatchEvents } = await import(
        "@/lib/events/structural-event-bus"
      );
      const { loadLatestSpaceAxisIndex, resolveAxesForNames, runLevelAxes } =
        await import("@/lib/pipeline/axes-used-resolver");
      const axisIndex = await loadLatestSpaceAxisIndex(db, spaceId).catch(
        () => null,
      );
      const spaceRunAxes = axisIndex ? runLevelAxes(axisIndex) : [];
      const entityIdToName = new Map<string, string>();
      for (const [code, uuid] of codeToUuid.entries()) {
        const e = codeToEntity.get(code);
        if (uuid && e?.name) entityIdToName.set(uuid, e.name);
      }

      const events: StructuralEvent[] = apps.map((a, idx) => {
        const dist = perAppDistribution.get(a.id);
        const cfg = asAppConfig(a.config);
        const tagline =
          typeof cfg.tagline === "string" ? cfg.tagline : null;

        // Chain node names — dominant entity UUIDs → names.
        const names: string[] = [];
        for (const id of a.dominant_entity_ids ?? []) {
          const n = entityIdToName.get(id);
          if (n && !names.includes(n)) names.push(n);
        }
        const perAppAxes = axisIndex
          ? resolveAxesForNames(names, axisIndex)
          : [];
        const axesUsed = perAppAxes.length > 0 ? perAppAxes : spaceRunAxes;
        const chain =
          names.length > 0
            ? {
                nodeNames: names.slice(0, 6),
                shortId: `E-${idx + 1}`,
              }
            : undefined;

        return {
          type: "proposal_ready",
          proposalId: a.id,
          kind: "experiment",
          title: (a.name ?? "App").slice(0, 200),
          ...(tagline ? { headline: tagline.slice(0, 220) } : {}),
          ...(dist
            ? {
                distribution: {
                  p10: dist.p10,
                  p50: dist.p50,
                  p90: dist.p90,
                  ...(dist.mean !== undefined ? { mean: dist.mean } : {}),
                  ...(dist.stddev !== undefined
                    ? { stddev: dist.stddev }
                    : {}),
                  provenance: "mc_simulation",
                  sampleCount: dist.sampleCount,
                },
                targetEntityId: dist.targetEntityId,
              }
            : {}),
          ...(axesUsed.length > 0 ? { axes_used: axesUsed } : {}),
          ...(chain ? { chain } : {}),
        };
      });

      if (events.length > 0) {
        await emitBatchEvents(db, pipelineRunId, events);
      }
    } catch (emitErr) {
      console.warn(
        "[app-generator] proposal_ready emission failed (non-fatal):",
        emitErr,
      );
    }
  }

  // Wave C — activate the 'app' memory kind. buildAppInput has existed
  // since Sprint 2 but no write path invoked it; apps never landed in
  // ambient retrieval. Now every materialized/upserted app gets indexed.
  // Non-fatal — app upsert is the primary work.
  if (apps.length > 0) {
    try {
      const { upsertMemoryItemsBatch, buildAppInput } = await import(
        "@/lib/memory/writer"
      );
      const firstUserId = apps[0].user_id;
      await upsertMemoryItemsBatch(
        db,
        apps.map((a) =>
          buildAppInput(a.user_id ?? firstUserId, {
            id: a.id,
            name: a.name,
            description: a.description,
          }),
        ),
      );
    } catch (memErr) {
      console.warn("[app-generator] memory index failed (non-fatal):", memErr);
    }
  }

  return { apps, created, updated };
}

// ── Intervention materialization + clustering ─────────────────────────

interface MaterializeInterventionsArgs {
  spaceId: string;
  userId: string;
  tactics: MicroTactic[];
  apps: AppRow[];
  codeToUuid: Map<string, string>;
  strategyVersion: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
}

async function materializeInterventions(args: MaterializeInterventionsArgs) {
  const { spaceId, userId, tactics, apps, codeToUuid, strategyVersion, db } = args;

  // Load existing interventions to count updates vs creates.
  const { data: existingInts } = (await db
    .from("interventions")
    .select("id, source_tactic_id")
    .eq("space_id", spaceId)) as {
    data: Array<Pick<InterventionRow, "id" | "source_tactic_id">> | null;
  };
  const existingByTacticId = new Map<string, string>();
  for (const r of existingInts ?? []) {
    if (r.source_tactic_id) existingByTacticId.set(r.source_tactic_id, r.id);
  }

  // Build indexes for clustering.
  // App matching priority:
  //   (1) dominant_entity_ids contains tactic's target entity UUID
  //   (2) source_perspective === tactic.macro_link
  //   (3) first app (single-app edge case)
  const appByEntityUuid = new Map<string, string[]>(); // entity_uuid → app_ids
  for (const a of apps) {
    for (const uuid of a.dominant_entity_ids ?? []) {
      const bucket = appByEntityUuid.get(uuid);
      if (bucket) bucket.push(a.id);
      else appByEntityUuid.set(uuid, [a.id]);
    }
  }
  const appByPerspective = new Map<string, string>(); // perspective → app_id (first match)
  for (const a of apps) {
    if (a.source_perspective && !appByPerspective.has(a.source_perspective)) {
      appByPerspective.set(a.source_perspective, a.id);
    }
  }

  const rowsToUpsert: InterventionInsert[] = [];
  let orphans = 0;

  for (const t of tactics) {
    const targetUuid = codeToUuid.get(t.entity_id);

    // Cluster to app
    let appId: string | null = null;
    if (targetUuid) {
      const bucket = appByEntityUuid.get(targetUuid);
      if (bucket && bucket.length > 0) appId = bucket[0];
    }
    if (!appId && t.macro_link) {
      appId = appByPerspective.get(t.macro_link) ?? null;
    }
    if (!appId && apps.length === 1) {
      appId = apps[0].id;
    }
    if (!appId) orphans++;

    rowsToUpsert.push({
      space_id: spaceId,
      user_id: userId,
      source_tactic_id: t.id,
      source_strategy_version: strategyVersion,
      title: t.title,
      description: t.description,
      target_entity_id: targetUuid ?? null,
      target_entity_code: t.entity_id,
      macro_link: t.macro_link,
      infrastructure_action: t.infrastructure_action ?? null,
      priority: t.priority ?? 999,
      effort: t.effort,
      impact: t.impact,
      timeframe: t.timeframe,
      metric_name: t.metric?.name ?? null,
      metric_target: t.metric?.target ?? null,
      metric_unit: t.metric?.unit ?? null,
      status: "proposed",
      app_id: appId,
      depends_on_intervention_ids: [], // filled in a second pass (dependencies use tactic ids, not intervention uuids)
      implementation_trigger: t.implementation_intention?.trigger ?? null,
      implementation_action: t.implementation_intention?.action ?? null,
      implementation_category: t.implementation_intention?.category ?? null,
    });
  }

  if (rowsToUpsert.length === 0) {
    return {
      interventions: [] as InterventionRow[],
      created: 0,
      updated: 0,
      orphans: 0,
    };
  }

  const { data: upserted, error } = (await db
    .from("interventions")
    .upsert(rowsToUpsert, { onConflict: "space_id,source_tactic_id" })
    .select("*")) as { data: InterventionRow[] | null; error: unknown };

  if (error) {
    throw new Error(`Intervention upsert failed: ${formatError(error)}`);
  }

  const interventions = upserted ?? [];

  // ── Second pass: resolve depends_on (tactic ids → intervention uuids) ─
  const tacticIdToIntId = new Map<string, string>();
  for (const iv of interventions) {
    if (iv.source_tactic_id) tacticIdToIntId.set(iv.source_tactic_id, iv.id);
  }

  const depUpdates: Array<{ id: string; depends_on_intervention_ids: string[] }> = [];
  for (const t of tactics) {
    const intId = tacticIdToIntId.get(t.id);
    if (!intId) continue;
    const deps = (t.dependencies ?? [])
      .map((dep) => tacticIdToIntId.get(dep))
      .filter((v): v is string => typeof v === "string");
    if (deps.length > 0) {
      depUpdates.push({ id: intId, depends_on_intervention_ids: deps });
    }
  }

  if (depUpdates.length > 0) {
    // Parallel single-row updates — Supabase doesn't bulk-update non-upsert rows cleanly.
    await Promise.all(
      depUpdates.map((u) =>
        db
          .from("interventions")
          .update({ depends_on_intervention_ids: u.depends_on_intervention_ids })
          .eq("id", u.id)
      )
    );
  }

  let created = 0;
  let updated = 0;
  for (const iv of interventions) {
    if (iv.source_tactic_id && existingByTacticId.has(iv.source_tactic_id)) updated++;
    else created++;
  }

  return { interventions, created, updated, orphans };
}

// ── App version audit ─────────────────────────────────────────────────

interface RecordAppVersionsArgs {
  apps: AppRow[];
  existingAppByProposalId: Map<string, AppRow>;
  triggeredBy: string;
  strategyVersion: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
}

async function recordAppVersions(args: RecordAppVersionsArgs) {
  const { apps, existingAppByProposalId, triggeredBy, strategyVersion, db } = args;

  // Fetch current max version per app so we can increment
  const appIds = apps.map((a) => a.id);
  const { data: maxVerRows } = (await db
    .from("app_versions")
    .select("app_id, version")
    .in("app_id", appIds)
    .order("version", { ascending: false })) as {
    data: Array<{ app_id: string; version: number }> | null;
  };
  const maxByApp = new Map<string, number>();
  for (const r of maxVerRows ?? []) {
    if (!maxByApp.has(r.app_id) || r.version > (maxByApp.get(r.app_id) ?? 0)) {
      maxByApp.set(r.app_id, r.version);
    }
  }

  const rows: AppVersionInsert[] = apps.map((a) => {
    const wasExisting = Array.from(existingAppByProposalId.values()).some(
      (e) => e.id === a.id
    );
    return {
      app_id: a.id,
      version: (maxByApp.get(a.id) ?? 0) + 1,
      config_snapshot: a.config,
      state_snapshot: a.state,
      change_summary: wasExisting
        ? `Regenerated from strategy v${strategyVersion ?? "?"}`
        : `Generated from strategy v${strategyVersion ?? "?"}`,
      change_type: wasExisting ? "pipeline_regen" : "generated",
      changed_by: triggeredBy,
      change_payload: {
        source_infrastructure_proposal_id: a.source_infrastructure_proposal_id,
        strategy_version: strategyVersion,
      } as unknown as AppVersionInsert["change_payload"],
    };
  });

  const { error } = (await db.from("app_versions").insert(rows)) as { error: unknown };
  if (error) {
    // Non-blocking — audit write failures shouldn't break generation
    console.warn("[app-generator] app_versions insert failed:", formatError(error));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Dedup + sort string array; filters out empty/null entries. */
function uniqueStrings(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((s) => typeof s === "string" && s.length > 0))).sort();
}

function coerceAppType(t: InfrastructureProposal["type"]): AppType {
  switch (t) {
    case "app":
    case "dashboard":
      return "dashboard";
    case "tool":
      return "tool";
    case "workflow":
      return "workflow";
    case "monitor":
      return "monitor";
    case "integration":
      return "integration";
    default:
      return "dashboard";
  }
}

function coerceComplexity(c: InfrastructureProposal["complexity"]): AppComplexity {
  return c === "low" || c === "medium" || c === "high" ? c : "medium";
}

function deriveTagline(p: InfrastructureProposal): string {
  // Short, user-facing one-liner. Prefers a trimmed description, else name.
  if (p.description) {
    const first = p.description.split(/[.!?]/)[0]?.trim();
    if (first && first.length <= 140) return first;
  }
  return p.name;
}

function deriveServedObjectives(
  p: InfrastructureProposal,
  rec: StrategicRecommendation
): string[] {
  const served: string[] = [];
  if (rec.target_objective?.title) served.push(rec.target_objective.title);
  // Perspective objective, if this app belongs to a perspective.
  const persp = rec.perspectives?.find((x) => x.name === p.source_perspective);
  if (persp?.objective) served.push(persp.objective);
  return Array.from(new Set(served));
}

function deriveChannelsForProposal(
  p: InfrastructureProposal,
  rec: StrategicRecommendation,
  codeToEntity: Map<string, Entity>
): AppConfig["channels"] {
  // Pull channels from infrastructure_map whose endpoints are in this proposal's source_components.
  const relevant = p.source_components ?? [];
  const relevantSet = new Set(relevant);
  const channels: AppConfig["channels"] = [];
  for (const ch of rec.infrastructure_map?.key_channels ?? []) {
    if (relevantSet.has(ch.from) || relevantSet.has(ch.to)) {
      channels.push({
        from: codeToEntity.get(ch.from)?.name ?? ch.from,
        to: codeToEntity.get(ch.to)?.name ?? ch.to,
        description: ch.description,
      });
    }
  }
  return channels;
}

/**
 * For each App without a sub_space_id, create a child space that serves as
 * its per-app whiteboard. Runs once per app (idempotent) and updates
 * apps.sub_space_id on success.
 *
 * Sub-space fields are minimal — it exists to anchor the whiteboard and
 * carry its own entities/edges if the user drags ideas into it.
 */
interface EnsureAppSubSpacesArgs {
  apps: AppRow[];
  parentSpaceId: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
}

async function ensureAppSubSpaces(args: EnsureAppSubSpacesArgs): Promise<void> {
  const needs = args.apps.filter((a) => !a.sub_space_id);
  if (needs.length === 0) return;

  // Load parent to derive space_prefix + depth_level.
  const { data: parent } = await args.db
    .from("spaces")
    .select("id, space_prefix, depth_level, name")
    .eq("id", args.parentSpaceId)
    .maybeSingle();

  const parentPrefix =
    (parent?.space_prefix as string | undefined) ?? "C";
  const parentDepth = (parent?.depth_level as number | undefined) ?? 0;

  for (const app of needs) {
    try {
      const subSpacePrefix = `${parentPrefix}.${stableSlug(app.name).slice(0, 12)}`;
      const { data: inserted } = await args.db
        .from("spaces")
        .insert({
          user_id: args.userId,
          name: `${app.name} — canvas`,
          description: `Per-app whiteboard for ${app.name}. Brainstorm, capture signals, and feed changes back into the app.`,
          space_prefix: subSpacePrefix,
          parent_space_id: args.parentSpaceId,
          depth_level: parentDepth + 1,
          input_text:
            typeof (app.config as Record<string, unknown>)?.tagline === "string"
              ? ((app.config as Record<string, unknown>).tagline as string)
              : app.description ?? app.name,
          analysis_tier: "quick",
        })
        .select("id")
        .single();

      if (inserted?.id) {
        await args.db
          .from("apps")
          .update({ sub_space_id: inserted.id as string })
          .eq("id", app.id);
      }
    } catch (err) {
      // Non-blocking: the whiteboard route falls back to the parent space's
      // data when sub_space_id is null, so app still works without a sub-space.
      console.warn(
        `[app-generator] sub-space creation failed for app ${app.id}:`,
        err
      );
    }
  }
}

/**
 * Find the best matching AppSeed for a given proposal.
 * Strategy:
 *   1. Exact type match + fuzzy name overlap (>=1 shared significant token).
 *   2. Exact type match (any).
 *   3. null — fall back to the type-based default manifest.
 */
function matchAppSeed(
  seeds: AppSeed[],
  proposalName: string,
  appType: AppType
): AppSeed | null {
  if (seeds.length === 0) return null;

  const sameType = seeds.filter((s) => s.app_type === appType);
  if (sameType.length === 0) return null;

  const nameTokens = tokenize(proposalName);
  let best: { seed: AppSeed; score: number } | null = null;
  for (const seed of sameType) {
    const seedTokens = tokenize(seed.name);
    const overlap = countOverlap(nameTokens, seedTokens);
    if (overlap > 0 && (!best || overlap > best.score)) {
      best = { seed, score: overlap };
    }
  }
  if (best) return best.seed;

  // No name overlap → fall back to first same-type seed so authored priors
  // still win over generic defaults.
  return sameType[0];
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s_\-/&]+/)
      .filter((t) => t.length >= 4) // skip stopwords / short tokens
  );
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function stableSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatError(err: unknown): string {
  if (!err) return "unknown";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

// Unused type export surface
export type { AppUpdate };
