// ── GET /api/spaces/[id]/preflight/approvals/latest ───────────────────
//
// Returns the most-recent preflight_approvals row for this space, or
// null if no approval has been made yet. Used by the canvas chip to
// detect drift (live preflight_hash vs last approved hash) and by the
// Environment audit page to render diff-vs-plan.
//
// Response shape:
//   { approval: { id, preflight_hash, approved_at, enabled_optins,
//                 reasoning, pipeline_run_id } | null }

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("preflight_approvals")
    .select(
      "id, preflight_hash, approved_at, enabled_optins, reasoning, pipeline_run_id",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load approval", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ approval: data ?? null });
}
