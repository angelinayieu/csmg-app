// ── Hub discovery (shared) ──
//
// Single source of truth for "which nodes are the hubs of this KG?" —
// extracted so the live KG Formation mini-card, the SpaceGraph explorer,
// the Twin snapshot summary, and anything else that wants to rank
// entities by connectivity all use the same definition.
//
// Why this file exists: the first pass had duplicate hub logic in the
// pipeline-event-painter and the KG Formation shape, with a different
// definition "hub = degree ≥ 3" vs "hub = degree ≥ 2" creeping in.
// Once more consumers appear (SpaceGraph header strip, Twin snapshot,
// intelligence-dashboard rings) the drift gets worse. Keep it here.
//
// Two call modes:
//   1. **Static** — `computeHubsFromGraph(entities, edges)` — given full
//      Entity[] + Edge[] lists (usually from useSpaceData), produce the
//      top-N hubs. Used by post-run explorer screens and the context's
//      derived `hubs` field.
//   2. **Incremental** — `HubTracker` class — used by the live pipeline
//      event painter which doesn't have a full entity list during a
//      run (only streaming events). Mutates internal degree + name
//      Maps and exposes the same Hub[] shape on demand.
//
// Both paths agree on: what counts as a hub (HUB_MIN_DEGREE), how many
// to surface (HUB_TOP_N), how to sort (degree desc, stable), and the
// deterministic layout slot (nameHashSlot) so hubs keep their position
// on the mini-graph as lower-ranked ones get displaced.

/** A node degree at or above this counts as a hub. Tuned to show
 *  "inner connective tissue" — degree-1 leaves aren't hubs. */
export const HUB_MIN_DEGREE = 2;

/** Max hubs surfaced to consumers. Mini-graph layout assumes 6. */
export const HUB_TOP_N = 6;

export interface Hub {
  entityId: string;
  name: string;
  degree: number;
}

// ── Incremental tracker ──
//
// The live painter ingests one entity_added / edge_added event at a
// time and needs O(1) updates per event. Keeping this class
// deliberately tiny — just the two Maps the painter already had,
// wrapped in methods so consumers don't poke at internal state.

export class HubTracker {
  private degrees = new Map<string, number>();
  private names = new Map<string, string>();

  addEntity(entityId: string, name: string): void {
    // Don't overwrite an existing name (preview → real rebind keeps
    // name continuity); only set on first sight.
    if (!this.names.has(entityId)) this.names.set(entityId, name);
  }

  /** Rewire a preview-* entity id to the real UUID. Keeps the degree
   *  count that was accumulated while the preview was live. */
  rebindEntity(oldId: string, newId: string, name: string): void {
    const prevDegree = this.degrees.get(oldId);
    if (typeof prevDegree === "number") {
      this.degrees.delete(oldId);
      this.degrees.set(newId, prevDegree);
    }
    this.names.delete(oldId);
    this.names.set(newId, name);
  }

  /** Undirected: bumps both endpoints. Edge direction isn't meaningful
   *  for hub discovery — a highly-cited node is central regardless of
   *  which direction the edges point. */
  addEdge(sourceEntityId: string, targetEntityId: string): void {
    this.degrees.set(
      sourceEntityId,
      (this.degrees.get(sourceEntityId) ?? 0) + 1,
    );
    this.degrees.set(
      targetEntityId,
      (this.degrees.get(targetEntityId) ?? 0) + 1,
    );
  }

  /** Current top-N hubs, freshly computed on every call. Callers don't
   *  need to diff — cheap enough at N ≤ ~50 entities typical per run. */
  topHubs(limit: number = HUB_TOP_N): Hub[] {
    const hubs: Hub[] = [];
    for (const [entityId, degree] of this.degrees) {
      if (degree < HUB_MIN_DEGREE) continue;
      const name = this.names.get(entityId);
      if (!name) continue;
      hubs.push({ entityId, name, degree });
    }
    hubs.sort((a, b) => b.degree - a.degree);
    return hubs.slice(0, limit);
  }

  /** Full hub count (all nodes at-or-above threshold, not just top-N). */
  hubCount(): number {
    let n = 0;
    for (const degree of this.degrees.values()) {
      if (degree >= HUB_MIN_DEGREE) n++;
    }
    return n;
  }

  clear(): void {
    this.degrees.clear();
    this.names.clear();
  }
}

// ── Static (full-graph) computation ──
//
// Input shape is deliberately minimal (just the three fields the
// algorithm needs) so callers don't have to import the Entity / Edge
// types — works equally well for the full DB row or a trimmed subset.

interface HubInputEntity {
  id: string;
  name: string;
}

interface HubInputEdge {
  source_entity_id: string;
  target_entity_id: string;
}

export interface HubComputationResult {
  hubs: Hub[];
  hubCount: number;
  entityCount: number;
  edgeCount: number;
}

export function computeHubsFromGraph(
  entities: HubInputEntity[],
  edges: HubInputEdge[],
  limit: number = HUB_TOP_N,
): HubComputationResult {
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    if (!edge.source_entity_id || !edge.target_entity_id) continue;
    degrees.set(
      edge.source_entity_id,
      (degrees.get(edge.source_entity_id) ?? 0) + 1,
    );
    degrees.set(
      edge.target_entity_id,
      (degrees.get(edge.target_entity_id) ?? 0) + 1,
    );
  }

  const hubs: Hub[] = [];
  let hubCount = 0;
  for (const entity of entities) {
    const degree = degrees.get(entity.id) ?? 0;
    if (degree < HUB_MIN_DEGREE) continue;
    hubCount++;
    hubs.push({ entityId: entity.id, name: entity.name, degree });
  }
  hubs.sort((a, b) => b.degree - a.degree);

  return {
    hubs: hubs.slice(0, limit),
    hubCount,
    entityCount: entities.length,
    edgeCount: edges.length,
  };
}

// ── Deterministic layout slot ──
//
// Small FNV-1a hash → [0, 1). Gives the mini-graph its "same name →
// same position on the circle" property. Stays here (not in the shape
// file) so the SpaceGraph explorer can place hub highlights at the
// same relative angles.
export function nameHashSlot(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
