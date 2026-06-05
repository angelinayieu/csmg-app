// PATCH/DELETE /api/objective/[spaceId]/comments/[commentId]
//
// Edit body / change status / re-anchor targets / store the analysis
// cluster IDs / delete. Owner-only via RLS — the route only orchestrates
// the validated patch.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";

export const runtime = "nodejs";

interface PatchBody {
  body?: string;
  status?: "open" | "resolved" | "analyzed";
  targetShapeIds?: string[];
  analysisCardIds?: string[];
}

export async function PATCH(
  request: Request,
  {
    params,
  }: { params: Promise<{ spaceId: string; commentId: string }> },
) {
  const { spaceId, commentId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body } = await safeJsonParse<PatchBody>(request);

  // Whitelist the patchable columns — anything not in this object is
  // ignored, so the client can't promote itself or hijack author_id.
  const patch: Record<string, unknown> = {};
  if (typeof body?.body === "string") patch.body = body.body.slice(0, 4000);
  if (
    body?.status === "open" ||
    body?.status === "resolved" ||
    body?.status === "analyzed"
  )
    patch.status = body.status;
  if (Array.isArray(body?.targetShapeIds))
    patch.target_shape_ids = body.targetShapeIds
      .filter((s): s is string => typeof s === "string")
      .slice(0, 24);
  if (Array.isArray(body?.analysisCardIds))
    patch.analysis_card_ids = body.analysisCardIds
      .filter((s): s is string => typeof s === "string")
      .slice(0, 60);

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "no patchable fields" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const { data, error } = await db
      .from("comments")
      .update(patch)
      .eq("id", commentId)
      .eq("space_id", spaceId)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ comment: data });
  } catch (err) {
    console.warn("[comments PATCH]", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: { params: Promise<{ spaceId: string; commentId: string }> },
) {
  const { spaceId, commentId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const { error } = await db
      .from("comments")
      .delete()
      .eq("id", commentId)
      .eq("space_id", spaceId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[comments DELETE]", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
