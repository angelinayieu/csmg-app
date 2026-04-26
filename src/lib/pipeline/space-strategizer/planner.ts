// ── LLM planner — calls the strategizer model, validates output ───────
//
// The planner is thin by design. All intelligence lives in the PROMPT
// (rigor framing) and in the POST-VALIDATION (invariant enforcement).
// This file just orchestrates: call LLM, parse, enforce invariants,
// optionally retry once on invariant failure.
//
// Retry policy: ONE retry on invariant failure, with a pointed error
// message that tells the model exactly which invariant it broke. Two
// retries is overkill — if the model can't respect budget constraints
// twice, the real problem is upstream (bad shortlist, wrong budget).

import { llmJSON } from "@/lib/llm";
import type {
  CandidateScore,
  SelectedWorkItem,
  SkipReason,
  SpacePlan,
  SpacePlanRequest,
} from "@/types/space-plan";
import type { SignalProfile, SpaceWorkKind } from "@/types/space-plan";
import {
  STRATEGIZER_RESPONSE_SCHEMA,
  STRATEGIZER_SYSTEM_PROMPT,
  StrategizerLLMOutput,
  buildStrategizerUserPrompt,
} from "./prompt";

const VALID_KINDS: SpaceWorkKind[] = [
  "axis",
  "edge_space",
  "convergent_point",
  "signature_deepen",
  "intersection_probe",
  "intervention_combination",
];

const VALID_SKIP_REASONS = [
  "out_of_budget",
  "redundant_with_selected",
  "goal_misaligned",
  "low_expected_yield",
  "awaiting_upstream",
  "insufficient_evidence",
  "manifold_collision",
] as const;

const VALID_INSIGHT_TYPES = [
  "leverage_point",
  "mechanism_clarity",
  "intervention_target",
  "risk_disclosure",
  "cross_domain_bridge",
  "uncertainty_reduction",
  "goal_alignment",
] as const;

export interface PlannerContext {
  request: SpacePlanRequest;
  shortlist: CandidateScore[];
  intake_summary: string;
  goal_statements: Array<{ id: string; metric: string; target: string | number | null }>;
  existing_selection_summary: string | null;
  recent_calibration_note: string | null;
}

export interface InvariantViolation {
  name: string;
  detail: string;
}

// ── Invariant checks ─────────────────────────────────────────────────
//
// Run BEFORE the plan is persisted. Every violation is returned; the
// caller decides whether to retry with feedback or reject outright.
// We check invariants the schema CAN'T: budget sum, orphan candidates,
// diversity, dominated_by pointing to real selected item, allocated
// tokens within the est_tokens envelope.

export function checkInvariants(
  output: StrategizerLLMOutput,
  ctx: PlannerContext,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // 1. Budget
  const totalAlloc = output.selected.reduce((sum, s) => sum + s.allocated_tokens, 0);
  if (totalAlloc > ctx.request.budget_tokens) {
    violations.push({
      name: "budget_exceeded",
      detail: `sum(allocated_tokens)=${totalAlloc} > budget_tokens=${ctx.request.budget_tokens}`,
    });
  }

  // 2. max_items
  const maxItems = ctx.request.max_items ?? 8;
  if (output.selected.length > maxItems) {
    violations.push({
      name: "too_many_items",
      detail: `selected.length=${output.selected.length} > max_items=${maxItems}`,
    });
  }

  // 3. No-orphans: every shortlist id appears exactly once in selected∪skipped
  const shortlistIds = new Set(ctx.shortlist.map((s) => s.candidate_id));
  const selectedIds = new Set(output.selected.map((s) => s.candidate_id));
  const skippedIds = new Set(output.skipped.map((s) => s.candidate_id));
  for (const id of shortlistIds) {
    const inSel = selectedIds.has(id);
    const inSkip = skippedIds.has(id);
    if (inSel && inSkip) {
      violations.push({ name: "candidate_in_both", detail: `${id} in both selected and skipped` });
    }
    if (!inSel && !inSkip) {
      violations.push({ name: "orphan_candidate", detail: `${id} not in selected or skipped` });
    }
  }
  for (const id of selectedIds) {
    if (!shortlistIds.has(id)) {
      violations.push({ name: "unknown_selection", detail: `${id} not in shortlist` });
    }
  }
  for (const id of skippedIds) {
    if (!shortlistIds.has(id)) {
      violations.push({ name: "unknown_skip", detail: `${id} not in shortlist` });
    }
  }

  // 4. Kind diversity (only if we have candidates of multiple kinds to pick from)
  const minDiversity = ctx.request.min_kind_diversity ?? 2;
  const shortlistKinds = new Set(ctx.shortlist.map((c) => c.kind));
  const selectedKinds = new Set(output.selected.map((s) => s.kind as SpaceWorkKind));
  if (shortlistKinds.size >= minDiversity && selectedKinds.size < minDiversity && output.selected.length > 0) {
    violations.push({
      name: "diversity_below_minimum",
      detail: `selected covers ${selectedKinds.size} kinds, min ${minDiversity}, shortlist had ${shortlistKinds.size}`,
    });
  }

  // 5. Dominated-by validity
  for (const s of output.skipped) {
    if (s.reason === "redundant_with_selected") {
      if (!s.dominated_by) {
        violations.push({
          name: "redundancy_missing_dominator",
          detail: `skip ${s.candidate_id} has reason=redundant_with_selected but dominated_by=null`,
        });
      } else if (!selectedIds.has(s.dominated_by)) {
        violations.push({
          name: "redundancy_dominator_not_selected",
          detail: `skip ${s.candidate_id} dominated_by=${s.dominated_by} which isn't in selected`,
        });
      }
    }
  }

  // 6. Allocation within est_tokens envelope
  const scoreMap = new Map(ctx.shortlist.map((c) => [c.candidate_id, c]));
  for (const s of output.selected) {
    const cand = scoreMap.get(s.candidate_id);
    if (!cand) continue; // already caught as unknown_selection
    const min = Math.floor(cand.est_tokens * 0.6);
    const max = Math.ceil(cand.est_tokens * 1.5);
    if (s.allocated_tokens < min || s.allocated_tokens > max) {
      violations.push({
        name: "allocation_out_of_envelope",
        detail: `${s.candidate_id}: allocated=${s.allocated_tokens} not in [${min}, ${max}] (est=${cand.est_tokens})`,
      });
    }
  }

  // 7. Enum sanity (schema mostly covers this, but type-system belt-and-braces)
  for (const s of output.selected) {
    if (!VALID_KINDS.includes(s.kind as SpaceWorkKind)) {
      violations.push({ name: "invalid_kind", detail: `selected ${s.candidate_id}: ${s.kind}` });
    }
    if (!VALID_INSIGHT_TYPES.includes(s.expected_insight_type as typeof VALID_INSIGHT_TYPES[number])) {
      violations.push({ name: "invalid_insight_type", detail: `selected ${s.candidate_id}: ${s.expected_insight_type}` });
    }
  }
  for (const s of output.skipped) {
    if (!VALID_SKIP_REASONS.includes(s.reason as typeof VALID_SKIP_REASONS[number])) {
      violations.push({ name: "invalid_skip_reason", detail: `skipped ${s.candidate_id}: ${s.reason}` });
    }
  }

  // 8. Selection reason content check — must cite a signal name OR use the explicit overrule phrasing
  const SIGNAL_NAMES = [
    "centrality",
    "goal_proximity",
    "intersection_density",
    "uncertainty",
    "layer_crossing",
    "coverage_gap",
    "novelty",
    "axis_calibration",
    "controllability_spread",
  ];
  for (const s of output.selected) {
    const lower = s.selection_reason.toLowerCase();
    const citesSignal = SIGNAL_NAMES.some((n) => lower.includes(n));
    const overrules = lower.includes("overrul") || lower.includes("override");
    const wordCount = s.selection_reason.split(/\s+/).length;
    if (wordCount < 12) {
      violations.push({
        name: "reason_too_short",
        detail: `${s.candidate_id}: selection_reason has ${wordCount} words (min 12)`,
      });
    }
    if (!citesSignal && !overrules) {
      violations.push({
        name: "reason_no_signal_citation",
        detail: `${s.candidate_id}: selection_reason must cite a signal name or explicitly overrule one`,
      });
    }
  }

  return violations;
}

// ── Callback: convert LLM output + ranker context into a SpacePlan ───
//
// Only called after invariants pass. Joins the selected items back to
// their signals + scores (from the shortlist), computes diversity
// profile + budget_headroom, and assembles the final plan document.

export function assembleSpacePlan(
  output: StrategizerLLMOutput,
  ctx: PlannerContext,
  candidates_considered: CandidateScore[],
  weights_used: Record<keyof SignalProfile, number>,
  meta: {
    plan_id: string;
    space_id: string;
    run_id: string | null;
    planner_model: string;
    planner_temperature: number;
    horizon_context?: SpacePlan["horizon_context"];
  },
): SpacePlan {
  const scoreMap = new Map(ctx.shortlist.map((c) => [c.candidate_id, c]));

  const selected: SelectedWorkItem[] = output.selected.map((s) => {
    const cand = scoreMap.get(s.candidate_id);
    if (!cand) {
      throw new Error(`assembleSpacePlan: ${s.candidate_id} missing from shortlist after validation`);
    }
    return {
      candidate_id: s.candidate_id,
      kind: s.kind as SpaceWorkKind,
      selection_reason: s.selection_reason,
      expected_insight_type: s.expected_insight_type as SelectedWorkItem["expected_insight_type"],
      target_resolution: s.target_resolution,
      allocated_tokens: s.allocated_tokens,
      signals: cand.signals,
      score: cand.score,
    };
  });

  const skipped: SkipReason[] = output.skipped.map((s) => {
    const cand = scoreMap.get(s.candidate_id);
    return {
      candidate_id: s.candidate_id,
      kind: s.kind as SpaceWorkKind,
      score: cand?.score ?? 0,
      reason: s.reason as SkipReason["reason"],
      rationale: s.rationale,
      dominated_by: s.dominated_by ?? undefined,
    };
  });

  // Diversity profile
  const by_kind: Partial<Record<SpaceWorkKind, number>> = {};
  for (const s of selected) {
    by_kind[s.kind] = (by_kind[s.kind] ?? 0) + 1;
  }
  const by_expected_insight_type: Record<string, number> = {};
  for (const s of selected) {
    by_expected_insight_type[s.expected_insight_type] =
      (by_expected_insight_type[s.expected_insight_type] ?? 0) + 1;
  }
  // controllability_spread across selected = mean of their signal values, null-safe
  const spreadValues = selected
    .map((s) => s.signals.controllability_spread)
    .filter((v): v is number => v !== null);
  const controllability_spread =
    spreadValues.length > 0 ? spreadValues.reduce((a, b) => a + b, 0) / spreadValues.length : 0;

  const budget_headroom =
    ctx.request.budget_tokens - selected.reduce((sum, s) => sum + s.allocated_tokens, 0);

  return {
    id: meta.plan_id,
    space_id: meta.space_id,
    run_id: meta.run_id,
    generated_at: new Date().toISOString(),
    budget_tokens: ctx.request.budget_tokens,
    budget_headroom,
    selected,
    skipped,
    candidates_considered,
    diversity_profile: {
      by_kind,
      by_expected_insight_type,
      controllability_spread,
    },
    headline_rationale: output.headline_rationale,
    stop_condition: output.stop_condition,
    ranker_weights_snapshot: weights_used,
    planner_model: meta.planner_model,
    planner_temperature: meta.planner_temperature,
    horizon_context: meta.horizon_context,
  };
}

// ── Main entry: call LLM, validate, retry once on invariant failure ───

export interface PlannerCallOutput {
  output: StrategizerLLMOutput;
  violations: InvariantViolation[];
  retried: boolean;
  model: string;
  temperature: number;
}

export async function callStrategizerLLM(ctx: PlannerContext): Promise<PlannerCallOutput> {
  const model = "gpt-4o";
  const temperature = 0.15; // low — we want deterministic, rule-following selection

  const userPrompt = buildStrategizerUserPrompt({
    shortlist: ctx.shortlist,
    request: ctx.request,
    intake_summary: ctx.intake_summary,
    goal_statements: ctx.goal_statements,
    existing_selection_summary: ctx.existing_selection_summary,
    recent_calibration_note: ctx.recent_calibration_note,
  });

  const first = await llmJSON<StrategizerLLMOutput>({
    system: STRATEGIZER_SYSTEM_PROMPT,
    user: userPrompt,
    model,
    temperature,
    maxTokens: 3500,
    responseSchema: STRATEGIZER_RESPONSE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
  });

  const firstViolations = checkInvariants(first, ctx);
  if (firstViolations.length === 0) {
    return { output: first, violations: [], retried: false, model, temperature };
  }

  // Retry once with a pointed error message
  const violationSummary = firstViolations
    .map((v) => `  - ${v.name}: ${v.detail}`)
    .join("\n");
  const retryPrompt = `${userPrompt}

YOUR PREVIOUS RESPONSE BROKE THE FOLLOWING INVARIANTS:
${violationSummary}

Produce a new plan that fixes every violation. Do NOT make unrelated changes to candidates that were correct.`;

  const second = await llmJSON<StrategizerLLMOutput>({
    system: STRATEGIZER_SYSTEM_PROMPT,
    user: retryPrompt,
    model,
    temperature: 0.05,
    maxTokens: 3500,
    responseSchema: STRATEGIZER_RESPONSE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
  });

  const secondViolations = checkInvariants(second, ctx);
  return {
    output: secondViolations.length === 0 ? second : first, // keep the first if retry still broken — at least we know the surface
    violations: secondViolations,
    retried: true,
    model,
    temperature,
  };
}
