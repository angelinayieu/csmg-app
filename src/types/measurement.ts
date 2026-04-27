/**
 * Entity measurement spec — D1 of docs/KG_DEPTH_CRITIQUE.md.
 *
 * Promotes entities from "named noun" to "measurable variable." Every
 * fundamental or critical entity in a quantifiable category
 * (concrete | abstract | process) must declare AT LEAST a unit + scale.
 * The protocol, cost, and observability fields are optional refinements.
 *
 * Persisted on the `entities` table via migration
 * `20260609_entity_measurability.sql` as five separate columns (not a
 * JSONB blob) so downstream consumers (controllability ranking in D3,
 * numerical calibration, prediction-ledger calibration in D6) can
 * filter and index without parsing JSON on every read.
 *
 * The canonical TS shape lives here; the database.types.ts mirror is
 * generated from the migration. Keep this file the source of truth.
 */

export type MeasurementScale =
  | "continuous"
  | "ordinal"
  | "categorical"
  | "binary";

export type MeasurementObservability =
  | "directly_observable"
  | "proxy_required"
  | "inferred_only"
  | "unobservable";

/**
 * How the variable is observed in practice. Optional — populate when
 * known, leave undefined when not yet specified. Honesty > false
 * precision.
 */
export interface MeasurementProtocol {
  /** e.g. "Mixpanel event", "user survey", "server log line", "self-report". */
  instrument: string;
  /** Cadence: "daily", "per-session", "monthly", "ad-hoc". */
  frequency: string;
  /** Unit of observation: "user", "request", "transaction", "team-week". */
  sample_unit: string;
  /** Optional error bound, e.g. "±5%", "±2 events". */
  error_bound?: string;
  /** Optional measurement latency, e.g. "real-time", "T+24h". */
  latency?: string;
  /** Optional owner/team responsible for the observation. */
  owner?: string;
  /** Optional free-form notes (caveats, known biases). */
  notes?: string;
}

/**
 * Full measurement spec for one entity. Two REQUIRED leaves
 * (unit + scale) and three OPTIONAL leaves (protocol, cost,
 * observability). When all five are absent the entity is treated as
 * an unmeasured noun — fine for relational / epistemic categories,
 * a validator-error for fundamental/critical concrete/abstract/process
 * entities.
 */
export interface MeasurementSpec {
  /** e.g. "users/week", "%", "ms", "USD/MAU", "session". REQUIRED. */
  unit: string;
  /** REQUIRED — drives simulator dispatch (continuous→MC, binary→Bernoulli). */
  scale: MeasurementScale;
  /** Optional refinement — how to observe. */
  protocol?: MeasurementProtocol;
  /** Optional cost-per-observation in USD-equivalent. */
  cost_estimate?: number;
  /** Optional observability fallback when scale is hard to assign. */
  observability?: MeasurementObservability;
}

/**
 * Categories whose entities are expected to carry a measurement spec.
 * Relational entities (tradeoffs, dependencies) and epistemic entities
 * (assumptions, claims, unknowns) are exempt — they don't have units.
 */
export const MEASURABLE_ENTITY_CATEGORIES = [
  "concrete",
  "abstract",
  "process",
] as const;

export type MeasurableEntityCategory =
  (typeof MEASURABLE_ENTITY_CATEGORIES)[number];

export function isMeasurableCategory(
  category: string | null | undefined,
): category is MeasurableEntityCategory {
  if (!category) return false;
  return (MEASURABLE_ENTITY_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Importance levels that REQUIRE a measurement spec when the entity
 * sits in a measurable category. Less-important entities can ship
 * without it (we don't want to force the LLM to invent measurement
 * specs for moderate-importance scaffolding entities).
 */
export const MEASUREMENT_REQUIRED_IMPORTANCE = [
  "fundamental",
  "critical",
] as const;

export type MeasurementRequiredImportance =
  (typeof MEASUREMENT_REQUIRED_IMPORTANCE)[number];

export function requiresMeasurement(
  importance: string | null | undefined,
  category: string | null | undefined,
): boolean {
  if (!importance || !category) return false;
  return (
    (MEASUREMENT_REQUIRED_IMPORTANCE as readonly string[]).includes(
      importance,
    ) && isMeasurableCategory(category)
  );
}
