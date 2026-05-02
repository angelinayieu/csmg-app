// ── Goal-match scorer ─────────────────────────────────────────────────
//
// Scores each insight by embedding-space cosine to the space's
// primary_goal (falling back to input_text when goal is null). The
// first scorer the lab ships with — preliminary-insights' purely
// structural output isn't goal-aware today, and this gives the lab
// its first "is this the right insight for this user's situation"
// axis.
//
// Cost: one embedding API call per run (the goal text + all insight
// summaries batched). At ~50 insights × text-embedding-3-small that's
// well under a cent. The goal text is INCLUDED in the batch on every
// call rather than cached — keeps the scorer stateless. A higher
// layer can cache by (space.id, goal_hash) if re-run idempotency
// becomes a hot path.
//
// Soft-fail: if the embedding API errors, the scorer returns zeros
// rather than throwing — a broken scorer must not abort the stack
// run. Same philosophy as the structural event bus.

import { embedTexts } from "@/lib/embeddings";
import type { Space } from "@/types";
import type { Insight } from "../types";
import { cosine } from "./cosine";

export type ScoreAxis = "goal_match" | "novelty" | "actionability";

export interface ScoreResult {
  axis: ScoreAxis;
  /** Aggregate score across all insights this stack emitted, 0-1. */
  stackAvg: number;
  /** Per-insight score keyed by `Insight.id`. */
  perInsight: Record<string, number>;
}

/** Resolve which text represents the user's goal for this space.
 *  `primary_goal` is the structured field set during intake; falls
 *  back to `input_text` (the raw user prompt) when goal is null.
 *  Returns null when both are absent — caller short-circuits to zeros. */
function resolveGoalText(space: Space): string | null {
  const s = space as Space & {
    primary_goal?: string | null;
    input_text?: string | null;
  };
  const primary = s.primary_goal?.trim();
  if (primary && primary.length > 0) return primary;
  const input = s.input_text?.trim();
  if (input && input.length > 0) return input;
  return null;
}

export async function scoreGoalMatch(
  insights: Insight[],
  space: Space,
): Promise<ScoreResult> {
  const empty: ScoreResult = {
    axis: "goal_match",
    stackAvg: 0,
    perInsight: {},
  };

  if (insights.length === 0) return empty;

  const goalText = resolveGoalText(space);
  if (!goalText) return empty;

  let embeddings: number[][];
  try {
    embeddings = await embedTexts([
      goalText,
      ...insights.map((i) => i.summary),
    ]);
  } catch (err) {
    console.warn("[insight-lab/goal-match] embedding failed:", err);
    return empty;
  }

  if (embeddings.length !== insights.length + 1) {
    console.warn(
      "[insight-lab/goal-match] embedding count mismatch:",
      embeddings.length,
      "expected",
      insights.length + 1,
    );
    return empty;
  }

  const [goalEmb, ...insightEmbs] = embeddings;

  const perInsight: Record<string, number> = {};
  let total = 0;

  for (let i = 0; i < insights.length; i++) {
    const score = cosine(goalEmb, insightEmbs[i]);
    perInsight[insights[i].id] = score;
    total += score;
  }

  return {
    axis: "goal_match",
    stackAvg: total / insights.length,
    perInsight,
  };
}
