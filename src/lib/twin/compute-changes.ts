import type { SynthesisData } from "@/types/synthesis";
import type {
  ChangeDetection,
  SynthesisDelta,
  ChangeMagnitude,
} from "@/types/twin";
import type { ImprovementGoal } from "@/types/goals";

/**
 * Computes what changed between two synthesis snapshots.
 * Returns a SynthesisDelta describing added/removed/shifted findings.
 */
export function computeSynthesisDelta(
  oldSynthesis: Partial<SynthesisData>,
  newSynthesis: Partial<SynthesisData>
): SynthesisDelta {
  // Leverage points — compare by entity_id
  const oldLeverage = new Set(
    (oldSynthesis.leverage_points ?? []).map((lp) => lp.entity_id)
  );
  const newLeverage = new Set(
    (newSynthesis.leverage_points ?? []).map((lp) => lp.entity_id)
  );
  const leverageAdded = [...newLeverage].filter((id) => !oldLeverage.has(id));
  const leverageRemoved = [...oldLeverage].filter((id) => !newLeverage.has(id));

  // Risk points — compare by entity_id
  const oldRisks = new Set(
    (oldSynthesis.risk_points ?? []).map((rp) => rp.entity_id)
  );
  const newRisks = new Set(
    (newSynthesis.risk_points ?? []).map((rp) => rp.entity_id)
  );
  const riskAdded = [...newRisks].filter((id) => !oldRisks.has(id));
  const riskRemoved = [...oldRisks].filter((id) => !newRisks.has(id));

  // Bottleneck shift
  const oldBottleneck = oldSynthesis.master_bottleneck?.entity_id ?? null;
  const newBottleneck = newSynthesis.master_bottleneck?.entity_id ?? null;
  const bottleneckChanged = oldBottleneck !== newBottleneck;

  // Feedback loops — compare by name
  const oldLoops = new Set(
    (oldSynthesis.feedback_loops ?? []).map((fl) => fl.name)
  );
  const newLoops = new Set(
    (newSynthesis.feedback_loops ?? []).map((fl) => fl.name)
  );
  const loopsAdded = [...newLoops].filter((n) => !oldLoops.has(n));
  const loopsRemoved = [...oldLoops].filter((n) => !newLoops.has(n));

  // Open questions — compare by question text (fuzzy match by first 50 chars)
  const oldQuestions = new Set(
    (oldSynthesis.open_questions ?? []).map((q) => q.question.slice(0, 50))
  );
  const newQuestions = new Set(
    (newSynthesis.open_questions ?? []).map((q) => q.question.slice(0, 50))
  );
  const questionsNew = (newSynthesis.open_questions ?? [])
    .filter((q) => !oldQuestions.has(q.question.slice(0, 50)))
    .map((q) => q.question);
  const questionsResolved = (oldSynthesis.open_questions ?? [])
    .filter((q) => !newQuestions.has(q.question.slice(0, 50)))
    .map((q) => q.question);

  // Contradictions — count-based
  const oldContradictions = oldSynthesis.contradictions?.length ?? 0;
  const newContradictions = newSynthesis.contradictions?.length ?? 0;
  const contradictionsNew = Math.max(0, newContradictions - oldContradictions);
  const contradictionsResolved = Math.max(0, oldContradictions - newContradictions);

  // Scenarios — count changes
  const oldScenarios = oldSynthesis.scenarios?.length ?? 0;
  const newScenarios = newSynthesis.scenarios?.length ?? 0;
  const scenariosChanged = Math.abs(newScenarios - oldScenarios);

  return {
    leverage_added: leverageAdded,
    leverage_removed: leverageRemoved,
    risk_added: riskAdded,
    risk_removed: riskRemoved,
    bottleneck_changed: bottleneckChanged,
    bottleneck_old: oldBottleneck,
    bottleneck_new: newBottleneck,
    loops_added: loopsAdded,
    loops_removed: loopsRemoved,
    questions_new: questionsNew,
    questions_resolved: questionsResolved,
    contradictions_new: contradictionsNew,
    contradictions_resolved: contradictionsResolved,
    scenarios_changed: scenariosChanged,
  };
}

/**
 * Classifies how significant a set of changes is.
 */
export function classifyMagnitude(
  delta: SynthesisDelta,
  healthDelta: number
): ChangeMagnitude {
  const significantSignals =
    delta.bottleneck_changed ||
    delta.risk_added.length >= 2 ||
    delta.leverage_removed.length >= 2 ||
    Math.abs(healthDelta) >= 10;

  const moderateSignals =
    delta.leverage_added.length >= 1 ||
    delta.leverage_removed.length >= 1 ||
    delta.risk_added.length >= 1 ||
    delta.risk_removed.length >= 1 ||
    delta.loops_added.length >= 1 ||
    delta.loops_removed.length >= 1 ||
    delta.contradictions_new >= 1 ||
    Math.abs(healthDelta) >= 5;

  if (significantSignals) return "significant";
  if (moderateSignals) return "moderate";
  return "minor";
}

/**
 * Generates a human-readable summary of changes.
 */
export function generateChangeSummary(
  delta: SynthesisDelta,
  healthDelta: number
): string {
  const parts: string[] = [];

  if (healthDelta !== 0) {
    parts.push(
      `System health ${healthDelta > 0 ? "improved" : "declined"} by ${Math.abs(healthDelta)} points`
    );
  }

  if (delta.bottleneck_changed) {
    if (delta.bottleneck_new && delta.bottleneck_old) {
      parts.push(`Bottleneck shifted from ${delta.bottleneck_old} to ${delta.bottleneck_new}`);
    } else if (delta.bottleneck_new) {
      parts.push(`New bottleneck identified: ${delta.bottleneck_new}`);
    } else {
      parts.push("Previous bottleneck resolved");
    }
  }

  if (delta.leverage_added.length > 0) {
    parts.push(`${delta.leverage_added.length} new leverage point${delta.leverage_added.length > 1 ? "s" : ""} detected`);
  }
  if (delta.leverage_removed.length > 0) {
    parts.push(`${delta.leverage_removed.length} leverage point${delta.leverage_removed.length > 1 ? "s" : ""} no longer relevant`);
  }

  if (delta.risk_added.length > 0) {
    parts.push(`${delta.risk_added.length} new risk${delta.risk_added.length > 1 ? "s" : ""} identified`);
  }
  if (delta.risk_removed.length > 0) {
    parts.push(`${delta.risk_removed.length} risk${delta.risk_removed.length > 1 ? "s" : ""} mitigated`);
  }

  if (delta.loops_added.length > 0) {
    parts.push(`${delta.loops_added.length} new feedback loop${delta.loops_added.length > 1 ? "s" : ""}`);
  }

  if (delta.questions_resolved.length > 0) {
    parts.push(`${delta.questions_resolved.length} question${delta.questions_resolved.length > 1 ? "s" : ""} resolved`);
  }
  if (delta.questions_new.length > 0) {
    parts.push(`${delta.questions_new.length} new question${delta.questions_new.length > 1 ? "s" : ""} surfaced`);
  }

  if (parts.length === 0) return "Minor refinements to analysis";

  return parts.join(". ") + ".";
}

/**
 * Determines which objectives are affected by synthesis changes.
 * An objective is "affected" if its source entity was in a changed set.
 */
export function findAffectedObjectives(
  delta: SynthesisDelta,
  goals: ImprovementGoal[]
): { affectedIds: string[]; stale: boolean } {
  if (goals.length === 0) return { affectedIds: [], stale: false };

  // Build set of all changed entity IDs
  const changedEntities = new Set([
    ...delta.leverage_added,
    ...delta.leverage_removed,
    ...delta.risk_added,
    ...delta.risk_removed,
  ]);
  if (delta.bottleneck_old) changedEntities.add(delta.bottleneck_old);
  if (delta.bottleneck_new) changedEntities.add(delta.bottleneck_new);

  // Any goal whose description or title references a changed entity is affected
  // (For now, we mark all active goals as potentially stale on significant changes)
  const affectedIds: string[] = [];
  for (const goal of goals) {
    const desc = `${goal.title} ${goal.description ?? ""}`.toLowerCase();
    for (const entityId of changedEntities) {
      if (desc.includes(entityId.toLowerCase())) {
        affectedIds.push(goal.id);
        break;
      }
    }
  }

  // If the change is structural (bottleneck shift, leverage changes),
  // all active goals should be considered stale
  const stale =
    delta.bottleneck_changed ||
    delta.leverage_added.length + delta.leverage_removed.length >= 2 ||
    delta.risk_added.length >= 2;

  return { affectedIds, stale };
}

/**
 * Full change detection: compares old and new synthesis, computes health delta,
 * and returns a ChangeDetection object.
 */
export function detectChanges(
  oldSynthesis: Partial<SynthesisData>,
  newSynthesis: Partial<SynthesisData>,
  healthBefore: number,
  healthAfter: number,
  goals: ImprovementGoal[] = []
): ChangeDetection | null {
  const delta = computeSynthesisDelta(oldSynthesis, newSynthesis);
  const healthDelta = healthAfter - healthBefore;

  // Check if anything actually changed
  const totalChanges =
    delta.leverage_added.length +
    delta.leverage_removed.length +
    delta.risk_added.length +
    delta.risk_removed.length +
    delta.loops_added.length +
    delta.loops_removed.length +
    delta.questions_new.length +
    delta.questions_resolved.length +
    delta.contradictions_new +
    delta.contradictions_resolved +
    delta.scenarios_changed +
    (delta.bottleneck_changed ? 1 : 0);

  if (totalChanges === 0 && healthDelta === 0) return null;

  const magnitude = classifyMagnitude(delta, healthDelta);
  const summary = generateChangeSummary(delta, healthDelta);
  const { affectedIds, stale } = findAffectedObjectives(delta, goals);

  return {
    detected_at: new Date().toISOString(),
    magnitude,
    health_before: healthBefore,
    health_after: healthAfter,
    health_delta: healthDelta,
    synthesis_delta: delta,
    summary,
    affected_objective_ids: affectedIds,
    objectives_stale: stale,
  };
}
