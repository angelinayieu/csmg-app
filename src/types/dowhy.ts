// ── DoWhy 4-field causal proposal contract (R5 Phase A · P4) ─────────
//
// Canonical causal-inference contract adapted from DoWhy's pattern
// (https://github.com/py-why/dowhy): every proposal that claims "this
// intervention produces this effect" carries four structured fields:
//
//   1. MODEL     — which causal subgraph the proposal targets
//                  (lever entity + target entity + path between them)
//   2. IDENTIFY  — which causal effect structure we're claiming
//                  (direct / mediator / backdoor / frontdoor / unknown)
//   3. ESTIMATE  — the MC-derived point estimate + uncertainty bars
//                  (already produced by R1 + simulateVariantLift)
//   4. REFUTE    — at least one robustness check (placebo intervention,
//                  random-common-cause, data-subset sensitivity) that
//                  tests whether the estimate survives when its causal
//                  assumption is perturbed
//
// Before P4, proposals carried only the estimate (distribution p10/
// p50/p90) as a computed artifact; the model + identify + refute
// fields were either absent or LLM prose. P4 makes each of the four
// a real computed artifact:
//
//   - MODEL / IDENTIFY — `computeCausalIdentification()` in
//     src/lib/dowhy/causal-identification.ts, pure graph analysis
//   - ESTIMATE — the existing MC distribution via simulateEntityChain
//   - REFUTE — `computePlaceboRefutation()` in
//     src/lib/dowhy/placebo-refutation.ts, runs MC with a RANDOM
//     non-path entity as the lever. If placebo lift ≈ real lift, the
//     effect isn't identifiable — the "intervention" just moves the
//     average KG state, not the target specifically.
//
// See docs/R5_STRATEGIC_BRIEF.md §2.4 for the external research
// grounding (DoWhy + Flatiron + DTCF).

// ── MODEL ────────────────────────────────────────────────────────────

export interface CausalModel {
  /** Upstream entity the intervention acts on. */
  leverEntityId: string;
  /** Downstream entity we measure lift on. */
  targetEntityId: string;
  /** Shortest path from lever → target through the KG edges. Empty
   *  when no path exists within depth (effect is un-identifiable
   *  purely structurally). Caller should render this as the spine of
   *  a causal chain diagram. */
  pathEntityIds: string[];
  /** Hop count between lever and target on the shortest path. null =
   *  unreachable within depth. */
  pathHops: number | null;
  /** Confidence-weighted edges on the path. Same order as the path
   *  minus one (edge N is between pathEntityIds[N] and pathEntityIds[N+1]).
   *  Lets the UI show per-edge polarity/strength for audit. */
  pathEdges: Array<{
    edgeId: string;
    polarity: "positive" | "negative" | "neutral" | "conditional" | null;
    strength: number | null;
    confidence: number | null;
  }>;
}

// ── IDENTIFY ─────────────────────────────────────────────────────────

/**
 * Which causal-identification strategy the path implies. Derived from
 * graph structure, not LLM.
 *
 *   "direct"    — single edge lever → target. Strongest claim; no
 *                 intermediate variables need to be controlled.
 *   "mediator"  — path has 1+ intermediate entities that fully mediate
 *                 the effect. Identifiable when we hold the mediator
 *                 variables fixed.
 *   "backdoor"  — lever + target share a common ancestor that creates
 *                 a confounding path. Identifiable only if we also
 *                 adjust for the backdoor variable. (Detection
 *                 heuristic: the graph contains an entity that is
 *                 upstream of BOTH lever and target via different
 *                 paths — a classic confounder.)
 *   "frontdoor" — mediator(s) carry the full effect AND are not
 *                 confounded with the target. Identifiable without
 *                 adjusting for confounders. (We don't detect this
 *                 today — it requires negative knowledge about
 *                 missing edges. Left in the enum for future.)
 *   "unknown"   — no path within depth OR lever not in subgraph.
 *                 The effect cannot be identified from the KG alone.
 */
export type CausalIdentification =
  | "direct"
  | "mediator"
  | "backdoor"
  | "frontdoor"
  | "unknown";

export interface IdentifyClaim {
  kind: CausalIdentification;
  /** Human-readable summary for audit. Generated mechanically from
   *  the path; NOT an LLM. */
  rationale: string;
  /** Entities that sit on a back-door path and should be controlled
   *  for in any real experiment. Empty when kind !== "backdoor". */
  backdoorEntityIds: string[];
  /** Mediator entities (the intermediate nodes on the main path).
   *  Empty when kind === "direct" or "unknown". */
  mediatorEntityIds: string[];
}

// ── ESTIMATE ─────────────────────────────────────────────────────────

/**
 * Lift estimate + uncertainty. Mirrors what the MC engine already
 * produces via `simulateVariantLift` (R1) and `/scenarios/[id]/simulate`
 * (R5 Phase A). Kept as a parallel shape here rather than re-using
 * the raw distribution type so the DoWhy contract is self-contained.
 */
export interface EstimateClaim {
  /** p50 lift in the same units as the MC distribution (deviations
   *  from baseline). */
  pointEstimate: number;
  /** p10 — lower bound of the 80% CI. */
  lowerCI: number;
  /** p90 — upper bound. */
  upperCI: number;
  /** Std deviation across MC samples. Higher = more uncertain. */
  stddev: number;
  /** Sample count behind the estimate (MC iterations). */
  sampleCount: number;
  /** Provenance tag — matches distribution.provenance. Needed here
   *  so the UI renders the same ⚡/✎ badge in the DoWhy view. */
  provenance:
    | "mc_simulation"
    | "bootstrap"
    | "llm_estimate"
    | "composite_computed"
    | "ode_rk4";
}

// ── REFUTE ───────────────────────────────────────────────────────────

/**
 * Robustness check output. Each refute method tests a different
 * assumption. For P4 we ship the PLACEBO check; random-common-cause
 * + data-subset refutes are deferred.
 *
 *   verdict "pass"  — placebo lift << real lift. Effect is
 *                     identifiable; intervention does move target
 *                     specifically.
 *   verdict "fail"  — placebo lift ≈ real lift. The "intervention"
 *                     seems to move target the same amount as a
 *                     random perturbation. Don't trust the estimate.
 *   verdict "skip"  — couldn't run (no valid placebo lever available).
 */
export interface RefutationResult {
  method: "placebo_intervention" | "random_common_cause" | "data_subset";
  verdict: "pass" | "fail" | "skip";
  /** |placebo_lift| / |real_lift|. < 0.3 → pass; > 0.7 → fail;
   *  0.3-0.7 → borderline, verdict is "fail" to be conservative. */
  sensitivityRatio: number | null;
  realLift: number;
  placeboLift: number | null;
  rationale: string;
}

// ── Top-level contract ───────────────────────────────────────────────

export interface DoWhyContract {
  model: CausalModel;
  identify: IdentifyClaim;
  estimate: EstimateClaim;
  refute: RefutationResult;
  computedAt: string;
}
