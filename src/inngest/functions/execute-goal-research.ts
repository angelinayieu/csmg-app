/**
 * Execute-goal-research — handles `goal.research.requested` events.
 *
 * Emitted by:
 *   - `on-goal-created` (first-research kick after a goal is inserted)
 *   - `coordinator-tick` (5-min cron, top-K winners by priority)
 *   - `POST /api/coordinator/dispatch` (manual "research this goal now" from UI)
 *
 * Resolves the bound researcher agent (one per space × goal), wraps the work
 * with `runAsAgent` so it lands in `agent_runs` for the Intelligence Radar,
 * then invokes the research pipeline scoped to this goal.
 *
 * Concurrency:
 *   - 1 run per goal (serialize repeated nudges on the same goal)
 *   - 2 runs per space (cap per-user research cost)
 */

import { inngest } from "../client";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { runAsAgent } from "@/lib/agents/run-tracker";
import {
  runResearchForGoal,
  resolveInternalBaseUrl,
} from "@/lib/coordinator/run-research-for-goal";

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing for Inngest function");
  return createServiceClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function appendGoalResearchHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  goalId: string,
  entry: {
    last_research_at: string;
    last_run_id: string | null;
    findings_count: number;
    priority_score?: number | null;
    reason?: string | null;
  }
): Promise<void> {
  try {
    const { data: spaceRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (!spaceRow) return;

    const synth = (spaceRow.synthesis_data ?? {}) as Record<string, unknown>;
    const history = (synth.goal_research_history ?? {}) as Record<
      string,
      {
        last_research_at: string;
        last_run_id: string | null;
        total_runs: number;
        cumulative_findings: number;
        last_priority_score?: number | null;
        last_reason?: string | null;
      }
    >;

    const prev = history[goalId];
    history[goalId] = {
      last_research_at: entry.last_research_at,
      last_run_id: entry.last_run_id,
      total_runs: (prev?.total_runs ?? 0) + 1,
      cumulative_findings:
        (prev?.cumulative_findings ?? 0) + entry.findings_count,
      last_priority_score: entry.priority_score ?? null,
      last_reason: entry.reason ?? null,
    };

    await db
      .from("spaces")
      .update({
        synthesis_data: { ...synth, goal_research_history: history },
      })
      .eq("id", spaceId);
  } catch (err) {
    console.warn("[execute-goal-research] history append failed:", err);
  }
}

export const executeGoalResearch = inngest.createFunction(
  {
    id: "execute-goal-research",
    name: "Execute research for goal",
    retries: 1,
    concurrency: [
      { key: "event.data.goalId", limit: 1 },
      { key: "event.data.spaceId", limit: 2 },
    ],
    triggers: [{ event: "goal.research.requested" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const {
      goalId,
      spaceId,
      userId,
      reason,
      priority_score,
      goalTitle,
    } = event.data as {
      goalId: string;
      spaceId: string;
      userId: string;
      reason: "coordinator_tick" | "goal_created" | "manual";
      priority_score?: number;
      goalTitle?: string;
    };

    // Everything runs inside one step.run so a retry re-does the research
    // atomically (the inner runAsAgent handles partial-failure cleanup).
    const outcome = await step.run("run-bound-researcher", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = svc() as any;

      const baseUrl = resolveInternalBaseUrl();
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

      return await runAsAgent(
        db,
        {
          spaceId,
          userId,
          kind: "researcher",
          sourceGoalId: goalId,
          goalTitle,
          triggerEvent: "goal.research.requested",
          triggerData: { goalId, reason, priority_score },
        },
        async (runId) => {
          const res = await runResearchForGoal({
            db,
            goalId,
            spaceId,
            userId,
            reason,
            baseUrl,
            serviceRoleKey,
          });

          return {
            result: {
              findingsCount: res.findings.length,
              artifactsProduced: res.artifacts,
              entityIdsDiscovered: res.findings
                .filter((f) => f.kind === "external_entity")
                .map((f) => f.id),
              costCredits: res.credits,
            },
            value: { ...res, runId },
          };
        }
      );
    });

    // Always update goal_research_history, even for skipped runs — so the UI
    // can show "last attempted" regardless of outcome.
    await step.run("record-goal-research-history", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = svc() as any;
      await appendGoalResearchHistory(db, spaceId, goalId, {
        last_research_at: new Date().toISOString(),
        last_run_id: outcome.runId ?? null,
        findings_count: outcome.findings?.length ?? 0,
        priority_score: priority_score ?? null,
        reason: reason ?? null,
      });
    });

    return {
      goalId,
      spaceId,
      findings: outcome.findings?.length ?? 0,
      skipped: outcome.skipped ?? null,
    };
  }
);
