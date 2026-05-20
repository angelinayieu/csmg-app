// ── /api/synergy/rooms/[id]/messages ──
//
// GET  → most recent N messages (chronological asc); used on rail mount.
// POST → insert one message; body { body, kind?, meta? }.
//
// RLS enforces room membership on both verbs. Archived-room guard on
// POST mirrors the node API routes — chat is also disabled once a room
// is archived.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
const VALID_KINDS = ["text", "voice_transcript", "ai_summary"] as const;

// ── GET ────────────────────────────────────────────────────────────

export async function GET(request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("synergy_room_messages")
    .select("id, room_id, author_id, kind, body, meta, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  // Reverse to ascending so the renderer can append to the bottom on
  // Realtime inserts without re-sorting.
  const messages = (data ?? []).slice().reverse();
  return NextResponse.json({ messages });
}

// ── POST ───────────────────────────────────────────────────────────

interface Body {
  body?: unknown;
  kind?: unknown;
  meta?: unknown;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: parsed, error: parseError } = await safeJsonParse<Body>(
    request,
  );
  if (parseError) return parseError;

  if (typeof parsed.body !== "string") {
    return NextResponse.json(
      { error: "body (string) required" },
      { status: 400 },
    );
  }
  const text = parsed.body.trim();
  if (!text) {
    return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
  }

  const kind =
    typeof parsed.kind === "string" &&
    (VALID_KINDS as readonly string[]).includes(parsed.kind)
      ? (parsed.kind as (typeof VALID_KINDS)[number])
      : "text";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Archived-room guard.
  const { data: room } = await db
    .from("synergy_rooms")
    .select("id, archived_at")
    .eq("id", roomId)
    .single();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.archived_at) {
    return NextResponse.json(
      { error: "Room is archived (read-only)" },
      { status: 403 },
    );
  }

  const payload = {
    room_id: roomId,
    author_id: user.id,
    kind,
    body: text.slice(0, 4000),
    meta:
      parsed.meta && typeof parsed.meta === "object" && !Array.isArray(parsed.meta)
        ? (parsed.meta as Record<string, unknown>)
        : null,
  };

  const { data: inserted, error } = await db
    .from("synergy_room_messages")
    .insert(payload)
    .select("id, room_id, author_id, kind, body, meta, created_at")
    .single();
  if (error || !inserted) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  return NextResponse.json({ message: inserted }, { status: 201 });
}
