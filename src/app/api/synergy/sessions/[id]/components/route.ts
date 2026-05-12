// ── GET /api/synergy/sessions/[id]/components ──
//
// List the components extracted from this session. Owner-only (RLS).
// Used by the processing page on mount to show the most recent
// extraction without re-running the LLM.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("brainstorm_components")
    .select(
      "id, kind, subkind, label_public, description_public, description_private, visibility, created_at",
    )
    .eq("session_id", sessionId)
    .order("kind", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }

  return NextResponse.json({ components: data ?? [] });
}
