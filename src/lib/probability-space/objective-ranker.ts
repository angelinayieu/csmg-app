// ── Objective-Aware Ranker ──
//
// Given a set of convergent points and a set of user objectives, score each
// point's alignment with each objective and compute a composite rank.
//
// Ranking formula:
//   per-point score = Σ over objectives:
//     (objective_weight × alignment × probability × confidence × reversibility_adj × propagation_adj)
//
// Adjustments:
//   - Irreversible positive outcomes get a small bonus (commitment advantage)
//   - Irreversible negative outcomes get a large penalty (can't undo)
//   - Systemic positive outcomes get a bonus (leverage)
//   - Systemic negative outcomes get a large penalty (blast radius)
//   - Local outcomes (positive or negative) stay unadjusted

import { llmJSON } from "@/lib/llm";
import type {
  ConvergentPoint,
  ObjectiveAlignment,
  ConvergentOutcome,
} from "@/types/convergent-point";

export interface Objective {
  id: string;
  title: string;
  objective_type?: "maximize" | "minimize" | "maintain" | "avoid";
  description?: string;
}

// ── LLM prompt for alignment scoring ──

const OBJECTIVE_ALIGNMENT_SYSTEM_PROMPT = `You are an objective-alignment scorer. Given a convergent outcome and a user objective, score how much the outcome advances or undermines the objective.

SCALE:
  +1.0  → outcome directly and strongly advances the objective
  +0.5  → outcome partially advances the objective
   0.0  → outcome is neutral / orthogonal to the objective
  -0.5  → outcome partially undermines the objective
  -1.0  → outcome directly and strongly undermines the objective

RULES:
1. Score based on the OUTCOME, not on probability or confidence (those are applied separately).
2. An outcome can be "positive" in polarity but still be negative for a specific objective (e.g., increased revenue is positive-polarity but negative for a "minimize operational complexity" objective).
3. Be specific in reasoning — name the exact link between outcome and objective.
4. If the outcome is genuinely orthogonal, say "orthogonal" in reasoning and use 0.0.

OUTPUT (strict JSON):
{
  "score": -1.0 to 1.0,
  "reasoning": "string — 1 sentence naming the specific link"
}`;

interface AlignmentScoreResponse {
  score: number;
  reasoning: string;
}

interface BatchAlignmentInput {
  pointIndex: number;                     // 0-based index back into the points array
  objective: Objective;
  outcome: ConvergentOutcome;
}

async function scoreAlignment(
  input: BatchAlignmentInput,
): Promise<ObjectiveAlignment> {
  const objectiveType = input.objective.objective_type ?? "maximize";

  const userPrompt = `USER OBJECTIVE:
  Title: ${input.objective.title}
  Type: ${objectiveType}${input.objective.description ? `\n  Description: ${input.objective.description}` : ""}

CONVERGENT OUTCOME:
  Description: ${input.outcome.description}
  Polarity: ${input.outcome.polarity}
  Mechanism: ${input.outcome.mechanism}
  Time horizon: ${input.outcome.time_horizon}
  Reversibility: ${input.outcome.reversibility}
  Propagation: ${input.outcome.propagation}

Score how much this outcome advances or undermines the objective.`;

  try {
    const response = await llmJSON<AlignmentScoreResponse>({
      system: OBJECTIVE_ALIGNMENT_SYSTEM_PROMPT,
      user: userPrompt,
      model: "gpt-4o-mini",
      maxTokens: 300,
      temperature: 0.2,
      fallback: { score: 0, reasoning: "Alignment scoring failed — defaulting to neutral." },
    });
    return {
      objective_id: input.objective.id,
      objective_title: input.objective.title,
      score: Math.max(-1, Math.min(1, response.score)),
      reasoning: response.reasoning,
    };
  } catch (err) {
    console.warn(`[objective-ranker] Alignment scoring failed for objective ${input.objective.id}:`, err);
    return {
      objective_id: input.objective.id,
      objective_title: input.objective.title,
      score: 0,
      reasoning: "Scoring failed — defaulted to neutral",
    };
  }
}

// ── Composite score (post-alignment) ──

function reversibilityAdjustment(
  polarity: ConvergentOutcome["polarity"],
  reversibility: ConvergentOutcome["reversibility"],
): number {
  // Irreversible negative = large penalty; irreversible positive = small bonus.
  if (reversibility === "irreversible") {
    if (polarity === "negative") return 0.5;
    if (polarity === "positive") return 1.15;
  }
  if (reversibility === "costly_to_reverse") {
    if (polarity === "negative") return 0.8;
    if (polarity === "positive") return 1.05;
  }
  return 1.0;
}

function propagationAdjustment(
  polarity: ConvergentOutcome["polarity"],
  propagation: ConvergentOutcome["propagation"],
): number {
  // Systemic positive = large bonus; systemic negative = large penalty.
  if (propagation === "systemic") {
    if (polarity === "negative") return 0.6;
    if (polarity === "positive") return 1.3;
  }
  if (propagation === "cascading") {
    if (polarity === "negative") return 0.85;
    if (polarity === "positive") return 1.1;
  }
  return 1.0;
}

/**
 * Composite score for a convergent point.
 * Higher is better (more desirable).
 *
 * score = Σ_obj [ objective_weight_obj × alignment_obj ]
 *         × probability × confidence
 *         × reversibility_adj × propagation_adj
 *
 * We weight all objectives equally unless caller passes custom weights.
 */
export function compositeScore(
  point: {
    outcome: ConvergentOutcome;
    probability: number;
    confidence: number;
    objective_alignment: ObjectiveAlignment[];
  },
  objectiveWeights: Map<string, number> = new Map(),
): number {
  const alignmentSum = point.objective_alignment.reduce((acc, a) => {
    const w = objectiveWeights.get(a.objective_id) ?? 1;
    return acc + w * a.score;
  }, 0);
  const alignmentMean =
    point.objective_alignment.length > 0
      ? alignmentSum / point.objective_alignment.length
      : 0;

  const prob = point.probability;
  const conf = point.confidence;
  const revAdj = reversibilityAdjustment(point.outcome.polarity, point.outcome.reversibility);
  const propAdj = propagationAdjustment(point.outcome.polarity, point.outcome.propagation);

  return alignmentMean * prob * conf * revAdj * propAdj;
}

// ── Public entry point ──

const PARALLELISM = 6;

export async function rankConvergentPoints(
  points: Array<{
    outcome: ConvergentOutcome;
    probability: number;
    confidence: number;
    // These are written to after ranking.
    objective_alignment?: ObjectiveAlignment[];
  }>,
  objectives: Objective[],
  objectiveWeights?: Map<string, number>,
): Promise<{
  ranked: Array<{
    index: number;                         // back into original points array
    composite_score: number;
    objective_alignment: ObjectiveAlignment[];
  }>;
  stats: { llm_calls: number };
}> {
  if (points.length === 0 || objectives.length === 0) {
    return {
      ranked: points.map((_, idx) => ({ index: idx, composite_score: 0, objective_alignment: [] })),
      stats: { llm_calls: 0 },
    };
  }

  // Build flat batch of (pointIdx, objective) pairs
  const batch: BatchAlignmentInput[] = [];
  for (let pi = 0; pi < points.length; pi++) {
    for (const obj of objectives) {
      batch.push({ pointIndex: pi, objective: obj, outcome: points[pi].outcome });
    }
  }

  // Bounded parallelism
  const alignments: Array<ObjectiveAlignment | null> = new Array(batch.length).fill(null);
  for (let i = 0; i < batch.length; i += PARALLELISM) {
    const chunk = batch.slice(i, i + PARALLELISM);
    const results = await Promise.all(chunk.map((b) => scoreAlignment(b)));
    for (let j = 0; j < chunk.length; j++) {
      alignments[i + j] = results[j];
    }
  }

  // Regroup by point and compute composite
  const alignmentByPoint = new Map<number, ObjectiveAlignment[]>();
  for (let i = 0; i < batch.length; i++) {
    const pi = batch[i].pointIndex;
    const a = alignments[i];
    if (!a) continue;
    const arr = alignmentByPoint.get(pi) ?? [];
    arr.push(a);
    alignmentByPoint.set(pi, arr);
  }

  const ranked = points.map((pt, idx) => {
    const pointAlignments = alignmentByPoint.get(idx) ?? [];
    const composite = compositeScore(
      { ...pt, objective_alignment: pointAlignments },
      objectiveWeights,
    );
    return { index: idx, composite_score: composite, objective_alignment: pointAlignments };
  });

  ranked.sort((a, b) => b.composite_score - a.composite_score);

  return { ranked, stats: { llm_calls: batch.length } };
}
