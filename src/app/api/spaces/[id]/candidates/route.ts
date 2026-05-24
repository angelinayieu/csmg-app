// ── /api/spaces/[id]/candidates ──────────────────────────────────────
//
// Phase 7c-2. Read-side endpoint for the CandidateReviewDrawer.
//
// GET → list candidates for this space, filtered by:
//         status (default 'pending')
//         stage  (optional — limit to one chain stage)
//         batch  (optional — limit to one review session)
//
// Returns rows in created_at DESC order so the newest batch sits at
// the top. The drawer typically opens against the most-recent
// batch_id and groups results client-side, but the endpoint stays
// flexible to support undo / audit views later.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { CandidateRow, CandidateStage } from "@/lib/pipeline/candidates";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const VALID_STAGES: readonly CandidateStage[] = [
  "decompose",
  "synthesize",
  "critique",
  "expand",
  "extract",
] as const;

const VALID_STATUSES = ["pending", "accepted", "rejected"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

export async function GET(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const rawStage = url.searchParams.get("stage");
  const batchId = url.searchParams.get("batch");

  const status: ValidStatus = (VALID_STATUSES as readonly string[]).includes(
    rawStatus ?? "",
  )
    ? (rawStatus as ValidStatus)
    : "pending";

  const stage: CandidateStage | null =
    rawStage && (VALID_STAGES as readonly string[]).includes(rawStage)
      ? (rawStage as CandidateStage)
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let query = db
    .from("pipeline_candidates")
    .select("*")
    .eq("space_id", spaceId)
    .eq("created_by", user.id)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (stage) query = query.eq("stage", stage);
  if (batchId) query = query.eq("batch_id", batchId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const candidates = (data as CandidateRow[] | null) ?? [];
  return NextResponse.json({ candidates });
}
