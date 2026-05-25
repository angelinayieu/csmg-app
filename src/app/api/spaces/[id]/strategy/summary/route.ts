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
//   - effectiveness_check (independent LLM judge verdict — surfaces
//     "is this strategy actually good?" badge in the expanded view)
//   - signal_to_action (hidden signals → linked actions table; lets
//     the user see WHY each action exists and what gets ignored if
//     skipped, with entity chips for trace-back)
//   - expansion_axioms (mini-axioms surfaced from whiteboard /expand
//     calls; grouped by parent entity, with load-bearing + visibility
//     tags so the user sees what assumptions the strategy rests on)
//   - entity_name_map (entity_id → display name for ONLY the IDs
//     referenced by the above fields, so the canvas card can render
//     clickable chips without paying for the full KG payload)
//
// Owner-RLS-gated via the spaces row. ~15-40KB payload.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type {
  StrategicRecommendationData,
  StrategicRecommendation,
  RankedStrategy,
  MicroTactic,
} from "@/types/strategy";
import type {
  SignalToAction,
  StrategyEffectivenessCheck,
} from "@/types/synthesis";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Shape of one expansion_axiom row inside synthesis_data JSONB. Not
 *  a top-level synthesis type, so inlined here. */
interface ExpansionAxiomRow {
  claim: string;
  visibility: "EXPLICIT" | "IMPLICIT" | "HIDDEN";
  load_bearing: "critical" | "important" | "moderate";
  rests_on_components: string[];
  if_false: string;
  validation_path: string;
  parent_entity_id: string;
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

  // ── Pull effectiveness check (independent judge verdict) ──
  // Persisted at synthesis_data.strategy_effectiveness_check by the
  // post-generation judge call. Hides cleanly when absent (older
  // strategies / soft-failed judge calls).
  const effectivenessCheck = (synthData?.strategy_effectiveness_check ??
    null) as StrategyEffectivenessCheck | null;

  // ── Pull signal_to_action ──
  // Up to 8 rows — beyond that the expanded card gets too long. These
  // are pre-ranked by the synthesis LLM (highest-impact first), so a
  // simple slice preserves the most important.
  const signalToAction: SignalToAction[] = (
    (synthData?.signal_to_action ?? []) as SignalToAction[]
  ).slice(0, 8);

  // ── Pull expansion_axioms ──
  // Filter to critical + hidden first — these are the load-bearing
  // assumptions the user MUST see. Then take up to 12 total. Avoids
  // dumping moderate/explicit ones that already feel obvious.
  const allAxioms: ExpansionAxiomRow[] = (synthData?.expansion_axioms ??
    []) as ExpansionAxiomRow[];
  const prioritizedAxioms: ExpansionAxiomRow[] = [
    ...allAxioms.filter(
      (ax) => ax.load_bearing === "critical" || ax.visibility === "HIDDEN",
    ),
    ...allAxioms.filter(
      (ax) => ax.load_bearing !== "critical" && ax.visibility !== "HIDDEN",
    ),
  ].slice(0, 12);

  // ── Collect entity IDs that need name lookups ──
  // From signal_to_action.connected_entities + expansion_axioms
  // .parent_entity_id. Dedupe. We then do a single query for just
  // these IDs — keeps payload narrow.
  const referencedEntityIds = new Set<string>();
  for (const s of signalToAction) {
    for (const eid of s.connected_entities ?? []) {
      if (eid) referencedEntityIds.add(eid);
    }
  }
  for (const ax of prioritizedAxioms) {
    if (ax.parent_entity_id) referencedEntityIds.add(ax.parent_entity_id);
  }

  // ── Look up entity names ──
  // entity_id field is the user-visible code (e.g. "C7"), id is the
  // UUID. Both may appear in references depending on which subsystem
  // emitted the ID. Run two parallel .in() queries (safer than .or()
  // with quoted IN clauses which can break on edge characters), merge
  // results into one lookup map.
  const entityNameMap: Record<string, string> = {};
  if (referencedEntityIds.size > 0) {
    const ids = Array.from(referencedEntityIds);
    const [byUuidRes, byCodeRes] = await Promise.all([
      db
        .from("entities")
        .select("id, entity_id, name")
        .eq("space_id", id)
        .in("id", ids),
      db
        .from("entities")
        .select("id, entity_id, name")
        .eq("space_id", id)
        .in("entity_id", ids),
    ]);
    const merged = [
      ...((byUuidRes.data ?? []) as Array<{
        id: string;
        entity_id: string;
        name: string;
      }>),
      ...((byCodeRes.data ?? []) as Array<{
        id: string;
        entity_id: string;
        name: string;
      }>),
    ];
    for (const e of merged) {
      if (e?.name) {
        if (e.id) entityNameMap[e.id] = e.name;
        if (e.entity_id) entityNameMap[e.entity_id] = e.name;
      }
    }
  }

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
    // ── New surfacing fields ──
    effectiveness_check: effectivenessCheck,
    signal_to_action: signalToAction,
    expansion_axioms: prioritizedAxioms,
    entity_name_map: entityNameMap,
  });
}
