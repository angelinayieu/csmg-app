// ── Hierarchical decomposition route ──
// Alternative to /api/pipeline/decompose for large-graph scenarios (target
// 100-200+ entities). Runs three coordinated LLM passes (systems → domains
// → threads) with deterministic structural edges, then writes the result
// through the same sanitize + insert pipeline the flat decompose uses so
// all downstream features (topology merge, fault materialization, critique,
// synthesis) work unchanged.
//
// When to use: user signals they want deep / comprehensive analysis, OR the
// input is complex enough that flat decomposition would under-extract. For
// small/simple inputs, the flat /decompose route is faster and cheaper.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  sanitizeEntity,
  sanitizeEdge,
  deduplicateEntities,
  mergeByTopologyEqual,
  resilientInsert,
  materializeFault,
  MATURITY_LEVELS,
} from "@/lib/sanitize";
import { runHierarchicalDecomposition } from "@/lib/pipeline/hierarchical-decomposition";
import { scoreHierarchicalQuality } from "@/lib/hierarchical-quality";
import type { Entity, Edge } from "@/types";
import type { UserIntent } from "@/types/analysis";

export const maxDuration = 300; // Parallel LLM calls, up to ~40 of them at peak

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let text: string;
  let spaceConfig:
    | {
        name?: string;
        prefix?: string;
        description?: string;
        parent_space_id?: string;
        originated_from_entity_id?: string;
        depth_level?: number;
      }
    | undefined;
  let intent: UserIntent | undefined;
  let maxSystems: number | undefined;
  let maxDomainsPerSystem: number | undefined;
  let maxThreadsPerDomain: number | undefined;

  try {
    const body = await request.json();
    text = body.text;
    spaceConfig = body.spaceConfig;
    intent = body.intent;
    if (typeof body.maxSystems === "number") maxSystems = body.maxSystems;
    if (typeof body.maxDomainsPerSystem === "number") maxDomainsPerSystem = body.maxDomainsPerSystem;
    if (typeof body.maxThreadsPerDomain === "number") maxThreadsPerDomain = body.maxThreadsPerDomain;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "Text required" }, { status: 400 });
  }

  try {
    const startedAt = Date.now();
    const graph = await runHierarchicalDecomposition({
      userInput: text,
      spaceConfig: spaceConfig
        ? { name: spaceConfig.name, description: spaceConfig.description }
        : undefined,
      maxSystems: maxSystems ?? 12,
      maxDomainsPerSystem: maxDomainsPerSystem ?? 5,
      maxThreadsPerDomain: maxThreadsPerDomain ?? 4,
    });

    if (graph.entities.length === 0) {
      return NextResponse.json(
        { error: "Hierarchical decomposition produced no entities", stats: graph.stats },
        { status: 500 },
      );
    }

    // ── Dedup + topology-equal merge (reuses flat pipeline helpers) ──
    // Name-dedup rarely fires within a single layer but can when the LLM
    // produces near-duplicate names across parallel domain/thread calls.
    // Topology-equal runs second to catch semantically-equal pairs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameDeduped = deduplicateEntities(graph.entities as any, graph.edges as any);
    const topoMerged = mergeByTopologyEqual(nameDeduped.entities, nameDeduped.edges);
    const finalEntities = topoMerged.entities;
    const finalEdges = topoMerged.edges;
    console.log(
      `[decompose-hierarchical] Dedup: ${graph.entities.length} → ${nameDeduped.entities.length} (name) → ${finalEntities.length} (topology); ${graph.edges.length} → ${finalEdges.length} edges`,
    );

    // ── Create space ──
    const prefix =
      spaceConfig?.prefix ?? text.trim().split(/\s/)[0].slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "C");
    const spaceName = graph.metadata?.name ?? spaceConfig?.name ?? text.trim().slice(0, 60);

    const { data: spaceData, error: spaceError } = await db
      .from("spaces")
      .insert({
        user_id: user.id,
        name: spaceName,
        description: graph.metadata?.description ?? spaceConfig?.description ?? null,
        space_prefix: prefix,
        input_text: text,
        raw_decomposition: null, // No single raw text — hierarchical emits structured output directly
        synthesis_text: graph.metadata?.synthesis_text ?? null,
        entity_count: finalEntities.length,
        edge_count: finalEdges.length,
        orphan_count: 0,
        cycle_count: 0,
        maturity: MATURITY_LEVELS[0], // "actionable_now" — hierarchical output is usable immediately
        user_role: intent?.user_role ?? null,
        primary_goal: intent?.primary_goal ?? null,
        context_type: intent?.context_type ?? null,
        parent_space_id: spaceConfig?.parent_space_id ?? null,
        originated_from_entity_id: spaceConfig?.originated_from_entity_id ?? null,
        depth_level: spaceConfig?.depth_level ?? 0,
      })
      .select("id")
      .single();

    if (spaceError || !spaceData) {
      console.error("[decompose-hierarchical] Space creation failed:", spaceError);
      return NextResponse.json({ error: "Space creation failed" }, { status: 500 });
    }

    const spaceId = spaceData.id;

    // Link parent entity → newly created sub-space (same as flat route)
    const originEntityId = spaceConfig?.originated_from_entity_id;
    if (originEntityId) {
      await db
        .from("entities")
        .update({ has_sub_space: true, sub_space_id: spaceId })
        .eq("id", originEntityId);
    }

    // ── Insert entities ──
    const entityIdMap = new Map<string, string>(); // display_id → UUID
    const sanitizedEntities = finalEntities.map((e) => sanitizeEntity(e, spaceId));
    if (sanitizedEntities.length > 0) {
      const { data: entityData } = await resilientInsert(db, "entities", sanitizedEntities, "id, entity_id");
      for (const row of entityData) entityIdMap.set(row.entity_id, row.id);
    }

    // ── Materialize faults from contradictions ──
    // Hierarchical passes can surface contradictions at the thread layer.
    // Same mechanism as flat decompose: fault entity + disjoint edges.
    let faultCount = 0;
    const faultEdges: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string;
      dimension: string;
      source_tag: string;
      strength: number;
      polarity: string;
      confidence: number;
      conditions: string;
      topology: string;
    }> = [];
    try {
      const existingIds = new Set(entityIdMap.keys());
      const faultEntitiesToInsert: ReturnType<typeof sanitizeEntity>[] = [];
      for (let i = 0; i < graph.contradictions.length; i++) {
        const materialized = materializeFault(graph.contradictions[i], i, existingIds);
        if (!materialized) continue;
        faultEntitiesToInsert.push(sanitizeEntity(materialized.entity, spaceId));
        faultEdges.push(...materialized.edges);
      }
      if (faultEntitiesToInsert.length > 0) {
        const { data: faultRows } = await resilientInsert(
          db,
          "entities",
          faultEntitiesToInsert,
          "id, entity_id",
        );
        for (const row of faultRows) entityIdMap.set(row.entity_id, row.id);
        faultCount = faultRows.length;
      }
    } catch (faultErr) {
      console.warn("[decompose-hierarchical] Fault materialization failed (non-critical):", faultErr);
    }

    // ── Insert edges ──
    // Includes: composes edges (system→domain, domain→thread), semantic edges
    // within a domain, cross-domain/cross-system edges, fault edges.
    const allEdges = [...finalEdges, ...faultEdges];
    const sanitizedEdges = allEdges
      .map((e) => sanitizeEdge(e, spaceId, entityIdMap))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let edgesInserted = 0;
    if (sanitizedEdges.length > 0) {
      const { inserted } = await resilientInsert(db, "edges", sanitizedEdges, "id");
      edgesInserted = inserted;
    }

    // ── Quality scoring (hierarchical-aware) ──
    // Uses per-layer thresholds so threads with low semantic density are
    // flagged while systems with naturally-high density don't pollute the
    // signal. Unlike the flat scorer, we do NOT auto-retry: a hierarchical
    // retry would cost 50+ LLM calls. Instead we log the report and surface
    // deficiencies in the response for the caller to decide.
    let qualityReport;
    try {
      const [ent, edg] = await Promise.all([
        db.from("entities").select("*").eq("space_id", spaceId),
        db.from("edges").select("*").eq("space_id", spaceId),
      ]);
      const freshEntities = (ent.data ?? []) as Entity[];
      const freshEdges = (edg.data ?? []) as Edge[];
      qualityReport = scoreHierarchicalQuality(freshEntities, freshEdges);
      console.log(
        `[decompose-hierarchical] Quality score: ${qualityReport.overall.toFixed(3)} — spine=${qualityReport.metrics.spine_integrity.score}, thread_density=${qualityReport.metrics.thread_semantic_density.score}, cross_sys=${qualityReport.metrics.cross_system_connectivity.score}, topology=${qualityReport.metrics.topology_coverage.score}`,
      );
      if (qualityReport.deficiencies.length > 0) {
        console.log(`[decompose-hierarchical] Deficiencies: ${qualityReport.deficiencies.join(" | ")}`);
      }
      if (qualityReport.hard_gate_failures.length > 0) {
        console.warn(`[decompose-hierarchical] Hard gate failures: ${qualityReport.hard_gate_failures.join(" | ")}`);
      }
    } catch (qErr) {
      console.warn("[decompose-hierarchical] Quality scoring failed (non-critical):", qErr);
    }

    // ── Update space counts ──
    await db
      .from("spaces")
      .update({
        entity_count: entityIdMap.size,
        edge_count: edgesInserted,
        synthesis_data: {
          hierarchical: true,
          layer_counts: {
            systems: graph.stats.systems,
            domains: graph.stats.domains,
            threads: graph.stats.threads,
            faults: faultCount,
          },
          edge_counts: {
            composes: graph.stats.composes_edges,
            semantic: graph.stats.semantic_edges,
            cross_domain: graph.stats.cross_domain_edges,
            cross_system: graph.stats.cross_system_edges,
            faults: faultEdges.length,
          },
          llm_calls: graph.stats.llm_calls,
          call_failures: {
            domain: graph.stats.domain_calls_failed,
            thread: graph.stats.thread_calls_failed,
          },
          quality_report: qualityReport
            ? {
                overall: qualityReport.overall,
                metrics: qualityReport.metrics,
                deficiencies: qualityReport.deficiencies,
                hard_gate_failures: qualityReport.hard_gate_failures,
                scored_at: new Date().toISOString(),
              }
            : null,
          generated_at: new Date().toISOString(),
        },
      })
      .eq("id", spaceId);

    // Changelog (non-critical)
    await db
      .from("space_changelog")
      .insert({
        space_id: spaceId,
        version: 1,
        change_type: "initial_analysis",
        summary: `Hierarchical: ${entityIdMap.size} entities (${graph.stats.systems}S/${graph.stats.domains}D/${graph.stats.threads}T${faultCount > 0 ? `/${faultCount}F` : ""}), ${edgesInserted} edges, ${graph.stats.llm_calls} LLM calls`,
        details: {
          entity_count: entityIdMap.size,
          edge_count: edgesInserted,
          layer_counts: {
            systems: graph.stats.systems,
            domains: graph.stats.domains,
            threads: graph.stats.threads,
            faults: faultCount,
          },
          llm_calls: graph.stats.llm_calls,
          duration_ms: Date.now() - startedAt,
        },
      })
      .then(
        () => {},
        () => {},
      );

    return NextResponse.json({
      spaceId,
      entityCount: entityIdMap.size,
      edgeCount: edgesInserted,
      faultCount,
      layerCounts: {
        systems: graph.stats.systems,
        domains: graph.stats.domains,
        threads: graph.stats.threads,
      },
      edgeBreakdown: {
        composes: graph.stats.composes_edges,
        semantic: graph.stats.semantic_edges,
        cross_domain: graph.stats.cross_domain_edges,
        cross_system: graph.stats.cross_system_edges,
        faults: faultEdges.length,
      },
      llmCalls: graph.stats.llm_calls,
      callFailures: {
        domain: graph.stats.domain_calls_failed,
        thread: graph.stats.thread_calls_failed,
      },
      durationMs: Date.now() - startedAt,
      ...(qualityReport
        ? {
            qualityScore: qualityReport.overall,
            qualityDeficiencies: qualityReport.deficiencies.length,
            hardGateFailures: qualityReport.hard_gate_failures.length,
          }
        : {}),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[decompose-hierarchical] Error:", raw);
    return NextResponse.json(
      { error: `Hierarchical decomposition failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
