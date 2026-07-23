import { describe, it, expect } from "vitest";
import {
  rankHotSpots,
  buildUncertaintyGraph,
  topHotSpots,
  uncertaintyOf,
  DEFAULT_UNCERTAINTY,
} from "../hot-spots";
import type { Entity, Edge } from "@/types";

function ent(id: string, uncertainty: number | null): Entity {
  const base = { id, space_id: "s", name: `node-${id}` };
  return (
    uncertainty === null
      ? base
      : { ...base, node_signature: { residual_uncertainty: uncertainty } }
  ) as unknown as Entity;
}

function edge(a: string, b: string): Edge {
  return { source_entity_id: a, target_entity_id: b } as unknown as Edge;
}

/** A hub-and-spoke graph: `hub` sits between everything, so it carries the
 *  centrality. Uncertainty is what decides whether it is also a hot spot. */
function hubGraph(hubUncertainty: number) {
  const entities = [
    ent("hub", hubUncertainty),
    ent("a", 0.9),
    ent("b", 0.9),
    ent("c", 0.9),
    ent("d", 0.9),
  ];
  const edges = [edge("a", "hub"), edge("b", "hub"), edge("c", "hub"), edge("d", "hub")];
  return { entities, edges };
}

describe("uncertainty hot spots", () => {
  it("reads residual_uncertainty off node_signature, clamped", () => {
    expect(uncertaintyOf(ent("x", 0.7))).toBeCloseTo(0.7, 5);
    expect(uncertaintyOf(ent("x", 5))).toBe(1);
    expect(uncertaintyOf(ent("x", -2))).toBe(0);
  });

  it("returns null for a node with no signature, so it can be marked estimated", () => {
    expect(uncertaintyOf(ent("x", null))).toBeNull();
    const [only] = rankHotSpots([ent("x", null)], []);
    expect(only.uncertainty).toBe(DEFAULT_UNCERTAINTY);
    expect(only.estimated).toBe(true);
  });

  it("scores heat as centrality x uncertainty", () => {
    const { entities, edges } = hubGraph(0.8);
    const ranked = rankHotSpots(entities, edges);
    for (const n of ranked) {
      expect(n.heat).toBeCloseTo(n.centrality * n.uncertainty, 6);
    }
  });

  it("does NOT make a central-but-certain node the hot spot", () => {
    // The hub is the most connected node, but it is fully resolved. The
    // whole point of the model: important alone is not hot.
    const { entities, edges } = hubGraph(0);
    const ranked = rankHotSpots(entities, edges);
    const hub = ranked.find((n) => n.entityId === "hub")!;
    expect(hub.heat).toBe(0);
    expect(ranked[0].entityId).not.toBe("hub");
  });

  it("ranks a central AND unsure node above an unsure leaf", () => {
    const { entities, edges } = hubGraph(0.9);
    const ranked = rankHotSpots(entities, edges);
    const hub = ranked.find((n) => n.entityId === "hub")!;
    const leaf = ranked.find((n) => n.entityId === "a")!;
    // Same uncertainty; the hub wins on centrality alone.
    expect(hub.centrality).toBeGreaterThan(leaf.centrality);
    expect(hub.heat).toBeGreaterThan(leaf.heat);
  });

  it("returns an empty ranking for an empty graph", () => {
    expect(rankHotSpots([], [])).toEqual([]);
    expect(buildUncertaintyGraph([], []).nodes).toEqual([]);
  });

  it("dedupes undirected links and drops self/dangling edges", () => {
    const entities = [ent("a", 0.5), ent("b", 0.5)];
    const edges = [
      edge("a", "b"),
      edge("b", "a"), // same pair, reversed
      edge("a", "a"), // self
      edge("a", "ghost"), // dangling
    ];
    expect(buildUncertaintyGraph(entities, edges).links).toEqual([
      { source: "a", target: "b" },
    ]);
  });

  it("never pads the top-N with zero-heat nodes (no invented questions)", () => {
    // Two isolated nodes: no edges means no centrality means no hot spots.
    const graph = buildUncertaintyGraph([ent("a", 0.9), ent("b", 0.9)], []);
    expect(topHotSpots(graph, 5)).toEqual([]);
  });

  it("caps the top-N at the requested count", () => {
    const { entities, edges } = hubGraph(0.9);
    const graph = buildUncertaintyGraph(entities, edges);
    expect(topHotSpots(graph, 2).length).toBeLessThanOrEqual(2);
  });
});
