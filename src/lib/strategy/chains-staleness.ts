/**
 * Staleness detection for causal chains relative to the confirmed strategy.
 *
 * Phase 3: chains + strategy now both hang off `improvement_goals.id`. This
 * helper lets the strategy page surface a banner when the two are misaligned,
 * so users know to regenerate chains after switching goals.
 *
 * Pure function — no DB access, no React.
 */

import type { CausalChain } from "@/types/causal-chains";

export type StalenessReason = "no_chains" | "goal_mismatch" | "strategy_newer" | null;

export interface StalenessResult {
  stale: boolean;
  reason: StalenessReason;
  mismatchedChainCount?: number;
}

/**
 * Determine whether the causal chains shown alongside a strategy are out of
 * sync with that strategy's target goal.
 *
 * Rules (first match wins):
 *   1. No chains at all → stale with reason `"no_chains"`
 *   2. Strategy has a goal id and any chain references a different goal →
 *      `"goal_mismatch"` (the user likely switched active goal after chains were generated)
 *   3. Strategy was generated after every chain → `"strategy_newer"` (chains are pre-strategy)
 *   4. Otherwise → fresh.
 *
 * If the strategy has no goal id (legacy strategies that haven't been confirmed
 * since Phase 3 shipped), we can't detect goal mismatch so we return fresh.
 */
export function computeChainsStaleness(
  chains: CausalChain[],
  strategyGoalId: string | undefined | null,
  strategyGeneratedAt: string | undefined | null,
): StalenessResult {
  if (!chains || chains.length === 0) {
    return { stale: true, reason: "no_chains" };
  }

  if (!strategyGoalId) {
    // Can't detect mismatch without a goal FK on the strategy. Silently fresh.
    return { stale: false, reason: null };
  }

  const mismatchedChainCount = chains.reduce(
    (n, c) => (c.primary_goal_id && c.primary_goal_id !== strategyGoalId ? n + 1 : n),
    0,
  );
  if (mismatchedChainCount > 0) {
    return { stale: true, reason: "goal_mismatch", mismatchedChainCount };
  }

  if (strategyGeneratedAt) {
    const stratT = new Date(strategyGeneratedAt).getTime();
    if (Number.isFinite(stratT)) {
      const allOlder = chains.every((c) => {
        const ct = new Date(c.generated_at).getTime();
        return Number.isFinite(ct) && ct < stratT;
      });
      if (allOlder) return { stale: true, reason: "strategy_newer" };
    }
  }

  return { stale: false, reason: null };
}
