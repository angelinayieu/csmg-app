import { describe, it, expect } from "vitest";
import type { TraceStep } from "@/types/causal-chains";
import type { ChainEvidenceBundles, EntityEvidenceBundle } from "@/types/evidence-bundles";
import { validateEvidenceCitations, buildRetryPrompt } from "../validate-trace-evidence";

function step(num: number, name: string, sourceOverrides: Partial<TraceStep["source"]>): TraceStep {
  return {
    num,
    kind: "input",
    name,
    description: "",
    source: {
      kind: "research",
      label: "x",
      reliability: 3,
      ...sourceOverrides,
    },
    graph: { primitive: "density", data: {} },
    value_display: "0",
  };
}

function bundle(
  attached_entity_id: string,
  evidenceIds: string[],
): EntityEvidenceBundle {
  return {
    attached_entity_id,
    entity_name: attached_entity_id,
    pooled: {
      pooled_effect: 0.4,
      pooled_se: 0.1,
      pooled_ci_lower: 0.2,
      pooled_ci_upper: 0.6,
      tau_squared: 0,
      n_studies: evidenceIds.length,
      evidence_row_ids: evidenceIds,
      reml_iterations: 1,
    },
    effect_metric: "cohens_d",
    citations: evidenceIds.map((id) => ({
      evidence_id: id,
      ingested_file_id: null,
      quote: null,
      page: null,
    })),
    source: "live_pooled",
  };
}

function chainBundles(bundles: EntityEvidenceBundle[]): ChainEvidenceBundles {
  return {
    chain_id: "test-chain",
    bundles,
    uncovered_entity_ids: [],
  };
}

describe("validateEvidenceCitations", () => {
  it("returns no violations when research steps cite valid evidence_ids", () => {
    const bundles = chainBundles([bundle("C1", ["uuid-a", "uuid-b"])]);
    const steps = [step(2, "effect", { kind: "research", evidence_ids: ["uuid-a"] })];
    expect(validateEvidenceCitations(steps, bundles)).toEqual([]);
  });

  it("ignores non-research steps regardless of evidence_ids", () => {
    const bundles = chainBundles([bundle("C1", ["uuid-a"])]);
    const steps = [
      step(1, "baseline", { kind: "user", evidence_ids: undefined }),
      step(3, "adjust", { kind: "model" }),
      step(4, "history", { kind: "history" }),
      step(5, "fallback", { kind: "llm_estimate" }),
    ];
    expect(validateEvidenceCitations(steps, bundles)).toEqual([]);
  });

  it("flags research steps with missing evidence_ids", () => {
    const bundles = chainBundles([bundle("C1", ["uuid-a"])]);
    const steps = [step(2, "effect", { kind: "research", evidence_ids: undefined })];
    const violations = validateEvidenceCitations(steps, bundles);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("missing_citation");
    expect(violations[0].step_num).toBe(2);
  });

  it("flags research steps with empty evidence_ids array as missing", () => {
    const bundles = chainBundles([bundle("C1", ["uuid-a"])]);
    const steps = [step(2, "effect", { kind: "research", evidence_ids: [] })];
    expect(validateEvidenceCitations(steps, bundles)[0].kind).toBe("missing_citation");
  });

  it("flags research steps citing IDs not present in the bundle", () => {
    const bundles = chainBundles([bundle("C1", ["uuid-a"])]);
    const steps = [
      step(2, "effect", { kind: "research", evidence_ids: ["uuid-fake"] }),
    ];
    const violations = validateEvidenceCitations(steps, bundles);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("unknown_evidence_id");
  });

  it("flags each unknown ID separately when a step cites multiple", () => {
    const bundles = chainBundles([bundle("C1", ["uuid-a"])]);
    const steps = [
      step(2, "effect", { kind: "research", evidence_ids: ["uuid-a", "uuid-fake-1", "uuid-fake-2"] }),
    ];
    const violations = validateEvidenceCitations(steps, bundles);
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.kind === "unknown_evidence_id")).toBe(true);
  });

  it("aggregates valid IDs across multiple bundles", () => {
    const bundles = chainBundles([
      bundle("C1", ["uuid-a"]),
      bundle("C2", ["uuid-b"]),
    ]);
    const steps = [
      step(2, "effect", { kind: "research", evidence_ids: ["uuid-a", "uuid-b"] }),
    ];
    expect(validateEvidenceCitations(steps, bundles)).toEqual([]);
  });

  it("returns empty when no research steps exist", () => {
    const bundles = chainBundles([bundle("C1", ["uuid-a"])]);
    expect(validateEvidenceCitations([], bundles)).toEqual([]);
  });
});

describe("buildRetryPrompt", () => {
  it("includes the original prompt verbatim", () => {
    const original = "PROMPT BODY HERE";
    const violations = [
      { step_num: 2, step_name: "x", kind: "missing_citation" as const, message: "msg" },
    ];
    const retry = buildRetryPrompt(original, violations);
    expect(retry.startsWith(original)).toBe(true);
  });

  it("lists every violation in the retry block", () => {
    const violations = [
      { step_num: 2, step_name: "effect", kind: "missing_citation" as const, message: "missing" },
      { step_num: 3, step_name: "adjust", kind: "unknown_evidence_id" as const, message: "unknown" },
    ];
    const retry = buildRetryPrompt("X", violations);
    expect(retry).toContain("Step 2 (effect)");
    expect(retry).toContain("Step 3 (adjust)");
    expect(retry).toContain("missing");
    expect(retry).toContain("unknown");
  });

  it("uses singular phrasing for one violation", () => {
    const retry = buildRetryPrompt("X", [
      { step_num: 2, step_name: "x", kind: "missing_citation" as const, message: "m" },
    ]);
    expect(retry).toContain("1 citation violation:");
    expect(retry).not.toContain("violations:");
  });
});
