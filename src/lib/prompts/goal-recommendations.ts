import type { ImprovementGoal, ObjectiveBenchmark } from "@/types/goals";

/**
 * Generates the prompt for ranking synthesis findings by goal relevance.
 * Takes the user's improvement goal + synthesis data and produces
 * a ranked list of recommendations.
 */
export function getGoalRecommendationsPrompt(
  goal: ImprovementGoal,
  synthesisData: Record<string, unknown>,
  extraSynthesis?: Record<string, unknown>[],
  benchmark?: ObjectiveBenchmark
): { system: string; user: string } {
  const system = `You are a strategic advisor producing RANKED recommendations that directly advance a specific improvement goal.

Given an improvement goal (with a measurable target) and analysis synthesis data, your job is to:
1. Identify the findings most relevant to achieving the goal
2. Rank them by EXPECTED IMPACT on the goal metric
3. Explain WHY each recommendation advances the goal

RANKING CRITERIA (in order):
- Direct causal link to the goal metric (e.g., leverage point that directly affects the metric)
- Removal of bottlenecks blocking progress toward the target
- Risk mitigations that protect current progress
- Action items with clear, measurable outcomes
- Insights that change the strategy toward the goal

EXTERNAL VALIDATION WEIGHTING:
- Recommendations backed by externally-validated entities (from domain research with web_search source_type, authority_level "high" or "moderate") get priority over training-knowledge-only insights at the same tier
- If an entity is both a leverage point AND has external validation (bridge edges connecting it to external research), it should be ranked higher than leverage points without external grounding
- Worth-considering items with source_note citing external research should be weighted more heavily than those without provenance
- When two recommendations have similar expected impact, prefer the one with stronger external evidence

EXTERNAL EVIDENCE QUALITY:
- High authority (peer-reviewed, official data, .gov/.edu sources): strong evidence — treat as reliable basis for recommendations
- Moderate authority (web-verified, reputable industry sources): good evidence — solid support for recommendations
- Low authority (training knowledge only, no external validation): treat as hypothesis, not evidence — rank below externally-grounded alternatives

BENCHMARK-ALIGNED RANKING:
When the goal has defined evaluation criteria (benchmarks), use them to sharpen your recommendations:
- Recommendations that directly advance a MUST-HAVE success criterion rank above those advancing SHOULD-HAVE or NICE-TO-HAVE criteria
- Recommendations that improve a leading indicator currently reading "off_track" or "at_risk" get priority
- If a failure signal is near its deadline, recommendations that address the underlying condition get top priority
- Each recommendation should note which success criterion it advances (in the reasoning field)
- Recommendations advancing multiple criteria simultaneously are highest value

For each recommendation:
- title: A clear, actionable statement (not just an entity name)
- reasoning: 2-3 sentences explaining the causal link to the goal
- source_type: One of "leverage_point", "action_item", "risk_mitigation", or "ai_generated"
- source_entity_id: The entity_id if this comes from a specific entity (e.g., "C1"), or null
- impact_estimate: "high" (directly moves the metric), "medium" (indirectly helps), or "low" (supportive)

Return ONLY valid JSON matching this schema:
{
  "recommendations": [
    {
      "rank": 1,
      "title": "string",
      "reasoning": "string",
      "source_type": "leverage_point" | "action_item" | "risk_mitigation" | "ai_generated",
      "source_entity_id": "string or null",
      "impact_estimate": "high" | "medium" | "low",
      "criteria_advanced": ["string array of which success criteria this recommendation helps achieve"]
    }
  ]
}

Produce 5-10 recommendations, ordered by rank (1 = highest impact).`;

  const goalBlock = `IMPROVEMENT GOAL:
- Title: ${goal.title}
${goal.description ? `- Description: ${goal.description}` : ""}
- Metric: ${goal.metric_name}${goal.metric_unit ? ` (${goal.metric_unit})` : ""}
- Current: ${goal.current_value} → Target: ${goal.target_value}
- Gap: ${Number(goal.target_value) - Number(goal.current_value)} ${goal.metric_unit ?? "units"} to close
${goal.deadline ? `- Deadline: ${goal.deadline}` : ""}`;

  const benchmarkBlock = benchmark
    ? `\nEVALUATION CRITERIA (benchmarks for this goal):
Success Criteria:
${benchmark.success_criteria.map((sc) => `  - [${sc.priority}] ${sc.criterion} — threshold: ${sc.threshold}, measured by: ${sc.measurement}`).join("\n")}

Leading Indicators:
${benchmark.leading_indicators.map((li) => `  - ${li.metric} (check: ${li.check_frequency}) — on_track: ${li.on_track}, at_risk: ${li.at_risk}, off_track: ${li.off_track}`).join("\n")}

Failure Signals:
${benchmark.failure_signals.map((fs) => `  - ${fs.signal} → response: ${fs.response}, deadline: ${fs.deadline}`).join("\n")}

Milestones:
${benchmark.milestones.map((ms) => `  - ${ms.name}: ${ms.target_value} by ${ms.expected_by}`).join("\n")}

Evaluation approach: ${benchmark.evaluation_approach}

IMPORTANT: Align your recommendations to these criteria. In the "reasoning" field, reference which success criterion each recommendation advances.\n`
    : "";

  const synthesisBlock = `SYNTHESIS DATA:
${JSON.stringify(synthesisData, null, 2)}

NOTE ON EXTERNAL PROVENANCE:
The synthesis data may contain "agent7_cross_context_insights" (externally-validated findings from domain research with web_search sources) and "worth_considering" items (with source_note fields citing external research). Entities connected via bridge edges to external research have stronger evidentiary grounding. Use this provenance information when applying the External Validation Weighting criteria above.`;

  const extraBlock =
    extraSynthesis && extraSynthesis.length > 0
      ? `\n\nADDITIONAL SPACE SYNTHESIS:\n${JSON.stringify(extraSynthesis, null, 2)}`
      : "";

  return {
    system,
    user: `${goalBlock}\n${benchmarkBlock}\n${synthesisBlock}${extraBlock}`,
  };
}
