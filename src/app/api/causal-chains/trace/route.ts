import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  detectMissingBaselines,
  buildBaselineQuestionPrompt,
  buildEffectTracePrompt,
} from "@/lib/causal-chains/effect-propagator";
import { loadChainEvidenceBundles } from "@/lib/causal-chains/evidence-bundles";
import {
  validateEvidenceCitations,
  buildRetryPrompt,
} from "@/lib/causal-chains/validate-trace-evidence";
import { ENABLE_EVIDENCE_AWARE_TRACE } from "@/lib/feature-flags/subsystems";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type {
  CausalChain,
  BaselineQuestion,
  CalculationTrace,
  EffectPropagatorResponse,
  TraceStep,
} from "@/types/causal-chains";

export const maxDuration = 180;

/**
 * POST /api/causal-chains/trace
 *
 * Body: { spaceId, chainId, answers?: BaselineQuestion[] }
 *
 * Two-phase flow:
 *   1. If baselines missing and no answers provided → returns status "needs_baseline"
 *      with questions the UI renders.
 *   2. If baselines present or answers provided → returns status "completed"
 *      with a full CalculationTrace.
 */
export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const parsed = await safeJsonParse<{
    spaceId?: string;
    chainId?: string;
    answers?: BaselineQuestion[];
  }>(request);
  if (parsed.error) return parsed.error;
  const { spaceId, chainId, answers } = parsed.data ?? {};
  if (!spaceId || !chainId) {
    return NextResponse.json(
      { error: "spaceId and chainId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check + load space
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, name, description, synthesis_data")
    .eq("id", spaceId)
    .single();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const synthData =
    typeof spaceRow.synthesis_data === "string"
      ? (JSON.parse(spaceRow.synthesis_data) as SynthesisData)
      : (spaceRow.synthesis_data as SynthesisData | null);

  const chains = synthData?.causal_chains ?? [];
  const chain = chains.find((c) => c.id === chainId);
  if (!chain) {
    return NextResponse.json(
      { error: "Chain not found — run /api/causal-chains/generate first" },
      { status: 404 },
    );
  }

  // Active goal
  const { data: goalRow } = await db
    .from("improvement_goals")
    .select("*")
    .eq("space_id", spaceId)
    .eq("status", "active")
    .is("parent_goal_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const goal: ImprovementGoal | null = (goalRow ?? null) as ImprovementGoal | null;

  // Pull saved prior answers (merged with incoming `answers`)
  const priorQuestions = synthData?.baseline_questions?.[chainId] ?? [];
  const mergedAnswers: BaselineQuestion[] = [
    ...priorQuestions.filter(
      (q) =>
        q.answer !== undefined &&
        q.answer !== null &&
        !(answers ?? []).some((a) => a.id === q.id),
    ),
    ...(answers ?? []),
  ];

  const evidenceBundles = ENABLE_EVIDENCE_AWARE_TRACE
    ? await loadChainEvidenceBundles(db, spaceId, chain).catch((err) => {
        console.warn("[trace] evidence bundle load failed (soft-fail):", err);
        return null;
      })
    : null;

  const propagatorInput = {
    chain,
    goal,
    synthesisData: synthData,
    answeredQuestions: mergedAnswers,
    spaceName: spaceRow.name,
    spaceDescription: spaceRow.description,
    evidenceBundles,
  };

  try {
    // Phase 1: Check if we need baselines
    const missing = detectMissingBaselines(propagatorInput);

    if (missing.length > 0 && mergedAnswers.length === 0) {
      // Generate baseline questions
      const { system, user: userPrompt } = buildBaselineQuestionPrompt(
        propagatorInput,
        missing,
      );
      const qResult = await llmJSON<{ questions: BaselineQuestion[] }>({
        system,
        user: userPrompt,
        temperature: 0.2,
        maxTokens: 2048,
      });

      const questions = (qResult?.questions ?? []).map((q) => ({
        ...q,
        chain_id: chainId,
      }));

      // Persist questions so the UI can reload later
      await mergeSynthData(db, spaceId, (sd) => ({
        ...sd,
        baseline_questions: {
          ...(sd.baseline_questions ?? {}),
          [chainId]: questions,
        },
      }));

      const response: EffectPropagatorResponse = {
        status: "needs_baseline",
        chain_id: chainId,
        questions,
      };
      return NextResponse.json(response);
    }

    // Phase 2: Run full trace
    const { system, user: userPrompt } = buildEffectTracePrompt(propagatorInput);
    type LLMTrace = Omit<CalculationTrace, "id" | "chain_id" | "generated_at" | "agent_name"> & {
      steps: TraceStep[];
    };
    let traceRaw = await llmJSON<LLMTrace>({
      system,
      user: userPrompt,
      temperature: 0.3,
      maxTokens: 6000,
    });

    // Evidence-aware retry: if any "research" step lacks valid citations from
    // the supplied bundle, retry once with explicit violation callouts. Skip
    // when bundles are empty (no evidence available — nothing to cite).
    if (
      ENABLE_EVIDENCE_AWARE_TRACE &&
      evidenceBundles &&
      evidenceBundles.bundles.length > 0
    ) {
      const violations = validateEvidenceCitations(
        traceRaw.steps ?? [],
        evidenceBundles,
      );
      if (violations.length > 0) {
        console.log(
          `[trace] ${violations.length} evidence citation violation(s), retrying once`,
        );
        const retryUser = buildRetryPrompt(userPrompt, violations);
        traceRaw = await llmJSON<LLMTrace>({
          system,
          user: retryUser,
          temperature: 0.2,
          maxTokens: 6000,
        });
      }
    }

    const trace: CalculationTrace = {
      id: `trace-${chainId}-${Date.now()}`,
      chain_id: chainId,
      generated_at: new Date().toISOString(),
      agent_name: "ATLAS-04",
      method_label: traceRaw.method_label ?? "Bayesian effect propagation v3.2",
      final_value: traceRaw.final_value,
      final_display: traceRaw.final_display,
      final_unit: traceRaw.final_unit,
      ci_lower: traceRaw.ci_lower,
      ci_upper: traceRaw.ci_upper,
      confidence: traceRaw.confidence,
      steps: traceRaw.steps ?? [],
      formula_compact: traceRaw.formula_compact,
      sensitivity: traceRaw.sensitivity ?? [],
      alternatives_considered: traceRaw.alternatives_considered ?? [],
      narrative: traceRaw.narrative ?? "",
      missing_inputs: traceRaw.missing_inputs ?? [],
      baseline_source: traceRaw.baseline_source ?? "llm_estimated",
    };

    // Update chain + persist trace
    await mergeSynthData(db, spaceId, (sd) => {
      const updatedChains = (sd.causal_chains ?? []).map((c) =>
        c.id === chainId
          ? {
              ...c,
              calculation_trace_id: trace.id,
              needs_baseline: false,
              // Update outcome stage with real measured result
              stages: (c.stages.length === 6
                ? [
                    c.stages[0],
                    c.stages[1],
                    c.stages[2],
                    c.stages[3],
                    {
                      ...c.stages[4],
                      title: `${trace.final_display}${trace.final_unit}`,
                      meta: "computed outcome",
                      value_label: trace.final_display + trace.final_unit,
                    },
                    c.stages[5],
                  ]
                : c.stages) as CausalChain["stages"],
              goal_contribution_pct:
                Math.abs(trace.final_value) > 0
                  ? Math.abs(trace.final_value)
                  : c.goal_contribution_pct,
            }
          : c,
      );

      return {
        ...sd,
        causal_chains: updatedChains,
        calculation_traces: {
          ...(sd.calculation_traces ?? {}),
          [chainId]: trace,
        },
      };
    });

    const response: EffectPropagatorResponse = {
      status: "completed",
      chain_id: chainId,
      trace,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("[causal-chains/trace] failed:", err);
    return NextResponse.json(
      { error: `Trace generation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mergeSynthData(
  db: any,
  spaceId: string,
  mutator: (sd: SynthesisData) => SynthesisData,
) {
  const { data: fresh } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .single();
  const freshSynth =
    typeof fresh?.synthesis_data === "string"
      ? JSON.parse(fresh.synthesis_data)
      : (fresh?.synthesis_data ?? {});
  const merged = mutator(freshSynth as SynthesisData);
  await db.from("spaces").update({ synthesis_data: merged }).eq("id", spaceId);
}
