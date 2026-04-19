import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  orchestrateAnalysis,
  onGoalCreated,
  coordinatorTick,
  executeGoalResearch,
} from "@/inngest/functions";

// Inngest functions can run for a long time (up to 15 min for comprehensive tier)
export const maxDuration = 900;

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
