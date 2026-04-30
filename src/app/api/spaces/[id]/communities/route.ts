// ── GET /api/spaces/[id]/communities ──
//
// D8 · returns the latest community-detection run's communities for a
// space. Powers the CommunitiesChip overlay so users can SEE the
// modularity-greedy partitions the pipeline already computed (and
// can click each one to highlight its members on canvas).
//
// "Latest run" = MAX(detection_run_id) per space, since re-runs create
// fresh rows with a new run id rather than updating in place. We pick
// the most recent run by computed_at and filter to that run id.
//
// Soft-fails to empty array on any error.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface CommunitySummary {
  title: string | null;
  rating: number | null;
  finding_count: number;
}

interface CommunityRow {
  id: string;
  parent_community_id: string | null;
  level: number;
  entity_ids: string[];
  edge_ids: string[];
  summary: CommunitySummary | null;
  modularity_contribution: number | null;
}

interface RawSummary {
  title?: unknown;
  summary?: unknown;
  rating?: unknown;
  rating_explanation?: unknown;
  findings?: unknown;
}

function projectSummary(raw: unknown): CommunitySummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawSummary;
  const title = typeof r.title === "string" ? r.title : null;
  const rating =
    typeof r.rating === "number" && Number.isFinite(r.rating) ? r.rating : null;
  const findingCount = Array.isArray(r.findings) ? r.findings.length : 0;
  if (!title && rating === null && findingCount === 0) return null;
  return { title, rating, finding_count: findingCount };
}

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Step 1 — find the latest detection_run_id by computed_at. Cheap
  // query (one row's worth) bounded by the space's communities.
  const { data: latestRows, error: latestErr } = await db
    .from("kg_communities")
    .select("detection_run_id, computed_at")
    .eq("space_id", spaceId)
    .order("computed_at", { ascending: false })
    .limit(1);

  if (latestErr) {
    console.warn("[communities] latest run lookup failed:", latestErr);
    return NextResponse.json({ communities: [] satisfies CommunityRow[] });
  }
  const latestRunId =
    latestRows && latestRows.length > 0
      ? (latestRows[0] as { detection_run_id: string }).detection_run_id
      : null;
  if (!latestRunId) {
    return NextResponse.json({ communities: [] satisfies CommunityRow[] });
  }

  // Step 2 — fetch all rows for that run.
  const { data: rows, error } = await db
    .from("kg_communities")
    .select(
      "id, parent_community_id, level, entity_ids, edge_ids, summary, modularity_contribution",
    )
    .eq("space_id", spaceId)
    .eq("detection_run_id", latestRunId)
    .order("level", { ascending: true });

  if (error) {
    console.warn("[communities] fetch failed:", error);
    return NextResponse.json({ communities: [] satisfies CommunityRow[] });
  }

  const communities: CommunityRow[] = (
    (rows ?? []) as Array<{
      id: string;
      parent_community_id: string | null;
      level: number;
      entity_ids: string[] | null;
      edge_ids: string[] | null;
      summary: unknown;
      modularity_contribution: number | null;
    }>
  ).map((r) => ({
    id: r.id,
    parent_community_id: r.parent_community_id,
    level: r.level,
    entity_ids: Array.isArray(r.entity_ids) ? r.entity_ids : [],
    edge_ids: Array.isArray(r.edge_ids) ? r.edge_ids : [],
    summary: projectSummary(r.summary),
    modularity_contribution: r.modularity_contribution,
  }));

  return NextResponse.json({ communities });
}
