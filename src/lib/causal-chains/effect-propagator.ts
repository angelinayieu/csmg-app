// Effect Propagator prompts and schemas.
// Two-phase flow:
//   1. Baseline check — if required values are missing, generate BaselineQuestion[]
//      and return status="needs_baseline". The UI renders them, user answers,
//      then re-calls the propagator.
//   2. Full trace — run the 5-step calculation pipeline and produce a
//      CalculationTrace matching the Calculation Trace page layout.

import type { CausalChain, BaselineQuestion, CalculationTrace } from "@/types/causal-chains";
import type { ImprovementGoal } from "@/types/goals";
import type { SynthesisData } from "@/types/synthesis";

export interface PropagatorInput {
  chain: CausalChain;
  goal: ImprovementGoal | null;
  synthesisData: SynthesisData | null;
  // User-provided answers from a prior baseline-question round
  answeredQuestions?: BaselineQuestion[];
  // Space-level context
  spaceName: string;
  spaceDescription?: string | null;
}

/**
 * Decide whether enough baseline is known to run a full trace.
 * Returns list of MISSING inputs that must be asked about.
 *
 * The critical inputs are:
 *   - Baseline value (current measured state)
 *   - How the user tracks the outcome metric (data source)
 *   - Population/domain complexity (to calibrate effect size)
 *   - Historical adherence rate (if rollout history exists in KG)
 */
export function detectMissingBaselines(input: PropagatorInput): string[] {
  const missing: string[] = [];
  const { goal, chain, answeredQuestions = [] } = input;

  const hasAnswer = (id: string) =>
    answeredQuestions.some(
      (q) => q.id === id && q.answer !== undefined && q.answer !== null && q.answer !== "",
    );

  // 1. Goal baseline — we need a measured baseline to compute pp deltas
  if (!goal) {
    missing.push("baseline_value");
  } else {
    const base = Number(goal.baseline_value);
    const curr = Number(goal.current_value);
    // If baseline equals target (unlikely) or current matches baseline with zero
    // measurement activity, we assume the user never measured
    if (!Number.isFinite(base) || (base === 0 && curr === 0)) {
      if (!hasAnswer(`${chain.id}-baseline_value`)) missing.push("baseline_value");
    }
  }

  // 2. Data source — how does the user currently measure the outcome?
  if (!hasAnswer(`${chain.id}-data_source`)) {
    missing.push("data_source");
  }

  // 3. Domain complexity — affects population adjustment factor
  if (!hasAnswer(`${chain.id}-domain_complexity`)) {
    missing.push("domain_complexity");
  }

  // 4. Historical adherence — if we have <5 signal-extraction data points, ask
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signalPoints = ((input.synthesisData as any)?.signal_extraction?.signals ?? [])
    .length;
  if (signalPoints < 5 && !hasAnswer(`${chain.id}-adherence_estimate`)) {
    missing.push("adherence_estimate");
  }

  return missing;
}

// ── Prompts ──

export function buildBaselineQuestionPrompt(input: PropagatorInput, missing: string[]): {
  system: string;
  user: string;
} {
  const { chain, goal, spaceName, spaceDescription } = input;

  const system = `You are the Effect Propagator — an agent that computes measurable outcomes from causal chains.

You are missing data to ground your calculation. Generate short, specific questions the user can answer to fill the gap.

Rules:
1. Only ask about the missing inputs listed — do not ask extra questions.
2. Each question must be answerable in under 30 seconds.
3. Always provide a default_estimate (your best guess) so the user can skip.
4. Numeric questions must include unit, reasonable min/max, and placeholder.
5. Choice questions must have 2-5 options that cover the space.
6. Explain WHY each number matters for THIS chain in one sentence.

Return ONLY JSON matching the schema provided.`;

  const missingDescriptions: Record<string, string> = {
    baseline_value: `Need the current measured value of the outcome metric so we can compute the delta from baseline. The master goal metric is "${goal?.metric_name ?? "unknown"}" in units of "${goal?.metric_unit ?? "%"}".`,
    data_source: `Need to know how the user currently measures "${goal?.metric_name ?? "the outcome"}" so we can cite it as source.`,
    domain_complexity: `Lab effect sizes from academic studies typically overstate real-world operational effects. Need user's domain complexity to calibrate the population adjustment factor.`,
    adherence_estimate: `Need an estimate of how consistently the deliverable rule will be applied in practice (adherence rate). Typical range is 60–95%.`,
  };

  const user = `
SPACE: ${spaceName}${spaceDescription ? ` — ${spaceDescription}` : ""}

CHAIN: ${chain.name} (rank #${chain.rank})
Stages (concept → research → deliverable → application → outcome → goal):
${chain.stages.map((s, i) => `  ${i + 1}. [${s.kind}] ${s.title} — ${s.meta}`).join("\n")}

MASTER GOAL: ${goal?.title ?? "(none set)"}
  baseline: ${goal?.baseline_value ?? "?"} ${goal?.metric_unit ?? ""}
  current: ${goal?.current_value ?? "?"} ${goal?.metric_unit ?? ""}
  target: ${goal?.target_value ?? "?"} ${goal?.metric_unit ?? ""}

MISSING INPUTS (generate one question per item):
${missing.map((m) => `- ${m}: ${missingDescriptions[m] ?? m}`).join("\n")}

OUTPUT JSON:
{
  "questions": [
    {
      "id": "${chain.id}-<missing_key>",
      "chain_id": "${chain.id}",
      "step_num": <1-5 — which trace step this feeds into>,
      "question": "<clear question, under 15 words>",
      "why": "<why this number matters for this specific chain, one sentence>",
      "type": "numeric | choice | yes_no | short_text",
      "choices": ["..."] (only if type=choice),
      "unit": "<if numeric>",
      "min": <if numeric>,
      "max": <if numeric>,
      "placeholder": "<example answer>",
      "default_estimate": <your best guess, required>,
      "required": true | false
    }
  ]
}`;

  return { system, user };
}

export function buildEffectTracePrompt(input: PropagatorInput): {
  system: string;
  user: string;
} {
  const { chain, goal, spaceName, answeredQuestions = [] } = input;
  const synthData = input.synthesisData;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRec = (synthData as any)?.strategic_recommendation as any;
  const matchingTactic = (strategicRec?.micro_tactics ?? []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t: any) => chain.micro_tactic_ids.includes(t.id),
  );

  const answerSummary =
    answeredQuestions.length > 0
      ? answeredQuestions
          .map((q) => `  ${q.id}: ${q.answer ?? q.default_estimate ?? "(skipped)"}`)
          .join("\n")
      : "  (no user answers — use defaults from synthesis + LLM inference)";

  const system = `You are the Effect Propagator (agent name: ATLAS-04) — a Bayesian effect-propagation agent.

Your job: compute a calibrated outcome number for one causal chain, showing your work step-by-step.

METHOD: 5-step pipeline
  1. Baseline — user's measured starting state (from user data, NOT industry averages)
  2. Effect size — published effect for the deliverable rule (Cohen's d or equivalent)
  3. Population adjustment — factor that attenuates lab effect for operational settings
  4. Implementation adherence — factor for real-world compliance (from user history)
  5. Compounding — small factor for interaction with other chains (usually 0.95–1.10)

Then: final_value = baseline × (1 − effect_size × population × adherence × compounding)
                   + [small goal-rebalancing term if applicable]

CI bounds: widen based on replication variance (step 2) + adherence uncertainty (step 4).
Confidence: composite, bounded 0–1.

SHOW YOUR WORK:
- Provide 5 input/transform steps + 1 result step
- Each step picks ONE graph primitive (distribution, density, number_line, scatter, overlap, comparison)
- Graph data must be concrete numbers the renderer can draw
- Sensitivity: 3–5 "what if" perturbations
- Alternatives: 2–3 choices you considered but rejected, with one-line reason
- Narrative: 3–5 sentences explaining WHY you picked these inputs

IMPORTANT:
- Use user-provided answers over literature defaults
- Mark baseline_source as: "user_audit" if user answered, "goal_baseline" if from goal, "llm_estimated" if inferred
- If critical data is speculative, flag it in missing_inputs

Return ONLY JSON matching the schema.`;

  const user = `
CHAIN: ${chain.name}
  concept: ${chain.stages[0].title}
  research: ${chain.stages[1].title} (${chain.stages[1].meta})
  deliverable: ${chain.stages[2].title} (${chain.stages[2].meta})
  application: ${chain.stages[3].title}
  heuristic contribution estimate: +${chain.goal_contribution_pct}%

MATCHING MICRO-TACTIC: ${
    matchingTactic
      ? `${matchingTactic.title} — metric: ${matchingTactic.metric?.name ?? "?"} → ${matchingTactic.metric?.target ?? "?"}`
      : "(no tactic linked)"
  }

MASTER GOAL: ${goal?.title ?? "(none)"}
  metric: ${goal?.metric_name ?? "?"} (${goal?.metric_unit ?? "%"})
  baseline: ${goal?.baseline_value ?? "?"}
  current: ${goal?.current_value ?? "?"}
  target: ${goal?.target_value ?? "?"}

USER ANSWERS:
${answerSummary}

SPACE: ${spaceName}

OUTPUT JSON (keys must match exactly):
{
  "final_value": <number, signed e.g. -5.8>,
  "final_display": "<e.g. −5.8>",
  "final_unit": "<pp | % | count | etc>",
  "ci_lower": <number>,
  "ci_upper": <number>,
  "confidence": <0-1>,
  "method_label": "Bayesian effect propagation v3.2",
  "baseline_source": "user_audit | goal_baseline | llm_estimated | needs_input",
  "steps": [
    {
      "num": 1, "kind": "input", "name": "Baseline <metric>",
      "description": "<one-sentence rationale>",
      "source": { "kind": "user|research|model|history", "label": "<short>", "reliability": 1-5 },
      "graph": { "primitive": "distribution", "data": { "bins": [<heights 0-1>], "mean_index": <0-indexed> } },
      "value_display": "<e.g. 14.2%>", "value_unit": "%", "value_numeric": 14.2,
      "is_factor": false
    },
    {
      "num": 2, "kind": "input", "name": "<rule> effect",
      "description": "<one sentence>",
      "source": { "kind": "research", "label": "<paper name>", "reliability": 1-5 },
      "graph": { "primitive": "density", "data": { "center_pct": <0-100>, "spread": <small number>, "peak_value": <0-1> } },
      "value_display": "<e.g. -41%>", "value_unit": "%", "value_numeric": -41, "is_factor": false
    },
    {
      "num": 3, "kind": "transform", "name": "Population adjustment",
      "description": "<why attenuate>",
      "source": { "kind": "model", "label": "<benchmark source>", "reliability": 1-5 },
      "graph": { "primitive": "number_line", "data": { "min": 0, "max": 1, "marker": <0-1> } },
      "value_display": "×0.60", "value_numeric": 0.6, "is_factor": true
    },
    {
      "num": 4, "kind": "transform", "name": "Implementation adherence",
      "description": "<based on history or user answer>",
      "source": { "kind": "history", "label": "<source>", "reliability": 1-5 },
      "graph": { "primitive": "scatter", "data": { "points": [[<x>,<y>], ...], "trend": "up|down|flat" } },
      "value_display": "×0.85", "value_numeric": 0.85, "is_factor": true
    },
    {
      "num": 5, "kind": "transform", "name": "Compounding with other chains",
      "description": "<mutual reinforcement rationale>",
      "source": { "kind": "model", "label": "Risk-Impact framework v2.1", "reliability": 1-5 },
      "graph": { "primitive": "overlap", "data": { "labels": ["WM","Seq"], "overlap_ratio": <0-1> } },
      "value_display": "×1.05", "value_numeric": 1.05, "is_factor": true
    },
    {
      "num": 6, "kind": "result", "name": "Projected Δ from baseline",
      "description": "<composed result explanation>",
      "source": { "kind": "model", "label": "Composed result", "reliability": 1-5 },
      "graph": { "primitive": "comparison", "data": { "before": <num>, "after": <num>, "unit": "%" } },
      "value_display": "<final_display>", "value_unit": "<final_unit>", "value_numeric": <final_value>, "is_factor": false
    }
  ],
  "formula_compact": "{{input:1}} × (1 − {{input:2}} × {{factor:3}} × {{factor:4}} × {{factor:5}}) = {{result}}",
  "sensitivity": [
    { "perturbation": "If adherence drops to 70%", "result_display": "<e.g. −4.4>", "result_numeric": -4.4, "delta_from_base": <signed>, "direction": "worse|better|same" }
  ],
  "alternatives_considered": [
    { "name": "<name>", "rejected_reason": "<one sentence>" }
  ],
  "narrative": "<3-5 sentences>",
  "missing_inputs": []
}`;

  return { system, user };
}
