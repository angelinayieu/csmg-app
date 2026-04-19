import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import type { SuggestedObjective } from "@/types/goals";

export const maxDuration = 30;

/**
 * POST /api/goals/reassess
 *
 * Reassesses objectives based on chat discussion with the user.
 * Called from the Objective Review Flow when the user clicks "Reassess."
 * Takes the current objectives + chat history and produces revised proposals.
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let chatHistory: string;
  let currentObjectives: SuggestedObjective[];
  let includedKeys: string[];

  try {
    const body = await request.json();
    spaceId = body.spaceId;
    chatHistory = body.chatHistory ?? "";
    currentObjectives = body.currentObjectives ?? [];
    includedKeys = body.includedKeys ?? [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // Verify ownership
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single();

  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Fetch entities for context
  const { data: entities } = await db
    .from("entities")
    .select("entity_id, name, entity_category, importance, is_leverage_point, is_risk_point, is_master_bottleneck, description")
    .eq("space_id", spaceId)
    .limit(30);

  const entityContext = (entities ?? [])
    .map((e: any) => {
      const tags: string[] = [];
      if (e.is_leverage_point) tags.push("LEVERAGE");
      if (e.is_risk_point) tags.push("RISK");
      if (e.is_master_bottleneck) tags.push("BOTTLENECK");
      return `${e.entity_id} "${e.name}" [${e.entity_category}/${e.importance}]${tags.length ? ` (${tags.join(",")})` : ""}`;
    })
    .join("\n");

  const currentObjSummary = currentObjectives
    .map((o) => `${o.key}: "${o.title}" (${o.objective_type}, ${o.depth ?? "unknown"} depth)${includedKeys.includes(o.key) ? " [INCLUDED]" : " [EXCLUDED]"} — ${o.description}`)
    .join("\n");

  const system = `You are reassessing objectives for a user based on their feedback from a discussion.

CURRENT OBJECTIVES:
${currentObjSummary}

GRAPH ENTITIES:
${entityContext}

DISCUSSION WITH USER:
${chatHistory}

Based on the user's feedback, generate REVISED objectives. Consider:
1. What the user said they want to add, change, or remove
2. Objectives they marked as EXCLUDED may need revision or removal
3. Objectives they marked as INCLUDED should be kept unless user said otherwise
4. Any new objectives the user mentioned or implied

OUTPUT: A JSON array of 3-6 revised objectives with the same schema as the current ones.
Each object: key, title, objective_type ("maximize"|"minimize"|"maintain"|"explore"|"avoid"), description, metric_name, metric_unit (string|null), baseline_estimate (number|null), target_estimate (number|null), rationale, source_entity_id (string|null), source_type, confidence ("high"|"moderate"|"low"), priority (number), depth ("fundamental"|"structural"|"surface"), convergence_score (number), propellant ({entity_id, entity_name, action, why, mechanism} | null).

Respond with ONLY the JSON array.`;

  try {
    const result = await llmJSON<SuggestedObjective[]>({
      system,
      user: "Please reassess the objectives based on the discussion above. Keep what works, fix what doesn't, and add what's missing.",
      maxTokens: 4000,
      temperature: 0.4,
      validator: (data) => {
        if (!Array.isArray(data)) throw new Error("Expected array");
        return data as SuggestedObjective[];
      },
      fallback: [],
    });

    return NextResponse.json({ objectives: result });
  } catch (err) {
    console.error("[Reassess] LLM error:", err);
    return NextResponse.json({ error: "Failed to reassess" }, { status: 500 });
  }
}
