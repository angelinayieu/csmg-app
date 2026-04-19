/**
 * Intelligence Feedback API Route
 *
 * Closes the intelligence → graph feedback loop:
 *   1. Compute probability spaces from edge + expansion data
 *   2. Detect intersections across probability spaces
 *   3. Run intelligence feedback engine (intersections → discovered edges)
 *   4. Materialize discovered edges into the graph
 *   5. Store novel connections for dashboard consumption
 *   6. Return full intelligence report for UI
 *
 * POST /api/pipeline/intelligence-feedback
 * Body: { spaceId: string }
 */

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, refreshSpaceCounts } from "@/lib/api-helpers";
import { resilientInsert } from "@/lib/sanitize";
import {
  buildProbabilitySpacesForGraph,
  summarizeProbabilitySpaceDiagnostics,
} from "@/lib/pipeline/probability-space-engine";
import { detectIntersections } from "@/lib/pipeline/intersection-detector";
import {
  computeIntelligenceFeedback,
  buildDiscoveredEdgeRecords,
} from "@/lib/pipeline/intelligence-feedback";
import { enrichTopIntersectionInsights } from "@/lib/pipeline/intersection-insights";
import { computeMetaIntelligence } from "@/lib/pipeline/intelligence-meta";
import { extractSignals } from "@/lib/intelligence/signal-extraction";
import { computeCrossLayerAnalysis } from "@/lib/pipeline/cross-layer-analysis";
import { detectCompositions } from "@/lib/pipeline/compositional-logic";
import { isUserLayer, isConceptualLayer, isExternalLayer } from "@/lib/intelligence/layer-semantics";
import type { Entity, Edge } from "@/types";
import type { ProbabilitySpace, SpaceIntersection } from "@/types/probability-space";
import type { IntelligenceRadarDataV2 } from "@/types/intelligence-v2";
import type { IntelligenceSignal } from "@/types/intelligence";
import type { SynthesisData } from "@/types/synthesis";
import type { CrossLayerAnalysisSummary } from "@/types/layer";

export const maxDuration = 120;

function isTrivialSyntheticSpace(space: ProbabilitySpace): boolean {
  return space.id.startsWith("synth_") && space.nodes.length <= 3;
}

function isWeakIntersection(intersection: SpaceIntersection): boolean {
  const bestSimilarity = intersection.shared_nodes.reduce(
    (max, sn) => Math.max(max, sn.similarity ?? 0),
    0
  );
  return bestSimilarity < 0.7;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let goalEntityIds: string[] = [];
  try {
    const body = await request.json();
    spaceId = body.spaceId;
    if (Array.isArray(body.goalEntityIds)) {
      goalEntityIds = body.goalEntityIds.filter((v: unknown): v is string => typeof v === "string");
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // ── 1. Fetch all graph data + expansions ──

    const [entitiesRes, edgesRes, expansionsRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("expansions")
        .select("entity_id, sub_components, internal_pathways, internal_dynamics")
        .eq("space_id", spaceId)
        .eq("stale", false),
    ]);

    const entities = (entitiesRes.data ?? []) as Entity[];
    const edges = (edgesRes.data ?? []) as Edge[];
    const expansionsRaw = expansionsRes.data ?? [];

    if (entities.length === 0 || edges.length === 0) {
      return NextResponse.json({
        error: "Need entities and edges to compute intelligence feedback. Run decomposition first.",
      }, { status: 400 });
    }

    // Build expansions map
    const expansionsMap = new Map<string, { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }>();
    for (const exp of expansionsRaw) {
      expansionsMap.set(exp.entity_id, {
        sub_components: exp.sub_components,
        internal_pathways: exp.internal_pathways,
        internal_dynamics: exp.internal_dynamics,
      });
    }

    // ── 2. Compute probability spaces ──

    const spaces = buildProbabilitySpacesForGraph(edges, entities, expansionsMap, goalEntityIds);
    const spaceDiagnostics = summarizeProbabilitySpaceDiagnostics(spaces);

    if (spaces.length === 0) {
      return NextResponse.json({
        error: "No probability spaces could be computed. Try running Entity Expansion first.",
      }, { status: 400 });
    }

    // ── 3. Detect intersections ──

    const intersectionsRaw = detectIntersections(spaces, entities, edges, 25);

    // ── 3b. Enrich top intersection insights (cached, fallback-safe) ──

    const enrichment = await enrichTopIntersectionInsights({
      intersections: intersectionsRaw,
      spaces,
      topN: 10,
    });
    const intersections = enrichment.intersections;
    const validatedSpaces = spaces.filter(
      (s) => s.quality_tier !== "speculative" && !isTrivialSyntheticSpace(s)
    );
    const validatedIntersections = intersections.filter((i) => !isWeakIntersection(i));

    // ── 3c. Cross-layer analysis + compositional logic ──

    let crossLayerSummary: CrossLayerAnalysisSummary | null = null;
    try {
      const crossLayerResult = computeCrossLayerAnalysis(entities, edges);
      if (crossLayerResult.validation_chains.length > 0 || crossLayerResult.layer_tensions.length > 0) {
        crossLayerSummary = {
          validation_chain_count: crossLayerResult.validation_chains.length,
          layer_tension_count: crossLayerResult.layer_tensions.length,
          layer_density: crossLayerResult.layer_density,
          top_validation_chains: crossLayerResult.validation_chains.slice(0, 5),
          top_layer_tensions: crossLayerResult.layer_tensions.slice(0, 3),
        };
      }
    } catch (crossErr) {
      console.warn("[intelligence-feedback] Cross-layer analysis failed (non-critical):", crossErr);
    }

    const compositions = detectCompositions(validatedIntersections, spaces, entities);

    // ── 4. Compute intelligence feedback ──

    const feedback = computeIntelligenceFeedback(
      spaces,
      intersections,
      entities,
      edges,
      spaceId,
    );

    // ── 5. Materialize discovered edges into graph ──

    let edgesInserted = 0;
    if (feedback.discovered_edges.length > 0) {
      // Build entity layer map so discovered edges get correct knowledge_layer
      const entityLayerMap = new Map<string, string>();
      for (const e of entities) {
        entityLayerMap.set(e.id, e.knowledge_layer ?? "internal");
        entityLayerMap.set(e.entity_id, e.knowledge_layer ?? "internal");
      }
      const edgeRecords = buildDiscoveredEdgeRecords(spaceId, feedback.discovered_edges, entityLayerMap);
      const { inserted } = await resilientInsert(db, "edges", edgeRecords, "id");
      edgesInserted = inserted;
    }

    // ── 6. Store novel connections ──

    let novelConnectionsInserted = 0;
    if (feedback.novel_connections.length > 0) {
      // Dedup against existing novel connections
      const { data: existingNCs } = await db
        .from("novel_connections")
        .select("source_entity_id, target_entity_id, relationship_type")
        .eq("space_id", spaceId);

      const existingKeys = new Set(
        (existingNCs ?? []).map(
          (nc: { source_entity_id: string; target_entity_id: string; relationship_type: string }) =>
            `${nc.source_entity_id}→${nc.target_entity_id}→${nc.relationship_type}`
        )
      );

      const newNCs = feedback.novel_connections
        .filter((nc) => {
          const key = `${nc.source_entity_id}→${nc.target_entity_id}→${nc.relationship_type}`;
          const reverseKey = `${nc.target_entity_id}→${nc.source_entity_id}→${nc.relationship_type}`;
          return !existingKeys.has(key) && !existingKeys.has(reverseKey);
        })
        .map((nc) => ({
          space_id: nc.space_id,
          source_entity_id: nc.source_entity_id,
          target_entity_id: nc.target_entity_id,
          relationship_type: nc.relationship_type,
          strength: nc.strength,
          reasoning: nc.reasoning,
        }));

      if (newNCs.length > 0) {
        const { inserted } = await resilientInsert(db, "novel_connections", newNCs, "id");
        novelConnectionsInserted = inserted;
      }
    }

    // ── 6b. Compute meta-intelligence (v2) — parallel with count refresh ──

    let metaIntelligenceResult: IntelligenceRadarDataV2 | null = null;
    try {
      // Fetch synthesis data + cycles for meta-intelligence
      const [synthRes, cyclesRes] = await Promise.all([
        db.from("spaces").select("synthesis_data").eq("id", spaceId).single(),
        db.from("cycles").select("*").eq("space_id", spaceId),
      ]);

      const synthesisData = (synthRes.data?.synthesis_data ?? {}) as Partial<SynthesisData> & Record<string, unknown>;
      const cycles = cyclesRes.data ?? [];
      const existingV2 = synthesisData.intelligence_radar_v2 as IntelligenceRadarDataV2 | undefined;
      const radarData = synthesisData.intelligence_radar as { signals?: IntelligenceSignal[] } | undefined;
      const signals: IntelligenceSignal[] = radarData?.signals ?? [];

      // Build strategy context from existing strategic recommendation
      const stratRec = (synthesisData.strategic_recommendation as unknown as Record<string, unknown>)?.recommendation as Record<string, unknown> | undefined;
      const strategyContext = stratRec
        ? `Strategy: ${stratRec.title ?? ""}. Posture: ${stratRec.strategic_posture ?? ""}. ${stratRec.guiding_policy ?? ""}`
        : "";

      // Run V1 signal extraction to feed as context into V2 structural patterns
      let signalExtractionResult = null;
      try {
        signalExtractionResult = extractSignals(entities, edges, cycles, null);
      } catch (sigErr) {
        console.warn("[intelligence-feedback] Signal extraction failed (non-critical):", sigErr);
      }

      metaIntelligenceResult = await computeMetaIntelligence({
        entities,
        edges,
        cycles,
        signals,
        intersections: validatedIntersections,
        strategyContext,
        existingV2: existingV2 ?? null,
        maxDecisions: 5,
        signalExtractionResult,
      });

      // Store v2 payload in synthesis_data (including cross-layer analysis)
      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...synthesisData,
            intelligence_radar_v2: {
              ...metaIntelligenceResult,
              cross_layer_analysis: crossLayerSummary,
              compositions: compositions.length > 0 ? compositions.slice(0, 5) : undefined,
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", spaceId);
    } catch (metaErr) {
      console.warn("[intelligence-feedback] Meta-intelligence computation failed (non-critical):", metaErr);
    }

    // ── 7. Update space counts ──

    await refreshSpaceCounts(db, [spaceId]);

    // ── 7b. Baseline telemetry (Phase 0 instrumentation) ──

    console.info("[probability-intelligence][baseline]", {
      space_id: spaceId,
      total_entities: entities.length,
      total_edges: edges.length,
      probability_spaces_computed: spaces.length,
      synthetic_spaces: spaceDiagnostics.synthetic_spaces,
      synthetic_space_pct: Number((spaceDiagnostics.synthetic_space_pct * 100).toFixed(1)),
      probability_edges_total: spaceDiagnostics.total_probability_edges,
      likely_default_probability_edges: spaceDiagnostics.likely_default_probability_edges,
      likely_default_probability_edge_pct: Number((spaceDiagnostics.likely_default_probability_edge_pct * 100).toFixed(1)),
      spaces_with_any_likely_default_probability: spaceDiagnostics.spaces_with_any_likely_default_probability,
      intersections_detected: intersections.length,
      intersections_high_potential: feedback.summary.high_potential_intersections,
      intersections_insight_enriched: enrichment.enriched_count,
      intersections_insight_cache_hits: enrichment.cache_hits,
      goal_entity_count: goalEntityIds.length,
      discovered_edges: feedback.summary.edges_discovered,
      discovered_edges_materialized: edgesInserted,
      novel_connections_stored: novelConnectionsInserted,
      cross_layer_spaces: spaces.filter(s => s.layer_profile?.is_cross_layer).length,
      cross_layer_intersections: validatedIntersections.filter(i => i.layer_crossing?.is_cross_layer).length,
    });

    // ── 8. Log to changelog ──

    await db.from("space_changelog").insert({
      space_id: spaceId,
      // NOTE: Keep this value compatible with current DB check constraint.
      // Detailed event type remains in details/source fields.
      change_type: "synthesis_refresh",
      summary: `Intelligence feedback: ${feedback.summary.edges_discovered} discoveries from ${feedback.summary.intersections_analyzed} intersections, ${edgesInserted} materialized, ${feedback.summary.risk_flags_raised} risks flagged`,
      details: {
        event_type: "intelligence_feedback",
        spaces_computed: spaces.length,
        intersections_found: intersections.length,
        high_potential_intersections: feedback.summary.high_potential_intersections,
        intersections_insight_enriched: enrichment.enriched_count,
        intersections_insight_cache_hits: enrichment.cache_hits,
        goal_entity_count: goalEntityIds.length,
        edges_discovered: feedback.summary.edges_discovered,
        edges_materialized: edgesInserted,
        novel_connections_stored: novelConnectionsInserted,
        risk_flags: feedback.summary.risk_flags_raised,
        key_discoveries: feedback.summary.key_discoveries,
        density_impact: feedback.summary.density_impact,
      },
    }).then(() => {}, (changelogErr: unknown) => {
      console.warn("[intelligence-feedback] changelog insert failed (non-critical):", changelogErr);
    });
    // ── 9. Return full intelligence report ──

    return NextResponse.json({
      // Summary stats
      spaces_computed: spaces.length,
      intersections_found: intersections.length,
      edges_discovered: feedback.summary.edges_discovered,
      edges_materialized: edgesInserted,
      novel_connections_stored: novelConnectionsInserted,
      risk_flags_raised: feedback.summary.risk_flags_raised,

      // Full data for UI rendering
      feedback: {
        discovered_edges: feedback.discovered_edges,
        novel_connections: feedback.novel_connections,
        risk_flags: feedback.risk_flags,
        summary: feedback.summary,
      },

      // Probability space data (for UI visualization)
      probability_spaces: spaces.map((s) => ({
        id: s.id,
        edge_id: s.edge_id,
        source_entity_name: s.source_entity_name,
        target_entity_name: s.target_entity_name,
        total_pathway_probability: s.total_pathway_probability,
        quality_tier: s.quality_tier ?? "estimated",
        probability_source_breakdown: {
          measured: s.edges.filter((e) => e.probability_source === "measured").length,
          estimated: s.edges.filter((e) => e.probability_source === "estimated" || !e.probability_source).length,
          default: s.edges.filter((e) => e.probability_source === "default").length,
        },
        failure_points_count: s.failure_points.length,
        nodes_count: s.nodes.length,
        critical_path_length: s.critical_path.length,
        layer_profile: s.layer_profile ?? null,
      })),
      probability_spaces_validated: validatedSpaces.map((s) => ({
        id: s.id,
        edge_id: s.edge_id,
        source_entity_name: s.source_entity_name,
        target_entity_name: s.target_entity_name,
        total_pathway_probability: s.total_pathway_probability,
        quality_tier: s.quality_tier ?? "estimated",
      })),
      validation_gate_summary: {
        spaces_total: spaces.length,
        spaces_validated: validatedSpaces.length,
        spaces_filtered_out: spaces.length - validatedSpaces.length,
        intersections_total: intersections.length,
        intersections_validated: validatedIntersections.length,
        intersections_filtered_out: intersections.length - validatedIntersections.length,
      },

      // Intersection data
      intersections: intersections.map((i) => ({
        id: i.id,
        space_a_label: i.space_a_label,
        space_b_label: i.space_b_label,
        shared_nodes: i.shared_nodes.map((sn) => sn.name),
        novelty_score: i.novelty_score,
        impact_score: i.impact_score,
        insight: i.insight,
        innovation_potential: i.innovation_potential,
      })),
      intersections_validated: validatedIntersections.map((i) => ({
        id: i.id,
        space_a_label: i.space_a_label,
        space_b_label: i.space_b_label,
        shared_nodes: i.shared_nodes.map((sn) => sn.name),
        novelty_score: i.novelty_score,
        impact_score: i.impact_score,
        insight: i.insight,
        innovation_potential: i.innovation_potential,
      })),

      // v2 meta-intelligence (when available)
      meta_intelligence: metaIntelligenceResult
        ? {
            decisions_generated: metaIntelligenceResult.priority_decisions_v2?.length ?? 0,
            has_core_tension: !!metaIntelligenceResult.core_tension,
            unknowns_count: metaIntelligenceResult.unknowns?.length ?? 0,
            contradictions_count: metaIntelligenceResult.contradictions?.length ?? 0,
            triads_count: metaIntelligenceResult.triads?.length ?? 0,
            archetypes_count: metaIntelligenceResult.archetype_matches?.length ?? 0,
            has_narrative: !!metaIntelligenceResult.narrative,
            attention_items_count: metaIntelligenceResult.narrative?.attention_items?.length ?? 0,
          }
        : null,

      // 3-Layer KG analysis
      cross_layer: crossLayerSummary ? {
        validation_chains: crossLayerSummary.validation_chain_count,
        layer_tensions: crossLayerSummary.layer_tension_count,
        compositions: compositions.length,
        layer_density: crossLayerSummary.layer_density,
      } : null,
    });
  } catch (err) {
    console.error("Intelligence feedback error:", err);
    return NextResponse.json({ error: "Intelligence feedback failed" }, { status: 500 });
  }
}
