import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import type { SuggestedObjective } from "@/types/goals";

export const maxDuration = 30;

/**
 * POST /api/goals/generate
 *
 * AI-assisted objective generation from natural language input.
 * Takes a user's description of what they want to achieve + graph context,
 * returns a fully structured SuggestedObjective.
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let userDescription: string;

  try {
    const body = await request.json();
    spaceId = body.spaceId;
    userDescription = body.description;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId || !userDescription?.trim()) {
    return NextResponse.json(
      { error: "spaceId and description required" },
      { status: 400 }
    );
  }

  // Verify ownership
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, name, synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single();

  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Fetch entities for context
  const { data: entities } = await db
    .from("entities")
    .select(
      "entity_id, name, entity_category, importance, is_leverage_point, is_risk_point, is_master_bottleneck, description"
    )
    .eq("space_id", spaceId)
    .order("importance", { ascending: true })
    .limit(30);

  // Fetch edges for causal reasoning
  const { data: edges } = await db
    .from("edges")
    .select("source_entity_id, target_entity_id, relationship_type, strength, polarity")
    .eq("space_id", spaceId)
    .limit(40);

  const entityContext = (entities ?? [])
    .map((e: any) => {
      const tags: string[] = [];
      if (e.is_leverage_point) tags.push("LEVERAGE");
      if (e.is_risk_point) tags.push("RISK");
      if (e.is_master_bottleneck) tags.push("BOTTLENECK");
      return `${e.entity_id} "${e.name}" [${e.entity_category}/${e.importance}]${tags.length ? ` (${tags.join(",")})` : ""}: ${e.description || ""}`;
    })
    .join("\n");

  const edgeContext = (edges ?? [])
    .map(
      (e: any) =>
        `${e.source_entity_id} --[${e.relationship_type}, ${e.polarity}]--> ${e.target_entity_id}`
    )
    .join("\n");

  const system = `You are an objective strategist. The user described what they want to achieve in their own words. Using the knowledge graph below, generate a precise, well-structured objective.

GRAPH ENTITIES:
${entityContext}

GRAPH EDGES:
${edgeContext}

Generate ONE objective that best captures what the user wants. Ground it in the graph — link to specific entities, identify the right metric, and estimate realistic baseline/target values.

The objective must be a JSON object with this schema:
{
  "key": string (kebab-case slug),
  "title": string (concise, action-oriented),
  "objective_type": "maximize" | "minimize" | "maintain" | "explore" | "avoid",
  "description": string (2-3 sentences explaining what success looks like),
  "metric_name": string (specific, measurable thing to track),
  "metric_unit": string | null,
  "baseline_estimate": number | null (current state estimate),
  "target_estimate": number | null (goal state),
  "rationale": string (why this objective matters based on the graph structure),
  "source_entity_id": string | null (most relevant entity_id from the graph),
  "source_type": "leverage_point" | "risk_point" | "cycle" | "synthesis" | "user_defined",
  "confidence": "high" | "moderate" | "low",
  "priority": 1,
  "depth": "surface" | "structural" | "fundamental",
  "convergence_score": number (1-6, how many causal chains converge here)
}

Respond with ONLY the JSON object.`;

  try {
    const result = await llmJSON<SuggestedObjective>({
      system,
      user: userDescription.trim(),
      maxTokens: 2000,
      temperature: 0.3,
      validator: (data) => {
        if (!data || typeof data !== "object" || !("title" in data)) {
          throw new Error("Invalid objective structure");
        }
        return data as SuggestedObjective;
      },
      fallback: null as unknown as SuggestedObjective,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Could not generate objective" },
        { status: 500 }
      );
    }

    return NextResponse.json({ objective: result });
  } catch (err) {
    console.error("[Generate Objective] LLM error:", err);
    return NextResponse.json(
      { error: "Failed to generate objective" },
      { status: 500 }
    );
  }
}
