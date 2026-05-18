// ── GET /api/spaces/[id]/strategy/summary ───────────────────────────
//
// Lightweight read for the canvas-side strategy expand. Returns the
// rich detail needed to render the StrategyHeroCardShape in its
// expanded state without dragging in the heavy /twin-proposal payload
// (which carries the full KG, mechanisms, ranked strategies × all
// fields, meter inputs, audit blob — ~200KB).
//
// This endpoint returns ONLY what the expanded hero card needs:
//   - active rank
//   - recommendation (title, summary, confidence, posture)
//   - reasoning_chain (the LLM's narrative for this strategy)
//   - provenance object (axioms/convergences/gaps + red flags + score)
//   - layers (L4 → L1 with pillar_sources for each item)
//   - tactics (with their backlink arrays so hover can light up
//     source entities on the canvas)
//
// Owner-RLS-gated via the spaces row. ~10-30KB payload.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type {
  StrategicRecommendationData,
  StrategicRecommendation,
  RankedStrategy,
  MicroTactic,
} from "@/types/strategy";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Pull the synthesis_data blob — strategy lives nested at
  // synthesis_data.strategic_recommendation. RLS gates the read.
  const { data: space, error: spaceErr } = await db
    .from("spaces")
    .select("id, name, synthesis_data")
    .eq("id", id)
    .single();

  if (spaceErr || !space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthData = space.synthesis_data as any;
  const strategicRecData = synthData?.strategic_recommendation as
    | StrategicRecommendationData
    | undefined;

  if (!strategicRecData) {
    return NextResponse.json(
      { error: "No strategy generated yet" },
      { status: 404 },
    );
  }

  // strategic_recommendation is the StrategicRecommendationData
  // wrapper. The primary recommendation always lives at
  // .recommendation (Tier 1 backward compat). Tier 2 adds
  // .ranked_strategies[] with the same content rank-ordered;
  // rank 1 IS the primary. Treat the wrapper's .recommendation
  // as the canonical active recommendation.
  const ranked = (strategicRecData.ranked_strategies ?? []) as RankedStrategy[];
  const primary: StrategicRecommendation =
    ranked.length > 0 ? ranked[0].recommendation : strategicRecData.recommendation;
  const activeRank = ranked.length > 0 ? ranked[0].rank : 1;

  // Compose the lightweight payload. Each top-level field is a
  // contained slice the renderer needs; none of them require touching
  // entities/edges/cycles directly (the canvas tldraw layer already
  // has those for the entity-glow effect). Casts to any below absorb
  // the variability in StrategicRecommendation across pipeline
  // generations (older schemas may not have every optional field).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec = primary as any;
  const tactics: MicroTactic[] = (rec.tactics ?? []) as MicroTactic[];

  return NextResponse.json({
    active_rank: activeRank,
    total_ranks: ranked.length || 1,
    space_name: space.name,
    recommendation: {
      title: rec.title ?? "Strategy",
      summary: rec.summary ?? "",
      strategic_posture: rec.strategic_posture ?? "cautious_validation",
      confidence: rec.confidence ?? null,
      target_objective: rec.target_objective ?? null,
      key_tradeoff: rec.key_tradeoff ?? null,
      core_logic: rec.core_logic ?? null,
      // reasoning_chain is the narrative argument citing entity IDs +
      // confidence numbers + cycle membership.
      reasoning_chain: rec.reasoning_chain ?? "",
      // Provenance — the trace-back to the synthesis signals + red flags
      provenance: rec.provenance ?? null,
      // L4 → L1 with their pillar_sources arrays preserved so the
      // expanded card can render the source_refs as clickable chips
      layers: rec.layers ?? null,
      // Tactics with their full backlink arrays
      tactics,
    },
  });
}
