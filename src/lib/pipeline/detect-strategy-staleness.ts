// ── Strategy staleness detection (Phase 7 of strategy rework) ──
//
// Compares prior synthesis_data against new synthesis_data to detect when
// upstream reasoning has shifted in ways that invalidate the current strategy.
// Staleness triggers:
//   - A CRITICAL or HIDDEN axiom appeared, disappeared, or changed claim
//   - A STRONG insight convergence (or one with has_hidden_axiom) appeared
//   - Strategy coverage dropped by ≥ 15 percentage points
//   - The strategy's referenced axioms/convergences no longer exist (orphaned)
//
// Returns a structured reason so the UI can explain to the user what changed.

import type { SynthesisData, Axiom, InsightConvergence } from "@/types/synthesis";
import type { StrategicRecommendation } from "@/types/strategy";

export type StrategyStaleReason =
  | "axiom_changed"
  | "axiom_added"
  | "axiom_removed"
  | "convergence_new_strong"
  | "convergence_removed"
  | "coverage_dropped"
  | "provenance_orphaned"
  | "none";

export interface StrategyStalenessResult {
  stale: boolean;
  primary_reason: StrategyStaleReason;
  /** All reasons found (a strategy may be stale for multiple reasons). */
  all_reasons: StrategyStaleReason[];
  /** Specific IDs/details that prompted the staleness — axiom_ids, cluster_ids, etc. */
  details: {
    axioms_added?: string[];
    axioms_removed?: string[];
    axioms_changed?: string[];
    new_strong_convergences?: string[];
    removed_convergences?: string[];
    coverage_delta?: number;
    orphaned_axiom_refs?: string[];
    orphaned_convergence_refs?: string[];
  };
  /** Human-readable summary, surfaces in UI + analysis_runs note. */
  summary: string;
}

const COVERAGE_DROP_THRESHOLD = 15; // percentage points

function axiomKey(a: Axiom): string {
  return `${a.axiom_id}|${a.visibility}|${a.load_bearing}|${a.claim.slice(0, 80)}`;
}

function isStrategicallyRelevantAxiom(a: Axiom): boolean {
  return a.load_bearing === "critical" || a.visibility === "HIDDEN";
}

function isStrategicallyRelevantConvergence(c: InsightConvergence): boolean {
  return c.strength === "strong" || c.has_hidden_axiom;
}

export function detectStrategyStaleness(
  priorSynth: SynthesisData | Record<string, unknown> | null | undefined,
  newSynth: SynthesisData | Record<string, unknown> | null | undefined,
  currentStrategy?: StrategicRecommendation | null,
): StrategyStalenessResult {
  const reasons: StrategyStaleReason[] = [];
  const details: StrategyStalenessResult["details"] = {};

  if (!priorSynth || !newSynth) {
    return {
      stale: false,
      primary_reason: "none",
      all_reasons: [],
      details: {},
      summary: "No prior synthesis to compare against.",
    };
  }

  const priorAxioms = ((priorSynth as SynthesisData).axioms ?? []) as Axiom[];
  const newAxioms = ((newSynth as SynthesisData).axioms ?? []) as Axiom[];

  // ── Axiom diffs — only strategically relevant (critical or HIDDEN) ──
  const relevantPrior = priorAxioms.filter(isStrategicallyRelevantAxiom);
  const relevantNew = newAxioms.filter(isStrategicallyRelevantAxiom);

  const priorById = new Map(relevantPrior.map((a) => [a.axiom_id, a]));
  const newById = new Map(relevantNew.map((a) => [a.axiom_id, a]));

  const axiomsAdded: string[] = [];
  const axiomsRemoved: string[] = [];
  const axiomsChanged: string[] = [];

  for (const [id, a] of newById) {
    if (!priorById.has(id)) {
      axiomsAdded.push(id);
    } else {
      const priorA = priorById.get(id)!;
      if (axiomKey(priorA) !== axiomKey(a)) axiomsChanged.push(id);
    }
  }
  for (const id of priorById.keys()) {
    if (!newById.has(id)) axiomsRemoved.push(id);
  }

  if (axiomsAdded.length > 0) {
    reasons.push("axiom_added");
    details.axioms_added = axiomsAdded;
  }
  if (axiomsRemoved.length > 0) {
    reasons.push("axiom_removed");
    details.axioms_removed = axiomsRemoved;
  }
  if (axiomsChanged.length > 0) {
    reasons.push("axiom_changed");
    details.axioms_changed = axiomsChanged;
  }

  // ── Convergence diffs — only strong / hidden-axiom involving ──
  const priorConv = ((priorSynth as SynthesisData).insight_convergences ?? []) as InsightConvergence[];
  const newConv = ((newSynth as SynthesisData).insight_convergences ?? []) as InsightConvergence[];
  const priorConvById = new Map(priorConv.filter(isStrategicallyRelevantConvergence).map((c) => [c.cluster_id, c]));
  const newConvById = new Map(newConv.filter(isStrategicallyRelevantConvergence).map((c) => [c.cluster_id, c]));

  const newStrongConv: string[] = [];
  for (const id of newConvById.keys()) if (!priorConvById.has(id)) newStrongConv.push(id);
  const removedConv: string[] = [];
  for (const id of priorConvById.keys()) if (!newConvById.has(id)) removedConv.push(id);

  if (newStrongConv.length > 0) {
    reasons.push("convergence_new_strong");
    details.new_strong_convergences = newStrongConv;
  }
  if (removedConv.length > 0) {
    reasons.push("convergence_removed");
    details.removed_convergences = removedConv;
  }

  // ── Coverage drop ──
  const priorCoverage = (priorSynth as SynthesisData).strategy_coverage?.overall_coverage;
  const newCoverage = (newSynth as SynthesisData).strategy_coverage?.overall_coverage;
  if (typeof priorCoverage === "number" && typeof newCoverage === "number") {
    const delta = priorCoverage - newCoverage; // positive = dropped
    if (delta >= COVERAGE_DROP_THRESHOLD) {
      reasons.push("coverage_dropped");
      details.coverage_delta = delta;
    }
  }

  // ── Provenance orphan check (only if we have the current strategy) ──
  // If the strategy respects axioms or addresses convergences that no longer
  // exist in the new synthesis, its provenance is orphaned.
  if (currentStrategy?.provenance) {
    const newAxiomIdSet = new Set(newAxioms.map((a) => a.axiom_id));
    const newConvIdSet = new Set(newConv.map((c) => c.cluster_id));
    const orphanedAxioms = (currentStrategy.provenance.axioms_respected ?? []).filter(
      (id) => !newAxiomIdSet.has(id),
    );
    const orphanedConv = (currentStrategy.provenance.convergences_addressed ?? []).filter(
      (id) => !newConvIdSet.has(id),
    );
    if (orphanedAxioms.length > 0 || orphanedConv.length > 0) {
      reasons.push("provenance_orphaned");
      if (orphanedAxioms.length > 0) details.orphaned_axiom_refs = orphanedAxioms;
      if (orphanedConv.length > 0) details.orphaned_convergence_refs = orphanedConv;
    }
  }

  const stale = reasons.length > 0;
  const primary: StrategyStaleReason =
    reasons.find((r) => r === "axiom_changed" || r === "axiom_removed")
    ?? reasons.find((r) => r === "provenance_orphaned")
    ?? reasons.find((r) => r === "coverage_dropped")
    ?? reasons[0]
    ?? "none";

  const summaryParts: string[] = [];
  if (axiomsAdded.length) summaryParts.push(`${axiomsAdded.length} new strategically-relevant axiom${axiomsAdded.length === 1 ? "" : "s"}`);
  if (axiomsRemoved.length) summaryParts.push(`${axiomsRemoved.length} axiom${axiomsRemoved.length === 1 ? "" : "s"} removed`);
  if (axiomsChanged.length) summaryParts.push(`${axiomsChanged.length} axiom claim${axiomsChanged.length === 1 ? "" : "s"} changed`);
  if (newStrongConv.length) summaryParts.push(`${newStrongConv.length} new strong convergence${newStrongConv.length === 1 ? "" : "s"}`);
  if (removedConv.length) summaryParts.push(`${removedConv.length} strong convergence${removedConv.length === 1 ? "" : "s"} removed`);
  if (details.coverage_delta) summaryParts.push(`coverage dropped ${details.coverage_delta.toFixed(0)}pp`);
  if (details.orphaned_axiom_refs?.length || details.orphaned_convergence_refs?.length) {
    summaryParts.push(
      `${(details.orphaned_axiom_refs?.length ?? 0) + (details.orphaned_convergence_refs?.length ?? 0)} provenance reference${
        (details.orphaned_axiom_refs?.length ?? 0) + (details.orphaned_convergence_refs?.length ?? 0) === 1 ? "" : "s"
      } orphaned`,
    );
  }

  const summary = stale
    ? `Strategy may be stale — ${summaryParts.join(", ")}`
    : "Strategy remains aligned with upstream reasoning.";

  return {
    stale,
    primary_reason: primary,
    all_reasons: reasons,
    details,
    summary,
  };
}
