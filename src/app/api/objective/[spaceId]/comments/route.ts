// GET/POST /api/objective/[spaceId]/comments
//
// List + create comments on an objective whiteboard. Owner-only.
//
// GET  → { comments: Comment[] } ordered newest-first.
// POST → { body, targetShapeIds[] } → { comment }. Author identity is
//        pulled from the authed user and snapshotted onto the row so
//        the card can render the chip without an extra fetch.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";

export const runtime = "nodejs";

export interface CommentRow {
  id: string;
  spaceId: string;
  authorId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: string;
  targetShapeIds: string[];
  status: "open" | "resolved" | "analyzed";
  analysisCardIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface DbComment {
  id: string;
  space_id: string;
  author_id: string;
  author_name: string | null;
  author_avatar_url: string | null;
  body: string;
  target_shape_ids: string[];
  status: "open" | "resolved" | "analyzed";
  analysis_card_ids: string[];
  created_at: string;
  updated_at: string;
}

function rowToComment(r: DbComment): CommentRow {
  return {
    id: r.id,
    spaceId: r.space_id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
    body: r.body,
    targetShapeIds: Array.isArray(r.target_shape_ids) ? r.target_shape_ids : [],
    status: r.status,
    analysisCardIds: Array.isArray(r.analysis_card_ids) ? r.analysis_card_ids : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const { data, error } = await db
      .from("comments")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({
      comments: ((data ?? []) as DbComment[]).map(rowToComment),
    });
  } catch (err) {
    console.warn("[comments GET]", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

interface CreateBody {
  body?: string;
  targetShapeIds?: string[];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body } = await safeJsonParse<CreateBody>(request);
  const text = String(body?.body ?? "").trim().slice(0, 4000);
  const targets = Array.isArray(body?.targetShapeIds)
    ? body.targetShapeIds.filter((s): s is string => typeof s === "string").slice(0, 24)
    : [];

  // Author identity snapshot — what the card chip will render. Mirrors the
  // voice-note pattern so we don't have to re-fetch on every render.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const authorName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (typeof user.email === "string" ? user.email.split("@")[0] : null) ||
    "You";
  const authorAvatarUrl =
    typeof meta.avatar_url === "string" ? meta.avatar_url : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const { data, error } = await db
      .from("comments")
      .insert({
        space_id: spaceId,
        author_id: user.id,
        author_name: authorName,
        author_avatar_url: authorAvatarUrl,
        body: text,
        target_shape_ids: targets,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ comment: rowToComment(data as DbComment) });
  } catch (err) {
    console.warn("[comments POST]", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
