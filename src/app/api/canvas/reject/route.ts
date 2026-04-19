// ── Canvas reject ──
//
// POST /api/canvas/reject
//   body: { spaceId, entityId, edgeIds? }
//   → { ok: true }
//
// Deletes a ghost entity + its predicted edges from the graph. Client is
// responsible for removing the shape from the canvas.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage, verifySpaceOwnership } from "@/lib/api-helpers";

export const maxDuration = 15;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    spaceId: string;
    entityId: string;
    edgeIds?: string[];
  }>(request);
  if (parseError) return parseError;

  const { spaceId, entityId, edgeIds = [] } = body;
  if (typeof spaceId !== "string" || typeof entityId !== "string") {
    return NextResponse.json({ error: "spaceId + entityId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Delete predicted edges first (FK order)
    if (edgeIds.length > 0) {
      await db.from("edges").delete().in("id", edgeIds).eq("space_id", spaceId);
    }
    // Fallback: also nuke edges touching this entity with requires_user_approval
    await db
      .from("edges")
      .delete()
      .eq("space_id", spaceId)
      .eq("requires_user_approval", true)
      .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`);

    // Delete the entity
    const { error: entErr } = await db
      .from("entities")
      .delete()
      .eq("id", entityId)
      .eq("space_id", spaceId);
    if (entErr) {
      console.error("[canvas/reject] entity delete", entErr);
      return NextResponse.json({ error: "Reject failed" }, { status: 500 });
    }

    db.from("space_changelog")
      .insert({
        space_id: spaceId,
        change_type: "canvas_reject",
        summary: "Ghost entity rejected on canvas",
        details: { entity_id: entityId, edge_count: edgeIds.length },
      })
      .then(() => {}, () => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Reject failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
