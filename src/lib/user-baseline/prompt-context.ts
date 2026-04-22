/**
 * Wave D Layer 0 — shared helper for injecting the user's Wave C
 * baseline (persona_tags, behavior_summary, goal_preferences,
 * baseline_metrics) into LLM prompt contexts.
 *
 * Problem this solves: Wave C wrote all those fields into profiles but
 * zero LLM prompt paths ever read them. persona_tags was orphan.
 *
 * Every LLM prompt path that should respect the user's lean now calls
 * `loadUserBaselineForPrompt(db, userId)` and inlines the result via
 * `formatBaselineForPrompt()` into the user message:
 *
 *   strategy-refresh / buildStrategyPrompt
 *   synthesize / buildSynthesisPrompt
 *   what-if / WHAT_IF_SYSTEM_PROMPT user payload
 *   objective-tagging (Wave A) — optional, the tagger is entity-scoped
 *   critic, researcher — optional, these run off user context less
 *
 * Format is compact: ~50-100 tokens when baseline is set, zero when it
 * isn't. Never fail the prompt if baseline is missing — just skip.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface UserBaselineForPrompt {
  persona_tags: string[];
  behavior_summary: string | null;
  goal_preferences: Record<string, unknown>;
  baseline_metrics: Record<string, unknown>;
  /** When was it last digested? Informational — LLM can weight recency. */
  updated_at: string | null;
}

/**
 * Empty baseline sentinel. Used when the user has no digest yet OR when
 * the query fails. Callers can safely check `.persona_tags.length` to
 * decide whether to inject anything at all.
 */
export const EMPTY_BASELINE: UserBaselineForPrompt = {
  persona_tags: [],
  behavior_summary: null,
  goal_preferences: {},
  baseline_metrics: {},
  updated_at: null,
};

export async function loadUserBaselineForPrompt(
  db: AnyDb,
  userId: string,
): Promise<UserBaselineForPrompt> {
  try {
    const { data } = await db
      .from("profiles")
      .select(
        "persona_tags, behavior_summary, goal_preferences, baseline_metrics, behavior_summary_updated_at",
      )
      .eq("id", userId)
      .maybeSingle();
    if (!data) return EMPTY_BASELINE;
    const row = data as {
      persona_tags: string[] | null;
      behavior_summary: string | null;
      goal_preferences: Record<string, unknown> | null;
      baseline_metrics: Record<string, unknown> | null;
      behavior_summary_updated_at: string | null;
    };
    return {
      persona_tags: Array.isArray(row.persona_tags) ? row.persona_tags : [],
      behavior_summary: row.behavior_summary ?? null,
      goal_preferences: row.goal_preferences ?? {},
      baseline_metrics: row.baseline_metrics ?? {},
      updated_at: row.behavior_summary_updated_at,
    };
  } catch (err) {
    console.warn("[baseline] loadUserBaselineForPrompt failed:", err);
    return EMPTY_BASELINE;
  }
}

/**
 * Format a baseline into a short markdown-ish block suitable for
 * prepending to a user-message payload. Returns empty string when the
 * baseline is empty so prompts don't sprout ghost sections.
 */
export function formatBaselineForPrompt(
  baseline: UserBaselineForPrompt,
): string {
  if (
    baseline.persona_tags.length === 0 &&
    !baseline.behavior_summary &&
    Object.keys(baseline.goal_preferences).length === 0
  ) {
    return "";
  }

  const lines: string[] = [
    "## User baseline (what the system has learned about this user)",
  ];

  if (baseline.persona_tags.length > 0) {
    lines.push(`- Persona tags: ${baseline.persona_tags.join(", ")}`);
  }

  if (baseline.behavior_summary) {
    lines.push(`- Recent behaviour summary: ${baseline.behavior_summary}`);
  }

  const prefs = baseline.goal_preferences as {
    lean?: string;
    preferred_objective_types?: string[];
    rejected_objective_types?: string[];
    cadence?: string;
  };
  if (prefs.lean) lines.push(`- Inferred lean: ${prefs.lean}`);
  if (prefs.preferred_objective_types?.length) {
    lines.push(
      `- Prefers objective types: ${prefs.preferred_objective_types.join(", ")}`,
    );
  }
  if (prefs.rejected_objective_types?.length) {
    lines.push(
      `- Rejects objective types: ${prefs.rejected_objective_types.join(", ")}`,
    );
  }
  if (prefs.cadence) lines.push(`- Typical cadence: ${prefs.cadence}`);

  lines.push(
    "",
    "Use this baseline as a prior — respect the user's preferences but don't become sycophantic. If a recommendation conflicts with their lean, surface the conflict explicitly rather than hiding it.",
    "",
  );

  return lines.join("\n");
}
