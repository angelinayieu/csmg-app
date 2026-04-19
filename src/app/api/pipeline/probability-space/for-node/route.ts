// ── Node Probability Space: for-node route ──
//
// Given a focal entity in a space, enumerate its convergent points across
// Tier 1-3 interactor combinations, rank them against the user's objectives,
// persist to convergent_points, and return the ranked list.
//
// This is the outer-loop complement to the edge-level probability-space-engine:
// that one models mediators *inside* a single edge; this one enumerates *which*
// edges/combinations are worth considering for a focal node.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import { resilientInsert } from "@/lib/sanitize";
import { extractRoles } from "@/lib/probability-space/role-extractor";
import {
  generateInteractors,
  planCombinations,
} from "@/lib/probability-space/interactor-generator";
import {
  runConvergenceEngine,
  toConvergentPointRow,
  type PlannedConvergence,
  type EngineContext,
} from "@/lib/probability-space/convergence-engine";
import {
  rankConvergentPoints,
  type Objective,
} from "@/lib/probability-space/objective-ranker";
import { retrievePatternsBatch } from "@/lib/probability-space/pattern-retrieval";
import { aggregatePatterns } from "@/lib/probability-space/pattern-aggregator";
import type { Entity, Edge } from "@/types";
import type {
  ProbabilitySpaceRequest,
  ProbabilitySpaceResponse,
  InteractorCandidate,
} from "@/types/convergent-point";

export const maxDuration = 300; // tier-3 analogies + convergence engine + ranker

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: ProbabilitySpaceRequest;
  try {
    body = (await request.json()) as ProbabilitySpaceRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.space_id || !body.focal_entity_id) {
    return NextResponse.json({ error: "space_id and focal_entity_id required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, body.space_id, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const startedAt = Date.now();

    // ── Fetch graph + focal + objectives ──
    const [focalRes, entitiesRes, edgesRes] = await Promise.all([
      db.from("entities").select("*").eq("id", body.focal_entity_id).single(),
      db.from("entities").select("*").eq("space_id", body.space_id),
      db.from("edges").select("*").eq("space_id", body.space_id),
    ]);

    const focal = focalRes.data as Entity | null;
    if (!focal) {
      return NextResponse.json({ error: "Focal entity not found" }, { status: 404 });
    }
    if (focal.space_id !== body.space_id) {
      return NextResponse.json({ error: "Focal entity does not belong to this space" }, { status: 400 });
    }

    const entities = (entitiesRes.data ?? []) as Entity[];
    const edges = (edgesRes.data ?? []) as Edge[];

    // Objectives: caller-supplied, else space-linked improvement_goals
    let objectives: Objective[] = [];
    if (body.objective_ids && body.objective_ids.length > 0) {
      const { data: goalsData } = await db
        .from("improvement_goals")
        .select("id, title, objective_type, description")
        .in("id", body.objective_ids);
      objectives = (goalsData ?? []).map((g: { id: string; title: string; objective_type?: string; description?: string }) => ({
        id: g.id,
        title: g.title,
        objective_type: (g.objective_type as Objective["objective_type"]) ?? "maximize",
        description: g.description,
      }));
    } else {
      // Fall back to any improvement_goals linked to this space
      const { data: goalsData } = await db
        .from("improvement_goals")
        .select("id, title, objective_type, description")
        .eq("space_id", body.space_id)
        .limit(8);
      objectives = (goalsData ?? []).map((g: { id: string; title: string; objective_type?: string; description?: string }) => ({
        id: g.id,
        title: g.title,
        objective_type: (g.objective_type as Objective["objective_type"]) ?? "maximize",
        description: g.description,
      }));
    }

    // ── Step 1: Role extraction (pure) ──
    const focalRoles = extractRoles(focal.id, edges);

    if (focalRoles.length === 0) {
      return NextResponse.json(
        {
          error: "Focal entity has no identifiable roles (no incident edges matching the role library). Cannot generate a probability space for an orphaned entity.",
          focal_entity_id: focal.id,
          focal_entity_name: focal.name,
        },
        { status: 400 },
      );
    }

    // ── Step 2: Interactor generation (pure, tiers 1-3) ──
    const interactors = generateInteractors(focal.id, focalRoles, entities, edges, {
      maxPerTier: body.options?.max_per_tier,
      skipTiers: body.options?.skip_tiers,
    });

    if (interactors.length === 0) {
      return NextResponse.json(
        {
          error: "No interactor candidates found. Focal entity may be truly isolated.",
          roles: focalRoles,
        },
        { status: 400 },
      );
    }

    // Per-tier stats
    const tier1Count = interactors.filter((i) => i.tier === 1).length;
    const tier2Count = interactors.filter((i) => i.tier === 2).length;
    const tier3Count = interactors.filter((i) => i.tier === 3).length;

    // ── Step 3: Combination planning ──
    const combinations = planCombinations(focal.id, interactors, edges, {
      singletonsOnly: body.options?.singletons_only,
    });
    const interactorById = new Map<string, InteractorCandidate>();
    for (const i of interactors) interactorById.set(i.entity_id, i);

    const plans: PlannedConvergence[] = [
      ...combinations.singletons.map((c) => ({
        interactor_ids: c.interactor_ids,
        interactor_tiers: c.interactor_ids.map((id) => (interactorById.get(id)?.tier ?? 1) as 1 | 2 | 3 | 4 | 5),
        combination_reason: c.reason,
        external_conditions: [],
      })),
      ...combinations.pairs.map((c) => ({
        interactor_ids: c.interactor_ids,
        interactor_tiers: c.interactor_ids.map((id) => (interactorById.get(id)?.tier ?? 1) as 1 | 2 | 3 | 4 | 5),
        combination_reason: c.reason,
        external_conditions: [],
      })),
      ...combinations.clusters.map((c) => ({
        interactor_ids: c.interactor_ids,
        interactor_tiers: c.interactor_ids.map((id) => (interactorById.get(id)?.tier ?? 1) as 1 | 2 | 3 | 4 | 5),
        combination_reason: c.reason,
        external_conditions: [],
      })),
    ];

    // ── Step 4a: Pattern retrieval (Phase 2) ──
    // For each planned combination, compute the structural prefix (focal top
    // role × interactor top roles) and fetch matching patterns from the library
    // in one batch. The engine reads this map per combination.
    const focalTopRole = focalRoles[0]?.key ?? "unspecified";
    const uniqueInteractorSets = new Map<
      string,
      { focal_role: string; interactor_roles: string[] }
    >();
    for (const plan of plans) {
      const interactorRoles = plan.interactor_ids.map((uuid) => {
        const rs = extractRoles(uuid, edges);
        return rs[0]?.key ?? "unspecified";
      });
      const key = `${focalTopRole}|${[...interactorRoles].sort().join(",")}`;
      if (!uniqueInteractorSets.has(key)) {
        uniqueInteractorSets.set(key, { focal_role: focalTopRole, interactor_roles: interactorRoles });
      }
    }
    let retrievedPatterns = new Map();
    try {
      retrievedPatterns = await retrievePatternsBatch(
        db,
        Array.from(uniqueInteractorSets.values()),
        { limit: 3, min_occurrences: 2 },
      );
      const totalPatterns = Array.from(retrievedPatterns.values()).reduce((s, arr) => s + arr.length, 0);
      if (totalPatterns > 0) {
        console.log(`[probability-space/for-node] Pattern retrieval: ${totalPatterns} patterns across ${retrievedPatterns.size} distinct signatures`);
      }
    } catch (retrievalErr) {
      console.warn("[probability-space/for-node] Pattern retrieval failed (non-critical):", retrievalErr);
    }

    // ── Step 4b: Convergence engine ──
    const entitiesByUuid = new Map<string, Entity>();
    for (const e of entities) entitiesByUuid.set(e.id, e);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allFaults = entities.filter((e) => (e.entity_category as string) === "fault");

    const engineCtx: EngineContext = {
      focal,
      focal_roles: focalRoles,
      entitiesByUuid,
      allEdges: edges,
      allFaults,
      rolesFor: (uuid) => extractRoles(uuid, edges),
      userObjectives: objectives.map((o) => ({ id: o.id, title: o.title })),
      retrievedPatterns,
    };

    const maxPoints = body.options?.max_points ?? 30;
    const { generated, stats: engineStats } = await runConvergenceEngine(plans, engineCtx, maxPoints);

    const successfullyGenerated = generated.filter((g): g is NonNullable<typeof g> => g !== null);

    if (successfullyGenerated.length === 0) {
      return NextResponse.json(
        {
          error: "Convergence engine produced zero successful predictions.",
          attempted: engineStats.attempted,
        },
        { status: 500 },
      );
    }

    // ── Step 5: Objective ranking ──
    const { ranked, stats: rankerStats } = await rankConvergentPoints(
      successfullyGenerated.map((g) => ({
        outcome: g.outcome,
        probability: g.probability,
        confidence: g.confidence,
      })),
      objectives,
    );

    // Merge alignment back into generated records
    const byIndex = new Map<number, { composite_score: number; objective_alignment: Array<{ objective_id: string; objective_title: string; score: number; reasoning: string }> }>();
    for (const r of ranked) byIndex.set(r.index, { composite_score: r.composite_score, objective_alignment: r.objective_alignment });

    const rowsToInsert = successfullyGenerated.map((g, idx) => {
      const rank = byIndex.get(idx);
      const base = toConvergentPointRow(g, body.space_id);
      return {
        ...base,
        objective_alignment: rank?.objective_alignment ?? [],
      };
    });

    // ── Step 6: Persist ──
    const { data: insertedRows } = await resilientInsert(db, "convergent_points", rowsToInsert, "id");

    // ── Step 6b: Auto-aggregate patterns (non-blocking on failure) ──
    // Learning from usage. Runs incrementally on points inserted above (plus
    // any lingering unaggregated points from previous runs). Threshold 2.
    let aggregationStats = null;
    try {
      aggregationStats = await aggregatePatterns(db, { min_occurrences: 2 });
      if (aggregationStats.patterns_upserted > 0) {
        console.log(
          `[probability-space/for-node] Pattern aggregation: ${aggregationStats.patterns_promoted} promoted, ${aggregationStats.patterns_updated} updated (${aggregationStats.processed_points} points across ${aggregationStats.distinct_signatures} signatures)`,
        );
      }
    } catch (aggErr) {
      console.warn("[probability-space/for-node] Pattern aggregation failed (non-critical):", aggErr);
    }

    // Build response (ranked order)
    const rankedOutput = ranked.map((r) => {
      const g = successfullyGenerated[r.index];
      const row = insertedRows[r.index] as { id?: string } | undefined;
      return {
        id: row?.id ?? `gen_${r.index}`,
        space_id: body.space_id,
        focal_entity_id: g.focal_entity_id,
        interactor_entity_ids: g.interactor_entity_ids,
        external_conditions: g.external_conditions,
        outcome: g.outcome,
        probability: g.probability,
        confidence: g.confidence,
        generation_method: g.generation_method,
        pattern_tag: g.pattern_tag,
        structural_signature: g.structural_signature,
        objective_alignment: r.objective_alignment,
        evidence_basis: g.evidence_basis,
        composite_score: r.composite_score,
        generated_at: new Date().toISOString(),
      };
    });

    const response: ProbabilitySpaceResponse & { ranked_composite_scores: number[] } = {
      space_id: body.space_id,
      focal_entity_id: focal.id,
      focal_entity_name: focal.name,
      roles: focalRoles,
      interactor_candidates: interactors,
      combinations_explored: plans.length,
      convergent_points: rankedOutput,
      ranked_composite_scores: ranked.map((r) => r.composite_score),
      stats: {
        tier_1_interactors: tier1Count,
        tier_2_interactors: tier2Count,
        tier_3_interactors: tier3Count,
        llm_calls: engineStats.attempted + rankerStats.llm_calls,
        duration_ms: Date.now() - startedAt,
      },
    };

    // Non-critical changelog
    await db
      .from("space_changelog")
      .insert({
        space_id: body.space_id,
        change_type: "probability_space",
        summary: `Probability space for ${focal.name}: ${rankedOutput.length} convergent points across ${interactors.length} interactors (${tier1Count}T1/${tier2Count}T2/${tier3Count}T3)`,
        details: {
          focal_entity_id: focal.id,
          convergent_point_count: rankedOutput.length,
          tier_counts: { 1: tier1Count, 2: tier2Count, 3: tier3Count },
          llm_calls: response.stats.llm_calls,
          duration_ms: response.stats.duration_ms,
          pattern_retrievals: Array.from(retrievedPatterns.values()).reduce((s, arr) => s + arr.length, 0),
          aggregation: aggregationStats
            ? {
                promoted: aggregationStats.patterns_promoted,
                updated: aggregationStats.patterns_updated,
                processed: aggregationStats.processed_points,
              }
            : null,
        },
      })
      .then(
        () => {},
        () => {},
      );

    return NextResponse.json(response);
  } catch (err) {
    console.error("[probability-space/for-node] Error:", err);
    return NextResponse.json(
      { error: `Probability space generation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
