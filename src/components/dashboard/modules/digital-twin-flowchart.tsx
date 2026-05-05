"use client";

import { useMemo, useState } from "react";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData, RichFeedbackLoop } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { InfrastructureMap } from "@/types/strategy";
import type { ProposedTwinSpec, TwinState } from "@/types/twin";
import { computeTwinProposalDiff } from "@/lib/twin/compute-twin-proposal-diff";
import { TwinProposalDiffStrip } from "./twin-proposal-diff-strip";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  Zap,
  AlertTriangle,
  Lock,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Circle,
  Activity,
  Target,
  Sparkles,
  Hammer,
  CheckCircle2,
} from "lucide-react";

// ── Types ──

export interface DigitalTwinFlowchartProps {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  synthesisData: SynthesisData | null;
  activeGoal: ImprovementGoal | null;
  onEntityClick?: (entity: Entity) => void;
  /**
   * Infrastructure map from the approved strategic recommendation.
   * When provided, stages + variables get visual weighting to show the
   * DELTA between the current baseline and the strategy-proposed additions:
   *   - exists                 → muted / hairline (the user's current state)
   *   - needs_strengthening    → amber accent ring (AI is amplifying this)
   *   - needs_building         → thick stroke + "NEW" badge (AI is adding this)
   */
  infrastructureMap?: InfrastructureMap | null;
  /**
   * Frozen proposal snapshot from twin_proposals.proposed_spec. When present,
   * the header pill renders an honest proposed-vs-actual diff (matched /
   * missing / baseline counts + materialization fidelity) instead of the
   * legacy infrastructure_map status counts. Older spaces approved before
   * the snapshot column landed pass null and fall back to the legacy pill
   * rendering — no UI regression.
   */
  proposedSpec?: ProposedTwinSpec | null;
  /** Required alongside proposedSpec to compute the health-delta chip. */
  currentTwinState?: TwinState | null;
  /**
   * Minimal space shape — only `maturity` is read, used by the workflow's
   * baseline-anchor metadata so the user has an explicit "you are here"
   * zero-point. Optional; baseline anchor renders only when this is present.
   */
  space?: { maturity?: string | null } | null;
}

/** Per-entity infra status, used to drive "baseline vs added" visual weighting. */
export type InfraStatus = "exists" | "needs_strengthening" | "needs_building";

/**
 * A workflow stage — one "phase" the user goes through in their process.
 * Derived from process entities + their causal/temporal ordering.
 */
interface WorkflowStage {
  id: string;
  name: string;
  entity: Entity;
  /** Variables the user manages at this stage (connected concrete/abstract entities) */
  variables: Array<{
    entity: Entity;
    role: "input" | "output" | "lever" | "risk" | "bottleneck";
    relationship: string;
    /** Infra status for this variable's entity (baseline vs added). Null = no strategy annotation. */
    infra_status: InfraStatus | null;
  }>;
  /** Feedback loops touching this stage */
  loops: Array<{
    loop: RichFeedbackLoop;
    role: "source" | "target" | "through";
  }>;
  /** Stage status derived from goal + synthesis */
  status: "not_started" | "active" | "blocked" | "completed" | "at_risk";
  /** Position in the sequence (0-based) */
  order: number;
  /** Infra status for the stage's primary entity (drives stage-level visual weighting). */
  infra_status: InfraStatus | null;
  /**
   * Why this stage sits where it does in the order. Computed alongside the
   * topological sort so the user can audit the precedence logic instead of
   * trusting an opaque sequence. Without this, an arbitrary-looking stage 1
   * (e.g. "Data Privacy Management") looks like it was hand-picked when in
   * reality it just happened to have zero in-degree at sort time.
   */
  precedence: {
    /** Stages that causally precede this one (in-edges). Empty = "starting node". */
    predecessors: Array<{ stage_id: string; entity_name: string; relation: string }>;
    /**
     * Why this stage occupies its slot. Honest when there's no real signal:
     *   - "follows X (causal)"          ← had a real predecessor
     *   - "starting node — no upstream" ← legitimate starting point
     *   - "tied — no causal predecessor; ordered by importance" ← tie-broken
     */
    rationale: string;
    /** True when the placement is genuinely earned by causal predecessors. */
    causally_anchored: boolean;
  };
}

/** A connection between stages showing flow/dependency */
interface StageConnection {
  fromStageId: string;
  toStageId: string;
  label: string;
  type: "flow" | "dependency" | "feedback";
  polarity: "positive" | "negative" | "neutral";
}

/**
 * Workflow-level metadata returned alongside stages. Surfaces the topology's
 * honesty (how much of the order is causal vs tie-broken-by-importance) and
 * names the baseline the workflow is anchored to.
 */
interface WorkflowMeta {
  /**
   * Ratio in [0, 1] — fraction of stages that have at least one causal
   * predecessor. When this is low (< 0.3), the order is mostly determined
   * by importance tier, not real precedence — surface an honest banner.
   */
  causal_density: number;
  /** Total causal/temporal/functional/agentive edges between stage entities. */
  causal_edge_count: number;
  /** Stages whose order is genuinely earned by causal predecessors. */
  causally_anchored_count: number;
  /**
   * Baseline anchor — the user's starting state. Surfaced as a "you are
   * here" header so the workflow has an explicit zero-point. Pulled from
   * space.maturity + activeGoal.baseline_value when available.
   */
  baseline_anchor: {
    label: string;
    detail: string;
  } | null;
  /** Why this workflow exists — addresses the master bottleneck if known. */
  purpose: string | null;
}

// ── Helpers ──

const IMPORTANCE_ORDER: Record<string, number> = {
  fundamental: 0,
  critical: 1,
  important: 2,
  moderate: 3,
};

/**
 * Build a workflow model from the knowledge graph.
 *
 * Strategy:
 * 1. Find "process" entities — these are the user's workflow stages
 * 2. If not enough process entities, find causal chains and derive stages
 * 3. For each stage, find connected variables (concrete/abstract entities)
 * 4. Order stages by causal/temporal edge topology
 * 5. Annotate with roles (leverage, risk, bottleneck)
 */
function buildWorkflowModel(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  synthesisData: SynthesisData | null,
  activeGoal: ImprovementGoal | null,
  infrastructureMap?: InfrastructureMap | null,
  space?: { maturity?: string | null } | null,
): {
  stages: WorkflowStage[];
  connections: StageConnection[];
  meta: WorkflowMeta;
} {
  const entityById = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.entity_id, e);
    entityById.set(e.id, e);
  }

  // Build entity_id → infra_status map from the strategy's infrastructure plan.
  // This is the delta signal that drives "baseline vs added" visual weighting.
  const infraStatusMap = new Map<string, InfraStatus>();
  if (infrastructureMap?.core_components) {
    for (const comp of infrastructureMap.core_components) {
      if (comp.entity_id && comp.status) {
        infraStatusMap.set(comp.entity_id, comp.status);
      }
    }
  }
  const getInfraStatus = (entity: Entity): InfraStatus | null => {
    return (
      infraStatusMap.get(entity.entity_id) ??
      infraStatusMap.get(entity.id) ??
      null
    );
  };

  // Gather IDs referenced by synthesis
  const leverageIds = new Set(
    (synthesisData?.leverage_points ?? []).map((lp) => lp.entity_id)
  );
  const riskIds = new Set(
    (synthesisData?.risk_points ?? []).map((rp) => rp.entity_id)
  );
  const bottleneckId = synthesisData?.master_bottleneck?.entity_id ?? null;

  // ── Step 1: Identify stage candidates ──
  // Prefer process entities; fall back to high-importance causal entities
  const processEntities = entities.filter(
    (e) => e.entity_category === "process" && (e.knowledge_layer === "internal" || e.knowledge_layer === "conceptual")
  );

  let stageCandidates: Entity[];
  if (processEntities.length >= 3) {
    stageCandidates = processEntities;
  } else {
    // Fall back: take entities that participate in causal/temporal chains
    const causalParticipants = new Set<string>();
    for (const edge of edges) {
      if (
        edge.dimension === "causal" ||
        edge.dimension === "temporal" ||
        edge.dimension === "functional"
      ) {
        causalParticipants.add(edge.source_entity_id);
        causalParticipants.add(edge.target_entity_id);
      }
    }

    // Merge process entities + causal participants, prioritize by importance
    const candidateSet = new Set([
      ...processEntities.map((e) => e.id),
      ...Array.from(causalParticipants),
    ]);

    stageCandidates = entities
      .filter(
        (e) =>
          candidateSet.has(e.id) &&
          (e.knowledge_layer === "internal" || e.knowledge_layer === "conceptual") &&
          e.entity_category !== "epistemic"
      )
      .sort(
        (a, b) =>
          (IMPORTANCE_ORDER[a.importance ?? "moderate"] ?? 3) -
          (IMPORTANCE_ORDER[b.importance ?? "moderate"] ?? 3)
      )
      .slice(0, 8);
  }

  // Ensure bottleneck + leverage + risk entities are included as stages or variables
  const specialEntities = entities.filter(
    (e) =>
      e.is_master_bottleneck ||
      e.is_leverage_point ||
      e.is_risk_point
  );

  // ── Step 2: Topological ordering of stages by causal/temporal edges ──
  const stageIds = new Set(stageCandidates.map((e) => e.id));

  // Build adjacency from causal/temporal/functional edges between stage candidates
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const edgeLabels = new Map<string, string>();

  for (const edge of edges) {
    if (
      stageIds.has(edge.source_entity_id) &&
      stageIds.has(edge.target_entity_id) &&
      edge.source_entity_id !== edge.target_entity_id &&
      (edge.dimension === "causal" ||
        edge.dimension === "temporal" ||
        edge.dimension === "functional" ||
        edge.dimension === "agentive")
    ) {
      const key = `${edge.source_entity_id}→${edge.target_entity_id}`;
      if (!outgoing.has(edge.source_entity_id))
        outgoing.set(edge.source_entity_id, []);
      outgoing.get(edge.source_entity_id)!.push(edge.target_entity_id);
      if (!incoming.has(edge.target_entity_id))
        incoming.set(edge.target_entity_id, []);
      incoming.get(edge.target_entity_id)!.push(edge.source_entity_id);
      edgeLabels.set(key, edge.relationship_type ?? edge.dimension ?? "→");
    }
  }

  // Kahn's algorithm for topological sort. We also record, per stage, the
  // FIRST in-degree value at the start of the run — this is the count of
  // genuine causal predecessors and drives the per-stage rationale below.
  // (The dynamic `inDegree` map gets decremented during traversal; we need
  // the original count to know whether a stage was a real starting node
  // vs. a tie-broken-by-importance one.)
  const inDegree = new Map<string, number>();
  for (const id of stageIds) inDegree.set(id, 0);
  for (const [, targets] of outgoing) {
    for (const t of targets) {
      inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
    }
  }
  const initialInDegree = new Map(inDegree);

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    // Among candidates with 0 in-degree, pick by importance
    queue.sort((a, b) => {
      const ea = entityById.get(a);
      const eb = entityById.get(b);
      return (
        (IMPORTANCE_ORDER[ea?.importance ?? "moderate"] ?? 3) -
        (IMPORTANCE_ORDER[eb?.importance ?? "moderate"] ?? 3)
      );
    });
    const current = queue.shift()!;
    sorted.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Compute per-stage precedence info for the rationale renderer. A stage
  // is "causally anchored" iff it has at least one in-edge — meaning its
  // position was earned, not tie-broken by importance. We surface this on
  // the StageCard so users can audit "why does this come first?" instead
  // of trusting an opaque order.
  const initialZeroDegreeCount = sorted.filter(
    (id) => (initialInDegree.get(id) ?? 0) === 0,
  ).length;
  const isUnanchoredTieBreak = initialZeroDegreeCount > Math.max(1, sorted.length * 0.7);
  const buildPrecedence = (stageId: string): WorkflowStage["precedence"] => {
    const preds = incoming.get(stageId) ?? [];
    const predecessorEntries = preds.map((pid) => {
      const e = entityById.get(pid);
      const key = `${pid}→${stageId}`;
      return {
        stage_id: pid,
        entity_name: e?.name ?? pid,
        relation: edgeLabels.get(key) ?? "precedes",
      };
    });

    if (predecessorEntries.length > 0) {
      const top = predecessorEntries[0];
      const more =
        predecessorEntries.length > 1
          ? ` (+${predecessorEntries.length - 1} more)`
          : "";
      return {
        predecessors: predecessorEntries,
        rationale: `follows ${top.entity_name} (${top.relation})${more}`,
        causally_anchored: true,
      };
    }
    // No upstream stages — but is this a *legitimate* starting node, or
    // an artifact of a sparse causal graph?
    if (isUnanchoredTieBreak) {
      return {
        predecessors: [],
        rationale: "no causal predecessor — placed by importance, not dependency",
        causally_anchored: false,
      };
    }
    return {
      predecessors: [],
      rationale: "starting node — no upstream stage",
      causally_anchored: false,
    };
  };

  // Add any unsorted (cycle members) at the end
  for (const id of stageIds) {
    if (!sorted.includes(id)) sorted.push(id);
  }

  // ── Step 3: Build stages with variables ──
  const usedAsVariable = new Set<string>();
  const stages: WorkflowStage[] = sorted.map((stageId, idx) => {
    const entity = entityById.get(stageId)!;
    if (!entity) {
      return {
        id: stageId,
        name: "Unknown",
        entity: entities[0],
        variables: [],
        loops: [],
        status: "not_started" as const,
        order: idx,
        infra_status: null,
        precedence: buildPrecedence(stageId),
      };
    }

    // Find connected non-stage entities as "variables"
    const variables: WorkflowStage["variables"] = [];
    for (const edge of edges) {
      let varId: string | null = null;
      let rel = edge.relationship_type ?? "";

      if (edge.source_entity_id === stageId && !stageIds.has(edge.target_entity_id)) {
        varId = edge.target_entity_id;
      } else if (edge.target_entity_id === stageId && !stageIds.has(edge.source_entity_id)) {
        varId = edge.source_entity_id;
      }

      if (!varId) continue;
      const varEntity = entityById.get(varId);
      if (!varEntity || varEntity.knowledge_layer === "external") continue;
      if (usedAsVariable.has(varId) && !varEntity.is_leverage_point && !varEntity.is_risk_point && !varEntity.is_master_bottleneck) continue;

      // Determine role
      let role: "input" | "output" | "lever" | "risk" | "bottleneck" = "input";
      if (varEntity.id === bottleneckId || varEntity.entity_id === bottleneckId)
        role = "bottleneck";
      else if (varEntity.is_master_bottleneck) role = "bottleneck";
      else if (
        varEntity.is_leverage_point ||
        leverageIds.has(varEntity.entity_id) ||
        leverageIds.has(varEntity.id)
      )
        role = "lever";
      else if (
        varEntity.is_risk_point ||
        riskIds.has(varEntity.entity_id) ||
        riskIds.has(varEntity.id)
      )
        role = "risk";
      else if (edge.target_entity_id === stageId) role = "input";
      else role = "output";

      variables.push({
        entity: varEntity,
        role,
        relationship: rel,
        infra_status: getInfraStatus(varEntity),
      });
      usedAsVariable.add(varId);
    }

    // Also include special entities directly connected even if already used
    for (const se of specialEntities) {
      if (se.id === stageId) continue;
      if (variables.some((v) => v.entity.id === se.id)) continue;
      // Check if there's an edge
      const hasEdge = edges.some(
        (e) =>
          (e.source_entity_id === stageId && e.target_entity_id === se.id) ||
          (e.target_entity_id === stageId && e.source_entity_id === se.id)
      );
      if (hasEdge) {
        let role: "lever" | "risk" | "bottleneck" = "lever";
        if (se.is_master_bottleneck || se.id === bottleneckId) role = "bottleneck";
        else if (se.is_risk_point) role = "risk";
        variables.push({
          entity: se,
          role,
          relationship: "",
          infra_status: getInfraStatus(se),
        });
      }
    }

    // Sort variables: bottleneck first, then lever, risk, input, output
    const roleOrder = { bottleneck: 0, lever: 1, risk: 2, input: 3, output: 4 };
    variables.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);

    // Limit to 5 most important variables per stage
    const trimmedVars = variables.slice(0, 5);

    // Find feedback loops touching this stage
    const loops: WorkflowStage["loops"] = [];
    for (const fl of synthesisData?.feedback_loops ?? []) {
      const steps = Array.isArray(fl.steps) ? fl.steps : [];
      const entityName = entity.name.toLowerCase();
      const matchIdx = steps.findIndex(
        (s) => s.toLowerCase().includes(entityName)
      );
      if (matchIdx >= 0) {
        loops.push({
          loop: fl,
          role:
            matchIdx === 0
              ? "source"
              : matchIdx === steps.length - 1
                ? "target"
                : "through",
        });
      }
    }

    // Determine stage status
    let status: WorkflowStage["status"] = "not_started";
    if (entity.is_master_bottleneck) status = "blocked";
    else if (entity.is_risk_point) status = "at_risk";
    else if (activeGoal) {
      // Heuristic: earlier stages more likely active/completed
      const progressPct = activeGoal.target_value && activeGoal.baseline_value
        ? ((Number(activeGoal.current_value) - Number(activeGoal.baseline_value)) /
            (Number(activeGoal.target_value) - Number(activeGoal.baseline_value))) *
          100
        : 0;
      const stageProgressThreshold = ((idx + 1) / sorted.length) * 100;
      if (progressPct >= stageProgressThreshold) status = "completed";
      else if (progressPct >= stageProgressThreshold - 20) status = "active";
    }

    return {
      id: stageId,
      name: entity.name,
      entity,
      variables: trimmedVars,
      loops,
      status,
      order: idx,
      infra_status: getInfraStatus(entity),
      precedence: buildPrecedence(stageId),
    };
  });

  // ── Step 4: Build connections between stages ──
  const connections: StageConnection[] = [];
  const seenConnections = new Set<string>();

  for (const edge of edges) {
    if (
      stageIds.has(edge.source_entity_id) &&
      stageIds.has(edge.target_entity_id) &&
      edge.source_entity_id !== edge.target_entity_id
    ) {
      const key = `${edge.source_entity_id}→${edge.target_entity_id}`;
      if (seenConnections.has(key)) continue;
      seenConnections.add(key);

      const isFeedback = edge.is_part_of_cycle;
      connections.push({
        fromStageId: edge.source_entity_id,
        toStageId: edge.target_entity_id,
        label: edge.relationship_type ?? "",
        type: isFeedback ? "feedback" : "flow",
        polarity: (edge.polarity as "positive" | "negative" | "neutral") ?? "neutral",
      });
    }
  }

  // ── Step 5: Build workflow-level metadata ──
  // Surfaces the topology's honesty + names a baseline anchor so the user
  // has an explicit zero-point. Without this the workflow renders as 87
  // identical "Pending" cards with no hint of "where am I?" or "is this
  // order earned?"
  const causallyAnchoredCount = stages.filter(
    (s) => s.precedence.causally_anchored,
  ).length;
  const causalDensity =
    stages.length > 0 ? causallyAnchoredCount / stages.length : 0;

  const causalEdgeCount = Array.from(outgoing.values()).reduce(
    (acc, arr) => acc + arr.length,
    0,
  );

  // Baseline anchor — the user's starting state. Pulled from space.maturity
  // and the active goal's baseline_value when both are available; falls
  // back to a maturity-only label otherwise.
  const baseline_anchor = ((): WorkflowMeta["baseline_anchor"] => {
    const maturity = space?.maturity ?? null;
    const baselineValue =
      activeGoal?.baseline_value != null && activeGoal.baseline_value !== ""
        ? String(activeGoal.baseline_value)
        : null;
    const metricName = activeGoal?.metric_name ?? null;

    if (!maturity && !baselineValue) return null;

    const maturityLabel =
      maturity === "actionable_now"
        ? "Actionable now"
        : maturity === "waiting_on_dependency"
          ? "Waiting on dependency"
          : maturity === "theoretical"
            ? "Theoretical"
            : maturity === "blocked"
              ? "Blocked"
              : null;

    const detailParts: string[] = [];
    if (baselineValue && metricName) {
      detailParts.push(`${metricName} starts at ${baselineValue}`);
    } else if (baselineValue) {
      detailParts.push(`baseline: ${baselineValue}`);
    }
    if (maturityLabel && !detailParts.length) {
      detailParts.push(maturityLabel);
    }

    return {
      label:
        maturityLabel ?? (baselineValue ? "Baseline captured" : "Starting state"),
      detail: detailParts.join(" · ") || "Workflow zero-point",
    };
  })();

  // Purpose — the workflow's reason for existing. Names the master
  // bottleneck so the user knows what this workflow is OPTIMIZING for.
  const bottleneckEntity = bottleneckId
    ? entityById.get(bottleneckId) ?? null
    : null;
  const purpose = bottleneckEntity
    ? `Resolves master bottleneck: ${bottleneckEntity.name}`
    : activeGoal?.title
      ? `Pursues goal: ${activeGoal.title}`
      : null;

  const meta: WorkflowMeta = {
    causal_density: causalDensity,
    causal_edge_count: causalEdgeCount,
    causally_anchored_count: causallyAnchoredCount,
    baseline_anchor,
    purpose,
  };

  return { stages, connections, meta };
}

// ── Status visual config ──

function getStageStatusConfig(status: WorkflowStage["status"]) {
  switch (status) {
    case "completed":
      return {
        border: "border-emerald-300",
        bg: "bg-emerald-50",
        badge: "bg-emerald-100 text-emerald-700",
        label: "Done",
        dot: "bg-emerald-500",
      };
    case "active":
      return {
        border: "border-indigo-300",
        bg: "bg-indigo-50/50",
        badge: "bg-indigo-100 text-indigo-700",
        label: "Active",
        dot: "bg-indigo-500",
      };
    case "blocked":
      return {
        border: "border-red-300",
        bg: "bg-red-50/50",
        badge: "bg-red-100 text-red-700",
        label: "Blocked",
        dot: "bg-red-500",
      };
    case "at_risk":
      return {
        border: "border-amber-300",
        bg: "bg-amber-50/50",
        badge: "bg-amber-100 text-amber-700",
        label: "At Risk",
        dot: "bg-amber-500",
      };
    case "not_started":
    default:
      return {
        border: "border-gray-200",
        bg: "bg-white",
        badge: "bg-gray-100 text-gray-500",
        label: "Pending",
        dot: "bg-gray-300",
      };
  }
}

const ROLE_CONFIG = {
  lever: { icon: <Zap className="h-3 w-3" />, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", label: "Lever" },
  risk: { icon: <AlertTriangle className="h-3 w-3" />, color: "text-red-600", bg: "bg-red-50", border: "border-red-200", label: "Risk" },
  bottleneck: { icon: <Lock className="h-3 w-3" />, color: "text-red-700", bg: "bg-red-50", border: "border-red-300", label: "Bottleneck" },
  input: { icon: <ArrowRight className="h-3 w-3" />, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", label: "Input" },
  output: { icon: <ArrowLeft className="h-3 w-3" />, color: "text-teal-600", bg: "bg-teal-50", border: "border-teal-200", label: "Output" },
};

/**
 * Visual treatment for a component's infra status.
 * Drives the "baseline vs added" delta emphasis requested by the user:
 *   - `needs_building`        thick teal ring + glow + "NEW" chip   (AI-added)
 *   - `needs_strengthening`   amber accent ring                     (AI-amplified)
 *   - `exists`                hairline / muted                      (user's baseline)
 *   - `null`                  neutral (no infra annotation available)
 *
 * Returning object fields intentionally mirror tailwind class names so
 * callers can cn() them without further conditionals.
 */
function getInfraVisuals(status: InfraStatus | null) {
  switch (status) {
    case "needs_building":
      return {
        ring: "ring-2 ring-teal-400 ring-offset-1",
        shadow: "shadow-[0_0_0_1px_rgba(20,184,166,0.35),0_6px_18px_-6px_rgba(20,184,166,0.4)]",
        badgeBg: "bg-teal-600 text-white",
        badgeLabel: "NEW",
        badgeIcon: <Sparkles className="h-2.5 w-2.5" />,
        label: "New component (AI-added)",
      };
    case "needs_strengthening":
      return {
        ring: "ring-1 ring-amber-400",
        shadow: "shadow-[0_0_0_1px_rgba(245,158,11,0.25)]",
        badgeBg: "bg-amber-500 text-white",
        badgeLabel: "AMPLIFY",
        badgeIcon: <Hammer className="h-2.5 w-2.5" />,
        label: "Existing, needs strengthening",
      };
    case "exists":
      return {
        ring: "",
        shadow: "",
        badgeBg: "bg-gray-100 text-gray-500",
        badgeLabel: "BASELINE",
        badgeIcon: <CheckCircle2 className="h-2.5 w-2.5" />,
        label: "Already exists in your setup",
      };
    case null:
    default:
      return null;
  }
}

// ── Sub-components ──

function VariablePill({
  variable,
  onClick,
}: {
  variable: WorkflowStage["variables"][0];
  onClick?: () => void;
}) {
  const rc = ROLE_CONFIG[variable.role];
  const iv = getInfraVisuals(variable.infra_status);
  const titleSuffix = iv ? ` · ${iv.label}` : "";
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-all hover:shadow-sm",
        rc.bg,
        rc.border,
        rc.color,
        // Subtle ring for added / amplified variables — makes them pop in dense clusters
        iv?.ring,
      )}
      title={`${rc.label}: ${variable.entity.name}${variable.relationship ? ` (${variable.relationship})` : ""}${titleSuffix}`}
    >
      <span className="text-[9px]">{rc.icon}</span>
      <span className="truncate max-w-[80px]">{variable.entity.name}</span>
      {variable.infra_status === "needs_building" && (
        <span className="flex h-3 items-center rounded-sm bg-teal-600 px-1 text-[7px] font-bold uppercase tracking-wide text-white">
          new
        </span>
      )}
      {variable.infra_status === "needs_strengthening" && (
        <span className="flex h-3 items-center rounded-sm bg-amber-500 px-1 text-[7px] font-bold uppercase tracking-wide text-white">
          +
        </span>
      )}
    </button>
  );
}

function FeedbackLoopBadge({ loop }: { loop: RichFeedbackLoop }) {
  const isPositive = loop.type === "positive";
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
        isPositive
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-red-50 text-red-700 border border-red-200"
      )}
      title={`${loop.name}: ${loop.explanation}`}
    >
      <RefreshCw className="h-2.5 w-2.5" />
      <span className="truncate max-w-[70px]">{loop.name}</span>
    </div>
  );
}

function StageCard({
  stage,
  isFirst,
  isLast,
  expanded,
  onToggle,
  onEntityClick,
}: {
  stage: WorkflowStage;
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEntityClick?: (entity: Entity) => void;
}) {
  const sc = getStageStatusConfig(stage.status);
  const iv = getInfraVisuals(stage.infra_status);
  const hasDetails = stage.variables.length > 0 || stage.loops.length > 0;

  return (
    <div className="relative">
      {/* Connection line to next stage */}
      {!isLast && (
        <div className="absolute left-6 top-full w-px h-4 bg-gray-200 z-0" />
      )}

      <div
        className={cn(
          "rounded-lg border-2 transition-all",
          sc.border,
          sc.bg,
          expanded && "shadow-sm",
          // Delta emphasis — prominent for newly-built stages, subtle for strengthened
          iv?.ring,
          iv?.shadow,
        )}
      >
        {/* Stage header */}
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        >
          {/* Stage number + status dot */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold",
                stage.status === "completed"
                  ? "bg-emerald-500 text-white"
                  : stage.status === "active"
                    ? "bg-indigo-500 text-white"
                    : stage.status === "blocked"
                      ? "bg-red-500 text-white"
                      : "bg-gray-200 text-gray-500"
              )}
            >
              {stage.status === "completed" ? "✓" : stage.order + 1}
            </div>
          </div>

          {/* Stage name + status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-900 truncate">
                {stage.name}
              </h4>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium flex-shrink-0",
                  sc.badge
                )}
              >
                {sc.label}
              </span>
              {iv && stage.infra_status !== "exists" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide flex-shrink-0",
                    iv.badgeBg,
                  )}
                  title={iv.label}
                >
                  {iv.badgeIcon}
                  {iv.badgeLabel}
                </span>
              )}
            </div>
            {/* Per-stage rationale — answers "why is this stage here?"
                Distinguishes earned-by-causal-edges placement from
                tie-broken-by-importance placement so the user can audit
                the order. Color-coded: gray=neutral starting node,
                indigo=causally anchored, amber=tie-broken (honest
                limitation). */}
            <p
              className={cn(
                "text-[10px] mt-0.5 truncate",
                stage.precedence.causally_anchored
                  ? "text-indigo-600"
                  : stage.precedence.predecessors.length === 0 &&
                      stage.precedence.rationale.startsWith("starting")
                    ? "text-gray-500"
                    : "text-amber-700",
              )}
              title={
                stage.precedence.predecessors.length > 0
                  ? `Predecessors: ${stage.precedence.predecessors
                      .map((p) => `${p.entity_name} (${p.relation})`)
                      .join(", ")}`
                  : stage.precedence.rationale
              }
            >
              {stage.precedence.causally_anchored ? "↳ " : "·  "}
              {stage.precedence.rationale}
            </p>
            {/* Quick variable summary when collapsed */}
            {!expanded && stage.variables.length > 0 && (
              <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                {stage.variables.map((v) => v.entity.name).join(" · ")}
              </p>
            )}
          </div>

          {/* Expand toggle */}
          {hasDetails && (
            <div className="flex-shrink-0 text-gray-400">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
          )}
        </button>

        {/* Expanded details */}
        {expanded && hasDetails && (
          <div className="border-t border-gray-100 px-3 py-2.5 space-y-2.5">
            {/* Variables the user manages at this stage */}
            {stage.variables.length > 0 && (
              <div>
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Variables at this stage
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stage.variables.map((v) => (
                    <VariablePill
                      key={v.entity.id}
                      variable={v}
                      onClick={() => onEntityClick?.(v.entity)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Feedback loops */}
            {stage.loops.length > 0 && (
              <div>
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Feedback loops
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stage.loops.map((l, i) => (
                    <FeedbackLoopBadge key={i} loop={l.loop} />
                  ))}
                </div>
              </div>
            )}

            {/* Entity description */}
            {stage.entity.description && (
              <p className="text-[10px] text-gray-500 leading-relaxed line-clamp-2">
                {stage.entity.description}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Arrow connector to next stage */}
      {!isLast && (
        <div className="flex items-center justify-center py-1">
          <ArrowRight className="h-3.5 w-3.5 text-gray-300 rotate-90" />
        </div>
      )}
    </div>
  );
}

// ── Mechanism Summary Panel ──

function MechanismSummary({
  synthesisData,
  stages,
}: {
  synthesisData: SynthesisData | null;
  stages: WorkflowStage[];
}) {
  if (!synthesisData) return null;

  const bottleneck = synthesisData.master_bottleneck;
  const leveragePoints = synthesisData.leverage_points ?? [];
  const feedbackLoops = synthesisData.feedback_loops ?? [];
  const blockedStage = stages.find((s) => s.status === "blocked");
  const activeStage = stages.find((s) => s.status === "active");

  const items: Array<{ icon: React.ReactNode; label: string; detail: string; color: string }> = [];

  if (activeStage) {
    items.push({
      icon: <Activity className="h-3 w-3" />,
      label: "Current phase",
      detail: activeStage.name,
      color: "text-indigo-600",
    });
  }

  if (bottleneck) {
    items.push({
      icon: <Lock className="h-3 w-3" />,
      label: "Bottleneck",
      detail: bottleneck.summary,
      color: "text-red-600",
    });
  }

  if (leveragePoints.length > 0) {
    items.push({
      icon: <Zap className="h-3 w-3" />,
      label: `${leveragePoints.length} leverage point${leveragePoints.length > 1 ? "s" : ""}`,
      detail: leveragePoints.map((lp) => lp.entity_name ?? lp.summary?.slice(0, 30)).join(", "),
      color: "text-amber-600",
    });
  }

  if (feedbackLoops.length > 0) {
    const positive = feedbackLoops.filter((l) => l.type === "positive").length;
    const negative = feedbackLoops.filter((l) => l.type === "negative").length;
    items.push({
      icon: <RefreshCw className="h-3 w-3" />,
      label: `${feedbackLoops.length} feedback loop${feedbackLoops.length > 1 ? "s" : ""}`,
      detail: `${positive} reinforcing, ${negative} dampening`,
      color: "text-purple-600",
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5 space-y-2">
      <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
        Active Mechanisms
      </p>
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={cn("flex-shrink-0 mt-0.5", item.color)}>
            {item.icon}
          </span>
          <div className="min-w-0 flex-1">
            <span className={cn("text-[10px] font-semibold", item.color)}>
              {item.label}
            </span>
            <p className="text-[10px] text-gray-500 leading-snug line-clamp-1">
              {item.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Non-linear dynamics panel ──

function DynamicsPanel({
  synthesisData,
  feedbackLoops,
}: {
  synthesisData: SynthesisData | null;
  feedbackLoops: RichFeedbackLoop[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (feedbackLoops.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        <RefreshCw className="h-3.5 w-3.5 text-purple-500" />
        <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider flex-1">
          System Dynamics
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-gray-400 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2.5 space-y-2.5">
          {feedbackLoops.map((loop, i) => {
            const steps = Array.isArray(loop.steps) ? loop.steps : [];
            return (
              <div
                key={i}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  loop.type === "positive"
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-red-200 bg-red-50/50"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "text-[10px] font-semibold",
                      loop.type === "positive"
                        ? "text-emerald-700"
                        : "text-red-700"
                    )}
                  >
                    {loop.type === "positive" ? "↗ Reinforcing" : "↘ Dampening"}
                  </span>
                  <span className="text-[10px] font-medium text-gray-600">
                    {loop.name}
                  </span>
                </div>

                {/* Loop chain visualization */}
                {steps.length > 0 && (
                  <div className="flex items-center flex-wrap gap-1 mt-1.5">
                    {steps.map((step, si) => (
                      <div key={si} className="flex items-center gap-1">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[9px] font-medium",
                            si === loop.intervention_at
                              ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300"
                              : "bg-white text-gray-600 border border-gray-200"
                          )}
                        >
                          {step}
                        </span>
                        {si < steps.length - 1 && (
                          <ArrowRight className="h-2.5 w-2.5 text-gray-300" />
                        )}
                      </div>
                    ))}
                    {/* Loop-back arrow */}
                    <span className="text-[9px] text-gray-400">↩</span>
                  </div>
                )}

                {/* How to intervene */}
                {loop.how_to && (
                  <p className="mt-1.5 text-[9px] text-gray-500 leading-snug">
                    <span className="font-semibold text-gray-600">Intervention: </span>
                    {loop.how_to}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Progress overlay ──

function GoalProgressOverlay({
  activeGoal,
  stages,
}: {
  activeGoal: ImprovementGoal;
  stages: WorkflowStage[];
}) {
  const range =
    Number(activeGoal.target_value) - Number(activeGoal.baseline_value);
  const progressPct =
    range > 0
      ? Math.round(
          ((Number(activeGoal.current_value) -
            Number(activeGoal.baseline_value)) /
            range) *
            100
        )
      : 0;

  const completedStages = stages.filter((s) => s.status === "completed").length;
  const activeStage = stages.find((s) => s.status === "active");

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <Target className="h-3.5 w-3.5 text-indigo-500" />
        <span className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wider">
          Goal Progress
        </span>
        <span className="ml-auto text-xs font-bold text-indigo-700">
          {progressPct}%
        </span>
      </div>

      {/* Progress bar mapped to stages */}
      <div className="relative">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-indigo-100">
          <div
            className="bg-indigo-500 rounded-full transition-all duration-500"
            style={{
              width: `${Math.max(2, (completedStages / Math.max(stages.length, 1)) * 100)}%`,
            }}
          />
        </div>
        {/* Stage markers on the progress bar */}
        <div className="flex justify-between mt-1">
          {stages.map((s) => {
            const sc = getStageStatusConfig(s.status);
            return (
              <div key={s.id} className="flex flex-col items-center">
                <div className={cn("h-1.5 w-1.5 rounded-full", sc.dot)} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[9px] text-indigo-500">
          {completedStages}/{stages.length} stages
        </span>
        {activeStage && (
          <span className="text-[9px] text-indigo-600 font-medium">
            Now: {activeStage.name}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──

export function DigitalTwinFlowchart({
  entities,
  edges,
  cycles,
  synthesisData,
  activeGoal,
  onEntityClick,
  infrastructureMap,
  proposedSpec,
  currentTwinState,
  space,
}: DigitalTwinFlowchartProps) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  const { stages, connections, meta } = useMemo(
    () =>
      buildWorkflowModel(
        entities,
        edges,
        cycles,
        synthesisData,
        activeGoal,
        infrastructureMap,
        space ?? null,
      ),
    [entities, edges, cycles, synthesisData, activeGoal, infrastructureMap, space],
  );

  // Delta totals for the header + legend (legacy fallback when no proposal
  // snapshot exists). Reads from infrastructure_map.core_components[].status,
  // which is the LATEST strategy's claim — honest about the current proposal
  // but loses the audit trail when the strategy regenerates. The new diff
  // strip below uses a frozen proposal snapshot when available.
  const deltaCounts = useMemo(() => {
    let newCount = 0;
    let strengthenCount = 0;
    let existsCount = 0;
    const seen = new Set<string>();
    const bump = (e: Entity, status: InfraStatus | null) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      if (status === "needs_building") newCount++;
      else if (status === "needs_strengthening") strengthenCount++;
      else if (status === "exists") existsCount++;
    };
    for (const s of stages) {
      bump(s.entity, s.infra_status);
      for (const v of s.variables) bump(v.entity, v.infra_status);
    }
    return { newCount, strengthenCount, existsCount };
  }, [stages]);

  // Proposed-vs-actual diff. Falls back to `no_proposal` when no snapshot is
  // available; the strip component renders nothing in that case so the
  // legacy deltaCounts pill takes over below.
  const proposalDiff = useMemo(
    () =>
      proposedSpec && currentTwinState
        ? computeTwinProposalDiff({
            proposedSpec,
            currentEntities: entities,
            currentTwinState,
          })
        : null,
    [proposedSpec, currentTwinState, entities],
  );
  const hasProposalDiff =
    proposalDiff !== null &&
    proposalDiff.fidelity !== "no_proposal" &&
    proposalDiff.chips.length > 0;

  const feedbackLoops = useMemo(
    () => synthesisData?.feedback_loops ?? [],
    [synthesisData]
  );

  const toggleStage = (stageId: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  };

  // ── Empty state ──
  if (stages.length < 2) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 mb-3">
            <GitBranch className="h-6 w-6 text-gray-400" />
          </div>
          <h3 className="text-sm font-semibold text-gray-700">
            Digital Twin — Workflow Model
          </h3>
          <p className="mt-1.5 text-xs text-gray-500 max-w-sm">
            Not enough workflow data yet. Add more context about your process,
            steps, and variables to build a sequential model of your situation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <GitBranch className="h-4 w-4 text-indigo-500" />
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider flex-1">
          Digital Twin — Your Workflow
        </h3>
        {/* Header strip:
            - When a frozen proposal snapshot is attached, render the
              proposed-vs-actual diff (honest audit of "did the materialized
              twin match what was approved?").
            - Else fall back to the legacy infrastructure_map status pill,
              which shows the LATEST strategy's claim — useful when no
              snapshot exists yet (older spaces, mid-generation states). */}
        {hasProposalDiff && proposalDiff ? (
          <TwinProposalDiffStrip diff={proposalDiff} />
        ) : (
          (deltaCounts.newCount > 0 || deltaCounts.strengthenCount > 0) && (
            <div
              className="flex items-center gap-1.5"
              title="Showing the latest strategy's claimed deltas. Approve a twin proposal to enable the proposed-vs-actual audit."
            >
              {deltaCounts.newCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                  title="Components the strategy claims to add on top of your baseline"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  {deltaCounts.newCount} new
                </span>
              )}
              {deltaCounts.strengthenCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                  title="Existing components the strategy claims to strengthen"
                >
                  <Hammer className="h-2.5 w-2.5" />
                  {deltaCounts.strengthenCount} amplified
                </span>
              )}
              {deltaCounts.existsCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500"
                  title="Baseline components already in your setup"
                >
                  {deltaCounts.existsCount} baseline
                </span>
              )}
            </div>
          )
        )}
        <span className="text-[10px] text-gray-400">
          {stages.length} stages · {stages.reduce((s, st) => s + st.variables.length, 0)} variables
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Workflow purpose + baseline anchor — gives the user an explicit
            "you are here" zero-point and names what the workflow optimizes
            for. Without this the cards read as a generic 87-stage list with
            no orienting frame. Renders only when the workflow has at least
            one of the two — purpose OR baseline — to surface. */}
        {(meta.purpose || meta.baseline_anchor) && (
          <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-white px-3 py-2.5">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-bold">
                0
              </div>
              <div className="min-w-0 flex-1">
                {meta.baseline_anchor && (
                  <>
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-indigo-600">
                      You are here · {meta.baseline_anchor.label}
                    </p>
                    <p className="text-[11px] text-gray-700 mt-0.5">
                      {meta.baseline_anchor.detail}
                    </p>
                  </>
                )}
                {meta.purpose && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    {meta.purpose}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Honesty banner — when the order isn't earned by causal
            precedence, surface that instead of letting the user assume
            "stage 1 must come first because it depends on nothing." This
            is the answer to "why does Data Privacy Management come at
            stage 1?" — it doesn't, in any meaningful sense; it just lost
            the importance tie-break. */}
        {stages.length >= 4 && meta.causal_density < 0.3 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                Order is approximate
              </p>
              <p className="text-[11px] text-amber-900 mt-0.5">
                Only {meta.causally_anchored_count} of {stages.length} stages
                have a causal predecessor. The rest are ordered by importance
                — not dependency. Add causal/temporal edges between processes
                to firm this up.
              </p>
            </div>
          </div>
        )}

        {/* Goal progress overlay */}
        {activeGoal && stages.length > 0 && (
          <GoalProgressOverlay activeGoal={activeGoal} stages={stages} />
        )}

        {/* Mechanism summary */}
        <MechanismSummary synthesisData={synthesisData} stages={stages} />

        {/* Sequential workflow stages */}
        <div className="space-y-0">
          {stages.map((stage, i) => (
            <StageCard
              key={stage.id}
              stage={stage}
              isFirst={i === 0}
              isLast={i === stages.length - 1}
              expanded={expandedStages.has(stage.id)}
              onToggle={() => toggleStage(stage.id)}
              onEntityClick={onEntityClick}
            />
          ))}
        </div>

        {/* Dynamics panel (collapsible) */}
        <DynamicsPanel
          synthesisData={synthesisData}
          feedbackLoops={feedbackLoops}
        />

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          {(
            [
              { dot: "bg-emerald-500", label: "Completed" },
              { dot: "bg-indigo-500", label: "Active" },
              { dot: "bg-red-500", label: "Blocked" },
              { dot: "bg-amber-500", label: "At Risk" },
              { dot: "bg-gray-300", label: "Pending" },
            ] as const
          ).map((item) => (
            <div key={item.label} className="flex items-center gap-1">
              <div className={cn("h-2 w-2 rounded-full", item.dot)} />
              <span className="text-[9px] text-gray-500">{item.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5 text-amber-600" />
            <span className="text-[9px] text-gray-500">Lever</span>
          </div>
          <div className="flex items-center gap-1">
            <Lock className="h-2.5 w-2.5 text-red-700" />
            <span className="text-[9px] text-gray-500">Bottleneck</span>
          </div>
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-2.5 w-2.5 text-red-600" />
            <span className="text-[9px] text-gray-500">Risk</span>
          </div>

          {/* Infra delta legend — only visible when the strategy's infrastructure plan drove the weighting */}
          {(deltaCounts.newCount > 0 || deltaCounts.strengthenCount > 0) && (
            <div className="ml-auto flex items-center gap-2 border-l border-gray-200 pl-3">
              <span className="text-[9px] text-gray-400 uppercase tracking-wider">
                Delta
              </span>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded ring-2 ring-teal-400" />
                <span className="text-[9px] text-gray-500">New</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded ring-1 ring-amber-400" />
                <span className="text-[9px] text-gray-500">Amplify</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded border border-gray-200" />
                <span className="text-[9px] text-gray-500">Baseline</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
