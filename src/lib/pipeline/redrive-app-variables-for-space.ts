// ── Re-drive AppConfig.variables for a whole space (W5.7c) ──────────
//
// Purpose:
//   When something upstream invalidates an app's variable contract —
//   lab pick changed, preflight overrides edited, strategy regen —
//   this helper re-runs the same derivation generate-apps would do at
//   creation time, but against existing apps that are already in the
//   DB. The result: apps.config.variables stays consistent with the
//   user's latest choices without forcing a full strategy regen.
//
// First consumer: src/app/api/spaces/[id]/lab/select/route.ts. After
// the lab pick flips and flagAllAppsInSpace marks the apps stale with
// reason='lab_regen', we call this helper to actually update the
// variables on each app (the staleness flag alone is cosmetic — the
// downstream UI shows "Tune variable: …" with the OLD lab's IV/DV
// otherwise).
//
// Why not just trigger a regen?
//   Regen rebuilds entire app rows including manifest, state, etc.
//   That's overkill for "user changed which lab they want" — the apps
//   themselves are still valid; only the variable contract role
//   assignments need to update. This helper is a surgical refresh:
//   one UPDATE per app, only touching config.variables.
//
// Cascade integrity:
//   Soft-fails per app. A failure on app N doesn't block app N+1.
//   Caller logs at the cascade-emitter level; this helper returns a
//   { updated, errors } tally so the route can surface metrics.
//
// Idempotent:
//   Running this twice in a row yields the same result. The
//   derivation is pure given the same inputs (partition + chosen lab +
//   per-app dominants).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Entity } from "@/types";
import type { Edge } from "@/types";
import type { ImprovementGoal } from "@/types/goals";
import type { AppRow, AppConfig } from "@/types/app";
import type {
  PreflightVariables,
  PreflightOverride,
} from "@/types/preflight";
import type { VariableRole } from "@/types/variable-proposals";
import { partitionVariablesByRole } from "@/lib/preflight/partition-variables-by-role";
import { deriveAppVariables } from "./derive-app-variables";
import { loadChosenLabForSpace } from "./load-chosen-lab";
import { asAppConfig } from "@/types/app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<Database> | any;

export interface RedriveResult {
  /** How many apps had their config.variables updated. */
  updated: number;
  /** How many apps were skipped (no dominants resolvable, retired, etc.). */
  skipped: number;
  /** Per-app errors, if any. Empty array on the happy path. */
  errors: Array<{ app_id: string; reason: string }>;
}

/**
 * Re-derive AppConfig.variables for every app in a space, using the
 * latest partition + chosen lab + mechanism mappings.
 *
 * Always best-effort. Caller does NOT roll back when this returns
 * errors — the cascade is downstream of the upstream change.
 */
export async function redriveAppVariablesForSpace(
  db: AnyDb,
  spaceId: string,
  userId: string,
): Promise<RedriveResult> {
  const result: RedriveResult = { updated: 0, skipped: 0, errors: [] };

  // ── 1. Fetch the same five inputs the partition needs ────────────
  let entities: Entity[] = [];
  let edges: Edge[] = [];
  let goals: ImprovementGoal[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let variableProposalRows: Array<any> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let overrideRows: Array<any> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let observationRows: Array<any> = [];

  try {
    const [entRes, edgeRes, goalRes, vpRes, ovRes, obsRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
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
    entities = (entRes?.data ?? []) as Entity[];
    edges = (edgeRes?.data ?? []) as Edge[];
    goals = (goalRes?.data ?? []) as ImprovementGoal[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variableProposalRows = (vpRes?.data ?? []) as Array<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    overrideRows = (ovRes?.data ?? []) as Array<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    observationRows = (obsRes?.data ?? []) as Array<any>;
  } catch (err) {
    result.errors.push({
      app_id: "<prefetch>",
      reason: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  // ── 2. Compute the partition once ────────────────────────────────
  const variableProposals = variableProposalRows.map((vp) => ({
    entity_id: vp.entity_id as string,
    variable_role: vp.variable_role as VariableRole,
  }));
  const overrides: PreflightOverride[] = overrideRows.map((o) => ({
    override_id: o.id as string,
    override_kind:
      (o.override_kind ?? "reclassify_variable") as PreflightOverride["override_kind"],
    target_id: (o.target_id ?? "") as string,
    value: o.override_value,
    applied_at: o.created_at as string,
    applied_by: (o.created_by ?? userId) as string,
    reasoning: (o.reasoning ?? null) as string | null,
  }));
  const metricObservations = observationRows.map((m) => ({
    metric_entity_id: m.metric_entity_id as string,
    value: m.value as string | number | null,
    recorded_at: m.recorded_at as string,
  }));

  // W6.8 — canonical_code lookup for partition entries.
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
    } catch {
      // Non-fatal — badges just render without the code link.
    }
  }

  let partition: PreflightVariables;
  try {
    partition = partitionVariablesByRole({
      entities,
      edges,
      goals,
      variableProposals,
      overrides,
      metricObservations,
      canonicalCodeById,
    });
  } catch (err) {
    result.errors.push({
      app_id: "<partition>",
      reason: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  // ── 3. Build goal_id → metric_entity_id map ──────────────────────
  const goalMetricByGoalId = new Map<string, string>();
  for (const g of goals) {
    const metricEntityId = g.metric_entity_id ?? null;
    if (metricEntityId) goalMetricByGoalId.set(g.id, metricEntityId);
  }

  // ── 4. Load chosen lab (W5.2.5 — overrides partition role assigns) ─
  const chosenLab = await loadChosenLabForSpace(db, spaceId, userId);

  // ── 5. Fetch apps to re-derive + iterate ─────────────────────────
  let apps: AppRow[] = [];
  try {
    const { data: appRows } = (await db
      .from("apps")
      .select("id, dominant_entity_ids, serves_goal_id, config, status")
      .eq("space_id", spaceId)
      .neq("status", "retired")) as { data: AppRow[] | null };
    apps = appRows ?? [];
  } catch (err) {
    result.errors.push({
      app_id: "<app-fetch>",
      reason: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  for (const app of apps) {
    try {
      const dominantUuids = (app.dominant_entity_ids ?? []) as string[];
      const appGoalMetricEntityId = app.serves_goal_id
        ? goalMetricByGoalId.get(app.serves_goal_id) ?? null
        : null;

      const newVariables = deriveAppVariables({
        partition,
        appDominantEntityIds: dominantUuids,
        appGoalMetricEntityId,
        chosenLab,
        // W5.8c — pass edges for per-app mediator/confounder scoping.
        edges,
      });

      // Merge into the existing config so we don't clobber manifest,
      // mediator_light, agent_hints, etc. The asAppConfig narrow + spread
      // is what app-generator does at write time.
      const priorConfig: AppConfig = asAppConfig(app.config);
      const nextConfig: AppConfig = {
        ...priorConfig,
        variables: newVariables,
      };

      const { error } = await db
        .from("apps")
        .update({
          config: nextConfig as unknown as AppRow["config"],
          updated_at: new Date().toISOString(),
        })
        .eq("id", app.id);

      if (error) {
        result.errors.push({
          app_id: app.id,
          reason: (error as { message?: string }).message ?? "update failed",
        });
        continue;
      }
      result.updated += 1;
    } catch (err) {
      result.errors.push({
        app_id: app.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
