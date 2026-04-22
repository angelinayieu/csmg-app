// GET  /api/spaces/:id/threads[?rootShapeId=xxx]  — list threads in a space
//                                                    (filter by root when given)
// POST /api/spaces/:id/threads                    — create a new thread row
//
// Arc 5A. The canvas's ThreadNoteShape is a visual wrapper; the source of
// truth for content, authorship, and lifecycle lives here in
// `shape_threads`. The canvas hydrates from this endpoint on mount so
// comments survive browser refresh, tldraw document corruption, and
// future multi-device collab.
//
// Ownership: RLS policies enforce space ownership via the spaces FK. We
// also check user_id on write because RLS on INSERT is WITH CHECK only
// and we want a friendly 403 over a generic DB error.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 30;

export interface ShapeThreadRow {
  id: string;
  space_id: string;
  user_id: string;
  shape_id: string;
  parent_shape_id: string | null;
  root_shape_id: string;
  thread_depth: number;
  content: string;
  author_display: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListThreadsResponse {
  threads: ShapeThreadRow[];
}

export interface CreateThreadBody {
  shape_id: string;
  parent_shape_id: string | null;
  root_shape_id: string;
  thread_depth: number;
  content?: string;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const rootShapeId = url.searchParams.get("rootShapeId");

  let query = db
    .from("shape_threads")
    .select(
      "id, space_id, user_id, shape_id, parent_shape_id, root_shape_id, thread_depth, content, author_display, created_at, updated_at",
    )
    .eq("space_id", spaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (rootShapeId) {
    query = query.eq("root_shape_id", rootShapeId);
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load threads" },
      { status: 500 },
    );
  }

  const payload: ListThreadsResponse = { threads: (rows ?? []) as ShapeThreadRow[] };
  return NextResponse.json(payload);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: CreateThreadBody;
  try {
    body = (await req.json()) as CreateThreadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.shape_id || typeof body.shape_id !== "string") {
    return NextResponse.json(
      { error: "shape_id is required" },
      { status: 400 },
    );
  }
  if (!body.root_shape_id || typeof body.root_shape_id !== "string") {
    return NextResponse.json(
      { error: "root_shape_id is required" },
      { status: 400 },
    );
  }

  // Ownership: the row user_id must match the caller. RLS enforces this
  // too, but a friendly 403 > a DB error.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Snapshot author_display from the profile table so renames don't
  // rewrite thread authorship retroactively.
  const { data: profile } = await db
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const authorDisplay = (profile?.display_name as string | null) ?? null;

  const { data: inserted, error: insertErr } = await db
    .from("shape_threads")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      shape_id: body.shape_id,
      parent_shape_id: body.parent_shape_id ?? null,
      root_shape_id: body.root_shape_id,
      thread_depth: body.thread_depth ?? 0,
      content: body.content ?? "",
      author_display: authorDisplay,
    })
    .select(
      "id, space_id, user_id, shape_id, parent_shape_id, root_shape_id, thread_depth, content, author_display, created_at, updated_at",
    )
    .single();

  if (insertErr) {
    // 23505 = unique constraint violation on shape_id (thread for this
    // shape_id already exists — race). Return the existing row.
    if ((insertErr as { code?: string }).code === "23505") {
      const { data: existing } = await db
        .from("shape_threads")
        .select(
          "id, space_id, user_id, shape_id, parent_shape_id, root_shape_id, thread_depth, content, author_display, created_at, updated_at",
        )
        .eq("shape_id", body.shape_id)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ thread: existing as ShapeThreadRow });
      }
    }
    return NextResponse.json(
      { error: insertErr.message ?? "Create failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ thread: inserted as ShapeThreadRow });
}
