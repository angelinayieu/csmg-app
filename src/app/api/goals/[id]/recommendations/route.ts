import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { getGoalRecommendationsPrompt } from "@/lib/prompts/goal-recommendations";
import type { ObjectiveBenchmark } from "@/types/goals";

export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: goalId } = await params;

  // Verify goal ownership
  const { data: goal } = await db
    .from("improvement_goals")
    .select("id")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single();

  if (!goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("goal_recommendations")
    .select("*")
    .eq("goal_id", goalId)
    .order("rank", { ascending: true });

  if (error) {
    console.error("[GoalRecs] List error:", error);
    return NextResponse.json({ error: "Failed to fetch recommendations" }, { status: 500 });
  }

  return NextResponse.json({ recommendations: data ?? [] });
}

// POST: Regenerate recommendations from synthesis data
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: goalId } = await params;

  // Fetch goal with space context
  const { data: goal } = await db
    .from("improvement_goals")
    .select("*, spaces!inner(id, name, synthesis_data, input_text)")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single();

  if (!goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  const synthesisData = goal.spaces?.synthesis_data;
  if (!synthesisData) {
    return NextResponse.json(
      { error: "No synthesis data available. Run analysis first." },
      { status: 400 }
    );
  }

  // Optionally accept spaceIds from body to include multi-space synthesis
  let extraSynthesis: Record<string, unknown>[] = [];
  try {
    const { data: body } = await safeJsonParse(request);
    if (body?.spaceIds?.length) {
      const { data: spaces } = await db
        .from("spaces")
        .select("name, synthesis_data")
        .in("id", body.spaceIds)
        .eq("user_id", user.id);
      extraSynthesis = (spaces ?? [])
        .filter((s: { synthesis_data: unknown }) => s.synthesis_data)
        .map((s: { name: string; synthesis_data: unknown }) => ({
          space_name: s.name,
          ...((s.synthesis_data as Record<string, unknown>) ?? {}),
        }));
    }
  } catch {
    // Body is optional for POST
  }

  // Fetch benchmark for this goal
  let benchmark: ObjectiveBenchmark | undefined;
  try {
    const synthData = (goal.spaces?.synthesis_data ?? {}) as Record<string, unknown>;
    const goalBenchmarks = synthData.goal_benchmarks as Record<string, ObjectiveBenchmark> | undefined;
    benchmark = goalBenchmarks?.[goalId] ?? undefined;
  } catch {
    // Non-blocking
  }

  // Build prompt and call LLM
  const { system, user: userPrompt } = getGoalRecommendationsPrompt(goal, synthesisData, extraSynthesis, benchmark);

  const recommendations = await llmJSON<{
    recommendations: Array<{
      rank: number;
      title: string;
      reasoning: string;
      source_type: string;
      source_entity_id?: string;
      impact_estimate: string;
    }>;
  }>({
    system,
    user: userPrompt,
    maxTokens: 4096,
    temperature: 0.3,
  });

  // Clear existing recommendations, insert new ones
  await db.from("goal_recommendations").delete().eq("goal_id", goalId);

  const rows = (recommendations.recommendations ?? []).map((r) => ({
    goal_id: goalId,
    rank: r.rank,
    title: r.title,
    reasoning: r.reasoning,
    source_type: r.source_type || "ai_generated",
    source_entity_id: r.source_entity_id ?? null,
    impact_estimate: ["high", "medium", "low"].includes(r.impact_estimate)
      ? r.impact_estimate
      : "medium",
    status: "pending",
  }));

  if (rows.length > 0) {
    const { error } = await db.from("goal_recommendations").insert(rows);
    if (error) {
      console.error("[GoalRecs] Insert error:", error);
      return NextResponse.json({ error: "Failed to save recommendations" }, { status: 500 });
    }
  }

  return NextResponse.json({
    recommendations: rows,
    count: rows.length,
  });
}
