// ── GET /api/objective/[spaceId]/concept-connections ──────────────────
//
// The HONEST cross-room connection layer for the objective canvas. Loads
// the space's room entities (pains / features / outcomes, scoped by
// parent_sub_objective_id) and clusters the ones that denote the SAME
// concept across different rooms — so the map can draw real "this concept
// recurs in rooms A, C, F" links instead of the fabricated string-match
// edges (`cross-room-signals`) it computes at render today.
//
// Read-only + deterministic: no writes, no LLM, no embeddings. The
// clustering lives in the pure `build-concept-clusters` builder; this
// route is just the loader + the ownership gate. A view can fetch this and
// render `connections` as cross-room edges keyed on `clusterId`.
//
// Verified substrate (2026-05-30): lexical clustering surfaces ~235
// candidate cross-room links across 510 entities (vs 6 exact-canonical),
// at high quality. Swap the builder's `scorePair` for embedding cosine to
// upgrade lexical → semantic later (no change here).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  buildConceptClusters,
  type ConceptEntityInput,
} from "@/lib/objective-canvas/build-concept-clusters";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // Ownership gate.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load room entities only (those scoped to a room via
  // parent_sub_objective_id). Non-room entities aren't part of the
  // cross-room concept fabric.
  const { data: entityRows, error: entErr } = await auth.supabase
    .from("entities")
    .select("id, name, parent_sub_objective_id, canonical_concept_id")
    .eq("space_id", spaceId)
    .not("parent_sub_objective_id", "is", null);

  if (entErr) {
    return NextResponse.json(
      { error: "entity load failed", detail: entErr.message },
      { status: 500 },
    );
  }

  const entities: ConceptEntityInput[] = (
    (entityRows ?? []) as Array<{
      id: string;
      name: string;
      parent_sub_objective_id: string | null;
      canonical_concept_id: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    roomId: r.parent_sub_objective_id,
    canonicalConceptId: r.canonical_concept_id,
  }));

  // Room id → title (sub-objectives = improvement_goals) so consumers can
  // label the rooms each concept spans without a second round-trip.
  const { data: roomRows } = await auth.supabase
    .from("improvement_goals")
    .select("id, title")
    .eq("space_id", spaceId);
  const rooms: Record<string, string> = {};
  for (const r of (roomRows ?? []) as Array<{ id: string; title: string }>) {
    if (r.id) rooms[r.id] = r.title ?? "Untitled room";
  }

  // Optional ?minSharedTokens= / ?tokenThreshold= overrides for tuning.
  const url = new URL(req.url);
  const minSharedTokens = clampInt(url.searchParams.get("minSharedTokens"), 1, 5);
  const tokenThreshold = clampFloat(url.searchParams.get("tokenThreshold"), 0, 1);

  const result = buildConceptClusters(entities, {
    ...(minSharedTokens != null ? { minSharedTokens } : {}),
    ...(tokenThreshold != null ? { tokenThreshold } : {}),
  });

  // Only the cross-room clusters matter for the map; trim single-room
  // clusters from the response to keep it lean (stats still count all).
  return NextResponse.json({
    built_at: result.built_at,
    stats: result.stats,
    rooms,
    clusters: result.clusters.filter((c) => c.crossRoom),
    connections: result.connections,
  });
}

function clampInt(raw: string | null, lo: number, hi: number): number | undefined {
  if (raw == null) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, n));
}

function clampFloat(raw: string | null, lo: number, hi: number): number | undefined {
  if (raw == null) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, n));
}
