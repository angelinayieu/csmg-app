// ── Insight Lab — pipeline orchestrator ───────────────────────────────
//
// Wraps the stack executor + scorer with the persistence + event-bus
// integration the lab UI subscribes to. Soft-fails individual side-
// effects (event emit, score persist) so a partial outage doesn't
// abort the whole run, but rethrows on the experiment-row write
// failure since there's no row to update at that point.
//
// Flow (matches Card 09 in the spec deck):
//   POST /api/lab/insight-stacks { spaceId, stackConfig }
//     → startPipelineRun(pipeline: "insight_lab")
//     → INSERT lab_experiments (status: running)
//     → runStack with streaming callbacks:
//         · onStepStart   → emit lab_step_started
//         · onInsightBatch → emitBatchEvents(lab_insight_emitted[])
//     → scoreGoalMatch
//     → INSERT lab_insights (with per-insight scores)
//     → UPDATE lab_experiments (status: completed, scores, step_results)
//     → emit lab_score_recorded
//     → completePipelineRun

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  startPipelineRun,
  emitStructuralEvent,
  emitBatchEvents,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import type { LabInsightEmittedEvent } from "@/types/pipeline-events";
import { runStack } from "./executor";
import { scoreGoalMatch, type ScoreResult } from "./scoring/goal-match";
import type { Insight, SpaceCtx, StackConfig } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface RunLabPipelineOpts {
  db: AnyDb;
  ctx: SpaceCtx;
  stack: StackConfig;
  userId: string;
}

export interface RunLabPipelineResult {
  /** pipeline_runs.id — null when the run row couldn't be created
   *  (event bus unavailable). The experiment still ran and persisted. */
  runId: string | null;
  /** lab_experiments.id — always set on success. */
  experimentId: string;
  /** Number of insights the stack emitted across all steps. */
  insightCount: number;
  /** Aggregate + per-insight scores by axis. The client uses
   *  `goal_match.perInsight[insightKey]` to render score chips
   *  without a separate GET. v0 ships goal_match only. */
  scores: {
    goal_match: {
      stackAvg: number;
      perInsight: Record<string, number>;
    };
  };
}

export async function runLabPipeline(
  opts: RunLabPipelineOpts,
): Promise<RunLabPipelineResult> {
  const { db, ctx, stack, userId } = opts;

  // 1. Open pipeline run for SSE subscription. Soft-fails to null;
  //    the experiment still runs and persists, just without a stream.
  const runId = await startPipelineRun(db, {
    spaceId: ctx.space.id,
    userId,
    pipeline: "insight_lab",
    initialPrompt: stack.name,
  });

  // 2. Open lab_experiments row. Hard-fails if this can't write —
  //    nothing to attach insights or scores to otherwise.
  const { data: expRow, error: expErr } = await db
    .from("lab_experiments")
    .insert({
      space_id: ctx.space.id,
      pipeline_run_id: runId,
      stack_config: stack,
      created_by: userId,
      status: "running",
    })
    .select("id")
    .single();

  if (expErr || !expRow) {
    if (runId) {
      await completePipelineRun(
        db,
        runId,
        "failed",
        `lab_experiments insert failed: ${expErr?.message ?? "unknown"}`,
      );
    }
    throw new Error(
      `Failed to create lab_experiments row: ${expErr?.message ?? "unknown"}`,
    );
  }

  const experimentId = (expRow as { id: string }).id;

  try {
    // 3. Run stack with streaming callbacks → events flow through bus.
    const result = await runStack(ctx, stack, {
      onStepStart: async ({ stepIdx, algoId, algoName }) => {
        await emitStructuralEvent(db, runId, {
          type: "lab_step_started",
          experimentId,
          stepIdx,
          algoId,
          algoName,
        });
      },
      onInsightBatch: async ({ stepIdx, algoId, insights }) => {
        const events: LabInsightEmittedEvent[] = insights.map((i) => ({
          type: "lab_insight_emitted",
          experimentId,
          insightKey: i.id,
          kind: i.kind,
          summary: i.summary,
          entityIds: i.entityIds,
          algoId,
          stepIdx,
        }));
        await emitBatchEvents(db, runId, events);
      },
    });

    // 4. Score. Soft-fails internally — returns zeros if embedding
    //    API errors. Doesn't abort the run.
    const goalMatchResult = await scoreGoalMatch(result.insights, ctx.space);

    // 5. Persist insights with per-insight scores.
    if (result.insights.length > 0) {
      await persistInsights(db, experimentId, result.insights, goalMatchResult);
    }

    // 6. Update experiment row with aggregate scores + step results.
    await db
      .from("lab_experiments")
      .update({
        scores: {
          goal_match: {
            stackAvg: goalMatchResult.stackAvg,
            perInsight: goalMatchResult.perInsight,
          },
        },
        step_results: result.stepResults,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", experimentId);

    // 7. Emit final score event so the UI stops waiting on this axis.
    await emitStructuralEvent(db, runId, {
      type: "lab_score_recorded",
      experimentId,
      axis: "goal_match",
      stackAvg: goalMatchResult.stackAvg,
      insightCount: result.insights.length,
    });

    // 8. Close out the pipeline run.
    await completePipelineRun(db, runId, "completed");

    return {
      runId,
      experimentId,
      insightCount: result.insights.length,
      scores: {
        goal_match: {
          stackAvg: goalMatchResult.stackAvg,
          perInsight: goalMatchResult.perInsight,
        },
      },
    };
  } catch (err) {
    // Mark experiment failed; don't throw from this branch's cleanup
    // path so the original error surfaces to the caller.
    try {
      await db
        .from("lab_experiments")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", experimentId);
    } catch (cleanupErr) {
      console.warn(
        "[insight-lab/pipeline] failed-state update threw:",
        cleanupErr,
      );
    }
    if (runId) {
      await completePipelineRun(
        db,
        runId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }
}

async function persistInsights(
  db: AnyDb,
  experimentId: string,
  insights: Insight[],
  goalMatch: ScoreResult,
): Promise<void> {
  const rows = insights.map((i) => ({
    experiment_id: experimentId,
    insight_key: i.id,
    kind: i.kind,
    summary: i.summary,
    entity_ids: i.entityIds,
    detail: i.detail ?? {},
    provenance: i.provenance,
    scores: { goal_match: goalMatch.perInsight[i.id] ?? 0 },
  }));

  // Upsert on (experiment_id, insight_key) so re-runs of the same stack
  // against an unchanged graph idempotently update rather than dupe.
  const { error } = await db
    .from("lab_insights")
    .upsert(rows, { onConflict: "experiment_id,insight_key" });

  if (error) {
    console.warn(
      "[insight-lab/pipeline] lab_insights upsert failed:",
      error.message,
    );
  }
}
