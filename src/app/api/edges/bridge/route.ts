import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 10;

/**
 * POST /api/edges/bridge
 * Creates a new bridge edge between an external and internal entity.
 * Accepts entity_id (slug) format — validates both entities exist in the space.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    const body = await request.json();
    const {
      space_id,
      source_entity_id,
      target_entity_id,
      relationship_type,
    } = body as {
      space_id: string;
      source_entity_id: string;
      target_entity_id: string;
      relationship_type?: string;
    };

    if (!space_id || !source_entity_id || !target_entity_id) {
      return Response.json(
        { error: "Missing required fields: space_id, source_entity_id, target_entity_id" },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // Verify user owns the space
    const { data: space } = await db
      .from("spaces")
      .select("id")
      .eq("id", space_id)
      .eq("user_id", user.id)
      .single();

    if (!space) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Validate both entities exist and look up names for better relationship_type
    // Accept either entity_id (slug) or UUID — normalize to entity_id
    const { data: sourceEntity } = await db
      .from("entities")
      .select("id, entity_id, name, knowledge_layer")
      .eq("space_id", space_id)
      .or(`entity_id.eq.${source_entity_id},id.eq.${source_entity_id}`)
      .limit(1)
      .single();

    const { data: targetEntity } = await db
      .from("entities")
      .select("id, entity_id, name, knowledge_layer")
      .eq("space_id", space_id)
      .or(`entity_id.eq.${target_entity_id},id.eq.${target_entity_id}`)
      .limit(1)
      .single();

    if (!sourceEntity || !targetEntity) {
      return Response.json(
        { error: `Entity not found: ${!sourceEntity ? source_entity_id : target_entity_id}` },
        { status: 404 },
      );
    }

    // Check for duplicate bridge
    const { data: existing } = await db
      .from("edges")
      .select("id")
      .eq("space_id", space_id)
      .eq("source_entity_id", sourceEntity.entity_id)
      .eq("target_entity_id", targetEntity.entity_id)
      .eq("knowledge_layer", "bridge")
      .limit(1);

    if (existing && existing.length > 0) {
      return Response.json(
        { success: true, edge_id: existing[0].id, already_exists: true },
      );
    }

    // Create the bridge edge — always use entity_id (slug) format for consistency
    const { data: edge, error: insertErr } = await db
      .from("edges")
      .insert({
        space_id,
        source_entity_id: sourceEntity.entity_id,
        target_entity_id: targetEntity.entity_id,
        relationship_type: relationship_type ?? `bridge: ${sourceEntity.name} ↔ ${targetEntity.name}`,
        knowledge_layer: "bridge",
        dimension: "epistemic",
        source_tag: "inferred",
        confidence: 0.5,
        strength: 0.5,
        polarity: "neutral",
        provenance: {
          created_by: "user_suggested",
          created_at: new Date().toISOString(),
          source_name: sourceEntity.name,
          target_name: targetEntity.name,
        },
      })
      .select("id")
      .single();

    if (insertErr) {
      return Response.json(
        { error: "Failed to create bridge edge: " + insertErr.message },
        { status: 500 },
      );
    }

    return Response.json({ success: true, edge_id: edge?.id });
  } catch (err) {
    console.error("[CreateBridgeEdge] Error:", err);
    return Response.json(
      { error: "Failed to create bridge edge" },
      { status: 500 },
    );
  }
}
