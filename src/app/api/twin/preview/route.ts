// GET /api/twin/preview?spaceId=X&rank=1
//
// Twin preview gate (Item 4 of conversational approval arc).
// Returns projected TwinState for a proposed strategy BEFORE the user confirms
// it — so the user can see "how will my operating twin change if I approve
// this strategy?" Pure read + compute, no persistence.
//
// The strategy to preview is selected by `rank` (1 = top-ranked recommendation
// from the latest strategy-refresh). Default: rank=1.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { computeProposedTwinState } from "@/lib/twin/compute-proposed-twin-state";
import type { Entity, Edge, Cycle, Space } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendation, RankedStrategy } from "@/types/strategy";
import type { ImprovementGoal } from "@/types/goals";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("spaceId");
  const rankParam = url.searchParams.get("rank");
  const rank = rankParam ? Math.max(1, parseInt(rankParam, 10)) : 1;

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Pull space + graph + synthesis + active goal in parallel
  const [spaceRes, entRes, edgeRes, cycleRes, goalRes] = await Promise.all([
    db.from("spaces").select("*").eq("id", spaceId).single(),
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db.from("cycles").select("*").eq("space_id", spaceId),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!spaceRes?.data || spaceRes.data.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const space = spaceRes.data as Space;
  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgeRes.data ?? []) as Edge[];
  const cycles = (cycleRes.data ?? []) as Cycle[];
  const activeGoal = (goalRes?.data ?? null) as ImprovementGoal | null;

  const synthData = (space.synthesis_data ?? null) as SynthesisData | null;
  const stratBlob = (synthData as unknown as { strategic_recommendation?: { recommendation?: StrategicRecommendation; ranked_strategies?: RankedStrategy[] } })?.strategic_recommendation;

  if (!stratBlob) {
    return NextResponse.json({ error: "No strategy to preview. Generate a strategy first." }, { status: 400 });
  }

  // Pick the recommendation matching the requested rank
  let proposedRecommendation: StrategicRecommendation | null = null;
  if (stratBlob.ranked_strategies?.length) {
    const ranked = stratBlob.ranked_strategies.find((r) => r.rank === rank);
    proposedRecommendation = ranked?.recommendation ?? stratBlob.ranked_strategies[0]?.recommendation ?? null;
  }
  if (!proposedRecommendation && stratBlob.recommendation) {
    proposedRecommendation = stratBlob.recommendation;
  }
  if (!proposedRecommendation) {
    return NextResponse.json({ error: `No strategy found at rank ${rank}` }, { status: 404 });
  }

  try {
    const delta = computeProposedTwinState(
      space,
      entities,
      edges,
      cycles,
      synthData,
      proposedRecommendation,
      activeGoal,
    );
    return NextResponse.json({
      rank,
      strategy_title: proposedRecommendation.title,
      ...delta,
    });
  } catch (err) {
    console.error("[twin preview] computation failed:", err);
    return NextResponse.json({ error: "Twin preview computation failed" }, { status: 500 });
  }
}
