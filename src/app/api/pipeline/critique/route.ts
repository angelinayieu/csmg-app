import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";
import type { Entity, Edge, Cycle } from "@/types";

export const maxDuration = 30;

const VALID_DIMS = [
  "structural", "functional", "temporal", "causal",
  "correlational", "logical", "epistemic", "comparative", "agentive",
];

interface CritiqueResult {
  new_edges: Array<{
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    dimension: string;
    strength: number;
    confidence: number;
    reasoning: string;
  }>;
  new_cycles: Array<{
    name: string;
    classification: string;
    entity_ids: string[];
    intervention_point: string;
    description: string;
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
  const { spaceId } = await request.json();

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  try {
    // Fetch current data
    const [entitiesRes, edgesRes, cyclesRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
    ]);

    const entities = (entitiesRes.data ?? []) as Entity[];
    const edges = (edgesRes.data ?? []) as Edge[];
    const cycles = (cyclesRes.data ?? []) as Cycle[];

    if (entities.length === 0) {
      return NextResponse.json({ error: "No entities to critique" }, { status: 400 });
    }

    // Build entity lookup
    const uuidToId = new Map<string, string>();
    for (const e of entities) {
      uuidToId.set(e.id, e.entity_id);
    }

    const entitySummary = entities
      .map((e) => `${e.entity_id}: ${e.name} [${e.entity_category}, ${e.importance ?? "moderate"}]`)
      .join("\n");

    const edgeSummary = edges.length > 0
      ? edges.map((e) => {
          const src = uuidToId.get(e.source_entity_id) ?? "?";
          const tgt = uuidToId.get(e.target_entity_id) ?? "?";
          return `${src} → ${tgt} [${e.relationship_type}, ${e.dimension}]`;
        }).join("\n")
      : "(No edges — this is the primary problem to fix)";

    const result = await llmJSON<CritiqueResult>({
      system: `You are a graph structure analyst. Find MISSING connections in a knowledge graph.

Rules:
- Only suggest edges between entities that exist in the list
- Use entity_id strings (like C1, C5) not UUIDs
- Every edge needs a specific mechanism
- dimension must be one of: structural, functional, temporal, causal, correlational, logical, epistemic, comparative, agentive
- Validate: TRADEOFF requires shared scarce resource. CAUSAL requires nameable mechanism. ENABLES means B cannot happen without A.
- Check temporal consistency

Return ONLY valid JSON.`,
      user: `ENTITIES (${entities.length}):\n${entitySummary}\n\nEDGES (${edges.length}):\n${edgeSummary}\n\nFind 5-15 missing edges. Detect missed cycles. Suggest ranking corrections if needed.\n\nReturn: { "new_edges": [...], "new_cycles": [...], "corrected_rankings": [] }`,
      maxTokens: 4096,
      temperature: 0.3,
      model: "gpt-4o-mini",
    });

    // Insert new edges
    const entityIdToUuid = new Map<string, string>();
    for (const e of entities) entityIdToUuid.set(e.entity_id, e.id);

    const existingKeys = new Set(
      edges.map((e) => `${uuidToId.get(e.source_entity_id)}→${uuidToId.get(e.target_entity_id)}→${e.relationship_type}`)
    );

    let addedEdges = 0;
    for (const edge of result.new_edges ?? []) {
      const key = `${edge.source_entity_id}→${edge.target_entity_id}→${edge.relationship_type}`;
      if (existingKeys.has(key)) continue;

      const srcUuid = entityIdToUuid.get(edge.source_entity_id);
      const tgtUuid = entityIdToUuid.get(edge.target_entity_id);
      if (!srcUuid || !tgtUuid) continue;

      const { error } = await db.from("edges").insert({
        space_id: spaceId,
        source_entity_id: srcUuid,
        target_entity_id: tgtUuid,
        relationship_type: edge.relationship_type,
        dimension: VALID_DIMS.includes(edge.dimension) ? edge.dimension : "functional",
        source_tag: "predicted",
        strength: edge.strength ?? 0.6,
        polarity: "positive",
        confidence: edge.confidence ?? 0.7,
        conditions: edge.reasoning ?? null,
        is_low_confidence: (edge.confidence ?? 0.7) < 0.4,
      });
      if (!error) addedEdges++;
    }

    // Insert new cycles
    let addedCycles = 0;
    for (const cycle of result.new_cycles ?? []) {
      const classification = ["reinforcing_positive", "reinforcing_negative", "balancing"].includes(cycle.classification)
        ? cycle.classification : "reinforcing_positive";
      const { error } = await db.from("cycles").insert({
        space_id: spaceId,
        cycle_id: `cycle_critique_${addedCycles + 1}`,
        name: cycle.name,
        classification,
        entity_ids: cycle.entity_ids,
        intervention_point_entity_id: cycle.intervention_point
          ? entityIdToUuid.get(cycle.intervention_point) ?? null : null,
        description: cycle.description ?? null,
      });
      if (!error) addedCycles++;
    }

    // Update rankings
    let updatedRankings = 0;
    for (const r of result.corrected_rankings ?? []) {
      const uuid = entityIdToUuid.get(r.entity_id);
      if (uuid) {
        await db.from("entities").update({ centrality_rank: r.rank }).eq("id", uuid);
        updatedRankings++;
      }
    }

    // Update space counts
    await db.from("spaces").update({
      edge_count: edges.length + addedEdges,
      cycle_count: cycles.length + addedCycles,
      updated_at: new Date().toISOString(),
    }).eq("id", spaceId);

    return NextResponse.json({
      addedEdges,
      addedCycles,
      updatedRankings,
      totalEdges: edges.length + addedEdges,
    });
  } catch (err) {
    console.error("Critique error:", err);
    return NextResponse.json({ error: "Critique failed" }, { status: 500 });
  }
}
