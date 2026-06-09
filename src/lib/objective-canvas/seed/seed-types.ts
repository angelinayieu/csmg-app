// ── Objective Seed types ─────────────────────────────────────────────
//
// The seed is the CONTAINER (see OBJECTIVE_SEED_PLAN). One per objective, stored
// at spaces.synthesis_data.objective_canvas.seed (and in library_objects
// .content_snapshot.seed for forked downstream cards). It has two halves:
//
//   external — the ONE thing the card face shows (the product). Computed by
//              distill-external from `internal`. External-framed (what to build,
//              vs. what already exists), never the internal "why".
//   internal — the ENGINE (the Crucible's output). Sandboxed; revealed only on
//              expand (the Map tab). The user never reads this on the board.
//
// CLIENT-SAFE: pure types, no imports.

export const SEED_VERSION = "seed-v1";

/** The card FACE — the only thing that surfaces. */
export interface SeedExternal {
  /** What to build, in user terms. NOT the optimization reason. */
  deliverable: string;
  /** Positioned against real alternatives ("unlike X/Y, this …"). Mandatory —
   *  a deliverable with no named alternative is a platitude. */
  vsAlternatives: string;
  /** 0–100: how much better than the user's current tool, net of switch cost. */
  valueToSwitch: number;
  /** The single next move (fork-ready). */
  doNext: string;
  confidence: number; // 0–1
}

// ── Internal engine refs (the Crucible's output, condensed) ──
export interface SeedLeverageRef { slug: string; label: string; score: number; meadows?: string; rationale?: string; }
export interface SeedPrincipleRef { slug: string; label: string; statement: string; score: number; }
export interface SeedVariableRef { slug: string; label: string; note?: string; /** consolidated-from slugs */ mergedFrom?: string[]; }
export interface SeedConstraintRef { slug: string; label: string; kind: "hard" | "soft"; }
export interface SeedAlternative { name: string; failure: string; }
export interface SeedAnalog { name: string; relation: "simpler" | "more_complex" | "adjacent"; implication: string; }
export interface SeedAmbiguity { zone: string; question: string; resolved: boolean; }
export interface SeedOptimizationPoint { slug: string; label: string; weight: number; }
export interface SeedNode { id: string; label: string; keyword?: string; type: string; score?: number; }
export interface SeedEdge { source: string; target: string; relation?: string; }

// ── Evaluation (the brain — EVALUATOR_PLAN) ──
// A course of action is only as well-evaluated as the factor set it's judged
// against. The evaluator holds the full factor set, weights it per decision,
// assesses each against a DEPTH bar, and surfaces what's NOT considered.

export type FactorStatus = "strong" | "weak" | "unaddressed" | "unknown";
export type FactorWeight = "decisive" | "relevant" | "minor";

export interface SeedFactor {
  key: string;
  group: string; // "A".."I"
  label: string;
  /** 1-sentence judgment (prose). */
  assessment: string;
  /** 0–100. LOW-TRUST (§9.3) — always read with confidence + source. */
  score: number;
  /** 0–1 how grounded this judgment is. */
  confidence: number;
  status: FactorStatus;
  weight: FactorWeight;
  source: "evidence" | "simulation" | "crucible" | "value_engine" | "judgment";
  /** When this factor is decisive + low-grounding + illegible, the assessor
   *  emits the QUESTION to ask the founder instead of a confident verdict. */
  probe?: string;
  /** For an unaddressed/weak decisive factor: is the gap a blocker or learnable? */
  gapKind?: "stop_ship" | "two_way_door";
}

export interface SeedEvaluation {
  decisionType: string;
  /** WHY these factors dominate — the high-trust strategic output. */
  weightingRationale: string;
  factors: SeedFactor[];
  decisiveFactors: string[];
  /** The most important UNADDRESSED (or weak) decisive factor — the card line +
   *  the chat's next question (the one-brain interweave). */
  biggestGap: string;
  biggestGapKind?: "stop_ship" | "two_way_door";
  /** Bias-to-action: is this ready to test, or does a gap block it? */
  call: "go" | "refine_first";
  verdict: string;
  confidence: number;
  updatedAt: string;
}

// ── Idea field (the generative layer) ──
// The reasoning layer DECOMPOSES the problem (levers/principles/variables) — it
// does NOT generate a field of discrete concepts to choose among. This is that
// missing layer: enumerate + invent candidate ideas, score each on the
// objective's value axes, and RANK — so "find my best idea" returns a defended
// pick with the field behind it, not a single asserted move.

/** Where a candidate came from — so the field shows it isn't just echoing input. */
export type IdeaOrigin = "extracted" | "recombination" | "analogical" | "constraint";

export interface IdeaScores {
  /** 0–100 each. */
  income: number;
  traction: number;
  virality: number;
  moat: number;
  whyNow: number;
}

export interface SeedIdea {
  slug: string;
  /** The concept itself, ≤ 12 words. */
  title: string;
  /** What it is / who it's for, ≤ 32 words. */
  summary: string;
  origin: IdeaOrigin;
  scores: IdeaScores;
  /** Weighted total (0–100), computed in code from `scores` — auditable. */
  composite: number;
  /** ≤ 1 sentence: why it scored where it did. */
  rationale: string;
  rank: number;
}

export interface SeedIdeaField {
  /** The value axes (from the objective; default income/traction/virality/moat/why-now). */
  axes: string[];
  /** Weight per scored axis (sums to 1) — shown so the ranking is legible. */
  weights: IdeaScores;
  ideas: SeedIdea[];
  /** slug of the #1 pick. */
  topPick: string;
  /** Why #1 beat #2/#3 — the defense of the pick. */
  whyTopWon: string;
  /** How many candidates were generated before pruning (the breadth explored). */
  generatedCount: number;
  updatedAt: string;
}

/** The ENGINE. Everything sandboxed inside the seed. */
export interface SeedInternal {
  sharpenedObjective: string;
  ambiguities: SeedAmbiguity[];
  optimizationPoints: SeedOptimizationPoint[];
  leveragePoints: SeedLeverageRef[];
  firstPrinciples: SeedPrincipleRef[];
  canonicalVariables: SeedVariableRef[];
  constraints: SeedConstraintRef[];
  landscape: { fact: string; source?: string }[];
  /** Value engine (Phase C) — populated by deep-synthesize. */
  alternatives: SeedAlternative[];
  analogousExamples: SeedAnalog[];
  /** The conceptual graph data (the Map tab renders this). */
  reasoningGraph: { nodes: SeedNode[]; edges: SeedEdge[] };
  /** The factor-coverage evaluation (the brain). Set once the evaluator runs. */
  evaluation?: SeedEvaluation;
  /** The generated + ranked idea field. Set once the idea engine runs. */
  ideas?: SeedIdeaField;
}

export interface ObjectiveSeed {
  version: string;
  /** null until distill-external has run. */
  external: SeedExternal | null;
  internal: SeedInternal;
  status: "seeding" | "ready" | "error";
  updatedAt: string;
  error?: string;
}

export function emptySeedInternal(objective: string): SeedInternal {
  return {
    sharpenedObjective: objective,
    ambiguities: [],
    optimizationPoints: [],
    leveragePoints: [],
    firstPrinciples: [],
    canonicalVariables: [],
    constraints: [],
    landscape: [],
    alternatives: [],
    analogousExamples: [],
    reasoningGraph: { nodes: [], edges: [] },
  };
}

export function emptySeed(objective: string, nowIso: string): ObjectiveSeed {
  return {
    version: SEED_VERSION,
    external: null,
    internal: emptySeedInternal(objective),
    status: "seeding",
    updatedAt: nowIso,
  };
}
