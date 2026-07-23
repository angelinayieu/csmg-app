// ── Maturity model ───────────────────────────────────────────────────
//
// The double-diamond remodel (issue #17) drives a single maturity bar off the
// GLOBAL OPEN QUESTIONS formed at seed time. Those questions define what "done"
// means for an idea, so resolving them — and nothing else — is what advances
// maturity. Firing verbs does not move the bar; only question state does.
//
// Each question is derived from an auto-detected uncertainty hot spot in the
// initial KG (Engine B), so it carries a back-reference to the node(s) it came
// from. Resolving the question drains those nodes' residual uncertainty, which
// is what visibly cools the uncertainty map.

/** A global question's progress toward being answered. */
export type QuestionState = "open" | "explored" | "resolved";

/** The evidence attached to a question. `explored` requires at least one of
 *  these; `resolved` requires both plus explicit user confirmation. */
export interface QuestionEvidence {
  /** An AI research/reasoning result was attached. */
  research: boolean;
  /** The user committed their own answer (the guess-then-compare gate). */
  userAnswer: boolean;
  /** The user explicitly confirmed the question is settled (resolved only). */
  confirmed: boolean;
}

export interface GlobalQuestion {
  id: string;
  /** The question shown to the user. */
  prompt: string;
  state: QuestionState;
  /** Weight in the maturity average. Default 1; the hottest hot spots are
   *  marked critical and weigh 2. */
  weight: number;
  evidence: QuestionEvidence;
  /** KG node ids this question was derived from (the uncertainty hot spot). */
  sourceNodeIds: string[];
}

/** Weight applied to a question the system (or user) flags critical. */
export const CRITICAL_WEIGHT = 2;
export const DEFAULT_WEIGHT = 1;

/** Maturity fraction (0..1) at or above which the Make verb unlocks. */
export const MAKE_THRESHOLD = 0.6;
