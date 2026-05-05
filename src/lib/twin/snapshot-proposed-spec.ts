// Build a ProposedTwinSpec snapshot from a strategy + current twin state.
//
// Called at the moment the user approves a twin proposal (or when the
// strategy generator extracts a proposal on the fly). The snapshot is
// persisted to twin_proposals.proposed_spec so that later renders can diff
// the materialized twin against what was actually promised.
//
// Pure function — no DB writes, no LLM calls. The caller persists the
// returned object via the twin_proposals approve route.
//
// Why this exists: the workflow pill at digital-twin-flowchart.tsx
// previously read deltaCounts directly from the latest strategy's
// infrastructure_map.core_components[].status — honest about the current
// proposal, but lost the audit trail when the strategy regenerated. This
// snapshot is the contract.

import type { StrategicRecommendation, InfrastructureProposal } from "@/types/strategy";
import type { ImprovementGoal } from "@/types/goals";
import type {
  ProposedTwinSpec,
  ProposedEntityIntent,
  ProposedChannelIntent,
  ProposedLoopIntent,
  ProposedAppIntent,
  TwinState,
  EntityIntentStatus,
} from "@/types/twin";

export interface SnapshotProposedSpecArgs {
  recommendation: StrategicRecommendation;
  /** Apps the proposal commits to materializing. Pulled from the same
   *  ranked_strategies entry as the recommendation. */
  proposals: InfrastructureProposal[];
  /** Current twin state at proposal time — frozen as the comparison baseline. */
  currentTwinState: TwinState;
  /** ISO timestamp; defaults to now. */
  proposedAt?: string;
  /** Optional strategy version stamp for provenance. */
  sourceStrategyVersion?: number | null;
  /** The active goal at proposal time, if any. */
  activeGoal?: ImprovementGoal | null;
}

const PRIORITY_VALUES: ReadonlyArray<"critical" | "important" | "supporting"> = [
  "critical",
  "important",
  "supporting",
];

function normalizePriority(
  raw: string | undefined,
): "critical" | "important" | "supporting" {
  if (raw && (PRIORITY_VALUES as readonly string[]).includes(raw)) {
    return raw as "critical" | "important" | "supporting";
  }
  return "important";
}

function normalizeStatus(raw: string | undefined): EntityIntentStatus {
  if (raw === "needs_building" || raw === "needs_strengthening" || raw === "exists") {
    return raw;
  }
  return "exists";
}

function normalizeStrength(
  raw: string | undefined,
): "strong" | "moderate" {
  return raw === "strong" ? "strong" : "moderate";
}

export function snapshotProposedSpec(
  args: SnapshotProposedSpecArgs,
): ProposedTwinSpec {
  const {
    recommendation,
    proposals,
    currentTwinState,
    proposedAt = new Date().toISOString(),
    sourceStrategyVersion = null,
    activeGoal,
  } = args;

  const core = recommendation.infrastructure_map?.core_components ?? [];
  const channels = recommendation.infrastructure_map?.key_channels ?? [];
  const activatedLoops = recommendation.infrastructure_map?.activated_loops ?? [];

  // Per-entity intents — one per core_component.
  const entity_intents: ProposedEntityIntent[] = core.map((c) => ({
    entity_id: c.entity_id,
    entity_name: c.entity_name,
    intended_status: normalizeStatus(c.status),
    role: c.role,
    priority: normalizePriority(c.priority),
  }));

  const channel_intents: ProposedChannelIntent[] = channels.map((ch) => ({
    from: ch.from,
    to: ch.to,
    channel_type: ch.channel_type,
    strength_needed: normalizeStrength(ch.strength_needed),
    expected_at_proposal: ch.exists === true,
  }));

  const loop_intents: ProposedLoopIntent[] = activatedLoops.map((l) => ({
    loop_name: l.name,
    activation_phase: l.activation_phase,
  }));

  // Per-app intents — pull optimization_target from app spec when available.
  // The InfrastructureProposal type carries `description` + `metrics_tracked`;
  // we treat description as the optimization target prose when no explicit
  // field is present (most existing recommendations don't set one).
  const app_intents: ProposedAppIntent[] = proposals.map((p) => ({
    proposal_id: p.id,
    name: p.name,
    type: p.type,
    optimization_target: p.description ?? "",
    metrics_tracked: p.metrics_tracked ?? [],
  }));

  // Denormalized counts — the diff renderer reads these to avoid walking
  // the intent arrays on every render.
  let new_entities = 0;
  let strengthened_entities = 0;
  let existing_baseline = 0;
  for (const e of entity_intents) {
    if (e.intended_status === "needs_building") new_entities++;
    else if (e.intended_status === "needs_strengthening") strengthened_entities++;
    else existing_baseline++;
  }
  const new_channels = channel_intents.filter((c) => !c.expected_at_proposal).length;

  const goal_anchor = activeGoal
    ? {
        macro: activeGoal.title,
        target_metric: activeGoal.metric_name ?? "",
        current: activeGoal.current_value != null ? String(activeGoal.current_value) : "",
        target: activeGoal.target_value != null ? String(activeGoal.target_value) : "",
      }
    : null;

  return {
    proposed_at: proposedAt,
    source_strategy_version: sourceStrategyVersion,
    entity_intents,
    channel_intents,
    loop_intents,
    app_intents,
    goal_anchor,
    promised_counts: {
      new_entities,
      strengthened_entities,
      existing_baseline,
      new_channels,
      activated_loops: loop_intents.length,
      total_apps: app_intents.length,
    },
    twin_state_at_proposal: {
      health_score: currentTwinState.macro.health_score,
      entities_modeled: currentTwinState.macro.coverage.entities_modeled,
      edges_mapped: currentTwinState.macro.coverage.edges_mapped,
      cycles_detected: currentTwinState.macro.coverage.cycles_detected,
      total_loops: currentTwinState.macro.dynamics.total_loops,
      leverage_points: currentTwinState.macro.dynamics.leverage_points,
      critical_risks: currentTwinState.macro.risk_exposure.critical_risks,
    },
  };
}
