import type { Entity, Edge } from "@/types";
import type { ProbabilitySpace } from "@/types/probability-space";
import { detectIntersections } from "@/lib/pipeline/intersection-detector";
import type { IntersectionThresholds } from "@/lib/pipeline/intersection-thresholds";

export interface LabeledIntersectionPair {
  space_a_id: string;
  space_b_id: string;
  is_true_match: boolean;
}

export interface IntersectionThresholdEvaluation {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  predicted_count: number;
  labeled_count: number;
}

export interface ThresholdSweepResult {
  thresholds: IntersectionThresholds;
  evaluation: IntersectionThresholdEvaluation;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Evaluates current detector thresholds against a labeled validation set.
 * Useful for tuning PS_* threshold env vars.
 */
export function evaluateIntersectionThresholds(params: {
  spaces: ProbabilitySpace[];
  entities: Entity[];
  edges: Edge[];
  labels: LabeledIntersectionPair[];
  maxIntersections?: number;
  thresholds?: IntersectionThresholds;
}): IntersectionThresholdEvaluation {
  const detected = detectIntersections(
    params.spaces,
    params.entities,
    params.edges,
    params.maxIntersections ?? 200,
    params.thresholds
  );

  const predictedKeys = new Set(
    detected.map((i) => pairKey(i.space_a_id, i.space_b_id))
  );

  const trueKeys = new Set(
    params.labels.filter((l) => l.is_true_match).map((l) => pairKey(l.space_a_id, l.space_b_id))
  );

  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const k of predictedKeys) {
    if (trueKeys.has(k)) tp++;
    else fp++;
  }

  for (const k of trueKeys) {
    if (!predictedKeys.has(k)) fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision,
    recall,
    f1,
    tp,
    fp,
    fn,
    predicted_count: predictedKeys.size,
    labeled_count: params.labels.length,
  };
}

export function sweepIntersectionThresholds(params: {
  spaces: ProbabilitySpace[];
  entities: Entity[];
  edges: Edge[];
  labels: LabeledIntersectionPair[];
  maxIntersections?: number;
  embeddingThresholds?: number[];
  nameThresholds?: number[];
  roleThresholds?: number[];
}): ThresholdSweepResult[] {
  const embedding = params.embeddingThresholds ?? [0.72, 0.75, 0.78, 0.8, 0.83];
  const name = params.nameThresholds ?? [0.35, 0.4, 0.45, 0.5, 0.55];
  const role = params.roleThresholds ?? [0.25, 0.3, 0.35, 0.4, 0.45];

  const results: ThresholdSweepResult[] = [];

  for (const e of embedding) {
    for (const n of name) {
      for (const r of role) {
        const thresholds: IntersectionThresholds = {
          embedding_similarity: e,
          name_similarity: n,
          role_similarity: r,
        };
        const evaluation = evaluateIntersectionThresholds({
          spaces: params.spaces,
          entities: params.entities,
          edges: params.edges,
          labels: params.labels,
          maxIntersections: params.maxIntersections,
          thresholds,
        });
        results.push({ thresholds, evaluation });
      }
    }
  }

  return results.sort((a, b) => b.evaluation.f1 - a.evaluation.f1);
}

export function recommendThresholds(results: ThresholdSweepResult[]): ThresholdSweepResult | null {
  if (results.length === 0) return null;

  // Prefer higher precision when F1 is close (safer default for false-positive reduction).
  const bestF1 = results[0].evaluation.f1;
  const candidates = results.filter((r) => r.evaluation.f1 >= bestF1 - 0.03);

  return candidates.sort((a, b) => {
    if (b.evaluation.precision !== a.evaluation.precision) {
      return b.evaluation.precision - a.evaluation.precision;
    }
    return b.evaluation.f1 - a.evaluation.f1;
  })[0];
}
