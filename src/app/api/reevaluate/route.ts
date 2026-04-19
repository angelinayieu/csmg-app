import { NextResponse } from "next/server";
import { checkCredits, deductCredits } from "@/lib/credits";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { computeDegreeCentrality } from "@/lib/whiteboard/centrality";
import { runCascadeForSpace } from "@/lib/graph/run-cascade";
import { flagAppsByEntityChange } from "@/lib/apps/staleness-triggers";
import type { Entity, Edge, Cycle } from "@/types";
import { computeDecompFingerprint } from "@/lib/pipeline/cache";
import { appendRun, makeRunId } from "@/lib/pipeline/analysis-runs";
import type { AnalysisRun } from "@/types/analysis-runs";

export const maxDuration = 60;

const VALID_DIMENSIONS = [
  "structural", "functional", "temporal", "causal",
  "correlational", "logical", "epistemic", "comparative", "agentive",
];

interface RevalResult {
  new_edges: Array<{
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    dimension: string;
    strength: number;
    confidence: number;
    reasoning: string;
    dynamics?: string;
    dynamics_properties?: Record<string, unknown>;
  }>;
  new_cycles: Array<{
    name: string;
    classification: string;
    entity_ids: string[];
    intervention_point: string;
    description: string;
    growth_type?: string;
    cycle_time?: string;
    estimated_multiplier?: number;
  }>;
  corrected_rankings: Array<{
    entity_id: string;
    rank: number;
  }>;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  const { spaceId, reasoningContext } = body;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // Agent run handle (declared at outer scope so catch can fail it)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agent: { complete: (o?: { findingsCount?: number; artifacts?: string[] }) => Promise<void>; fail: (m: string) => Promise<void> } | null = null;

  try {
    // Credit check (1 credit for re-evaluation — single fast call)
    const creditCheck = await checkCredits(db, user.id, "quick");
    if (!creditCheck.hasCredits) {
      return NextResponse.json(
        { error: `Insufficient credits. Need ${creditCheck.required}, have ${creditCheck.balance}.` },
        { status: 402 }
      );
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Track this reevaluation as an agent run (best-effort; non-critical).
    const { beginRouteAgent } = await import("@/lib/agents/instrument-route");
    agent = await beginRouteAgent(db, {
      spaceId,
      userId: user.id,
      kind: "reevaluator",
      triggerEvent: "reevaluate.requested",
    });

    // Fetch current space data
    const [entitiesRes, edgesRes, cyclesRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
    ]);

    const entities = (entitiesRes.data ?? []) as Entity[];
    const edges = (edgesRes.data ?? []) as Edge[];
    const cycles = (cyclesRes.data ?? []) as Cycle[];

    if (entities.length === 0) {
      return NextResponse.json(
        { error: "No entities to re-evaluate" },
        { status: 400 }
      );
    }

    // Build entity_id → UUID map
    const entityIdToUuid = new Map<string, string>();
    const uuidToEntityId = new Map<string, string>();
    for (const e of entities) {
      entityIdToUuid.set(e.entity_id, e.id);
      uuidToEntityId.set(e.id, e.entity_id);
    }

    // Build compact entity + edge summary for the LLM
    const entitySummary = entities
      .map((e) => `${e.entity_id}: ${e.name} [${e.entity_category}, ${e.importance ?? "moderate"}]`)
      .join("\n");

    const edgeSummary = edges.length > 0
      ? edges
          .map((e) => {
            const src = uuidToEntityId.get(e.source_entity_id) ?? "?";
            const tgt = uuidToEntityId.get(e.target_entity_id) ?? "?";
            return `${src} → ${tgt} [${e.relationship_type}, ${e.dimension}]`;
          })
          .join("\n")
      : "(No edges currently exist — this is the primary problem to fix)";

    const cycleSummary = cycles.length > 0
      ? cycles.map((c) => `${c.name}: ${c.entity_ids.join(" → ")} [${c.classification}]`).join("\n")
      : "(No cycles detected)";

    // Build reasoning context block if comprehensive analysis was provided
    const reasoningBlock = reasoningContext
      ? `\n\nPRIOR REASONING ANALYSIS (use these findings to guide your edge discovery — these are identified gaps and missing connections from a holistic system analysis):\n${typeof reasoningContext === "string" ? reasoningContext : JSON.stringify(reasoningContext, null, 1).slice(0, 6000)}`
      : "";

    // Identify orphan entities (0-1 edges) for targeted connection
    const entityDegree = new Map<string, number>();
    for (const e of entities) entityDegree.set(e.entity_id, 0);
    for (const e of edges) {
      const src = uuidToEntityId.get(e.source_entity_id) ?? "";
      const tgt = uuidToEntityId.get(e.target_entity_id) ?? "";
      if (src) entityDegree.set(src, (entityDegree.get(src) ?? 0) + 1);
      if (tgt) entityDegree.set(tgt, (entityDegree.get(tgt) ?? 0) + 1);
    }
    const orphans = [...entityDegree.entries()].filter(([, d]) => d <= 1).map(([id]) => id);
    const orphanBlock = orphans.length > 0
      ? `\n\nISOLATED ENTITIES (${orphans.length} entities with 0-1 connections — PRIORITIZE connecting these):\n${orphans.join(", ")}`
      : "";

    // LLM call to find missing edges — enhanced with reasoning context
    const result = await llmJSON<RevalResult>({
      system: `You are a graph structure analyst. You receive a knowledge graph (entities + edges) and find MISSING connections.

PRIORITY: Connect isolated entities. Every entity should have at least 2 connections. Entities with 0-1 edges are your top priority — find how they relate to the rest of the graph.

Rules:
- Only suggest edges between entities that ACTUALLY exist in the list
- Use entity_id strings (like C1, C5) for source and target
- Every edge needs a specific mechanism — no vague connections
- dimension must be one of: structural, functional, temporal, causal, correlational, logical, epistemic, comparative, agentive
- Validate each edge: TRADEOFF requires shared scarce resource. CAUSAL requires nameable mechanism. ENABLES means B cannot happen without A.
- Check temporal consistency: if A happens after B, A cannot enable or cause B
- If prior reasoning analysis is provided, USE IT — it contains identified structural holes, missing mediating variables, and hidden dependencies that should become real edges

Return ONLY valid JSON.`,
      user: `Here is a knowledge graph to analyze. Find missing connections.

ENTITIES (${entities.length}):
${entitySummary}

CURRENT EDGES (${edges.length}):
${edgeSummary}

CURRENT CYCLES (${cycles.length}):
${cycleSummary}${orphanBlock}${reasoningBlock}

Tasks:
1. Find 10-20 missing edges that should exist based on the entity relationships. PRIORITY: connect isolated entities first, then complete causal chains, then fill structural holes identified in reasoning analysis.
2. Detect any feedback cycles not yet identified.
3. If the current centrality ranking seems wrong, suggest corrections.

Return JSON:
{
  "new_edges": [{"source_entity_id": "C1", "target_entity_id": "C5", "relationship_type": "enables", "dimension": "functional", "strength": 0.7, "confidence": 0.8, "reasoning": "why this edge exists", "dynamics": "threshold | linear | compounding | exponential | logarithmic | decay | step_function | delayed", "dynamics_properties": {"threshold_condition": "optional detail"}}],
  "new_cycles": [{"name": "cycle name", "classification": "reinforcing_positive", "entity_ids": ["C1", "C5", "C8"], "intervention_point": "C5", "description": "what this cycle does", "growth_type": "additive | multiplicative | accelerating | decelerating", "cycle_time": "~1 week", "estimated_multiplier": 1.3}],
  "corrected_rankings": []
}`,
      maxTokens: 8192,
      temperature: 0.3,
    });

    // Build existing edge set to avoid duplicates
    const existingEdgeKeys = new Set(
      edges.map((e) => {
        const src = uuidToEntityId.get(e.source_entity_id) ?? "";
        const tgt = uuidToEntityId.get(e.target_entity_id) ?? "";
        return `${src}→${tgt}→${e.relationship_type}`;
      })
    );

    // Insert new edges
    let addedEdges = 0;
    for (const edge of result.new_edges ?? []) {
      const key = `${edge.source_entity_id}→${edge.target_entity_id}→${edge.relationship_type}`;
      if (existingEdgeKeys.has(key)) continue;

      const sourceUuid = entityIdToUuid.get(edge.source_entity_id);
      const targetUuid = entityIdToUuid.get(edge.target_entity_id);
      if (!sourceUuid || !targetUuid) continue;

      const dimension = VALID_DIMENSIONS.includes(edge.dimension)
        ? edge.dimension
        : "functional";

      // Skip low-confidence edges (lowered from 0.4 → 0.2 to prevent graph disconnection)
      if ((edge.confidence ?? 0.7) < 0.2) continue;

      const { error } = await db.from("edges").insert({
        space_id: spaceId,
        source_entity_id: sourceUuid,
        target_entity_id: targetUuid,
        relationship_type: edge.relationship_type,
        dimension,
        source_tag: "predicted",
        strength: edge.strength ?? 0.6,
        polarity: "positive",
        confidence: edge.confidence ?? 0.7,
        conditions: edge.reasoning ?? null,
        is_tradeoff: false,
        is_part_of_cycle: false,
        dynamics: edge.dynamics ?? null,
        dynamics_properties: edge.dynamics_properties ?? null,
      });
      if (!error) addedEdges++;
    }

    // Insert new cycles
    let addedCycles = 0;
    const existingCycleNames = new Set(cycles.map((c) => c.name));
    for (const cycle of result.new_cycles ?? []) {
      if (existingCycleNames.has(cycle.name)) continue;

      const classification = ["reinforcing_positive", "reinforcing_negative", "balancing"].includes(cycle.classification)
        ? cycle.classification
        : "reinforcing_positive";

      const { error } = await db.from("cycles").insert({
        space_id: spaceId,
        cycle_id: `cycle_reeval_${addedCycles + 1}`,
        name: cycle.name,
        classification,
        entity_ids: cycle.entity_ids,
        intervention_point_entity_id: cycle.intervention_point
          ? entityIdToUuid.get(cycle.intervention_point) ?? null
          : null,
        description: cycle.description ?? null,
        growth_type: cycle.growth_type ?? null,
        cycle_time: cycle.cycle_time ?? null,
        estimated_multiplier: typeof cycle.estimated_multiplier === "number" ? cycle.estimated_multiplier : null,
      });
      if (!error) addedCycles++;
    }

    // Update rankings if corrected
    let updatedEntities = 0;
    for (const ranking of result.corrected_rankings ?? []) {
      const uuid = entityIdToUuid.get(ranking.entity_id);
      if (uuid) {
        await db
          .from("entities")
          .update({ centrality_rank: ranking.rank })
          .eq("id", uuid);
        updatedEntities++;
      }
    }

    // Always recompute degree-based centrality so existing spaces that pre-date
    // the decompose-time enrichment still get populated ranks. This runs after
    // the LLM's corrected_rankings so the LLM's judgment wins for any entity
    // it explicitly re-ranked; the algorithmic pass backfills everything else.
    const correctedIds = new Set(
      (result.corrected_rankings ?? [])
        .map((r) => entityIdToUuid.get(r.entity_id))
        .filter((id): id is string => Boolean(id))
    );
    const allEntityIds = entities.map((e) => ({ id: e.id }));
    const allEdgeRefs = [
      ...edges.map((e) => ({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
      })),
      ...(result.new_edges ?? [])
        .map((e) => {
          const src = entityIdToUuid.get(e.source_entity_id);
          const tgt = entityIdToUuid.get(e.target_entity_id);
          return src && tgt ? { source_entity_id: src, target_entity_id: tgt } : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null),
    ];
    const algorithmicRankings = computeDegreeCentrality(allEntityIds, allEdgeRefs);
    let backfilledRanks = 0;
    await Promise.all(
      algorithmicRankings
        .filter((r) => !correctedIds.has(r.id))
        .map(async (r) => {
          await db
            .from("entities")
            .update({ centrality_rank: r.rank })
            .eq("id", r.id);
          backfilledRanks++;
        })
    );
    console.log(`[reevaluate] Centrality: ${updatedEntities} LLM-corrected, ${backfilledRanks} algorithmic backfill`);

    // ── Cascade backfill ──
    // Existing spaces pre-date the decompose-time cascade. Re-evaluate is the
    // natural entry point to fill them in, and since we just recomputed
    // centrality (which cascade doesn't read but is related) it's cheap to
    // also refresh cascades now. Non-critical — failure logs and moves on.
    try {
      const report = await runCascadeForSpace(db, spaceId, { source: "reevaluate_auto" });
      if (report) {
        console.log(`[reevaluate] Cascade: ${report.seeds_analyzed} seeds → ${report.paths.length} paths, ${report.total_affected_entities} affected, ${report.systemic_pressure_points.length} pressure points`);
      }
    } catch (cascadeErr) {
      console.warn("[reevaluate] Cascade refresh failed (non-critical):", cascadeErr);
    }

    // Update space counts
    const totalEdges = edges.length + addedEdges;
    const totalCycles = cycles.length + addedCycles;
    await db
      .from("spaces")
      .update({
        edge_count: totalEdges,
        cycle_count: totalCycles,
        updated_at: new Date().toISOString(),
      })
      .eq("id", spaceId);

    // Log changelog
    await db.from("space_changelog").insert({
      space_id: spaceId,
      version: 1,
      change_type: "reevaluation",
      summary: `Re-evaluated: +${addedEdges} connections, +${addedCycles} cycles, ${updatedEntities} entities updated`,
      details: {
        added_edges: addedEdges,
        added_cycles: addedCycles,
        updated_entities: updatedEntities,
      },
    });

    // ── Sprint 3 staleness hook ──
    // Re-evaluation added edges/cycles or changed rankings — KG shifted.
    // Fan out kg_changed staleness to every app whose dominant factors
    // touch the affected entities.
    if (addedEdges > 0 || addedCycles > 0 || updatedEntities > 0) {
      const touchedUuids = new Set<string>();
      for (const e of result.new_edges ?? []) {
        const s = entityIdToUuid.get(e.source_entity_id);
        const t = entityIdToUuid.get(e.target_entity_id);
        if (s) touchedUuids.add(s);
        if (t) touchedUuids.add(t);
      }
      for (const c of result.new_cycles ?? []) {
        for (const code of c.entity_ids ?? []) {
          const u = entityIdToUuid.get(code);
          if (u) touchedUuids.add(u);
        }
      }
      if (touchedUuids.size > 0) {
        await flagAppsByEntityChange(
          db,
          spaceId,
          Array.from(touchedUuids),
          "kg_changed",
          `user:${user.id}`,
          `Re-evaluation: +${addedEdges} edges, +${addedCycles} cycles`
        );
      }
    }

    // Deduct credits
    await deductCredits(db, user.id, "quick", spaceId);

    // ── Audit trail: append a completed reevaluate run + update fingerprint ──
    // Reevaluate modifies the graph (new edges, new cycles) so the lazy-guard
    // fingerprint must be invalidated and the run logged for the provenance chip.
    try {
      const { data: fresh } = await db.from("spaces")
        .select("synthesis_data").eq("id", spaceId).single();
      const freshData = ((fresh as { synthesis_data?: Record<string, unknown> } | null)?.synthesis_data) ?? {};
      // Re-fetch entities + edges post-insert to compute the updated fingerprint
      const [freshEntRes, freshEdgeRes] = await Promise.all([
        db.from("entities").select("entity_id, name, importance").eq("space_id", spaceId),
        db.from("edges").select("source_entity_id, target_entity_id, relationship_type").eq("space_id", spaceId),
      ]);
      const newFingerprint = computeDecompFingerprint(
        (freshEntRes.data ?? []) as Array<{ entity_id: string; name: string; importance?: string }>,
        (freshEdgeRes.data ?? []) as Array<{ source_entity_id: string; target_entity_id: string; relationship_type?: string }>,
      );
      const reevalRun: AnalysisRun = {
        run_id: makeRunId(),
        pipeline: "reevaluate",
        started_at: new Date(Date.now() - 30000).toISOString(), // approximate start
        completed_at: new Date().toISOString(),
        status: "completed",
        depth: "quick",
        stages_run: [
          "llm_missing_edges",
          ...(addedCycles > 0 ? ["cycle_detection"] : []),
          "centrality_refresh",
          "fingerprint_update",
        ],
        stages_skipped: [],
        cache_hits: [],
        fingerprint: newFingerprint,
        note: `Reevaluation: +${addedEdges} edges, +${addedCycles} cycles, ${updatedEntities} rank corrections`,
      };
      const priorRuns = (freshData.analysis_runs as AnalysisRun[] | undefined) ?? [];
      await db.from("spaces").update({
        synthesis_data: {
          ...freshData,
          analysis_runs: appendRun(priorRuns, reevalRun),
          decomp_fingerprint: newFingerprint,
        },
      }).eq("id", spaceId);
    } catch (auditErr) {
      console.warn("[reevaluate] Audit-trail update failed (non-critical):", auditErr);
    }

    await agent?.complete({
      findingsCount: addedEdges + addedCycles + updatedEntities,
      artifacts: ["edges", "cycles", "entities"],
    });

    return NextResponse.json({
      added_edges: addedEdges,
      added_cycles: addedCycles,
      updated_entities: updatedEntities,
    });
  } catch (err) {
    console.error("Re-evaluation error:", err);
    await agent?.fail(err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "Re-evaluation failed. Please try again." },
      { status: 500 }
    );
  }
}
