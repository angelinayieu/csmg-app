import type { SynthesisData } from "@/types/synthesis";

export interface HardConstraints {
  /** Critical-load-bearing axioms with EXPLICIT or IMPLICIT visibility */
  must_respect_axiom_ids: string[];
  /** insight_convergence cluster IDs with strength === "strong" */
  must_address_convergence_ids: string[];
  /** All strategy_coverage gaps (the kind field already pre-filters to important) */
  must_close_gap_ids: string[];
  /** assumption_inversion indices ("inv0", "inv1", …) with plausibility "coin_flip" */
  must_test_inversion_ids: string[];
  /** Subsystem IDs at L1 or L2 — the highest-leverage compositional units */
  must_target_subsystem_ids: string[];
}

const EMPTY_CONSTRAINTS: HardConstraints = {
  must_respect_axiom_ids: [],
  must_address_convergence_ids: [],
  must_close_gap_ids: [],
  must_test_inversion_ids: [],
  must_target_subsystem_ids: [],
};

export function extractHardConstraints(
  synth: SynthesisData | null | undefined,
): HardConstraints {
  if (!synth) return EMPTY_CONSTRAINTS;

  const must_respect_axiom_ids = (synth.axioms ?? [])
    .filter((a) => a.load_bearing === "critical" && a.visibility !== "HIDDEN")
    .map((a) => a.axiom_id);

  const must_address_convergence_ids = (synth.insight_convergences ?? [])
    .filter((c) => c.strength === "strong")
    .map((c) => c.cluster_id);

  const must_close_gap_ids = (synth.strategy_coverage?.gaps ?? []).map(
    (g) => g.id,
  );

  const must_test_inversion_ids = (synth.assumption_inversions ?? [])
    .map((inv, i) => ({ inv, i }))
    .filter(({ inv }) => inv.plausibility === "coin_flip")
    .map(({ i }) => `inv${i}`);

  const must_target_subsystem_ids = (synth.subsystems ?? [])
    .filter((s) => s.level === "L1" || s.level === "L2")
    .map((s) => s.id);

  return {
    must_respect_axiom_ids,
    must_address_convergence_ids,
    must_close_gap_ids,
    must_test_inversion_ids,
    must_target_subsystem_ids,
  };
}

export function hasAnyHardConstraints(hc: HardConstraints): boolean {
  return (
    hc.must_respect_axiom_ids.length > 0 ||
    hc.must_address_convergence_ids.length > 0 ||
    hc.must_close_gap_ids.length > 0 ||
    hc.must_test_inversion_ids.length > 0 ||
    hc.must_target_subsystem_ids.length > 0
  );
}
