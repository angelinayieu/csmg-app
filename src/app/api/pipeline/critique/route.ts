import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { sanitizeEdge, sanitizeCycle, resilientInsert, EDGE_DIMENSIONS } from "@/lib/sanitize";
import type { Entity, Edge, Cycle } from "@/types";

export const maxDuration = 90;

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
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let spaceId: string;
  try {
    const body = await request.json();
    spaceId = body.spaceId;
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

    // Sanitize and insert new edges
    const newEdgeRows = (result.new_edges ?? [])
      .filter((edge) => {
        const key = `${edge.source_entity_id}→${edge.target_entity_id}→${edge.relationship_type}`;
        return !existingKeys.has(key);
      })
      .map((edge) =>
        sanitizeEdge(
          { ...edge, source_tag: "predicted", polarity: "positive", conditions: edge.reasoning ?? null },
          spaceId,
          entityIdToUuid
        )
      )
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let addedEdges = 0;
    if (newEdgeRows.length > 0) {
      const { inserted } = await resilientInsert(db, "edges", newEdgeRows, "id");
      addedEdges = inserted;
    }

    // Sanitize and insert new cycles
    const newCycleRows = (result.new_cycles ?? [])
      .map((cycle, i) =>
        sanitizeCycle(
          { ...cycle, cycle_id: `cycle_critique_${i + 1}`, intervention_point_entity_id: cycle.intervention_point },
          spaceId,
          entityIdToUuid
        )
      )
      .filter((c): c is NonNullable<typeof c> => c !== null);

    let addedCycles = 0;
    if (newCycleRows.length > 0) {
      const { inserted } = await resilientInsert(db, "cycles", newCycleRows, "id");
      addedCycles = inserted;
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
