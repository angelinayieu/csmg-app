// POST /api/apps/:id/refresh
//
// Acknowledges a stale flag and reconciles the App's runtime state with the
// current KG snapshot. User-facing "refresh" action surfaced on app cards
// when stale_reason is set.
//
// Implementation delegates to `reconcileAppWithKG` in src/lib/apps/app-updates
// so this endpoint and the widget-facing `reconcile_app` action share ONE
// code path.
//
// Deliberately does NOT re-run the pipeline — that's `request_agent_refresh`.
// This endpoint just reconciles with whatever synthesis already exists.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { reconcileAppWithKG } from "@/lib/apps/app-updates";
import type { AppRow } from "@/types/app";
import { hydrateApp } from "@/types/app";

export const maxDuration = 30;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: appRow } = (await db
    .from("apps")
    .select("*")
    .eq("id", appId)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: AppRow | null };

  if (!appRow) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const reconciled = await reconcileAppWithKG(db, appRow, `user:${user.id}`);

  // Changelog — soft-fail
  try {
    await db.from("space_changelog").insert({
      space_id: appRow.space_id,
      change_type: "app_refreshed",
      summary: `App refreshed: "${appRow.name}"${appRow.stale_reason ? ` (was stale: ${appRow.stale_reason})` : ""}`,
      details: {
        app_id: appId,
        prior_stale_reason: appRow.stale_reason,
      },
    });
  } catch {
    /* non-critical */
  }

  // Wave C — log user event. Captures the "how often does this user
  // proactively refresh" cadence the digest will interpret.
  try {
    const { recordUserEvent } = await import("@/lib/user-events/record");
    await recordUserEvent(db, {
      user_id: user.id,
      event_type: "app.refreshed",
      source: `user:refresh:${user.id}`,
      ref_kind: "app",
      ref_id: appId,
      space_id: appRow.space_id,
      payload: {
        prior_stale_reason: appRow.stale_reason,
        new_health_score: reconciled?.health_score ?? null,
      },
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    success: true,
    app: reconciled ? hydrateApp(reconciled) : null,
  });
}
