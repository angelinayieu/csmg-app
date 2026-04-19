import { llmJSON } from "@/lib/llm";
import type { StructuredDecomposition } from "@/types/analysis";
import type { SuggestedObjective } from "@/types/goals";

/**
 * Fast early objective detection from structured decomposition.
 * Runs during the initial pipeline after structuring completes.
 * Uses entity/edge/cycle data (no synthesis required).
 *
 * Returns preliminary objectives for user review.
 * These will be refined by full synthesis later.
 */
export async function detectEarlyObjectives(
  structured: StructuredDecomposition,
  userInput: string,
): Promise<SuggestedObjective[]> {
  // Build compact context from structured data
  const entitySummary = (structured.entities ?? [])
    .slice(0, 30)
    .map((e) => {
      const tags: string[] = [];
      if (e.is_leverage_point) tags.push("LEVERAGE");
      if (e.is_risk_point) tags.push("RISK");
      if (e.is_master_bottleneck) tags.push("BOTTLENECK");
      return `${e.entity_id} "${e.name}" [${e.entity_category}/${e.importance}] ${tags.length ? `(${tags.join(",")})` : ""}: ${(e.description ?? "").slice(0, 120)}`;
    })
    .join("\n");

  const edgeSummary = (structured.edges ?? [])
    .slice(0, 40)
    .map(
      (e) =>
        `${e.source_entity_id} -[${e.relationship_type}/${e.dimension}/${e.polarity}]-> ${e.target_entity_id}${e.is_part_of_cycle ? " (cycle)" : ""}`,
    )
    .join("\n");

  const cycleSummary = (structured.cycles ?? [])
    .map(
      (c) =>
        `${c.cycle_id} "${c.name}" [${c.classification}]: ${c.entity_ids.join(" -> ")} | intervention: ${c.intervention_point}`,
    )
    .join("\n");

  const leverageSummary = (structured.leverage_points ?? [])
    .slice(0, 5)
    .map(
      (lp) =>
        `${lp.entity_id}: ${lp.summary ?? lp.reason ?? ""}`,
    )
    .join("\n");

  const riskSummary = (structured.risk_points ?? [])
    .slice(0, 5)
    .map(
      (rp) =>
        `${rp.entity_id} (blast:${rp.blast_radius}): ${rp.summary ?? rp.reason ?? ""}`,
    )
    .join("\n");

  const bottleneck = structured.master_bottleneck
    ? `${structured.master_bottleneck.entity_id} (blast:${structured.master_bottleneck.blast_radius}): ${structured.master_bottleneck.summary ?? structured.master_bottleneck.reason ?? ""}`
    : "None identified";

  const system = `You are a strategic objective detection engine. Given a structured analysis of a user's situation (entities, causal edges, feedback cycles, leverage/risk points), identify their TRUE underlying objectives.

YOUR TASK:
1. BACKWARD CHAIN from leverage points, risk points, and bottlenecks. For each, ask "why does this matter?" and trace through the causal edges until you reach something that matters for its own sake. That is the FUNDAMENTAL objective.

2. DISCOVER HIDDEN SUB-OBJECTIVES: What MUST be true for the main objective to succeed? These are structural objectives that the user may not have stated but are necessary preconditions.

3. FIND THE PROPELLANT: For each objective, identify the SINGLE most important first action — the one thing that, if done, makes everything else easier. Map it to a specific entity and mechanism (clears_bottleneck, starts_loop, amplifies_leverage, removes_risk, creates_bridge).

4. RANK BY DEPTH:
   - "fundamental": Convergence point where multiple causal chains meet (convergence_score >= 3)
   - "structural": Emerges from connected findings pattern (convergence_score 1-2)
   - "surface": Maps directly to a single finding

OUTPUT: A JSON array of objectives. Each object has these fields:
- key: string (unique slug like "revenue-predictability")
- title: string (concise, action-oriented)
- objective_type: "maximize" | "minimize" | "maintain" | "explore" | "avoid"
- description: string (2-3 sentences explaining the objective)
- metric_name: string (what to measure)
- metric_unit: string | null
- baseline_estimate: number | null
- target_estimate: number | null
- rationale: string (why this matters, referencing causal structure)
- source_entity_id: string | null (primary entity this derives from)
- source_type: "leverage_point" | "risk_point" | "feedback_loop" | "bottleneck" | "scenario" | "open_question" | "external_insight" | "cross_context" | "worth_considering"
- confidence: "high" | "moderate" | "low"
- priority: number (1 = highest)
- depth: "fundamental" | "structural" | "surface"
- convergence_score: number (how many causal chains converge here)
- propellant: { entity_id: string, entity_name: string, action: string, why: string, mechanism: "clears_bottleneck" | "starts_loop" | "amplifies_leverage" | "removes_risk" | "creates_bridge" } | null

Return 3-6 objectives, ordered by depth (fundamental first) then priority.
Respond with ONLY the JSON array, no markdown fences.`;

  const user = `USER'S SITUATION:
${userInput.slice(0, 1500)}

ENTITIES:
${entitySummary}

CAUSAL EDGES:
${edgeSummary}

FEEDBACK CYCLES:
${cycleSummary || "None detected"}

LEVERAGE POINTS:
${leverageSummary || "None identified"}

RISK POINTS:
${riskSummary || "None identified"}

MASTER BOTTLENECK:
${bottleneck}`;

  const result = await llmJSON<SuggestedObjective[]>({
    system,
    user,
    maxTokens: 4000,
    temperature: 0.4,
    validator: (data) => {
      if (!Array.isArray(data)) throw new Error("Expected array");
      return data as SuggestedObjective[];
    },
    fallback: [],
  });

  return result;
}
