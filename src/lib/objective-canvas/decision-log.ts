// ── Sub-Objective Decision Log helpers ─────────────────────────────
//
// Thin wrapper over the sub_objective_decisions table. Two functions:
//
//   logDecision(db, args)
//     Append-only insert. Fire-and-forget from the route handlers —
//     a failure here MUST NOT block the user-facing PATCH. We log the
//     warning and swallow.
//
//   getUserIntentPreferences(db, userId)
//     Computes the user's revealed-preference distribution across the
//     six lab intents from their last ~50 elect/reject events. Returns
//     a sorted list with election rate per intent. Drives the
//     "Suggested intent" in the variant lab bar when no lens-gap
//     signal is present.
//
// Both are intentionally simple — preference learning becomes more
// sophisticated later (recency weighting, domain segmentation,
// A/B); the current version is the minimum viable flywheel start.

import type { SubObjectiveIntent } from "./sub-objective-state";

export type DecisionAction =
  | "elect"
  | "reject"
  | "defer"
  | "clear"
  | "generate_batch"
  | "confirm";

export interface LogDecisionArgs {
  userId: string;
  spaceId: string;
  proposalId?: string | null;
  action: DecisionAction;
  batchIntent?: SubObjectiveIntent | null;
  metadata?: Record<string, unknown>;
}

/** Append a decision row. Soft-fail by design — logging is telemetry,
 *  it must never break the user flow. Callers should `void` this. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logDecision(db: any, args: LogDecisionArgs): Promise<void> {
  try {
    const { error } = await db.from("sub_objective_decisions").insert({
      user_id: args.userId,
      space_id: args.spaceId,
      proposal_id: args.proposalId ?? null,
      action: args.action,
      batch_intent: args.batchIntent ?? null,
      metadata: args.metadata ?? {},
    });
    if (error) {
      console.warn("[decision-log] insert failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[decision-log] insert threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export interface IntentPreference {
  intent: SubObjectiveIntent;
  /** How many elect events on proposals from this intent's batches. */
  elects: number;
  /** How many reject events. */
  rejects: number;
  /** elects / (elects + rejects) — undefined when no signal at all. */
  rate: number | null;
  /** elects - rejects, used as a fallback rank when rate is shared. */
  net: number;
}

const ALL_INTENTS: SubObjectiveIntent[] = [
  "initial",
  "creative",
  "concrete",
  "contrarian",
  "gap_fill",
  "ambitious",
  "wildcard",
];

/** Compute per-intent revealed preferences from the user's last
 *  ~200 disposition events (recent enough to capture current taste,
 *  large enough to not be noisy on a single early choice). Returns
 *  intents sorted by election rate desc, falling back to net count
 *  when rates tie.
 *
 *  Returns an entry for every intent (even unobserved ones) with
 *  rate=null + elects=0 + rejects=0 — keeps the caller branch-free. */
export async function getUserIntentPreferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
): Promise<IntentPreference[]> {
  try {
    const { data, error } = await db
      .from("sub_objective_decisions")
      .select("action, batch_intent")
      .eq("user_id", userId)
      .in("action", ["elect", "reject"])
      .not("batch_intent", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.warn(
        "[decision-log] preference read failed:",
        error.message,
      );
      return emptyPreferences();
    }
    const rows =
      (data as Array<{ action: string; batch_intent: string }> | null) ?? [];
    const counts = new Map<
      SubObjectiveIntent,
      { elects: number; rejects: number }
    >();
    for (const intent of ALL_INTENTS) {
      counts.set(intent, { elects: 0, rejects: 0 });
    }
    for (const r of rows) {
      const intent = r.batch_intent as SubObjectiveIntent;
      if (!ALL_INTENTS.includes(intent)) continue;
      const cell = counts.get(intent)!;
      if (r.action === "elect") cell.elects += 1;
      else if (r.action === "reject") cell.rejects += 1;
    }
    const prefs: IntentPreference[] = ALL_INTENTS.map((intent) => {
      const { elects, rejects } = counts.get(intent)!;
      const total = elects + rejects;
      return {
        intent,
        elects,
        rejects,
        rate: total > 0 ? elects / total : null,
        net: elects - rejects,
      };
    });
    // Sort by rate desc; ties broken by net desc; intents with no
    // signal (rate=null) sort to the bottom.
    prefs.sort((a, b) => {
      if (a.rate === null && b.rate === null) return 0;
      if (a.rate === null) return 1;
      if (b.rate === null) return -1;
      if (b.rate !== a.rate) return b.rate - a.rate;
      return b.net - a.net;
    });
    return prefs;
  } catch (err) {
    console.warn(
      "[decision-log] preference threw:",
      err instanceof Error ? err.message : String(err),
    );
    return emptyPreferences();
  }
}

function emptyPreferences(): IntentPreference[] {
  return ALL_INTENTS.map((intent) => ({
    intent,
    elects: 0,
    rejects: 0,
    rate: null,
    net: 0,
  }));
}

/** Pick the user's top-preferred intent for the variant lab's
 *  "Suggested" affordance, excluding "initial" (which is the
 *  first-pass baseline, not a regen intent). Returns null when the
 *  user has no signal yet — caller falls back to a static default
 *  (typically "creative"). */
export function topPreferredIntent(
  prefs: IntentPreference[],
): SubObjectiveIntent | null {
  for (const p of prefs) {
    if (p.intent === "initial") continue;
    if (p.rate !== null) return p.intent;
  }
  return null;
}
