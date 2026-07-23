import { describe, it, expect } from "vitest";
import { mapSeedNode, mapSeedRelation, mapSeedGraph } from "../materialize-seed-graph";
import type { SeedNode, SeedEdge } from "../seed-types";

const SPACE = "11111111-1111-1111-1111-111111111111";

describe("mapSeedRelation", () => {
  it("maps structural seed relations onto CAUSAL types the root tracer walks", () => {
    // root-tracer.ts only follows causal types. Anything mapped to relates_to
    // is invisible to it, which would make causal_depth null everywhere.
    expect(mapSeedRelation("feeds").relationship_type).toBe("causes");
    expect(mapSeedRelation("depends_on").relationship_type).toBe("constrains");
    expect(mapSeedRelation("bounded_by").relationship_type).toBe("constrains");
    expect(mapSeedRelation("derived_from").relationship_type).toBe("enables");
  });

  it("marks the causal ones with the causal dimension", () => {
    for (const r of ["feeds", "depends_on", "bounded_by", "derived_from"]) {
      expect(mapSeedRelation(r).dimension).toBe("causal");
    }
  });

  it("keeps genuinely epistemic relations epistemic", () => {
    expect(mapSeedRelation("informed_by").relationship_type).toBe("relates_to");
    expect(mapSeedRelation("informed_by").dimension).toBe("epistemic");
    expect(mapSeedRelation("explores").relationship_type).toBe("relates_to");
  });

  it("falls back to relates_to for an unknown relation", () => {
    expect(mapSeedRelation("nonsense").relationship_type).toBe("relates_to");
    expect(mapSeedRelation(undefined).relationship_type).toBe("relates_to");
  });
});

describe("mapSeedNode", () => {
  function node(o: Partial<SeedNode> = {}): SeedNode {
    return { id: "sol-x", label: "Ship a CLI", type: "solution", ...o };
  }

  it("carries the seed slug through as entity_id so edges can resolve", () => {
    expect(mapSeedNode(node(), SPACE).entity_id).toBe("sol-x");
  });

  it("maps seed types onto entity categories", () => {
    expect(mapSeedNode(node({ type: "solution" }), SPACE).entity_category).toBe("process");
    expect(mapSeedNode(node({ type: "constraint" }), SPACE).entity_category).toBe("relational");
    expect(mapSeedNode(node({ type: "insight" }), SPACE).entity_category).toBe("epistemic");
    expect(mapSeedNode(node({ type: "variable" }), SPACE).entity_category).toBe("abstract");
  });

  it("falls back to epistemic for an unknown type", () => {
    expect(mapSeedNode(node({ type: "wat" }), SPACE).entity_category).toBe("epistemic");
  });

  it("marks provenance so these are distinguishable from research-added nodes", () => {
    expect(mapSeedNode(node(), SPACE).provenance.source_type).toBe("objective_seed");
  });

  it("uses the label as the name and stamps the space", () => {
    const e = mapSeedNode(node(), SPACE);
    expect(e.name).toBe("Ship a CLI");
    expect(e.space_id).toBe(SPACE);
  });
});

describe("mapSeedGraph", () => {
  const nodes: SeedNode[] = [
    { id: "apex", label: "The objective", type: "objective" },
    { id: "sol-a", label: "Solution A", type: "solution" },
    { id: "con-b", label: "Constraint B", type: "constraint" },
  ];
  const edges: SeedEdge[] = [
    { source: "sol-a", target: "con-b", relation: "depends_on" },
    { source: "apex", target: "sol-a", relation: "explores" },
  ];

  it("maps every node", () => {
    expect(mapSeedGraph({ nodes, edges }, SPACE).entities).toHaveLength(3);
  });

  it("keeps edges keyed by seed slug for post-insert uuid resolution", () => {
    const g = mapSeedGraph({ nodes, edges }, SPACE);
    expect(g.edges[0].source_seed_id).toBe("sol-a");
    expect(g.edges[0].target_seed_id).toBe("con-b");
  });

  it("drops edges pointing at nodes that are not present", () => {
    const g = mapSeedGraph(
      { nodes, edges: [{ source: "sol-a", target: "ghost", relation: "feeds" }] },
      SPACE,
    );
    expect(g.edges).toHaveLength(0);
  });

  it("produces at least one causal edge so the root trace has something to walk", () => {
    const g = mapSeedGraph({ nodes, edges }, SPACE);
    expect(g.edges.some((e) => e.dimension === "causal")).toBe(true);
  });

  it("handles an empty graph without throwing", () => {
    const g = mapSeedGraph({ nodes: [], edges: [] }, SPACE);
    expect(g.entities).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

// ── Regressions found by running Task 0.5's own Step 5 against a live board ──
// Space 8ba5dce1 carried 9 seed nodes / 8 edges, every edge `involves`. Each
// defect below independently zeroes causal_depth, and none of them errors.

describe("live-board regressions", () => {
  it("maps skeleton's `involves` to a causal type (was 8/8 edges dropped)", () => {
    // skeleton.ts emits ONLY `involves`. Absent from the original table, it
    // fell through to relates_to, which root-tracer excludes by design.
    expect(mapSeedRelation("involves").dimension).toBe("causal");
    expect(mapSeedRelation("involves").relationship_type).toBe("enables");
  });

  it("writes relation_type, the column root-tracer actually reads", () => {
    // The edges table has BOTH relation_type and relationship_type. The
    // tracer reads relation_type (root-tracer.ts:150). Writing only
    // relationship_type leaves the other null and every edge is dropped.
    const g = mapSeedGraph(
      {
        nodes: [
          { id: "apex", label: "O", type: "objective" },
          { id: "a", label: "A", type: "lever" },
        ],
        edges: [{ source: "apex", target: "a", relation: "involves" }],
      },
      SPACE,
    );
    expect(g.edges[0].relation_type).toBe("enables");
    expect(g.edges[0].relation_type).toBe(g.edges[0].relationship_type);
  });

  it("flips decomposition edges so the backward trace can reach them", () => {
    // The tracer BFSes over `target -> [sources]` from the goal. A seed edge
    // objective->part is invisible to that walk; the part enables the
    // objective, so it must be stored part->objective.
    const g = mapSeedGraph(
      {
        nodes: [
          { id: "apex", label: "O", type: "objective" },
          { id: "a", label: "A", type: "lever" },
        ],
        edges: [{ source: "apex", target: "a", relation: "involves" }],
      },
      SPACE,
    );
    expect(g.edges[0].source_seed_id).toBe("a");
    expect(g.edges[0].target_seed_id).toBe("apex");
  });

  it("keeps concept-to-concept relations in their original direction", () => {
    const g = mapSeedGraph(
      {
        nodes: [
          { id: "lev", label: "L", type: "lever" },
          { id: "var", label: "V", type: "variable" },
        ],
        edges: [{ source: "lev", target: "var", relation: "feeds" }],
      },
      SPACE,
    );
    expect(g.edges[0].source_seed_id).toBe("lev");
  });

  it("covers assemble-seed's full relation vocabulary, not just part of it", () => {
    // assemble-seed emits eight relations. The plan's table had six; turns_on
    // (apex->variable) and acts_on (apex->leverage_point) were missing and
    // would have fallen to relates_to like `involves` did.
    for (const r of ["feeds", "depends_on", "bounded_by", "derived_from", "turns_on", "acts_on"]) {
      expect(mapSeedRelation(r).dimension, `${r} must be causal`).toBe("causal");
    }
    expect(mapSeedRelation("turns_on").reverse).toBe(true);
    expect(mapSeedRelation("acts_on").reverse).toBe(true);
    expect(mapSeedNode({ id: "l", label: "L", type: "leverage_point" }, SPACE).entity_category).toBe("process");
  });

  it("categorises skeleton's lever/actor/outcome instead of dumping them in epistemic", () => {
    const n = (type: string) => mapSeedNode({ id: "x", label: "X", type }, SPACE);
    expect(n("lever").entity_category).toBe("process");
    expect(n("actor").entity_category).toBe("concrete");
    expect(n("outcome").entity_category).toBe("abstract");
  });
});
