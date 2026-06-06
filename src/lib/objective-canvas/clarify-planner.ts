// ── clarify-planner — picks the resolution strategy per ambiguity ─────
//
// Step 3 of the clarification engine (v1, heuristic). Given an ambiguity's
// salience kind + phrasing, decide HOW to resolve it:
//   • define — a term/concept to pin → a glossary meaning (does NOT spray cards)
//   • pin    — a hard constraint to nail down (a limit, not a feature)
//   • decompose — a goal/pain/lever to operationalize → Feature/Variable cards
//   • research  — its answer is an external FACT (legal/technical/market) → the
//                 future hook for a web-research grounding pre-pass
//
// The first concrete payoff (and the reason it exists now): only DECOMPOSE into
// feature cards when at least one concept warrants it. Resolving a pure
// term/definition then yields a clean glossary meaning instead of a spray of
// off-topic feature cards — the "super-picky board" rule, enforced upstream.
//
// Pure + deterministic (tsc-verifiable, no LLM). The LLM-planner upgrade
// (reasoning over the full op menu + actually invoking research) layers on top.

export type ResolveStrategy = "define" | "decompose" | "pin" | "research";

export interface PlannerConcept {
  phrase: string;
  /** salience kind: pain | goal | constraint | lever | concept | term */
  kind?: string;
  why?: string;
}

// Words that signal the answer is an external fact, not the user's intent —
// the discriminator between "research it" and "ask/define it" (§5 of the plan).
const FACTUAL_HINTS = [
  "legal", "license", "licensing", "copyright", "regulation", "compliance",
  "api", "feasible", "feasibility", "cost", "price", "pricing", "market",
  "competitor", "benchmark", "standard", "protocol", "data source", "gdpr",
];

export function isFactual(c: PlannerConcept): boolean {
  const hay = `${c.phrase} ${c.why ?? ""}`.toLowerCase();
  return FACTUAL_HINTS.some((h) => hay.includes(h));
}

export function strategyFor(c: PlannerConcept): ResolveStrategy {
  if (isFactual(c)) return "research";
  const kind = (c.kind ?? "concept").toLowerCase();
  if (kind === "concept" || kind === "term") return "define";
  if (kind === "constraint") return "pin";
  // goal / pain / lever → operationalize into Feature/Variable cards.
  return "decompose";
}

export interface ResolutionPlan {
  perConcept: Array<{ phrase: string; strategy: ResolveStrategy; factual: boolean }>;
  /** Decompose into Feature/Variable cards only when ≥1 concept is a goal /
   *  pain / lever. Pure term/constraint/fact resolutions don't spray cards. */
  shouldDecompose: boolean;
}

export function planResolution(concepts: PlannerConcept[]): ResolutionPlan {
  const perConcept = concepts.map((c) => ({
    phrase: c.phrase,
    strategy: strategyFor(c),
    factual: isFactual(c),
  }));
  return {
    perConcept,
    shouldDecompose: perConcept.some((p) => p.strategy === "decompose"),
  };
}
