// ── Tests for condition_modulators logic ────────────────────────────────
//
// Covers the two pure functions that compose per-patient edge
// multipliers from subjects.conditions × condition_modulators rows:
//
//   evaluateValueMatch  — parses the value_match grammar (per migration
//                         20260509_condition_modulators.sql)
//   computeEdgeMultipliers — joins conditions × modulators, returns
//                         Map<edge_id, EdgeMultiplierApplied>
//
// Pure unit tests — no DB, no async. The simulator integration is
// covered indirectly: any bug here would propagate to wrong predictions
// for every persona-based simulation, so these tests guard the
// load-bearing path.

import { describe, it, expect } from "vitest";
import {
  evaluateValueMatch,
  computeEdgeMultipliers,
  type ConditionModulatorRow,
} from "../condition-modulators";

// ────────────────────────────────────────────────────────────────────────
// evaluateValueMatch
// ────────────────────────────────────────────────────────────────────────

describe("evaluateValueMatch", () => {
  describe("always-on (null/empty clause)", () => {
    it("returns true for null clause regardless of value", () => {
      expect(evaluateValueMatch(null, 5)).toBe(true);
      expect(evaluateValueMatch(null, "anything")).toBe(true);
      expect(evaluateValueMatch(null, true)).toBe(true);
      expect(evaluateValueMatch(null, undefined)).toBe(true);
    });

    it("returns true for empty/whitespace clause", () => {
      expect(evaluateValueMatch("", 5)).toBe(true);
      expect(evaluateValueMatch("   ", 5)).toBe(true);
    });
  });

  describe("numeric comparison clauses", () => {
    it("matches < threshold correctly", () => {
      expect(evaluateValueMatch("<4", 3)).toBe(true);
      expect(evaluateValueMatch("<4", 4)).toBe(false); // strict
      expect(evaluateValueMatch("<4", 5)).toBe(false);
    });

    it("matches <= threshold correctly", () => {
      expect(evaluateValueMatch("<=4", 3)).toBe(true);
      expect(evaluateValueMatch("<=4", 4)).toBe(true); // inclusive
      expect(evaluateValueMatch("<=4", 5)).toBe(false);
    });

    it("matches > threshold correctly", () => {
      expect(evaluateValueMatch(">5", 6)).toBe(true);
      expect(evaluateValueMatch(">5", 5)).toBe(false); // strict
      expect(evaluateValueMatch(">5", 4)).toBe(false);
    });

    it("matches >= threshold correctly", () => {
      expect(evaluateValueMatch(">=8", 9)).toBe(true);
      expect(evaluateValueMatch(">=8", 8)).toBe(true); // inclusive
      expect(evaluateValueMatch(">=8", 7)).toBe(false);
    });

    it("handles negative thresholds", () => {
      expect(evaluateValueMatch(">-2", -1)).toBe(true);
      expect(evaluateValueMatch("<-2", -3)).toBe(true);
    });

    it("handles decimal thresholds", () => {
      expect(evaluateValueMatch("<4.5", 4)).toBe(true);
      expect(evaluateValueMatch("<4.5", 4.5)).toBe(false);
    });

    it("returns true (fail-open) when value is non-numeric", () => {
      expect(evaluateValueMatch("<4", "not a number")).toBe(true);
    });

    it("tolerates whitespace around operator", () => {
      expect(evaluateValueMatch(">= 8", 9)).toBe(true);
      expect(evaluateValueMatch("< 4", 3)).toBe(true);
    });
  });

  describe("range clauses [a,b]", () => {
    it("matches inclusive range", () => {
      expect(evaluateValueMatch("[4,7]", 5)).toBe(true);
      expect(evaluateValueMatch("[4,7]", 4)).toBe(true); // inclusive low
      expect(evaluateValueMatch("[4,7]", 7)).toBe(true); // inclusive high
      expect(evaluateValueMatch("[4,7]", 3)).toBe(false);
      expect(evaluateValueMatch("[4,7]", 8)).toBe(false);
    });

    it("tolerates whitespace inside brackets", () => {
      expect(evaluateValueMatch("[ 4 , 7 ]", 5)).toBe(true);
    });

    it("handles negative ranges", () => {
      expect(evaluateValueMatch("[-5,-1]", -3)).toBe(true);
    });
  });

  describe("set membership clauses {a,b,c}", () => {
    it("matches set membership", () => {
      expect(evaluateValueMatch("{6mo, 12mo, 24mo}", "12mo")).toBe(true);
      expect(evaluateValueMatch("{6mo, 12mo, 24mo}", "3mo")).toBe(false);
    });

    it("tolerates whitespace around members", () => {
      expect(evaluateValueMatch("{a,b,c}", "b")).toBe(true);
      expect(evaluateValueMatch("{ a , b , c }", "b")).toBe(true);
    });

    it("matches numeric values via String coercion", () => {
      expect(evaluateValueMatch("{1,2,3}", 2)).toBe(true);
      expect(evaluateValueMatch("{1,2,3}", 4)).toBe(false);
    });
  });

  describe("exact match clauses =value", () => {
    it("matches numeric exact equality", () => {
      expect(evaluateValueMatch("=5", 5)).toBe(true);
      expect(evaluateValueMatch("=5", 6)).toBe(false);
    });

    it("matches boolean exact equality", () => {
      expect(evaluateValueMatch("=true", true)).toBe(true);
      expect(evaluateValueMatch("=true", false)).toBe(false);
      expect(evaluateValueMatch("=false", false)).toBe(true);
    });

    it("matches string exact equality", () => {
      expect(evaluateValueMatch("=post_chemo_24mo", "post_chemo_24mo")).toBe(true);
      expect(evaluateValueMatch("=post_chemo_24mo", "post_chemo_6mo")).toBe(false);
    });

    it("returns false when numeric clause meets non-numeric value", () => {
      // "=5" is numeric; "five" string can't satisfy it under our rules
      expect(evaluateValueMatch("=5", "five")).toBe(false);
    });
  });

  describe("fail-open behavior", () => {
    it("returns true for unparseable clauses (defensive)", () => {
      expect(evaluateValueMatch("nonsense clause", 5)).toBe(true);
      expect(evaluateValueMatch("???", 5)).toBe(true);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// computeEdgeMultipliers
// ────────────────────────────────────────────────────────────────────────

function modulator(
  overrides: Partial<ConditionModulatorRow>,
): ConditionModulatorRow {
  return {
    id: "mod-default",
    space_id: "space-1",
    condition_key: "sleep_h",
    value_match: null,
    target_edge_id: "edge-1",
    multiplier_p10: 0.5,
    multiplier_p50: 0.7,
    multiplier_p90: 0.9,
    source_evidence_ids: [],
    rationale: null,
    population_label: null,
    ...overrides,
  };
}

describe("computeEdgeMultipliers", () => {
  it("returns empty map when no modulators provided", () => {
    const result = computeEdgeMultipliers({ sleep_h: 6 }, []);
    expect(result.size).toBe(0);
  });

  it("returns empty map when no conditions match any modulator key", () => {
    const result = computeEdgeMultipliers(
      { other_condition: 5 },
      [modulator({})],
    );
    expect(result.size).toBe(0);
  });

  it("matches condition_key + value_match to populate multiplier", () => {
    const result = computeEdgeMultipliers(
      { sleep_h: 3 },
      [modulator({ value_match: "<4", multiplier_p50: 0.6 })],
    );
    expect(result.size).toBe(1);
    expect(result.get("edge-1")?.multiplier_product_p50).toBe(0.6);
  });

  it("filters out modulators whose value_match does not satisfy condition", () => {
    const result = computeEdgeMultipliers(
      { sleep_h: 8 }, // sleep_h=8 does NOT satisfy <4
      [modulator({ value_match: "<4", multiplier_p50: 0.6 })],
    );
    expect(result.size).toBe(0);
  });

  it("composes multiple modulators on the same edge multiplicatively", () => {
    // Two modulators targeting edge-1: 0.6 × 0.7 = 0.42
    const result = computeEdgeMultipliers(
      { sleep_h: 3, stress_0_10: 8 },
      [
        modulator({
          id: "mod-sleep",
          condition_key: "sleep_h",
          value_match: "<4",
          target_edge_id: "edge-1",
          multiplier_p50: 0.6,
        }),
        modulator({
          id: "mod-stress",
          condition_key: "stress_0_10",
          value_match: ">5",
          target_edge_id: "edge-1",
          multiplier_p50: 0.7,
        }),
      ],
    );
    expect(result.size).toBe(1);
    const applied = result.get("edge-1")!;
    expect(applied.multiplier_product_p50).toBeCloseTo(0.42, 5);
    expect(applied.applied_modulator_ids).toEqual([
      "mod-sleep",
      "mod-stress",
    ]);
  });

  it("keeps modulators on different edges separate", () => {
    const result = computeEdgeMultipliers(
      { sleep_h: 3 },
      [
        modulator({
          id: "mod-a",
          target_edge_id: "edge-1",
          value_match: "<4",
          multiplier_p50: 0.6,
        }),
        modulator({
          id: "mod-b",
          target_edge_id: "edge-2",
          value_match: "<4",
          multiplier_p50: 0.8,
        }),
      ],
    );
    expect(result.size).toBe(2);
    expect(result.get("edge-1")?.multiplier_product_p50).toBe(0.6);
    expect(result.get("edge-2")?.multiplier_product_p50).toBe(0.8);
  });

  it("handles always-on (null value_match) modulators", () => {
    const result = computeEdgeMultipliers(
      { post_chemo: true },
      [
        modulator({
          condition_key: "post_chemo",
          value_match: null,
          multiplier_p50: 0.55,
        }),
      ],
    );
    expect(result.get("edge-1")?.multiplier_product_p50).toBe(0.55);
  });

  it("handles amplification multipliers (>1.0)", () => {
    const result = computeEdgeMultipliers(
      { stress_0_10: 8 },
      [
        modulator({
          condition_key: "stress_0_10",
          value_match: ">7",
          multiplier_p50: 1.45,
        }),
      ],
    );
    expect(result.get("edge-1")?.multiplier_product_p50).toBe(1.45);
  });

  it("composes amplification with attenuation correctly", () => {
    // 1.45 amplification × 0.55 attenuation = 0.7975 net
    const result = computeEdgeMultipliers(
      { stress_0_10: 8, post_chemo: true },
      [
        modulator({
          id: "mod-stress",
          condition_key: "stress_0_10",
          value_match: ">7",
          multiplier_p50: 1.45,
        }),
        modulator({
          id: "mod-chemo",
          condition_key: "post_chemo",
          value_match: "=true",
          multiplier_p50: 0.55,
        }),
      ],
    );
    expect(result.get("edge-1")?.multiplier_product_p50).toBeCloseTo(
      0.7975,
      4,
    );
  });

  it("preserves applied_modulator_ids order across composition", () => {
    const result = computeEdgeMultipliers(
      { sleep_h: 3, stress_0_10: 8, post_chemo: true },
      [
        modulator({ id: "mod-1", value_match: "<4", multiplier_p50: 0.5 }),
        modulator({
          id: "mod-2",
          condition_key: "stress_0_10",
          value_match: ">5",
          multiplier_p50: 0.7,
        }),
        modulator({
          id: "mod-3",
          condition_key: "post_chemo",
          value_match: "=true",
          multiplier_p50: 0.6,
        }),
      ],
    );
    expect(result.get("edge-1")?.applied_modulator_ids).toEqual([
      "mod-1",
      "mod-2",
      "mod-3",
    ]);
  });
});
