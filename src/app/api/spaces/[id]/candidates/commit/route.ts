// ── /api/spaces/[id]/candidates/commit ───────────────────────────────
//
// Phase 7c-2. Write-side endpoint for the CandidateReviewDrawer.
//
// POST body shape:
//   {
//     accept: string[]   // candidate ids the user picked
//     reject?: string[]  // candidate ids the user explicitly rejected
//                        //   (defaults to all OTHER pending in the
//                        //    same batch when batchId is provided)
//     batchId?: string   // when present + reject omitted, all pending
//                        //   candidates in this batch NOT in `accept`
//                        //   get auto-rejected. Convenient one-shot
//                        //   "commit the picked, drop the rest" call.
//   }
//
// For each accepted candidate the endpoint dispatches on `kind` to
// materialize into the live KG table. The per-kind materialize logic
// now lives in @/lib/pipeline/materialize-candidates so other write
// paths (e.g. the OC brainstorm → KG route) reuse it without forking.
//
// Returns a per-candidate result map so the drawer can show "12/15
// committed, 3 deferred" with the exact IDs.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import type { CandidateRow } from "@/lib/pipeline/candidates";
import {
  materializeCandidate,
  type MaterializeOutcome,
} from "@/lib/pipeline/materialize-candidates";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface CommitBody {
  accept?: unknown;
  reject?: unknown;
  batchId?: unknown;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = await safeJsonParse<CommitBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const accept = sanitizeIdList(body.accept);
  const explicitReject = sanitizeIdList(body.reject);
  const batchId =
    typeof body.batchId === "string" && body.batchId.length > 0
      ? body.batchId
      : null;

  if (accept.length === 0 && explicitReject.length === 0 && !batchId) {
    return NextResponse.json(
      { error: "Provide at least one of: accept[], reject[], or batchId" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch the candidate rows. We pull ALL by id-list (or the batch)
  // so we have the payloads to materialize plus the row ids to mark.
  const targetIds = new Set<string>([...accept, ...explicitReject]);
  let query = db
    .from("pipeline_candidates")
    .select("*")
    .eq("space_id", spaceId)
    .eq("created_by", user.id)
    .eq("status", "pending");
  if (batchId) {
    query = query.eq("batch_id", batchId);
  } else {
    query = query.in("id", Array.from(targetIds));
  }

  const { data: rows, error: readErr } = await query;
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const candidates = (rows as CandidateRow[] | null) ?? [];

  // Build the final accept/reject sets. When a batchId is supplied
  // WITHOUT an explicit reject list, everything in the batch NOT in
  // accept gets implicit-rejected.
  const acceptSet = new Set<string>(accept);
  const rejectSet = new Set<string>(explicitReject);
  if (batchId && explicitReject.length === 0) {
    for (const c of candidates) {
      if (!acceptSet.has(c.id)) rejectSet.add(c.id);
    }
  }

  // Per-candidate outcome map.
  const outcomes: Record<string, MaterializeOutcome> = {};

  // ── Materialize accepted ─────────────────────────────────────────
  for (const c of candidates) {
    if (!acceptSet.has(c.id)) continue;
    outcomes[c.id] = await materializeCandidate(db, spaceId, user.id, c);
  }

  // ── Mark all decided rows ────────────────────────────────────────
  // Single UPDATE per status — cheaper than per-row even if it means
  // two round-trips total. Skips rows that errored during materialize.
  const acceptedIds = Object.entries(outcomes)
    .filter(([, o]) => o.status === "committed" || o.status === "deferred")
    .map(([id]) => id);
  const rejectedIds = Array.from(rejectSet);

  if (acceptedIds.length > 0) {
    await db
      .from("pipeline_candidates")
      .update({ status: "accepted", decided_at: new Date().toISOString() })
      .in("id", acceptedIds);
  }
  if (rejectedIds.length > 0) {
    await db
      .from("pipeline_candidates")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .in("id", rejectedIds);
    for (const id of rejectedIds) outcomes[id] = { status: "rejected" };
  }

  // Summary counts for the drawer to render the toast.
  const summary = Object.values(outcomes).reduce(
    (acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return NextResponse.json({ outcomes, summary });
}

// Cast unknown input to string[] safely. Filters out non-strings and
// trims; defends against the body shape drifting.
function sanitizeIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.length > 0) out.push(x);
  }
  return out;
}
