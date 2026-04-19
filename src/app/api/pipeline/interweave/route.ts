import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { computeGraphStructure } from "@/lib/pipeline/graph-structure";
import {
  buildInterweavePrompt,
  type InterweaveAnalysis,
  type InterweavePromptInput,
} from "@/lib/prompts/interweave-analyst";
import type { Entity, Edge, Cycle } from "@/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const spaceId: string = body.spaceId;
  const iteration: number = body.iteration ?? 1;
  const maxIterations: number = body.maxIterations ?? 3;
  const priorInterweaveState = body.priorInterweaveState ?? null;

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // ── Step 1: Fetch all entities, edges, and cycles ──
    const [
      { data: entities, error: entErr },
      { data: edges, error: edgeErr },
      { data: cycles, error: cycErr },
    ] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
    ]);

    if (entErr || edgeErr) {
      console.error("[interweave] DB fetch error:", entErr ?? edgeErr);
      return NextResponse.json({ error: "Failed to fetch graph data" }, { status: 500 });
    }

    const allEntities: Entity[] = entities ?? [];
    const allEdges: Edge[] = edges ?? [];
    const allCycles: Cycle[] = cycles ?? [];

    if (allEntities.length === 0) {
      return NextResponse.json({
        analysis: {
          disconnected_clusters: [],
          decomposition_requests: [],
          connection_hypotheses: [],
          further_research_queries: [],
          connectivity_score: 100,
          should_continue: false,
          termination_reason: "No entities in graph",
        },
        graphMetrics: { node_count: 0, edge_count: 0, density: 0, avg_degree: 0, max_degree: 0, component_count: 0 },
        iteration,
        shouldContinue: false,
      });
    }

    // ── Step 2: Compute graph structure ──
    const graphStructure = computeGraphStructure(allEntities, allEdges, allCycles);

    // ── Step 3: Categorize entities and compute per-entity degree ──
    const entityByUuid = new Map<string, Entity>();
    for (const e of allEntities) entityByUuid.set(e.id, e);

    // Build degree map (using UUIDs from edges, map back to entity_id)
    const degreeMap = new Map<string, number>();
    for (const e of allEntities) degreeMap.set(e.id, 0);
    for (const edge of allEdges) {
      if (degreeMap.has(edge.source_entity_id)) {
        degreeMap.set(edge.source_entity_id, (degreeMap.get(edge.source_entity_id) ?? 0) + 1);
      }
      if (degreeMap.has(edge.target_entity_id)) {
        degreeMap.set(edge.target_entity_id, (degreeMap.get(edge.target_entity_id) ?? 0) + 1);
      }
    }

    function formatEntity(e: Entity) {
      return {
        entity_id: e.entity_id,
        name: e.name,
        description: e.description ?? "",
        degree: degreeMap.get(e.id) ?? 0,
        knowledge_layer: (e as Record<string, unknown>).knowledge_layer as string ?? "internal",
        category: (e as Record<string, unknown>).entity_category as string | undefined,
      };
    }

    const internalEntities = allEntities
      .filter((e) => {
        const kl = (e as Record<string, unknown>).knowledge_layer;
        return kl === "internal" || kl === "conceptual" || !kl;
      })
      .map(formatEntity);

    const externalEntities = allEntities
      .filter((e) => (e as Record<string, unknown>).knowledge_layer === "external")
      .map(formatEntity);

    const bridgeEntities = allEntities
      .filter((e) => (e as Record<string, unknown>).knowledge_layer === "bridge")
      .map(formatEntity);

    // If no external entities exist, nothing to interweave
    if (externalEntities.length === 0) {
      return NextResponse.json({
        analysis: {
          disconnected_clusters: [],
          decomposition_requests: [],
          connection_hypotheses: [],
          further_research_queries: [],
          connectivity_score: 100,
          should_continue: false,
          termination_reason: "No external entities to interweave",
        },
        graphMetrics: graphStructure.metrics,
        iteration,
        shouldContinue: false,
      });
    }

    // ── Step 4: Format edges with entity_id references ──
    // Edges use UUIDs, but the prompt needs entity_ids for readability
    const uuidToEntityId = new Map<string, string>();
    for (const e of allEntities) uuidToEntityId.set(e.id, e.entity_id);

    const formattedEdges = allEdges
      .map((e) => ({
        source_entity_id: uuidToEntityId.get(e.source_entity_id) ?? e.source_entity_id,
        target_entity_id: uuidToEntityId.get(e.target_entity_id) ?? e.target_entity_id,
        relationship_type: e.relationship_type ?? "related",
        dimension: e.dimension ?? "epistemic",
        knowledge_layer: (e as Record<string, unknown>).knowledge_layer as string ?? "internal",
        strength: e.strength ?? 0.5,
      }));

    // Map component entity_ids (currently UUIDs from computeGraphStructure) — already mapped by computeGraphStructure

    // ── Step 5: Build prompt ──
    const promptInput: InterweavePromptInput = {
      internalEntities,
      externalEntities,
      bridgeEntities,
      edges: formattedEdges,
      metrics: graphStructure.metrics,
      components: graphStructure.components,
      iteration,
      maxIterations,
      priorIterationState: priorInterweaveState,
    };

    const { systemPrompt, userPrompt } = buildInterweavePrompt(promptInput);

    // ── Step 6: LLM call ──
    console.log(
      `[interweave] Iteration ${iteration}/${maxIterations} — ` +
      `${internalEntities.length} internal, ${externalEntities.length} external, ` +
      `${allEdges.length} edges, ${graphStructure.metrics.component_count} components`
    );

    const analysis = await llmJSON<InterweaveAnalysis>({
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 8000,
      temperature: 0.3,
    });

    // ── Step 7: Store interweave state ──
    const { data: spaceData } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();

    const existingSynthData = spaceData?.synthesis_data ?? {};

    await db
      .from("spaces")
      .update({
        synthesis_data: {
          ...existingSynthData,
          interweave_state: {
            iteration,
            connectivity_score: analysis.connectivity_score ?? 0,
            hypotheses_count: analysis.connection_hypotheses?.length ?? 0,
            decomposition_count: analysis.decomposition_requests?.length ?? 0,
            research_queries_count: analysis.further_research_queries?.length ?? 0,
            should_continue: analysis.should_continue ?? false,
            termination_reason: analysis.termination_reason,
            updated_at: new Date().toISOString(),
          },
        },
      })
      .eq("id", spaceId);

    // ── Step 8: Determine if we should continue ──
    const hasWork =
      (analysis.decomposition_requests?.length ?? 0) > 0 ||
      (analysis.connection_hypotheses?.length ?? 0) > 0 ||
      (analysis.further_research_queries?.length ?? 0) > 0;

    const shouldContinue =
      (analysis.should_continue ?? false) &&
      hasWork &&
      iteration < maxIterations;

    console.log(
      `[interweave] Result: connectivity=${analysis.connectivity_score}, ` +
      `hypotheses=${analysis.connection_hypotheses?.length ?? 0}, ` +
      `decompositions=${analysis.decomposition_requests?.length ?? 0}, ` +
      `queries=${analysis.further_research_queries?.length ?? 0}, ` +
      `continue=${shouldContinue}`
    );

    return NextResponse.json({
      analysis,
      graphMetrics: graphStructure.metrics,
      iteration,
      shouldContinue,
    });
  } catch (err: unknown) {
    console.error("[interweave] Error:", err);
    return NextResponse.json(
      {
        error: "Interweave analysis failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
