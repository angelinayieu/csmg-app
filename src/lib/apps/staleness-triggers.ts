// Staleness triggers — upstream events → dependent apps flagged for refresh.
//
// The single chokepoint every upstream writer (whiteboard edits, research
// loop, reasoning agents, critique) calls when it has changed something the
// apps may care about. The trigger does the work of finding *which* apps
// depend on the changed entities and flagging only those.
//
// Why this lives in its own file (not app-updates.ts): it encodes the
// *dependency topology* between KG changes and Apps, which is conceptually
// separate from the patch primitives. Keeping the wiring here means when a
// new upstream source appears, we only add a call here, not spread logic
// across patch helpers.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AppStaleReason, AppState } from "@/types/app";
import { markAppsStale, appendAppSignal } from "./app-updates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

interface FlagResult {
  flagged_count: number;
  flagged_app_ids: string[];
}

/**
 * Given a set of entity UUIDs that just changed, find every non-retired App
 * in the space whose `dominant_entity_ids` intersects that set, and mark
 * those apps stale.
 *
 * Performance: uses the GIN index on `apps.dominant_entity_ids` via the
 * Supabase `overlaps` operator (`@>` / `&&`).
 *
 * Soft-fail semantics: this is an audit/side-effect trigger. It logs and
 * returns 0 on failure rather than throwing, so upstream writers (edge
 * accept, research, etc.) are never blocked by an apps failure.
 */
export async function flagAppsByEntityChange(
  db: DB,
  spaceId: string,
  entityUuids: string[],
  reason: AppStaleReason,
  changedBy: string,
  summary?: string
): Promise<FlagResult> {
  if (!spaceId || entityUuids.length === 0) {
    return { flagged_count: 0, flagged_app_ids: [] };
  }

  // Dedupe + drop falsy
  const unique = Array.from(
    new Set(entityUuids.filter((v): v is string => typeof v === "string" && v.length > 0))
  );
  if (unique.length === 0) return { flagged_count: 0, flagged_app_ids: [] };

  try {
    // Find apps whose dominant_entity_ids array overlaps the changed entities.
    // PostgREST `overlaps` uses `&&` under the hood.
    const { data: apps, error } = await db
      .from("apps")
      .select("id, name")
      .eq("space_id", spaceId)
      .neq("status", "retired")
      .overlaps("dominant_entity_ids", unique);

    if (error) {
      console.warn("[staleness] flagAppsByEntityChange query failed:", error);
      return { flagged_count: 0, flagged_app_ids: [] };
    }

    const matchedApps = (apps ?? []) as Array<{ id: string; name: string }>;
    if (matchedApps.length === 0) {
      return { flagged_count: 0, flagged_app_ids: [] };
    }

    const appIds = matchedApps.map((a) => a.id);
    const marked = await markAppsStale(
      db,
      appIds,
      reason,
      changedBy,
      summary ?? `${reason}: ${unique.length} upstream ${unique.length === 1 ? "entity" : "entities"} changed`
    );

    // Tier 6: cascade staleness to sub-strategies whose entity_refs
    // overlap the changed entity set. Mirrors the apps path: same
    // `overlaps` query against the new app_strategies.entity_refs GIN
    // index. We don't transition sub-strategy status (that's reserved
    // for draft/active/superseded/archived); instead we insert a
    // "stale" change-log entry into app_strategy_versions so the panel
    // surfaces "X entities changed since this spec was generated;
    // consider regenerating."
    //
    // Soft-fail — a sub-strategy flag failure shouldn't roll back the
    // app flagging that already succeeded.
    let substrategiesFlagged = 0;
    try {
      const { data: staleSubRows } = await db
        .from("app_strategies")
        .select("id, app_id")
        .eq("space_id", spaceId)
        .eq("status", "active")
        .overlaps("entity_refs", unique);

      const staleRows = (staleSubRows ?? []) as Array<{ id: string; app_id: string }>;
      if (staleRows.length > 0) {
        const versionInserts = staleRows.map((s) => ({
          app_strategy_id: s.id,
          app_id: s.app_id,
          change_type: "user_edit" as const, // closest in the existing enum
          change_summary: `Entity change invalidation (${reason}): ${unique.length} entity ${unique.length === 1 ? "ref" : "refs"} updated upstream`,
          diff: {
            kind: "entity_cascade",
            reason,
            entity_uuids_changed: unique,
          } as unknown as import("@/types/database.types").Json,
          changed_by: changedBy,
        }));
        const { error: verErr } = await db.from("app_strategy_versions").insert(versionInserts);
        if (!verErr) {
          substrategiesFlagged = staleRows.length;
        }
      }
    } catch (subErr) {
      console.warn("[staleness] sub-strategy cascade failed:", subErr);
    }

    // Tier 7 (Gap #1): cascade to prediction_ledger. Predictions carry
    // entity_ids now (Tier 6 migration 20260422_deep_wiring.sql), so we
    // can find open predictions whose entity context just changed and
    // invalidate them. Without this the entity_ids column is dead
    // schema — the cascade closes the KG → prediction loop.
    //
    // Semantics: we transition open predictions to 'abandoned' (not
    // 'resolved' — there's no actual value to resolve against) with a
    // note explaining the invalidation. The resolver's idempotency
    // guard (status != 'open') prevents these from being re-processed.
    //
    // Scope: ONLY predictions that are currently open. Resolved
    // predictions stay resolved (their deviation tag was correct as of
    // resolution time; entity changes after that don't retroactively
    // change whether the prediction was a surprise).
    let predictionsInvalidated = 0;
    try {
      const { data: stalePredictions } = await db
        .from("prediction_ledger")
        .select("id, metric_label, entity_ids")
        .eq("space_id", spaceId)
        .eq("status", "open")
        .overlaps("entity_ids", unique);

      const staleRows = (stalePredictions ?? []) as Array<{
        id: string;
        metric_label: string;
        entity_ids: string[];
      }>;

      if (staleRows.length > 0) {
        const nowIso = new Date().toISOString();
        const noteTemplate =
          `[invalidated] Entity context changed (${reason}): ` +
          `${unique.length} entity ${unique.length === 1 ? "ref" : "refs"} updated upstream. ` +
          `Prediction no longer grounded in current KG.`;
        // Bulk update by id list — idempotent via status filter.
        const { error: predErr } = await db
          .from("prediction_ledger")
          .update({
            status: "abandoned",
            resolved_at: nowIso,
            resolution_notes: noteTemplate,
          })
          .in("id", staleRows.map((r) => r.id))
          .eq("status", "open"); // defensive: don't clobber rows that
                                 // transitioned between select + update
        if (predErr) {
          console.warn("[staleness] prediction cascade update failed:", predErr);
        } else {
          predictionsInvalidated = staleRows.length;
        }
      }
    } catch (predCascadeErr) {
      console.warn("[staleness] prediction cascade failed:", predCascadeErr);
    }

    // Changelog — soft-fail.
    try {
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "apps_marked_stale",
        summary:
          `Apps marked stale (${reason}): ${marked} ${marked === 1 ? "app" : "apps"}` +
          (substrategiesFlagged > 0
            ? ` + ${substrategiesFlagged} sub-strategies`
            : "") +
          (predictionsInvalidated > 0
            ? ` + ${predictionsInvalidated} predictions invalidated`
            : ""),
        details: {
          reason,
          changed_by: changedBy,
          affected_app_ids: appIds,
          affected_app_names: matchedApps.map((a) => a.name),
          entity_uuids_changed: unique,
          entity_count: unique.length,
          // Tier 6: sub-strategy cascade count
          substrategies_flagged: substrategiesFlagged,
          // Tier 7 (Gap #1): prediction cascade count. Fields are
          // additive — older consumers ignore the new field safely.
          predictions_invalidated: predictionsInvalidated,
        },
      });
    } catch {
      /* changelog is non-critical */
    }

    return { flagged_count: marked, flagged_app_ids: appIds };
  } catch (err) {
    console.warn("[staleness] flagAppsByEntityChange unexpected failure:", err);
    return { flagged_count: 0, flagged_app_ids: [] };
  }
}

/**
 * Append an enrichment signal to every App in the space whose
 * dominant_entity_ids overlap the changed entities. Does NOT mark apps stale —
 * this is for agent outputs that *add information* (insights, reasoning
 * results) rather than invalidate cached state.
 *
 * Used by the reason endpoint so that when the user asks for a cascade
 * analysis anchored on entity X, every App whose dominant factors include X
 * gets an "insight" signal on its card.
 */
export async function appendSignalToAppsByEntities(
  db: DB,
  spaceId: string,
  entityUuids: string[],
  signal: NonNullable<AppState["recent_signals"]>[number],
  changedBy: string
): Promise<number> {
  if (!spaceId || entityUuids.length === 0) return 0;
  const unique = Array.from(
    new Set(entityUuids.filter((v): v is string => typeof v === "string" && v.length > 0))
  );
  if (unique.length === 0) return 0;

  try {
    const { data: apps, error } = await db
      .from("apps")
      .select("id")
      .eq("space_id", spaceId)
      .neq("status", "retired")
      .overlaps("dominant_entity_ids", unique);
    if (error || !apps || apps.length === 0) return 0;

    const ids = (apps as Array<{ id: string }>).map((a) => a.id);
    // Parallel fan-out. appendAppSignal is idempotent-safe on failure.
    await Promise.all(ids.map((id) => appendAppSignal(db, id, signal, changedBy)));
    return ids.length;
  } catch (err) {
    console.warn("[staleness] appendSignalToAppsByEntities failed:", err);
    return 0;
  }
}

/**
 * Flag ALL non-retired apps in a space as stale. Used when a change
 * invalidates the space-level context (e.g. strategy regen changed
 * fundamental assumptions, or synthesis was re-run).
 */
export async function flagAllAppsInSpace(
  db: DB,
  spaceId: string,
  reason: AppStaleReason,
  changedBy: string,
  summary?: string
): Promise<FlagResult> {
  try {
    const { data: apps, error } = await db
      .from("apps")
      .select("id, name")
      .eq("space_id", spaceId)
      .neq("status", "retired");

    if (error || !apps || apps.length === 0) {
      return { flagged_count: 0, flagged_app_ids: [] };
    }

    const rows = apps as Array<{ id: string; name: string }>;
    const appIds = rows.map((a) => a.id);
    const marked = await markAppsStale(db, appIds, reason, changedBy, summary);

    try {
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "apps_marked_stale",
        summary: `All apps marked stale (${reason}): ${marked} ${marked === 1 ? "app" : "apps"}`,
        details: {
          reason,
          changed_by: changedBy,
          affected_app_ids: appIds,
          scope: "space_wide",
        },
      });
    } catch {
      /* changelog is non-critical */
    }

    return { flagged_count: marked, flagged_app_ids: appIds };
  } catch (err) {
    console.warn("[staleness] flagAllAppsInSpace failed:", err);
    return { flagged_count: 0, flagged_app_ids: [] };
  }
}

/**
 * Wave B — cascade from a goal status change to every app that serves
 * that goal (either directly via serves_goal_id OR indirectly via
 * serves_sub_objective_ids).
 *
 * Called when:
 *   - A Wave A 'proposed' goal is approved → flips to 'active'. Apps
 *     serving it need to re-validate their assumptions.
 *   - A goal is paused / abandoned / rejected. Apps serving it should
 *     flag so the user notices the mismatch.
 *   - (Future) A goal's metric target is changed.
 *
 * Soft-fail: all queries wrapped; upstream goal mutation never blocks
 * on this trigger.
 */
export async function flagAppsByGoalChange(
  db: DB,
  goalId: string,
  reason: AppStaleReason,
  changedBy: string,
  summary?: string,
): Promise<FlagResult> {
  if (!goalId) return { flagged_count: 0, flagged_app_ids: [] };

  try {
    // Direct: apps.serves_goal_id = goalId
    const { data: directApps } = await db
      .from("apps")
      .select("id, name, space_id")
      .eq("serves_goal_id", goalId)
      .neq("status", "retired");

    // Indirect: apps.serves_sub_objective_ids contains goalId
    const { data: indirectApps } = await db
      .from("apps")
      .select("id, name, space_id")
      .contains("serves_sub_objective_ids", [goalId])
      .neq("status", "retired");

    const all = [
      ...((directApps ?? []) as Array<{ id: string; name: string; space_id: string }>),
      ...((indirectApps ?? []) as Array<{ id: string; name: string; space_id: string }>),
    ];

    // Dedupe by id
    const byId = new Map<string, { id: string; name: string; space_id: string }>();
    for (const a of all) byId.set(a.id, a);
    const appIds = Array.from(byId.keys());

    if (appIds.length === 0) return { flagged_count: 0, flagged_app_ids: [] };

    const marked = await markAppsStale(db, appIds, reason, changedBy, summary);
    return { flagged_count: marked, flagged_app_ids: appIds };
  } catch (err) {
    console.warn("[staleness] flagAppsByGoalChange failed:", err);
    return { flagged_count: 0, flagged_app_ids: [] };
  }
}

/**
 * Wave B — cascade from a metric observation to every app tracking that
 * metric via tracked_metric_tracker_ids. Each new observation means the
 * app's health_score assumptions may be out of date.
 *
 * Heavier than flagAppsByEntityChange because metric_trackers is
 * user-level, not space-level. We filter by the tracker's space for
 * scope control.
 */
export async function flagAppsByMetricChange(
  db: DB,
  trackerId: string,
  reason: AppStaleReason,
  changedBy: string,
  summary?: string,
): Promise<FlagResult> {
  if (!trackerId) return { flagged_count: 0, flagged_app_ids: [] };
  try {
    const { data: apps, error } = await db
      .from("apps")
      .select("id, name, space_id")
      .contains("tracked_metric_tracker_ids", [trackerId])
      .neq("status", "retired");

    if (error) {
      console.warn("[staleness] flagAppsByMetricChange query failed:", error);
      return { flagged_count: 0, flagged_app_ids: [] };
    }

    const rows = (apps ?? []) as Array<{ id: string; name: string; space_id: string }>;
    if (rows.length === 0) return { flagged_count: 0, flagged_app_ids: [] };

    const appIds = rows.map((a) => a.id);
    const marked = await markAppsStale(db, appIds, reason, changedBy, summary);
    return { flagged_count: marked, flagged_app_ids: appIds };
  } catch (err) {
    console.warn("[staleness] flagAppsByMetricChange failed:", err);
    return { flagged_count: 0, flagged_app_ids: [] };
  }
}

/**
 * Wave B — entity_objectives-aware cascade. Given changed entity UUIDs,
 * walk through the Wave A junction to find goals whose served entities
 * have shifted, then cascade to apps serving those goals.
 *
 * This is the cross-app cascade the audit called out as missing:
 *   changed entity → entity_objectives → goals_at_risk → apps.serves_goal_id
 *
 * The regular flagAppsByEntityChange already covers apps that directly
 * reference the entity in dominant_entity_ids. This function covers the
 * second-hop case — apps that only reference the GOAL, not the entity,
 * but whose goal depends on that entity.
 */
export async function flagAppsByEntityChangeViaObjectives(
  db: DB,
  entityUuids: string[],
  reason: AppStaleReason,
  changedBy: string,
  summary?: string,
): Promise<FlagResult> {
  if (entityUuids.length === 0) {
    return { flagged_count: 0, flagged_app_ids: [] };
  }
  const unique = Array.from(
    new Set(
      entityUuids.filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      ),
    ),
  );
  if (unique.length === 0) return { flagged_count: 0, flagged_app_ids: [] };

  try {
    // Step 1: entity_objectives(entity_id ∈ changed) → set of goal_ids
    const { data: junctionRows, error: jErr } = await db
      .from("entity_objectives")
      .select("goal_id")
      .in("entity_id", unique);

    if (jErr) {
      console.warn(
        "[staleness] entity_objectives lookup failed:",
        jErr,
      );
      return { flagged_count: 0, flagged_app_ids: [] };
    }

    const goalIds = Array.from(
      new Set(
        ((junctionRows ?? []) as Array<{ goal_id: string }>).map(
          (r) => r.goal_id,
        ),
      ),
    );
    if (goalIds.length === 0) return { flagged_count: 0, flagged_app_ids: [] };

    // Step 2: apps serving any of those goals
    const allAppIds = new Set<string>();

    const { data: directApps } = await db
      .from("apps")
      .select("id")
      .in("serves_goal_id", goalIds)
      .neq("status", "retired");
    for (const a of (directApps ?? []) as Array<{ id: string }>) {
      allAppIds.add(a.id);
    }

    // overlaps() needs each goal tested individually for contains; batch it
    const { data: indirectApps } = await db
      .from("apps")
      .select("id, serves_sub_objective_ids")
      .neq("status", "retired");
    const goalSet = new Set(goalIds);
    for (const a of (indirectApps ?? []) as Array<{
      id: string;
      serves_sub_objective_ids: string[] | null;
    }>) {
      if ((a.serves_sub_objective_ids ?? []).some((g) => goalSet.has(g))) {
        allAppIds.add(a.id);
      }
    }

    if (allAppIds.size === 0) return { flagged_count: 0, flagged_app_ids: [] };

    const appIds = Array.from(allAppIds);
    const marked = await markAppsStale(db, appIds, reason, changedBy, summary);
    return { flagged_count: marked, flagged_app_ids: appIds };
  } catch (err) {
    console.warn(
      "[staleness] flagAppsByEntityChangeViaObjectives failed:",
      err,
    );
    return { flagged_count: 0, flagged_app_ids: [] };
  }
}
