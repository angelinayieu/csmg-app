/**
 * POST /api/spaces/[id]/edges/[edgeId]/verdict
 *
 * Records the user's calibration verdict on a prospector-proposed edge.
 * Updates the corresponding `pairwise_connection_checks` row's user_verdict
 * + user_verdict_at. The verdict is the self-learning signal: over time the
 * system learns "prospector's causal proposals have 73% acceptance rate."
 *
 * Body: { verdict: "accepted" | "rejected" | "uncertain" }
 *
 * If verdict is "rejected" we also soft-delete the edge (removing it from the
 * graph) — user already said it's wrong, shouldn't clutter the view.
 */

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";

export const maxDuration = 10;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; edgeId: string }> },
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId, edgeId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: bodyErr } = await safeJsonParse<{
    verdict: "accepted" | "rejected" | "uncertain";
  }>(request);
  if (bodyErr) return bodyErr;

  const verdict = body?.verdict;
  if (verdict !== "accepted" && verdict !== "rejected" && verdict !== "uncertain") {
    return NextResponse.json({ error: "verdict must be accepted|rejected|uncertain" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify the edge exists in this space
  const { data: edge, error: edgeErr } = await db
    .from("edges")
    .select("id, source_entity_id, target_entity_id, provenance")
    .eq("id", edgeId)
    .eq("space_id", spaceId)
    .maybeSingle();

  if (edgeErr || !edge) {
    return NextResponse.json({ error: "Edge not found in this space" }, { status: 404 });
  }

  // Find the pair-check that produced this edge
  const { data: check } = await db
    .from("pairwise_connection_checks")
    .select("id")
    .eq("space_id", spaceId)
    .eq("resulting_edge_id", edgeId)
    .maybeSingle();

  if (check) {
    const { error: updateErr } = await db
      .from("pairwise_connection_checks")
      .update({
        user_verdict: verdict,
        user_verdict_at: new Date().toISOString(),
      })
      .eq("id", check.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }
  // If no check was found (edge wasn't prospector-proposed), we still record
  // the rejection as an edge soft-delete but there's no calibration data to update.

  // Soft-delete on reject
  if (verdict === "rejected") {
    const { error: delErr } = await db
      .from("edges")
      .delete()
      .eq("id", edgeId)
      .eq("space_id", spaceId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, verdict });
}
