import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

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
    .from("goal_progress")
    .select("*")
    .eq("goal_id", goalId)
    .order("recorded_at", { ascending: true });

  if (error) {
    console.error("[GoalProgress] List error:", error);
    return NextResponse.json({ error: "Failed to fetch progress" }, { status: 500 });
  }

  return NextResponse.json({ progress: data ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

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

  const { value, note, source } = body;
  if (value == null) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }

  const validSources = ["manual", "ai_estimated", "integration"];
  const resolvedSource = validSources.includes(source) ? source : "manual";

  const { data: entry, error } = await db
    .from("goal_progress")
    .insert({
      goal_id: goalId,
      value: Number(value),
      note: note ?? null,
      source: resolvedSource,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[GoalProgress] Insert error:", error);
    return NextResponse.json({ error: "Failed to record progress" }, { status: 500 });
  }

  // Update current_value on the goal
  await db
    .from("improvement_goals")
    .update({ current_value: Number(value), updated_at: new Date().toISOString() })
    .eq("id", goalId);

  // Evaluate benchmark status if available
  let benchmark_status = null;
  try {
    // Fetch the space to get benchmark data
    const { data: goalFull } = await db
      .from("improvement_goals")
      .select("space_id, target_value, baseline_value")
      .eq("id", goalId)
      .single();

    if (goalFull) {
      const { data: spaceRow } = await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", goalFull.space_id)
        .single();

      const synthData = (spaceRow?.synthesis_data ?? {}) as Record<string, unknown>;
      const goalBenchmarks = synthData.goal_benchmarks as Record<string, any> | undefined;
      const benchmark = goalBenchmarks?.[goalId];

      if (benchmark) {
        const numValue = Number(value);
        const target = Number(goalFull.target_value);
        const baseline = Number(goalFull.baseline_value);
        const range = target - baseline;
        const progressPct = range !== 0 ? ((numValue - baseline) / range) * 100 : 0;

        // Evaluate which success criteria are met (simple threshold check)
        const criteria_status = (benchmark.success_criteria ?? []).map((sc: any) => ({
          criterion: sc.criterion,
          priority: sc.priority,
          threshold: sc.threshold,
          // We can't programmatically evaluate arbitrary thresholds,
          // but we can flag the current progress percentage
          progress_pct: Math.round(progressPct),
        }));

        // Check milestone progress
        const milestones_reached = (benchmark.milestones ?? []).filter((ms: any) => {
          // Try numeric comparison if target_value looks like a number
          const msTarget = parseFloat(ms.target_value);
          return !isNaN(msTarget) && numValue >= msTarget;
        }).length;

        benchmark_status = {
          has_benchmark: true,
          progress_pct: Math.round(Math.max(0, Math.min(100, progressPct))),
          total_criteria: benchmark.success_criteria?.length ?? 0,
          milestones_total: benchmark.milestones?.length ?? 0,
          milestones_reached,
          evaluation_approach: benchmark.evaluation_approach ?? null,
          leading_indicators: benchmark.leading_indicators ?? [],
          failure_signals: benchmark.failure_signals ?? [],
        };
      }
    }
  } catch (err) {
    console.error("[GoalProgress] Benchmark evaluation error:", err);
    // Non-blocking
  }

  return NextResponse.json({ entry, benchmark_status }, { status: 201 });
}
