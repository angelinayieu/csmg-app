// ── Insight Lab — algorithm registry ──────────────────────────────────
//
// Single source of truth for which algorithms the lab can run. Each
// entry wraps an existing pure-function algorithm from src/lib/graph/
// or src/lib/pathways/ — no algorithm logic lives in this file, only
// the (adapter, run, toInsights) plumbing.
//
// Adding an algorithm:
//   1. Add its id to the `AlgoId` union in types.ts
//   2. If it produces a new insight shape, add its `InsightKind`
//   3. Add a `defineAlgo<...>({ ... })` entry to ENTRIES below
//   4. Update the `kind` CHECK constraint in the lab_insights migration
//      if a new InsightKind was added
//
// This file imports algorithms eagerly. As the catalog grows past ~10
// entries we may want lazy / dynamic imports, but at the current size
// the bundle cost is negligible.

import {
  computePreliminaryInsights,
  type PreliminaryInsights,
} from "@/lib/graph/preliminary-insights";
import type { Entity, Edge } from "@/types";
import type {
  AlgoDef,
  AlgoId,
  AnyAlgoDef,
  Insight,
} from "./types";
import { fullGraphAdapter } from "./adapters";

// ── Helper: type-preserving entry definition ───────────────────────────
//
// Lets each registration carry its concrete (TIn, TParams, TOut) types
// so the function bodies stay type-safe, while the registry map stores
// the type-erased form so iteration / lookup is trivial.

function defineAlgo<
  TIn,
  TParams extends Record<string, unknown>,
  TOut,
>(def: AlgoDef<TIn, TParams, TOut>): AnyAlgoDef {
  return def as unknown as AnyAlgoDef;
}

// ── Entries ────────────────────────────────────────────────────────────

const ENTRIES: AnyAlgoDef[] = [
  defineAlgo<
    { entities: Entity[]; edges: Edge[] },
    Record<string, never>,
    PreliminaryInsights
  >({
    id: "preliminary-insights",
    name: "Preliminary insights (bundle)",
    description:
      "Topology pass: hubs, bridge candidates, isolated clusters, feedback loops. The current canvas baseline.",
    category: "structural",
    defaultParams: {},
    adapter: fullGraphAdapter,
    run: (input) => computePreliminaryInsights(input.entities, input.edges),
    toInsights: (output, _ctx, stepIdx) => {
      const insights: Insight[] = [];

      for (const hub of output.hubs) {
        insights.push({
          id: `hub:${hub.entityId}`,
          kind: "hub",
          summary: `${hub.name} — ${hub.degree} connection${hub.degree === 1 ? "" : "s"} (${hub.outDegree} out, ${hub.inDegree} in)`,
          entityIds: [hub.entityId],
          detail: {
            degree: hub.degree,
            outDegree: hub.outDegree,
            inDegree: hub.inDegree,
          },
          provenance: { algoId: "preliminary-insights", stepIdx, raw: hub },
        });
      }

      for (const c of output.bridgeCandidates) {
        const sortedIds = [c.aId, c.bId].sort();
        insights.push({
          id: `bridge:${sortedIds.join(":")}`,
          kind: "bridge",
          summary: `${c.aName} ↔ ${c.bName} — ${c.sharedNeighbors} shared neighbors, ${(c.jaccard * 100).toFixed(0)}% overlap`,
          entityIds: sortedIds,
          detail: { jaccard: c.jaccard, sharedNeighbors: c.sharedNeighbors },
          provenance: { algoId: "preliminary-insights", stepIdx, raw: c },
        });
      }

      for (const cluster of output.isolatedClusters) {
        const sortedIds = [...cluster.entityIds].sort();
        insights.push({
          id: `cluster:${sortedIds.join(":")}`,
          kind: "cluster",
          summary: `Isolated cluster of ${cluster.size} (${cluster.representativeName}${cluster.size > 1 ? ", …" : ""})`,
          entityIds: cluster.entityIds,
          detail: { size: cluster.size },
          provenance: { algoId: "preliminary-insights", stepIdx, raw: cluster },
        });
      }

      for (const loop of output.feedbackLoops) {
        const sortedIds = [...loop.entityIds].sort();
        insights.push({
          id: `cycle:${sortedIds.join(":")}`,
          kind: "cycle",
          summary: `Feedback loop: ${loop.names.join(" → ")} (length ${loop.length})`,
          entityIds: loop.entityIds,
          detail: { length: loop.length },
          provenance: { algoId: "preliminary-insights", stepIdx, raw: loop },
        });
      }

      return insights;
    },
  }),
];

// ── Public API ─────────────────────────────────────────────────────────

export const REGISTRY: Map<AlgoId, AnyAlgoDef> = new Map(
  ENTRIES.map((a) => [a.id, a] as const),
);

export function getAlgo(id: AlgoId): AnyAlgoDef | undefined {
  return REGISTRY.get(id);
}

export function listAlgos(): AnyAlgoDef[] {
  return [...REGISTRY.values()];
}
