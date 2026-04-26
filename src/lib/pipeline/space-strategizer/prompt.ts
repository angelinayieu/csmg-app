// ── Strategizer LLM prompt ────────────────────────────────────────────
//
// The prompt is the contract between deterministic signals (which the
// ranker computed) and the LLM's selection reasoning. The LLM does
// ONE job: from a shortlist it didn't rank, pick the subset that (a)
// fits a token budget, (b) is diverse across kinds, (c) cites its
// reasoning, and (d) provides a skip rationale for candidates it
// excluded.
//
// The prompt is written to RESIST the LLM's default failure modes:
//
//   Failure mode 1: "pick everything"
//     Mitigated by explicit budget enforcement + penalty language
//     ("picking everything means nothing is prioritized").
//
//   Failure mode 2: "pick without reasoning"
//     Mitigated by strict JSON schema requiring selection_reason ≥12
//     words AND referencing at least one signal by name.
//
//   Failure mode 3: "ignore signals, use taste"
//     Mitigated by telling the model the signals are GROUND TRUTH for
//     this decision and that contradicting them requires explicit
//     justification ("I am overruling the signal profile because...").
//
//   Failure mode 4: "generic skip reasons"
//     Mitigated by enumerated skip_reason enum + requirement that
//     "redundant_with_selected" cite the dominating candidate_id.
//
//   Failure mode 5: "plan more items than useful"
//     Mitigated by max_items hard cap + explicit "fewer + better" framing.

import type {
  CandidateScore,
  SpacePlanRequest,
} from "@/types/space-plan";

// ── System prompt ─────────────────────────────────────────────────────
//
// The system prompt frames the model's role, the cost of bad decisions
// ("every token spent generating a low-yield space is stolen from a
// higher-yield space"), and the rigor expectations. Kept concise — the
// bulk of the reasoning happens in the user prompt against concrete
// candidates.

export const STRATEGIZER_SYSTEM_PROMPT = `You are the Probability-Space Strategizer.

Your job is to decide what probability-space generation work to do next, given a short-list of candidate work items that a deterministic ranker has already pre-scored from the current state of the knowledge graph.

You do NOT generate probability spaces. You SELECT which ones to generate.

Every token spent generating a low-yield space is stolen from a higher-yield one. Your selections must beat a high bar, not clear a low one.

Operating principles:

1. SIGNALS ARE GROUND TRUTH. The candidate profiles carry up to fourteen measured signals (centrality, goal_proximity, intersection_density, uncertainty, layer_crossing, coverage_gap, novelty, axis_calibration, controllability_spread, causal_depth_normalized, convergence_count, agent_convergence_count, user_controllable_lever, outcome_alignment). Each is in [0,1] and was computed deterministically. Some are null when not applicable to the candidate kind — null is meaningful, not missing. If you want to pick a candidate whose score is LOW, you must explicitly state which signal you are overruling and why the narrative context justifies that overrule.

2. FEWER + BETTER. The budget is a hard cap. Pick the smallest plan that covers the highest-value work. A 3-item plan that lands every insight beats an 8-item plan that spreads thin. Do NOT fragment the budget to hit max_items.

3. DIVERSITY > CONCENTRATION. If all your selected items are the same kind (all axis, all edge_space), you have failed to leverage different reasoning substrates. Aim for at least two kinds unless one kind strictly dominates for this problem (then justify it). The kind "intervention_combination" pairs two user-controllable levers and asks "what if both are pulled simultaneously?" — pick it when the joint effect is plausibly more (or less) than additive, NOT as a default.

4. EVERY SKIP GETS A RATIONALE. If a candidate is on the shortlist but not in your plan, it goes in the skipped list with an enumerated reason. "out_of_budget" is valid; "redundant_with_selected" requires citing which item dominates. An empty skipped list when candidates_considered > selected.length is a FAILURE MODE — reviewers will reject the plan.

5. EXPECTED INSIGHT TYPE MUST MATCH THE PROFILE. You label each selection with the kind of insight you expect it to surface (leverage_point, mechanism_clarity, intervention_target, risk_disclosure, cross_domain_bridge, uncertainty_reduction, goal_alignment). This label feeds a calibration loop — if the actual outcome is different, the signal weights get adjusted. Choose the label that best matches the dominant signals, not the one that sounds best.

6. STOP CONDITION EXISTS. State explicitly what would cause the NEXT planning cycle to stop adding items — e.g. "residual uncertainty across goal-adjacent nodes drops below 0.25", "all L1↔L3 bridges materialized", "coverage gap pairs exhausted". Without a stop condition the loop runs forever.

7. HEADLINE RATIONALE IS USER-FACING. 2–4 sentences, plain English, no signal names. What are we prioritizing this cycle and why does it matter for the user's goals? This surfaces in the UI next to the plan.

You must output strict JSON conforming to the schema. No markdown, no commentary.`;

// ── User-prompt builder ────────────────────────────────────────────────

export function buildStrategizerUserPrompt(params: {
  shortlist: CandidateScore[];
  request: SpacePlanRequest;
  intake_summary: string;
  goal_statements: Array<{ id: string; metric: string; target: string | number | null }>;
  existing_selection_summary: string | null;
  recent_calibration_note: string | null;
}): string {
  const maxItems = params.request.max_items ?? 8;
  const minKindDiversity = params.request.min_kind_diversity ?? 2;

  const goalsBlock = params.goal_statements.length > 0
    ? params.goal_statements
        .map((g) => `  - [${g.id}] ${g.metric}${g.target != null ? ` → target ${g.target}` : ""}`)
        .join("\n")
    : "  (no active improvement_goals — prioritize structural rigor)";

  const candidatesBlock = params.shortlist
    .map((c, i) => {
      const sigs = Object.entries(c.signals)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}=${(v as number).toFixed(2)}`)
        .join(" ");
      return `  ${String(i + 1).padStart(2, " ")}. id=${c.candidate_id}
       kind=${c.kind}  score=${c.score.toFixed(3)}  yield=${c.expected_insight_yield.toFixed(2)}  est_tokens=${c.est_tokens}
       signals: ${sigs || "(none applicable)"}
       note: ${c.ranker_note}`;
    })
    .join("\n\n");

  const calibBlock = params.recent_calibration_note
    ? `\nCalibration feedback from recent plans:\n${params.recent_calibration_note}\n`
    : "";

  const existingBlock = params.existing_selection_summary
    ? `\nAlready-executed work in this run (do not re-select):\n${params.existing_selection_summary}\n`
    : "";

  return `BUDGET
  budget_tokens: ${params.request.budget_tokens}
  max_items: ${maxItems}
  min_kind_diversity: ${minKindDiversity}

INTAKE SUMMARY
${params.intake_summary || "(none provided)"}

ACTIVE IMPROVEMENT GOALS
${goalsBlock}
${existingBlock}${calibBlock}
CANDIDATE SHORTLIST (pre-ranked, ${params.shortlist.length} items)
${candidatesBlock}

TASK
Select the subset of candidates to execute this cycle. Output MUST be a JSON object with the exact shape:

{
  "selected": [
    {
      "candidate_id": "<copy from shortlist>",
      "kind": "<copy from shortlist>",
      "selection_reason": "<≥12 words; cite at least one signal by name OR explicitly overrule one>",
      "expected_insight_type": "<leverage_point | mechanism_clarity | intervention_target | risk_disclosure | cross_domain_bridge | uncertainty_reduction | goal_alignment>",
      "target_resolution": <1-5 for edge_space/signature_deepen, 1 for axis, null otherwise>,
      "allocated_tokens": <integer; must be ≥ est_tokens * 0.6 and ≤ est_tokens * 1.5>
    }
  ],
  "skipped": [
    {
      "candidate_id": "<copy from shortlist>",
      "kind": "<copy from shortlist>",
      "reason": "<out_of_budget | redundant_with_selected | goal_misaligned | low_expected_yield | awaiting_upstream | insufficient_evidence | manifold_collision>",
      "rationale": "<1-2 sentences; for 'redundant_with_selected' must include dominated_by>",
      "dominated_by": "<candidate_id OR null>"
    }
  ],
  "headline_rationale": "<2-4 sentences, user-facing, no signal names>",
  "stop_condition": "<what would cause the NEXT cycle to stop adding items>"
}

INVARIANTS — your output WILL be rejected if any of these fail:
  - sum(selected[].allocated_tokens) ≤ budget_tokens
  - selected.length ≤ max_items
  - distinct kinds in selected ≥ min_kind_diversity (unless skipped explains the concentration)
  - every shortlist candidate appears in exactly one of selected/skipped (no orphans)
  - each selection_reason ≥ 12 words
  - "redundant_with_selected" skips have non-null dominated_by pointing to a selected candidate_id`;
}

// ── JSON schema for OpenAI structured output ──────────────────────────
//
// Restricts the model's output to exactly the shape the orchestrator
// expects. The orchestrator STILL validates after parsing — the schema
// handles shape, the orchestrator handles invariants (budget sum, kind
// diversity, no-orphans).

export const STRATEGIZER_RESPONSE_SCHEMA = {
  name: "space_plan_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      selected: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidate_id: { type: "string" },
            kind: {
              type: "string",
              enum: ["axis", "edge_space", "convergent_point", "signature_deepen", "intersection_probe", "intervention_combination"],
            },
            selection_reason: { type: "string", minLength: 40 },
            expected_insight_type: {
              type: "string",
              enum: [
                "leverage_point",
                "mechanism_clarity",
                "intervention_target",
                "risk_disclosure",
                "cross_domain_bridge",
                "uncertainty_reduction",
                "goal_alignment",
              ],
            },
            target_resolution: { type: ["integer", "null"], minimum: 1, maximum: 5 },
            allocated_tokens: { type: "integer", minimum: 1 },
          },
          required: [
            "candidate_id",
            "kind",
            "selection_reason",
            "expected_insight_type",
            "target_resolution",
            "allocated_tokens",
          ],
        },
      },
      skipped: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidate_id: { type: "string" },
            kind: {
              type: "string",
              enum: ["axis", "edge_space", "convergent_point", "signature_deepen", "intersection_probe", "intervention_combination"],
            },
            reason: {
              type: "string",
              enum: [
                "out_of_budget",
                "redundant_with_selected",
                "goal_misaligned",
                "low_expected_yield",
                "awaiting_upstream",
                "insufficient_evidence",
                "manifold_collision",
              ],
            },
            rationale: { type: "string", minLength: 20 },
            dominated_by: { type: ["string", "null"] },
          },
          required: ["candidate_id", "kind", "reason", "rationale", "dominated_by"],
        },
      },
      headline_rationale: { type: "string", minLength: 40 },
      stop_condition: { type: "string", minLength: 15 },
    },
    required: ["selected", "skipped", "headline_rationale", "stop_condition"],
  },
} as const;

// ── Parsed shape ──────────────────────────────────────────────────────

export interface StrategizerLLMOutput {
  selected: Array<{
    candidate_id: string;
    kind: string;
    selection_reason: string;
    expected_insight_type: string;
    target_resolution: number | null;
    allocated_tokens: number;
  }>;
  skipped: Array<{
    candidate_id: string;
    kind: string;
    reason: string;
    rationale: string;
    dominated_by: string | null;
  }>;
  headline_rationale: string;
  stop_condition: string;
}
