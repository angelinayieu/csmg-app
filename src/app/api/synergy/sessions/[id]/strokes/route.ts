// ── PUT /api/synergy/sessions/[id]/strokes ──
//
// Replace-all-strokes save. Strokes are write-once on the canvas
// (pen down → up creates one row; eraser removes one row), so the
// replace-all pattern is wasteful in theory but cheap in practice
// since the debounced client save is the only writer.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface Body {
  strokes?: unknown;
}

interface IncomingStroke {
  id?: string;
  points?: Array<[number, number]>;
  color?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  if (!Array.isArray(body.strokes)) {
    return NextResponse.json({ error: "strokes must be an array" }, { status: 400 });
  }
  if (body.strokes.length > 1000) {
    return NextResponse.json({ error: "too many strokes (max 1000)" }, { status: 400 });
  }

  const rows: Array<{
    id: string;
    session_id: string;
    points: Array<[number, number]>;
    color: string;
  }> = [];
  for (const raw of body.strokes as IncomingStroke[]) {
    if (typeof raw.id !== "string" || !Array.isArray(raw.points)) {
      return NextResponse.json({ error: "invalid stroke row" }, { status: 400 });
    }
    if (raw.points.length === 0 || raw.points.length > 5000) {
      return NextResponse.json({ error: "stroke point count out of range" }, { status: 400 });
    }
    rows.push({
      id: raw.id,
      session_id: sessionId,
      points: raw.points,
      color: typeof raw.color === "string" ? raw.color.slice(0, 32) : "#7dd3fc",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: session } = await db
    .from("brainstorm_sessions")
    .select("id")
    .eq("id", sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { error: deleteError } = await db
    .from("brainstorm_strokes")
    .delete()
    .eq("session_id", sessionId);
  if (deleteError) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(deleteError) },
      { status: 500 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const { error: insertError } = await db.from("brainstorm_strokes").insert(rows);
  if (insertError) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertError) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
