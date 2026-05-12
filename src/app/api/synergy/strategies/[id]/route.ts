// ── PATCH /api/synergy/strategies/[id] ──
//
// Inline edits on the parent strategy row. Currently supports
// statement + pitch. Status transitions (draft → published) will
// land with Phase 4's publish handoff.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  statement?: unknown;
  pitch?: unknown;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};
  if (typeof body.statement === "string") {
    update.statement = body.statement.slice(0, 400);
  }
  if (typeof body.pitch === "string") {
    update.pitch = body.pitch.slice(0, 600);
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: updated, error: updateErr } = await db
    .from("synergy_strategies")
    .update(update)
    .eq("id", id)
    .select(
      "id, session_id, statement, pitch, status, current_generation_id, created_at, updated_at",
    )
    .single();
  if (updateErr || !updated) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(updateErr) },
      { status: 500 },
    );
  }
  return NextResponse.json({ strategy: updated });
}
