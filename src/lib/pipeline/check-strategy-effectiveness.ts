// ── checkStrategyEffectiveness ──
//
// Runs the LLM-as-judge pass that scores a generated strategy against
// the synthesis findings it was built from. Returns a structured
// verdict or null on soft-fail.
//
// Called by: synthesize/route.ts (after strategy generation completes,
// before persistence). Optional — if the call fails, synthesis still
// persists with strategy_effectiveness_check left undefined.
//
// Design contract:
//   - This call is INDEPENDENT of the strategy's self-reported
//     provenance. Don't pre-load it with the strategy's own
//     `axioms_respected` / `convergences_addressed` claims; let the
//     judge form its own opinion by reading the actual tactics +
//     core_logic against the synthesis.
//   - ~3k tokens input, ~1k output. Cheap relative to the 16k token
//     final-rec call.

import { llmJSON } from "@/lib/llm";
import {
  STRATEGY_EFFECTIVENESS_CHECK_SCHEMA,
  STRATEGY_EFFECTIVENESS_CHECK_SYSTEM,
} from "@/lib/prompts/strategy-effectiveness-check";
import type {
  StrategyEffectivenessCheck,
  SynthesisData,
} from "@/types/synthesis";
import type { StrategicRecommendation } from "@/types/strategy";
import type { ImprovementGoal } from "@/types/goals";

interface CheckArgs {
  synthesis: SynthesisData;
  /** The strategy to judge — the winning ranked_strategies[0] OR a
   *  specific recommendation when there are multiple. */
  recommendation: StrategicRecommendation;
  /** Active goal (if any) — drives the goal_alignment_score dimension. */
  activeGoal: ImprovementGoal | null;
}

export async function checkStrategyEffectiveness({
  synthesis,
  recommendation,
  activeGoal,
}: CheckArgs): Promise<StrategyEffectivenessCheck | null> {
  // Build the user-message context. We deliberately keep this lean —
  // only what the judge needs to form an independent opinion.
  const masterBottleneck = synthesis.master_bottleneck
    ? `MASTER BOTTLENECK: ${synthesis.master_bottleneck.entity_id}: ${synthesis.master_bottleneck.summary} | blast_radius: ${synthesis.master_bottleneck.blast_radius ?? "?"}`
    : "MASTER BOTTLENECK: (none identified)";

  const criticalAxioms =
    (synthesis.axioms ?? [])
      .filter((a) => a.load_bearing === "critical")
      .slice(0, 8)
      .map(
        (a, i) =>
          `  ax${i}: "${a.claim}" [${a.scope}/${a.visibility}] — if false: ${a.if_false}`,
      )
      .join("\n") || "  (no critical axioms)";

  const strongConvergences =
    (synthesis.insight_convergences ?? [])
      .slice(0, 5)
      .map(
        (c) =>
          `  ${c.cluster_id} [${c.strength}]: ${c.signal_count} signals on entities [${(c.shared_entity_ids ?? []).join(", ")}] — ${c.concern_label}`,
      )
      .join("\n") || "  (no convergences computed)";

  const leveragePoints =
    (synthesis.leverage_points ?? [])
      .slice(0, 5)
      .map((lp) => `  ${lp.entity_id}${lp.entity_name ? ` (${lp.entity_name})` : ""}: ${lp.summary}`)
      .join("\n") || "  (none)";

  const riskPoints =
    (synthesis.risk_points ?? [])
      .slice(0, 5)
      .map((rp) => `  ${rp.entity_id}${rp.entity_name ? ` (${rp.entity_name})` : ""}: ${rp.summary} [blast_radius: ${rp.blast_radius}]`)
      .join("\n") || "  (none)";

  const goalContext = activeGoal
    ? `ACTIVE GOAL: "${activeGoal.title}" (${activeGoal.metric_name}) — current: ${activeGoal.current_value ?? activeGoal.baseline_value ?? "?"}, target: ${activeGoal.target_value ?? "?"}${activeGoal.metric_unit ? ` ${activeGoal.metric_unit}` : ""}${activeGoal.deadline ? ` by ${activeGoal.deadline}` : ""}`
    : "ACTIVE GOAL: (none — return 50 with no_active_goal in reasoning)";

  // The strategy itself — title, summary, core logic, tactics, what
  // it claims to ground in. Deliberately includes the strategy's
  // self-reported provenance so the judge can DISAGREE with it where
  // warranted (not so they trust it).
  const tacticsLines =
    (recommendation.micro_tactics ?? [])
      .map((t, i) => {
        const grounding = [
          t.axiom_ids_respected?.length
            ? `axioms:${t.axiom_ids_respected.join(",")}`
            : null,
          t.convergence_ids_addressed?.length
            ? `convs:${t.convergence_ids_addressed.join(",")}`
            : null,
          t.hidden_signal_refs?.length
            ? `signals:${t.hidden_signal_refs.join(",")}`
            : null,
        ]
          .filter(Boolean)
          .join(" | ");
        return `  T${i} (${t.entity_id}${t.entity_name ? `/${t.entity_name}` : ""}): ${t.title} — ${t.description} [${grounding || "no self-reported grounding"}]`;
      })
      .join("\n") || "  (no tactics)";

  const provClaims = recommendation.provenance
    ? `\nSTRATEGY'S SELF-REPORTED PROVENANCE (verify, don't trust):
  axioms_respected: ${recommendation.provenance.axioms_respected?.length ?? 0}
  convergences_addressed: ${recommendation.provenance.convergences_addressed?.length ?? 0}
  hidden_signals_addressed: ${recommendation.provenance.hidden_signals_addressed?.length ?? 0}
  critical_axioms_missed: ${recommendation.provenance.critical_axioms_missed?.length ?? 0}
  strong_convergences_missed: ${recommendation.provenance.strong_convergences_missed?.length ?? 0}
  overall_provenance_score: ${recommendation.provenance.overall_provenance_score ?? "?"}`
    : "";

  const userMessage = `You are reviewing a strategy generated for the following situation. Verify the four narrow questions independently — do NOT trust the strategy's self-reported provenance unless the actual tactics confirm it.

═══ SYNTHESIS FINDINGS ═══

${masterBottleneck}

LEVERAGE POINTS:
${leveragePoints}

RISK POINTS:
${riskPoints}

CRITICAL AXIOMS:
${criticalAxioms}

STRONG CONVERGENCES:
${strongConvergences}

${goalContext}

═══ THE STRATEGY ═══

TITLE: ${recommendation.title}
POSTURE: ${recommendation.strategic_posture ?? "?"}
TARGET OBJECTIVE: ${recommendation.target_objective ?? "?"}

SUMMARY: ${recommendation.summary ?? "?"}

GUIDING POLICY: ${recommendation.guiding_policy ? JSON.stringify(recommendation.guiding_policy).slice(0, 800) : "?"}

REASONING CHAIN: ${recommendation.reasoning_chain ?? "?"}

KEY DECISION: ${recommendation.key_decision?.question ?? "?"} — recommended: ${recommendation.key_decision?.recommended ?? "?"} | reasoning: ${recommendation.key_decision?.reasoning ?? "?"}

TACTICS:
${tacticsLines}
${provClaims}

═══ TASK ═══

Return JSON matching the schema. Cite specific entity IDs, axiom indices (ax0, ax1...), or convergence IDs (conv:0...) in every verdict. Be willing to mark "shallow" or "broken" — calibration drift is the failure mode.`;

  try {
    const result = await llmJSON<Omit<StrategyEffectivenessCheck, "checked_at">>({
      system: STRATEGY_EFFECTIVENESS_CHECK_SYSTEM,
      user: userMessage,
      responseSchema: STRATEGY_EFFECTIVENESS_CHECK_SCHEMA,
      maxTokens: 2048,
      temperature: 0.1,
    });

    return {
      ...result,
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(
      "[check-strategy-effectiveness] LLM call failed (soft-fail):",
      err,
    );
    return null;
  }
}
