// ── Crucible types ───────────────────────────────────────────────────
//
// The Crucible is the post-objective INTERROGATION LOOP. Right after the
// objective is promoted, a forked card runs a multi-round dialogue:
//
//   Inquirer  → asks 2–3 high-value questions per round (self-scored with the
//               question-quality rubric: expected info-gain × decision-relevance
//               × non-redundancy × answerability × depth). Each question is
//               tagged `audience`: "user" (a preference / intent only the user
//               can answer) or "research" (a knowable fact the agent self-answers
//               via web search).
//   Analyst   → classifies every answer into landscape / solution / constraint,
//               extracts the variables in play, and updates the running
//               problem-model + summary.
//
// Phase 1 stores the whole state in spaces.synthesis_data.objective_canvas
// .crucible (no new table, no migration). Later phases promote the surviving
// variables / leverage points / constraints into library_objects + object_links
// and finalize sub-objectives. See CRUCIBLE_PLAN (design discussion 2026-06-07).
//
// CLIENT-SAFE: pure types only, no server imports — the card shape imports this.

/** Bump to invalidate stale in-flight state (prompt/schema changes). */
export const CRUCIBLE_VERSION = "crucible-v1";

/** Hard cap on rounds so the loop always terminates even if the Inquirer
 *  never declares saturation. */
export const CRUCIBLE_MAX_ROUNDS = 6;

export type CrucibleStatus =
  /** A turn (Inquirer / self-answer / Analyst) is running server-side. */
  | "working"
  /** Waiting on the user to answer the pending user-questions. */
  | "awaiting_user"
  /** Info-saturated or round-capped — the loop is done; ready to converge. */
  | "converged"
  /** A turn failed; the card surfaces the reason + a retry. */
  | "error";

/** Who answers a question. The discrimination is the whole point: facts the
 *  web knows are answered by the agent; preferences / intentions / unknowns
 *  are reserved for the user (matches groundFactualConcept's factual gate). */
export type AnswerAudience = "user" | "research";

/** Where an answer's bucket fits in the problem-model. Keep problem-space
 *  (landscape) separate from solution-space so solutions don't contaminate the
 *  framing (Double Diamond: converge on the problem before the solution). */
export type AnswerBucket = "landscape" | "solution" | "constraint";

/** Socratic question family — drives coverage across rounds. */
export type SocraticKind =
  | "clarification"
  | "assumptions"
  | "evidence"
  | "viewpoints"
  | "implications";

export interface CrucibleQuestion {
  /** Stable id: `r{round}-{index}`. */
  id: string;
  round: number;
  text: string;
  /** "user" → ask the user; "research" → agent self-answers via web search. */
  audience: AnswerAudience;
  /** ≤ 12 words: what this question is trying to learn (the info-gain target). */
  intent: string;
  socratic: SocraticKind;
  /** 0–5 self-scored question quality (weighted-rubric sum, normalized). Used
   *  to keep only the top few per round + to surface "why we asked". */
  score: number;
  answered: boolean;
}

export interface AnswerCitation {
  title: string;
  url: string;
}

export interface CrucibleAnswer {
  questionId: string;
  text: string;
  via: AnswerAudience;
  /** Present on research-answered questions. */
  citations?: AnswerCitation[];
  /** Analyst classification of this answer. Set once the Analyst has run. */
  bucket?: AnswerBucket;
  /** Variable slugs this answer surfaced (resolve to CrucibleState.variables). */
  variableSlugs?: string[];
  /** Present when the answer was AUTO-resolved (best-of-N → ranked → picked)
   *  rather than supplied by the founder — for transparency on the surfaces. */
  auto?: { candidates: number; rationale?: string; runnerUp?: string };
}

/** A variable in play — a quantity / lever the objective's success turns on.
 *  Phase 2 promotes these to library_objects(object_type:"variable"); the
 *  glossary concept_slug wiring is carried in content_snapshot for Phase 3. */
export interface CrucibleVariable {
  slug: string;
  label: string;
  /** One-line meaning, lifted from the answer it was extracted from. */
  note?: string;
  /** library_objects.id once promoted (Phase 2 synthesis). */
  objectId?: string | null;
}

/** Phase 2 — the per-leverage-point rubric scores (Meadows / ToC / Pareto),
 *  each 0–5. The weighted total (computed in code) ranks the slate. */
export interface LeverageScores {
  /** Meadows depth: parameters (low) → feedback loops → rules → goals →
   *  paradigm (high). */
  meadows: number;
  /** Is this the binding constraint (Theory of Constraints)? */
  bindingness: number;
  /** How many downstream variables/outcomes moving this controls. */
  fanOut: number;
  /** Share of the target outcome this variable drives (critical-few). */
  pareto: number;
  /** Can THIS team actually move it given the constraints? */
  feasibility: number;
  /** Does it dissolve a trade-off (TRIZ) rather than just trade off? */
  contradiction: number;
}

/** Phase 2 — a ranked leverage point: the highest-value place to intervene to
 *  make the objective win. The PRIMARY output of the Crucible. */
export interface LeveragePoint {
  slug: string;
  label: string;
  /** 1–2 sentences: why acting here moves the objective most. */
  rationale: string;
  /** Where it sits on Meadows' ladder (display label, e.g. "Rules", "Goals"). */
  meadowsLevel: string;
  /** Variable slugs this lever targets (resolve to CrucibleState.variables). */
  targetsVariableSlugs: string[];
  /** Constraint slugs that bound this lever. */
  boundedByConstraintSlugs: string[];
  scores: LeverageScores;
  /** Weighted rubric total, normalized 0–100. Ranks the slate (desc). */
  score: number;
  /** library_objects.id once persisted. */
  objectId?: string | null;
}

/** Phase 2 — a structured constraint we must respect / set to make this the
 *  best feasible idea. */
export interface CrucibleConstraint {
  slug: string;
  label: string;
  kind: "hard" | "soft";
  why?: string;
  objectId?: string | null;
}

/** Phase 3 — the first-principle eval metric. Each dimension 0–5; the weighted
 *  total ranks which "principle" is genuinely fundamental (vs. a restated
 *  symptom). This IS the evaluation metric for identifying first principles. */
export interface FirstPrincipleScores {
  /** Can it be decomposed further / derived from something deeper? (bedrock=5) */
  irreducibility: number;
  /** If false, how much of the reasoning collapses? (everything=5) */
  counterfactual: number;
  /** Is it strictly required for the conclusion? */
  necessity: number;
  /** How much does it explain on its own? */
  sufficiency: number;
  /** Survives repeated "why?" without bottoming into another cause. */
  fiveWhys: number;
  /** A truth, not "how it's usually done" (convention/analogy). */
  independence: number;
}

/** Phase 4 — a coined sub-objective: a branch of the main objective pursued
 *  THROUGH a cluster of leverage points. The "finalized" half of the hybrid
 *  timing decision (coined at convergence with the full picture). */
export interface CrucibleSubObjective {
  slug: string;
  title: string;
  /** 1 sentence: what this branch achieves + why it's a distinct sub-goal. */
  rationale: string;
  /** Leverage-point slugs this sub-objective pursues. */
  leverageSlugs: string[];
  objectId?: string | null;
}

/** Phase 4 — a seed feature: a concrete thing to build that operationalizes a
 *  leverage point. The user expands these further (decompose / unpack / etc.).
 *  Persisted as a real `feature` library_object so all existing card ops work. */
export interface CrucibleFeature {
  slug: string;
  title: string;
  /** 1–2 sentences: what it is + how it moves the lever. */
  description: string;
  /** The leverage-point slug this feature operationalizes. */
  leverageSlug: string;
  /** 0–1 confidence this is a real, high-value feature for the objective. */
  confidence: number;
  objectId?: string | null;
}

/** Phase 3 — an irreducible truth the objective's success rests on. The
 *  highest-scoring principle is the deepest leverage: solve it and the rest
 *  follows. The second agent PERSONA's output (first-principles lens). */
export interface FirstPrinciple {
  slug: string;
  label: string;
  /** 1–2 sentences stating the irreducible truth. */
  statement: string;
  /** Leverage-point slugs this principle grounds (they rest on it). */
  groundsLeverageSlugs: string[];
  /** Variable slugs this principle explains. */
  groundsVariableSlugs: string[];
  scores: FirstPrincipleScores;
  /** Weighted rubric total, normalized 0–100. */
  score: number;
  objectId?: string | null;
}

export interface CrucibleState {
  version: string;
  status: CrucibleStatus;
  /** Current round (1-indexed); the round whose questions are pending. */
  round: number;
  /** The objective this loop is interrogating (snapshot at start). */
  objective: string;
  /** All questions asked across rounds. */
  questions: CrucibleQuestion[];
  /** All answers gathered (user-typed + agent-researched). */
  answers: CrucibleAnswer[];
  /** Running problem-model — the three buckets the Analyst accretes. */
  landscape: string[];
  solutions: string[];
  constraints: string[];
  variables: CrucibleVariable[];
  /** 1–2 sentence "what we've learned + where we're headed". */
  summary: string;
  /** Why the loop stopped (set when status === "converged"). */
  convergedReason?: string;
  // ── Phase 2 synthesis outputs (set once the loop converges) ──
  /** Ranked leverage points — the primary output. Sorted by score desc. */
  leveragePoints?: LeveragePoint[];
  /** Structured constraints we must respect / set. */
  constraintObjects?: CrucibleConstraint[];
  /** Phase 3 — ranked first principles (the irreducible truths the levers rest
   *  on). Sorted by score desc. */
  firstPrinciples?: FirstPrinciple[];
  /** Phase 4 — coined sub-objectives (branches of the main objective). */
  subObjectives?: CrucibleSubObjective[];
  /** Phase 4 — seed features the user can expand. */
  features?: CrucibleFeature[];
  /** True once the Synthesizer has run + persisted (idempotency guard). */
  synthesisDone?: boolean;
  startedAt: string;
  updatedAt: string;
  /** Last error message (set when status === "error"). */
  error?: string;
}

// ── Exploration (variation / diverge → converge-to-principle) ─────────
//
// The on-demand BRAINSTORM surface, shared with the Crucible engine. The
// Crucible loop CONVERGES (narrows to answers); exploration DIVERGES: take one
// ambiguity / optimization point, generate K candidate answers (variations),
// then converge by extracting the INTERSECTION (the invariant that holds in
// every variation = a first-principle candidate) and the DIFFERENCES (the axes
// the user must actually decide). Stored as a swappable BLOCK in library_objects
// (object_type "decision") so it composes into the objective brief later.

/** One diverged way to resolve the ambiguity. */
export interface ExplorationVariation {
  /** Stable id within the block (`v0`, `v1`, …). */
  id: string;
  /** ≤ 6 words — the chip label. */
  label: string;
  /** One line — the actual resolution this variation proposes. */
  value: string;
  /** 1 sentence — why this reading is plausible. */
  rationale: string;
  /** ≤ 1 sentence — what it implies if chosen (light concept exploration). */
  implication?: string;
}

/** A decision axis surfaced by the DIFFERENCES across variations — the real
 *  choices the user still has to make. */
export interface ExplorationDecision {
  /** ≤ 6 words naming the axis (e.g. "Group size", "Disclosure timing"). */
  axis: string;
  /** The competing options along that axis. */
  options: string[];
}

/** The converged exploration of ONE ambiguity — a swappable block.
 *  Persisted in library_objects.content_snapshot (object_type "decision"). */
export interface ExplorationBlock {
  /** The ambiguity title this block resolves. */
  headline: string;
  /** The question being resolved. */
  question: string;
  /** Optional heatmap zone key / priority slug this forked from. */
  source?: string;
  /** The INTERSECTION — what's true in every variation. A first-principle
   *  candidate; feeds the Crucible's first-principle synthesizer. */
  principle: string;
  /** The diverged candidate answers. */
  variations: ExplorationVariation[];
  /** The DIFFERENCES — the axes the user must decide between. */
  decisions: ExplorationDecision[];
  /** Index of the model-recommended variation. */
  recommendedIndex: number;
  /** Index of the currently-chosen variation (swappable). */
  activeIndex: number;
  generatedAt: string;
}

// ── Composed objective brief (the "final product") ───────────────────
//
// A READ-AND-COMPOSE surface assembled from the blocks the Crucible + the
// exploration slice already persist (no new data). Each slot is filled by the
// best block(s) of a type; the `decisions` slot is SWAPPABLE in place (reuses
// the explore-ambiguity swap action). This is the additive building-block view:
// the objective read as ~6 typed slots, with prose fallback where a slot is
// empty. Decisions: blocks AUGMENT prose (not replace).

export interface BriefLeveragePoint {
  objectId: string | null;
  label: string;
  /** 0–100 leverage score (rank_score). */
  score: number;
  meadowsLevel: string;
  rationale: string;
}
export interface BriefConstraint {
  objectId: string | null;
  label: string;
  kind: "hard" | "soft";
  why?: string;
}
export interface BriefFirstPrinciple {
  objectId: string | null;
  label: string;
  statement: string;
  score: number;
}
export interface BriefVariable {
  objectId: string | null;
  label: string;
  note?: string;
}
/** Phase 4 brief slots — the actionable roadmap half of the composition. */
export interface BriefSubObjective {
  objectId: string | null;
  title: string;
  rationale?: string;
}
export interface BriefFeature {
  objectId: string | null;
  title: string;
  description?: string;
  /** 0–100 (rank_score = confidence×100). */
  score: number;
}
/** A swappable decision block surfaced in the brief (the exploration output). */
export interface BriefDecision {
  objectId: string | null;
  headline: string;
  principle: string;
  variations: ExplorationVariation[];
  activeIndex: number;
  decisions: ExplorationDecision[];
}

export interface ObjectiveBrief {
  /** The intent slot — the sharpened objective text. */
  objective: string;
  /** Short title (distilled, else space name). */
  title: string;
  firstPrinciples: BriefFirstPrinciple[];
  optimizationPoints: BriefLeveragePoint[];
  /** Phase 4 — coined branches pursuing leverage clusters. */
  subObjectives: BriefSubObjective[];
  /** Phase 4 — seed features (real `feature` objects the user expands). */
  features: BriefFeature[];
  constraints: BriefConstraint[];
  decisions: BriefDecision[];
  variables: BriefVariable[];
  /** True when at least one block-backed slot is populated (else prose-only). */
  hasBlocks: boolean;
}

/** A fresh, empty state for a new objective. */
export function emptyCrucibleState(
  objective: string,
  nowIso: string,
): CrucibleState {
  return {
    version: CRUCIBLE_VERSION,
    status: "working",
    round: 0,
    objective,
    questions: [],
    answers: [],
    landscape: [],
    solutions: [],
    constraints: [],
    variables: [],
    summary: "",
    startedAt: nowIso,
    updatedAt: nowIso,
  };
}

/** The pending user-questions the card should render an answer box for. */
export function pendingUserQuestions(
  state: CrucibleState,
): CrucibleQuestion[] {
  return state.questions.filter(
    (q) => q.audience === "user" && !q.answered,
  );
}
