import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";
import { REASONING_PROMPTS } from "@/lib/prompts/reasoning";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { spaceId, operation, params } = body as {
    spaceId: string;
    operation: string;
    params?: { entityId?: string; fromId?: string; toId?: string };
  };

  if (!spaceId || !operation) {
    return NextResponse.json(
      { error: "spaceId and operation are required" },
      { status: 400 }
    );
  }

  const validOps = ["centrality", "cycles", "cascade", "link_prediction", "path"];
  if (!validOps.includes(operation)) {
    return NextResponse.json(
      { error: `Invalid operation. Must be one of: ${validOps.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // Fetch space data
    const { data: entities } = await db
      .from("entities")
      .select("entity_id, name, entity_type, entity_category, layer, importance, confidence, is_leverage_point, is_risk_point, blast_radius, centrality_rank")
      .eq("space_id", spaceId);

    const { data: edges } = await db
      .from("edges")
      .select("source_entity_id, target_entity_id, relationship_type, dimension, strength, polarity, confidence")
      .eq("space_id", spaceId);

    // Build the entities lookup for edge resolution
    const entityUuids = new Map<string, string>();
    const { data: entityRows } = await db
      .from("entities")
      .select("id, entity_id")
      .eq("space_id", spaceId);

    if (entityRows) {
      for (const row of entityRows) {
        entityUuids.set(row.id, row.entity_id);
      }
    }

    // Resolve edge UUIDs to entity_ids for the LLM
    const resolvedEdges = (edges ?? []).map((e: Record<string, string>) => ({
      ...e,
      source_entity_id: entityUuids.get(e.source_entity_id) ?? e.source_entity_id,
      target_entity_id: entityUuids.get(e.target_entity_id) ?? e.target_entity_id,
    }));

    const spaceContext = `Entities:\n${JSON.stringify(entities ?? [], null, 2)}\n\nEdges:\n${JSON.stringify(resolvedEdges, null, 2)}`;

    // Build the prompt
    let prompt: string;
    switch (operation) {
      case "cascade":
        if (!params?.entityId) {
          return NextResponse.json({ error: "entityId required for cascade" }, { status: 400 });
        }
        prompt = REASONING_PROMPTS.cascade(params.entityId);
        break;
      case "path":
        if (!params?.fromId || !params?.toId) {
          return NextResponse.json({ error: "fromId and toId required for path" }, { status: 400 });
        }
        prompt = REASONING_PROMPTS.path(params.fromId, params.toId);
        break;
      default:
        prompt = REASONING_PROMPTS[operation as keyof typeof REASONING_PROMPTS] as string;
    }

    // Call LLM
    const result = await llmJSON({
      system: prompt,
      user: spaceContext,
      maxTokens: 4096,
      temperature: 0.3,
    });

    // Cache in reasoning_results
    await db.from("reasoning_results").insert({
      space_id: spaceId,
      reasoning_type: operation,
      input_params: params ?? {},
      result_data: result,
      result_text: JSON.stringify(result),
    });

    return NextResponse.json({ result });
  } catch (err) {
    console.error("Reasoning error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reasoning failed" },
      { status: 500 }
    );
  }
}
