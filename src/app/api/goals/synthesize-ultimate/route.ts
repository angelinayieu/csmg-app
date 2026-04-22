import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import type { SuggestedObjective, ObjectiveType, UltimateGoalProposal } from "@/types/goals";

export const maxDuration = 30;

/**
 * POST /api/goals/synthesize-ultimate
 *
 * Given a set of approved sub-objectives, propose ONE ultimate goal that
 * encompasses them. User reviews and can edit before we persist anything.
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  const spaceId: string | undefined = b?.spaceId;
  const approved: SuggestedObjective[] = Array.isArray(b?.approved) ? b.approved : [];

  if (!spaceId || approved.length === 0) {
    return NextResponse.json({ error: "spaceId and approved[] required" }, { status: 400 });
  }

  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, name, description, synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single();

  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Short-circuit: if exactly one sub-objective, the ultimate IS that objective.
  if (approved.length === 1) {
    const only = approved[0];
    const proposal: UltimateGoalProposal = {
      title: only.title,
      description: only.description,
      objective_type: only.objective_type,
      metric_name: only.metric_name,
      metric_unit: only.metric_unit,
      baseline_value: only.baseline_estimate ?? 0,
      target_value: only.target_estimate ?? 10,
      rationale: "A single approved objective — promoted to the ultimate goal directly.",
      child_keys: [only.key],
    };
    return NextResponse.json({ proposal });
  }

  const subSummary = approved
    .map(
      (o, i) =>
        `${i + 1}. [${o.key}] ${o.title} (${o.objective_type}, ${o.depth ?? "unknown"} depth) — ${o.description}\n   metric: ${o.metric_name}${o.metric_unit ? ` (${o.metric_unit})` : ""} | baseline: ${o.baseline_estimate ?? "?"} → target: ${o.target_estimate ?? "?"}`,
    )
    .join("\n");

  const system = `You synthesize one "ultimate goal" from several approved sub-objectives.

SPACE: "${spaceRow.name}"${spaceRow.description ? ` — ${spaceRow.description}` : ""}

APPROVED SUB-OBJECTIVES (all will become children of the ultimate goal):
${subSummary}

YOUR TASK
Produce ONE umbrella goal that these sub-objectives collectively serve. It must be:
- Specific enough to be meaningful (not "improve things").
- Measurable — pick a single headline metric that most faithfully captures the aggregate outcome.
  - If the sub-objectives share a metric, use it.
  - Otherwise propose a composite metric (e.g. "% of sub-objectives on track", "weighted progress index")
    or the highest-leverage sub-metric that indirectly moves the others.
- Honest about baseline and target (integers, simple units). Default baseline 0, target 100 only if using a % composite.
- objective_type: "maximize" unless the aggregate is clearly minimize/maintain.

OUTPUT JSON shape:
{
  "title": string,
  "description": string (1-2 sentences, what "achieving this" looks like),
  "objective_type": "maximize" | "minimize" | "maintain" | "explore" | "avoid",
  "metric_name": string,
  "metric_unit": string | null (e.g. "%", "count", "hours", null for abstract),
  "baseline_value": number,
  "target_value": number,
  "rationale": string (why this single goal captures what the sub-objectives collectively serve),
  "child_keys": string[] (keys of sub-objectives that roll into this goal — include all of them)
}

Respond with ONLY the JSON object.`;

  try {
    const result = await llmJSON<UltimateGoalProposal>({
      system,
      user: "Synthesize the ultimate goal now.",
      maxTokens: 1200,
      temperature: 0.3,
      validator: (data) => {
        if (!data || typeof data !== "object") throw new Error("Expected object");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any;
        if (typeof d.title !== "string" || !d.title.trim()) throw new Error("title required");
        if (typeof d.metric_name !== "string" || !d.metric_name.trim()) throw new Error("metric_name required");
        const allowedTypes: ObjectiveType[] = ["maximize", "minimize", "maintain", "explore", "avoid"];
        const type: ObjectiveType = allowedTypes.includes(d.objective_type) ? d.objective_type : "maximize";
        const baseline = Number.isFinite(Number(d.baseline_value)) ? Number(d.baseline_value) : 0;
        const target = Number.isFinite(Number(d.target_value)) ? Number(d.target_value) : 100;
        const childKeys: string[] = Array.isArray(d.child_keys)
          ? d.child_keys.filter((k: unknown): k is string => typeof k === "string")
          : approved.map((o) => o.key);
        return {
          title: d.title.trim(),
          description: typeof d.description === "string" ? d.description : "",
          objective_type: type,
          metric_name: d.metric_name.trim(),
          metric_unit: typeof d.metric_unit === "string" && d.metric_unit.length > 0 ? d.metric_unit : null,
          baseline_value: baseline,
          target_value: target,
          rationale: typeof d.rationale === "string" ? d.rationale : "",
          child_keys: childKeys.length > 0 ? childKeys : approved.map((o) => o.key),
        };
      },
      fallback: {
        title: spaceRow.name ? `Advance: ${spaceRow.name}` : "Ultimate goal",
        description: "Synthesized from your approved sub-objectives.",
        objective_type: "maximize",
        metric_name: "Sub-objectives on track",
        metric_unit: "%",
        baseline_value: 0,
        target_value: 100,
        rationale: "Fallback: weighted composite across all approved sub-objectives.",
        child_keys: approved.map((o) => o.key),
      },
    });

    return NextResponse.json({ proposal: result });
  } catch (err) {
    console.error("[SynthesizeUltimate] LLM error:", err);
    return NextResponse.json({ error: "Failed to synthesize ultimate goal" }, { status: 500 });
  }
}
