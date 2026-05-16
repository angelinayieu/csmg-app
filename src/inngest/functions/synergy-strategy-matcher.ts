/**
 * Synergy strategy matcher — Inngest event consumer
 *
 * Triggered by "synergy/strategy.generated" (fired from the strategy
 * generate route once a strategy + its plan_step blocks are persisted).
 *
 * Pipeline:
 *   Step 1 — embed the strategy (text-embedding-3-small over
 *            statement + pitch + plan_steps). Persists vector to
 *            synergy_strategies.embedding.
 *   Step 2 — run the matcher against the cross-user pool (kNN +
 *            LLM rerank → strategy_matches rows).
 *   Step 3 — divergence sweep over the strategy's active parallel-
 *            path rooms (Phase 5 polish). For each room: read the
 *            canonical strategy_matches row; if final_score < 50 OR
 *            the row is missing, set synergy_rooms.diverged_at +
 *            clear divergence_dismissed_at (banner re-surfaces). If
 *            the score is healthy, clear any prior diverged_at.
 *
 * Each step is an Inngest checkpoint, so a transient failure in the
 * matcher doesn't lose the embedding work. Retries are per-step.
 *
 * Soft-fail discipline: throws ARE retried (transient errors), but the
 * matcher itself swallows per-batch LLM failures so a single bad
 * candidate doesn't kill the whole run.
 */

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase/service";
import { embedStrategy } from "@/lib/synergy/strategy-embed";
import {
  loadStrategySource,
  matchOneStrategy,
} from "@/lib/synergy/strategy-matcher";

export const synergyStrategyMatcher = inngest.createFunction(
  {
    id: "synergy-strategy-matcher",
    name: "Synergy · embed + match strategy after generation",
    retries: 2,
    triggers: [{ event: "synergy/strategy.generated" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { strategyId, sessionId, userId } = event.data as {
      strategyId: string;
      sessionId: string;
      userId: string;
    };

    // ── Step 1: embed ──
    const embedResult: { embedded: boolean; reason?: string } =
      await step.run("embed-strategy", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = createServiceClient() as any;
        return await embedStrategy(db, strategyId);
      });

    if (!embedResult.embedded) {
      // No-op — strategy isn't matchable yet (no statement, no plan
      // steps, owner opted out, etc.). Don't run the matcher.
      return {
        strategy_id: strategyId,
        session_id: sessionId,
        user_id: userId,
        embedded: false,
        skip_reason: embedResult.reason ?? "unknown",
      };
    }

    // ── Step 2: match ──
    const matchResult: {
      candidates_considered: number;
      matches_persisted: number;
    } = await step.run("match-strategy", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = createServiceClient() as any;
      const source = await loadStrategySource(db, strategyId);
      if (!source) {
        // Strategy became unmatchable between embed + match (race —
        // user toggled matchable, archived, etc.). Soft-skip.
        return { candidates_considered: 0, matches_persisted: 0 };
      }
      return await matchOneStrategy(db, source);
    });

    // ── Step 3: divergence sweep (Phase 5 polish) ──
    //
    // For each active parallel-path room this strategy belongs to,
    // compare the latest strategy_matches row's final_score against
    // the divergence threshold. Flag or unflag synergy_rooms.diverged_at
    // accordingly.
    const divergenceResult: {
      rooms_checked: number;
      newly_diverged: number;
      newly_converged: number;
    } = await step.run("divergence-sweep", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = createServiceClient() as any;

      // Active parallel-path rooms involving this strategy
      const { data: rooms } = await db
        .from("synergy_rooms")
        .select(
          "id, strategy_a_id, strategy_b_id, diverged_at, divergence_dismissed_at",
        )
        .eq("room_kind", "parallel_path")
        .is("archived_at", null)
        .or(
          `strategy_a_id.eq.${strategyId},strategy_b_id.eq.${strategyId}`,
        );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (rooms ?? []) as Array<any>;

      let newlyDiverged = 0;
      let newlyConverged = 0;
      const nowIso = new Date().toISOString();

      for (const room of list) {
        const partnerStrategyId =
          room.strategy_a_id === strategyId
            ? room.strategy_b_id
            : room.strategy_a_id;
        if (!partnerStrategyId) continue;

        // Canonical-order the pair for the lookup
        const a =
          strategyId < partnerStrategyId ? strategyId : partnerStrategyId;
        const b =
          strategyId < partnerStrategyId ? partnerStrategyId : strategyId;
        const { data: matchRow } = await db
          .from("strategy_matches")
          .select("final_score")
          .eq("strategy_a", a)
          .eq("strategy_b", b)
          .maybeSingle();

        const score = (matchRow?.final_score ?? null) as number | null;
        const wasDiverged = room.diverged_at !== null;

        if (score === null || score < 50) {
          // Diverged. Set diverged_at + clear divergence_dismissed_at
          // (re-surface the banner even if previously dismissed —
          // this is a NEW divergence event since the user dismissed).
          if (!wasDiverged) {
            await db
              .from("synergy_rooms")
              .update({
                diverged_at: nowIso,
                divergence_dismissed_at: null,
              })
              .eq("id", room.id);
            newlyDiverged += 1;
          }
        } else if (score >= 50 && wasDiverged) {
          // Re-converged. Clear the diverged_at flag.
          await db
            .from("synergy_rooms")
            .update({
              diverged_at: null,
              divergence_dismissed_at: null,
            })
            .eq("id", room.id);
          newlyConverged += 1;
        }
      }

      return {
        rooms_checked: list.length,
        newly_diverged: newlyDiverged,
        newly_converged: newlyConverged,
      };
    });

    return {
      strategy_id: strategyId,
      session_id: sessionId,
      user_id: userId,
      embedded: true,
      candidates_considered: matchResult.candidates_considered,
      matches_persisted: matchResult.matches_persisted,
      divergence: divergenceResult,
    };
  },
);
