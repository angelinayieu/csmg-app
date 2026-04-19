# Phase 5 Threshold Tuning Guide

## Goal
Tune intersection detector thresholds with a labeled sample set to reduce lexical false positives while preserving semantic recall.

## Tunable env vars
- `PS_EMBEDDING_SIM_THRESHOLD` (default `0.78`)
- `PS_NAME_SIM_THRESHOLD` (default `0.45`)
- `PS_ROLE_SIM_THRESHOLD` (default `0.35`)

## Recommended workflow
1. Build/collect a labeled sample set of intersection pairs:
   - True semantic matches (`is_true_match=true`)
   - Known false lexical overlaps (`is_true_match=false`)
2. Start from template at [src/lib/pipeline/intersection-validation-sample.template.json](src/lib/pipeline/intersection-validation-sample.template.json).
3. Run base evaluation using `evaluateIntersectionThresholds()` in [src/lib/pipeline/intersection-threshold-evaluator.ts](src/lib/pipeline/intersection-threshold-evaluator.ts).
4. Sweep threshold values with `sweepIntersectionThresholds()` and select recommendation from `recommendThresholds()`.
4. Select threshold set that improves precision with acceptable recall loss.
5. Lock selected thresholds in environment config.

## Starter target
- Precision >= 0.75
- Recall >= 0.60
- F1 >= 0.66

## Notes
- Keep lexical fallback enabled for nodes without embeddings.
- Re-run evaluation after significant prompt or expansion schema changes.

## Minimal usage pattern
- Call `sweepIntersectionThresholds({...})` with labeled pairs.
- Inspect top-N candidates by `evaluation.f1`.
- Choose recommended candidate from `recommendThresholds(results)`.
- Set env vars:
   - `PS_EMBEDDING_SIM_THRESHOLD`
   - `PS_NAME_SIM_THRESHOLD`
   - `PS_ROLE_SIM_THRESHOLD`
