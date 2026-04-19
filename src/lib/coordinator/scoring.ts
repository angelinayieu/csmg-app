/**
 * Coordinator scoring — pure, deterministic, unit-testable.
 *
 * Takes a list of goal candidates (with priority-relevant signals) and returns
 * them sorted by descending priority score. The coordinator-tick function
 * picks the top-K winners and dispatches research for them.
 *
 * Score components (bounded, composable):
 *   deadline_urgency     0..50   — tighter deadlines rank higher
 *   stale_bonus          0..40   — cascade staleness drives urgency
 *   convergence_bonus    0..30   — strategic signals get more attention
 *   critical_gap_bonus   0..N*5  — explicit synthesis gaps pull research
 *   recency_suppression  0..30   — recently researched goals get deprioritised
 *
 * The final score is `urgency + stale + conv + gaps - suppression`, where
 * suppression only applies when research ran within the last ~30 days.
 */

export interface GoalCandidate {
  goalId: string;
  spaceId: string;
  userId: string;
  goalTitle?: string;
  /** ISO string — null means "no deadline" (scored as 30d out) */
  deadline: string | null;
  /** 0..100 from StaleReport.stale_score; null/undefined ≈ 0 */
  staleScore?: number | null;
  /** 0..6 from SuggestedObjective.convergence_score; null/undefined ≈ 0 */
  convergenceScore?: number | null;
  /** Number of synthesis.critical_gaps rows naming this goal */
  criticalGapCount?: number;
  /**
   * Days since the bound researcher last ran.
   * null/undefined means "never researched" (no recency penalty).
   */
  daysSinceLastResearch?: number | null;
  /** Passed through for downstream dispatch logging */
  goalStatus?: string;
}

export interface RankedGoal extends GoalCandidate {
  score: number;
  breakdown: {
    deadline_urgency: number;
    stale_bonus: number;
    convergence_bonus: number;
    critical_gap_bonus: number;
    recency_suppression: number;
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Days from now to `iso`, or `null` when `iso` is falsy/invalid. */
function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (t - now) / 86_400_000;
}

export function scoreGoal(g: GoalCandidate, now = Date.now()): RankedGoal {
  // Deadline urgency: 50 pts at ≤ today, linearly decays to 0 at 30+ days out.
  // Goals without a deadline get a neutral 10 pts (background priority).
  const d = daysUntil(g.deadline, now);
  const deadline_urgency =
    d === null
      ? 10
      : clamp(50 * (1 - d / 30), 0, 50);

  // Staleness: 0..100 maps into 0..40 pts.
  const stale_bonus = clamp(((g.staleScore ?? 0) / 100) * 40, 0, 40);

  // Convergence: 0..6 maps into 0..30 pts.
  const convergence_bonus = clamp(((g.convergenceScore ?? 0) / 6) * 30, 0, 30);

  // Critical gaps: each one adds 5 pts, capped at 25.
  const critical_gap_bonus = clamp((g.criticalGapCount ?? 0) * 5, 0, 25);

  // Recency suppression: researched today → 30 pts penalty, fades to 0 at 30d.
  // Goals never researched get 0 suppression (treated as maximally due).
  const days_since = g.daysSinceLastResearch;
  const recency_suppression =
    days_since === null || days_since === undefined
      ? 0
      : clamp(30 * (1 - days_since / 30), 0, 30);

  const score =
    deadline_urgency +
    stale_bonus +
    convergence_bonus +
    critical_gap_bonus -
    recency_suppression;

  return {
    ...g,
    score,
    breakdown: {
      deadline_urgency,
      stale_bonus,
      convergence_bonus,
      critical_gap_bonus,
      recency_suppression,
    },
  };
}

/** Rank candidates by descending score; ties broken by deadline proximity. */
export function scoreAndRank(
  candidates: GoalCandidate[],
  now = Date.now()
): RankedGoal[] {
  return candidates
    .map((c) => scoreGoal(c, now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const da = daysUntil(a.deadline, now) ?? 365;
      const db = daysUntil(b.deadline, now) ?? 365;
      return da - db;
    });
}
