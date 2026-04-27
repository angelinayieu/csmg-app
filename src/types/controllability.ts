// ── D3 · Controllability profile ─────────────────────────────────────
//
// D3 in docs/KG_DEPTH_CRITIQUE.md: extends D1's variable-schema layer
// with the *gradients* needed for cost-weighted strategy ranking — not
// just "is this a leverage point?" (boolean) but "how much does it
// cost to move?", "how long until impact shows?", "is the change
// reversible?"
//
// Architectural decision (per the audit + memory rule
// `feedback_check_existing_first.md`): D3 EXTENDS `manifold.operational`
// rather than introducing new top-level entity columns. The manifold
// JSONB column already houses `resource_intensity` (qual cost) and
// `reversibility` (under strategic). D3 adds the quantitative
// companions in the same blob. A separate `controllability` table or
// new top-level columns would be exactly the parallel-subsystem
// failure mode the user has explicitly warned against.
//
// Co-located concepts (already in the schema, NOT replaced by D3):
//   - manifold.strategic.reversibility       — qual: easy/costly/irreversible
//   - manifold.operational.resource_intensity — qual: high/moderate/low
//   - measurement_cost_estimate              — quant: cost-to-MEASURE the
//     entity (D1, src/types/measurement.ts). Distinct from
//     intervention_cost which is cost-to-MOVE the lever.
//   - edge.utility.actionability             — edge-level: how propagation
//     works through this relationship (NOT per-lever)
//   - edge.utility.propagation_speed         — edge-level lag
//
// What D3 adds (all under manifold.operational, all optional):
//   - controllability_kind  — typed enum (per-lever; complements
//                             edge.utility.actionability which is
//                             per-relationship)
//   - intervention_cost     — quant gradient
//   - time_to_effect        — quant gradient (per-lever, distinct from
//                             edge.utility.propagation_speed which is
//                             per-relationship cascade lag)
//   - modulation_range      — what range of values is adjustable

// ── Controllability kind ──────────────────────────────────────────────

/**
 * How directly the user can act on this entity. Mirrors edge-level
 * `utility.actionability` but at the entity level — answers "can I
 * pull this lever?" rather than "how does change propagate through
 * this relationship?"
 */
export type ControllabilityKind =
  /** User has direct, unilateral control. A button to push, a knob to
   *  turn, a dollar to spend. Typically `concrete` / `process`
   *  category entities the user owns. */
  | "fully_controllable"
  /** User can influence but not determine. Requires negotiation,
   *  cooperation, or shaping behavior of others. Most "team" /
   *  "customer" entities sit here. */
  | "partially_controllable"
  /** User can enable / disable but not modulate. A binary gate —
   *  policy on, policy off — without a continuous lever. */
  | "gated"
  /** User can observe but cannot move directly. External constraints
   *  (regulation, market behavior, weather). Still useful in the KG
   *  for context + backdoor detection. */
  | "observable_only";

export const CONTROLLABILITY_KINDS: ControllabilityKind[] = [
  "fully_controllable",
  "partially_controllable",
  "gated",
  "observable_only",
];

export function isControllabilityKind(x: unknown): x is ControllabilityKind {
  return (
    typeof x === "string" &&
    (CONTROLLABILITY_KINDS as readonly string[]).includes(x)
  );
}

// ── Cost & time gradients ─────────────────────────────────────────────

/**
 * Quantitative confidence band attached to a numeric estimate. The
 * LLM rarely gives precise costs — we model the uncertainty
 * explicitly so the ranker can apply it (e.g. de-weight high-cost
 * candidates with low-confidence estimates).
 */
export type EstimateConfidence = "high" | "moderate" | "low";

export const ESTIMATE_CONFIDENCES: EstimateConfidence[] = [
  "high",
  "moderate",
  "low",
];

/**
 * Direct cost-to-move-the-lever in USD-equivalent. Distinct from
 * `measurement_cost_estimate` which is cost-to-OBSERVE, and distinct
 * from `opportunity_cost` (the value of foregone alternatives).
 *
 * Honesty rule: when the LLM doesn't know, the spec is OMITTED, not
 * faked with a default. The ranker treats absent intervention_cost
 * as "unknown cost" and applies a soft penalty proportional to
 * outcome_horizon.
 *
 * For the broader cost taxonomy (opportunity / switching /
 * coordination / risk-adjusted / hidden / sunk / learning-curve)
 * see docs/KG_DEPTH_CRITIQUE.md §9 D3 and the OpportunityCost +
 * `cost_kind` enum below.
 */
export interface InterventionCost {
  /** USD-equivalent direct cost. May be 0 (already paid for, sunk
   *  cost). Negative values rejected (use `null` if uncertain). */
  estimate: number;
  /** How tight the estimate is. Drives ranker risk-adjustment. */
  confidence: EstimateConfidence;
  /** Optional free-text caveat, e.g. "depends on contract terms",
   *  "estimate excludes ongoing maintenance". */
  notes?: string;
  /** Whether this cost is paid once or recurs. Strategically
   *  critical: a $10k one-time fix and a $1k/month recurring cost
   *  have very different NPVs. Most LLM cost estimates conflate
   *  these — the field forces explicit disambiguation. */
  recurrence?: CostRecurrence;
  /** True iff this cost is already paid (sunk). Ranker explicitly
   *  DISCOUNTS sunk-cost framings to counter the sunk-cost fallacy
   *  bias the LLM otherwise inherits from training data. */
  is_sunk?: boolean;
}

/**
 * Cost recurrence pattern. Recurring costs compound over the
 * runway / time-to-effect window and constrain all future decisions —
 * fundamentally different strategic shape from one-time costs.
 */
export type CostRecurrence =
  | "one_time"
  | "recurring_monthly"
  | "recurring_yearly"
  /** "Ongoing" without a fixed cadence — e.g. "every team meeting"
   *  or "per support ticket." Rougher than the monthly/yearly
   *  buckets but still distinct from one_time. */
  | "recurring_continuous";

export const COST_RECURRENCES: CostRecurrence[] = [
  "one_time",
  "recurring_monthly",
  "recurring_yearly",
  "recurring_continuous",
];

/**
 * Opportunity cost — the value of the next-best alternative
 * foregone by choosing this lever. Often the dominant cost in
 * strategy decisions but invisible in pure-direct-cost framings
 * (Bastiat's "what is seen and what is not seen," 1850).
 *
 * Strategic decisions are zero-sum at the resource layer (time,
 * attention, capital, runway), so opportunity cost is frequently
 * the *primary* cost even when direct cost is small.
 *
 * High when: alternatives are abundant + good, resource is highly
 * fungible (cash > specific equipment), decision-maker at peak
 * productive capacity, decision is irreversible (forecloses
 * optionality).
 *
 * Low when: no good alternatives exist (binding constraint), the
 * resource has no other productive use (idle capacity), the
 * decision is easily reversed.
 *
 * Quantified as USD-equivalent (interpretable as: "if I spent this
 * resource on the next-best alternative, that would be worth $X").
 * Often higher than `intervention_cost.estimate` for high-leverage
 * organizations — the same $50k in a $500k-runway startup vs a
 * $500M-cash corporation has dramatically different opportunity
 * cost.
 */
export interface OpportunityCost {
  /** USD-equivalent value of the foregone next-best alternative.
   *  May exceed direct intervention_cost; that's normal and
   *  meaningful, not a contradiction. */
  estimate: number;
  confidence: EstimateConfidence;
  /** Optional: what alternative is being foregone? Free-text;
   *  surfaces in the UI as "if you pull this lever, you can't
   *  pursue X." */
  alternative?: string;
  notes?: string;
}

/**
 * Categorical classification of which cost type DOMINATES for this
 * lever. Forces the LLM to explicitly identify when opportunity /
 * coordination / risk-adjusted costs are the load-bearing concern,
 * not just the direct dollar figure. The ranker can then weight
 * differently based on the dominant type.
 *
 * Distinct from `recurrence` (which is about timing) and from
 * `intervention_cost.is_sunk` (which is about already-paid).
 */
export type CostKind =
  /** Direct dollar / hour cost dominates. The simple case. */
  | "direct"
  /** Opportunity cost dominates — what you can't do because of
   *  this. Common for senior-leader-time interventions and
   *  capital-allocation decisions in resource-constrained orgs. */
  | "opportunity_dominated"
  /** Coordination cost dominates — Brooks' Law territory. The
   *  intervention itself is cheap but requires N people to
   *  align, with N(N-1)/2 communication channels. */
  | "coordination_dominated"
  /** Risk-adjusted expected cost dominates — direct cost is
   *  modest but failure-mode recovery cost is large and
   *  probability-weighted matters. */
  | "risk_adjusted_dominated"
  /** Switching / lock-in cost dominates — direct cost may be
   *  small but the lever is path-dependent: choosing it forecloses
   *  later options. Real-options framing applies. */
  | "switching_dominated"
  /** Hidden / externality cost dominates — direct cost is
   *  visible but the lever creates compounding technical debt,
   *  cultural drag, or trust erosion. Flagged as a *category*
   *  warning since the system can't usually quantify these. */
  | "hidden_externalities";

export const COST_KINDS: CostKind[] = [
  "direct",
  "opportunity_dominated",
  "coordination_dominated",
  "risk_adjusted_dominated",
  "switching_dominated",
  "hidden_externalities",
];

/**
 * Time-to-effect gradient. PER-LEVER, distinct from
 * `edge.utility.propagation_speed` which is per-relationship cascade
 * lag (and not always available). For a given entity that the user
 * could intervene on, what's the median delay until SOMETHING
 * downstream changes?
 *
 * Stored as a free-form lag string (e.g. "immediate", "1-2 weeks",
 * "3 months") because the LLM is more reliable at categorical
 * estimates than numerical durations. Downstream consumers can map
 * these to the existing 5-bucket schema (immediate | days | weeks
 * | months | years) for ranker arithmetic.
 */
export interface TimeToEffect {
  lag: string;
  confidence: EstimateConfidence;
  notes?: string;
}

/**
 * Continuous modulation range. For levers that aren't binary on/off
 * — e.g. "ad spend" can be set anywhere in [$0, $10k/mo]. Unit
 * mirrors the entity's `measurement_unit` (D1) when set; otherwise
 * free-form.
 *
 * Optional and frequently null. Useful primarily for downstream
 * MC simulation: when computing variant lift via
 * simulate-variant-lift.ts, the perturbation magnitude can be
 * sampled from this range rather than guessed.
 */
export interface ModulationRange {
  min: number;
  max: number;
  unit?: string;
}

// ── Composite controllability profile ─────────────────────────────────

/**
 * Full controllability profile, attached to
 * `entity.manifold.operational.controllability` (D3). Every leaf is
 * optional — the LLM populates what it knows; missing leaves stay
 * absent rather than getting fabricated defaults.
 *
 * Rendered in the UI as a per-entity badge ("$2k · 1-2 weeks ·
 * easily reversible") on fundamental/critical entities. Read by the
 * strategizer to weight candidates by feasibility under the user's
 * outcome_horizon.
 */
export interface ControllabilityProfile {
  kind?: ControllabilityKind;
  intervention_cost?: InterventionCost;
  /** Opportunity cost — value of foregone alternatives. Often the
   *  dominant cost for senior-leader-time / scarce-capital
   *  decisions even when direct cost is small. See OpportunityCost
   *  doc for quantification approach. */
  opportunity_cost?: OpportunityCost;
  /** Categorical classification of WHICH cost type dominates this
   *  lever. Lets the ranker weight differently based on dominant
   *  type (e.g. opportunity_dominated levers benefit from extra
   *  scrutiny when alternatives are abundant). */
  cost_kind?: CostKind;
  time_to_effect?: TimeToEffect;
  /** Reversibility lives on `manifold.strategic.reversibility` today
   *  (3-tier enum). Mirrored here as an optional convenience pointer
   *  so callers don't have to walk two manifold branches. The
   *  strategic-side value remains authoritative; this echo is
   *  populated by the sanitizer when both are available. */
  reversibility?: "easily_reversible" | "costly_to_reverse" | "irreversible";
  modulation_range?: ModulationRange;
}

// ── Time-horizon mapping (for ranker) ─────────────────────────────────

/**
 * Maps a free-text lag string emitted by the decomposition prompt
 * onto the discrete bucket the strategizer already understands
 * (`outcome_horizon` ∈ immediate | short_term | medium_term | long_term).
 * Heuristic but deterministic — used only for weight modulation, not
 * for any quantitative computation.
 */
export type LagBucket = "immediate" | "short_term" | "medium_term" | "long_term";

export function bucketLag(raw: string | null | undefined): LagBucket | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  if (s === "immediate" || /\b(now|today|hours?|minutes?|seconds?)\b/.test(s)) {
    return "immediate";
  }
  if (/\b(day|days|week|weeks)\b/.test(s)) return "short_term";
  if (/\b(month|months|quarter|quarters)\b/.test(s)) return "medium_term";
  if (/\b(year|years|decade|decades)\b/.test(s)) return "long_term";
  return null;
}
