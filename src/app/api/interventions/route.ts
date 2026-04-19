// GET  /api/interventions?spaceId=<uuid>[&appId=<uuid>][&status=<status>]
//
// Consumer endpoint for the dashboard's Interventions column and for per-app
// views that want to show "interventions feeding this app."
//
// Joins target_entity name + app name for display convenience.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { InterventionRow } from "@/types/intervention";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { searchParams } = new URL(request.url);
  const spaceId = searchParams.get("spaceId");
  const appId = searchParams.get("appId");
  const status = searchParams.get("status");

  if (!spaceId && !appId) {
    return NextResponse.json(
      { error: "spaceId or appId is required" },
      { status: 400 }
    );
  }

  let query = db
    .from("interventions")
    .select("*")
    .eq("user_id", user.id)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });

  if (spaceId) query = query.eq("space_id", spaceId);
  if (appId) query = query.eq("app_id", appId);
  if (status) query = query.eq("status", status);

  const { data, error } = (await query) as {
    data: InterventionRow[] | null;
    error: unknown;
  };
  if (error) {
    console.error("[interventions list] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch interventions" },
      { status: 500 }
    );
  }

  const interventions = data ?? [];

  // Join target entity names
  const entityUuids = Array.from(
    new Set(
      interventions
        .map((i) => i.target_entity_id)
        .filter((v): v is string => typeof v === "string")
    )
  );
  const entityNameById = new Map<string, string>();
  if (entityUuids.length > 0) {
    const { data: entRows } = await db
      .from("entities")
      .select("id, name")
      .in("id", entityUuids);
    for (const r of (entRows ?? []) as Array<{ id: string; name: string }>) {
      entityNameById.set(r.id, r.name);
    }
  }

  // Join app names
  const appIds = Array.from(
    new Set(
      interventions
        .map((i) => i.app_id)
        .filter((v): v is string => typeof v === "string")
    )
  );
  const appNameById = new Map<string, string>();
  if (appIds.length > 0) {
    const { data: appRows } = await db
      .from("apps")
      .select("id, name")
      .in("id", appIds);
    for (const r of (appRows ?? []) as Array<{ id: string; name: string }>) {
      appNameById.set(r.id, r.name);
    }
  }

  const hydrated = interventions.map((i) => ({
    ...i,
    target_entity_name: i.target_entity_id
      ? entityNameById.get(i.target_entity_id) ?? null
      : null,
    app_name: i.app_id ? appNameById.get(i.app_id) ?? null : null,
  }));

  return NextResponse.json({ interventions: hydrated });
}
