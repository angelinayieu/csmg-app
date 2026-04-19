import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { rankBridgesByGoalRelevance } from "@/lib/weaving/rank-bridges";
import type { Bridge, Entity, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";

export const maxDuration = 30;

/**
 * POST /api/weave/rerank
 *
 * Body: { spaceId: string }
 *
 * Returns bridges involving the current space, scored by strategic relevance
 * to the active goal + causal chains + strategy perspectives.
 *
 * Deterministic — no LLM call. Fast (<100ms).
 */
export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const parsed = await safeJsonParse<{ spaceId?: string }>(request);
  if (parsed.error) return parsed.error;
  const spaceId = parsed.data?.spaceId;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .single();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const synthesisData =
    typeof spaceRow.synthesis_data === "string"
      ? (JSON.parse(spaceRow.synthesis_data) as SynthesisData)
      : (spaceRow.synthesis_data as SynthesisData | null);

  // Fetch all bridges touching this space (either side)
  const { data: bridgeRows } = await db
    .from("bridges")
    .select("*")
    .or(`source_space_id.eq.${spaceId},target_space_id.eq.${spaceId}`);
  const bridges = (bridgeRows ?? []) as Bridge[];

  if (bridges.length === 0) {
    return NextResponse.json({ ranked: [], total: 0 });
  }

  // Fetch entities + cycles for the current space
  const [entityRes, cycleRes, goalRes] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("cycles").select("*").eq("space_id", spaceId),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .is("parent_goal_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const entities = (entityRes.data ?? []) as Entity[];
  const cycles = (cycleRes.data ?? []) as Cycle[];
  const activeGoal = (goalRes.data ?? null) as ImprovementGoal | null;

  const ranked = rankBridgesByGoalRelevance({
    bridges,
    currentSpaceId: spaceId,
    entities,
    cycles,
    synthesisData,
    activeGoal,
  });

  return NextResponse.json({
    ranked,
    total: ranked.length,
    has_goal: !!activeGoal,
    has_chains: (synthesisData?.causal_chains?.length ?? 0) > 0,
  });
}
