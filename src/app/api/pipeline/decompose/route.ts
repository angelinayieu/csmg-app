import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { llmGenerate, llmJSON } from "@/lib/llm";
import { DECOMPOSITION_SYSTEM_PROMPT } from "@/lib/prompts/decomposition";
import { STRUCTURING_SYSTEM_PROMPT } from "@/lib/prompts/structuring";
import type { StructuredDecomposition } from "@/types/analysis";
import { safeJsonParse } from "@/lib/api-helpers";

export const maxDuration = 60;

const VALID_DIMS = [
  "structural", "functional", "temporal", "causal",
  "correlational", "logical", "epistemic", "comparative", "agentive",
];
const VALID_POLARITIES = ["positive", "negative", "neutral", "conditional"];
const VALID_TAGS = ["stated", "inferred", "predicted"];

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
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError || !body) {
    return NextResponse.json({ error: parseError ?? "Invalid JSON" }, { status: 400 });
  }
  const { text, spaceConfig, siblingContext } = body;

  if (!text) {
    return NextResponse.json({ error: "Text required" }, { status: 400 });
  }

  try {
    // Build prompt with sibling context if available
    let userPrompt = text;
    if (spaceConfig && siblingContext) {
      userPrompt = `You are analyzing ONE specific area of a larger situation. Focus ONLY on this area.

Area: ${spaceConfig.name}
Description: ${spaceConfig.description}
Key concepts: ${(spaceConfig.key_concepts ?? []).join(", ")}

${siblingContext ? `Other areas being analyzed separately (for boundary awareness):\n${siblingContext}\n` : ""}

The input to analyze:
${text}`;
    }

    // Pass 1: Decomposition
    const rawDecomposition = await llmGenerate({
      system: DECOMPOSITION_SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 8192,
      temperature: 0.5,
    });

    // Pass 2: Structure into JSON
    const parsed = await llmJSON<StructuredDecomposition>({
      system: STRUCTURING_SYSTEM_PROMPT,
      user: `Convert this decomposition to JSON:\n\n${rawDecomposition}`,
      maxTokens: 16000,
      temperature: 0.2,
    });

    // Create space
    const prefix = spaceConfig?.prefix ?? text.trim().split(/\s/)[0].slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "C");
    const spaceName = parsed.metadata?.name ?? spaceConfig?.name ?? text.trim().slice(0, 60);

    const { data: spaceData, error: spaceError } = await db
      .from("spaces")
      .insert({
        user_id: user.id,
        name: spaceName,
        description: parsed.metadata?.description ?? spaceConfig?.description ?? null,
        space_prefix: prefix,
        input_text: text,
        raw_decomposition: rawDecomposition,
        synthesis_text: parsed.metadata?.synthesis_text ?? null,
        entity_count: parsed.metadata?.entity_count ?? (parsed.entities?.length ?? 0),
        edge_count: parsed.metadata?.edge_count ?? (parsed.edges?.length ?? 0),
        orphan_count: parsed.metadata?.orphan_count ?? 0,
        cycle_count: parsed.metadata?.cycle_count ?? (parsed.cycles?.length ?? 0),
        maturity: parsed.metadata?.maturity ?? "actionable_now",
      })
      .select("id")
      .single();

    if (spaceError || !spaceData) {
      console.error("Space creation failed:", spaceError);
      return NextResponse.json({ error: "Space creation failed" }, { status: 500 });
    }

    const spaceId = spaceData.id;

    // Insert entities
    const entityIdMap = new Map<string, string>();
    const entityInserts = (parsed.entities ?? []).map((e) => ({
      space_id: spaceId,
      entity_id: (e.entity_id ?? "").trim(),
      name: e.name ?? "Unknown",
      description: e.description ?? null,
      source_tag: e.source_tag ?? "inferred",
      entity_type: e.entity_type ?? "concept",
      entity_category: e.entity_category ?? "abstract",
      layer: e.layer ?? null,
      importance: e.importance ?? "moderate",
      confidence: e.confidence ?? 0.8,
      is_leverage_point: e.is_leverage_point ?? false,
      is_risk_point: e.is_risk_point ?? false,
      is_master_bottleneck: e.is_master_bottleneck ?? false,
      blast_radius: e.blast_radius ?? 0,
      centrality_rank: e.centrality_rank ?? null,
      is_shared_variable: e.is_shared_variable ?? false,
      is_decomposable: e.is_decomposable ?? false,
    }));

    if (entityInserts.length > 0) {
      // Try batch insert first
      const insertResult = await db
        .from("entities")
        .insert(entityInserts)
        .select("id, entity_id");

      if (insertResult.error) {
        console.warn("[Pipeline/Decompose] Batch entity insert failed, trying individually:", insertResult.error.message);
        for (const ent of entityInserts) {
          const { data, error } = await db
            .from("entities")
            .insert(ent)
            .select("id, entity_id")
            .single();
          if (data && !error) {
            entityIdMap.set(data.entity_id, data.id);
          }
        }
      } else if (insertResult.data) {
        for (const entity of insertResult.data as Array<{ id: string; entity_id: string }>) {
          entityIdMap.set(entity.entity_id, entity.id);
        }
      }
    }


    // Insert edges individually
    let edgesInserted = 0;
    for (const e of parsed.edges ?? []) {
      const srcId = (e.source_entity_id ?? "").trim();
      const tgtId = (e.target_entity_id ?? "").trim();
      const srcUuid = entityIdMap.get(srcId);
      const tgtUuid = entityIdMap.get(tgtId);
      if (!srcUuid || !tgtUuid) continue;

      const { error } = await db.from("edges").insert({
        space_id: spaceId,
        source_entity_id: srcUuid,
        target_entity_id: tgtUuid,
        relationship_type: e.relationship_type ?? "relates-to",
        dimension: VALID_DIMS.includes(e.dimension) ? e.dimension : "functional",
        source_tag: VALID_TAGS.includes(e.source_tag) ? e.source_tag : "inferred",
        strength: Math.max(0, Math.min(1, e.strength ?? 0.5)),
        polarity: VALID_POLARITIES.includes(e.polarity) ? e.polarity : "positive",
        confidence: Math.max(0, Math.min(1, e.confidence ?? 0.8)),
        conditions: e.conditions ?? null,
        is_tradeoff: e.is_tradeoff ?? false,
        is_part_of_cycle: e.is_part_of_cycle ?? false,
        cycle_id: e.cycle_id ?? null,
        is_low_confidence: (e.confidence ?? 0.8) < 0.4,
      });
      if (!error) edgesInserted++;
    }

    // Insert cycles
    let cyclesInserted = 0;
    for (const c of parsed.cycles ?? []) {
      const { error } = await db.from("cycles").insert({
        space_id: spaceId,
        cycle_id: c.cycle_id,
        name: c.name ?? null,
        classification: ["reinforcing_positive", "reinforcing_negative", "balancing"].includes(c.classification)
          ? c.classification
          : "reinforcing_positive",
        entity_ids: c.entity_ids,
        intervention_point_entity_id: c.intervention_point
          ? entityIdMap.get(c.intervention_point) ?? null
          : null,
        intervention_description: c.intervention_description ?? null,
        description: c.description ?? null,
      });
      if (!error) cyclesInserted++;
    }

    // Update space counts with actual inserted counts
    await db.from("spaces").update({
      entity_count: entityIdMap.size,
      edge_count: edgesInserted,
      cycle_count: cyclesInserted,
    }).eq("id", spaceId);

    // Log changelog
    await db.from("space_changelog").insert({
      space_id: spaceId,
      version: 1,
      change_type: "initial_analysis",
      summary: `Analysis: ${entityIdMap.size} entities, ${edgesInserted} edges, ${cyclesInserted} cycles`,
      details: { entity_count: entityIdMap.size, edge_count: edgesInserted, cycle_count: cyclesInserted },
    }).then(() => {}).catch(() => {}); // Non-critical


    return NextResponse.json({
      spaceId,
      entityCount: entityIdMap.size,
      edgeCount: edgesInserted,
      cycleCount: cyclesInserted,
      structured: parsed, // Pass through for downstream agents
    });
  } catch (err) {
    console.error("Decompose error:", err);
    return NextResponse.json({ error: "Decomposition failed" }, { status: 500 });
  }
}
