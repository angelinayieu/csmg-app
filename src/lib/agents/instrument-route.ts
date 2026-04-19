/**
 * Lightweight agent-run instrumentation for non-Inngest API routes.
 *
 * Usage:
 *   const agent = await beginRouteAgent(db, { spaceId, userId, kind, triggerEvent });
 *   try {
 *     // ... do work ...
 *     await agent.complete({ findingsCount, artifacts: ["synthesis"] });
 *     return NextResponse.json({ success: true });
 *   } catch (err) {
 *     await agent.fail(err instanceof Error ? err.message : String(err));
 *     throw err;
 *   }
 *
 * All methods are non-throwing — tracking failures never break the caller.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { startAgentRun, completeAgentRun, failAgentRun } from "./run-tracker";
import type { AgentKind } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export interface RouteAgentHandle {
  runId: string | null;
  complete: (result?: {
    findingsCount?: number;
    artifacts?: string[];
    entityIdsDiscovered?: string[];
    costCredits?: number;
  }) => Promise<void>;
  fail: (errorMessage: string) => Promise<void>;
  heartbeat: () => Promise<void>;
}

export async function beginRouteAgent(
  db: Db,
  opts: {
    spaceId: string;
    userId: string;
    kind: AgentKind;
    triggerEvent: string;
    triggerData?: Record<string, unknown>;
    sourceGoalId?: string | null;
    sourceObjectiveId?: string | null;
  }
): Promise<RouteAgentHandle> {
  const runId = await startAgentRun(db, {
    spaceId: opts.spaceId,
    userId: opts.userId,
    kind: opts.kind,
    triggerEvent: opts.triggerEvent,
    triggerData: opts.triggerData,
    sourceGoalId: opts.sourceGoalId,
    sourceObjectiveId: opts.sourceObjectiveId,
  });

  return {
    runId,
    complete: async (result = {}) => {
      await completeAgentRun(db, runId, {
        findingsCount: result.findingsCount,
        artifactsProduced: result.artifacts,
        entityIdsDiscovered: result.entityIdsDiscovered,
        costCredits: result.costCredits,
      });
    },
    fail: async (msg: string) => {
      await failAgentRun(db, runId, msg);
    },
    heartbeat: async () => {
      if (!runId) return;
      try {
        await db
          .from("agent_runs")
          .update({ heartbeat_at: new Date().toISOString() })
          .eq("id", runId);
      } catch {
        /* non-critical */
      }
    },
  };
}
