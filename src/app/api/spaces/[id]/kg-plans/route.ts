// GET /api/spaces/[id]/kg-plans?status=open|all
//
// List plans for a space. Used by KgPlanReviewGate to find the
// most recent non-final plan to surface in the Plan Review Card.
//
// Query params:
//   status=open  → only proposed | edited (default — for the gate)
//   status=all   → every status
//
// Returned ordered by created_at desc.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { KgGenerationPlan } from "@/types/kg-generation-plan";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
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

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "open";

  let query = db
    .from("kg_generation_plans")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (status === "open") {
    query = query.in("status", ["proposed", "edited", "draft"]);
  }

  const { data, error } = (await query) as {
    data: KgGenerationPlan[] | null;
    error: { message?: string } | null;
  };

  if (error) {
    return NextResponse.json(
      { error: `Failed to load plans: ${error.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ plans: data ?? [] });
}
