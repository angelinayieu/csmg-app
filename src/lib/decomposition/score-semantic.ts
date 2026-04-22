// ── Semantic decomposition scorer ──
//
// The existing `scoreDecompositionQuality` (in lib/decomposition-quality)
// is statistical: entity count × edge density × importance distribution.
// That's what caused the retry-keep bug — a 0-entity decomposition
// scored 0.54 because the math rewarded "correctness of emptiness"
// while a 25-entity decomposition scored 0.41 because it "missed"
// some distribution targets. The retry picker then kept 0 over 25.
//
// This scorer is complementary: it asks the LLM to read the ORIGINAL
// input + the generated output and rate along real quality axes:
//   • coverage — does output surface all important angles?
//   • specificity — are entities concrete, not generic?
//   • non_obviousness — any insights a surface reader would miss?
//   • causal_clarity — do edges name MECHANISMS, not just labels?
//   • hidden_assumptions — did output surface load-bearing unstated axioms?
//   • internal_consistency — any contradictions between entities/edges?
//
// Each criterion scored 0-1 with a short rationale. Overall = mean.
// The orchestrator can then pick the higher-SEMANTIC scoring output,
// not the higher-statistical one — putting the right kind of output
// first.
//
// Cost: one ~2k-token LLM call per scoring pass (roughly $0.01 with
// gpt-4o, $0.04 with Opus). Don't score EVERY generation — score the
// final output and any retry candidates when choosing between them.

import { llmJSON, type LlmProvider } from "@/lib/llm";

export interface SemanticQualityScore {
  overall: number; // 0..1
  criteria: {
    coverage: { score: number; rationale: string };
    specificity: { score: number; rationale: string };
    non_obviousness: { score: number; rationale: string };
    causal_clarity: { score: number; rationale: string };
    hidden_assumptions: { score: number; rationale: string };
    internal_consistency: { score: number; rationale: string };
  };
  flagged_issues: string[];
  /** Short overall summary, user-facing. 1-2 sentences. */
  verdict: string;
}

export interface ScoreSemanticOpts {
  /** Provider to use for the scoring LLM. Opus costs more but is
   *  notably better at spotting vagueness and missing angles.
   *  Defaults to OpenAI to keep scoring cheap. */
  provider?: LlmProvider;
  model?: string;
  /** Optional — the axis or task label, helps the evaluator focus.
   *  E.g. "financial axis probability space" or "decomposition root". */
  taskLabel?: string;
}

const SYSTEM_PROMPT = `You are a rigorous peer reviewer evaluating a structured decomposition (entities + relationships) that an analyst produced from a user's input prompt.

Your job: score the decomposition on six semantic quality criteria. Be strict. A mediocre output that hits structural targets (e.g. 25 entities) but is full of generic names and hand-wavy edges should score low — NOT high.

Score each criterion 0.0–1.0:
• 0.0–0.3: Bad (major issues)
• 0.4–0.6: Mediocre (passable but unimpressive)
• 0.7–0.85: Good (solid, a few things to sharpen)
• 0.86–1.0: Excellent (would pass expert review)

Return strict JSON with this shape:
{
  "criteria": {
    "coverage":             { "score": <0..1>, "rationale": "<1 sentence>" },
    "specificity":          { "score": <0..1>, "rationale": "<1 sentence>" },
    "non_obviousness":      { "score": <0..1>, "rationale": "<1 sentence>" },
    "causal_clarity":       { "score": <0..1>, "rationale": "<1 sentence>" },
    "hidden_assumptions":   { "score": <0..1>, "rationale": "<1 sentence>" },
    "internal_consistency": { "score": <0..1>, "rationale": "<1 sentence>" }
  },
  "flagged_issues": [ "<concrete issue 1>", "<concrete issue 2>" ],
  "verdict": "<1-2 sentence overall judgment>"
}

Criterion definitions:
• coverage: Does the decomposition surface ALL the important angles the input demands? Not just "enough entities" — the RIGHT entities for this specific input.
• specificity: Are entities grounded in THIS situation, or could they appear in a decomposition of a different problem? Generic-sounding entities drag this down.
• non_obviousness: Did the output find anything a beginner reader wouldn't spot? If every entity is in the "obvious list," this is low.
• causal_clarity: Do edges name the MECHANISM (how A produces B), or just a label ("A affects B")? Label-only edges are low.
• hidden_assumptions: Did the output surface load-bearing assumptions the input depends on but didn't state? Highest-insight entities usually live here.
• internal_consistency: Are there relationships that contradict entity descriptions? Flag incoherences.

flagged_issues: 2-5 concrete, specific issues a reviewer would raise. Not "could be better" — say what and why.
verdict: 1-2 sentence overall judgment the user can read in a tooltip.`;

export async function scoreDecompositionSemantic(
  originalInput: string,
  decompositionOutput: string,
  opts: ScoreSemanticOpts = {},
): Promise<SemanticQualityScore> {
  const userMsg = [
    opts.taskLabel ? `Task: ${opts.taskLabel}` : "Task: decomposition evaluation",
    ``,
    `Original user input:`,
    `---`,
    originalInput.slice(0, 4000),
    `---`,
    ``,
    `Decomposition output to evaluate:`,
    `---`,
    decompositionOutput.slice(0, 16000),
    `---`,
    ``,
    `Produce the scoring JSON now.`,
  ].join("\n");

  const raw = await llmJSON<{
    criteria: SemanticQualityScore["criteria"];
    flagged_issues: string[];
    verdict: string;
  }>({
    system: SYSTEM_PROMPT,
    user: userMsg,
    provider: opts.provider,
    model: opts.model,
    temperature: 0.1,
    maxTokens: 2048,
  });

  // Defensive normalization — the LLM sometimes wraps scores into
  // string form or omits a criterion. Fill in reasonable defaults so
  // downstream code can rely on the shape.
  const normScore = (v: unknown, fallback = 0.5): number => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  };

  const normCrit = (
    c: { score: number; rationale: string } | undefined,
  ): { score: number; rationale: string } => ({
    score: normScore(c?.score),
    rationale: c?.rationale ?? "no rationale provided",
  });

  const criteria = {
    coverage: normCrit(raw.criteria?.coverage),
    specificity: normCrit(raw.criteria?.specificity),
    non_obviousness: normCrit(raw.criteria?.non_obviousness),
    causal_clarity: normCrit(raw.criteria?.causal_clarity),
    hidden_assumptions: normCrit(raw.criteria?.hidden_assumptions),
    internal_consistency: normCrit(raw.criteria?.internal_consistency),
  };

  const scores = [
    criteria.coverage.score,
    criteria.specificity.score,
    criteria.non_obviousness.score,
    criteria.causal_clarity.score,
    criteria.hidden_assumptions.score,
    criteria.internal_consistency.score,
  ];
  const overall = scores.reduce((s, v) => s + v, 0) / scores.length;

  return {
    overall,
    criteria,
    flagged_issues: Array.isArray(raw.flagged_issues)
      ? raw.flagged_issues.filter((s: unknown): s is string => typeof s === "string")
      : [],
    verdict: typeof raw.verdict === "string" ? raw.verdict : "no verdict",
  };
}

/**
 * When the orchestrator has two candidate outputs (e.g. initial +
 * retry after self-critique), this picks the better one based on
 * semantic score. Ties broken by entity density — more concrete
 * entities wins when scores match.
 */
export async function chooseHigherQualityDecomposition<
  T extends { text: string; entityCount: number },
>(
  originalInput: string,
  a: T,
  b: T,
  opts: ScoreSemanticOpts = {},
): Promise<{ chosen: T; scores: { a: SemanticQualityScore; b: SemanticQualityScore } }> {
  const [scoreA, scoreB] = await Promise.all([
    scoreDecompositionSemantic(originalInput, a.text, opts),
    scoreDecompositionSemantic(originalInput, b.text, opts),
  ]);

  // Prefer the HIGHER semantic score. If within 0.05, fall back to
  // entity count (tighter decompositions still shouldn't beat empty).
  const delta = scoreA.overall - scoreB.overall;
  let chosen: T;
  if (Math.abs(delta) < 0.05) {
    chosen = a.entityCount >= b.entityCount ? a : b;
  } else {
    chosen = delta > 0 ? a : b;
  }

  return { chosen, scores: { a: scoreA, b: scoreB } };
}
