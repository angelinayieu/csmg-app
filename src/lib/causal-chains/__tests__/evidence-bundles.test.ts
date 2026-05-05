import { describe, it, expect } from "vitest";
import type { CausalChain, CausalStage } from "@/types/causal-chains";
import { collectChainEntityIds } from "../evidence-bundles";

function stage(entity_id?: string | null): CausalStage {
  return {
    kind: "concept",
    title: "x",
    meta: "x",
    entity_id: entity_id ?? null,
  };
}

function chain(stageEntityIds: (string | null)[], entity_ids: string[] = []): CausalChain {
  const stages = Array.from({ length: 6 }, (_, i) => stage(stageEntityIds[i] ?? null));
  return {
    id: "chain-1",
    rank: 1,
    name: "test",
    stages: stages as CausalChain["stages"],
    goal_contribution_pct: 0,
    l4_structural_value: 0,
    confidence: 0,
    generated_at: new Date().toISOString(),
    primary_goal_id: "",
    micro_tactic_ids: [],
    entity_ids,
  };
}

describe("collectChainEntityIds", () => {
  it("collects entity_ids from all six stages", () => {
    const c = chain(["C1", "C2", "C3", null, "C4", null]);
    expect([...collectChainEntityIds(c)].sort()).toEqual(["C1", "C2", "C3", "C4"]);
  });

  it("merges in the chain.entity_ids array", () => {
    const c = chain(["C1", null, null, null, null, null], ["C5", "C6"]);
    expect([...collectChainEntityIds(c)].sort()).toEqual(["C1", "C5", "C6"]);
  });

  it("dedupes between stages and entity_ids", () => {
    const c = chain(["C1", "C2", null, null, null, null], ["C1", "C3"]);
    expect([...collectChainEntityIds(c)].sort()).toEqual(["C1", "C2", "C3"]);
  });

  it("returns empty array when no entities are referenced anywhere", () => {
    const c = chain([null, null, null, null, null, null], []);
    expect(collectChainEntityIds(c)).toEqual([]);
  });

  it("ignores empty-string entity_ids on stages", () => {
    const c = chain(["", "C1", null, null, null, null], []);
    expect([...collectChainEntityIds(c)].sort()).toEqual(["C1"]);
  });
});
