// ── Insight Lab — stack executor ──────────────────────────────────────
//
// Runs an ordered list of algorithm steps over a SpaceCtx and returns
// the merged Insight[] with per-step timing and any errors. Soft-fails
// per step — a broken algorithm (or one that throws on a degenerate
// input) doesn't abort the rest of the stack.
//
// v0 runs steps independently (no inter-step data passing). v1+ may
// add piping (e.g., "feed step A's hubs into step B as seeds") via a
// step-output context the executor threads through.

import { getAlgo } from "./registry";
import type {
  AlgoId,
  Insight,
  SpaceCtx,
  StackConfig,
  StackResult,
  StepResult,
} from "./types";

/** Optional streaming callbacks. Each fires at the corresponding point
 *  in the run; awaited so emit-to-DB or other side effects complete
 *  before the next step proceeds (preserves event ordering). Soft-fail
 *  is each callback's responsibility — throwing aborts the run. */
export interface RunStackOpts {
  onStepStart?: (info: {
    stepIdx: number;
    algoId: AlgoId;
    algoName: string;
  }) => Promise<void> | void;
  onStepComplete?: (result: StepResult) => Promise<void> | void;
  /** Batched per step rather than per insight — lets the orchestrator
   *  use `emitBatchEvents` instead of N sequential `emitStructuralEvent`
   *  round-trips. Empty batches (a step that emitted nothing) skip the
   *  callback entirely. */
  onInsightBatch?: (info: {
    stepIdx: number;
    algoId: AlgoId;
    insights: Insight[];
  }) => Promise<void> | void;
}

export async function runStack(
  ctx: SpaceCtx,
  stack: StackConfig,
  opts: RunStackOpts = {},
): Promise<StackResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const allInsights: Insight[] = [];
  const stepResults: StepResult[] = [];

  for (let stepIdx = 0; stepIdx < stack.steps.length; stepIdx++) {
    const step = stack.steps[stepIdx];
    const algo = getAlgo(step.algoId);

    if (!algo) {
      const result: StepResult = {
        stepIdx,
        algoId: step.algoId,
        insightCount: 0,
        durationMs: 0,
        error: `Unknown algorithm id: ${step.algoId}`,
      };
      stepResults.push(result);
      if (opts.onStepComplete) await opts.onStepComplete(result);
      continue;
    }

    if (opts.onStepStart) {
      await opts.onStepStart({
        stepIdx,
        algoId: step.algoId,
        algoName: algo.name,
      });
    }

    const stepStart = Date.now();

    try {
      const params = { ...algo.defaultParams, ...(step.params ?? {}) };
      const input = algo.adapter(ctx);
      const output = await algo.run(input, params);
      const insights = algo.toInsights(output, ctx, stepIdx);

      allInsights.push(...insights);
      const result: StepResult = {
        stepIdx,
        algoId: step.algoId,
        insightCount: insights.length,
        durationMs: Date.now() - stepStart,
      };
      stepResults.push(result);

      if (insights.length > 0 && opts.onInsightBatch) {
        await opts.onInsightBatch({
          stepIdx,
          algoId: step.algoId,
          insights,
        });
      }
      if (opts.onStepComplete) await opts.onStepComplete(result);
    } catch (err) {
      const result: StepResult = {
        stepIdx,
        algoId: step.algoId,
        insightCount: 0,
        durationMs: Date.now() - stepStart,
        error: err instanceof Error ? err.message : String(err),
      };
      stepResults.push(result);
      if (opts.onStepComplete) await opts.onStepComplete(result);
    }
  }

  const completedAt = new Date().toISOString();

  return {
    stackId: stack.id,
    spaceId: ctx.space.id,
    insights: allInsights,
    stepResults,
    startedAt,
    completedAt,
    durationMs: Date.now() - startTime,
  };
}

// ── Built-in stacks ────────────────────────────────────────────────────

/** The baseline lab always compares against. Mirrors what's already on
 *  the canvas via the Preliminary Insights panel. */
export const DEFAULT_BASELINE_STACK: StackConfig = {
  id: "baseline",
  name: "Baseline · preliminary insights",
  description:
    "The default topology pass — hubs, bridges, isolated clusters, feedback loops. What the canvas surfaces today.",
  steps: [{ algoId: "preliminary-insights" }],
};
