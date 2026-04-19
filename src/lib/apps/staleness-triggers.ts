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

    // Changelog — soft-fail.
    try {
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "apps_marked_stale",
        summary: `Apps marked stale (${reason}): ${marked} ${marked === 1 ? "app" : "apps"}`,
        details: {
          reason,
          changed_by: changedBy,
          affected_app_ids: appIds,
          affected_app_names: matchedApps.map((a) => a.name),
          entity_uuids_changed: unique,
          entity_count: unique.length,
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
