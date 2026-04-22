/**
 * Wave D L1 — intervention lifecycle writers.
 *
 * Until Wave D, `interventions.status` was a ghost column: defined with
 * an enum (proposed/active/completed/superseded/abandoned), read by
 * `computeHealthScore`'s `delivery_bonus` factor, but written by no one.
 * Every app's health was structurally deflated ~8 points because
 * delivery_bonus was always 0.
 *
 * These writers close that loop. The route handlers (/api/interventions/
 * [id]/complete, /api/interventions/[id]/abandon) call these functions;
 * each:
 *   1. Flips `status` with timestamps + resolver
 *   2. Records a user_event so the digest sees completion patterns
 *   3. Triggers `recomputeAppHealth` so the app's score updates
 *      immediately (the delivery_bonus now fires for real)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recomputeAppHealth } from "@/lib/apps/app-updates";
import { recordUserEvent } from "@/lib/user-events/record";
import type { AppRow } from "@/types/app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

export type InterventionResolution = "completed" | "abandoned";

export interface LifecycleResult {
  ok: boolean;
  intervention_id: string;
  new_status: InterventionResolution;
  app_health_after: number | null;
  error?: string;
}

async function applyResolution(
  db: DB,
  interventionId: string,
  userId: string,
  resolution: InterventionResolution,
  note: string | null,
): Promise<LifecycleResult> {
  // Load intervention + verify ownership (via app → user_id).
  const { data: iv } = (await db
    .from("interventions")
    .select(
      "id, app_id, space_id, status, title, target_entity_id",
    )
    .eq("id", interventionId)
    .maybeSingle()) as {
    data: {
      id: string;
      app_id: string | null;
      space_id: string;
      status: string;
      title: string;
      target_entity_id: string | null;
    } | null;
  };

  if (!iv) {
    return {
      ok: false,
      intervention_id: interventionId,
      new_status: resolution,
      app_health_after: null,
      error: "Intervention not found",
    };
  }
  if (iv.status === resolution) {
    return {
      ok: true,
      intervention_id: interventionId,
      new_status: resolution,
      app_health_after: null,
      error: "already in target status",
    };
  }
  if (iv.status === "superseded") {
    return {
      ok: false,
      intervention_id: interventionId,
      new_status: resolution,
      app_health_after: null,
      error: "cannot transition from superseded",
    };
  }

  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: resolution,
    // `completed_at` exists on interventions today (20260428 migration).
    // It was originally only meant for 'completed', but we also stamp it
    // on 'abandoned' so the row carries a consistent "when did this end"
    // timestamp. The user_event payload preserves the distinction.
    completed_at: nowIso,
  };
  const { error: updErr } = await db
    .from("interventions")
    .update(updatePayload)
    .eq("id", interventionId);

  if (updErr) {
    console.warn("[intervention-lifecycle] update failed:", updErr);
    return {
      ok: false,
      intervention_id: interventionId,
      new_status: resolution,
      app_health_after: null,
      error: String(updErr),
    };
  }

  // Log the user event — digest learns user's "completes vs abandons" lean.
  try {
    await recordUserEvent(db, {
      user_id: userId,
      event_type:
        resolution === "completed"
          ? "intervention.completed"
          : "intervention.abandoned",
      source: `user:intervention-${resolution}:${userId}`,
      ref_kind: "app",
      ref_id: iv.app_id,
      space_id: iv.space_id,
      payload: {
        intervention_id: interventionId,
        title: iv.title,
        prior_status: iv.status,
        note: note ?? undefined,
        target_entity_id: iv.target_entity_id,
      },
    });
  } catch {
    /* non-fatal */
  }

  // Recompute the owning app's health — delivery_bonus just changed.
  // Use `recomputeAppHealth` (not `reconcileAppWithKG`) so we don't
  // silently clear staleness on the app.
  let appHealthAfter: number | null = null;
  if (iv.app_id) {
    try {
      const { data: app } = (await db
        .from("apps")
        .select("*")
        .eq("id", iv.app_id)
        .maybeSingle()) as { data: AppRow | null };
      if (app) {
        const refreshed = await recomputeAppHealth(
          db,
          app,
          `user:intervention-${resolution}:${userId}`,
        );
        appHealthAfter = refreshed?.health_score ?? null;
      }
    } catch (err) {
      console.warn(
        "[intervention-lifecycle] health recompute failed:",
        err,
      );
    }
  }

  return {
    ok: true,
    intervention_id: interventionId,
    new_status: resolution,
    app_health_after: appHealthAfter,
  };
}

export async function completeIntervention(
  db: DB,
  interventionId: string,
  userId: string,
  note: string | null = null,
): Promise<LifecycleResult> {
  return applyResolution(db, interventionId, userId, "completed", note);
}

export async function abandonIntervention(
  db: DB,
  interventionId: string,
  userId: string,
  note: string | null = null,
): Promise<LifecycleResult> {
  return applyResolution(db, interventionId, userId, "abandoned", note);
}
