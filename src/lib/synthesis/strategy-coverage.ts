import type {
  ActionItemRich,
  Axiom,
  HiddenSignalData,
  InsightConvergence,
  RichActionPlan,
  RichBottleneck,
  RichRiskPoint,
  StrategyCoverageAudit,
  StrategyCoverageGap,
} from "@/types/synthesis";

interface AuditInput {
  axioms?: Axiom[];
  risk_points?: RichRiskPoint[];
  master_bottleneck?: RichBottleneck | null;
  hidden_signals?: HiddenSignalData[];
  action_plan?: RichActionPlan;
  insight_convergences?: InsightConvergence[];
  /** Strategic recommendation entity_references, if present — treated as additional action coverage */
  strategy_entity_refs?: string[];
}

/**
 * Heuristic: a hidden_signal is "high impact" if trajectory_impact >= 0.6 OR it
 * names a structural_risk / missing_metric (both are high-stakes signal types).
 */
function isHighImpactSignal(s: HiddenSignalData): boolean {
  if (typeof s.trajectory_impact === "number" && s.trajectory_impact >= 0.6) return true;
  return s.signal_type === "structural_risk" || s.signal_type === "missing_metric";
}

function flattenActions(plan?: RichActionPlan): ActionItemRich[] {
  if (!plan?.paths?.length) return [];
  const out: ActionItemRich[] = [];
  for (const path of plan.paths) {
    for (const tf of path.timeframes ?? []) {
      for (const action of tf.actions ?? []) out.push(action);
    }
  }
  return out;
}

/**
 * Normalize a hidden signal to a matchable slug. Actions reference signals by
 * short slug (e.g. "coordination-overhead-at-scale") rather than stable ID, so
 * we have to match loosely.
 */
function signalSlug(s: HiddenSignalData): string {
  const raw = (s.signal_name || s.description || "").toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function signalMatches(refs: string[], signal: HiddenSignalData): boolean {
  if (!refs?.length) return false;
  const slug = signalSlug(signal);
  const name = (signal.signal_name || "").toLowerCase();
  const desc = (signal.description || "").toLowerCase();
  return refs.some((r) => {
    const rLow = r.toLowerCase();
    if (!rLow) return false;
    const rSlug = rLow.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // Match if slug equals, or name/desc substring-contains the ref
    return (
      rSlug === slug ||
      name.includes(rLow) ||
      desc.includes(rLow) ||
      slug.includes(rSlug) ||
      rSlug.includes(slug.slice(0, 20))
    );
  });
}

export function computeStrategyCoverage(input: AuditInput): StrategyCoverageAudit {
  const actions = flattenActions(input.action_plan);

  // Collect the union of all referenced IDs across all actions
  const refAxiomIds = new Set<string>();
  const refLeverageEntityIds = new Set<string>();
  const refRiskEntityIds = new Set<string>();
  const refBottleneckIds = new Set<string>();
  const refConvergenceIds = new Set<string>();
  const allHiddenSignalRefs: string[] = [];

  for (const a of actions) {
    const sc = a.supporting_chain;
    if (!sc) continue;
    for (const x of sc.axiom_ids ?? []) refAxiomIds.add(x);
    for (const x of sc.leverage_entity_ids ?? []) refLeverageEntityIds.add(x);
    for (const x of sc.risk_entity_ids ?? []) refRiskEntityIds.add(x);
    if (sc.bottleneck_entity_id) refBottleneckIds.add(sc.bottleneck_entity_id);
    for (const x of sc.insight_convergence_ids ?? []) refConvergenceIds.add(x);
    for (const x of sc.hidden_signal_refs ?? []) allHiddenSignalRefs.push(x);
  }
  for (const x of input.strategy_entity_refs ?? []) refRiskEntityIds.add(x);

  const gaps: StrategyCoverageGap[] = [];
  const addressedIds: string[] = [];

  // Critical + Hidden axioms
  const criticalAxioms = (input.axioms ?? []).filter((a) => a.load_bearing === "critical");
  const hiddenAxioms = (input.axioms ?? []).filter((a) => a.visibility === "HIDDEN");
  const allAxiomsToCheck = new Map<string, Axiom>();
  for (const a of criticalAxioms) allAxiomsToCheck.set(a.axiom_id, a);
  for (const a of hiddenAxioms) allAxiomsToCheck.set(a.axiom_id, a);

  let addressedCriticalAxioms = 0;
  let addressedHiddenAxioms = 0;
  for (const [id, ax] of allAxiomsToCheck) {
    if (refAxiomIds.has(id)) {
      addressedIds.push(id);
      if (ax.load_bearing === "critical") addressedCriticalAxioms += 1;
      if (ax.visibility === "HIDDEN") addressedHiddenAxioms += 1;
    } else {
      // Gap — tag by most-salient reason
      const kind: StrategyCoverageGap["kind"] =
        ax.visibility === "HIDDEN" ? "hidden_axiom" : "critical_axiom";
      gaps.push({
        kind,
        id,
        label: ax.claim,
        why_important:
          kind === "hidden_axiom"
            ? "Hidden load-bearing assumption — if false, the whole structure collapses and no current action validates it"
            : `Critical axiom (scope=${ax.scope}) not addressed by any action; if it fails: ${ax.if_false}`,
      });
    }
  }

  // Critical risks — treat risks with high blast_radius as critical
  const allRisks = input.risk_points ?? [];
  const riskBlastThreshold = Math.max(
    5,
    Math.round(
      (allRisks.map((r) => r.blast_radius ?? 0).sort((a, b) => b - a)[0] ?? 10) * 0.5,
    ),
  );
  const criticalRisks = allRisks.filter((r) => (r.blast_radius ?? 0) >= riskBlastThreshold);
  let addressedCriticalRisks = 0;
  for (const r of criticalRisks) {
    if (!r.entity_id) continue;
    if (refRiskEntityIds.has(r.entity_id)) {
      addressedIds.push(r.entity_id);
      addressedCriticalRisks += 1;
    } else {
      gaps.push({
        kind: "critical_risk",
        id: r.entity_id,
        label: r.entity_name || r.summary || r.entity_id,
        why_important: `Critical risk (blast radius ${r.blast_radius}) not addressed by any action in the plan`,
      });
    }
  }

  // High-impact hidden signals
  const highImpactSignals = (input.hidden_signals ?? []).filter(isHighImpactSignal);
  let addressedHighImpactSignals = 0;
  for (const s of highImpactSignals) {
    if (signalMatches(allHiddenSignalRefs, s)) {
      addressedHighImpactSignals += 1;
      addressedIds.push(signalSlug(s));
    } else {
      gaps.push({
        kind: "high_impact_signal",
        id: signalSlug(s),
        label: s.signal_name || s.description?.slice(0, 80) || "unnamed signal",
        why_important: `High-impact hidden signal (type=${s.signal_type}) with no linked action — latent mechanism unaccounted for`,
      });
    }
  }

  const totals = {
    critical_axioms: criticalAxioms.length,
    hidden_axioms: hiddenAxioms.length,
    critical_risks: criticalRisks.length,
    high_impact_signals: highImpactSignals.length,
  };
  const addressedCounts = {
    critical_axioms: addressedCriticalAxioms,
    hidden_axioms: addressedHiddenAxioms,
    critical_risks: addressedCriticalRisks,
    high_impact_signals: addressedHighImpactSignals,
  };

  const totalFindings =
    totals.critical_axioms +
    totals.hidden_axioms +
    totals.critical_risks +
    totals.high_impact_signals;
  const totalAddressed =
    addressedCounts.critical_axioms +
    addressedCounts.hidden_axioms +
    addressedCounts.critical_risks +
    addressedCounts.high_impact_signals;
  const overall_coverage = totalFindings > 0
    ? Math.round((totalAddressed / totalFindings) * 100)
    : 100;

  return {
    overall_coverage,
    addressed_ids: addressedIds,
    gaps,
    totals,
    addressed_counts: addressedCounts,
  };
}

/**
 * Convert coverage gaps into follow-up open_questions. Each gap becomes a question
 * pointing at the unaddressed finding — surfaces actionable work for the user.
 * Returns questions to be merged with existing open_questions (caller dedupes).
 */
export function gapsToOpenQuestions(
  audit: StrategyCoverageAudit,
): Array<{
  question: string;
  why_it_matters: string;
  what_changes?: string;
  priority?: "critical" | "high" | "medium";
  ranking_reason?: string;
  related_entity_ids?: string[];
}> {
  return audit.gaps.map((gap) => {
    const priority: "critical" | "high" | "medium" =
      gap.kind === "hidden_axiom" ? "critical"
      : gap.kind === "critical_axiom" ? "critical"
      : gap.kind === "critical_risk" ? "high"
      : "high";
    const question =
      gap.kind === "hidden_axiom"
        ? `How would we validate "${gap.label}" — the hidden assumption no current action tests?`
        : gap.kind === "critical_axiom"
          ? `What action should address "${gap.label}" before the strategy can be trusted?`
          : gap.kind === "critical_risk"
            ? `What contingency exists for "${gap.label}" if it materializes?`
            : `Which action responds to the "${gap.label}" signal?`;
    return {
      question,
      why_it_matters: `${gap.why_important} — auto-generated from strategy coverage audit (${gap.kind.replace(/_/g, " ")} gap).`,
      what_changes: `Answering this fills a gap in the strategy — currently no action addresses this finding.`,
      priority,
      ranking_reason: `Coverage audit flagged ${gap.kind.replace(/_/g, " ")} as unaddressed`,
      related_entity_ids: [gap.id],
    };
  });
}
