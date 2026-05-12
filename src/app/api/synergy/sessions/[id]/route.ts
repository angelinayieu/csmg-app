// ── /api/synergy/sessions/[id] ──
//
// GET    → load a session with all its nodes + strokes
// PATCH  → update title or objective fields
// DELETE → cascade-delete the session (nodes + strokes go with it via FK)

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: session, error: sessionError } = await db
    .from("brainstorm_sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [{ data: nodes }, { data: strokes }] = await Promise.all([
    db.from("brainstorm_nodes").select("*").eq("session_id", id).order("created_at", { ascending: true }),
    db.from("brainstorm_strokes").select("*").eq("session_id", id).order("created_at", { ascending: true }),
  ]);

  return NextResponse.json({
    session,
    nodes: nodes ?? [],
    strokes: strokes ?? [],
  });
}

interface PatchBody {
  title?: unknown;
  objective_statement?: unknown;
  objective_constraints?: unknown;
  objective_success_criteria?: unknown;
  state?: unknown;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<PatchBody>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {};
  if (typeof body.title === "string") updates.title = body.title.slice(0, 200);
  if (typeof body.objective_statement === "string") {
    updates.objective_statement = body.objective_statement.slice(0, 1000);
    updates.objective_detected_at = new Date().toISOString();
  }
  if (Array.isArray(body.objective_constraints)) {
    updates.objective_constraints = body.objective_constraints
      .filter((c): c is string => typeof c === "string")
      .slice(0, 20)
      .map((c) => c.slice(0, 400));
  }
  if (Array.isArray(body.objective_success_criteria)) {
    updates.objective_success_criteria = body.objective_success_criteria
      .filter((c): c is string => typeof c === "string")
      .slice(0, 20)
      .map((c) => c.slice(0, 400));
  }
  if (typeof body.state === "string" &&
      ["drafting", "processed", "published", "archived"].includes(body.state)) {
    updates.state = body.state;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: session, error } = await db
    .from("brainstorm_sessions")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !session) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: error?.code === "PGRST116" ? 404 : 500 },
    );
  }

  return NextResponse.json({ session });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db.from("brainstorm_sessions").delete().eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
