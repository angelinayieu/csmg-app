// ── GET /api/synergy/strategies/[id]/summary ──
//
// Lightweight strategy summary for compact surfaces (canvas
// WorkspaceRoomShape, recent-activity feed, future inline previews).
// Pulls a few aggregate counts off the strategy + its current
// generation's blocks so a tile-sized renderer has everything it
// needs in one round trip.
//
// Returns:
//   {
//     strategy: {
//       id, statement, pitch, session_id, updated_at,
//       total_steps, done_steps, risk_count, hypothesis_count,
//       effort_weighted_done_pct,
//     }
//   }
//
// effort_weighted_done_pct uses Phase 1's effort_level
// (Light=1, Medium=2, Heavy=3, untagged=1) so the room reads the
// same progress signal the strategy doc's ProgressStrip does.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const EFFORT_WEIGHT: Record<string, number> = {
  light: 1,
  medium: 2,
  heavy: 3,
};

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: strategy, error: stratErr } = await db
    .from("synergy_strategies")
    .select(
      "id, statement, pitch, session_id, updated_at, current_generation_id",
    )
    .eq("id", id)
    .single();

  if (stratErr || !strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  // Pull only the current generation's blocks. We need block_type +
  // meta to count plan_step / risk / hypothesis and to compute the
  // effort-weighted done %.
  let totalSteps = 0;
  let doneSteps = 0;
  let riskCount = 0;
  let hypothesisCount = 0;
  let totalEffort = 0;
  let doneEffort = 0;

  if (strategy.current_generation_id) {
    const { data: blocks } = await db
      .from("synergy_strategy_blocks")
      .select("block_type, meta")
      .eq("strategy_id", strategy.id)
      .eq("generation_id", strategy.current_generation_id);

    for (const b of (blocks ?? []) as Array<{
      block_type: string;
      meta: Record<string, unknown>;
    }>) {
      if (b.block_type === "plan_step") {
        totalSteps++;
        const status = (b.meta?.status as string | undefined) ?? "pending";
        const effort = (b.meta?.effort_level as string | undefined) ?? "";
        const weight = EFFORT_WEIGHT[effort] ?? 1;
        totalEffort += weight;
        if (status === "done") {
          doneSteps++;
          doneEffort += weight;
        }
      } else if (b.block_type === "risk") {
        riskCount++;
      } else if (b.block_type === "hypothesis") {
        hypothesisCount++;
      }
    }
  }

  const effortWeightedDonePct =
    totalEffort > 0 ? Math.round((doneEffort / totalEffort) * 100) : 0;

  return NextResponse.json({
    strategy: {
      id: strategy.id,
      statement: strategy.statement,
      pitch: strategy.pitch,
      session_id: strategy.session_id,
      updated_at: strategy.updated_at,
      total_steps: totalSteps,
      done_steps: doneSteps,
      risk_count: riskCount,
      hypothesis_count: hypothesisCount,
      effort_weighted_done_pct: effortWeightedDonePct,
    },
  });
}
