/**
 * Coordinator tick — the heart of Phase B.
 *
 * Fires every 5 minutes. Gathers every active goal across the whole system,
 * scores them by priority (deadline urgency × staleness × convergence ×
 * recency), and dispatches `goal.research.requested` events for the top-K
 * winners. Each dispatch is picked up by `execute-goal-research`, which calls
 * the bound researcher agent for that goal.
 *
 * Coexists with the Vercel `/api/cron/research-loop` fallback — when the
 * Coordinator is healthy, the fallback detects a recent coordinator tick and
 * skips its own run. If Inngest is misconfigured the fallback keeps research
 * flowing.
 */

import { inngest } from "../client";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { gatherGoalCandidates } from "@/lib/coordinator/candidates";
import { scoreAndRank } from "@/lib/coordinator/scoring";
import { runAsAgent } from "@/lib/agents/run-tracker";

/** Top-K goals dispatched per tick. */
const DISPATCH_LIMIT = 3;

/** Minimum score required to dispatch — prevents empty ticks from spamming. */
const SCORE_FLOOR = 15;

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing for Inngest function");
  return createServiceClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const coordinatorTick = inngest.createFunction(
  {
    id: "coordinator-tick",
    name: "Coordinator · prioritize goals",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    // Step 1: gather active goals + priority signals. Pure read.
    const candidates = await step.run("gather-active-goals", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = svc() as any;
      return await gatherGoalCandidates(db);
    });

    if (!candidates || candidates.length === 0) {
      return { dispatched: 0, reason: "no_active_goals" };
    }

    // Step 2: score + rank purely (deterministic; safe to re-run on retry).
    const ranked = scoreAndRank(candidates);
    const winners = ranked
      .filter((g) => g.score >= SCORE_FLOOR)
      .slice(0, DISPATCH_LIMIT);

    // Step 3: log a coordinator heartbeat as its own tracked agent run so the
    // Intelligence Radar shows "ORCHESTRATOR-Ω" as active. Records what was
    // ranked + what was dispatched into trigger_data for audit.
    if (winners.length > 0) {
      await step.run("log-coordinator-tick", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = svc() as any;
        // One heartbeat per affected space so the per-space Radar picks it up.
        const bySpace = new Map<string, { userId: string; dispatched: string[] }>();
        for (const w of winners) {
          const bucket = bySpace.get(w.spaceId) ?? {
            userId: w.userId,
            dispatched: [],
          };
          bucket.dispatched.push(w.goalId);
          bySpace.set(w.spaceId, bucket);
        }
        for (const [spaceId, bucket] of bySpace) {
          try {
            await runAsAgent(
              db,
              {
                spaceId,
                userId: bucket.userId,
                kind: "coordinator",
                triggerEvent: "coordinator.tick",
                triggerData: {
                  ranked_count: ranked.length,
                  dispatched_count: bucket.dispatched.length,
                  dispatched_goal_ids: bucket.dispatched,
                  top_score: winners[0]?.score ?? 0,
                },
              },
              async () => ({
                result: {
                  findingsCount: 0,
                  artifactsProduced: ["coordinator.dispatch"],
                  costCredits: 0,
                },
                value: null,
              })
            );
          } catch (err) {
            console.warn("[coordinator-tick] heartbeat failed:", err);
          }
        }
      });
    }

    // Step 4: dispatch research events for the winners. Each send is its own
    // step.run so retries don't re-dispatch winners we already sent.
    await Promise.all(
      winners.map((g, i) =>
        step.sendEvent(`dispatch-${i}`, {
          name: "goal.research.requested",
          data: {
            goalId: g.goalId,
            spaceId: g.spaceId,
            userId: g.userId,
            reason: "coordinator_tick",
            priority_score: g.score,
            goalTitle: g.goalTitle,
          },
        })
      )
    );

    return {
      dispatched: winners.length,
      ranked: ranked.length,
      top_score: winners[0]?.score ?? 0,
    };
  }
);
