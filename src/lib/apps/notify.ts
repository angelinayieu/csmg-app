/**
 * Wave B — notification hooks for mutation sites.
 *
 * Thin wrappers over staleness-triggers that each mutation path can
 * call without having to know:
 *   (a) which tables to query,
 *   (b) how to cascade through entity_objectives (Wave A), OR
 *   (c) what stale_reason is appropriate.
 *
 * One line per mutation path, all soft-fail, all non-blocking. Rule of
 * thumb when a new mutation site is added:
 *   - If you created/modified entities → `notifyEntitiesChanged()`
 *   - If you wrote a metric_observation → `notifyMetricObserved()`
 *   - If you flipped a goal's status → `notifyGoalChanged()`
 *   - If you ran strategy-refresh → `notifyStrategyRegenerated()`
 *   - If you edited a whiteboard that touches entities →
 *     `notifyWhiteboardEdited()`
 */

import {
  flagAppsByEntityChange,
  flagAppsByEntityChangeViaObjectives,
  flagAppsByGoalChange,
  flagAppsByMetricChange,
  flagAllAppsInSpace,
} from "./staleness-triggers";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any> | any;

/**
 * Entity create/update/delete touched `entityUuids` in `spaceId`.
 * Runs two cascades:
 *   1. Direct: apps with dominant_entity_ids ⊃ entityUuids.
 *   2. Via objectives (Wave A): entity_objectives → goal → apps.serves_goal.
 * Both contribute to the final flag set; same stale_reason is used.
 *
 * `source` is a short identifier like "pipeline:decompose", "user:deepen",
 * "agent:researcher" — gets stamped into apps.last_updated_by.
 */
export async function notifyEntitiesChanged(
  db: DB,
  spaceId: string,
  entityUuids: string[],
  source: string,
  reason: "kg_changed" | "whiteboard_edit" = "kg_changed",
): Promise<{ direct: number; via_objectives: number }> {
  const [direct, viaObj] = await Promise.all([
    flagAppsByEntityChange(
      db,
      spaceId,
      entityUuids,
      reason,
      source,
      `${entityUuids.length} entities changed (direct)`,
    ),
    flagAppsByEntityChangeViaObjectives(
      db,
      entityUuids,
      reason,
      source,
      `${entityUuids.length} entities changed (via objectives)`,
    ),
  ]);
  return {
    direct: direct.flagged_count,
    via_objectives: viaObj.flagged_count,
  };
}

/**
 * Cascade-aware variant of notifyEntitiesChanged. Extends the staleness
 * set by walking the causal edge graph downstream from each direct
 * entity, then unions those reach UUIDs into the notify call.
 *
 * Why this matters: notifyEntitiesChanged alone only flags apps that
 * DIRECTLY depend on the changed entities. But each changed entity
 * also propagates causally to everything downstream — apps depending
 * on those 2-N hop downstream entities should also be flagged so the
 * stale chip matches the actual blast radius of the change.
 *
 * Use this from any mutation site that can trigger downstream effects
 * (decompose, ingest extract, entity deepen, manual edit). Soft-fails
 * the cascade compute (degrades to direct-only flagging) so a graph
 * read failure never blocks the underlying mutation.
 *
 * Caller passes UUIDs only — display IDs are looked up internally from
 * the entities snapshot we have to fetch anyway for cascade propagation.
 * Optionally pass `entityDisplayIds` to skip the lookup (caller already
 * has them at hand, e.g. from an entityIdMap).
 */
export async function notifyEntitiesChangedWithCascade(
  db: DB,
  spaceId: string,
  entityDirectUuids: string[],
  source: string,
  opts: {
    /** Display IDs ("C1", "X3", etc.) for the direct UUIDs. When omitted,
     *  derived from the fetched entities snapshot. */
    entityDisplayIds?: string[];
    /** Stale reason. Default "kg_changed". */
    reason?: "kg_changed" | "whiteboard_edit";
    /** Max seed entities to walk cascade from (default 25). */
    maxSeeds?: number;
  } = {},
): Promise<{
  direct: number;
  via_objectives: number;
  cascade_extended: number;
}> {
  const allAffectedUuids = new Set<string>(entityDirectUuids);
  let cascadeExtended = 0;
  const maxSeeds = opts.maxSeeds ?? 25;
  const reason = opts.reason ?? "kg_changed";

  try {
    const { computeCascadeFromEntity } = await import(
      "@/lib/twin/cascade-propagation"
    );
    const [
      { data: allEnts },
      { data: allEdgs },
      { data: allCycs },
    ] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ents = (allEnts ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgs = (allEdgs ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cycs = (allCycs ?? []) as any[];

    // Resolve display IDs. Caller-supplied wins; otherwise derive from
    // the snapshot we just fetched (UUID → display via entity row lookup).
    let seeds: string[];
    if (opts.entityDisplayIds && opts.entityDisplayIds.length > 0) {
      seeds = opts.entityDisplayIds.slice(0, maxSeeds);
    } else {
      const directUuidSet = new Set(entityDirectUuids);
      seeds = ents
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((e: any) => directUuidSet.has(e.id) && typeof e.entity_id === "string")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((e: any) => e.entity_id as string)
        .slice(0, maxSeeds);
    }

    for (const displayId of seeds) {
      const cascade = computeCascadeFromEntity(displayId, ents, edgs, cycs);
      for (const hit of cascade.affected_entities) {
        if (!allAffectedUuids.has(hit.entity_uuid)) {
          allAffectedUuids.add(hit.entity_uuid);
          cascadeExtended++;
        }
      }
    }
  } catch (cascadeErr) {
    console.warn(
      "[notify/cascade] reach computation failed (non-fatal, falling back to direct-only flagging):",
      cascadeErr,
    );
  }

  const flagged = await notifyEntitiesChanged(
    db,
    spaceId,
    Array.from(allAffectedUuids),
    source,
    reason,
  );
  return {
    direct: flagged.direct,
    via_objectives: flagged.via_objectives,
    cascade_extended: cascadeExtended,
  };
}

/**
 * A metric_observations row was written for `trackerId`. Flag every app
 * tracking that metric so its health_score gets re-evaluated.
 */
export async function notifyMetricObserved(
  db: DB,
  trackerId: string,
  source: string,
): Promise<number> {
  const res = await flagAppsByMetricChange(
    db,
    trackerId,
    "new_research",
    source,
    "New metric observation recorded",
  );
  return res.flagged_count;
}

/**
 * Goal status changed. Flag every app that serves the goal (direct or
 * via sub-objectives).
 *
 * If the transition is 'proposed' → 'active' (Wave A approve), we use
 * stale_reason='strategy_regen' since the goal activating implies the
 * user just committed to a new piece of strategy. Other transitions
 * use 'user_feedback'.
 */
export async function notifyGoalChanged(
  db: DB,
  goalId: string,
  transition: "proposed_to_active" | "active_to_paused" | "rejected" | "abandoned" | "achieved",
  source: string,
): Promise<number> {
  const reason =
    transition === "proposed_to_active" ? "strategy_regen" : "user_feedback";
  const res = await flagAppsByGoalChange(
    db,
    goalId,
    reason,
    source,
    `Goal ${transition.replace(/_/g, " ")}`,
  );
  return res.flagged_count;
}

/**
 * Strategy was regenerated. generate-apps/route.ts already upserts apps
 * and effectively resets staleness on its own outputs. This hook exists
 * for CROSS-space cascades — if your strategy regen affects sub-spaces
 * (agents, linked spaces), those apps need flagging too.
 *
 * Conservative: flags all apps in the space. Callers who only want
 * targeted flagging should use flagAppsByEntityChange with the entities
 * that actually shifted.
 */
export async function notifyStrategyRegenerated(
  db: DB,
  spaceId: string,
  source: string,
): Promise<number> {
  const res = await flagAllAppsInSpace(
    db,
    spaceId,
    "strategy_regen",
    source,
    "Strategy regenerated",
  );
  return res.flagged_count;
}

/**
 * A whiteboard edit happened that may affect entities. Thin alias —
 * same as notifyEntitiesChanged but with stale_reason='whiteboard_edit'
 * so the staleness badge can show the correct cause.
 */
export async function notifyWhiteboardEdited(
  db: DB,
  spaceId: string,
  entityUuids: string[],
  source: string,
): Promise<{ direct: number; via_objectives: number }> {
  return notifyEntitiesChanged(db, spaceId, entityUuids, source, "whiteboard_edit");
}
