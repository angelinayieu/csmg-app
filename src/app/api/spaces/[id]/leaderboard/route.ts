// ── /api/spaces/[id]/leaderboard ────────────────────────────────────
//
// GET → cross-app variant ranking for this space.
//        Returns { variants: LeaderboardEntry[] } sorted:
//          1. is_active = true first (champions per situation)
//          2. then by aggregate_quality DESC
//          3. then by aggregate_tokens ASC (cheaper variant wins ties)
//
// Used by the Lab Room's leaderboard chip + the strategy drawer's
// future Leaderboard tab. No new schema — derives the ranking from
// the existing `experiment_variants` table that writer-path already
// populates.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface LeaderboardEntry {
  variantId: string;
  spaceId: string;
  appId: string | null;
  appName: string | null;
  label: string;
  status: string;
  situationKey: string | null;
  aggregateQuality: number | null;
  aggregateLift: number | null;
  aggregateTokens: number | null;
  isActive: boolean;
  scoreProvenance: string | null;
  updatedAt: string;
}

// Hard cap so a runaway space with hundreds of regen rounds doesn't
// dump 10k rows into the response. The chip only renders the top ~15
// anyway; keep room for the drawer to show more.
const MAX_ROWS = 200;

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Cross-app fetch + lift hydration. We do a single query for variants
  // (with the relevant scoring columns) and a separate query for app
  // titles since the two tables aren't in the same FK domain in older
  // migrations — joining at the app layer in JS keeps the endpoint
  // resilient to schema variations.
  const { data: variants, error: vErr } = await db
    .from("experiment_variants")
    .select(
      "id, space_id, app_id, label, status, situation_key, aggregate_quality, aggregate_lift, aggregate_tokens, is_active, score_provenance, updated_at",
    )
    .eq("space_id", spaceId)
    .order("is_active", { ascending: false })
    .order("aggregate_quality", { ascending: false, nullsFirst: false })
    .order("aggregate_tokens", { ascending: true, nullsFirst: false })
    .limit(MAX_ROWS);

  if (vErr) {
    console.warn("[leaderboard] variants fetch failed:", vErr);
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }

  const variantsList = Array.isArray(variants) ? variants : [];

  // Fetch app titles for the unique app ids referenced. Skip the round
  // trip when there are no apps referenced (legacy variants without
  // app_id, e.g. space-level writer-path runs).
  const appIds = Array.from(
    new Set(
      variantsList
        .map((v: { app_id: string | null }) => v.app_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const appNameById = new Map<string, string>();
  if (appIds.length > 0) {
    const { data: apps, error: aErr } = await db
      .from("apps")
      .select("id, title")
      .in("id", appIds);
    if (aErr) {
      // Non-fatal — leaderboard still works without app titles.
      console.warn("[leaderboard] apps fetch failed:", aErr);
    } else if (Array.isArray(apps)) {
      for (const a of apps as Array<{ id: string; title: string | null }>) {
        if (a.id) appNameById.set(a.id, a.title ?? "Untitled app");
      }
    }
  }

  const projected: LeaderboardEntry[] = variantsList.map(
    (v: {
      id: string;
      space_id: string;
      app_id: string | null;
      label: string;
      status: string;
      situation_key: string | null;
      aggregate_quality: number | null;
      aggregate_lift: number | null;
      aggregate_tokens: number | null;
      is_active: boolean;
      score_provenance: string | null;
      updated_at: string;
    }) => ({
      variantId: v.id,
      spaceId: v.space_id,
      appId: v.app_id,
      appName: v.app_id ? appNameById.get(v.app_id) ?? null : null,
      label: v.label,
      status: v.status,
      situationKey: v.situation_key,
      aggregateQuality: v.aggregate_quality,
      aggregateLift: v.aggregate_lift,
      aggregateTokens: v.aggregate_tokens,
      isActive: v.is_active,
      scoreProvenance: v.score_provenance,
      updatedAt: v.updated_at,
    }),
  );

  return NextResponse.json({ variants: projected, total: projected.length });
}
