// ── Preflight hash helper ────────────────────────────────────────────
//
// SHA-256 over the contract-affecting fields of a PreflightView.
// Cosmetic fields (descriptions, source_quotes, evidence summaries)
// are deliberately EXCLUDED so that a re-render with the same plan
// produces the same hash — only contract-affecting changes (variable
// reclassifications, goal-target tweaks, opt-in toggles, depth
// changes) bust the hash and trigger downstream "environment changed
// since last prediction" warnings.

import { createHash } from "node:crypto";
import type { PreflightView } from "@/types/preflight";

/**
 * Compute the deterministic hash of a PreflightView. Caller passes
 * the partial (everything except preflight_hash itself); helper
 * canonicalizes and returns a 24-char hex prefix of SHA-256.
 */
export function hashPreflight(
  partial: Omit<PreflightView, "preflight_hash">,
): string {
  // Build a canonical projection that excludes cosmetic fields.
  const canonical = {
    space_id: partial.space_id,
    subject_id: partial.subject_id,
    question: {
      primary_objective: partial.question.primary_objective,
      sub_objectives: partial.question.sub_objectives.map((s) => s.text),
      domain_label: partial.question.domain.label,
      decision_horizon_weeks: partial.question.decision_horizon_weeks,
      out_of_scope: [...partial.question.out_of_scope].sort(),
    },
    variables: {
      independent: partial.variables.independent.map((v) => v.entity_id).sort(),
      dependent: partial.variables.dependent.map((v) => v.entity_id).sort(),
      controls: partial.variables.controls.map((v) => v.entity_id).sort(),
      confounders: partial.variables.confounders.map((v) => v.entity_id).sort(),
      mediators: partial.variables.mediators.map((v) => v.entity_id).sort(),
      moderators: partial.variables.moderators.map((v) => v.entity_id).sort(),
    },
    causal_map: {
      depth_setting: partial.causal_map.depth_setting,
      preview_decisions: partial.causal_map.preview_bridges
        .map((b) => `${b.cluster_id}:${b.preview_decision}`)
        .sort(),
    },
    goals: {
      primary: partial.goals.primary
        ? {
            goal_id: partial.goals.primary.goal_id,
            target_value: partial.goals.primary.target_value,
            weight: partial.goals.primary.weight,
          }
        : null,
      sub_goals: partial.goals.sub_goals
        .map((g) => ({
          goal_id: g.goal_id,
          target_value: g.target_value,
          weight: g.weight,
        }))
        .sort((a, b) => a.goal_id.localeCompare(b.goal_id)),
      cost_terms: partial.goals.cost_terms
        .map((c) => `${c.label}:${c.weight}`)
        .sort(),
      discount_per_week: partial.goals.discount_per_week,
    },
    initial_state: {
      persona_id: partial.initial_state.persona_id,
      conditions: partial.initial_state.conditions
        .map((c) => `${c.key}:${formatValue(c.value)}`)
        .sort(),
    },
    downstream: {
      enabled_could_items: partial.downstream.could_generate
        .filter((i) => i.enabled)
        .map((i) => i.id)
        .sort(),
    },
  };

  const hash = createHash("sha256");
  hash.update(JSON.stringify(canonical));
  return hash.digest("hex").slice(0, 24);
}

function formatValue(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? v.toString() : "null";
  return v.toString();
}
