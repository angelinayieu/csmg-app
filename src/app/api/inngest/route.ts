import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  orchestrateAnalysis,
  onGoalCreated,
  coordinatorTick,
  executeGoalResearch,
} from "@/inngest/functions";

// Inngest functions can run for a long time. Vercel Pro caps a single
// function invocation at 800s (13m 20s) with Fluid Compute enabled —
// previously we had 900 which exceeded the cap and blocked deploys.
//
// This is not a problem in practice: Inngest steps checkpoint, so work
// longer than 800s is split across multiple invocations automatically.
// The only risk is a single synchronous step exceeding 800s, which we
// don't do — every long step already has internal sub-steps.
export const maxDuration = 800;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    orchestrateAnalysis,
    // Phase B: goal-agent binding + coordinator meta-agent
    onGoalCreated,
    coordinatorTick,
    executeGoalResearch,
  ],
});
