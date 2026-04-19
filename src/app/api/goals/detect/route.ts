import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { getObjectiveDetectionPrompt } from "@/lib/prompts/objective-detection";
import type { SynthesisData } from "@/types/synthesis";
import type { SuggestedObjective, ImprovementGoal } from "@/types/goals";
import type { Entity, Edge, Cycle } from "@/types";

export const maxDuration = 60;

/**
 * POST /api/goals/detect
 *
 * Runs objective detection from EXISTING synthesis data — no re-synthesis needed.
 * Triggered automatically when the dashboard detects synthesis exists but objectives
 * are missing, or when structural changes have made existing objectives stale.
 *
 * Accepts: { spaceId: string }
 * Returns: { objectives: SuggestedObjective[], stored: boolean }
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  try {
    const body = await request.json();
    spaceId = body.spaceId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // Verify ownership and fetch current state
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, synthesis_data, input_text")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single();

  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const synthData = (spaceRow.synthesis_data ?? {}) as Record<string, unknown>;
  const synthesis = synthData as unknown as SynthesisData;

  // Check we have synthesis findings to reason over
  const hasFindings =
    (synthesis.leverage_points?.length ?? 0) > 0 ||
    (synthesis.risk_points?.length ?? 0) > 0 ||
    synthesis.master_bottleneck != null;

  if (!hasFindings) {
    console.log("[goals/detect] No findings in synthesis_data:", {
      leverage: synthesis.leverage_points?.length ?? 0,
      risk: synthesis.risk_points?.length ?? 0,
      bottleneck: synthesis.master_bottleneck != null,
    });
    return NextResponse.json({
      objectives: [],
      stored: false,
      reason: "No synthesis findings to derive objectives from",
    });
  }

  // Fetch graph structure for deep causal reasoning
  const [{ data: entities }, { data: edges }, { data: cycles }] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId) as Promise<{ data: Entity[] | null }>,
    db.from("edges").select("*").eq("space_id", spaceId) as Promise<{ data: Edge[] | null }>,
    db.from("cycles").select("*").eq("space_id", spaceId) as Promise<{ data: Cycle[] | null }>,
  ]);

  // Check for active goal (determines top-level vs sub-objective mode)
  const { data: activeGoals } = await db
    .from("improvement_goals")
    .select("*")
    .eq("space_id", spaceId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  const activeGoal: ImprovementGoal | null =
    activeGoals && activeGoals.length > 0 ? (activeGoals[0] as ImprovementGoal) : null;

  // ── Step 1: Build prompt ──
  let objPrompt: { system: string; user: string };
  try {
    const userInputText = (spaceRow as Record<string, unknown>).input_text as string | undefined;
    objPrompt = getObjectiveDetectionPrompt(
      synthesis,
      activeGoal ?? undefined,
      entities ?? [],
      edges ?? [],
      cycles ?? [],
      userInputText ?? undefined,
    );
    const approxSystemTokens = Math.ceil(objPrompt.system.length / 4);
    const approxUserTokens = Math.ceil(objPrompt.user.length / 4);
    console.log(`[goals/detect] Prompt built — system: ~${approxSystemTokens} tokens (${objPrompt.system.length} chars), user: ~${approxUserTokens} tokens (${objPrompt.user.length} chars), total: ~${approxSystemTokens + approxUserTokens} tokens`);
    console.log(`[goals/detect] Context: ${entities?.length ?? 0} entities, ${edges?.length ?? 0} edges, ${cycles?.length ?? 0} cycles, activeGoal: ${activeGoal ? activeGoal.id : "none"}`);
  } catch (promptErr) {
    console.error("[goals/detect] Prompt construction failed:", promptErr);
    return NextResponse.json(
      { error: "Objective detection failed", detail: `Prompt build error: ${(promptErr as Error).message}` },
      { status: 500 },
    );
  }

  // ── Step 2: Call LLM ──
  let objResult: unknown;
  try {
    objResult = await llmJSON<SuggestedObjective[]>({
      system: objPrompt.system,
      user: objPrompt.user,
      maxTokens: 8000,
      temperature: 0.3,
    });
    console.log("[goals/detect] LLM call succeeded, result type:", typeof objResult, Array.isArray(objResult) ? `array[${(objResult as unknown[]).length}]` : "object");
  } catch (llmErr) {
    // Extract OpenAI-specific error details
    const err = llmErr as Record<string, unknown>;
    const status = err.status ?? err.statusCode ?? "unknown";
    const code = err.code ?? "unknown";
    const errType = err.type ?? err.error ?? "unknown";
    console.error(`[goals/detect] LLM call failed — status: ${status}, code: ${code}, type: ${JSON.stringify(errType)}`);
    console.error("[goals/detect] Full error:", llmErr);

    // Provide user-friendly error detail based on error type
    let detail = (llmErr as Error).message ?? "LLM call failed";
    if (status === 401) detail = "OpenAI API key is invalid or expired";
    else if (String(code) === "insufficient_quota" || String(code) === "billing_hard_limit_reached")
      detail = "OpenAI API quota exhausted — please add credits at platform.openai.com/account/billing";
    else if (status === 429) detail = "Rate limit exceeded — please try again in a few seconds";
    else if (status === 400) detail = `Bad request to OpenAI — prompt may be malformed (${(llmErr as Error).message})`;
    else if (String(code) === "context_length_exceeded") detail = "Prompt too large — too many entities/edges for the model context window";

    return NextResponse.json(
      { error: "Objective detection failed", detail },
      { status: 500 },
    );
  }

  // ── Step 3: Parse result ──
  try {
    // Handle both array and wrapped-object responses
    // OpenAI json_object mode forces root-level object, so LLM may wrap: { "objectives": [...] }
    let objectiveArray: SuggestedObjective[];
    if (Array.isArray(objResult)) {
      objectiveArray = objResult;
    } else if (objResult && typeof objResult === "object") {
      // Extract array from common wrapper keys
      const wrapped = objResult as Record<string, unknown>;
      const candidates = wrapped.objectives ?? wrapped.suggested_objectives ?? wrapped.items ?? wrapped.results;
      if (Array.isArray(candidates)) {
        objectiveArray = candidates as SuggestedObjective[];
      } else {
        // Try the first array-valued property
        const firstArray = Object.values(wrapped).find(Array.isArray);
        objectiveArray = (firstArray as SuggestedObjective[] | undefined) ?? [];
      }
    } else {
      objectiveArray = [];
    }

    if (objectiveArray.length === 0) {
      console.log("[goals/detect] LLM returned no objectives. Raw result type:", typeof objResult,
        Array.isArray(objResult) ? "array" : "object",
        objResult && typeof objResult === "object" ? Object.keys(objResult as object) : "");
      return NextResponse.json({
        objectives: [],
        stored: false,
        reason: "LLM returned no objectives",
      });
    }

    console.log(`[goals/detect] Parsed ${objectiveArray.length} objectives`);

    // Ensure every objective has a key (LLM may omit it)
    const keyedResult = objectiveArray.map((o, i) => ({
      ...o,
      key: o.key || `obj_${i}_${Date.now().toString(36)}`,
    }));

    // Tag sub-objectives with parent if active goal exists
    const objectives = activeGoal
      ? keyedResult.map((o) => ({ ...o, parent_goal_id: activeGoal.id }))
      : keyedResult;

    // Re-read current synthesis_data (may have been updated since we started)
    // and merge objectives without clobbering other fields
    const { data: freshRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();

    const freshSynthData = (freshRow?.synthesis_data ?? {}) as Record<string, unknown>;

    // Extract benchmarks from objectives keyed by objective key (will be re-keyed by goal ID on acceptance)
    const objectiveBenchmarks: Record<string, unknown> = {};
    for (const obj of objectives) {
      if (obj.benchmark) {
        objectiveBenchmarks[obj.key] = obj.benchmark;
      }
    }

    await db.from("spaces").update({
      synthesis_data: {
        ...freshSynthData,
        suggested_objectives: objectives,
        objectives_pending_review: true,
        // Preserve existing goal benchmarks, add new objective-keyed ones
        goal_benchmarks: {
          ...((freshSynthData.goal_benchmarks ?? {}) as Record<string, unknown>),
          ...objectiveBenchmarks,
        },
      },
    }).eq("id", spaceId);

    return NextResponse.json({
      objectives,
      stored: true,
      count: objectives.length,
      mode: activeGoal ? "sub_objectives" : "top_level",
    });
  } catch (err) {
    console.error("[goals/detect] Post-LLM processing failed:", err);
    return NextResponse.json(
      { error: "Objective detection failed", detail: `Processing error: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
