// ── Environment hash ─────────────────────────────────────────────────────
//
// Computes a content-addressed SHA-256 hash of an EnvironmentDefinition
// so two reads producing identical MDPs produce identical hashes.
// Predictions stamp the hash they were generated under so the trajectory
// chart can detect drift and prompt the user to re-run when the
// environment has changed.
//
// Excluded from the hash (timestamps + free-form text that may rephrase
// without changing the underlying MDP):
//   - environment_hash (self)
//   - computed_at
//   - confidence_breakdown.callouts
//
// Normalized before hashing so re-orderings don't produce false drift:
//   - overrides[] sorted by created_at ASC
//   - state_space.variables[] sorted by entity_id
//   - action_space.actions[] sorted by entity_id
//   - transition_dynamics.top_uncertain_edges[] sorted by edge_id
//   - transition_dynamics.top_leverage_edges[] sorted by edge_id
//   - reward_function.sub_goals[] sorted by goal_id
//   - reward_function.cost_terms[] sorted by goal_id
//   - initial_state_distribution.conditions[] sorted by key
//   - initial_state_distribution.applied_modulators[] sorted by
//     (condition_key, target_edge_id)
//   - initial_state_distribution.baselines[] sorted by entity_id

import { createHash } from "node:crypto";
import type { EnvironmentDefinition } from "@/types/environment-definition";

/**
 * Pure function. Returns a 64-character hex SHA-256 of the canonical
 * JSON of the environment with hash-excluded fields zeroed and arrays
 * sorted. Safe to call on a partially-populated EnvironmentDefinition
 * (used during aggregator construction before the hash field is set).
 */
export function hashEnvironment(
  env: Omit<EnvironmentDefinition, "environment_hash"> & {
    environment_hash?: string;
  },
): string {
  const canonical = canonicalize(env);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json).digest("hex");
}

/** Returns a deeply-cloned, normalized copy of the environment with
 *  hash-excluded fields zeroed and array members sorted. */
function canonicalize(
  env: Omit<EnvironmentDefinition, "environment_hash"> & {
    environment_hash?: string;
  },
): unknown {
  return {
    space_id: env.space_id,
    subject_id: env.subject_id,

    state_space: {
      ...env.state_space,
      variables: [...env.state_space.variables].sort((a, b) =>
        a.entity_id.localeCompare(b.entity_id),
      ),
    },

    action_space: {
      ...env.action_space,
      actions: [...env.action_space.actions].sort((a, b) =>
        a.entity_id.localeCompare(b.entity_id),
      ),
    },

    transition_dynamics: {
      ...env.transition_dynamics,
      top_uncertain_edges: [...env.transition_dynamics.top_uncertain_edges]
        .sort((a, b) => a.edge_id.localeCompare(b.edge_id)),
      top_leverage_edges: [...env.transition_dynamics.top_leverage_edges]
        .sort((a, b) => a.edge_id.localeCompare(b.edge_id)),
    },

    reward_function: {
      primary_goal: env.reward_function.primary_goal,
      sub_goals: [...env.reward_function.sub_goals].sort((a, b) =>
        a.goal_id.localeCompare(b.goal_id),
      ),
      cost_terms: [...env.reward_function.cost_terms].sort((a, b) =>
        a.goal_id.localeCompare(b.goal_id),
      ),
      weights_normalized: env.reward_function.weights_normalized,
    },

    discount_factor: env.discount_factor,

    initial_state_distribution: {
      subject_id: env.initial_state_distribution.subject_id,
      subject_name: env.initial_state_distribution.subject_name,
      conditions: [...env.initial_state_distribution.conditions].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
      applied_modulators: [...env.initial_state_distribution.applied_modulators]
        .sort((a, b) => {
          const k = a.condition_key.localeCompare(b.condition_key);
          return k !== 0 ? k : a.target_edge_id.localeCompare(b.target_edge_id);
        }),
      uncalibrated_conditions: [
        ...env.initial_state_distribution.uncalibrated_conditions,
      ].sort(),
      baselines: [...env.initial_state_distribution.baselines].sort((a, b) =>
        a.entity_id.localeCompare(b.entity_id),
      ),
    },

    boundary: env.boundary,

    confidence: env.confidence,
    confidence_breakdown: {
      boundary_confidence: env.confidence_breakdown.boundary_confidence,
      state_coverage: env.confidence_breakdown.state_coverage,
      action_calibration: env.confidence_breakdown.action_calibration,
      transition_coverage: env.confidence_breakdown.transition_coverage,
      reward_clarity: env.confidence_breakdown.reward_clarity,
      initial_state_calibration:
        env.confidence_breakdown.initial_state_calibration,
      weighted_score: env.confidence_breakdown.weighted_score,
      // callouts omitted from hash (free-text)
    },

    overrides: [...env.overrides].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    ),
  };
}
