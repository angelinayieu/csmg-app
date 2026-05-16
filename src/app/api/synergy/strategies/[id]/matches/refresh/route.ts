// ── POST /api/synergy/strategies/[id]/matches/refresh ──
//
// Manually re-run the parallel-path matcher for one strategy. The
// Inngest path fires automatically on generate; this endpoint is the
// synchronous escape hatch for:
//   - Backfill scripts
//   - "I think my matches are stale" user action (future: button on
//     /app/synergy/rooms)
//   - Admin debugging
//
// Owner-only via the same load-then-act pattern as the embed route.
// Embeds first if the strategy has no embedding yet, then runs the
// matcher. Synchronous end-to-end (capped at 60s by Vercel).

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { embedStrategy } from "@/lib/synergy/strategy-embed";
import {
  loadStrategySource,
  matchOneStrategy,
} from "@/lib/synergy/strategy-matcher";

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

  // Owner check (same pattern as embed route).
  const { data: ownership } = await db
    .from("synergy_strategies")
    .select("id, embedding, matchable, status, brainstorm_sessions!inner(owner_id)")
    .eq("id", strategyId)
    .maybeSingle();
  if (!ownership) {
    return NextResponse.json(
      { error: "Strategy not found" },
      { status: 404 },
    );
  }
  const session = (
    ownership as { brainstorm_sessions?: { owner_id?: string } }
  ).brainstorm_sessions;
  if (!session || session.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const o = ownership as { matchable: boolean; status: string };
  if (!o.matchable) {
    return NextResponse.json(
      { error: "Strategy is not matchable" },
      { status: 400 },
    );
  }
  if (o.status !== "published") {
    return NextResponse.json(
      { error: "Strategy is not published" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdb = createServiceClient() as any;

  try {
    // Step 1: embed if missing. embedStrategy is a no-op if the
    // strategy isn't matchable / has no statement / etc.
    const embedResult = await embedStrategy(sdb, strategyId);
    if (!embedResult.embedded) {
      return NextResponse.json({
        embedded: false,
        skip_reason: embedResult.reason ?? "unknown",
        candidates_considered: 0,
        matches_persisted: 0,
      });
    }

    // Step 2: run the matcher.
    const source = await loadStrategySource(sdb, strategyId);
    if (!source) {
      return NextResponse.json({
        embedded: true,
        skip_reason: "source_unavailable",
        candidates_considered: 0,
        matches_persisted: 0,
      });
    }
    const matchResult = await matchOneStrategy(sdb, source);

    return NextResponse.json({
      embedded: true,
      candidates_considered: matchResult.candidates_considered,
      matches_persisted: matchResult.matches_persisted,
    });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
