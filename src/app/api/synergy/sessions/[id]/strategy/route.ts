// ── GET /api/synergy/sessions/[id]/strategy ──
//
// Load the latest strategy doc for a session along with its blocks
// (filtered to current_generation_id) and the session's components
// (which back the upstream/downstream sections). Returns null when
// no strategy has been generated yet — the page renders an empty
// "Generate strategy" CTA in that case.

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

  const [strategyRes, componentsRes] = await Promise.all([
    db
      .from("synergy_strategies")
      .select(
        "id, session_id, statement, pitch, status, current_generation_id, created_at, updated_at",
      )
      .eq("session_id", sessionId)
      .maybeSingle(),
    db
      .from("brainstorm_components")
      .select(
        "id, kind, subkind, label_public, description_public, visibility, created_at",
      )
      .eq("session_id", sessionId)
      .order("kind", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (strategyRes.error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(strategyRes.error) },
      { status: 500 },
    );
  }

  if (!strategyRes.data) {
    return NextResponse.json({
      strategy: null,
      blocks: [],
      components: componentsRes.data ?? [],
    });
  }

  const strategy = strategyRes.data as {
    id: string;
    current_generation_id: string | null;
  };

  // Pull only the current generation's blocks — historical generations
  // stay in the DB for future "version history" UI.
  let blocks: unknown[] = [];
  if (strategy.current_generation_id) {
    const { data, error } = await db
      .from("synergy_strategy_blocks")
      .select("id, block_type, body, sort_order, meta, created_at")
      .eq("strategy_id", strategy.id)
      .eq("generation_id", strategy.current_generation_id)
      .order("sort_order", { ascending: true });
    if (error) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(error) },
        { status: 500 },
      );
    }
    blocks = data ?? [];
  }

  return NextResponse.json({
    strategy: strategyRes.data,
    blocks,
    components: componentsRes.data ?? [],
  });
}
