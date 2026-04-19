// ── Role Extractor ──
//
// Pure function. Given a focal entity and the graph's edges, determine which
// roles the focal node plays. Deterministic, no LLM, no database calls.
//
// Algorithm:
//   1. Partition edges into "incident to focal": (outgoing, incoming).
//   2. For each edge, test every role definition against it.
//   3. Accumulate matching edge IDs per role.
//   4. Emit any role whose matching-edge count meets its minimum_evidence.
//
// A single edge can contribute to multiple roles (e.g., a "causes" edge that's
// also marked topology=composes would contribute to both "cause" and "whole"
// if it qualified). That's intentional: roles are overlapping descriptors.

import type { Edge } from "@/types";
import type { Role } from "@/types/convergent-point";
import { ROLE_LIBRARY, toRole, type RoleDefinition } from "./roles";

/**
 * Does a single edge match a role definition for the given focal direction?
 * `focalIsSource=true` means the focal entity is the SOURCE of this edge,
 * `false` means target.
 */
function edgeMatchesRole(
  edge: Edge,
  def: RoleDefinition,
  focalIsSource: boolean,
): boolean {
  // Direction check
  if (def.direction === "outgoing" && !focalIsSource) return false;
  if (def.direction === "incoming" && focalIsSource) return false;
  // "bidirectional" accepts either

  // Dimension check
  if (edge.dimension !== def.dimension) return false;

  // Relationship-type check (normalized to snake_case for comparison)
  if (def.matching_relationships && def.matching_relationships.length > 0) {
    const normalized = (edge.relationship_type ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
    const matches = def.matching_relationships.some((r) => {
      const rn = r.toLowerCase().trim().replace(/[\s-]+/g, "_");
      return rn === normalized;
    });
    if (!matches) return false;
  }

  // Topology check
  if (def.matching_topology) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topo = (edge as any).topology as string | undefined;
    if (topo !== def.matching_topology) return false;
  }

  return true;
}

/**
 * Extract the set of roles a focal entity plays given a graph's edges.
 * Returns roles sorted by evidence (edge_count descending), then by key.
 */
export function extractRoles(
  focalEntityUuid: string,
  allEdges: Edge[],
): Role[] {
  // Partition incident edges by whether focal is source vs target.
  const outgoing: Edge[] = [];
  const incoming: Edge[] = [];
  for (const e of allEdges) {
    if (e.source_entity_id === focalEntityUuid) outgoing.push(e);
    else if (e.target_entity_id === focalEntityUuid) incoming.push(e);
  }

  // For each role definition, accumulate matching edge IDs.
  const roleMatches = new Map<string, string[]>();
  for (const def of ROLE_LIBRARY) {
    const matching: string[] = [];
    for (const e of outgoing) {
      if (edgeMatchesRole(e, def, true)) matching.push(e.id);
    }
    for (const e of incoming) {
      if (edgeMatchesRole(e, def, false)) matching.push(e.id);
    }
    if (matching.length >= def.minimum_evidence) {
      roleMatches.set(def.key, matching);
    }
  }

  // Build Role objects, sorted by evidence.
  const roles: Role[] = [];
  for (const def of ROLE_LIBRARY) {
    const edgeIds = roleMatches.get(def.key);
    if (edgeIds) roles.push(toRole(def, edgeIds));
  }

  roles.sort((a, b) => {
    if (b.edge_count !== a.edge_count) return b.edge_count - a.edge_count;
    return a.key.localeCompare(b.key);
  });

  return roles;
}

/**
 * For a role, return which direction to use when looking for "natural"
 * interactors: if the role is "outgoing" we want other nodes on the outgoing
 * side; if "incoming", other nodes on the incoming side. For bidirectional,
 * either side counts.
 */
export function interactorDirectionForRole(role: Role): "outgoing" | "incoming" | "both" {
  if (role.direction === "outgoing") return "outgoing";
  if (role.direction === "incoming") return "incoming";
  return "both";
}
