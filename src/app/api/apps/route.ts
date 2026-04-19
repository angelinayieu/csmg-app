// GET  /api/apps?spaceId=<uuid>  → list apps for a space (with intervention counts)
// POST /api/apps                 → create an App manually (rare; normally materialized by pipeline)

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type { AppRow } from "@/types/app";
import { hydrateApp } from "@/types/app";
import type { InterventionRow } from "@/types/intervention";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { searchParams } = new URL(request.url);
  const spaceId = searchParams.get("spaceId");
  const status = searchParams.get("status"); // optional filter

  let query = db
    .from("apps")
    .select("*")
    .eq("user_id", user.id)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });

  if (spaceId) query = query.eq("space_id", spaceId);
  if (status) query = query.eq("status", status);

  const { data, error } = (await query) as { data: AppRow[] | null; error: unknown };
  if (error) {
    console.error("[apps list] error:", error);
    return NextResponse.json({ error: "Failed to fetch apps" }, { status: 500 });
  }

  const apps = data ?? [];
  const appIds = apps.map((a) => a.id);

  // Join intervention counts in a single query
  const countsByApp = new Map<string, { total: number; completed: number }>();
  if (appIds.length > 0) {
    const { data: ivRows } = (await db
      .from("interventions")
      .select("app_id, status")
      .in("app_id", appIds)) as {
      data: Array<Pick<InterventionRow, "app_id" | "status">> | null;
    };
    for (const r of ivRows ?? []) {
      if (!r.app_id) continue;
      const bucket = countsByApp.get(r.app_id) ?? { total: 0, completed: 0 };
      bucket.total += 1;
      if (r.status === "completed") bucket.completed += 1;
      countsByApp.set(r.app_id, bucket);
    }
  }

  // Join sub_space names
  const subSpaceIds = apps
    .map((a) => a.sub_space_id)
    .filter((v): v is string => typeof v === "string");
  const subSpaceNameById = new Map<string, string>();
  if (subSpaceIds.length > 0) {
    const { data: subRows } = (await db
      .from("spaces")
      .select("id, name")
      .in("id", subSpaceIds)) as {
      data: Array<{ id: string; name: string }> | null;
    };
    for (const r of subRows ?? []) subSpaceNameById.set(r.id, r.name);
  }

  // Join goal titles
  const goalIds = apps
    .map((a) => a.serves_goal_id)
    .filter((v): v is string => typeof v === "string");
  const goalTitleById = new Map<string, string>();
  if (goalIds.length > 0) {
    const { data: goalRows } = (await db
      .from("improvement_goals")
      .select("id, title")
      .in("id", goalIds)) as {
      data: Array<{ id: string; title: string }> | null;
    };
    for (const r of goalRows ?? []) goalTitleById.set(r.id, r.title);
  }

  const hydrated = apps.map((row) => {
    const app = hydrateApp(row);
    const counts = countsByApp.get(row.id);
    return {
      ...app,
      intervention_count: counts?.total ?? 0,
      interventions_completed: counts?.completed ?? 0,
      sub_space_name: row.sub_space_id ? subSpaceNameById.get(row.sub_space_id) ?? null : null,
      serves_goal_title: row.serves_goal_id ? goalTitleById.get(row.serves_goal_id) ?? null : null,
    };
  });

  return NextResponse.json({ apps: hydrated });
}

// POST — manual creation. Rare; primary path is pipeline materialization.
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const {
    space_id,
    name,
    description,
    app_type,
    dominant_entity_ids,
    dominant_entity_codes,
    serves_goal_id,
    config,
    priority,
    complexity,
  } = (body ?? {}) as Record<string, unknown>;

  if (!space_id || !name) {
    return NextResponse.json(
      { error: "space_id and name are required" },
      { status: 400 }
    );
  }

  // Verify user owns the space
  const { data: space } = await db
    .from("spaces")
    .select("id")
    .eq("id", space_id)
    .eq("user_id", user.id)
    .single();

  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: inserted, error } = await db
    .from("apps")
    .insert({
      space_id,
      user_id: user.id,
      name,
      description: description ?? null,
      app_type: app_type ?? "dashboard",
      dominant_entity_ids: dominant_entity_ids ?? [],
      dominant_entity_codes: dominant_entity_codes ?? [],
      serves_goal_id: serves_goal_id ?? null,
      config: config ?? {},
      state: {},
      priority: priority ?? 999,
      complexity: complexity ?? null,
      last_updated_by: "user",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[apps create] error:", error);
    return NextResponse.json(
      { error: "Failed to create app" },
      { status: 500 }
    );
  }

  // Seed an app_versions row
  try {
    await db.from("app_versions").insert({
      app_id: inserted.id,
      version: 1,
      config_snapshot: inserted.config,
      state_snapshot: inserted.state,
      change_summary: "App created manually",
      change_type: "user_edit",
      changed_by: `user:${user.id}`,
    });
  } catch (verErr) {
    console.warn("[apps create] version insert failed:", verErr);
  }

  return NextResponse.json({ app: hydrateApp(inserted) });
}
