import { llmJSON } from "@/lib/llm";
import { WEAVING_SYSTEM_PROMPT } from "@/lib/prompts/weaving";
import type { WeaveResponse } from "@/types/weave";
import { safeAuth, verifyMultiSpaceOwnership } from "@/lib/api-helpers";
import {
  buildBridgeInput,
  upsertMemoryItemsBatch,
} from "@/lib/memory/writer";

export const maxDuration = 90;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  let spaceAId: string, spaceBId: string;
  try {
    const body = await request.json();
    spaceAId = body.spaceAId;
    spaceBId = body.spaceBId;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!spaceAId || !spaceBId || spaceAId === spaceBId) {
    return Response.json(
      { error: "Two different space IDs are required" },
      { status: 400 }
    );
  }

  const isOwner = await verifyMultiSpaceOwnership(supabase, [spaceAId, spaceBId], user.id);
  if (!isOwner) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Fetch both spaces with their entities and edges
    const [spaceARes, spaceBRes, entitiesARes, entitiesBRes, edgesARes, edgesBRes] =
      await Promise.all([
        db.from("spaces").select("id, name, space_prefix").eq("id", spaceAId).single(),
        db.from("spaces").select("id, name, space_prefix").eq("id", spaceBId).single(),
        db.from("entities").select("id, entity_id, name, description, entity_type, entity_category, is_shared_variable").eq("space_id", spaceAId),
        db.from("entities").select("id, entity_id, name, description, entity_type, entity_category, is_shared_variable").eq("space_id", spaceBId),
        db.from("edges").select("source_entity_id, target_entity_id, relationship_type, dimension").eq("space_id", spaceAId),
        db.from("edges").select("source_entity_id, target_entity_id, relationship_type, dimension").eq("space_id", spaceBId),
      ]);

    if (spaceARes.error || spaceBRes.error) {
      return Response.json({ error: "Could not fetch spaces" }, { status: 404 });
    }

    const spaceA = spaceARes.data;
    const spaceB = spaceBRes.data;
    const entitiesA = entitiesARes.data ?? [];
    const entitiesB = entitiesBRes.data ?? [];
    const edgesA = edgesARes.data ?? [];
    const edgesB = edgesBRes.data ?? [];

    // Build entity UUID → entity_id lookup for edge resolution
    const uuidToIdA = new Map<string, string>();
    for (const e of entitiesA) uuidToIdA.set(e.id, e.entity_id);
    const uuidToIdB = new Map<string, string>();
    for (const e of entitiesB) uuidToIdB.set(e.id, e.entity_id);

    // Prepare space data for the prompt
    const spaceAData = {
      prefix: spaceA.space_prefix,
      name: spaceA.name,
      entities: entitiesA.map((e: { entity_id: string; name: string; description: string; entity_type: string; entity_category: string; is_shared_variable: boolean }) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description,
        type: e.entity_type,
        category: e.entity_category,
        is_shared_variable: e.is_shared_variable,
      })),
      edges: edgesA.map((e: { source_entity_id: string; target_entity_id: string; relationship_type: string; dimension: string }) => ({
        source: uuidToIdA.get(e.source_entity_id) ?? e.source_entity_id,
        target: uuidToIdA.get(e.target_entity_id) ?? e.target_entity_id,
        type: e.relationship_type,
        dimension: e.dimension,
      })),
    };

    const spaceBData = {
      prefix: spaceB.space_prefix,
      name: spaceB.name,
      entities: entitiesB.map((e: { entity_id: string; name: string; description: string; entity_type: string; entity_category: string; is_shared_variable: boolean }) => ({
        entity_id: e.entity_id,
        name: e.name,
        description: e.description,
        type: e.entity_type,
        category: e.entity_category,
        is_shared_variable: e.is_shared_variable,
      })),
      edges: edgesB.map((e: { source_entity_id: string; target_entity_id: string; relationship_type: string; dimension: string }) => ({
        source: uuidToIdB.get(e.source_entity_id) ?? e.source_entity_id,
        target: uuidToIdB.get(e.target_entity_id) ?? e.target_entity_id,
        type: e.relationship_type,
        dimension: e.dimension,
      })),
    };

    // Call LLM
    const parsed = await llmJSON<WeaveResponse>({
      system: WEAVING_SYSTEM_PROMPT,
      user: `Discover shared variables and bridges between these two context spaces.\n\nSpace A (${spaceA.name}):\n${JSON.stringify(spaceAData, null, 2)}\n\nSpace B (${spaceB.name}):\n${JSON.stringify(spaceBData, null, 2)}`,
      maxTokens: 4000,
      temperature: 0.3,
    });

    // Build entity_id → UUID lookups for bridge storage
    const idToUuidA = new Map<string, string>();
    for (const e of entitiesA) idToUuidA.set(e.entity_id, e.id);
    const idToUuidB = new Map<string, string>();
    for (const e of entitiesB) idToUuidB.set(e.entity_id, e.id);

    // Insert bridges
    const bridgeInserts = (parsed.bridges ?? [])
      .filter(
        (b) =>
          idToUuidA.has(b.source_entity_id) && idToUuidB.has(b.target_entity_id)
      )
      .map((b) => ({
        source_space_id: spaceAId,
        source_entity_id: idToUuidA.get(b.source_entity_id)!,
        target_space_id: spaceBId,
        target_entity_id: idToUuidB.get(b.target_entity_id)!,
        bridge_type: b.bridge_type,
        coupling_strength: b.coupling_strength,
        coupling_direction: b.coupling_direction,
        shared_variable_name: b.shared_variable_name,
        description: b.description,
        discovery_method: "llm_reasoning" as const,
        confidence: b.coupling_strength === "strong" ? 0.9 : b.coupling_strength === "moderate" ? 0.7 : 0.5,
      }));

    if (bridgeInserts.length > 0) {
      const { data: insertedBridges, error: bridgeError } = await db
        .from("bridges")
        .insert(bridgeInserts)
        .select(
          "id, source_entity_id, target_entity_id, bridge_type, shared_variable_name, description",
        );
      if (bridgeError) console.error("Bridge insert error:", bridgeError);

      // Memory-index the new bridges so ambient retrieval + proposals can
      // surface them without waiting for the backfill endpoint.
      if (insertedBridges && insertedBridges.length > 0) {
        try {
          const bridgeRows = insertedBridges as Array<{
            id: string;
            source_entity_id: string;
            target_entity_id: string;
            bridge_type: string;
            shared_variable_name: string;
            description: string | null;
          }>;
          // Collect entity names for readable memory text
          const entityIds = Array.from(
            new Set(
              bridgeRows.flatMap((b) => [b.source_entity_id, b.target_entity_id]),
            ),
          );
          const { data: entityNames } = await db
            .from("entities")
            .select("id, name")
            .in("id", entityIds);
          const nameById = new Map(
            ((entityNames ?? []) as Array<{ id: string; name: string }>).map((e) => [
              e.id,
              e.name,
            ]),
          );
          await upsertMemoryItemsBatch(
            db,
            bridgeRows.map((b) =>
              buildBridgeInput(
                user.id,
                {
                  id: b.id,
                  source_entity_id: b.source_entity_id,
                  target_entity_id: b.target_entity_id,
                  shared_variable_name: b.shared_variable_name,
                  description: b.description,
                  bridge_type: b.bridge_type,
                },
                nameById.get(b.source_entity_id),
                nameById.get(b.target_entity_id),
              ),
            ),
          );
        } catch (memErr) {
          console.warn("[weave] memory index failed (non-fatal):", memErr);
        }
      }
    }

    // Insert contradictions
    const contradictionInserts = (parsed.contradictions ?? []).map((c) => ({
      space_a_id: spaceAId,
      space_b_id: spaceBId,
      assumption_text: c.assumption_text,
      conclusion_text: c.conclusion_text,
      severity: c.severity,
      description: c.description,
    }));

    if (contradictionInserts.length > 0) {
      const { error: contradError } = await db
        .from("contradictions")
        .insert(contradictionInserts);
      if (contradError) console.error("Contradiction insert error:", contradError);
    }

    return Response.json({
      bridges: parsed.bridges ?? [],
      contradictions: parsed.contradictions ?? [],
      bridgesSaved: bridgeInserts.length,
    });
  } catch (err) {
    console.error("[Weave] Error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Weaving failed" },
      { status: 500 }
    );
  }
}
