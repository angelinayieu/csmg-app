// PATCH  /api/spaces/:id/threads/:threadId  — update content
// DELETE /api/spaces/:id/threads/:threadId  — soft delete (sets deleted_at)
//
// Arc 5A. Per-row mutations for a single thread note. Delete is soft so
// undo works across sessions — tldraw's native undo handles the shape-
// level reversal; this just makes the row re-appear on hydrate.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { ShapeThreadRow } from "../route";

export const maxDuration = 30;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  const { id: spaceId, threadId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: { content?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json(
      { error: "content (string) is required" },
      { status: 400 },
    );
  }

  // Ownership guard — RLS also enforces, but we want a precise 403.
  const { data: existing } = await db
    .from("shape_threads")
    .select("id, user_id, space_id")
    .eq("id", threadId)
    .eq("space_id", spaceId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Clamp content length — thread notes are meant to be small. DB text
  // column has no limit but an 8KB cap keeps things sane.
  const content = body.content.slice(0, 8_000);

  const { data: updated, error: updateErr } = await db
    .from("shape_threads")
    .update({ content })
    .eq("id", threadId)
    .select(
      "id, space_id, user_id, shape_id, parent_shape_id, root_shape_id, thread_depth, content, author_display, created_at, updated_at",
    )
    .single();

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message ?? "Update failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ thread: updated as ShapeThreadRow });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  const { id: spaceId, threadId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: existing } = await db
    .from("shape_threads")
    .select("id, user_id")
    .eq("id", threadId)
    .eq("space_id", spaceId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Soft delete — set deleted_at. Descendant threads are NOT auto-deleted
  // on the server side; the client handles cascade removal in tldraw so
  // the visual tree stays consistent, and future hydrate naturally skips
  // them via the deleted_at IS NULL filter.
  const { error: deleteErr } = await db
    .from("shape_threads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", threadId);

  if (deleteErr) {
    return NextResponse.json(
      { error: deleteErr.message ?? "Delete failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, thread_id: threadId });
}
