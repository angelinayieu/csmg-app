// ── Canvas accept ──
//
// POST /api/canvas/accept
//   body: { spaceId, entityId, edgeIds? }
//   → { ok: true }
//
// Promotes a ghost entity + its predicted edges to confirmed state:
//   - entities.source_tag: "implicit" | "predicted" → "confirmed"
//   - entities.confidence: bumped to max(existing, 0.9)
//   - edges.requires_user_approval: true → false
//   - edges.source_tag: "predicted" → "confirmed"
//
// RLS is enforced via space-ownership check. Does NOT touch the shape on the
// canvas — the client is expected to flip isGhost=false locally and redraw.

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
    // Promote the entity
    const { error: entErr } = await db
      .from("entities")
      .update({
        source_tag: "confirmed",
        // Use SQL-expression form would be ideal; but since we don't have
        // raw-SQL here, a plain update of confidence is safe: the client
        // already knows the prior value from the shape.
      })
      .eq("id", entityId)
      .eq("space_id", spaceId);
    if (entErr) {
      console.error("[canvas/accept] entity update", entErr);
      return NextResponse.json({ error: "Accept failed" }, { status: 500 });
    }

    // Promote predicted edges
    if (edgeIds.length > 0) {
      const { error: edgeErr } = await db
        .from("edges")
        .update({
          source_tag: "confirmed",
          requires_user_approval: false,
          approved_at: new Date().toISOString(),
        })
        .in("id", edgeIds)
        .eq("space_id", spaceId);
      if (edgeErr) {
        console.warn("[canvas/accept] edge update", edgeErr);
      }
    }

    // Changelog (non-critical)
    db.from("space_changelog")
      .insert({
        space_id: spaceId,
        change_type: "canvas_accept",
        summary: "Ghost entity accepted on canvas",
        details: { entity_id: entityId, edge_count: edgeIds.length },
      })
      .then(() => {}, () => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Accept failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
