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
  /** DB client — caller passes an authenticated supabase client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database> | any;
  /** Who triggered this generation — 'pipeline:strategy-refresh' typical. */
  triggeredBy: string;
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
    db,
    triggeredBy,
  } = input;

  // Code (e.g. "C1", "X3") → entities table UUID lookup.
  const codeToUuid = new Map<string, string>();
  const codeToEntity = new Map<string, Entity>();
  for (const e of entities) {
    codeToUuid.set(e.entity_id, e.id);
    codeToEntity.set(e.entity_id, e);
  }

  // Pull proposals from top-ranked strategy. Fall back to empty list — we still
  // want to materialize interventions even when proposals are missing.
  const proposals: InfrastructureProposal[] =
    rankedStrategies?.[0]?.infrastructure_proposals ?? [];

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
    db,
    triggeredBy,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  triggeredBy: string;
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
    db,
    triggeredBy,
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
    };

    // Preserve agent-written runtime state; only reset things we own.
    const priorState: AppState = existing ? asAppState(existing.state) : {};
    const state: AppState = {
      headline: priorState.headline,
      health_breakdown: priorState.health_breakdown,
      last_agent_update: priorState.last_agent_update,
      recent_signals: priorState.recent_signals ?? [],
    };

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
