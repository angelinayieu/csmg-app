// ── Predicted edge accept / reject ──
//
// POST /api/whiteboard/edges/[edgeId]   body: { action: "accept" | "reject" }
//
// Predicted edges (from playground materialize, critique predictions, etc.)
// have source_tag="predicted" and requires_user_approval=true. The user can
// accept (promotes to source_tag="inferred" + clears approval flag) or
// reject (deletes the edge).

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { flagAppsByEntityChange } from "@/lib/apps/staleness-triggers";

export const maxDuration = 10;

export async function POST(request: Request, { params }: { params: Promise<{ edgeId: string }> }) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { edgeId } = await params;
  if (!edgeId) return NextResponse.json({ error: "edgeId required" }, { status: 400 });

  let action: "accept" | "reject";
  try {
    const body = await request.json();
    if (body.action !== "accept" && body.action !== "reject") {
      return NextResponse.json({ error: "action must be 'accept' or 'reject'" }, { status: 400 });
    }
    action = body.action;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Fetch edge + its space for ownership check.
    // source/target ids are pulled here so we can still flag apps stale on
    // reject — after the delete they'd be gone.
    const { data: edge } = await db
      .from("edges")
      .select("id, space_id, source_entity_id, target_entity_id")
      .eq("id", edgeId)
      .maybeSingle();

    if (!edge) return NextResponse.json({ error: "Edge not found" }, { status: 404 });

    const { data: space } = await db
      .from("spaces")
      .select("user_id")
      .eq("id", edge.space_id)
      .maybeSingle();

    if (!space || space.user_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Entity UUIDs touched by this edit — used by the staleness trigger.
    const touchedEntityUuids: string[] = [];
    if (edge.source_entity_id) touchedEntityUuids.push(edge.source_entity_id);
    if (edge.target_entity_id) touchedEntityUuids.push(edge.target_entity_id);

    if (action === "accept") {
      // Promote from predicted → inferred; clear approval flag.
      const { error: updateErr } = await db
        .from("edges")
        .update({
          source_tag: "inferred",
          requires_user_approval: false,
        })
        .eq("id", edgeId);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      // Sprint 3 staleness hook — non-blocking.
      await flagAppsByEntityChange(
        db,
        edge.space_id,
        touchedEntityUuids,
        "whiteboard_edit",
        `user:${user.id}`,
        "Whiteboard edge accepted"
      );

      return NextResponse.json({ accepted: true, edgeId });
    } else {
      // Reject → delete.
      const { error: deleteErr } = await db.from("edges").delete().eq("id", edgeId);
      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 });
      }

      await flagAppsByEntityChange(
        db,
        edge.space_id,
        touchedEntityUuids,
        "whiteboard_edit",
        `user:${user.id}`,
        "Whiteboard edge rejected"
      );

      return NextResponse.json({ rejected: true, edgeId });
    }
  } catch (err) {
    console.error("[whiteboard/edges] Error:", err);
    return NextResponse.json(
      { error: `Edge action failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
