// ── Uncertainty hot spots ────────────────────────────────────────────
//
// The auto-detected replacement for the fixed ten-zone ambiguity heatmap
// (issue #17). Nothing here names a category. A node becomes a hot spot by
// being BOTH important and unsure:
//
//     heat = centrality × residual_uncertainty
//
// That is the same ranking the strategizer already uses to pick convergent
// points (space-strategizer/index.ts, "high centrality * high uncertainty
// nodes"). This module lifts it out so the intake path can render a map from
// it instead of it only existing deep inside strategy planning.
//
// Centrality comes from the shared approximation in the strategizer's signals
// module; residual uncertainty comes from entities.node_signature. Both are
// existing, populated data — this adds no new scoring model.

import {
  buildAdjacency,
  computeCentralityApprox,
} from "@/lib/pipeline/space-strategizer/signals";
import type { Entity, Edge } from "@/types";
import type { NodeSignature } from "@/types/node-signature";

/** Uncertainty assumed for a node whose signature hasn't been materialized
 *  yet. Mirrors the strategizer's default so the two agree: an unmeasured
 *  node is treated as middling-unsure, not as certain. */
export const DEFAULT_UNCERTAINTY = 0.5;

export interface HotSpot {
  entityId: string;
  label: string;
  /** 0..1 approximate betweenness. How much of the graph flows through it. */
  centrality: number;
  /** 0..1 residual uncertainty from the node signature. */
  uncertainty: number;
  /** centrality × uncertainty. The ranking key. */
  heat: number;
  /** True when this node had no materialized signature, so `uncertainty` is
   *  the default rather than a measurement. The UI marks these so a user is
   *  never shown a guess styled as a reading. */
  estimated: boolean;
}

export interface UncertaintyGraph {
  nodes: HotSpot[];
  /** Undirected pairs, deduped, for rendering. */
  links: Array<{ source: string; target: string }>;
}

function labelOf(e: Entity): string {
  const withName = e as Entity & { name?: string | null; title?: string | null };
  return withName.name ?? withName.title ?? e.id;
}

/** Read residual uncertainty off an entity's node_signature JSONB. Returns
 *  null when absent or malformed, so the caller can mark it estimated. */
export function uncertaintyOf(entity: Entity): number | null {
  const raw = (entity as Entity & { node_signature?: unknown }).node_signature;
  if (!raw || typeof raw !== "object") return null;
  const u = (raw as Partial<NodeSignature>).residual_uncertainty;
  if (typeof u !== "number" || Number.isNaN(u)) return null;
  return Math.max(0, Math.min(1, u));
}

/** Score every entity, hottest first. Pure — no I/O — so it is testable and
 *  runs identically on client and server. */
export function rankHotSpots(entities: Entity[], edges: Edge[]): HotSpot[] {
  if (entities.length === 0) return [];
  const adjacency = buildAdjacency(edges);
  const centrality = computeCentralityApprox(entities, adjacency, 96);

  return entities
    .map((e) => {
      const measured = uncertaintyOf(e);
      const uncertainty = measured ?? DEFAULT_UNCERTAINTY;
      const c = centrality.get(e.id) ?? 0;
      return {
        entityId: e.id,
        label: labelOf(e),
        centrality: c,
        uncertainty,
        heat: c * uncertainty,
        estimated: measured === null,
      };
    })
    .sort((a, b) => b.heat - a.heat);
}

/** The full graph the map renders: every scored node plus deduped links. */
export function buildUncertaintyGraph(
  entities: Entity[],
  edges: Edge[],
): UncertaintyGraph {
  const nodes = rankHotSpots(entities, edges);
  const present = new Set(nodes.map((n) => n.entityId));
  const seen = new Set<string>();
  const links: Array<{ source: string; target: string }> = [];

  for (const edge of edges) {
    const s = edge.source_entity_id;
    const t = edge.target_entity_id;
    if (!s || !t || s === t) continue;
    if (!present.has(s) || !present.has(t)) continue;
    // Undirected dedupe — the map draws one line per pair.
    const key = s < t ? `${s}|${t}` : `${t}|${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: s, target: t });
  }

  return { nodes, links };
}

/** The top N hot spots — the ones that become open questions. Nodes whose
 *  heat is zero are never returned: a node with no centrality or no
 *  uncertainty is not a hot spot, and padding the list to N would invent
 *  questions the graph did not actually raise. */
export function topHotSpots(graph: UncertaintyGraph, n: number): HotSpot[] {
  return graph.nodes.filter((h) => h.heat > 0).slice(0, n);
}
