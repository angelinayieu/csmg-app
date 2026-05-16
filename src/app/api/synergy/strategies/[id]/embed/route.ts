// ── POST /api/synergy/strategies/[id]/embed ──
//
// Manually re-embed a strategy. Mostly an admin/debug surface — the
// strategy generate route already fires synergy/strategy.generated
// which embeds via Inngest. This endpoint is the synchronous escape
// hatch for backfill scripts, retries after a soft-fail, and the
// "Owner toggled matchable on" path.
//
// Authorization: owner-only (the session's owner_id must match the
// caller). RLS on synergy_strategies will reject reads from anyone
// else, so the owner check is enforced by the load-then-act pattern
// rather than an explicit IF.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { embedStrategy } from "@/lib/synergy/strategy-embed";

export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: strategyId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Owner check via RLS-gated read. If the caller doesn't own this
  // strategy's session, the join returns no row and we 404.
  const { data: ownership } = await db
    .from("synergy_strategies")
    .select("id, session_id, brainstorm_sessions!inner(owner_id)")
    .eq("id", strategyId)
    .maybeSingle();
  if (!ownership) {
    return NextResponse.json(
      { error: "Strategy not found" },
      { status: 404 },
    );
  }
  // The join projection's exact path depends on Supabase JS version;
  // double-check the owner here defensively.
  const session = (
    ownership as { brainstorm_sessions?: { owner_id?: string } }
  ).brainstorm_sessions;
  if (!session || session.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Use service-role for the embed write (RLS allows owner UPDATE,
  // but service-role is consistent with the matcher path and avoids
  // surprises if the policy changes).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdb = createServiceClient() as any;
  try {
    const result = await embedStrategy(sdb, strategyId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
