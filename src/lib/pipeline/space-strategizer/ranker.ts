// ── Composite ranker — turn signals into ordered candidates ──────────
//
// The ranker does three things:
//   1. Apply weighted aggregation to SignalProfile → composite score.
//   2. Estimate token cost per candidate kind.
//   3. Estimate expected insight yield (the "reasoning density" proxy).
//
// Every weight is explicit, documented, and SNAPSHOTTED into the plan
// so calibration can regress against it. No magic constants hidden in
// conditionals — if it matters for ranking, it's a named weight.

import type {
  CandidateScore,
  SignalProfile,
  SpacePlanRequest,
  SpaceWorkKind,
} from "@/types/space-plan";
import type {
  CandidateTarget,
  SignalInputBundle,
} from "./signals";
import { computeSignalProfile } from "./signals";
import {
  AGENT_WEIGHT_PROFILES,
  type AgentWeightProfile,
} from "@/lib/agents/registry";

// ── Default calibrated weights ────────────────────────────────────────
//
// These are the "no prior run data" weights. Once the calibration loop
// has enough PlanCalibrationEvents, the fitted weights override these.
// Rationale per weight is in the comment — don't silently tune without
// updating the rationale.
//
// Heaviest: convergence_count + coverage_gap + goal_proximity. The
// root-cause signals (convergence, causal depth) outweigh raw
// centrality and intersection density because a node many causal
// chains fan INTO is more leverage than a node many undirected paths
// merely pass through. See the Kaufman fan-in diagram rationale.
//
// Lightest: novelty. Novelty without grounding is just noise; it amplifies
// the other signals when they're present but shouldn't dominate.

export const DEFAULT_WEIGHTS: Record<keyof SignalProfile, number> = {
  convergence_count: 0.16,          // ← strongest root-cause signal (fan-in across goals)
  coverage_gap: 0.13,
  causal_depth_normalized: 0.11,    // ← depth upstream from goal
  agent_convergence_count: 0.10,    // ← independent-proposer consensus (opinion fan-in)
  goal_proximity: 0.08,             // ← was 0.12, −0.04 for outcome_alignment (run-focal proximity is sharper)
  outcome_alignment: 0.08,          // ← Phase 3: this-run focal-outcome proximity from frame extractor
  user_controllable_lever: 0.06,    // ← actionable driver — entity is a why-chain user-controllable root
  centrality: 0.05,                 // ← was 0.06, −0.01 for D3 cost_efficiency (structural < causal)
  interaction_density: 0.05,        // ← D4: candidate participates in emergent 3-way interactions
  cost_efficiency: 0.03,            // ← D3 phase 3: cheap-relative-to-budget levers; modulated up to 1.5× under immediate horizon
  calibration_drift: 0.03,          // ← D6 phase 2: stale model regions (recent prediction-error-driven recalibration)
  consequence_breadth: 0.03,        // ← D13a: divergence (downstream-reach) twin of convergence_count; companion to causal_depth/convergence
  uncertainty: 0.02,                // ← was 0.04, −0.02 for D13a consequence_breadth (uncertainty + breadth measure adjacent "what we know about this node")
  layer_crossing: 0.02,             // ← was 0.04, −0.02 for D6 calibration_drift
  intersection_density: 0.01,       // ← was 0.02, −0.01 for D13a consequence_breadth (both reach-adjacent signals)
  controllability_spread: 0.02,
  axis_calibration: 0.01,           // ← was 0.02, −0.01 for D6 calibration_drift
  novelty: 0.01,
};

// Sanity — weights must sum to ~1.0 so the composite lives in [0,1].
// Asserted at module load to catch tuning mistakes early.
(function assertWeightsSum() {
  const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(`[strategizer] DEFAULT_WEIGHTS must sum to 1.0, got ${sum}`);
  }
})();

// ── Token cost estimates per kind ────────────────────────────────────
//
// Rough estimates from actual run telemetry. Used for budget allocation
// only — the planner can request more/less and executors honor that.
// These numbers set the default ALLOCATION, not a hard limit.

const TOKEN_COST_ESTIMATES: Record<SpaceWorkKind, number> = {
  axis: 2200,              // one axis generator call (entities + edges for that lens)
  edge_space: 900,          // per-edge probability sub-graph build (LLM for mechanisms)
  convergent_point: 1800,   // focal node × interactor matrix enumeration
  signature_deepen: 600,    // one ring addition via signature_materializer
  intersection_probe: 1400, // deliberate bridge-test generation
  intervention_combination: 2000, // Phase 4 §5.3 — paired-lever simulation + LLM rationale (~2x edge_space, slightly less than convergent_point)
};

// ── Composite scoring ────────────────────────────────────────────────
//
// The formula:  score = sum( weight_i * signal_i )  over non-null signals,
// re-normalized by the sum of weights whose signals were non-null. That
// way a candidate with only 3/9 applicable signals isn't penalized for
// the other 6 being null (they don't apply to it).

export function computeCompositeScore(
  signals: SignalProfile,
  weights: Record<keyof SignalProfile, number>,
): number {
  let weighted = 0;
  let applicableWeightSum = 0;
  for (const key of Object.keys(weights) as Array<keyof SignalProfile>) {
    const sig = signals[key];
    if (sig === null) continue;
    weighted += weights[key] * sig;
    applicableWeightSum += weights[key];
  }
  if (applicableWeightSum === 0) return 0;
  return weighted / applicableWeightSum;
}

// ── Expected insight yield ───────────────────────────────────────────
//
// A separate, DIFFERENT estimate from score. Yield answers: "if we DO
// generate this, how much will it push reasoning density forward?"
// Score answers: "how worth considering is this at all?"
//
// Factored as:  uncertainty * (goal_proximity + centrality)/2
//              (bounded by availability of those signals)
//
// Interpretation: yield is high when we're unsure about a node that
// matters — deepening it converts uncertainty into structure the rest
// of the system can use. Yield is near zero when the node is already
// well-characterized (low uncertainty) OR doesn't matter (low proximity
// AND low centrality).

export function computeExpectedInsightYield(signals: SignalProfile): number {
  const uncertainty = signals.uncertainty ?? 0.5; // agnostic prior
  const importance = ((signals.goal_proximity ?? 0.3) + (signals.centrality ?? 0.3)) / 2;
  const base = Math.min(1, uncertainty * importance * 1.6); // re-centers to [0,1]

  // Root-cause boost: when convergence and depth are both strong, yield
  // should be higher than base — resolving a keystone root cause moves
  // multiple downstream chains simultaneously, which is the whole point.
  // Capped so it can't exceed 1; null signals degrade gracefully to 0
  // contribution (multiplier = 1, no boost).
  const convergence = signals.convergence_count ?? 0;
  const depth = signals.causal_depth_normalized ?? 0;
  const rootMultiplier = 1 + 0.5 * convergence * depth;
  return Math.min(1, base * rootMultiplier);
}

// ── Ranker note — human-readable one-liner ───────────────────────────
//
// Generated mechanically from the dominant signals. Helps the LLM
// planner (and human auditors) see at a glance WHY a candidate ranks
// where it does without clicking through the full signal profile.

function buildRankerNote(signals: SignalProfile, kind: SpaceWorkKind): string {
  const dominant: string[] = [];
  // Root-cause signals — mentioned FIRST because they rank highest.
  if ((signals.convergence_count ?? 0) >= 0.5) {
    dominant.push(`convergence point (${Math.round((signals.convergence_count ?? 0) * 100)}% of goals fan-in)`);
  }
  if ((signals.causal_depth_normalized ?? 0) >= 0.5) {
    dominant.push("deep upstream cause");
  }
  if ((signals.coverage_gap ?? 0) >= 1) dominant.push("flagged as high-value uncovered");
  // Outcome alignment is mentioned BEFORE goal_proximity because it tracks
  // the focal lever for THIS run (frame-extracted target outcome) rather
  // than the broader improvement_goals — when both are high they're saying
  // similar things, but when only one is high the outcome lens is sharper.
  if ((signals.outcome_alignment ?? 0) >= 0.8) dominant.push("on the focal-outcome path");
  if ((signals.goal_proximity ?? 0) >= 0.8) dominant.push("within goal context");
  // User-controllable lever is called out immediately after the root-cause
  // signals because a deep convergent root that's ALSO user-controllable
  // is the platonic ideal target — the note should read that aloud.
  if ((signals.user_controllable_lever ?? 0) >= 1) dominant.push("user-controllable lever");
  if ((signals.uncertainty ?? 0) >= 0.6) dominant.push("high residual uncertainty");
  if ((signals.centrality ?? 0) >= 0.6) dominant.push("high centrality");
  if ((signals.layer_crossing ?? 0) === 1) dominant.push("cross-layer bridge");
  if ((signals.intersection_density ?? 0) >= 0.6) dominant.push("already-productive region");
  if (dominant.length === 0) {
    return `${kind} with moderate aggregate signal; no single signal dominates`;
  }
  return `${kind}: ${dominant.join(", ")}`;
}

// ── Main entry: rank candidates ──────────────────────────────────────

export interface RankerInput {
  /** Targets to score. Caller populates from entities/edges/axes/signatures. */
  candidates: Array<{
    candidate_id: string;
    target: CandidateTarget;
  }>;
  bundle: SignalInputBundle;
  request: SpacePlanRequest;
  /**
   * Optional agent-weight profile ensemble. When supplied, the ranker
   * computes one composite per profile, publishes per_agent_breakdown
   * + score_variance on each CandidateScore, and uses the MEAN as the
   * primary score. When absent or length-0, falls back to the classic
   * single-perspective behavior using DEFAULT_WEIGHTS + request
   * overrides (so existing callers see no change).
   *
   * Passing `AGENT_WEIGHT_PROFILES` (the default registry ensemble) is
   * the intended call shape for strategizer runs that want multi-agent
   * disagreement signal. Passing a subset is fine — e.g., a "fast"
   * mode with just ["default", "critic"] — the variance math just
   * reflects the pair.
   */
  agent_profiles?: AgentWeightProfile[];
}

export interface RankerOutput {
  /** All candidates scored, sorted descending. */
  all: CandidateScore[];
  /** Top-N above request.score_floor, limited to request.shortlist_size. */
  shortlist: CandidateScore[];
  /** The weights actually used (after overrides applied). Snapshot for
   *  the final plan's audit record. In multi-profile mode this is the
   *  MEAN weight across profiles (for back-compat with the existing
   *  ranker_weights_snapshot field). */
  weights_used: Record<keyof SignalProfile, number>;
  /**
   * When multi-profile mode ran, the profile ensemble that was used,
   * copied for audit. Empty array in single-profile mode.
   */
  profiles_used: AgentWeightProfile[];
  /**
   * Candidates whose `score_variance` exceeds `contentious_threshold`
   * (default 0.08). Surface this to the planner LLM so it can reason
   * explicitly about disagreement rather than silently averaging.
   */
  contentious: CandidateScore[];
}

// ── Weight-override helper ───────────────────────────────────────────
//
// Extracted so both the single-perspective path and the per-profile
// path apply `request.weight_overrides` identically. Overrides are
// multiplicative on top of the base weights, then we renormalize so
// the composite still lives in [0, 1].

function applyOverridesAndNormalize(
  base: Record<keyof SignalProfile, number>,
  overrides: Partial<Record<keyof SignalProfile, number>>,
): Record<keyof SignalProfile, number> {
  const raw: Record<keyof SignalProfile, number> = { ...base };
  for (const key of Object.keys(overrides) as Array<keyof SignalProfile>) {
    const mult = overrides[key];
    if (typeof mult === "number" && mult > 0) {
      raw[key] = raw[key] * mult;
    }
  }
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const out = { ...raw };
  if (sum > 0) {
    for (const key of Object.keys(out) as Array<keyof SignalProfile>) {
      out[key] = out[key] / sum;
    }
  }
  return out;
}

// ── Variance calc ────────────────────────────────────────────────────
//
// Standard deviation across the per-agent score list. Used as the
// "contentiousness" metric — a score of 0.08+ means the profiles
// disagree enough that the planner should reason about WHY, not
// silently average.

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Threshold above which a candidate is flagged "contentious". Picked
// empirically: profiles typically cluster within ~0.04 σ when they
// broadly agree, and diverge past ~0.10 σ on genuinely disputed picks.
const CONTENTIOUS_THRESHOLD = 0.08;

export function rankCandidates(input: RankerInput): RankerOutput {
  const overrides = input.request.weight_overrides ?? {};
  const profiles = input.agent_profiles ?? [];
  const multiProfile = profiles.length >= 2;

  // ── Single-profile fallback ─────────────────────────────────────
  // Exact pre-multiagent behavior. Exercised by tests + any caller
  // that doesn't pass an ensemble.
  if (!multiProfile) {
    const weights = applyOverridesAndNormalize(DEFAULT_WEIGHTS, overrides);
    const scored: CandidateScore[] = input.candidates.map((c) => {
      const signals = computeSignalProfile(input.bundle, c.target);
      const score = computeCompositeScore(signals, weights);
      const yieldEst = computeExpectedInsightYield(signals);
      return {
        candidate_id: c.candidate_id,
        kind: c.target.kind,
        score,
        signals,
        ranker_note: buildRankerNote(signals, c.target.kind),
        est_tokens: TOKEN_COST_ESTIMATES[c.target.kind],
        expected_insight_yield: yieldEst,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const floor = input.request.score_floor ?? 0.35;
    const maxShortlist = input.request.shortlist_size ?? 20;
    const shortlist = scored.filter((s) => s.score >= floor).slice(0, maxShortlist);
    return {
      all: scored,
      shortlist,
      weights_used: weights,
      profiles_used: [],
      contentious: [],
    };
  }

  // ── Multi-profile ensemble scoring ──────────────────────────────
  //
  // Compute signals ONCE per candidate (deterministic, profile-
  // independent — all signals are structural features of the graph,
  // not agent opinions). Then compute one composite per profile using
  // that profile's weights. Mean = primary score, SD = contentiousness.
  //
  // We also snapshot a MEAN-WEIGHT vector for the plan's audit field
  // (`ranker_weights_snapshot`) so calibration still sees a single
  // weight vector to regress against — otherwise the calibration loop
  // would have to be rewritten for ensembles in one go, which is out
  // of scope for this change.

  const perProfileNormalized: Array<{
    profile: AgentWeightProfile;
    weights: Record<keyof SignalProfile, number>;
  }> = profiles.map((p) => ({
    profile: p,
    weights: applyOverridesAndNormalize(p.weights, overrides),
  }));

  const meanWeights: Record<keyof SignalProfile, number> = {
    convergence_count: 0,
    coverage_gap: 0,
    goal_proximity: 0,
    causal_depth_normalized: 0,
    uncertainty: 0,
    centrality: 0,
    intersection_density: 0,
    layer_crossing: 0,
    axis_calibration: 0,
    controllability_spread: 0,
    novelty: 0,
    agent_convergence_count: 0,
    user_controllable_lever: 0,
    outcome_alignment: 0,
    interaction_density: 0,
    cost_efficiency: 0,
    calibration_drift: 0,
    consequence_breadth: 0,
  };
  for (const { weights: w } of perProfileNormalized) {
    for (const key of Object.keys(meanWeights) as Array<keyof SignalProfile>) {
      meanWeights[key] += w[key] / perProfileNormalized.length;
    }
  }

  const scored: CandidateScore[] = input.candidates.map((c) => {
    const signals = computeSignalProfile(input.bundle, c.target);
    const perAgent: Record<string, number> = {};
    const scoreList: number[] = [];
    for (const { profile, weights } of perProfileNormalized) {
      const s = computeCompositeScore(signals, weights);
      perAgent[profile.agent_id] = s;
      scoreList.push(s);
    }
    const meanScore = scoreList.reduce((a, b) => a + b, 0) / scoreList.length;
    const variance = standardDeviation(scoreList);
    const yieldEst = computeExpectedInsightYield(signals);
    return {
      candidate_id: c.candidate_id,
      kind: c.target.kind,
      score: meanScore,
      signals,
      ranker_note: buildRankerNote(signals, c.target.kind),
      est_tokens: TOKEN_COST_ESTIMATES[c.target.kind],
      expected_insight_yield: yieldEst,
      per_agent_breakdown: perAgent,
      score_variance: variance,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const floor = input.request.score_floor ?? 0.35;
  const maxShortlist = input.request.shortlist_size ?? 20;
  const shortlist = scored.filter((s) => s.score >= floor).slice(0, maxShortlist);

  // Contentious list: anything above threshold whose score also cleared
  // the floor. We don't want to surface low-score-high-variance candidates
  // (they're contentious but nobody thinks they're worth doing anyway).
  const contentious = scored.filter(
    (s) =>
      (s.score_variance ?? 0) >= CONTENTIOUS_THRESHOLD && s.score >= floor * 0.8,
  );

  return {
    all: scored,
    shortlist,
    weights_used: meanWeights,
    profiles_used: profiles,
    contentious,
  };
}
