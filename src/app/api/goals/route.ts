import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { inngest } from "@/inngest/client";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { searchParams } = new URL(request.url);
  const spaceId = searchParams.get("spaceId");

  let query = db
    .from("improvement_goals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (spaceId) {
    query = query.eq("space_id", spaceId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[Goals] List error:", error);
    return NextResponse.json({ error: "Failed to fetch goals" }, { status: 500 });
  }

  return NextResponse.json({ goals: data ?? [] });
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const {
    space_id, title, description, metric_name, metric_unit,
    target_value, baseline_value, deadline,
    parent_goal_id, objective_type, source, benchmark,
  } = body;

  if (!space_id || !title || !metric_name || target_value == null) {
    return NextResponse.json(
      { error: "space_id, title, metric_name, and target_value are required" },
      { status: 400 }
    );
  }

  // Verify user owns the space
  const { data: space } = await db
    .from("spaces")
    .select("id")
    .eq("id", space_id)
    .eq("user_id", user.id)
    .single();

  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Defensive number coercion — LLM may return strings like "85%" or "N/A"
  // Smart fallback: use metric_unit to infer sensible defaults instead of always 0→100
  const safeNum = (v: unknown, fallback: number) => {
    if (v == null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  // Infer sensible defaults based on metric unit and objective type instead of 0→100
  const inferredBaseline = (() => {
    if (baseline_value != null && Number.isFinite(Number(baseline_value))) return Number(baseline_value);
    // Most real metrics start at 0 (counts) or current state (%)
    if (metric_unit === "%") return 0;
    return 0; // counts, items, hours, etc. — 0 is usually the honest starting point
  })();

  const inferredTarget = (() => {
    if (target_value != null && Number.isFinite(Number(target_value))) return Number(target_value);
    // Don't default to 100 — use metric-appropriate defaults
    if (metric_unit === "%") return 80; // Realistic % target
    if (metric_unit === "count" || metric_unit === "items" || metric_unit === "users" || metric_unit === "completions") return 10;
    if (metric_unit === "hours" || metric_unit === "days") return objective_type === "minimize" ? 1 : 30;
    if (metric_unit === "dollars") return 1000;
    return 10; // Much more realistic than 100 for most count-based goals
  })();

  const { data: goal, error } = await db
    .from("improvement_goals")
    .insert({
      space_id,
      user_id: user.id,
      parent_goal_id: parent_goal_id ?? null,
      objective_type: objective_type ?? "maximize",
      source: source ?? "manual",
      title,
      description: description ?? null,
      metric_name,
      metric_unit: metric_unit ?? null,
      target_value: inferredTarget,
      baseline_value: inferredBaseline,
      current_value: inferredBaseline,
      deadline: deadline ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[Goals] Create error:", error);
    return NextResponse.json({ error: "Failed to create goal" }, { status: 500 });
  }

  // Insert initial baseline as first progress point
  await db.from("goal_progress").insert({
    goal_id: goal.id,
    value: safeNum(baseline_value, 0),
    note: "Baseline",
    source: "manual",
  }).then(() => {}, () => {});

  // Store benchmark data in synthesis_data if provided
  if (benchmark) {
    try {
      const { data: spaceRow } = await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", space_id)
        .single();

      const synthData = (spaceRow?.synthesis_data ?? {}) as Record<string, unknown>;
      const goalBenchmarks = (synthData.goal_benchmarks ?? {}) as Record<string, unknown>;
      goalBenchmarks[goal.id] = benchmark;

      await db.from("spaces").update({
        synthesis_data: { ...synthData, goal_benchmarks: goalBenchmarks },
      }).eq("id", space_id);
    } catch (err) {
      console.error("[Goals] Failed to store benchmark:", err);
      // Non-blocking — goal was created successfully
    }
  }

  // Phase B: emit goal.created so Inngest spawns a bound researcher agent and
  // kicks a first research pass. Non-blocking — if Inngest is unavailable the
  // fallback Vercel cron will still pick the goal up within 15 minutes.
  try {
    await inngest.send({
      name: "goal.created",
      data: {
        goalId: goal.id as string,
        spaceId: space_id as string,
        userId: user.id,
        goalTitle: typeof goal.title === "string" ? goal.title : undefined,
      },
    });
  } catch (err) {
    console.warn("[Goals] goal.created send failed (non-fatal):", err);
  }

  return NextResponse.json({ goal }, { status: 201 });
}
