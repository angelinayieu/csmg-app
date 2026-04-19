// GET   /api/apps/:id/preferences         → read effective preferences
// PATCH /api/apps/:id/preferences         → merge user patch into preferences
// POST  /api/apps/:id/preferences/interaction { widget_id } → bump counter
//
// The preferences layer lives beside config.manifest and the renderer merges
// them at render time. Writes never touch the canonical manifest.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  loadAppPreferences,
  upsertAppPreferences,
} from "@/lib/apps/preferences";
import type { AppRow, AppType } from "@/types/app";
import type { AppPreferences } from "@/types/app-preferences";

export async function GET(
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
    .select("id, user_id, app_type")
    .eq("id", appId)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: Pick<AppRow, "id" | "user_id" | "app_type"> | null;
  };
  if (!appRow) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const loaded = await loadAppPreferences(
    db,
    user.id,
    appId,
    appRow.app_type as AppType
  );

  return NextResponse.json({
    preferences: loaded.effective,
    app_row: loaded.app_row,
    type_row: loaded.type_row,
    interaction_counts: loaded.interaction_counts,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    patch?: AppPreferences;
    scope?: "app" | "app_type";
    mode?: "merge" | "replace";
  }>(request);
  if (parseError) return parseError;

  const patch = body?.patch;
  if (!patch || typeof patch !== "object") {
    return NextResponse.json(
      { error: "patch (AppPreferences object) required" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: appRow } = (await db
    .from("apps")
    .select("id, user_id, app_type")
    .eq("id", appId)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: Pick<AppRow, "id" | "user_id" | "app_type"> | null;
  };
  if (!appRow) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const scope = body?.scope === "app_type" ? "app_type" : "app";
  const mode = body?.mode === "replace" ? "replace" : "merge";

  const updated = await upsertAppPreferences(db, {
    userId: user.id,
    appId: scope === "app" ? appId : null,
    appType: scope === "app_type" ? (appRow.app_type as AppType) : null,
    patch,
    mode,
  });

  return NextResponse.json({ row: updated });
}
