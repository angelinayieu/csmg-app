// ── Maturity computation ─────────────────────────────────────────────
//
// Pure functions. No I/O, no React. The bar is a weighted average of question
// state, and the evidence rules gate which states a question is ALLOWED to
// reach. Keeping this side-effect-free means the same math runs on the client
// (live bar) and the server (persisted snapshot) with no drift.

import {
  MAKE_THRESHOLD,
  type GlobalQuestion,
  type QuestionEvidence,
  type QuestionState,
} from "./types";

/** Points a question in each state contributes, before weighting. */
export function stateScore(state: QuestionState): number {
  switch (state) {
    case "resolved":
      return 1;
    case "explored":
      return 0.5;
    case "open":
      return 0;
  }
}

/** Maturity as a fraction in [0, 1]. Weighted average of state scores. An
 *  empty question set is 0 (nothing defined yet means nothing is answered). */
export function computeMaturity(questions: GlobalQuestion[]): number {
  let got = 0;
  let total = 0;
  for (const q of questions) {
    const w = q.weight > 0 ? q.weight : 1;
    total += w;
    got += w * stateScore(q.state);
  }
  if (total === 0) return 0;
  return got / total;
}

/** Maturity as a rounded percentage for display. */
export function maturityPct(questions: GlobalQuestion[]): number {
  return Math.round(computeMaturity(questions) * 100);
}

/** True when maturity is high enough to unlock the Make verb. */
export function isMakeUnlocked(questions: GlobalQuestion[]): boolean {
  return computeMaturity(questions) >= MAKE_THRESHOLD;
}

// ── Evidence gates ────────────────────────────────────────────────────
// A question can only move forward when it has earned it. These are the rules
// the UI enforces before letting a user mark a question explored or resolved,
// so the bar can never be advanced by clicking alone.

/** `explored` requires at least one piece of evidence: an AI research result
 *  OR the user's own committed answer. */
export function canMarkExplored(e: QuestionEvidence): boolean {
  return e.research || e.userAnswer;
}

/** `resolved` requires both sides of the compare — research AND the user's own
 *  answer — plus an explicit confirmation. */
export function canMarkResolved(e: QuestionEvidence): boolean {
  return e.research && e.userAnswer && e.confirmed;
}

/** The next state a question is allowed to advance to given its evidence, or
 *  null if it can't advance. Never moves backward. */
export function nextAllowedState(q: GlobalQuestion): QuestionState | null {
  if (q.state === "open" && canMarkExplored(q.evidence)) return "explored";
  if (q.state === "explored" && canMarkResolved(q.evidence)) return "resolved";
  return null;
}

/** Per-question contribution to the bar — powers the "what's moving this?"
 *  explainer. Returns the earned and possible points for each question so the
 *  UI can show `explored · 1.0/2.0` rows without recomputing the weights. */
export function maturityBreakdown(
  questions: GlobalQuestion[],
): Array<{ id: string; earned: number; possible: number }> {
  return questions.map((q) => {
    const w = q.weight > 0 ? q.weight : 1;
    return { id: q.id, earned: w * stateScore(q.state), possible: w };
  });
}
