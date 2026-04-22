// GET    /api/spaces/:id/card-chats?cardShapeId=X  — list messages for a card
// POST   /api/spaces/:id/card-chats                 — create a message
// DELETE /api/spaces/:id/card-chats?cardShapeId=X   — clear a card's history
//
// Arc 5C.1 — persists the CardSidecar chat that previously lived in a
// module-scoped Map. Keyed by tldraw shape id (card_shape_id), same
// opaque-text pattern as shape_threads.
//
// Content shape varies by kind — see migration header for the payload
// contract.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 30;

export interface CardChatMessageRow {
  id: string;
  space_id: string;
  user_id: string;
  card_shape_id: string;
  role: "user" | "assistant";
  kind: "text" | "proposed_change";
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ListCardChatsResponse {
  messages: CardChatMessageRow[];
}

export interface CreateCardChatBody {
  card_shape_id: string;
  role: "user" | "assistant";
  kind: "text" | "proposed_change";
  content: Record<string, unknown>;
  /** Optional client-assigned id so optimistic rows can be reconciled
   *  without a second round-trip. When set we upsert, not insert. */
  client_id?: string;
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
  const cardShapeId = url.searchParams.get("cardShapeId");
  if (!cardShapeId) {
    return NextResponse.json(
      { error: "cardShapeId query param required" },
      { status: 400 },
    );
  }

  const { data: rows, error } = await db
    .from("card_chat_messages")
    .select("id, space_id, user_id, card_shape_id, role, kind, content, created_at, updated_at")
    .eq("space_id", spaceId)
    .eq("card_shape_id", cardShapeId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load chat history" },
      { status: 500 },
    );
  }

  const payload: ListCardChatsResponse = {
    messages: (rows ?? []) as CardChatMessageRow[],
  };
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

  let body: CreateCardChatBody;
  try {
    body = (await req.json()) as CreateCardChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.card_shape_id) {
    return NextResponse.json({ error: "card_shape_id required" }, { status: 400 });
  }
  if (body.role !== "user" && body.role !== "assistant") {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  if (body.kind !== "text" && body.kind !== "proposed_change") {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  // Ownership check.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Use the client-supplied id when present so the client can rely on it
  // for subsequent PATCHes without a round-trip to learn the server id.
  const rowId = body.client_id ?? undefined;

  const { data: inserted, error: insertErr } = await db
    .from("card_chat_messages")
    .insert({
      ...(rowId ? { id: rowId } : {}),
      space_id: spaceId,
      user_id: user.id,
      card_shape_id: body.card_shape_id,
      role: body.role,
      kind: body.kind,
      content: body.content ?? {},
    })
    .select(
      "id, space_id, user_id, card_shape_id, role, kind, content, created_at, updated_at",
    )
    .single();

  if (insertErr) {
    return NextResponse.json(
      { error: insertErr.message ?? "Create failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ message: inserted as CardChatMessageRow });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const url = new URL(req.url);
  const cardShapeId = url.searchParams.get("cardShapeId");
  if (!cardShapeId) {
    return NextResponse.json(
      { error: "cardShapeId query param required" },
      { status: 400 },
    );
  }

  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error: deleteErr } = await db
    .from("card_chat_messages")
    .delete()
    .eq("space_id", spaceId)
    .eq("card_shape_id", cardShapeId)
    .eq("user_id", user.id);

  if (deleteErr) {
    return NextResponse.json(
      { error: deleteErr.message ?? "Clear failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
