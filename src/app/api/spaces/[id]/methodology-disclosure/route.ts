// GET /api/spaces/[id]/methodology-disclosure
//
// One-shot fetch backing the LabMethodologyDisclosure overlay.
// Returns:
//   • The active plan's methodology_disclosure section (parsers,
//     trust boundary, priors, heterogeneity, consensus profiles)
//   • Pooling stats: how many edges are evidence-pooled vs LLM-
//     estimated, evidence row counts (total / reviewed)
//   • Edge dynamics histogram: counts per response model
//
// Soft-fail: every sub-query is independent so a partial response
// is preferable to a 500. Missing sections come back null/empty.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface MethodologyResponse {
  active_plan_id: string | null;
  methodology_disclosure: unknown | null;
  pooling_stats: {
    edges_total: number;
    edges_pooled: number;
    edges_llm_estimated: number;
    evidence_rows_total: number;
    evidence_rows_reviewed: number;
  };
  dynamics_histogram: Record<string, number>;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Run all sub-queries in parallel.
  const [spaceRes, edgesRes, evidenceCountsRes] = await Promise.all([
    db
      .from("spaces")
      .select("active_plan_id")
      .eq("id", spaceId)
      .maybeSingle(),
    db
      .from("edges")
      .select("dynamics, dynamics_properties")
      .eq("space_id", spaceId),
    db
      .from("evidence_registries")
      .select("status", { count: "exact" })
      .eq("space_id", spaceId),
  ]);

  // Resolve active plan row (separate roundtrip, only when active).
  let methodology: unknown | null = null;
  const activePlanId =
    (spaceRes.data as { active_plan_id?: string } | null)?.active_plan_id ??
    null;
  if (activePlanId) {
    try {
      const { data: planRow } = await db
        .from("kg_generation_plans")
        .select("methodology_disclosure")
        .eq("id", activePlanId)
        .maybeSingle();
      methodology =
        (planRow as { methodology_disclosure?: unknown } | null)
          ?.methodology_disclosure ?? null;
    } catch {
      methodology = null;
    }
  }

  // Pooling histogram: count edges that have a pooling_metadata key
  // in dynamics_properties JSONB.
  const edges =
    (edgesRes.data as Array<{
      dynamics: string | null;
      dynamics_properties: Record<string, unknown> | null;
    }> | null) ?? [];
  let edgesPooled = 0;
  const dynamicsCounts: Record<string, number> = {};
  for (const e of edges) {
    if (
      e.dynamics_properties &&
      typeof e.dynamics_properties === "object" &&
      Object.prototype.hasOwnProperty.call(
        e.dynamics_properties,
        "pooling_metadata",
      )
    ) {
      edgesPooled++;
    }
    const dyn = e.dynamics ?? "linear";
    dynamicsCounts[dyn] = (dynamicsCounts[dyn] ?? 0) + 1;
  }
  const edgesTotal = edges.length;
  const edgesLlmEstimated = edgesTotal - edgesPooled;

  // Evidence reviewed count — separate query (smaller payload).
  let evidenceReviewed = 0;
  try {
    const { count: reviewedCount } = await db
      .from("evidence_registries")
      .select("*", { count: "exact", head: true })
      .eq("space_id", spaceId)
      .eq("status", "reviewed");
    evidenceReviewed = reviewedCount ?? 0;
  } catch {
    evidenceReviewed = 0;
  }

  const evidenceTotal = evidenceCountsRes.count ?? 0;

  const response: MethodologyResponse = {
    active_plan_id: activePlanId,
    methodology_disclosure: methodology,
    pooling_stats: {
      edges_total: edgesTotal,
      edges_pooled: edgesPooled,
      edges_llm_estimated: edgesLlmEstimated,
      evidence_rows_total: evidenceTotal,
      evidence_rows_reviewed: evidenceReviewed,
    },
    dynamics_histogram: dynamicsCounts,
  };

  return NextResponse.json(response);
}
