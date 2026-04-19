import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Entity, Edge, Cycle } from "@/types";
import { computeDecompFingerprint } from "@/lib/pipeline/cache";
import { appendRun, makeRunId } from "@/lib/pipeline/analysis-runs";
import type { AnalysisRun } from "@/types/analysis-runs";

export const maxDuration = 30;

/**
 * POST /api/chat/incremental-analyze
 *
 * Lightweight structural analysis that runs after chat changes (add_entity, add_edge, etc.).
 * NOT a full re-synthesis — just ensures new nodes/edges are properly integrated:
 *   1. Classifies dynamics on new edges (threshold/compounding/etc)
 *   2. Evaluates leverage/risk flags on new entities
 *   3. Detects new cycles involving changed entities
 *   4. Recalculates centrality rankings
 *   5. Finds 2-3 immediate missing edges for new entities
 *
 * Cost: 0 credits (included in chat interaction). Uses gpt-4o-mini for speed.
 * Latency: ~3-5 seconds.
 */

const VALID_DYNAMICS = [
  "threshold", "linear", "compounding", "exponential",
  "logarithmic", "decay", "step_function", "delayed",
];

interface IncrementalResult {
  edge_dynamics: Array<{
    source_entity_id: string;
    target_entity_id: string;
    dynamics: string;
    dynamics_properties?: Record<string, unknown>;
  }>;
  entity_flags: Array<{
    entity_id: string;
    is_leverage_point: boolean;
    is_risk_point: boolean;
    importance: string;
    reasoning: string;
  }>;
  new_cycles: Array<{
    name: string;
    classification: string;
    entity_ids: string[];
    intervention_point: string;
    description: string;
    growth_type?: string;
  }>;
  missing_edges: Array<{
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    dimension: string;
    strength: number;
    confidence: number;
    dynamics?: string;
    reasoning: string;
  }>;
  centrality_ranking: Array<{
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

  const { spaceId, changedEntityIds, changedEdgePairs } = body as {
    spaceId: string;
    changedEntityIds?: string[];   // entity_ids that were added/modified
    changedEdgePairs?: Array<{ source: string; target: string }>;  // edges added
  };

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { beginRouteAgent } = await import("@/lib/agents/instrument-route");
  const agent = await beginRouteAgent(db, {
    spaceId,
    userId: user.id,
    kind: "incremental_analyzer",
    triggerEvent: "chat.incremental_analyze",
    triggerData: { changedEntityIds, changedEdgePairs },
  });

  try {
    // Fetch current full graph state
    const [entRes, edgRes, cycRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
    ]);

    const entities = (entRes.data ?? []) as Entity[];
    const edges = (edgRes.data ?? []) as Edge[];
    const cycles = (cycRes.data ?? []) as Cycle[];

    if (entities.length === 0) {
      return NextResponse.json({ success: true, changes: 0 });
    }

    const entityIdToUuid = new Map<string, string>();
    const uuidToEntityId = new Map<string, string>();
    for (const e of entities) {
      entityIdToUuid.set(e.entity_id, e.id);
      uuidToEntityId.set(e.id, e.entity_id);
    }

    // Build compact graph summary
    const entitySummary = entities
      .map((e) => {
        const flags: string[] = [];
        if (e.is_leverage_point) flags.push("LEVERAGE");
        if (e.is_risk_point) flags.push("RISK");
        if (e.is_master_bottleneck) flags.push("BOTTLENECK");
        const changed = changedEntityIds?.includes(e.entity_id) ? " ★NEW" : "";
        return `${e.entity_id}: ${e.name} [${e.entity_category}, ${e.importance ?? "moderate"}]${flags.length ? ` [${flags.join(",")}]` : ""}${changed}`;
      })
      .join("\n");

    const edgeSummary = edges
      .map((e) => {
        const src = uuidToEntityId.get(e.source_entity_id) ?? "?";
        const tgt = uuidToEntityId.get(e.target_entity_id) ?? "?";
        const dyn = e.dynamics ? `, dynamics=${e.dynamics}` : "";
        const isNew = changedEdgePairs?.some(
          (p) => p.source === src && p.target === tgt
        );
        return `${src} → ${tgt} [${e.relationship_type}, ${e.dimension}${dyn}]${isNew ? " ★NEW" : ""}`;
      })
      .join("\n");

    const cycleSummary = cycles.length > 0
      ? cycles.map((c) => `${c.name ?? c.cycle_id}: ${c.entity_ids.join(" → ")} [${c.classification}]`).join("\n")
      : "(No cycles)";

    // One fast LLM call to analyze the changes in context
    const result = await llmJSON<IncrementalResult>({
      system: `You are a graph structure analyst. The user just modified a knowledge graph via conversation. Entities/edges marked ★NEW were just added or changed. Your job is to INTEGRATE these changes into the existing graph structure.

For each task, focus on the ★NEW elements and their impact on the existing graph.

Return ONLY valid JSON matching the schema below. Be concise. This is a fast incremental pass, not a full analysis.`,
      user: `ENTITIES (${entities.length}):
${entitySummary}

EDGES (${edges.length}):
${edgeSummary}

CYCLES (${cycles.length}):
${cycleSummary}

Tasks:
1. EDGE DYNAMICS: ONLY for ★NEW edges AND only if the edge summary above does NOT already include "dynamics=<something>". If an edge already shows dynamics in its summary line, DO NOT emit an edge_dynamics entry for it — that annotation was grounded in earlier analysis and must be preserved. For remaining unannotated ★NEW edges, assign one of: threshold | linear | compounding | exponential | logarithmic | decay | step_function | delayed. Include dynamics_properties if relevant (threshold_condition, decay_rate, cycle_time, etc).

2. ENTITY FLAGS: For every ★NEW entity, evaluate: should it be a leverage point (high-impact change opportunity)? A risk point (significant danger)? What importance level? Base this on its position in the graph — how many edges connect to it, what dynamics those edges have.

3. NEW CYCLES: Do any ★NEW edges complete feedback cycles with existing edges? Trace chains up to 6 steps from each new edge. Report only genuinely new cycles not already listed above.

4. MISSING EDGES: For each ★NEW entity, suggest 2-3 edges it should probably have to existing entities. Only suggest high-confidence connections.

5. CENTRALITY: Re-rank the top 10 most connected entities by degree (total edges in + out). This replaces the current centrality ranking.

{
  "edge_dynamics": [{"source_entity_id": "C1", "target_entity_id": "C5", "dynamics": "threshold", "dynamics_properties": {"threshold_condition": "..."}}],
  "entity_flags": [{"entity_id": "C21", "is_leverage_point": false, "is_risk_point": false, "importance": "moderate", "reasoning": "..."}],
  "new_cycles": [{"name": "...", "classification": "reinforcing_positive | reinforcing_negative | balancing", "entity_ids": ["C1", "C5", "C21"], "intervention_point": "C5", "description": "...", "growth_type": "additive | multiplicative"}],
  "missing_edges": [{"source_entity_id": "C21", "target_entity_id": "C3", "relationship_type": "enables", "dimension": "functional", "strength": 0.7, "confidence": 0.8, "dynamics": "linear", "reasoning": "..."}],
  "centrality_ranking": [{"entity_id": "C1", "rank": 1}, {"entity_id": "C5", "rank": 2}]
}`,
      maxTokens: 3000,
      temperature: 0.2,
      model: "gpt-4o-mini",
    });

    let totalChanges = 0;

    // Build a fast lookup of existing edge Tier 3 annotations so the incremental
    // pass doesn't clobber them. Key = `${srcUuid}|${tgtUuid}` — all we need to
    // check is whether dynamics / dynamics_properties / topology / conditions
    // were previously populated (e.g. by Pass 1 Tier 3 extraction during decompose).
    const existingEdgeTier3 = new Map<string, {
      dynamics: string | null;
      dynamics_properties: Record<string, unknown> | null;
      topology: string | null;
      conditions: string | null;
    }>();
    for (const e of edges) {
      const key = `${e.source_entity_id}|${e.target_entity_id}`;
      existingEdgeTier3.set(key, {
        dynamics: (e as unknown as { dynamics?: string | null }).dynamics ?? null,
        dynamics_properties: (e as unknown as { dynamics_properties?: Record<string, unknown> | null }).dynamics_properties ?? null,
        topology: (e as unknown as { topology?: string | null }).topology ?? null,
        conditions: (e as unknown as { conditions?: string | null }).conditions ?? null,
      });
    }

    // 1. Apply edge dynamics — but PRESERVE existing Tier 3 annotations.
    // The incremental LLM is instructed to skip edges that already have dynamics,
    // but the structured output doesn't enforce that, so we defend in code.
    let preservedTier3 = 0;
    for (const ed of result.edge_dynamics ?? []) {
      const srcUuid = entityIdToUuid.get(ed.source_entity_id);
      const tgtUuid = entityIdToUuid.get(ed.target_entity_id);
      if (!srcUuid || !tgtUuid) continue;
      if (!VALID_DYNAMICS.includes(ed.dynamics)) continue;

      const existing = existingEdgeTier3.get(`${srcUuid}|${tgtUuid}`);
      // If edge already has a meaningful dynamics value (anything other than the
      // default "linear" fallback with no properties), keep it. The decompose pass
      // extracted these from Pass 1 Tier 3 annotations and they represent grounded
      // analysis; re-inferring from chat context would destroy that rigor.
      const existingDynamicsIsMeaningful =
        existing?.dynamics &&
        existing.dynamics !== "" &&
        (existing.dynamics !== "linear" || (existing.dynamics_properties && Object.keys(existing.dynamics_properties).length > 0));
      if (existingDynamicsIsMeaningful) {
        preservedTier3++;
        continue;
      }

      // Merge: fill in what's missing, don't clobber what's present.
      const mergedProperties =
        existing?.dynamics_properties && typeof existing.dynamics_properties === "object"
          ? { ...existing.dynamics_properties, ...(ed.dynamics_properties ?? {}) }
          : (ed.dynamics_properties ?? null);

      const { error } = await db.from("edges")
        .update({
          dynamics: ed.dynamics,
          dynamics_properties: mergedProperties,
        })
        .eq("space_id", spaceId)
        .eq("source_entity_id", srcUuid)
        .eq("target_entity_id", tgtUuid);
      if (!error) totalChanges++;
    }
    if (preservedTier3 > 0) {
      console.log(`[incremental-analyze] Preserved ${preservedTier3} existing Tier 3 dynamics annotations (would have been overwritten by re-inference)`);
    }

    // 2. Apply entity flags
    for (const ef of result.entity_flags ?? []) {
      const uuid = entityIdToUuid.get(ef.entity_id);
      if (!uuid) continue;

      const validImportance = ["fundamental", "critical", "important", "moderate"].includes(ef.importance);
      const { error } = await db.from("entities")
        .update({
          is_leverage_point: ef.is_leverage_point === true,
          is_risk_point: ef.is_risk_point === true,
          ...(validImportance ? { importance: ef.importance } : {}),
        })
        .eq("id", uuid);
      if (!error) totalChanges++;
    }

    // 3. Insert new cycles
    for (const nc of result.new_cycles ?? []) {
      const validClassification = ["reinforcing_positive", "reinforcing_negative", "balancing"].includes(nc.classification);
      const entityUuids = nc.entity_ids
        .map((eid) => entityIdToUuid.get(eid))
        .filter((u): u is string => !!u);
      if (entityUuids.length < 2) continue;

      const { error } = await db.from("cycles").insert({
        space_id: spaceId,
        cycle_id: `cycle_chat_${Date.now()}`,
        name: nc.name,
        classification: validClassification ? nc.classification : "reinforcing_positive",
        entity_ids: nc.entity_ids,
        intervention_point_entity_id: entityIdToUuid.get(nc.intervention_point) ?? null,
        description: nc.description ?? null,
        growth_type: nc.growth_type ?? null,
      });
      if (!error) totalChanges++;
    }

    // 4. Insert missing edges (as predicted, with dynamics)
    const existingKeys = new Set(
      edges.map((e) => `${uuidToEntityId.get(e.source_entity_id)}→${uuidToEntityId.get(e.target_entity_id)}→${e.relationship_type}`)
    );

    for (const me of result.missing_edges ?? []) {
      const key = `${me.source_entity_id}→${me.target_entity_id}→${me.relationship_type}`;
      if (existingKeys.has(key)) continue;

      const srcUuid = entityIdToUuid.get(me.source_entity_id);
      const tgtUuid = entityIdToUuid.get(me.target_entity_id);
      if (!srcUuid || !tgtUuid) continue;
      // Lowered from 0.6 → 0.35: the 0.6 threshold was too aggressive for incremental
      // analysis, rejecting most discovered edges and preventing graph densification.
      // Chat-discovered edges at 0.35-0.6 confidence are still valuable for connectivity.
      if ((me.confidence ?? 0) < 0.35) continue;

      const { error } = await db.from("edges").insert({
        space_id: spaceId,
        source_entity_id: srcUuid,
        target_entity_id: tgtUuid,
        relationship_type: me.relationship_type,
        dimension: me.dimension ?? "functional",
        source_tag: "predicted",
        strength: me.strength ?? 0.6,
        polarity: "positive",
        confidence: me.confidence ?? 0.7,
        conditions: me.reasoning ?? null,
        dynamics: VALID_DYNAMICS.includes(me.dynamics ?? "") ? me.dynamics : null,
        knowledge_layer: "internal",
        provenance: { source_type: "incremental_analysis", via: "chat" },
      });
      if (!error) totalChanges++;
    }

    // 5. Apply centrality rankings
    for (const cr of result.centrality_ranking ?? []) {
      const uuid = entityIdToUuid.get(cr.entity_id);
      if (!uuid) continue;
      await db.from("entities")
        .update({ centrality_rank: cr.rank })
        .eq("id", uuid);
    }

    // Update space counts
    const newEdgeCount = edges.length + (result.missing_edges?.filter((me) => {
      const key = `${me.source_entity_id}→${me.target_entity_id}→${me.relationship_type}`;
      return !existingKeys.has(key) && entityIdToUuid.has(me.source_entity_id) && entityIdToUuid.has(me.target_entity_id);
    }).length ?? 0);
    const newCycleCount = cycles.length + (result.new_cycles?.length ?? 0);

    await db.from("spaces").update({
      edge_count: newEdgeCount,
      cycle_count: newCycleCount,
      updated_at: new Date().toISOString(),
    }).eq("id", spaceId);

    // Log to changelog
    await db.from("space_changelog").insert({
      space_id: spaceId,
      change_type: "reevaluation",
      summary: `Incremental analysis after chat update: ${totalChanges} structural adjustments`,
      details: {
        edge_dynamics_set: (result.edge_dynamics ?? []).length,
        entity_flags_set: (result.entity_flags ?? []).length,
        new_cycles: (result.new_cycles ?? []).length,
        missing_edges_added: (result.missing_edges ?? []).length,
        centrality_updated: (result.centrality_ranking ?? []).length,
        trigger: "chat_change",
      },
    }).then(() => {}, () => {});

    // ── Audit trail: append completed chat_incremental run + fingerprint ──
    try {
      const { data: fresh } = await db.from("spaces")
        .select("synthesis_data").eq("id", spaceId).single();
      const freshData = ((fresh as { synthesis_data?: Record<string, unknown> } | null)?.synthesis_data) ?? {};
      const [freshEntRes, freshEdgeRes] = await Promise.all([
        db.from("entities").select("entity_id, name, importance").eq("space_id", spaceId),
        db.from("edges").select("source_entity_id, target_entity_id, relationship_type").eq("space_id", spaceId),
      ]);
      const newFingerprint = computeDecompFingerprint(
        (freshEntRes.data ?? []) as Array<{ entity_id: string; name: string; importance?: string }>,
        (freshEdgeRes.data ?? []) as Array<{ source_entity_id: string; target_entity_id: string; relationship_type?: string }>,
      );
      const stagesRun: string[] = ["llm_integration"];
      if ((result.edge_dynamics ?? []).length > 0) stagesRun.push("edge_dynamics");
      if (preservedTier3 > 0) stagesRun.push("tier3_preservation");
      if ((result.entity_flags ?? []).length > 0) stagesRun.push("entity_flag_update");
      if ((result.new_cycles ?? []).length > 0) stagesRun.push("cycle_detection");
      if ((result.missing_edges ?? []).length > 0) stagesRun.push("missing_edge_inference");
      stagesRun.push("centrality_refresh", "fingerprint_update");

      const chatRun: AnalysisRun = {
        run_id: makeRunId(),
        pipeline: "chat_incremental",
        started_at: new Date(Date.now() - 10000).toISOString(),
        completed_at: new Date().toISOString(),
        status: "completed",
        depth: "quick",
        stages_run: stagesRun,
        stages_skipped: [],
        cache_hits: preservedTier3 > 0 ? [`tier3_preservation:${preservedTier3}`] : [],
        fingerprint: newFingerprint,
        note: `Chat update: ${totalChanges} changes` + (preservedTier3 > 0 ? ` · preserved ${preservedTier3} Tier 3 annotation${preservedTier3 === 1 ? "" : "s"}` : ""),
      };
      const priorRuns = (freshData.analysis_runs as AnalysisRun[] | undefined) ?? [];
      await db.from("spaces").update({
        synthesis_data: {
          ...freshData,
          analysis_runs: appendRun(priorRuns, chatRun),
          decomp_fingerprint: newFingerprint,
        },
      }).eq("id", spaceId);
    } catch (auditErr) {
      console.warn("[incremental-analyze] Audit-trail update failed (non-critical):", auditErr);
    }

    await agent.complete({
      findingsCount: totalChanges,
      artifacts: ["edge_dynamics", "entity_flags", "cycles", "edges"],
    });

    return NextResponse.json({
      success: true,
      changes: totalChanges,
      edgeDynamics: (result.edge_dynamics ?? []).length,
      entityFlags: (result.entity_flags ?? []).length,
      newCycles: (result.new_cycles ?? []).length,
      missingEdges: (result.missing_edges ?? []).length,
    });
  } catch (err) {
    console.error("Incremental analysis error:", err);
    await agent.fail(err instanceof Error ? err.message : String(err));
    // Non-fatal — the chat change already succeeded; this is enrichment
    return NextResponse.json({ success: true, changes: 0, error: "Analysis skipped" });
  }
}
