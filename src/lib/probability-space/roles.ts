// ── Role library ──
//
// A role is the functional position a node occupies given its incident edges.
// The library is domain-neutral and deliberately small: ~14 roles covering the
// 9 edge dimensions × 2 directions with topology constraints where meaningful.
//
// A node can hold multiple roles simultaneously — they are descriptive, not
// exclusive. Each role carries a "question" that frames what combinations
// with other nodes mean for a node in that role.

import type { Role } from "@/types/convergent-point";

export interface RoleDefinition {
  key: string;
  label: string;
  dimension: string;                          // edge dimension that triggers this role
  direction: "outgoing" | "incoming" | "bidirectional";
  // If specified, only edges with these relationship_types count toward this role.
  matching_relationships?: string[];
  // If specified, only edges with this topology count.
  matching_topology?: string;
  question: string;                            // what interactions with this node explore
  minimum_evidence: number;                    // how many matching edges to qualify for role
}

/**
 * Canonical role definitions. Ordered by specificity (most specific first)
 * so specific roles "win" over generic ones when an edge matches multiple.
 */
export const ROLE_LIBRARY: RoleDefinition[] = [
  // ── Structural / mereological ──
  {
    key: "whole",
    label: "Whole (contains parts)",
    dimension: "structural",
    direction: "outgoing",
    matching_topology: "composes",
    question: "If a part is removed or replaced, how does the whole change?",
    minimum_evidence: 1,
  },
  {
    key: "part",
    label: "Part (of a larger whole)",
    dimension: "structural",
    direction: "incoming",
    matching_topology: "composes",
    question: "If the parent whole changes, how does this part's role shift?",
    minimum_evidence: 1,
  },
  {
    key: "container",
    label: "Container (contains other entities)",
    dimension: "structural",
    direction: "outgoing",
    matching_relationships: ["contains", "has_property", "has"],
    question: "What happens if what it contains changes?",
    minimum_evidence: 1,
  },

  // ── Functional (enablement / constraint) ──
  {
    key: "enabler",
    label: "Enabler (makes things possible)",
    dimension: "functional",
    direction: "outgoing",
    matching_relationships: ["enables", "amplifies", "supports", "is_sufficient_for"],
    question: "What does removing this enabler break? What replaces it?",
    minimum_evidence: 1,
  },
  {
    key: "constrained",
    label: "Constrained (limited by external)",
    dimension: "functional",
    direction: "incoming",
    matching_relationships: ["constrains", "reduces", "gates", "inhibits", "prevents"],
    question: "What if the constraint is relaxed? What if it tightens?",
    minimum_evidence: 1,
  },
  {
    key: "constrainer",
    label: "Constrainer (limits others)",
    dimension: "functional",
    direction: "outgoing",
    matching_relationships: ["constrains", "reduces", "gates", "inhibits", "prevents"],
    question: "What does removing this constraint unlock? What exploits it currently?",
    minimum_evidence: 1,
  },
  {
    key: "tradeoff_participant",
    label: "Tradeoff participant",
    dimension: "functional",
    direction: "bidirectional",
    matching_relationships: ["trades-off-against", "in_tension_with"],
    question: "What resolves the tradeoff? What makes it sharper?",
    minimum_evidence: 1,
  },

  // ── Causal ──
  {
    key: "cause",
    label: "Cause (produces effects)",
    dimension: "causal",
    direction: "outgoing",
    matching_relationships: ["causes", "contributes_to", "triggers"],
    question: "What modifies the effect's magnitude or sign? What interrupts the causal chain?",
    minimum_evidence: 1,
  },
  {
    key: "effect",
    label: "Effect (caused by others)",
    dimension: "causal",
    direction: "incoming",
    matching_relationships: ["causes", "contributes_to", "caused_by"],
    question: "What upstream causes, if perturbed, change this effect most?",
    minimum_evidence: 1,
  },
  {
    key: "mediator",
    label: "Mediator (on causal pathway)",
    dimension: "causal",
    direction: "bidirectional",
    matching_relationships: ["mediates", "moderates"],
    question: "What bypasses this mediator? What amplifies its mediation?",
    minimum_evidence: 1,
  },

  // ── Temporal ──
  {
    key: "trigger",
    label: "Trigger (fires downstream events)",
    dimension: "temporal",
    direction: "outgoing",
    matching_relationships: ["triggers", "precedes", "starts"],
    question: "What if the trigger fires earlier/later/not at all?",
    minimum_evidence: 1,
  },

  // ── Logical ──
  {
    key: "contradictor",
    label: "Contradictor (excludes alternatives)",
    dimension: "logical",
    direction: "outgoing",
    matching_relationships: ["contradicts", "refutes", "excludes"],
    question: "What makes the contradiction disappear? What sharpens it?",
    minimum_evidence: 1,
  },

  // ── Agentive ──
  {
    key: "actor",
    label: "Actor (performs actions)",
    dimension: "agentive",
    direction: "outgoing",
    matching_relationships: ["performs", "decides", "creates", "controls"],
    question: "What if the actor's authority is constrained? Amplified? Removed?",
    minimum_evidence: 1,
  },

  // ── Epistemic ──
  {
    key: "assumption_holder",
    label: "Assumption holder",
    dimension: "epistemic",
    direction: "outgoing",
    matching_relationships: ["assumes", "depends_on_perspective"],
    question: "What happens if the assumption is falsified?",
    minimum_evidence: 1,
  },
];

/**
 * Look up a role definition by key. Returns undefined for unknown keys so
 * callers can guard.
 */
export function findRoleDefinition(key: string): RoleDefinition | undefined {
  return ROLE_LIBRARY.find((r) => r.key === key);
}

/**
 * Build a display-ready Role object from a definition + evidence. Used after
 * role extraction to carry edge counts alongside the static definition.
 */
export function toRole(def: RoleDefinition, edgeIds: string[]): Role {
  return {
    key: def.key,
    label: def.label,
    dimension: def.dimension,
    direction: def.direction,
    topology: def.matching_topology,
    edge_count: edgeIds.length,
    sample_edge_ids: edgeIds.slice(0, 5),
    question: def.question,
  };
}
