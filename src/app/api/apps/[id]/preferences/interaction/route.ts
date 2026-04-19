// POST /api/apps/:id/preferences/interaction  { widget_id: string }
//
// Bumps an interaction counter for a specific widget on this app. Used by
// the AppRenderer to track engagement — agents later read these counts to
// propose preference changes (e.g. auto-pin a frequently-clicked widget).
//
// Deliberately light-weight: no version row, no changelog. Counters are
// high-frequency + low-stakes.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { recordWidgetInteraction } from "@/lib/apps/preferences";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    widget_id?: string;
  }>(request);
  if (parseError) return parseError;

  const widgetId = body?.widget_id;
  if (typeof widgetId !== "string" || !widgetId) {
    return NextResponse.json({ error: "widget_id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check — prevents blind interaction-writing for arbitrary apps.
  const { data: ownerCheck } = await db
    .from("apps")
    .select("id")
    .eq("id", appId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownerCheck) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  await recordWidgetInteraction(db, user.id, appId, widgetId);
  return NextResponse.json({ success: true });
}
