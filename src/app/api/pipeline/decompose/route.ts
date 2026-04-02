import { NextResponse } from "next/server";
import { llmGenerate, llmJSON } from "@/lib/llm";
import { getDecompositionPrompt, getStructuringPrompt } from "@/lib/prompts/tier-prompts";
import { safeAuth } from "@/lib/api-helpers";
import type { StructuredDecomposition } from "@/types/analysis";
import {
  sanitizeEntity,
  sanitizeEdge,
  sanitizeCycle,
  deduplicateEntities,
  resilientInsert,
  filterLowConfidenceEdges,
  MATURITY_LEVELS,
} from "@/lib/sanitize";

export const maxDuration = 120; // Comprehensive tier: 2 LLM passes, up to 50 entities

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let text: string;
  let spaceConfig: { name?: string; prefix?: string; description?: string; key_concepts?: string[] } | undefined;
  let siblingContext: string | undefined;
  let reasoningDepth: "quick" | "standard" | "deep" = "standard";

  try {
    const body = await request.json();
    text = body.text;
    spaceConfig = body.spaceConfig;
    siblingContext = body.siblingContext;
    if (body.reasoningDepth === "quick" || body.reasoningDepth === "standard" || body.reasoningDepth === "deep") {
      reasoningDepth = body.reasoningDepth;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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

    // Pass 1: Decomposition (free-form reasoning)
    const rawDecomposition = await llmGenerate({
      system: getDecompositionPrompt(reasoningDepth),
      user: userPrompt,
      maxTokens: 8192,
      temperature: 0.5,
    });

    // Pass 2: Structure into JSON (with JSON mode enforcement)
    const parsed = await llmJSON<StructuredDecomposition>({
      system: getStructuringPrompt(reasoningDepth),
      user: `Convert this decomposition to JSON:\n\n${rawDecomposition}`,
      maxTokens: 16000,
      temperature: 0.2,
    });

    // Filter low-confidence edges + deduplicate entities
    const confFilteredEdges = filterLowConfidenceEdges(parsed.edges ?? []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { entities: dedupedEntities, edges: dedupedEdges } = deduplicateEntities(
      (parsed.entities ?? []) as any,
      confFilteredEdges as any
    );

    // Create space
    const prefix = spaceConfig?.prefix ?? text.trim().split(/\s/)[0].slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "C");
    const spaceName = parsed.metadata?.name ?? spaceConfig?.name ?? text.trim().slice(0, 60);
    const maturity = MATURITY_LEVELS.includes(parsed.metadata?.maturity as typeof MATURITY_LEVELS[number])
      ? parsed.metadata?.maturity
      : "actionable_now";

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
        entity_count: dedupedEntities.length,
        edge_count: dedupedEdges.length,
        orphan_count: parsed.metadata?.orphan_count ?? 0,
        cycle_count: parsed.cycles?.length ?? 0,
        maturity,
      })
      .select("id")
      .single();

    if (spaceError || !spaceData) {
      console.error("[Decompose] Space creation failed:", spaceError);
      return NextResponse.json({ error: "Space creation failed" }, { status: 500 });
    }

    const spaceId = spaceData.id;

    // ── Insert entities (sanitized + resilient) ──
    const entityIdMap = new Map<string, string>();
    const sanitizedEntities = dedupedEntities.map((e) => sanitizeEntity(e, spaceId));

    if (sanitizedEntities.length > 0) {
      const { data: entityData } = await resilientInsert(db, "entities", sanitizedEntities, "id, entity_id");
      for (const row of entityData) {
        entityIdMap.set(row.entity_id, row.id);
      }
    }

    // ── Insert edges (sanitized, skip invalid refs) ──
    const sanitizedEdges = dedupedEdges
      .map((e) => sanitizeEdge(e, spaceId, entityIdMap))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let edgesInserted = 0;
    if (sanitizedEdges.length > 0) {
      const { inserted } = await resilientInsert(db, "edges", sanitizedEdges, "id");
      edgesInserted = inserted;
    }

    // ── Insert cycles (sanitized) ──
    const sanitizedCycles = (parsed.cycles ?? [])
      .map((c) => sanitizeCycle(c, spaceId, entityIdMap))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    let cyclesInserted = 0;
    if (sanitizedCycles.length > 0) {
      const { inserted } = await resilientInsert(db, "cycles", sanitizedCycles, "id");
      cyclesInserted = inserted;
    }

    // ── Insert propositions (non-critical) ──
    const propositions = (parsed.propositions ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => p.statement && typeof p.statement === "string"
    );
    if (propositions.length > 0) {
      const validPropTypes = ["certain", "probable", "possible", "speculative", "irreducible"];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const propRows = propositions.map((p: any) => ({
        space_id: spaceId,
        proposition_id: (typeof p.proposition_id === "string" && p.proposition_id)
          ? p.proposition_id
          : `P${Math.random().toString(36).slice(2, 6)}`,
        statement: p.statement,
        proposition_type: validPropTypes.includes(p.proposition_type) ? p.proposition_type : "probable",
        confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.7,
        depends_on: Array.isArray(p.depends_on) ? p.depends_on : null,
        entity_ids: Array.isArray(p.entity_ids) ? p.entity_ids : null,
      }));
      await resilientInsert(db, "propositions", propRows, "id").catch(() => {});
    }

    // ── Store rich structuring metadata on space ──
    // Leverage points, risk points, open questions, etc. go into synthesis_data
    // so the synthesis step can use them even if it runs later
    const structuringMeta: Record<string, unknown> = {};
    if (parsed.leverage_points?.length) structuringMeta.leverage_points = parsed.leverage_points;
    if (parsed.risk_points?.length) structuringMeta.risk_points = parsed.risk_points;
    if (parsed.master_bottleneck) structuringMeta.master_bottleneck = parsed.master_bottleneck;
    if (parsed.open_questions?.length) structuringMeta.open_questions = parsed.open_questions;
    if (parsed.novel_connections?.length) structuringMeta.novel_connections = parsed.novel_connections;
    if (parsed.contradictions?.length) structuringMeta.contradictions = parsed.contradictions;
    if (parsed.scenarios?.length) structuringMeta.scenarios = parsed.scenarios;
    if (parsed.action_items?.length) structuringMeta.action_items = parsed.action_items;
    if (parsed.shared_variables?.length) structuringMeta.shared_variables = parsed.shared_variables;

    // Update space counts with actual inserted counts
    await db.from("spaces").update({
      entity_count: entityIdMap.size,
      edge_count: edgesInserted,
      cycle_count: cyclesInserted,
      ...(Object.keys(structuringMeta).length > 0 ? { synthesis_data: structuringMeta } : {}),
    }).eq("id", spaceId);

    // Log changelog (non-critical)
    await db.from("space_changelog").insert({
      space_id: spaceId,
      version: 1,
      change_type: "initial_analysis",
      summary: `Analysis: ${entityIdMap.size} entities, ${edgesInserted} edges, ${cyclesInserted} cycles`,
      details: { entity_count: entityIdMap.size, edge_count: edgesInserted, cycle_count: cyclesInserted },
    }).then(() => {}, () => {});

    return NextResponse.json({
      spaceId,
      entityCount: entityIdMap.size,
      edgeCount: edgesInserted,
      cycleCount: cyclesInserted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Decompose] Error:", msg);
    return NextResponse.json({ error: `Decomposition failed: ${msg}` }, { status: 500 });
  }
}
