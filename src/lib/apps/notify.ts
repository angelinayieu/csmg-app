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
