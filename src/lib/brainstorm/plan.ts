// ── Brainstorm Plan — intent picker ─────────────────────────────────
//
// Stage 1 of the Brainstorm Runner (BRAINSTORM_MODULE_SPEC.md §3).
// Picks the 3 intents the runner will execute, with per-intent
// rationale shown in the panel chips so the user can override before
// pressing Start.
//
// Algorithm (per spec §3 Stage 1):
//
//   1. ALWAYS run 1 gap_fill if the lens has uncovered phrases.
//   2. Pick 2 more from the user's per-intent elect-rate in decision_log
//      (excluding "initial" — that's a first-pass, not an intent).
//   3. If the user has no preference signal yet:
//      default to ["creative", "contrarian"].
//
// Deduplication: gap_fill cannot appear twice; if user's top-preferred
// intent IS gap_fill, we still pick gap_fill from the signal flag (so
// the reason is the lens), and pull the next preferred intent into
// slot 2.

import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";
import type { ObjectiveAnnotation } from "@/lib/objective-canvas/generate-annotations";
import type { SubObjectiveProposal } from "@/lib/objective-canvas/sub-objective-state";
import {
  getUserIntentPreferences,
  topPreferredIntent,
  type IntentPreference,
} from "@/lib/objective-canvas/decision-log";
import type { BrainstormPlan, IntentReason } from "./session-types";

/** Default flavour pair when the user has no preference signal yet.
 *  creative diverges in unfamiliar directions; contrarian forces a
 *  re-frame. Together they cover the two main "expand the option
 *  space" moves before the user has data to personalise. */
const COLD_START_DEFAULTS: SubObjectiveIntent[] = ["creative", "contrarian"];

/** Intents that may NOT appear in a brainstorm plan. "initial" is the
 *  first-pass baseline (no anti-duplicate context); brainstorm always
 *  appends to an existing set, so initial is never appropriate. */
const FORBIDDEN_INTENTS: ReadonlyArray<SubObjectiveIntent> = ["initial"];

export interface ComputePlanArgs {
  /** Parent objective annotations (lens). Drives gap_fill detection. */
  annotations: ObjectiveAnnotation[];
  /** Current proposals across all batches — used to compute which lens
   *  indices already have coverage. */
  currentProposals: SubObjectiveProposal[];
  /** User's per-intent elect-rate history. Pass null to skip the DB
   *  read (caller already loaded it). */
  userPreferences: IntentPreference[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  userId?: string;
}

/** Pick the 3-intent brainstorm plan + the rationale per slot. Pure
 *  function over inputs — no DB writes here; commitPlan() persists.
 *
 *  When userPreferences is null AND db+userId are provided, we read
 *  them on the fly. Otherwise the caller is expected to pre-load (the
 *  runner typically wants them once for both plan + preference scoring
 *  of candidates downstream). */
export async function computeBrainstormPlan(
  args: ComputePlanArgs,
): Promise<BrainstormPlan> {
  const prefs =
    args.userPreferences ??
    (args.db && args.userId
      ? await getUserIntentPreferences(args.db, args.userId)
      : []);

  // ── Slot 1: gap_fill if the lens has uncovered phrases ────────────
  const uncovered = uncoveredLensIndices(
    args.annotations,
    args.currentProposals,
  );

  const intents: SubObjectiveIntent[] = [];
  const reasons: Partial<Record<SubObjectiveIntent, IntentReason>> = {};

  if (uncovered.length > 0) {
    intents.push("gap_fill");
    reasons.gap_fill = { source: "gap_fill", uncovered_lens: uncovered };
  }

  // ── Slots 2-3 from user preference, falling back to cold-start ────
  const topUser = topPreferredIntent(prefs);
  const userPicks = collectUserPreferredIntents(prefs, intents, 3 - intents.length);

  for (const pick of userPicks) {
    intents.push(pick);
    const pref = prefs.find((p) => p.intent === pick);
    reasons[pick] = {
      source: "user_preference",
      elect_rate: pref?.rate ?? 0,
      n_observed: (pref?.elects ?? 0) + (pref?.rejects ?? 0),
    };
  }

  // ── Cold-start fill ──────────────────────────────────────────────
  // If user prefs gave us nothing usable (new user), fall through to
  // the cold-start defaults, still respecting the gap_fill slot.
  if (intents.length < 3) {
    for (const dflt of COLD_START_DEFAULTS) {
      if (intents.length >= 3) break;
      if (intents.includes(dflt)) continue;
      intents.push(dflt);
      reasons[dflt] = {
        source: "default",
        fallback_for: topUser === null ? "no_history" : "low_signal",
      };
    }
  }

  // Final safety net: if STILL short (e.g. somehow only 1), pad from
  // a broader default set. Should be unreachable with current logic.
  const broadDefaults: SubObjectiveIntent[] = [
    "creative",
    "contrarian",
    "concrete",
    "ambitious",
    "wildcard",
  ];
  for (const d of broadDefaults) {
    if (intents.length >= 3) break;
    if (intents.includes(d)) continue;
    intents.push(d);
    reasons[d] = { source: "default", fallback_for: "low_signal" };
  }

  return {
    intents: intents.slice(0, 3),
    reasons,
    locked_at: new Date().toISOString(),
  };
}

// ── Helpers ────────────────────────────────────────────────────────

/** Compute 1-based annotation indices NOT covered by any current
 *  proposal's lens_coverage[]. The runner picks gap_fill when this
 *  set is non-empty so brainstorming biases toward filling holes
 *  rather than thickening what's already covered. */
export function uncoveredLensIndices(
  annotations: ObjectiveAnnotation[],
  proposals: SubObjectiveProposal[],
): number[] {
  if (annotations.length === 0) return [];

  // The lens generator caps at 8 weight-sorted indices; cover that
  // many here so the index space matches what proposals were scored
  // against.
  const lensSize = Math.min(annotations.length, 8);
  const covered = new Set<number>();
  for (const p of proposals) {
    const cov = p.lens_coverage;
    if (!Array.isArray(cov)) continue;
    for (const idx of cov) {
      if (typeof idx === "number" && idx >= 1 && idx <= lensSize) {
        covered.add(idx);
      }
    }
  }

  const uncovered: number[] = [];
  for (let i = 1; i <= lensSize; i++) {
    if (!covered.has(i)) uncovered.push(i);
  }
  return uncovered;
}

/** Pick `n` intents from the user's preference list, in rate-desc
 *  order, excluding any already chosen + forbidden ones. Falls back
 *  to net-count tiebreaker (the order getUserIntentPreferences
 *  already imposes). Returns shorter list when not enough signal. */
function collectUserPreferredIntents(
  prefs: IntentPreference[],
  alreadyChosen: SubObjectiveIntent[],
  n: number,
): SubObjectiveIntent[] {
  if (n <= 0) return [];
  const picks: SubObjectiveIntent[] = [];
  for (const p of prefs) {
    if (picks.length >= n) break;
    if (alreadyChosen.includes(p.intent)) continue;
    if (FORBIDDEN_INTENTS.includes(p.intent)) continue;
    // Require some signal — at least one observed elect or reject.
    // Otherwise the "preference" is just an empty-bucket alphabetical
    // pick from getUserIntentPreferences, which would lie about why.
    if (p.rate === null) continue;
    picks.push(p.intent);
  }
  return picks;
}

/** Allow the user to swap one intent for another before Start. Returns
 *  the patched plan. Records source="user_override" so the audit trail
 *  shows what was replaced. */
export function applyUserOverride(
  plan: BrainstormPlan,
  slot: 0 | 1 | 2,
  newIntent: SubObjectiveIntent,
): BrainstormPlan {
  if (FORBIDDEN_INTENTS.includes(newIntent)) return plan;
  if (plan.intents.includes(newIntent)) return plan;
  const old = plan.intents[slot];
  if (old === undefined) return plan;
  const intents = [...plan.intents];
  intents[slot] = newIntent;
  const reasons = { ...plan.reasons };
  delete reasons[old];
  reasons[newIntent] = { source: "user_override", replaced: old };
  return { intents, reasons, locked_at: plan.locked_at };
}
