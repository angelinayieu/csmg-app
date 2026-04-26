// ── System auto-classification (Phase 4) ─────────────────────────────
//
// Pure function: takes a system's composition (entity_ids + edge_ids)
// + the surrounding context (all edges in the space + all cycles +
// all bridges) → returns the three boolean classification flags
// + summary stats stored on the row.
//
// Why these three classifications and not the full Checkland 5-axis
// taxonomy:
//
//   - is_open / is_probabilistic / is_complex are the ones that
//     CHANGE BEHAVIOR downstream:
//       open       → lab needs to wire external-signal monitoring
//       probabilistic → lab uses Monte Carlo, not analytical
//       complex    → lab needs iterative experimentation, not single-
//                    shot intervention
//   - The other axes (physical/conceptual, natural/artificial,
//     deterministic vs probabilistic redundancy, Checkland's
//     transcendental) don't unlock product features. Skipping them
//     keeps the classification surface small + actionable.
//
// All inputs are pre-loaded by the caller — this function does no I/O
// so it's trivially testable + can run in a transaction.

import type { Edge } from "@/types";

export interface ClassifyInput {
  /** UUIDs of entities in this system. */
  entityIds: string[];
  /** UUIDs of edges in this system. Should be a subset of incidentEdges. */
  edgeIds: string[];

  /** ALL edges in the space, used to detect cross-boundary edges that
   *  signal openness. (An edge from an in-system entity to an out-of-
   *  system entity = boundary crossing = open.) */
  allEdgesInSpace: Edge[];

  /** Cycle entity-id arrays from the space's cycles table. We only
   *  need entity_ids per cycle to test "fully contained in this
   *  system". */
  allCyclesInSpace: Array<{ id: string; entity_ids: string[] }>;

  /** Bridge endpoints — when an in-system entity has any bridge to
   *  another space, the system is open. Optional; bridges may be
   *  empty for spaces that haven't run cross-space linking. */
  allBridgesTouchingSpace?: Array<{
    source_entity_id: string;
    target_entity_id: string;
  }>;
}

export interface ClassifyResult {
  is_open: boolean;
  is_probabilistic: boolean;
  is_complex: boolean;
  /** Stored on row for UI summary; recomputed on update. */
  cycle_count: number;
  /** Stored on row for sorting + display; null when no edges in
   *  system (an entity-only system has no confidence to median). */
  median_edge_confidence: number | null;
}

export function classifySystem(input: ClassifyInput): ClassifyResult {
  const entitySet = new Set(input.entityIds);
  const edgeSet = new Set(input.edgeIds);

  // ── is_open ─────────────────────────────────────────────────────
  // True if any in-system entity has an edge to an out-of-system
  // entity (boundary crossing) OR any bridge to another space.
  let is_open = false;

  // Check intra-space boundary crossings.
  for (const e of input.allEdgesInSpace) {
    const srcInside = entitySet.has(e.source_entity_id);
    const tgtInside = entitySet.has(e.target_entity_id);
    // Cross-boundary edge: one endpoint in, one out.
    if (srcInside !== tgtInside) {
      is_open = true;
      break;
    }
  }

  // Check cross-space bridges if not already open.
  if (!is_open && input.allBridgesTouchingSpace) {
    for (const b of input.allBridgesTouchingSpace) {
      if (
        entitySet.has(b.source_entity_id) ||
        entitySet.has(b.target_entity_id)
      ) {
        is_open = true;
        break;
      }
    }
  }

  // ── is_probabilistic ───────────────────────────────────────────
  // Median confidence of in-system edges < 0.5. Use only edges that
  // are actually in the system (edge_ids), not all incident edges.
  // This way a system can be deterministic even when its surrounding
  // context is uncertain.
  const inSystemEdges = input.allEdgesInSpace.filter((e) => edgeSet.has(e.id));
  const confidences = inSystemEdges
    .map((e) => (typeof e.confidence === "number" ? e.confidence : null))
    .filter((c): c is number => c !== null && Number.isFinite(c));
  let median_edge_confidence: number | null = null;
  let is_probabilistic = false;
  if (confidences.length > 0) {
    confidences.sort((a, b) => a - b);
    const mid = Math.floor(confidences.length / 2);
    median_edge_confidence =
      confidences.length % 2 === 0
        ? (confidences[mid - 1] + confidences[mid]) / 2
        : confidences[mid];
    is_probabilistic = median_edge_confidence < 0.5;
  }

  // ── is_complex ─────────────────────────────────────────────────
  // True if the system contains at least one cycle whose ALL entities
  // are inside the system. Partial-overlap cycles don't count — a
  // cycle that escapes the boundary isn't a self-contained feedback
  // loop within this system.
  let cycle_count = 0;
  for (const c of input.allCyclesInSpace) {
    const ids = Array.isArray(c.entity_ids) ? c.entity_ids : [];
    if (ids.length === 0) continue;
    const fullyInside = ids.every((id) => entitySet.has(id));
    if (fullyInside) cycle_count++;
  }
  const is_complex = cycle_count > 0;

  return {
    is_open,
    is_probabilistic,
    is_complex,
    cycle_count,
    median_edge_confidence,
  };
}

// ── Edge-id auto-resolution ─────────────────────────────────────────
//
// When the user supplies only entity_ids (e.g., from a lasso or a
// "promote this cycle"), the system should auto-include every edge
// that connects two of those entities. This helper returns that set.
//
// Caller can then pass the result into classifySystem.

export function resolveEdgesForEntities(
  entityIds: string[],
  allEdgesInSpace: Edge[],
): string[] {
  const set = new Set(entityIds);
  const out: string[] = [];
  for (const e of allEdgesInSpace) {
    if (set.has(e.source_entity_id) && set.has(e.target_entity_id)) {
      out.push(e.id);
    }
  }
  return out;
}
