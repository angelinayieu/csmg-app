/**
 * Self-Improving Loop Orchestrator
 *
 * Executes a single research-deepening cycle for a space:
 * 1. Snapshot pre-cycle metrics
 * 2. Analyze KG gaps → generate targeted queries
 * 3. Execute research via the existing research pipeline
 * 4. Snapshot post-cycle metrics + record delta
 * 5. Update schedule timing
 *
 * Called by the cron endpoint or manual trigger.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { extractSignals } from "@/lib/intelligence/signal-extraction";
import {
  computeTemporalIntelligence,
  computeCoverageImprovements,
} from "@/lib/intelligence/temporal-intelligence";
import { analyzeGaps } from "@/lib/pipeline/gap-analyzer";
import { flagAppsByEntityChange } from "@/lib/apps/staleness-triggers";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ResearchSchedule, IntelligenceRadarData } from "@/types/intelligence";
import type { IntelligenceRadarDataV2 } from "@/types/intelligence-v2";
import type {
  LoopCycleRecord,
  LoopCyclePhase,
  LoopDelta,
  KGMetricsSnapshot,
} from "@/types/loop-metrics";

// ── Helpers ──

function computeMetricsSnapshot(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  bridgeCount: number,
  coverageScore: number,
): KGMetricsSnapshot {
  const orphanIds = new Set(entities.map((e) => e.entity_id));
  for (const edge of edges) {
    orphanIds.delete(edge.source_entity_id);
    orphanIds.delete(edge.target_entity_id);
  }

  const maxPossible = Math.max(1, (entities.length * (entities.length - 1)) / 2);
  const typedEdges = edges.filter((e) => e.relationship_type).length;

  return {
    entity_count: entities.length,
    edge_count: edges.length,
    cycle_count: cycles.length,
    bridge_count: bridgeCount,
    orphan_count: orphanIds.size,
    coverage_score: coverageScore,
    stack_health: {
      source_diversity: 0, // Will be computed by hook at display time
      avg_credibility: 0,
      connection_density: Math.min(1, typedEdges / maxPossible),
      insight_yield: 0,
    },
    knowledge_stack_counts: {
      sources: { total: 0, avg_credibility: 0 },
      atoms: { total: entities.length, verified: 0 },
      connections: { typed: typedEdges, floating: orphanIds.size },
      insights: { total: 0, high_impact: 0 },
    },
  };
}

function cadenceToMs(cadence: string): number {
  switch (cadence) {
    case "daily": return 24 * 60 * 60 * 1000;
    case "weekly": return 7 * 24 * 60 * 60 * 1000;
    case "biweekly": return 14 * 24 * 60 * 60 * 1000;
    case "monthly": return 30 * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

// ── Main Entry ──

export interface LoopExecutionParams {
  spaceId: string;
  userId: string;
  schedule: ResearchSchedule;
  /** Base URL for internal API calls (e.g., "https://app.example.com") */
  baseUrl: string;
  /** Service role key for auth bypass */
  serviceRoleKey: string;
}

export async function executeResearchLoop(
  params: LoopExecutionParams
): Promise<LoopCycleRecord> {
  const { spaceId, userId, schedule, baseUrl, serviceRoleKey } = params;
  const db = createServiceClient();
  const startedAt = new Date().toISOString();
  const phases: LoopCyclePhase[] = [];
  let status: LoopCycleRecord["status"] = "running";
  let errorMessage: string | null = null;

  // Get the next cycle number
  const { data: lastCycle } = await db
    .from("loop_cycle_records")
    .select("cycle_number")
    .eq("space_id", spaceId)
    .order("cycle_number", { ascending: false })
    .limit(1)
    .single();
  const cycleNumber = (lastCycle?.cycle_number ?? 0) + 1;

  // Insert running record
  const { data: cycleRow } = await db
    .from("loop_cycle_records")
    .insert({
      space_id: spaceId,
      user_id: userId,
      cycle_number: cycleNumber,
      started_at: startedAt,
      status: "running",
      trigger_type: "cron",
      depth_used: schedule.depth,
    })
    .select("id")
    .single();
  const cycleId = cycleRow?.id ?? `cycle_${cycleNumber}`;

  try {
    // ── Step 1: Load KG state ──
    const phaseStart = Date.now();
    const [
      { data: entities },
      { data: edges },
      { data: cycles },
      { data: spaceData },
    ] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
      db.from("spaces").select("input_text, synthesis_data").eq("id", spaceId).single(),
    ]);

    const ents = (entities ?? []) as Entity[];
    const edgs = (edges ?? []) as Edge[];
    const cycs = (cycles ?? []) as Cycle[];
    const synthData = (spaceData?.synthesis_data ?? {}) as SynthesisData & {
      intelligence_radar?: IntelligenceRadarData;
      intelligence_radar_v2?: IntelligenceRadarDataV2;
    };
    const inputText = spaceData?.input_text ?? "";

    phases.push({
      phase_name: "load_state",
      started_at: new Date(phaseStart).toISOString(),
      duration_ms: Date.now() - phaseStart,
      result_summary: `Loaded ${ents.length} entities, ${edgs.length} edges, ${cycs.length} cycles`,
    });

    // ── Step 2: Snapshot pre-cycle metrics ──
    const bridgeEdges = edgs.filter(
      (e) => e.knowledge_layer === "bridge" || (e.provenance as Record<string, unknown>)?.edge_role === "bridge"
    );
    const preCoverageScore = synthData.intelligence_radar_v2?.temporal?.coverage_trajectory?.snapshots?.slice(-1)[0]?.score ?? 0;
    const preMetrics = computeMetricsSnapshot(ents, edgs, cycs, bridgeEdges.length, preCoverageScore);

    await db.from("kg_metrics_snapshots").insert({
      space_id: spaceId,
      cycle_id: cycleId,
      metrics: preMetrics,
      trigger_type: "loop_cycle",
    });

    // ── Step 3: Signal extraction + temporal intelligence ──
    const p3Start = Date.now();
    const signalResult = extractSignals(ents, edgs, cycs, synthData);
    const externalEntities = ents.filter((e) => e.knowledge_layer === "external");
    const internalEntities = ents.filter((e) => !e.knowledge_layer || e.knowledge_layer === "internal");

    const temporalResult = computeTemporalIntelligence({
      signals: synthData.intelligence_radar?.signals ?? [],
      externalEntities,
      internalEntities,
      bridgeEdges,
      coverageScore: preCoverageScore,
      schedule: synthData.intelligence_radar?.schedule ?? null,
    });
    const coverageImprovements = computeCoverageImprovements({
      externalEntities,
      internalEntities,
      edges: edgs,
      coverageScore: preCoverageScore,
      coverageBreakdown: {
        quantity_ratio: 0,
        bridge_coverage: bridgeEdges.length / Math.max(1, externalEntities.length),
        authority_quality: 0,
        category_diversity: 0,
      },
    });

    phases.push({
      phase_name: "analyze_gaps",
      started_at: new Date(p3Start).toISOString(),
      duration_ms: Date.now() - p3Start,
      result_summary: `${signalResult.hypotheses.length} signals, ${signalResult.structural_holes.length} holes`,
    });

    // ── Step 4: Gap analysis → research queries ──
    const p4Start = Date.now();
    const gapResult = await analyzeGaps({
      entities: ents,
      edges: edgs,
      signalExtraction: signalResult,
      temporalIntelligence: temporalResult,
      coverageImprovements,
      contradictions: synthData.intelligence_radar_v2?.contradictions ?? [],
      openQuestions: (synthData.open_questions ?? []).map((q: { question: string; why_it_matters?: string; related_entity_ids?: string[] }) => ({
        question: q.question,
        why_it_matters: q.why_it_matters,
        related_entity_ids: q.related_entity_ids,
      })),
      coverageScore: preCoverageScore,
      bridgeCoverage: bridgeEdges.length / Math.max(1, ents.length),
      inputText,
      depth: schedule.depth,
    });

    phases.push({
      phase_name: "gap_analysis",
      started_at: new Date(p4Start).toISOString(),
      duration_ms: Date.now() - p4Start,
      result_summary: gapResult.analysis_summary,
    });

    if (gapResult.recommended_queries.length === 0) {
      status = "completed";
      const delta: LoopDelta = {
        entities_added: 0, entities_updated: 0,
        edges_added: 0, edges_removed: 0, cycles_added: 0,
        coverage_before: preCoverageScore, coverage_after: preCoverageScore,
        gaps_found: 0, gaps_closed: 0,
      };

      await db.from("loop_cycle_records").update({
        completed_at: new Date().toISOString(),
        status,
        phases,
        delta,
      }).eq("id", cycleId);

      return buildRecord(cycleId, spaceId, userId, cycleNumber, startedAt, status, schedule, phases, delta, null, 0);
    }

    // ── Step 5: Execute research via internal API call ──
    const p5Start = Date.now();
    const focusAreas = gapResult.recommended_queries
      .slice(0, 5)
      .map((q) => q.query_text);

    const researchUrl = `${baseUrl}/api/pipeline/research`;
    const researchBody = {
      spaceIds: [spaceId],
      inputSummary: inputText,
      researchDepth: schedule.depth,
      focus_areas: focusAreas,
      // Pass gap context so domain expert can be more targeted
      gap_context: gapResult.analysis_summary,
    };

    const researchRes = await fetch(researchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "x-cron-secret": process.env.CRON_SECRET ?? "",
      },
      body: JSON.stringify(researchBody),
    });

    const researchResult = await researchRes.json().catch(() => ({}));

    phases.push({
      phase_name: "execute_research",
      started_at: new Date(p5Start).toISOString(),
      duration_ms: Date.now() - p5Start,
      result_summary: researchRes.ok
        ? `Research completed: ${JSON.stringify(researchResult).slice(0, 200)}`
        : `Research failed: ${researchResult.error ?? researchRes.status}`,
    });

    if (!researchRes.ok) {
      throw new Error(researchResult.error ?? `Research pipeline returned ${researchRes.status}`);
    }

    // ── Step 6: Snapshot post-cycle metrics ──
    const [
      { data: postEntities },
      { data: postEdges },
      { data: postCycles },
    ] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
    ]);

    const postEnts = (postEntities ?? []) as Entity[];
    const postEdgs = (postEdges ?? []) as Edge[];
    const postCycs = (postCycles ?? []) as Cycle[];
    const postBridges = postEdgs.filter(
      (e) => e.knowledge_layer === "bridge" || (e.provenance as Record<string, unknown>)?.edge_role === "bridge"
    );
    const postCoverageScore = preCoverageScore; // Will be recomputed by the hook on next render
    const postMetrics = computeMetricsSnapshot(postEnts, postEdgs, postCycs, postBridges.length, postCoverageScore);

    await db.from("kg_metrics_snapshots").insert({
      space_id: spaceId,
      cycle_id: cycleId,
      metrics: postMetrics,
      trigger_type: "loop_cycle",
    });

    // ── Step 7: Compute delta + finalize ──
    const delta: LoopDelta = {
      entities_added: postEnts.length - ents.length,
      entities_updated: 0,
      edges_added: postEdgs.length - edgs.length,
      edges_removed: 0,
      cycles_added: postCycs.length - cycs.length,
      coverage_before: preCoverageScore,
      coverage_after: postCoverageScore,
      gaps_found: gapResult.recommended_queries.length,
      gaps_closed: Math.max(0, postEnts.length - ents.length),
    };

    // ── Sprint 3 staleness hook ──
    // If research added new entities OR new edges, flag dependent apps as
    // `new_research`-stale. The set of "affected entity UUIDs" includes both
    // newly added entities and the endpoints of newly added edges (since
    // those endpoints' dominant-factor relationships may have shifted).
    if (delta.entities_added > 0 || delta.edges_added > 0) {
      const preEntityIds = new Set(ents.map((e) => e.id));
      const preEdgeIds = new Set(edgs.map((e) => e.id));

      const touchedUuids = new Set<string>();
      for (const e of postEnts) {
        if (!preEntityIds.has(e.id)) touchedUuids.add(e.id);
      }
      for (const e of postEdgs) {
        if (preEdgeIds.has(e.id)) continue;
        if (e.source_entity_id) touchedUuids.add(e.source_entity_id);
        if (e.target_entity_id) touchedUuids.add(e.target_entity_id);
      }

      if (touchedUuids.size > 0) {
        await flagAppsByEntityChange(
          db,
          spaceId,
          Array.from(touchedUuids),
          "new_research",
          "pipeline:self_improving_loop",
          `Research cycle added ${delta.entities_added} entities + ${delta.edges_added} edges`
        );
      }
    }

    status = "completed";

    // ── Step 8: Update schedule timing ──
    const nextRunAt = new Date(Date.now() + cadenceToMs(schedule.cadence)).toISOString();
    const updatedSchedule: ResearchSchedule = {
      ...schedule,
      last_run_at: new Date().toISOString(),
      next_run_at: nextRunAt,
    };

    // Update schedule in synthesis_data
    const { data: freshSpace } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();
    const freshSynth = (freshSpace?.synthesis_data ?? {}) as Record<string, unknown>;
    const radarData = (freshSynth.intelligence_radar ?? {}) as Record<string, unknown>;

    await db.from("spaces").update({
      synthesis_data: {
        ...freshSynth,
        intelligence_radar: {
          ...radarData,
          schedule: updatedSchedule,
        },
      },
    }).eq("id", spaceId);

    // ── Step 9: Record in changelog ──
    await db.from("space_changelog").insert({
      space_id: spaceId,
      change_type: "reevaluation",
      summary: `Self-improving loop cycle #${cycleNumber}: +${delta.entities_added} entities, +${delta.edges_added} edges`,
      details: { loop_cycle: cycleNumber, delta, gap_summary: gapResult.analysis_summary },
    });

    // ── Step 10: Finalize cycle record ──
    await db.from("loop_cycle_records").update({
      completed_at: new Date().toISOString(),
      status,
      phases,
      delta,
    }).eq("id", cycleId);

    return buildRecord(cycleId, spaceId, userId, cycleNumber, startedAt, status, schedule, phases, delta, null, 1);

  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);

    await db.from("loop_cycle_records").update({
      completed_at: new Date().toISOString(),
      status: "failed",
      phases,
      error_message: errorMessage,
    }).eq("id", cycleId);

    return buildRecord(
      cycleId, spaceId, userId, cycleNumber, startedAt, "failed",
      schedule, phases,
      { entities_added: 0, entities_updated: 0, edges_added: 0, edges_removed: 0, cycles_added: 0, coverage_before: 0, coverage_after: 0, gaps_found: 0, gaps_closed: 0 },
      errorMessage, 0
    );
  }
}

function buildRecord(
  id: string, spaceId: string, userId: string, cycleNumber: number,
  startedAt: string, status: LoopCycleRecord["status"],
  schedule: ResearchSchedule, phases: LoopCyclePhase[],
  delta: LoopDelta, errorMessage: string | null, creditsUsed: number
): LoopCycleRecord {
  return {
    id, space_id: spaceId, user_id: userId,
    cycle_number: cycleNumber,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    status,
    trigger_type: "cron",
    depth_used: schedule.depth,
    phases, delta,
    error_message: errorMessage,
    credits_used: creditsUsed,
  };
}
