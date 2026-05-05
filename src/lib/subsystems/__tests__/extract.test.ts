import { describe, it, expect } from "vitest";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import {
  buildSkeletons,
  mergeOverlapping,
  rankAndCap,
  oneHopNeighborhood,
  aggregateConfidence,
  type SubsystemSkeleton,
} from "../extract";

function entity(entity_id: string, confidence = 0.8): Entity {
  return { entity_id, name: `Entity ${entity_id}`, confidence } as unknown as Entity;
}
function edge(id: string, source_entity_id: string, target_entity_id: string): Edge {
  return { id, source_entity_id, target_entity_id } as unknown as Edge;
}
function cycle(cycle_id: string, entity_ids: string[], edge_ids: string[] | null = null): Cycle {
  return { cycle_id, entity_ids, edge_ids } as unknown as Cycle;
}

function emptySynthesis(): SynthesisData {
  return {
    master_bottleneck: null,
    leverage_points: [],
    risk_points: [],
  };
}

function withInteractionMetadata(
  synth: SynthesisData,
  im: Record<string, unknown>,
): SynthesisData {
  return { ...synth, interaction_metadata: im } as unknown as SynthesisData;
}

describe("oneHopNeighborhood", () => {
  it("includes the center entity and 1-hop neighbors via outgoing edges", () => {
    const edges = [edge("e1", "C1", "C2"), edge("e2", "C1", "C3")];
    const result = oneHopNeighborhood("C1", edges);
    expect([...result.entities].sort()).toEqual(["C1", "C2", "C3"]);
    expect([...result.edges].sort()).toEqual(["e1", "e2"]);
  });

  it("includes incoming neighbors as well", () => {
    const edges = [edge("e1", "C2", "C1"), edge("e2", "C3", "C1")];
    const result = oneHopNeighborhood("C1", edges);
    expect([...result.entities].sort()).toEqual(["C1", "C2", "C3"]);
  });

  it("ignores unrelated edges", () => {
    const edges = [edge("e1", "C2", "C3"), edge("e2", "C4", "C5")];
    const result = oneHopNeighborhood("C1", edges);
    expect(result.entities).toEqual(["C1"]);
    expect(result.edges).toEqual([]);
  });

  it("dedupes when an entity is reachable both directions", () => {
    const edges = [edge("e1", "C1", "C2"), edge("e2", "C2", "C1")];
    const result = oneHopNeighborhood("C1", edges);
    expect(result.entities).toHaveLength(2);
  });
});

describe("buildSkeletons", () => {
  it("emits a loop skeleton for each cycle with ≥2 entities", () => {
    const cycles = [cycle("cyc_1", ["C1", "C2", "C3"], ["e1", "e2"])];
    const result = buildSkeletons({
      synthesis: emptySynthesis(),
      entities: [],
      edges: [],
      cycles,
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("loop");
    expect(result[0].seed).toEqual({ kind: "cycle", source_id: "cyc_1" });
    expect(result[0].constituent_entities).toEqual(["C1", "C2", "C3"]);
    expect(result[0].constituent_edges).toEqual(["e1", "e2"]);
    expect(result[0].level).toBe("L3");
  });

  it("skips cycles with fewer than 2 entities", () => {
    const cycles = [cycle("cyc_1", ["C1"])];
    const result = buildSkeletons({
      synthesis: emptySynthesis(),
      entities: [],
      edges: [],
      cycles,
    });
    expect(result).toHaveLength(0);
  });

  it("emits a leverage_cluster skeleton for each leverage_point with neighbors", () => {
    const synth = emptySynthesis();
    synth.leverage_points = [{
      entity_id: "C1",
      summary: "test",
      reasoning: [],
      how_it_works: [],
      when_matters: [],
      action: { primary: "", alternatives: [] },
      connections: [],
    }];
    const edges = [edge("e1", "C1", "C2"), edge("e2", "C3", "C1")];
    const result = buildSkeletons({ synthesis: synth, entities: [], edges, cycles: [] });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("leverage_cluster");
    expect([...result[0].constituent_entities].sort()).toEqual(["C1", "C2", "C3"]);
    expect(result[0].level).toBe("L2");
  });

  it("emits an invariant_chain skeleton only for L4 convergences", () => {
    const synth = withInteractionMetadata(emptySynthesis(), {
      convergences: [
        {
          id: "conv-l4",
          depth: "L4",
          shared_element: { entity_id: "WM", name: "Working memory", importance: "moderate", category: "abstract" },
          structural_value: 1.0,
        },
        {
          id: "conv-l1",
          depth: "L1",
          shared_element: { entity_id: "X", name: "x", importance: "fundamental", category: "concrete" },
          structural_value: 0.25,
        },
      ],
    });
    const result = buildSkeletons({ synthesis: synth, entities: [], edges: [], cycles: [] });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("invariant_chain");
    expect(result[0].seed.source_id).toBe("conv-l4");
    expect(result[0].level).toBe("L4");
  });

  it("attaches supporting axioms to invariant_chain via rests_on", () => {
    const synth = withInteractionMetadata(
      {
        ...emptySynthesis(),
        axioms: [
          { axiom_id: "A1", visibility: "EXPLICIT", load_bearing: "critical", scope: "node", claim: "", if_false: "", rests_on: ["WM"], scope_anchor: "", validation_path: "", confidence: "high" },
          { axiom_id: "A2", visibility: "EXPLICIT", load_bearing: "important", scope: "node", claim: "", if_false: "", rests_on: ["other"], scope_anchor: "", validation_path: "", confidence: "high" },
        ],
      },
      {
        convergences: [{
          id: "conv-1",
          depth: "L4",
          shared_element: { entity_id: "WM", name: "WM", importance: "moderate", category: "abstract" },
          structural_value: 1.0,
        }],
      },
    );
    const result = buildSkeletons({ synthesis: synth, entities: [], edges: [], cycles: [] });
    expect(result[0].constituent_axioms).toEqual(["A1"]);
  });

  it("requires ≥3 entities for convergence_cluster skeletons", () => {
    const synth = emptySynthesis();
    synth.insight_convergences = [
      { cluster_id: "ic_small", concern_label: "", shared_entity_ids: ["C1", "C2"], signal_count: 2, distinct_type_count: 2, strength: "moderate", signals: [], has_hidden_axiom: false },
      { cluster_id: "ic_big", concern_label: "", shared_entity_ids: ["C1", "C2", "C3", "C4"], signal_count: 5, distinct_type_count: 3, strength: "strong", signals: [], has_hidden_axiom: false },
    ];
    const result = buildSkeletons({ synthesis: synth, entities: [], edges: [], cycles: [] });
    const clusters = result.filter((r) => r.kind === "convergence_cluster");
    expect(clusters).toHaveLength(1);
    expect(clusters[0].seed.source_id).toBe("ic_big");
    expect(clusters[0].level).toBe("L2");
    expect(clusters[0].structural_value).toBe(0.8);
  });

  it("emits a bottleneck_node skeleton for master_bottleneck with neighbors", () => {
    const synth = emptySynthesis();
    synth.master_bottleneck = {
      entity_id: "BN",
      blast_radius: 5,
      summary: "",
      reasoning: [],
      when_matters: [],
    };
    const edges = [edge("e1", "BN", "C2"), edge("e2", "C3", "BN")];
    const result = buildSkeletons({ synthesis: synth, entities: [], edges, cycles: [] });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("bottleneck_node");
    expect(result[0].level).toBe("L1");
    expect(result[0].structural_value).toBe(0.9);
  });

  it("returns empty array when synthesis has no seeds", () => {
    expect(buildSkeletons({
      synthesis: emptySynthesis(),
      entities: [],
      edges: [],
      cycles: [],
    })).toEqual([]);
  });
});

describe("mergeOverlapping", () => {
  const skel = (entities: string[], structural_value = 0.5): SubsystemSkeleton => ({
    kind: "leverage_cluster",
    seed: { kind: "leverage_point", source_id: entities[0] ?? "x" },
    constituent_entities: entities,
    constituent_edges: [],
    constituent_cycles: [],
    constituent_axioms: [],
    level: "L2",
    structural_value,
  });

  it("merges skeletons with >50% Jaccard overlap", () => {
    const skeletons = [
      skel(["C1", "C2", "C3"], 0.7),
      skel(["C1", "C2", "C4"], 0.6),
    ];
    const merged = mergeOverlapping(skeletons);
    expect(merged).toHaveLength(1);
    expect([...merged[0].constituent_entities].sort()).toEqual(["C1", "C2", "C3", "C4"]);
    expect(merged[0].structural_value).toBe(0.7);
  });

  it("preserves the higher structural_value seed when merging", () => {
    const merged = mergeOverlapping([
      skel(["C1", "C2", "C3"], 0.4),
      skel(["C1", "C2", "C4"], 0.9),
    ]);
    expect(merged[0].seed.source_id).toBe("C1");
    expect(merged[0].structural_value).toBe(0.9);
  });

  it("does not merge below threshold", () => {
    const skeletons = [
      skel(["C1", "C2", "C3"]),
      skel(["C4", "C5", "C6"]),
    ];
    expect(mergeOverlapping(skeletons)).toHaveLength(2);
  });

  it("dedupes constituents on merge", () => {
    const merged = mergeOverlapping([
      skel(["C1", "C2", "C3"]),
      skel(["C2", "C3", "C4"]),
    ]);
    expect(merged[0].constituent_entities.length).toBe(new Set(merged[0].constituent_entities).size);
  });

  it("returns empty array for empty input", () => {
    expect(mergeOverlapping([])).toEqual([]);
  });
});

describe("rankAndCap", () => {
  it("sorts by structural_value descending", () => {
    const skeletons: SubsystemSkeleton[] = [
      { kind: "loop", seed: { kind: "cycle", source_id: "a" }, constituent_entities: [], constituent_edges: [], constituent_cycles: [], constituent_axioms: [], level: "L3", structural_value: 0.3 },
      { kind: "loop", seed: { kind: "cycle", source_id: "b" }, constituent_entities: [], constituent_edges: [], constituent_cycles: [], constituent_axioms: [], level: "L3", structural_value: 0.9 },
      { kind: "loop", seed: { kind: "cycle", source_id: "c" }, constituent_entities: [], constituent_edges: [], constituent_cycles: [], constituent_axioms: [], level: "L3", structural_value: 0.6 },
    ];
    const ranked = rankAndCap(skeletons);
    expect(ranked.map((s) => s.seed.source_id)).toEqual(["b", "c", "a"]);
  });

  it("caps at the supplied limit", () => {
    const skeletons: SubsystemSkeleton[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "loop",
      seed: { kind: "cycle", source_id: `c${i}` },
      constituent_entities: [],
      constituent_edges: [],
      constituent_cycles: [],
      constituent_axioms: [],
      level: "L3",
      structural_value: i / 20,
    }));
    expect(rankAndCap(skeletons, 5)).toHaveLength(5);
  });
});

describe("aggregateConfidence", () => {
  const skel: SubsystemSkeleton = {
    kind: "leverage_cluster",
    seed: { kind: "leverage_point", source_id: "x" },
    constituent_entities: ["C1", "C2"],
    constituent_edges: [],
    constituent_cycles: [],
    constituent_axioms: [],
    level: "L2",
    structural_value: 0.5,
  };

  it("blends entity confidence with structural_value (60/40)", () => {
    const entities = [entity("C1", 1.0), entity("C2", 1.0)];
    const result = aggregateConfidence(skel, entities);
    expect(result).toBeCloseTo(0.6 * 1.0 + 0.4 * 0.5, 3);
  });

  it("falls back to structural_value when no constituents have confidence data", () => {
    const result = aggregateConfidence(skel, []);
    expect(result).toBe(0.5);
  });

  it("falls back to structural_value when constituent_entities is empty", () => {
    const empty = { ...skel, constituent_entities: [] };
    const result = aggregateConfidence(empty, [entity("C1", 1.0)]);
    expect(result).toBe(0.5);
  });
});
