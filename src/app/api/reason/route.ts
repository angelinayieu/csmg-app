import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { REASONING_PROMPTS } from "@/lib/prompts/reasoning";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { appendSignalToAppsByEntities } from "@/lib/apps/staleness-triggers";

export const maxDuration = 90;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
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

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const validOps = ["centrality", "cycles", "cascade", "link_prediction", "path", "comprehensive"];
  if (!validOps.includes(operation)) {
    return NextResponse.json(
      { error: `Invalid operation. Must be one of: ${validOps.join(", ")}` },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { beginRouteAgent } = await import("@/lib/agents/instrument-route");
  const agent = await beginRouteAgent(db, {
    spaceId,
    userId: user.id,
    kind: "reasoner",
    triggerEvent: "reason.requested",
    triggerData: { operation },
  });

  try {
    // Fetch space data
    const { data: entities } = await db
      .from("entities")
      .select("entity_id, name, entity_type, entity_category, layer, importance, confidence, is_leverage_point, is_risk_point, blast_radius, centrality_rank")
      .eq("space_id", spaceId);

    const { data: edges } = await db
      .from("edges")
      .select("source_entity_id, target_entity_id, relationship_type, dimension, strength, polarity, confidence, dynamics, utility, conditions, is_part_of_cycle")
      .eq("space_id", spaceId);

    // Fetch cycles for richer reasoning context
    const { data: cycles } = await db
      .from("cycles")
      .select("name, classification, entity_ids, intervention_point, description, growth_type, cycle_time, estimated_multiplier")
      .eq("space_id", spaceId);

    // Fetch synthesis summary for context (leverage/risk/bottleneck)
    const { data: spaceRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();

    const synthData = spaceRow?.synthesis_data as Record<string, unknown> | null;
    const synthSummary = synthData ? {
      master_bottleneck: (synthData.master_bottleneck as Record<string, unknown>)?.entity_id ?? null,
      leverage_points: Array.isArray(synthData.leverage_points)
        ? (synthData.leverage_points as Array<Record<string, unknown>>).map((lp) => lp.entity_id).slice(0, 5)
        : [],
      risk_points: Array.isArray(synthData.risk_points)
        ? (synthData.risk_points as Array<Record<string, unknown>>).map((rp) => rp.entity_id).slice(0, 5)
        : [],
    } : null;

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

    let spaceContext = `Entities:\n${JSON.stringify(entities ?? [], null, 2)}\n\nEdges:\n${JSON.stringify(resolvedEdges, null, 2)}`;

    if (cycles?.length) {
      spaceContext += `\n\nExisting Cycles:\n${JSON.stringify(cycles, null, 2)}`;
    }

    if (synthSummary) {
      spaceContext += `\n\nSynthesis Context:\n- Master bottleneck: ${synthSummary.master_bottleneck ?? "none identified"}\n- Leverage points: ${synthSummary.leverage_points.join(", ") || "none"}\n- Risk points: ${synthSummary.risk_points.join(", ") || "none"}`;
    }

    // Build the prompt
    let prompt: string;
    switch (operation) {
      case "cascade": {
        let entityId = params?.entityId;
        // If no entityId, auto-select the highest-centrality or first leverage point
        if (!entityId && entities && entities.length > 0) {
          const sorted = [...entities].sort((a: any, b: any) => (a.centrality_rank ?? 999) - (b.centrality_rank ?? 999));
          const target = sorted.find((e: any) => e.is_leverage_point) ?? sorted[0];
          entityId = target?.entity_id;
        }
        if (!entityId) {
          return NextResponse.json({ error: "No entities found for cascade analysis" }, { status: 400 });
        }
        prompt = REASONING_PROMPTS.cascade(entityId);
        break;
      }
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
      maxTokens: 8192,
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

    // ── Sprint 3: enrichment signal to relevant apps ──
    // When a reasoning run anchors on specific entity codes, surface an
    // "insight" signal on any app whose dominant factors overlap. This
    // does NOT mark apps stale — reasoning adds info, it doesn't invalidate.
    try {
      const anchorCodes = new Set<string>();
      if (params?.entityId) anchorCodes.add(params.entityId);
      if (params?.fromId) anchorCodes.add(params.fromId);
      if (params?.toId) anchorCodes.add(params.toId);

      if (anchorCodes.size > 0) {
        // Resolve codes → UUIDs using entityUuids map (UUID→code) we built above.
        const codeToUuid = new Map<string, string>();
        for (const [uuid, code] of entityUuids.entries()) codeToUuid.set(code, uuid);
        const anchorUuids = Array.from(anchorCodes)
          .map((c) => codeToUuid.get(c))
          .filter((v): v is string => typeof v === "string");

        if (anchorUuids.length > 0) {
          await appendSignalToAppsByEntities(
            db,
            spaceId,
            anchorUuids,
            {
              kind: "insight",
              message: `Reasoning (${operation}) produced a new insight on ${Array.from(anchorCodes).join(", ")}`,
              at: new Date().toISOString(),
            },
            `agent:reasoner`
          );
        }
      }
    } catch (signalErr) {
      console.warn("[reason] app signal fan-out failed (non-critical):", signalErr);
    }

    await agent.complete({
      findingsCount: 1,
      artifacts: [`reasoning_${operation}`],
    });
    return NextResponse.json({ result });
  } catch (err) {
    console.error("Reasoning error:", err);
    await agent.fail(err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reasoning failed" },
      { status: 500 }
    );
  }
}
