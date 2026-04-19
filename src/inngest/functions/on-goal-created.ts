/**
 * On-goal-created — spawns a bound researcher agent for a new improvement goal.
 *
 * Triggered by POST /api/goals after INSERT. Emits `goal.research.requested`
 * afterward so the new goal gets a first research pass immediately, instead of
 * waiting up to 5 minutes for the next coordinator tick.
 */

import { inngest } from "../client";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ensureAgent } from "@/lib/agents/run-tracker";

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing for Inngest function");
  return createServiceClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const onGoalCreated = inngest.createFunction(
  {
    id: "on-goal-created",
    name: "Spawn researcher for new goal",
    retries: 1,
    triggers: [{ event: "goal.created" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { goalId, spaceId, userId, goalTitle } = event.data as {
      goalId: string;
      spaceId: string;
      userId: string;
      goalTitle?: string;
    };

    // Step 1: ensure a bound researcher exists for this goal.
    await step.run("ensure-bound-researcher", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = svc() as any;
      const agentId = await ensureAgent(db, {
        spaceId,
        userId,
        kind: "researcher",
        sourceGoalId: goalId,
        goalTitle,
      });
      return { agentId };
    });

    // Step 2: dispatch a first-research event. Separate step.run so the
    // event-send is durable even if the ensureAgent call retries.
    await step.sendEvent("kick-first-research", {
      name: "goal.research.requested",
      data: {
        goalId,
        spaceId,
        userId,
        reason: "goal_created",
        goalTitle,
      },
    });
  }
);
