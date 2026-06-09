// ── Crucible engine ──────────────────────────────────────────────────
//
// The server-side reasoning steps of the loop. Pure-ish functions over the
// LLM + the web-search grounding helper; the route composes them with state +
// credit charging. SERVER-ONLY.
//
//   inquire()            — one Inquirer turn → the best 1–3 questions + a
//                          saturation verdict.
//   analyze()            — one Analyst turn → bucket classifications + problem-
//                          model additions + a refreshed summary.
//   selfAnswerResearch() — answer a 'research'-tagged question via web_search
//                          (reuses groundFactualConcept), so the founder is
//                          never asked to look up a knowable fact.

import { llmJSON, BEST_CLAUDE_MODEL, BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";
import { groundFactualConcept } from "@/lib/objective-canvas/ground-factual-concept";
import {
  ANALYST_SCHEMA,
  analystSystem,
  analystUser,
  INQUIRER_SCHEMA,
  inquirerSystem,
  inquirerUser,
  SYNTHESIZER_SCHEMA,
  synthesizerSystem,
  synthesizerUser,
  FIRST_PRINCIPLES_SCHEMA,
  firstPrinciplesSystem,
  firstPrinciplesUser,
  ROADMAP_SCHEMA,
  roadmapSystem,
  roadmapUser,
  DIVERGE_SCHEMA,
  CONVERGE_SCHEMA,
  divergeSystem,
  divergeUser,
  convergeSystem,
  convergeUser,
  type AnalystRaw,
  type ConvergeRaw,
  type DivergeRaw,
  type FactorLite,
  type FirstPrinciplesRaw,
  type InquirerRaw,
  type RoadmapRaw,
  type SynthesizerRaw,
} from "./crucible-prompts";
import {
  CRUCIBLE_MAX_ROUNDS,
  type AnswerCitation,
  type CrucibleAnswer,
  type CrucibleConstraint,
  type CrucibleFeature,
  type CrucibleSubObjective,
  type CrucibleQuestion,
  type CrucibleVariable,
  type ExplorationDecision,
  type ExplorationVariation,
  type FirstPrinciple,
  type LeveragePoint,
  type SocraticKind,
} from "./crucible-types";

const SOCRATIC = new Set<SocraticKind>([
  "clarification",
  "assumptions",
  "evidence",
  "viewpoints",
  "implications",
]);

function clampScore(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(5, n))
    : 3;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export interface InquireResult {
  questions: CrucibleQuestion[];
  saturated: boolean;
  reason: string;
}

/** Run one Inquirer turn. Returns the round's questions (ids stamped) + the
 *  saturation verdict. Soft-fails to an empty, saturated result so a model
 *  error converges the loop rather than 500ing. */
export async function inquire(args: {
  objective: string;
  preamble: string;
  factors: FactorLite[];
  seedQuestions: string[];
  questions: CrucibleQuestion[];
  answers: CrucibleAnswer[];
  landscape: string[];
  solutions: string[];
  constraints: string[];
  variables: CrucibleVariable[];
  round: number;
}): Promise<InquireResult> {
  let raw: InquirerRaw;
  try {
    raw = await llmJSON<InquirerRaw>({
      system: inquirerSystem(),
      user: inquirerUser({ ...args, maxRounds: CRUCIBLE_MAX_ROUNDS }),
      provider: "anthropic",
      model: BEST_FAST_CLAUDE_MODEL,
      maxTokens: 1400,
      temperature: 0.5,
      responseSchema: INQUIRER_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.warn("[crucible-engine] inquire failed (soft):", err);
    return { questions: [], saturated: true, reason: "inquiry unavailable" };
  }

  const seen = new Set<string>();
  const questions: CrucibleQuestion[] = [];
  for (const q of raw?.questions ?? []) {
    const text = String(q?.text ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const audience = q?.audience === "research" ? "research" : "user";
    const socratic = SOCRATIC.has(q?.socratic as SocraticKind)
      ? (q.socratic as SocraticKind)
      : "clarification";
    questions.push({
      id: `r${args.round}-${questions.length}`,
      round: args.round,
      text: text.slice(0, 400),
      audience,
      intent: String(q?.intent ?? "").trim().slice(0, 120),
      socratic,
      score: clampScore(q?.score),
      answered: false,
    });
    if (questions.length >= 3) break;
  }
  // Highest-value first.
  questions.sort((a, b) => b.score - a.score);

  return {
    questions,
    saturated: !!raw?.saturated || questions.length === 0,
    reason: String(raw?.saturation_reason ?? "").trim().slice(0, 160),
  };
}

/** Answer a 'research'-tagged question via web_search. Returns the answer text
 *  + citations, or null if grounding produced nothing (the question then falls
 *  back to the user). */
export async function selfAnswerResearch(
  question: CrucibleQuestion,
): Promise<{ text: string; citations: AnswerCitation[] } | null> {
  const grounded = await groundFactualConcept(question.text, question.intent);
  if (!grounded || !grounded.findings.trim()) return null;
  return {
    text: grounded.findings.trim(),
    citations: grounded.citations ?? [],
  };
}

export interface AnalyzeResult {
  classifications: AnalystRaw["classifications"];
  landscapeAdd: string[];
  solutionsAdd: string[];
  constraintsAdd: string[];
  variablesAdd: CrucibleVariable[];
  summary: string;
}

/** Run one Analyst turn over the freshly-answered pairs. Soft-fails to an
 *  empty update (no classifications, no additions) so a model error leaves the
 *  existing model intact. */
export async function analyze(args: {
  objective: string;
  freshPairs: Array<{ q: CrucibleQuestion; a: CrucibleAnswer }>;
  landscape: string[];
  solutions: string[];
  constraints: string[];
  variables: CrucibleVariable[];
  priorSummary: string;
}): Promise<AnalyzeResult> {
  if (args.freshPairs.length === 0) {
    return {
      classifications: [],
      landscapeAdd: [],
      solutionsAdd: [],
      constraintsAdd: [],
      variablesAdd: [],
      summary: args.priorSummary,
    };
  }

  let raw: AnalystRaw;
  try {
    raw = await llmJSON<AnalystRaw>({
      system: analystSystem(),
      user: analystUser(args),
      provider: "anthropic",
      model: BEST_FAST_CLAUDE_MODEL,
      maxTokens: 1600,
      temperature: 0.3,
      responseSchema: ANALYST_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.warn("[crucible-engine] analyze failed (soft):", err);
    return {
      classifications: [],
      landscapeAdd: [],
      solutionsAdd: [],
      constraintsAdd: [],
      variablesAdd: [],
      summary: args.priorSummary,
    };
  }

  const clean = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .map((s) => String(s ?? "").trim())
          .filter(Boolean)
          .map((s) => s.slice(0, 160))
      : [];

  const seenVar = new Set(args.variables.map((v) => v.slug));
  const variablesAdd: CrucibleVariable[] = [];
  for (const v of raw?.variables_add ?? []) {
    const slug = slugify(String(v?.slug ?? v?.label ?? ""));
    const label = String(v?.label ?? "").trim().slice(0, 60);
    if (!slug || !label || seenVar.has(slug)) continue;
    seenVar.add(slug);
    variablesAdd.push({
      slug,
      label,
      note: String(v?.note ?? "").trim().slice(0, 160) || undefined,
    });
  }

  return {
    classifications: Array.isArray(raw?.classifications)
      ? raw.classifications
      : [],
    landscapeAdd: clean(raw?.landscape_add),
    solutionsAdd: clean(raw?.solutions_add),
    constraintsAdd: clean(raw?.constraints_add),
    variablesAdd,
    summary: String(raw?.summary ?? "").trim().slice(0, 400) || args.priorSummary,
  };
}

// ── Synthesizer (Phase 2) ──

/** Rubric weights — Meadows depth + constraint-bindingness dominate, then
 *  fan-out / Pareto / feasibility, then contradiction-resolution. Max raw = 65. */
const LEVERAGE_WEIGHTS = {
  meadows: 3,
  bindingness: 3,
  fanOut: 2,
  pareto: 2,
  feasibility: 2,
  contradiction: 1,
} as const;
const LEVERAGE_MAX = 5 * (3 + 3 + 2 + 2 + 2 + 1); // 65

function clamp5(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(5, n))
    : 0;
}

export interface SynthesisResult {
  variables: CrucibleVariable[];
  constraints: CrucibleConstraint[];
  leveragePoints: LeveragePoint[];
}

/** Distill the converged problem-model into ranked leverage points + canonical
 *  variables + structured constraints. Uses the deep model (quality matters —
 *  this is the payoff). Soft-fails to null so a synthesis miss leaves the
 *  loop converged-without-synthesis (the route can retry). */
export async function synthesizeLeverage(args: {
  objective: string;
  preamble: string;
  factors: FactorLite[];
  questions: CrucibleQuestion[];
  answers: CrucibleAnswer[];
  landscape: string[];
  solutions: string[];
  constraints: string[];
  variables: CrucibleVariable[];
}): Promise<SynthesisResult | null> {
  let raw: SynthesizerRaw;
  try {
    raw = await llmJSON<SynthesizerRaw>({
      system: synthesizerSystem(),
      user: synthesizerUser(args),
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 3000,
      temperature: 0.35,
      responseSchema: SYNTHESIZER_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.warn("[crucible-engine] synthesize failed (soft):", err);
    return null;
  }

  // Variables — canonical set (deduped by slug).
  const varSeen = new Set<string>();
  const variables: CrucibleVariable[] = [];
  for (const v of raw?.variables ?? []) {
    const slug = slugify(String(v?.slug ?? v?.label ?? ""));
    const label = String(v?.label ?? "").trim().slice(0, 60);
    if (!slug || !label || varSeen.has(slug)) continue;
    varSeen.add(slug);
    variables.push({
      slug,
      label,
      note: String(v?.note ?? "").trim().slice(0, 160) || undefined,
    });
  }

  // Constraints — deduped by slug.
  const conSeen = new Set<string>();
  const constraints: CrucibleConstraint[] = [];
  for (const c of raw?.constraints ?? []) {
    const slug = slugify(String(c?.slug ?? c?.label ?? ""));
    const label = String(c?.label ?? "").trim().slice(0, 80);
    if (!slug || !label || conSeen.has(slug)) continue;
    conSeen.add(slug);
    constraints.push({
      slug,
      label,
      kind: c?.kind === "soft" ? "soft" : "hard",
      why: String(c?.why ?? "").trim().slice(0, 160) || undefined,
    });
  }

  // Leverage points — score + rank.
  const levSeen = new Set<string>();
  const leveragePoints: LeveragePoint[] = [];
  for (const lp of raw?.leverage_points ?? []) {
    const slug = slugify(String(lp?.slug ?? lp?.label ?? ""));
    const label = String(lp?.label ?? "").trim().slice(0, 80);
    if (!slug || !label || levSeen.has(slug)) continue;
    levSeen.add(slug);
    const s = lp?.scores ?? ({} as SynthesizerRaw["leverage_points"][number]["scores"]);
    const scores = {
      meadows: clamp5(s.meadows),
      bindingness: clamp5(s.bindingness),
      fanOut: clamp5(s.fan_out),
      pareto: clamp5(s.pareto),
      feasibility: clamp5(s.feasibility),
      contradiction: clamp5(s.contradiction),
    };
    const raw01 =
      scores.meadows * LEVERAGE_WEIGHTS.meadows +
      scores.bindingness * LEVERAGE_WEIGHTS.bindingness +
      scores.fanOut * LEVERAGE_WEIGHTS.fanOut +
      scores.pareto * LEVERAGE_WEIGHTS.pareto +
      scores.feasibility * LEVERAGE_WEIGHTS.feasibility +
      scores.contradiction * LEVERAGE_WEIGHTS.contradiction;
    const score = Math.round((raw01 / LEVERAGE_MAX) * 100);
    const onlyKnownVars = (slugs: unknown): string[] =>
      Array.isArray(slugs)
        ? (slugs as string[])
            .map((x) => slugify(String(x)))
            .filter((x) => varSeen.has(x))
        : [];
    const onlyKnownCons = (slugs: unknown): string[] =>
      Array.isArray(slugs)
        ? (slugs as string[])
            .map((x) => slugify(String(x)))
            .filter((x) => conSeen.has(x))
        : [];
    leveragePoints.push({
      slug,
      label,
      rationale: String(lp?.rationale ?? "").trim().slice(0, 320),
      meadowsLevel: String(lp?.meadows_level ?? "").trim().slice(0, 40),
      targetsVariableSlugs: onlyKnownVars(lp?.targets),
      boundedByConstraintSlugs: onlyKnownCons(lp?.bounded_by),
      scores,
      score,
    });
  }
  leveragePoints.sort((a, b) => b.score - a.score);

  if (variables.length === 0 && leveragePoints.length === 0) return null;
  return { variables, constraints, leveragePoints };
}

// ── First-principles lens (Phase 3) ──

/** First-principle rubric weights — irreducibility + counterfactual-collapse
 *  dominate (the two tests that separate bedrock from symptom), then necessity
 *  / sufficiency / 5-whys, then independence. Max raw = 65. */
const FP_WEIGHTS = {
  irreducibility: 3,
  counterfactual: 3,
  necessity: 2,
  sufficiency: 2,
  fiveWhys: 2,
  independence: 1,
} as const;
const FP_MAX = 5 * (3 + 3 + 2 + 2 + 2 + 1); // 65

/** Identify + score the irreducible truths beneath the leverage points. Uses
 *  the deep model. Soft-fails to [] so a miss never blocks convergence. */
export async function synthesizeFirstPrinciples(args: {
  objective: string;
  preamble: string;
  variables: CrucibleVariable[];
  constraintLines: string[];
  leverageLines: string[];
  /** Known leverage slugs / variable slugs to clamp the `grounds_*` refs to. */
  leverageSlugs: Set<string>;
  variableSlugs: Set<string>;
  questions: CrucibleQuestion[];
  answers: CrucibleAnswer[];
}): Promise<FirstPrinciple[]> {
  let raw: FirstPrinciplesRaw;
  try {
    raw = await llmJSON<FirstPrinciplesRaw>({
      system: firstPrinciplesSystem(),
      user: firstPrinciplesUser({
        objective: args.objective,
        preamble: args.preamble,
        variables: args.variables,
        constraintLines: args.constraintLines,
        leverageLines: args.leverageLines,
        questions: args.questions,
        answers: args.answers,
      }),
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 2400,
      temperature: 0.35,
      responseSchema: FIRST_PRINCIPLES_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.warn("[crucible-engine] first-principles failed (soft):", err);
    return [];
  }

  const seen = new Set<string>();
  const out: FirstPrinciple[] = [];
  for (const fp of raw?.first_principles ?? []) {
    const slug = slugify(String(fp?.slug ?? fp?.label ?? ""));
    const label = String(fp?.label ?? "").trim().slice(0, 80);
    if (!slug || !label || seen.has(slug)) continue;
    seen.add(slug);
    const s = fp?.scores ?? ({} as FirstPrinciplesRaw["first_principles"][number]["scores"]);
    const scores = {
      irreducibility: clamp5(s.irreducibility),
      counterfactual: clamp5(s.counterfactual),
      necessity: clamp5(s.necessity),
      sufficiency: clamp5(s.sufficiency),
      fiveWhys: clamp5(s.five_whys),
      independence: clamp5(s.independence),
    };
    const rawTotal =
      scores.irreducibility * FP_WEIGHTS.irreducibility +
      scores.counterfactual * FP_WEIGHTS.counterfactual +
      scores.necessity * FP_WEIGHTS.necessity +
      scores.sufficiency * FP_WEIGHTS.sufficiency +
      scores.fiveWhys * FP_WEIGHTS.fiveWhys +
      scores.independence * FP_WEIGHTS.independence;
    const clampTo = (slugs: unknown, known: Set<string>): string[] =>
      Array.isArray(slugs)
        ? (slugs as string[]).map((x) => slugify(String(x))).filter((x) => known.has(x))
        : [];
    out.push({
      slug,
      label,
      statement: String(fp?.statement ?? "").trim().slice(0, 320),
      groundsLeverageSlugs: clampTo(fp?.grounds_leverage, args.leverageSlugs),
      groundsVariableSlugs: clampTo(fp?.grounds_variables, args.variableSlugs),
      scores,
      score: Math.round((rawTotal / FP_MAX) * 100),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// ── Roadmap (Phase 4: convergence → sub-objectives + seed features) ──

export interface RoadmapResult {
  subObjectives: CrucibleSubObjective[];
  features: CrucibleFeature[];
}

/** Coin sub-objectives (branches pursuing leverage clusters) + seed features
 *  (each operationalizing a leverage point). Fast model — generative, not
 *  judgment-scoring. Refs are clamped to the known leverage slugs. Soft-fails
 *  to empty so a miss never blocks convergence. */
export async function synthesizeRoadmap(args: {
  objective: string;
  preamble: string;
  leverageLines: string[];
  principleLines: string[];
  constraintLines: string[];
  /** Known leverage slugs — clamp every reference to these. */
  leverageSlugs: Set<string>;
}): Promise<RoadmapResult> {
  let raw: RoadmapRaw;
  try {
    raw = await llmJSON<RoadmapRaw>({
      system: roadmapSystem(),
      user: roadmapUser({
        objective: args.objective,
        preamble: args.preamble,
        leverageLines: args.leverageLines,
        principleLines: args.principleLines,
        constraintLines: args.constraintLines,
      }),
      provider: "anthropic",
      model: BEST_FAST_CLAUDE_MODEL,
      maxTokens: 2000,
      temperature: 0.5,
      responseSchema: ROADMAP_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.warn("[crucible-engine] roadmap failed (soft):", err);
    return { subObjectives: [], features: [] };
  }

  const clampLevers = (slugs: unknown): string[] =>
    Array.isArray(slugs)
      ? (slugs as string[])
          .map((x) => slugify(String(x)))
          .filter((x) => args.leverageSlugs.has(x))
      : [];

  // Sub-objectives — deduped, must pursue ≥1 known lever.
  const soSeen = new Set<string>();
  const subObjectives: CrucibleSubObjective[] = [];
  for (const so of raw?.sub_objectives ?? []) {
    const slug = slugify(String(so?.slug ?? so?.title ?? ""));
    const title = String(so?.title ?? "").trim().slice(0, 90);
    if (!slug || !title || soSeen.has(slug)) continue;
    const leverageSlugs = clampLevers(so?.leverage_slugs);
    if (leverageSlugs.length === 0) continue; // a sub-objective with no lever is noise
    soSeen.add(slug);
    subObjectives.push({
      slug,
      title,
      rationale: String(so?.rationale ?? "").trim().slice(0, 240),
      leverageSlugs,
    });
  }

  // Features — deduped, must operationalize a known lever, confidence ≥ 0.5.
  const fSeen = new Set<string>();
  const features: CrucibleFeature[] = [];
  for (const f of raw?.features ?? []) {
    const slug = slugify(String(f?.slug ?? f?.title ?? ""));
    const title = String(f?.title ?? "").trim().slice(0, 80);
    if (!slug || !title || fSeen.has(slug)) continue;
    const leverageSlug = slugify(String(f?.leverage_slug ?? ""));
    if (!args.leverageSlugs.has(leverageSlug)) continue;
    const confidence =
      typeof f?.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.5;
    if (confidence < 0.5) continue;
    fSeen.add(slug);
    features.push({
      slug,
      title,
      description: String(f?.description ?? "").trim().slice(0, 280),
      leverageSlug,
      confidence,
    });
  }

  return { subObjectives, features };
}

// ── Exploration engine (diverge → converge-to-principle) ──
//
// The brainstorm half of the Crucible (the loop is the converge half). Both
// share this module so there is ONE engine. Used by the explore-ambiguity route
// + the exploration card forked from the heatmap / priority cards.

/** Diverge: generate 3–4 genuinely-different resolutions of one ambiguity.
 *  Soft-fails to [] so a model error surfaces as "no variations" not a 500. */
export async function divergeAnswers(args: {
  objective: string;
  preamble: string;
  headline: string;
  question: string;
  factors: FactorLite[];
}): Promise<ExplorationVariation[]> {
  let raw: DivergeRaw;
  try {
    raw = await llmJSON<DivergeRaw>({
      system: divergeSystem(),
      user: divergeUser(args),
      provider: "anthropic",
      model: BEST_FAST_CLAUDE_MODEL,
      maxTokens: 1400,
      temperature: 0.75, // higher — we WANT spread across the space
      responseSchema: DIVERGE_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.warn("[crucible-engine] diverge failed (soft):", err);
    return [];
  }

  const seen = new Set<string>();
  const out: ExplorationVariation[] = [];
  for (const v of raw?.variations ?? []) {
    const label = String(v?.label ?? "").trim().slice(0, 60);
    const value = String(v?.value ?? "").trim().slice(0, 240);
    if (!label || !value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `v${out.length}`,
      label,
      value,
      rationale: String(v?.rationale ?? "").trim().slice(0, 240),
      implication: String(v?.implication ?? "").trim().slice(0, 200) || undefined,
    });
    if (out.length >= 4) break;
  }
  return out;
}

export interface ConvergeResult {
  principle: string;
  decisions: ExplorationDecision[];
  recommendedIndex: number;
  recommendedWhy: string;
}

/** Converge: distill variations into the intersection (principle) + the
 *  differences (decisions) + a recommended default. Soft-fails to a minimal
 *  result so the card still renders the variations even if convergence misses. */
export async function convergeVariations(args: {
  objective: string;
  headline: string;
  variations: ExplorationVariation[];
}): Promise<ConvergeResult> {
  const fallback: ConvergeResult = {
    principle: "",
    decisions: [],
    recommendedIndex: 0,
    recommendedWhy: "",
  };
  if (args.variations.length === 0) return fallback;

  let raw: ConvergeRaw;
  try {
    raw = await llmJSON<ConvergeRaw>({
      system: convergeSystem(),
      user: convergeUser({
        objective: args.objective,
        headline: args.headline,
        variations: args.variations.map((v) => ({
          label: v.label,
          value: v.value,
          rationale: v.rationale,
        })),
      }),
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL, // the principle is the payoff — use the deep model
      maxTokens: 1400,
      temperature: 0.3,
      responseSchema: CONVERGE_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.warn("[crucible-engine] converge failed (soft):", err);
    return fallback;
  }

  const decisions: ExplorationDecision[] = Array.isArray(raw?.decisions)
    ? raw.decisions
        .map((d) => ({
          axis: String(d?.axis ?? "").trim().slice(0, 60),
          options: Array.isArray(d?.options)
            ? d.options.map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, 5)
            : [],
        }))
        .filter((d) => d.axis && d.options.length > 0)
        .slice(0, 5)
    : [];
  const ri =
    typeof raw?.recommended_index === "number" &&
    raw.recommended_index >= 0 &&
    raw.recommended_index < args.variations.length
      ? Math.floor(raw.recommended_index)
      : 0;
  return {
    principle: String(raw?.principle ?? "").trim().slice(0, 400),
    decisions,
    recommendedIndex: ri,
    recommendedWhy: String(raw?.recommended_why ?? "").trim().slice(0, 200),
  };
}
