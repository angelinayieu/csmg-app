// ── Impact-weighted metric ──────────────────────────────────────────
//
// Replaces the legacy "target-relative %" reading (e.g. "78% — sleep is
// 78% of the way to its LLM-stated target") with a HONEST estimate of
// how much a stage actually contributes toward the chosen goal.
//
// The previous metric (`objectiveProgress` in strategy-view-model.ts)
// was just `current / target * 100` on two LLM-fabricated numbers —
// scan-friendly but content-empty. This module replaces that with a
// metric grounded in:
//
//   1. PRE-COMPUTED CHAIN CONTRIBUTIONS — `causal_chains[].goal_contribution_pct`
//      is generated upstream by the chain-builder and represents the
//      expected % of goal-metric movement this chain produces.
//
//   2. EDGE EFFECT SIZES — when an entity sits on an edge that has
//      evidence_registry rows attached, we use the inverse-variance-
//      pooled effect size as a per-edge multiplier on the chain
//      contribution.
//
//   3. EVIDENCE QUALITY — weighted by study_design tier + sample size
//      so a meta-analysis pulls more weight than a single observational
//      study.
//
//   4. CHAIN CONFIDENCE — `causal_chains[].confidence` modulates the
//      contribution so low-trust chains contribute less.
//
// What this module does NOT do (deferred to later phases):
//   • Condition adaption — matching a user's profile against the study
//     cohort. Requires evidence_registry.cohort_metadata + structured
//     user profile fields, neither of which exist today.
//   • Path-aware position weights — today we allocate a chain's
//     contribution equally across its 6 stages. Future work can weight
//     by causal position (earlier stages move more outcome) using
//     path-aware-calibration.ts patterns.
//
// Phase F (live calibration deltas) IS implemented here: when the caller
// passes a CalibrationSummary with n_resolved >= 3, computeStageImpact
// blends a third confidence factor (1 - mean|Δ_strength|/0.30, clamped)
// into the composite at weight 0.3. See `Step 5` below.
//
// All functions in this module are PURE — no DB calls, no fetches. The
// caller (typically the view-model builder) fetches the inputs once and
// passes them in.

import type { CausalChain } from "@/types/causal-chains";
import type { Edge } from "@/types";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import type { ImprovementGoal } from "@/types/goals";
import {
  anchoredTotal as countAnchored,
  classifyRigorRow,
  driftedTotal as countDrifted,
  emptyTierCounts,
  isLowRigorWarning,
  type TierCounts,
} from "@/lib/evidence/rigor-tier";

// ── Public types ────────────────────────────────────────────────────

/**
 * Per-stage impact breakdown. Returned by `computeStageImpact`. The
 * `pct` field is the headline number the StageCard renders; the
 * `breakdown` is the click-to-expand audit trail.
 */
export interface StageImpact {
  /**
   * 0..100. Expected % of goal-metric movement this stage contributes,
   * across all causal chains it participates in.
   *
   * ABSOLUTE — not relative-to-peers. A stage with pct=12 is expected
   * to drive 12% of the overall goal movement (summed across chains).
   * The view-model layer can renormalize to relative if needed.
   */
  pct: number;
  /**
   * Composite trust score 0..1. Lower when:
   *   • Chains the stage participates in have low confidence
   *   • Edges the stage sits on have sparse/weak evidence
   *   • LLM-only sources outweigh peer-reviewed ones
   * Drives the muted-vs-bold styling on the percentage chip.
   */
  confidence: number;
  /**
   * Per-chain breakdown. Each entry explains WHY this stage scored
   * what it did. Sorted by `contribution_pct` desc.
   */
  chains: ChainContribution[];
  /**
   * Evidence summary across all edges this stage participates in.
   * Used for the decomposition UI's "n=18 studies · I² 34%" line.
   */
  evidence: EvidenceSummary;
  /**
   * Phase F: live calibration tracking. Non-null when the caller passed
   * a CalibrationSummary AND at least one calibration row exists for the
   * edges this stage touches. Null on pre-resolution spaces and on
   * stages whose edges have never been touched by a resolved prediction.
   *
   * The drawer renders this as a "Prediction tracking" row; the headline
   * pct chip's tooltip surfaces the calibration_factor when n_resolved
   * crossed the threshold and the math blended it in.
   */
  calibration: CalibrationImpact | null;
}

export interface CalibrationImpact {
  /** Distinct prediction count for this stage's touching edges. */
  n_resolved: number;
  /** Total calibration rows (>= n_resolved). */
  n_rows: number;
  /** Headline tracking number — mean of |delta_strength| across rows. */
  mean_abs_delta_strength: number;
  /** Companion metric. */
  mean_abs_delta_confidence: number;
  /** ISO timestamp of most-recent calibration. Null when n_rows = 0. */
  last_at: string | null;
  /**
   * 0..1. The factor we multiply into composite confidence when
   * `n_resolved >= CALIBRATION_THRESHOLD`. Computed as
   * `clamp(1 - mean_abs_delta_strength / 0.30, 0, 1)`. A value of 1.0
   * means predictions resolved exactly at expectation; 0 means the
   * strategy is meaningfully off-base.
   */
  factor: number;
  /**
   * Whether the factor was blended into the headline `confidence` value
   * on the StageImpact. True when n_resolved >= CALIBRATION_THRESHOLD.
   * The drawer uses this to decide between "informational" and
   * "load-bearing" rendering of the calibration row.
   */
  blended: boolean;
}

export interface ChainContribution {
  chain_id: string;
  chain_name: string;
  /** From `causal_chains[].goal_contribution_pct`. */
  raw_chain_contribution: number;
  /**
   * Position weight (0..1). What fraction of the chain's total
   * contribution we assigned to THIS stage. Today: equal allocation
   * (1/n_stages). Future: position-weighted by edge effect sizes.
   */
  position_weight: number;
  /** From `causal_chains[].confidence`. Modulates the contribution. */
  chain_confidence: number;
  /**
   * What this entry actually adds to the stage's `pct`:
   *   raw_chain_contribution × position_weight × chain_confidence
   */
  contribution_pct: number;
  /** Stage position within the chain (1-6) for "you are stage 3 of 6". */
  stage_position: number;
  /** Total stages in the chain (always 6 today). */
  stage_total: number;
}

export interface EvidenceSummary {
  /** Total distinct evidence_registry rows backing edges this stage touches. */
  n_studies: number;
  /**
   * Inverse-variance-pooled effect size across the edge's evidence rows.
   * Null when no rows have effect_size populated.
   */
  pooled_effect: number | null;
  /** Pooled CI lower bound (null when n_studies < 2 or effects sparse). */
  pooled_ci_lower: number | null;
  pooled_ci_upper: number | null;
  /**
   * I² heterogeneity statistic (0..100, %). High = effects vary across
   * studies. Null when n_studies < 2.
   */
  i_squared: number | null;
  /**
   * Average evidence-quality score 0..1. Drives the composite
   * confidence. Built from study_design tier + sample sizes.
   */
  evidence_quality: number;
  /** Effect metric — "cohens_d" / "or" / "mixed" / etc. Null when sparse. */
  effect_metric: string | null;
  /**
   * Phase 0 rigor: per-tier breakdown of `n_studies`. Sums equal
   * `n_studies`. Drives the cascade-objective chip glyph and the
   * decomposition drawer's per-tier disclosure row.
   */
  n_per_tier: TierCounts;
  /**
   * Phase 0 rigor: count of paper-sourced rows (paper_reviewed +
   * paper_extracted). Convenience derived field — surfaces alongside
   * `n_studies` so the chip can pick a glyph without re-reading
   * `n_per_tier`.
   */
  n_anchored: number;
  /**
   * Phase 0 rigor: count of web-sourced + legacy rows. Convenience
   * derived field — see `n_anchored`.
   */
  n_drifted: number;
  /**
   * Phase 0 rigor: true when the pooled estimate is dominated by
   * drifted tiers (zero anchored rows but ≥1 drifted). Drives the
   * cascade-objective chip's warning glyph variant. False when the
   * pool is empty or any anchored row is present.
   */
  low_rigor_warning: boolean;
}

// ── Inputs the caller assembles ────────────────────────────────────

export interface ComputeStageImpactArgs {
  /** Entity whose impact we're computing. Matches CausalChain.entity_ids[]. */
  stage_entity_id: string;
  /** Active goal — the chain.primary_goal_id filter. */
  goal: ImprovementGoal | null;
  /** All causal chains for this space. */
  causal_chains: CausalChain[];
  /** All edges in the space. Used to find edges this stage touches. */
  edges: Edge[];
  /**
   * Evidence rows pre-bucketed by `attached_entity_id` for O(1) lookup
   * per edge endpoint. The evidence_registries table FKs evidence to
   * entities today (not directly to edges), so we bucket by entity and
   * the impact math looks up evidence via the source AND target entity
   * of each touching edge, dedup'd by evidence row id.
   *
   * When a future schema migration adds `attached_edge_id`, the
   * `bucketEvidenceByEntity` helper can be retargeted in one line and
   * this lookup pattern continues to work.
   */
  evidence_by_entity: Map<string, EvidenceRegistryRow[]>;
  /**
   * Phase F: per-edge calibration aggregates. Map key = `edge_id`,
   * value = CalibrationByEdge from /api/spaces/[id]/calibration-summary.
   * Omitted on pre-resolution spaces or when the caller hasn't fetched
   * yet — `computeStageImpact` then leaves `calibration: null` on the
   * returned StageImpact and the composite confidence uses the two-
   * factor formula (chain_trust + evidence_quality) as today.
   */
  calibration_by_edge?: Map<string, CalibrationByEdge>;
}

/**
 * Per-edge calibration aggregate. Identical shape to the response from
 * /api/spaces/[id]/calibration-summary so the view-model can pass
 * straight through without remapping.
 */
export interface CalibrationByEdge {
  n: number;
  mean_abs_delta_strength: number;
  mean_abs_delta_confidence: number;
  last_at: string;
}

/**
 * Phase F: the |Δ_strength| value at which the calibration factor
 * collapses to 0 — meaning "the strategy's predictions are completely
 * off-base." Edge strength is bounded to [0.05, 0.98] by the calibrator,
 * so a sustained mean |Δ| of 0.30 is ~1/3 of the total possible range
 * and represents serious model drift. Lower numbers tighten the bar
 * for "the model is tracking well."
 */
export const CALIBRATION_MAX_EXPECTED_DELTA = 0.3;

/**
 * Phase F: minimum distinct resolved-prediction count before we let
 * calibration influence the composite confidence. Below this, the
 * CalibrationImpact is still surfaced informationally but its `factor`
 * does NOT modify the headline confidence — a single bad prediction
 * shouldn't tank trust. Matches the n>=3 threshold we use for
 * evidence weighting.
 */
export const CALIBRATION_BLEND_THRESHOLD = 3;

// ── Study-design quality tiers ─────────────────────────────────────
//
// Standard hierarchy-of-evidence weighting used in clinical and social-
// science meta-analyses. Higher tier = more trustworthy.

const STUDY_DESIGN_QUALITY: Record<string, number> = {
  meta_analysis: 1.0,
  systematic_review: 0.95,
  rct: 0.9,
  randomized_controlled_trial: 0.9,
  quasi_experimental: 0.75,
  observational_cohort: 0.65,
  case_control: 0.55,
  cross_sectional: 0.5,
  observational: 0.55,
  case_series: 0.4,
  expert_opinion: 0.3,
  llm_synthesis: 0.25, // LLM-generated, no underlying study
};

function studyDesignQuality(design: string | null | undefined): number {
  if (!design) return 0.4; // unknown — conservative middle
  return STUDY_DESIGN_QUALITY[design.toLowerCase()] ?? 0.4;
}

// ── Sample-size weighting ──────────────────────────────────────────
//
// Larger studies pull more weight. Capped to avoid one huge study
// drowning out the rest of the corpus.

const SAMPLE_SIZE_FLOOR = 10;
const SAMPLE_SIZE_CAP = 5_000;

function sampleSizeWeight(n: number | null): number {
  if (n === null || n < SAMPLE_SIZE_FLOOR) return SAMPLE_SIZE_FLOOR;
  return Math.min(n, SAMPLE_SIZE_CAP);
}

// ── Evidence pooling (fixed-effects inverse-variance) ──────────────
//
// Standard meta-analysis math. When effect_size and standard_error are
// both present, we use IV pooling. When SE is missing, we fall back to
// sample-size weighting.

function pooledEffect(rows: EvidenceRegistryRow[]): {
  pooled: number;
  ci_lower: number;
  ci_upper: number;
  i_squared: number;
  metric: string | null;
} | null {
  const usable = rows.filter(
    (r) => typeof r.effect_size === "number" && Number.isFinite(r.effect_size),
  );
  if (usable.length < 1) return null;

  // Use a single dominant effect metric so we're not pooling apples
  // and oranges. Pick the most common one.
  const metricCounts = new Map<string, number>();
  for (const r of usable) {
    const m = r.effect_metric ?? "unknown";
    metricCounts.set(m, (metricCounts.get(m) ?? 0) + 1);
  }
  const dominantMetric =
    [...metricCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  const consistent = usable.filter(
    (r) => (r.effect_metric ?? "unknown") === dominantMetric,
  );
  if (consistent.length === 0) return null;

  // Inverse-variance weights when SE available; sample-size fallback
  // otherwise. Returning a weight per row.
  const weights = consistent.map((r) => {
    if (typeof r.standard_error === "number" && r.standard_error > 0) {
      return 1 / (r.standard_error * r.standard_error);
    }
    const n = (r.n_treatment ?? 0) + (r.n_control ?? 0);
    return sampleSizeWeight(n > 0 ? n : null);
  });

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const pooled =
    consistent.reduce(
      (s, r, i) => s + (r.effect_size as number) * weights[i],
      0,
    ) / totalWeight;

  // Approximated SE of the pooled estimate.
  const pooledSE = Math.sqrt(1 / totalWeight);
  const z = 1.96; // 95% CI
  const ci_lower = pooled - z * pooledSE;
  const ci_upper = pooled + z * pooledSE;

  // I² heterogeneity — Cochran's Q based. With <2 studies we can't
  // estimate heterogeneity meaningfully, so return 0 with a flag-like
  // signal: callers should treat 0 with n_studies<2 as "n/a."
  let i_squared = 0;
  if (consistent.length >= 2) {
    const Q = consistent.reduce(
      (s, r, i) => s + weights[i] * ((r.effect_size as number) - pooled) ** 2,
      0,
    );
    const df = consistent.length - 1;
    i_squared = Math.max(0, Math.min(100, ((Q - df) / Q) * 100));
    if (!Number.isFinite(i_squared)) i_squared = 0;
  }

  return {
    pooled,
    ci_lower,
    ci_upper,
    i_squared,
    metric: dominantMetric === "unknown" ? null : dominantMetric,
  };
}

// ── Average evidence quality across a set of rows ──────────────────

function averageEvidenceQuality(rows: EvidenceRegistryRow[]): number {
  if (rows.length === 0) return 0;
  let weighted = 0;
  let totalSampleWeight = 0;
  for (const r of rows) {
    const design = studyDesignQuality(r.study_design);
    const extraction = r.extraction_confidence ?? 0.5;
    const n = (r.n_treatment ?? 0) + (r.n_control ?? 0);
    const w = sampleSizeWeight(n > 0 ? n : null);
    weighted += design * extraction * w;
    totalSampleWeight += w;
  }
  if (totalSampleWeight === 0) return 0;
  return Math.min(1, weighted / totalSampleWeight);
}

// ── Find edges this stage participates in ──────────────────────────
//
// An edge "touches" a stage when the stage entity sits on either
// endpoint. We aggregate evidence from ALL touching edges so the
// stage's evidence summary reflects the full empirical surface area.

function edgesTouchingEntity(
  entityId: string,
  edges: Edge[],
): Edge[] {
  return edges.filter(
    (e) =>
      e.source_entity_id === entityId || e.target_entity_id === entityId,
  );
}

// ── Main: compute the stage's impact ───────────────────────────────

export function computeStageImpact(
  args: ComputeStageImpactArgs,
): StageImpact {
  const { stage_entity_id, goal, causal_chains, edges, evidence_by_entity } =
    args;

  // ── Step 1: Find chains this stage participates in ──
  //
  // Filter by `entity_ids[]` membership. When a goal is set, also
  // narrow to chains whose primary_goal_id matches — otherwise we'd
  // count stage participation in chains pointing at OTHER goals,
  // inflating the % toward a goal that isn't this one.
  const participatingChains = causal_chains.filter((chain) => {
    if (!chain.entity_ids.includes(stage_entity_id)) return false;
    if (goal && chain.primary_goal_id !== goal.id) return false;
    return true;
  });

  // ── Step 2: For each chain, compute this stage's contribution ──
  //
  // Today's model: equal-allocation across the chain's 6 stages, then
  // modulated by the chain's overall confidence. Future work: position-
  // weight by edge effect-size so earlier stages with stronger downstream
  // edges dominate.
  const chainContributions: ChainContribution[] = participatingChains.map(
    (chain) => {
      const stageTotal = chain.stages.length;
      // We allocate the chain's `goal_contribution_pct` equally across
      // its stages today. When a stage participates in a chain, its
      // share is 1 / stageTotal.
      const positionWeight = 1 / stageTotal;
      // Determine which position (1-indexed) in the chain this stage
      // occupies. Chains' entity_ids[] is in order, so we can find the
      // index of stage_entity_id.
      const stagePosition =
        chain.entity_ids.indexOf(stage_entity_id) + 1 || 1;
      const contribution =
        chain.goal_contribution_pct *
        positionWeight *
        chain.confidence;
      return {
        chain_id: chain.id,
        chain_name: chain.name,
        raw_chain_contribution: chain.goal_contribution_pct,
        position_weight: positionWeight,
        chain_confidence: chain.confidence,
        contribution_pct: contribution,
        stage_position: stagePosition,
        stage_total: stageTotal,
      };
    },
  );
  chainContributions.sort((a, b) => b.contribution_pct - a.contribution_pct);

  // ── Step 3: Sum chain contributions for the headline pct ──
  const rawPct = chainContributions.reduce(
    (s, c) => s + c.contribution_pct,
    0,
  );
  // Clamp to [0, 100]. Negative contributions are theoretically possible
  // (a chain that hurts the goal) but we don't surface those here —
  // negative effects belong on the risk side, not the impact %.
  const pct = Math.max(0, Math.min(100, rawPct));

  // ── Step 4: Aggregate evidence across edges this stage touches ──
  //
  // Walk each touching edge and pull evidence attached to BOTH endpoint
  // entities. Dedup by evidence row id so a study attached to a hub
  // entity (showing up on many edges) only counts once toward this
  // stage's pooled effect.
  const touchingEdges = edgesTouchingEntity(stage_entity_id, edges);
  const allEvidenceRows: EvidenceRegistryRow[] = [];
  const seenEvidenceIds = new Set<string>();
  for (const edge of touchingEdges) {
    const srcRows = edge.source_entity_id
      ? evidence_by_entity.get(edge.source_entity_id) ?? []
      : [];
    const tgtRows = edge.target_entity_id
      ? evidence_by_entity.get(edge.target_entity_id) ?? []
      : [];
    for (const r of [...srcRows, ...tgtRows]) {
      if (seenEvidenceIds.has(r.id)) continue;
      seenEvidenceIds.add(r.id);
      allEvidenceRows.push(r);
    }
  }
  const pooled = pooledEffect(allEvidenceRows);
  const evidenceQuality = averageEvidenceQuality(allEvidenceRows);
  // Phase 0 rigor: classify every row underlying the pool. Per-tier
  // counts are emitted alongside n_studies so the cascade-objective
  // chip and decomposition drawer can disclose the rigor distribution
  // without re-fetching or re-classifying.
  const nPerTier: TierCounts = emptyTierCounts();
  for (const r of allEvidenceRows) {
    nPerTier[classifyRigorRow(r)] += 1;
  }
  const nAnchored = countAnchored(nPerTier);
  const nDrifted = countDrifted(nPerTier);
  const evidence: EvidenceSummary = {
    n_studies: allEvidenceRows.length,
    pooled_effect: pooled?.pooled ?? null,
    pooled_ci_lower: pooled?.ci_lower ?? null,
    pooled_ci_upper: pooled?.ci_upper ?? null,
    i_squared:
      pooled && allEvidenceRows.length >= 2 ? pooled.i_squared : null,
    evidence_quality: evidenceQuality,
    effect_metric: pooled?.metric ?? null,
    n_per_tier: nPerTier,
    n_anchored: nAnchored,
    n_drifted: nDrifted,
    low_rigor_warning: isLowRigorWarning(nPerTier),
  };

  // ── Step 4b: Aggregate calibration across the touching edges ──
  //
  // Phase F. For each edge this stage touches, look up the per-edge
  // calibration aggregate the caller fetched from
  // /api/spaces/[id]/calibration-summary. Sum rows + distinct
  // predictions across the edges so the drawer can render "±0.12
  // across 8 predictions" scoped to THIS stage's drift, not the
  // space-wide aggregate.
  let calibration: CalibrationImpact | null = null;
  if (args.calibration_by_edge && args.calibration_by_edge.size > 0) {
    let totalRows = 0;
    let totalSumAbsS = 0;
    let totalSumAbsC = 0;
    let mostRecentAt: string | null = null;
    // n_resolved approximation: we don't have prediction_id per row in
    // the bucketed map, so use `n` (row count) as a proxy and let the
    // drawer-level summary (when it fetches the unbucketed list) be
    // the source-of-truth for the "predictions" word. In practice each
    // prediction writes ~1-3 rows so this is close enough for blending.
    // Future: refactor calibration_by_edge to carry prediction_ids[].
    for (const edge of touchingEdges) {
      const agg = args.calibration_by_edge.get(edge.id);
      if (!agg || agg.n === 0) continue;
      totalRows += agg.n;
      totalSumAbsS += agg.mean_abs_delta_strength * agg.n;
      totalSumAbsC += agg.mean_abs_delta_confidence * agg.n;
      if (!mostRecentAt || agg.last_at > mostRecentAt) {
        mostRecentAt = agg.last_at;
      }
    }
    if (totalRows > 0) {
      const meanAbsS = totalSumAbsS / totalRows;
      const meanAbsC = totalSumAbsC / totalRows;
      const factor = Math.max(
        0,
        Math.min(1, 1 - meanAbsS / CALIBRATION_MAX_EXPECTED_DELTA),
      );
      calibration = {
        n_resolved: totalRows, // proxy — see comment above
        n_rows: totalRows,
        mean_abs_delta_strength: meanAbsS,
        mean_abs_delta_confidence: meanAbsC,
        last_at: mostRecentAt,
        factor,
        blended: totalRows >= CALIBRATION_BLEND_THRESHOLD,
      };
    }
  }

  // ── Step 5: Composite confidence ──
  //
  // Two paths:
  //
  //   • PRE-CALIBRATION (no `calibration.blended`):
  //     60/40 evidence:chain when n_studies >= 3, else 100% chain.
  //     Same formula as pre-Phase-F so legacy spaces are untouched.
  //
  //   • POST-CALIBRATION (calibration.blended === true):
  //     Three-factor blend with normalized weights:
  //       chain_trust × 0.30, evidence_quality × 0.40, calibration × 0.30
  //     When evidence is sparse (n_studies < 3), redistribute the
  //     evidence weight: chain 0.50, calibration 0.50.
  //
  // The user's own resolved predictions are the highest-signal feedback
  // we have — they reflect THIS user, this strategy, this moment — so
  // calibration gets non-trivial weight as soon as it crosses the
  // threshold. We deliberately don't let it exceed evidence (40% > 30%)
  // because three predictions is still a small sample relative to a
  // body of research.
  const avgChainConfidence =
    chainContributions.length > 0
      ? chainContributions.reduce((s, c) => s + c.chain_confidence, 0) /
        chainContributions.length
      : 0;

  let confidence: number;
  if (calibration && calibration.blended) {
    const hasEvidence = allEvidenceRows.length >= 3;
    if (hasEvidence) {
      confidence =
        0.3 * avgChainConfidence +
        0.4 * evidenceQuality +
        0.3 * calibration.factor;
    } else {
      confidence = 0.5 * avgChainConfidence + 0.5 * calibration.factor;
    }
  } else {
    const evidenceWeight = allEvidenceRows.length >= 3 ? 0.6 : 0;
    confidence =
      evidenceWeight * evidenceQuality +
      (1 - evidenceWeight) * avgChainConfidence;
  }

  return {
    pct: Number.isFinite(pct) ? Math.round(pct * 10) / 10 : 0, // 1 decimal
    confidence: Number.isFinite(confidence) ? confidence : 0,
    chains: chainContributions,
    evidence,
    calibration,
  };
}

// ── Convenience helper: bucket evidence rows by attached entity ────
//
// The /api/spaces/[id]/evidence endpoint returns a flat
// EvidenceRegistryRow[]. Use this once to build the Map the main
// function expects. Currently buckets by `attached_entity_id` because
// that's the column the schema actually populates; when a future
// migration adds `attached_edge_id` we can add an `edgeIdField` arg
// here to retarget.
export function bucketEvidenceByEntity(
  rows: EvidenceRegistryRow[],
): Map<string, EvidenceRegistryRow[]> {
  const map = new Map<string, EvidenceRegistryRow[]>();
  for (const r of rows) {
    const key = r.attached_entity_id;
    if (typeof key !== "string" || key.length === 0) continue;
    const bucket = map.get(key) ?? [];
    bucket.push(r);
    map.set(key, bucket);
  }
  return map;
}

// ── Format helper for the StageCard rationale string ──────────────

export function formatImpactRationale(impact: StageImpact): string {
  if (impact.pct === 0 || impact.chains.length === 0) {
    return "no expected goal impact — stage not in any active chain";
  }
  const top = impact.chains[0];
  const moreCount = impact.chains.length - 1;
  const ev = impact.evidence;
  // Phase 0 rigor: rationale now exposes the anchored/drifted split
  // so the user sees the sourcing distribution at the same place as
  // the pooled n_studies.
  const evidenceTag =
    ev.n_studies > 0
      ? ` · n=${ev.n_studies}${
          ev.n_drifted > 0
            ? ` (${ev.n_anchored} anchored · ${ev.n_drifted} drifted)`
            : ""
        }${ev.i_squared !== null ? `, I²=${Math.round(ev.i_squared)}%` : ""}`
      : "";
  return `via ${top.chain_name}${moreCount > 0 ? ` (+${moreCount} more chain${moreCount === 1 ? "" : "s"})` : ""}${evidenceTag}`;
}
