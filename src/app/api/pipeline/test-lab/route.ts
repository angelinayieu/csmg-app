import { NextResponse } from "next/server";
import { llmGenerate } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  getPromptComparisonVariantPrompt,
  getPromptSimulationPrompt,
  getStrategyComparisonPrompt,
  getScenarioSimulationPrompt,
} from "@/lib/prompts/test-lab";
import { extractSampleData } from "@/lib/pipeline/sample-extractor";
import { KNOWN_PROMPTS } from "@/lib/prompts/known-prompts";
import type { Entity, Edge } from "@/types";
import type { TestLabResult, TestVariant } from "@/types/execution-brief";
import type { ExecutionBrief } from "@/types/execution-brief";
import type { SynthesisData } from "@/types/synthesis";

export const maxDuration = 90;

// ── JSON parsing helper (same pattern as execution-brief route) ──

function parseJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) {
      return JSON.parse(fenceMatch[1].trim());
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error(`Failed to parse JSON: ${raw.slice(0, 300)}`);
  }
}

// ── Format entity/edge descriptions for prompts ──

function describeEntity(e: Entity): string {
  const tags: string[] = [];
  if (e.is_leverage_point) tags.push("leverage");
  if (e.is_risk_point) tags.push("risk");
  if (e.importance) tags.push(e.importance);
  const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
  return `${e.name} (${e.entity_type})${tagStr}`;
}

function describeEdge(edge: Edge, nameMap: Map<string, string>): string {
  const src = nameMap.get(edge.source_entity_id) ?? edge.source_entity_id;
  const tgt = nameMap.get(edge.target_entity_id) ?? edge.target_entity_id;
  return `${src} -> ${tgt} (${edge.relationship_type})`;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const {
    action = "generate",
    spaceId,
    recommendationId,
    recommendationTitle,
    recommendationText,
    testType,
    relatedEntityIds,
    maxVariants: rawMaxVariants,
    preferredIndex,
  } = body as {
    action?: "generate" | "set_preferred";
    spaceId: string;
    recommendationId: string;
    recommendationTitle?: string;
    recommendationText?: string;
    testType?: "prompt_comparison" | "strategy_comparison" | "scenario_simulation";
    relatedEntityIds?: string[];
    maxVariants?: number;
    preferredIndex?: number | null;
  };

  // ── Validate common required fields ──
  if (!spaceId || !recommendationId) {
    return NextResponse.json(
      { error: "spaceId and recommendationId are required" },
      { status: 400 }
    );
  }

  // ── Verify space ownership ──
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // ── Route by action ──

  if (action === "set_preferred") {
    return handleSetPreferred(db, spaceId, recommendationId, preferredIndex ?? null);
  }

  // action === "generate"
  if (!recommendationTitle || !recommendationText || !testType) {
    return NextResponse.json(
      { error: "recommendationTitle, recommendationText, and testType are required for generate" },
      { status: 400 }
    );
  }

  // Cap maxVariants server-side
  const maxVariants = Math.min(Math.max(rawMaxVariants ?? 4, 1), 5);

  return handleGenerate(
    db,
    spaceId,
    recommendationId,
    recommendationTitle,
    recommendationText,
    testType,
    relatedEntityIds ?? [],
    maxVariants
  );
}

// ── set_preferred handler ──

async function handleSetPreferred(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  recommendationId: string,
  preferredIndex: number | null
) {
  try {
    const { data: spaceData } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();

    const synthesisData = (spaceData?.synthesis_data ?? {}) as Record<string, unknown>;
    const existingBriefs = (synthesisData.execution_briefs ?? {}) as Record<string, ExecutionBrief>;
    const brief = existingBriefs[recommendationId];

    if (!brief?.test_lab) {
      return NextResponse.json(
        { error: "No test lab result found for this recommendation" },
        { status: 404 }
      );
    }

    brief.test_lab.preferred_variant_index = preferredIndex;

    const updatedBriefs = { ...existingBriefs, [recommendationId]: brief };
    await db
      .from("spaces")
      .update({
        synthesis_data: { ...synthesisData, execution_briefs: updatedBriefs },
        updated_at: new Date().toISOString(),
      })
      .eq("id", spaceId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[test-lab] set_preferred failed:", err);
    return NextResponse.json(
      { error: "Failed to set preferred variant" },
      { status: 500 }
    );
  }
}

// ── generate handler ──

async function handleGenerate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  recommendationId: string,
  recommendationTitle: string,
  recommendationText: string,
  testType: "prompt_comparison" | "strategy_comparison" | "scenario_simulation",
  relatedEntityIds: string[],
  maxVariants: number
) {
  try {
    // ── Check cache ──
    const { data: spaceData } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();

    const synthesisData = (spaceData?.synthesis_data ?? {}) as Record<string, unknown>;
    const existingBriefs = (synthesisData.execution_briefs ?? {}) as Record<string, ExecutionBrief>;
    const existingBrief = existingBriefs[recommendationId];

    if (existingBrief?.test_lab) {
      // ── Rate limit: 30-second cooldown ──
      const generatedAt = existingBrief.test_lab.generated_at;
      if (generatedAt) {
        const elapsed = Date.now() - new Date(generatedAt).getTime();
        if (elapsed < 30_000) {
          return NextResponse.json(
            { error: "Rate limited — please wait before regenerating", retryAfterMs: 30_000 - elapsed },
            { status: 429 }
          );
        }
      }

      // If cache exists but not rate-limited, return cached
      // (The 30s check above is specifically for rapid re-generation attempts)
      // If the caller wants a fresh result, they should delete the cached one first.
      // For now, always return cached if it exists and isn't within cooldown.
      return NextResponse.json({
        testLab: existingBrief.test_lab as TestLabResult,
        cached: true,
      });
    }

    // ── Fetch entities and edges ──
    const [entRes, edgRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
    ]);

    const entities = (entRes.data ?? []) as Entity[];
    const edges = (edgRes.data ?? []) as Edge[];
    const entityNameMap = new Map(entities.map((e: Entity) => [e.entity_id, e.name]));

    // ── Branch by testType ──

    let result: TestLabResult;

    switch (testType) {
      case "prompt_comparison":
        result = await runPromptComparison(
          recommendationText,
          entities,
          edges,
          entityNameMap,
          relatedEntityIds,
          maxVariants
        );
        break;

      case "strategy_comparison":
        result = await runStrategyComparison(
          recommendationText,
          entities,
          edges,
          entityNameMap,
          synthesisData as Partial<SynthesisData>,
          maxVariants
        );
        break;

      case "scenario_simulation":
        result = await runScenarioSimulation(
          recommendationText,
          entities,
          edges,
          entityNameMap,
          synthesisData as Partial<SynthesisData>,
          maxVariants
        );
        break;
    }

    // ── Set generated_at ──
    result.generated_at = new Date().toISOString();

    // ── Cache: store in synthesis_data.execution_briefs[recommendationId].test_lab ──
    const briefToUpdate: ExecutionBrief = existingBrief ?? {
      recommendation_id: recommendationId,
      recommendation_title: recommendationTitle,
      generated_at: new Date().toISOString(),
      research_backing: { evidence_sources: [], causal_chain: "", confidence: "low" as const },
      alternative_approaches: [],
      execution_steps: [],
    };
    briefToUpdate.test_lab = result;

    const updatedBriefs = { ...existingBriefs, [recommendationId]: briefToUpdate };
    await db
      .from("spaces")
      .update({
        synthesis_data: { ...synthesisData, execution_briefs: updatedBriefs },
        updated_at: new Date().toISOString(),
      })
      .eq("id", spaceId);

    return NextResponse.json({ testLab: result, cached: false });
  } catch (err) {
    console.error("[test-lab] generate failed:", err);
    return NextResponse.json(
      { error: "Test lab generation failed", detail: sanitizeErrorMessage(err) },
      { status: 500 }
    );
  }
}

// ── Prompt Comparison ──

async function runPromptComparison(
  recommendationText: string,
  entities: Entity[],
  edges: Edge[],
  entityNameMap: Map<string, string>,
  relatedEntityIds: string[],
  maxVariants: number
): Promise<TestLabResult> {
  // a. Identify target prompt from recommendation text
  const recTextLower = recommendationText.toLowerCase();
  let currentPromptExcerpt = "";

  for (const [key, prompt] of Object.entries(KNOWN_PROMPTS)) {
    if (recTextLower.includes(key.toLowerCase().replace(/_/g, " ")) || recTextLower.includes(key.toLowerCase())) {
      currentPromptExcerpt = prompt.slice(0, 2000);
      break;
    }
  }

  // Fallback: if no prompt matched, use a generic note
  if (!currentPromptExcerpt) {
    currentPromptExcerpt = "(No specific pipeline prompt identified — generate variants based on the recommendation text alone)";
  }

  // b. Extract sample data
  const { sampleEntities, sampleEdges } = extractSampleData({
    entities,
    edges,
    relatedEntityIds,
  });

  // c. Format descriptions
  const sampleEntityDescriptions = sampleEntities.map(describeEntity);
  const sampleEdgeDescriptions = sampleEdges.map((e) => describeEdge(e, entityNameMap));

  // d. Call variant generation
  const variantPrompt = getPromptComparisonVariantPrompt({
    recommendationText,
    currentPromptExcerpt,
    sampleEntityDescriptions,
    sampleEdgeDescriptions,
    maxVariants,
  });

  const variantRaw = await llmGenerate({
    system: variantPrompt.system,
    user: variantPrompt.user,
    model: "gpt-4o-mini",
    temperature: 0.4,
    maxTokens: 3000,
  });

  const variantParsed = parseJSON(variantRaw);
  const rawVariants = Array.isArray(variantParsed.variants) ? variantParsed.variants : [];

  // e. For each variant, run simulation in parallel
  const simulationPromises = rawVariants.map(
    (variant: Record<string, unknown>) => {
      const simPrompt = getPromptSimulationPrompt({
        variantModifiedSection: String(variant.modified_section ?? ""),
        sampleEntityDescriptions,
        sampleEdgeDescriptions,
        baselinePromptContext: currentPromptExcerpt.slice(0, 1000),
      });

      return llmGenerate({
        system: simPrompt.system,
        user: simPrompt.user,
        model: "gpt-4o-mini",
        temperature: 0.4,
        maxTokens: 1500,
      });
    }
  );

  const simulationResults = await Promise.allSettled(simulationPromises);

  // f. Assemble TestLabResult: merge variant metadata with simulation outputs
  const variants: TestVariant[] = rawVariants.map(
    (variant: Record<string, unknown>, i: number) => {
      let sampleOutput = "Simulation unavailable — see description for expected behavior";

      const simResult = simulationResults[i];
      if (simResult && simResult.status === "fulfilled") {
        try {
          const simParsed = parseJSON(simResult.value);
          sampleOutput = String(simParsed.simulated_output ?? sampleOutput);
        } catch {
          // Keep fallback
        }
      }

      const tv: TestVariant = {
        label: String(variant.label ?? `Variant ${i + 1}`),
        description: String(variant.description ?? ""),
        sample_output: sampleOutput,
        pros: Array.isArray(variant.pros) ? (variant.pros as string[]) : [],
        cons: Array.isArray(variant.cons) ? (variant.cons as string[]) : [],
        estimated_improvement: String(variant.estimated_improvement ?? "Unknown"),
        prompt_diff: String(variant.modified_section ?? ""),
      };

      return tv;
    }
  );

  return {
    test_type: "prompt_comparison",
    variants,
    generated_at: "",
  };
}

// ── Strategy Comparison ──

async function runStrategyComparison(
  recommendationText: string,
  entities: Entity[],
  edges: Edge[],
  entityNameMap: Map<string, string>,
  sd: Partial<SynthesisData>,
  maxVariants: number
): Promise<TestLabResult> {
  // a. Build context
  const entityDescriptions = entities.slice(0, 15).map(describeEntity);
  const edgeDescriptions = edges.slice(0, 20).map((e) => describeEdge(e, entityNameMap));
  const synthesisContext = buildSynthesisContext(sd);

  // b. Single LLM call
  const prompt = getStrategyComparisonPrompt({
    recommendationText,
    entityDescriptions,
    edgeDescriptions,
    synthesisContext,
    maxVariants,
  });

  const raw = await llmGenerate({
    system: prompt.system,
    user: prompt.user,
    model: "gpt-4o-mini",
    temperature: 0.3,
    maxTokens: 3000,
  });

  // c. Parse into TestLabResult
  const parsed = parseJSON(raw);
  const rawVariants = Array.isArray(parsed.variants) ? parsed.variants : [];

  const variants: TestVariant[] = rawVariants.map(
    (v: Record<string, unknown>, i: number) => ({
      label: String(v.label ?? `Strategy ${i + 1}`),
      description: String(v.description ?? ""),
      sample_output: String(v.sample_output ?? ""),
      pros: Array.isArray(v.pros) ? (v.pros as string[]) : [],
      cons: Array.isArray(v.cons) ? (v.cons as string[]) : [],
      estimated_improvement: String(v.estimated_improvement ?? "Unknown"),
      risk_assessment: v.risk_assessment ? String(v.risk_assessment) : undefined,
      dependencies: Array.isArray(v.dependencies) ? (v.dependencies as string[]) : undefined,
      timeline: v.timeline ? String(v.timeline) : undefined,
    })
  );

  return {
    test_type: "strategy_comparison",
    variants,
    generated_at: "",
  };
}

// ── Scenario Simulation ──

async function runScenarioSimulation(
  recommendationText: string,
  entities: Entity[],
  edges: Edge[],
  entityNameMap: Map<string, string>,
  sd: Partial<SynthesisData>,
  maxVariants: number
): Promise<TestLabResult> {
  // a. Build context (same as strategy_comparison)
  const entityDescriptions = entities.slice(0, 15).map(describeEntity);
  const edgeDescriptions = edges.slice(0, 20).map((e) => describeEdge(e, entityNameMap));
  const synthesisContext = buildSynthesisContext(sd);

  // b. Single LLM call
  const prompt = getScenarioSimulationPrompt({
    recommendationText,
    entityDescriptions,
    edgeDescriptions,
    synthesisContext,
    maxVariants,
  });

  const raw = await llmGenerate({
    system: prompt.system,
    user: prompt.user,
    model: "gpt-4o-mini",
    temperature: 0.3,
    maxTokens: 3000,
  });

  // c. Parse into TestLabResult
  const parsed = parseJSON(raw);
  const rawVariants = Array.isArray(parsed.variants) ? parsed.variants : [];

  const variants: TestVariant[] = rawVariants.map(
    (v: Record<string, unknown>, i: number) => ({
      label: String(v.label ?? `Scenario ${i + 1}`),
      description: String(v.description ?? ""),
      sample_output: String(v.sample_output ?? ""),
      pros: Array.isArray(v.pros) ? (v.pros as string[]) : [],
      cons: Array.isArray(v.cons) ? (v.cons as string[]) : [],
      estimated_improvement: String(v.estimated_improvement ?? "Unknown"),
      risk_assessment: v.risk_assessment ? String(v.risk_assessment) : undefined,
      dependencies: Array.isArray(v.dependencies) ? (v.dependencies as string[]) : undefined,
      timeline: v.timeline ? String(v.timeline) : undefined,
    })
  );

  return {
    test_type: "scenario_simulation",
    variants,
    generated_at: "",
  };
}

// ── Shared helpers ──

function buildSynthesisContext(sd: Partial<SynthesisData>): string {
  const parts: string[] = [];

  if (sd.leverage_points && sd.leverage_points.length > 0) {
    const lpSummary = sd.leverage_points
      .slice(0, 5)
      .map((lp) => `- ${lp.entity_name ?? lp.entity_id}: ${lp.summary}`)
      .join("\n");
    parts.push(`LEVERAGE POINTS:\n${lpSummary}`);
  }

  if (sd.risk_points && sd.risk_points.length > 0) {
    const rpSummary = sd.risk_points
      .slice(0, 5)
      .map((rp) => `- ${rp.entity_name ?? rp.entity_id}: ${rp.summary}`)
      .join("\n");
    parts.push(`RISK POINTS:\n${rpSummary}`);
  }

  if (sd.master_bottleneck) {
    parts.push(
      `MASTER BOTTLENECK: ${sd.master_bottleneck.entity_id} — ${sd.master_bottleneck.summary}`
    );
  }

  if (sd.sequencing_rationale) {
    parts.push(`SEQUENCING RATIONALE: ${sd.sequencing_rationale}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "No synthesis context available.";
}
