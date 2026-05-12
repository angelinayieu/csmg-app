import { NextResponse } from "next/server";
import { llmGenerate } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { getExecutionBriefPrompt } from "@/lib/prompts/execution-brief";
import { detectExecutionContext } from "@/lib/pipeline/context-detector";
import { KNOWN_PROMPTS_TRUNCATED } from "@/lib/prompts/known-prompts";
// Sprint W4.12 — condition the execution brief on the user-approved
// lab_twin. Without this, the brief is lab-agnostic; with this, the
// LLM produces a brief that respects the chosen experimental
// architecture (design type, subjects, features, cadence, IV/DV).
import { loadAndFormatChosenLab } from "@/lib/pipeline/load-chosen-lab";
import type { Entity, Edge } from "@/types";
import type { ExecutionBrief } from "@/types/execution-brief";
import type { SynthesisData } from "@/types/synthesis";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const {
    spaceId,
    recommendationType,
    recommendationId,
    recommendationTitle,
    recommendationText,
    relatedEntityIds,
  } = body as {
    spaceId: string;
    recommendationType: string;
    recommendationId: string;
    recommendationTitle: string;
    recommendationText: string;
    relatedEntityIds?: string[];
  };

  // ── Validate required fields ──
  if (!spaceId || !recommendationId || !recommendationTitle || !recommendationText) {
    return NextResponse.json(
      { error: "spaceId, recommendationId, recommendationTitle, and recommendationText are required" },
      { status: 400 }
    );
  }

  // ── Verify space ownership ──
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // ── Check cache: return existing brief if already generated ──
    const { data: spaceData } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();

    const synthesisData = (spaceData?.synthesis_data ?? {}) as Record<string, unknown>;
    const existingBriefs = (synthesisData.execution_briefs ?? {}) as Record<string, unknown>;

    if (existingBriefs[recommendationId]) {
      return NextResponse.json({
        brief: existingBriefs[recommendationId] as ExecutionBrief,
        cached: true,
      });
    }

    // ── Fetch entities and edges for the space ──
    const [entRes, edgRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
    ]);

    const entities = (entRes.data ?? []) as Entity[];
    const edges = (edgRes.data ?? []) as Edge[];

    // ── Find related entities ──
    // Priority 1: explicit relatedEntityIds from the request
    // Priority 2: fuzzy match entity names in recommendationText
    let relatedEntities: Entity[] = [];

    if (relatedEntityIds && relatedEntityIds.length > 0) {
      relatedEntities = entities.filter((e) =>
        relatedEntityIds.includes(e.entity_id)
      );
    }

    // Supplement with text-matched entities if we have few explicit matches
    if (relatedEntities.length < 3) {
      const textMatched = entities.filter((e) => {
        // Skip already-included entities
        if (relatedEntities.some((r) => r.entity_id === e.entity_id)) return false;
        // Simple containment check on entity name in recommendation text
        const normName = e.name.toLowerCase();
        const normText = recommendationText.toLowerCase();
        if (normName.length < 3) return false;
        return normText.includes(normName);
      });
      relatedEntities = [...relatedEntities, ...textMatched];
    }

    // Cap to avoid prompt bloat
    relatedEntities = relatedEntities.slice(0, 10);

    // ── Find related edges (connected to related entities) ──
    const relatedEntityIdSet = new Set(relatedEntities.map((e) => e.entity_id));
    const relatedEdges = edges.filter(
      (edge) =>
        relatedEntityIdSet.has(edge.source_entity_id) ||
        relatedEntityIdSet.has(edge.target_entity_id)
    ).slice(0, 15);

    // ── Context detection ──
    const contextDetection = detectExecutionContext({
      recommendationText,
      entities,
      edges,
      synthesisSummary: typeof synthesisData.sequencing_rationale === "string"
        ? synthesisData.sequencing_rationale
        : undefined,
      knownPrompts: KNOWN_PROMPTS_TRUNCATED,
    });

    // ── Build synthesis context (lightweight summary, not the full object) ──
    const sd = synthesisData as Partial<SynthesisData>;
    const synthesisContextParts: string[] = [];

    if (sd.leverage_points && sd.leverage_points.length > 0) {
      const lpSummary = sd.leverage_points
        .slice(0, 5)
        .map((lp) => `- ${lp.entity_name ?? lp.entity_id}: ${lp.summary}`)
        .join("\n");
      synthesisContextParts.push(`LEVERAGE POINTS:\n${lpSummary}`);
    }

    if (sd.risk_points && sd.risk_points.length > 0) {
      const rpSummary = sd.risk_points
        .slice(0, 5)
        .map((rp) => `- ${rp.entity_name ?? rp.entity_id}: ${rp.summary}`)
        .join("\n");
      synthesisContextParts.push(`RISK POINTS:\n${rpSummary}`);
    }

    if (sd.master_bottleneck) {
      synthesisContextParts.push(
        `MASTER BOTTLENECK: ${sd.master_bottleneck.entity_id} — ${sd.master_bottleneck.summary}`
      );
    }

    const synthesisContext = synthesisContextParts.length > 0
      ? synthesisContextParts.join("\n\n")
      : undefined;

    // ── Format entities/edges for the prompt ──
    const promptEntities = relatedEntities.map((e) => ({
      name: e.name,
      entity_id: e.entity_id,
      type: e.entity_type,
      is_leverage: e.is_leverage_point,
      is_risk: e.is_risk_point,
    }));

    const entityNameMap = new Map(entities.map((e) => [e.entity_id, e.name]));
    const promptEdges = relatedEdges.map((e) => ({
      source_name: entityNameMap.get(e.source_entity_id) ?? e.source_entity_id,
      target_name: entityNameMap.get(e.target_entity_id) ?? e.target_entity_id,
      relationship_type: e.relationship_type,
      reasoning: e.conditions ?? e.dynamics ?? undefined,
    }));

    // ── Build prompt ──
    const { system, user: userPrompt } = getExecutionBriefPrompt({
      recommendationTitle,
      recommendationText,
      relatedEntities: promptEntities,
      relatedEdges: promptEdges,
      synthesisContext,
      contextDetection: contextDetection ?? undefined,
      userIntent: recommendationType,
    });

    // Sprint W4.12 — append the chosen-lab context to the system
    // prompt. Returns "" when no lab approved → no-op (brief
    // generates legacy lab-agnostic behavior). When an approved
    // lab_twin exists, the LLM sees the chosen design type +
    // subjects + features + IV/DV and is instructed to respect
    // them. The downstream effect: same recommendation can
    // produce different briefs depending on which lab the user
    // committed to (e.g., RCT-flavored vs naturalistic).
    const labContextBlock = await loadAndFormatChosenLab(
      db,
      spaceId,
      user.id,
    );
    const systemWithLab = labContextBlock
      ? `${system}\n\n${labContextBlock}`
      : system;

    // ── Call LLM ──
    const raw = await llmGenerate({
      system: systemWithLab,
      user: userPrompt,
      model: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 4000,
    });

    // ── Parse JSON response ──
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try extracting from markdown fences or raw JSON boundaries
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch?.[1]) {
        parsed = JSON.parse(fenceMatch[1].trim());
      } else {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          parsed = JSON.parse(raw.slice(start, end + 1));
        } else {
          throw new Error(`Failed to parse execution brief JSON: ${raw.slice(0, 300)}`);
        }
      }
    }

    // ── Assemble the ExecutionBrief ──
    const brief: ExecutionBrief = {
      recommendation_id: recommendationId,
      recommendation_title: (parsed.recommendation_title as string) ?? recommendationTitle,
      generated_at: new Date().toISOString(),
      research_backing: parsed.research_backing as ExecutionBrief["research_backing"] ?? {
        evidence_sources: [],
        causal_chain: "Could not generate detailed backing.",
        confidence: "low" as const,
      },
      alternative_approaches: Array.isArray(parsed.alternative_approaches)
        ? parsed.alternative_approaches as ExecutionBrief["alternative_approaches"]
        : [],
      execution_steps: Array.isArray(parsed.execution_steps)
        ? parsed.execution_steps as ExecutionBrief["execution_steps"]
        : [],
      ...(parsed.context_detection
        ? { context_detection: parsed.context_detection as ExecutionBrief["context_detection"] }
        : {}),
    };

    // ── Cache the brief in synthesis_data.execution_briefs ──
    const updatedBriefs = { ...existingBriefs, [recommendationId]: brief };
    await db
      .from("spaces")
      .update({
        synthesis_data: { ...synthesisData, execution_briefs: updatedBriefs },
        updated_at: new Date().toISOString(),
      })
      .eq("id", spaceId);

    return NextResponse.json({ brief, cached: false });
  } catch (err) {
    console.error("[execution-brief] Failed:", err);

    // ── Fallback: return a minimal honest brief ──
    const fallbackBrief: ExecutionBrief = {
      recommendation_id: recommendationId,
      recommendation_title: recommendationTitle,
      generated_at: new Date().toISOString(),
      research_backing: {
        evidence_sources: [],
        causal_chain: "Could not generate detailed brief. Please try again.",
        confidence: "low",
      },
      alternative_approaches: [],
      execution_steps: [
        {
          order: 1,
          action: "Review the recommendation manually",
          detail: "The automated brief generation encountered an error. Review the recommendation text and related entities directly to plan execution.",
          depends_on: [],
          estimated_effort: "varies",
        },
      ],
    };

    return NextResponse.json({ brief: fallbackBrief, cached: false, error: "Brief generation failed — returning minimal fallback" });
  }
}
