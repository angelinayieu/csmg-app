import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { getObjectiveDetectionPrompt } from "@/lib/prompts/objective-detection";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";

export const maxDuration = 60;

/**
 * POST /api/goals/[id]/sub-objectives
 *
 * Triggers sub-objective detection for an existing goal.
 * Uses the 4-phase deep reasoning prompt in sub-objective mode
 * (backward chain → forward trace → propellant → depth ranking)
 * to decompose the parent goal into actionable sub-objectives.
 *
 * Returns detected sub-objectives which the client can display
 * for user acceptance.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: goalId } = await params;

  // ── Fetch goal + space context ──
  const { data: goal, error: goalError } = await db
    .from("improvement_goals")
    .select("*, spaces!inner(id, name, synthesis_data)")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single();

  if (goalError || !goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  const spaceId = goal.space_id;
  const rawSynthData = goal.spaces?.synthesis_data;
  if (!rawSynthData) {
    return NextResponse.json(
      { error: "No synthesis data available — run synthesis first" },
      { status: 400 }
    );
  }

  const synthesisData = (
    typeof rawSynthData === "string" ? JSON.parse(rawSynthData) : rawSynthData
  ) as SynthesisData;

  // ── Fetch graph structure for deep reasoning ──
  const [entitiesResult, edgesResult, cyclesResult] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db.from("cycles").select("*").eq("space_id", spaceId),
  ]);

  const allEntities = entitiesResult.data ?? [];
  const allEdges = edgesResult.data ?? [];
  const allCycles = cyclesResult.data ?? [];

  // ── Build ancestor chain for recursive decomposition ──
  const ancestorChain: ImprovementGoal[] = [];
  let walkId = goal.parent_goal_id as string | null;
  while (walkId && ancestorChain.length < 3) {
    const { data: ancestor } = await db
      .from("improvement_goals")
      .select("*")
      .eq("id", walkId)
      .single();
    if (!ancestor) break;
    ancestorChain.unshift(ancestor as ImprovementGoal);
    walkId = (ancestor as ImprovementGoal).parent_goal_id;
  }

  // ── Fetch existing accepted children (siblings for dedup) ──
  const { data: existingChildrenData } = await db
    .from("improvement_goals")
    .select("id, title, status, metric_name, current_value, target_value, baseline_value, parent_goal_id")
    .eq("parent_goal_id", goalId);
  const existingSiblings = (existingChildrenData ?? []) as ImprovementGoal[];

  // ── Fetch user's original input text for situational grounding ──
  const { data: spaceForInput } = await db
    .from("spaces")
    .select("input_text")
    .eq("id", spaceId)
    .single();
  const userInputText = (spaceForInput?.input_text as string) ?? undefined;

  // ── Build parent goal for sub-objective mode ──
  const parentGoal: ImprovementGoal = {
    id: goal.id,
    space_id: goal.space_id,
    user_id: goal.user_id,
    parent_goal_id: goal.parent_goal_id,
    objective_type: goal.objective_type ?? "maximize",
    source: goal.source ?? "manual",
    title: goal.title,
    description: goal.description,
    metric_name: goal.metric_name,
    metric_unit: goal.metric_unit,
    // Sprint W5.7b — metric_entity_id is now a typed field on
    // ImprovementGoal. Defaults to null when not yet anchored to a
    // graph entity.
    metric_entity_id: goal.metric_entity_id ?? null,
    target_value: goal.target_value,
    baseline_value: goal.baseline_value,
    current_value: goal.current_value,
    deadline: goal.deadline,
    status: goal.status,
    created_at: goal.created_at,
    updated_at: goal.updated_at,
  };

  // ── Generate sub-objectives using 4-phase deep reasoning ──
  const prompt = getObjectiveDetectionPrompt(
    synthesisData,
    parentGoal,
    allEntities,
    allEdges,
    allCycles,
    userInputText,
    undefined, // epistemicClassification — not available in this context
    ancestorChain.length > 0 ? ancestorChain : undefined,
    existingSiblings.length > 0 ? existingSiblings : undefined,
  );

  try {
    const result = await llmJSON<SuggestedObjective[]>({
      system: prompt.system,
      user: prompt.user,
      maxTokens: 8000,
      temperature: 0.3,
    });

    const subObjectives = Array.isArray(result)
      ? result.map((obj) => ({
          ...obj,
          parent_goal_id: goalId,
        }))
      : [];

    // ── Store in synthesis_data for persistence ──
    // Merge with existing suggested_objectives (don't overwrite top-level ones)
    const existingObjectives = (synthesisData.suggested_objectives ?? []) as SuggestedObjective[];
    const topLevelObjectives = existingObjectives.filter(
      (o) => !o.parent_goal_id || o.parent_goal_id !== goalId
    );
    const mergedObjectives = [...topLevelObjectives, ...subObjectives];

    // Read fresh to avoid overwriting concurrent changes
    const { data: freshSpace } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();

    const freshSynthData = (
      typeof freshSpace?.synthesis_data === "string"
        ? JSON.parse(freshSpace.synthesis_data)
        : freshSpace?.synthesis_data ?? {}
    ) as Record<string, unknown>;

    await db
      .from("spaces")
      .update({
        synthesis_data: {
          ...freshSynthData,
          suggested_objectives: mergedObjectives,
        },
      })
      .eq("id", spaceId);

    return NextResponse.json({
      sub_objectives: subObjectives,
      total_objectives: mergedObjectives.length,
    });
  } catch (err) {
    console.error("[SubObjectives] LLM error:", err);
    return NextResponse.json(
      { error: "Failed to generate sub-objectives" },
      { status: 500 }
    );
  }
}
