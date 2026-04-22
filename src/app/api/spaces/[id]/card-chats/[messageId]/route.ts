// PATCH /api/spaces/:id/card-chats/:messageId — update message content
//
// Arc 5C.1. Used for:
//   • Stage-2 enrichment completion (assistant text messages flip
//     `enriching: true` → `false`, or replace text with deeper answer)
//   • Proposal decision updates (proposed_change messages flip
//     `decision: "pending"` → `"applied" | "skipped"`)
//
// Full content replace rather than partial merge: the client always
// sends the complete payload because the kinds and shape vary.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { CardChatMessageRow } from "../route";

export const maxDuration = 15;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id: spaceId, messageId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: { content?: Record<string, unknown> } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.content || typeof body.content !== "object") {
    return NextResponse.json(
      { error: "content (object) is required" },
      { status: 400 },
    );
  }

  const { data: existing } = await db
    .from("card_chat_messages")
    .select("id, user_id, space_id")
    .eq("id", messageId)
    .eq("space_id", spaceId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: updated, error: updateErr } = await db
    .from("card_chat_messages")
    .update({ content: body.content })
    .eq("id", messageId)
    .select(
      "id, space_id, user_id, card_shape_id, role, kind, content, created_at, updated_at",
    )
    .single();

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message ?? "Update failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ message: updated as CardChatMessageRow });
}
