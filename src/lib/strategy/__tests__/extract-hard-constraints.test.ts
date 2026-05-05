import { describe, it, expect } from "vitest";
import type { SynthesisData, Axiom, AssumptionInversion, InsightConvergence, StrategyCoverageGap } from "@/types/synthesis";
import type { Subsystem } from "@/types/subsystems";
import { extractHardConstraints, hasAnyHardConstraints } from "../extract-hard-constraints";

function axiom(overrides: Partial<Axiom>): Axiom {
  return {
    axiom_id: "A1",
    visibility: "EXPLICIT",
    load_bearing: "moderate",
    scope: "node",
    claim: "",
    if_false: "",
    rests_on: [],
    scope_anchor: "",
    validation_path: "",
    confidence: "high",
    ...overrides,
  };
}

function inversion(plausibility: AssumptionInversion["plausibility"]): AssumptionInversion {
  return {
    target_type: "axiom",
    target_entity_id: "A1",
    original_assumption: "",
    inverted_claim: "",
    case_for_inversion: "",
    what_would_change: "",
    test: "",
    plausibility,
  };
}

function convergence(cluster_id: string, strength: InsightConvergence["strength"]): InsightConvergence {
  return {
    cluster_id,
    concern_label: "",
    shared_entity_ids: [],
    signal_count: 1,
    distinct_type_count: 1,
    strength,
    signals: [],
    has_hidden_axiom: false,
  };
}

function gap(id: string, kind: StrategyCoverageGap["kind"] = "critical_axiom"): StrategyCoverageGap {
  return { id, kind, label: "", why_important: "" };
}

function subsystem(id: string, level: Subsystem["level"]): Subsystem {
  return {
    id,
    kind: "loop",
    name: id,
    level,
    constituent_entities: [],
    constituent_edges: [],
    constituent_cycles: [],
    constituent_axioms: [],
    evidence_links: [],
    seed: { kind: "cycle", source_id: id },
    composition_confidence: 0.5,
    structural_value: 0.5,
    contracts: { does: "", needs: "", produces: "" },
    rationale: "",
    generated_at: new Date().toISOString(),
  };
}

function emptySynth(overrides: Partial<SynthesisData> = {}): SynthesisData {
  return {
    master_bottleneck: null,
    leverage_points: [],
    risk_points: [],
    ...overrides,
  };
}

describe("extractHardConstraints", () => {
  it("returns empty constraints for null synthesis", () => {
    const hc = extractHardConstraints(null);
    expect(hc.must_respect_axiom_ids).toEqual([]);
    expect(hc.must_address_convergence_ids).toEqual([]);
    expect(hc.must_close_gap_ids).toEqual([]);
    expect(hc.must_test_inversion_ids).toEqual([]);
    expect(hc.must_target_subsystem_ids).toEqual([]);
  });

  it("returns empty constraints for synthesis with no decomposition", () => {
    const hc = extractHardConstraints(emptySynth());
    expect(hasAnyHardConstraints(hc)).toBe(false);
  });

  it("includes only critical + non-HIDDEN axioms", () => {
    const synth = emptySynth({
      axioms: [
        axiom({ axiom_id: "A1", load_bearing: "critical", visibility: "EXPLICIT" }),
        axiom({ axiom_id: "A2", load_bearing: "important", visibility: "EXPLICIT" }),
        axiom({ axiom_id: "A3", load_bearing: "critical", visibility: "HIDDEN" }),
        axiom({ axiom_id: "A4", load_bearing: "critical", visibility: "IMPLICIT" }),
      ],
    });
    const hc = extractHardConstraints(synth);
    expect(hc.must_respect_axiom_ids).toEqual(["A1", "A4"]);
  });

  it("includes only strong convergences", () => {
    const synth = emptySynth({
      insight_convergences: [
        convergence("conv:1", "strong"),
        convergence("conv:2", "moderate"),
        convergence("conv:3", "weak"),
        convergence("conv:4", "strong"),
      ],
    });
    const hc = extractHardConstraints(synth);
    expect(hc.must_address_convergence_ids).toEqual(["conv:1", "conv:4"]);
  });

  it("includes all coverage gaps", () => {
    const synth = emptySynth({
      strategy_coverage: {
        overall_coverage: 50,
        addressed_ids: [],
        gaps: [gap("g1"), gap("g2", "hidden_axiom")],
        totals: { critical_axioms: 0, hidden_axioms: 0, critical_risks: 0, high_impact_signals: 0 },
        addressed_counts: { critical_axioms: 0, hidden_axioms: 0, critical_risks: 0, high_impact_signals: 0 },
      },
    });
    const hc = extractHardConstraints(synth);
    expect(hc.must_close_gap_ids).toEqual(["g1", "g2"]);
  });

  it("includes only coin_flip inversions, with index-based IDs", () => {
    const synth = emptySynth({
      assumption_inversions: [
        inversion("unlikely_but_consequential"),
        inversion("coin_flip"),
        inversion("more_likely_than_stated"),
        inversion("coin_flip"),
      ],
    });
    const hc = extractHardConstraints(synth);
    expect(hc.must_test_inversion_ids).toEqual(["inv1", "inv3"]);
  });

  it("includes only L1 and L2 subsystems", () => {
    const synth = emptySynth({
      subsystems: [
        subsystem("sub_a", "L1"),
        subsystem("sub_b", "L2"),
        subsystem("sub_c", "L3"),
        subsystem("sub_d", "L4"),
      ],
    });
    const hc = extractHardConstraints(synth);
    expect(hc.must_target_subsystem_ids).toEqual(["sub_a", "sub_b"]);
  });
});

describe("hasAnyHardConstraints", () => {
  it("returns false for fully empty constraints", () => {
    const hc = extractHardConstraints(null);
    expect(hasAnyHardConstraints(hc)).toBe(false);
  });

  it("returns true if any single category is non-empty", () => {
    const hc = extractHardConstraints(emptySynth({
      axioms: [axiom({ load_bearing: "critical", visibility: "EXPLICIT" })],
    }));
    expect(hasAnyHardConstraints(hc)).toBe(true);
  });
});
