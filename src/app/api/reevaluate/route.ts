import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCredits, deductCredits } from "@/lib/credits";
import { llmJSON } from "@/lib/llm";
import { safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Entity, Edge, Cycle } from "@/types";

export const maxDuration = 120;

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Credit check (1 credit for re-evaluation — single fast call)
  const creditCheck = await checkCredits(db, user.id, "quick");
  if (!creditCheck.hasCredits) {
    return NextResponse.json(
      { error: `Insufficient credits. Need ${creditCheck.required}, have ${creditCheck.balance}.` },
      { status: 402 }
    );
  }

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  const { spaceId } = body;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
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

    // Single fast LLM call to find missing edges
    const result = await llmJSON<RevalResult>({
      system: `You are a graph structure analyst. You receive a knowledge graph (entities + edges) and find MISSING connections.

Rules:
- Only suggest edges between entities that ACTUALLY exist in the list
- Use entity_id strings (like C1, C5) for source and target
- Every edge needs a specific mechanism — no vague connections
- dimension must be one of: structural, functional, temporal, causal, correlational, logical, epistemic, comparative, agentive
- Validate each edge: TRADEOFF requires shared scarce resource. CAUSAL requires nameable mechanism. ENABLES means B cannot happen without A.
- Check temporal consistency: if A happens after B, A cannot enable or cause B

Return ONLY valid JSON.`,
      user: `Here is a knowledge graph to analyze. Find missing connections.

ENTITIES (${entities.length}):
${entitySummary}

CURRENT EDGES (${edges.length}):
${edgeSummary}

CURRENT CYCLES (${cycles.length}):
${cycleSummary}

Tasks:
1. Find 5-10 missing edges that should exist based on the entity relationships. Focus on edges that complete causal chains or connect isolated entities.
2. Detect any feedback cycles not yet identified.
3. If the current centrality ranking seems wrong, suggest corrections.

Return JSON:
{
  "new_edges": [{"source_entity_id": "C1", "target_entity_id": "C5", "relationship_type": "enables", "dimension": "functional", "strength": 0.7, "confidence": 0.8, "reasoning": "why this edge exists", "dynamics": "threshold | linear | compounding | exponential | logarithmic | decay | step_function | delayed", "dynamics_properties": {"threshold_condition": "optional detail"}}],
  "new_cycles": [{"name": "cycle name", "classification": "reinforcing_positive", "entity_ids": ["C1", "C5", "C8"], "intervention_point": "C5", "description": "what this cycle does", "growth_type": "additive | multiplicative | accelerating | decelerating", "cycle_time": "~1 week", "estimated_multiplier": 1.3}],
  "corrected_rankings": []
}`,
      maxTokens: 4096,
      temperature: 0.3,
      model: "gpt-4o-mini",
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

      // Skip low-confidence edges
      if ((edge.confidence ?? 0.7) < 0.4) continue;

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

    // Deduct credits
    await deductCredits(db, user.id, "quick", spaceId);

    return NextResponse.json({
      added_edges: addedEdges,
      added_cycles: addedCycles,
      updated_entities: updatedEntities,
    });
  } catch (err) {
    console.error("Re-evaluation error:", err);
    return NextResponse.json(
      { error: "Re-evaluation failed. Please try again." },
      { status: 500 }
    );
  }
}
