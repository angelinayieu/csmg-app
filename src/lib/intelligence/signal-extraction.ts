/**
 * Signal Extraction Engine
 *
 * Identifies trajectory-influencing signals through structural analysis
 * of the knowledge graph — finding what's NOT there, not just what changed.
 *
 * Three detection modes:
 * 1. Structural Hole Detection — pairs of entities that SHOULD be connected
 * 2. Mediating Variable Inference — A→?→B gaps where the mechanism is unclear
 * 3. Cascade Vulnerability Scanning — single points of failure, flip-prone loops
 *
 * Outputs "signal hypotheses" — things that would change the trajectory if true.
 * These feed into:
 * - Research triggers (what to search for next)
 * - Intelligence radar (proactive signals, not just reactive diffs)
 * - Synthesis prompts (hidden variables to reason about)
 */

import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { EpistemicClassification } from "@/types/epistemic";
import { isAnalyzableLayer, isUserLayer, isConceptualLayer } from "@/lib/intelligence/layer-semantics";

// ── Types ──

export type SignalHypothesisType =
  | "hidden_variable"       // Inferred mediating variable not in the graph
  | "structural_hole"       // Missing connection between entities that share context
  | "cascade_vulnerability" // Single entity whose failure cascades catastrophically
  | "flip_prone_loop"       // Reinforcing loop close to switching polarity
  | "assumption_at_risk"    // Key assumption with low/no external validation
  | "temporal_window"       // Time-sensitive opportunity or risk closing
  | "analogous_pattern"     // Known pattern from other domains matches this structure
  | "measurement_gap";      // Entity treated as measurable but likely isn't

export interface SignalHypothesis {
  id: string;
  type: SignalHypothesisType;
  title: string;
  description: string;
  /** Why this matters for the trajectory */
  impact_reasoning: string;
  /** Entities involved */
  entity_ids: string[];
  /** How confident we are this signal exists (0-1) */
  confidence: number;
  /** How much this could change the trajectory (0-1) */
  trajectory_impact: number;
  /** What research or action would validate/invalidate this signal */
  validation_action: string;
  /** Suggested research query if this needs external validation */
  research_query?: string;
  /** Knowledge layer this signal originates from (when tagLayers is enabled) */
  source_layer?: string;
}

export interface SignalExtractionResult {
  hypotheses: SignalHypothesis[];
  structural_holes: StructuralHole[];
  hidden_variables: HiddenVariable[];
  cascade_vulnerabilities: CascadeVulnerability[];
  flip_prone_loops: FlipProneLoop[];
  extraction_metadata: {
    entities_analyzed: number;
    edges_analyzed: number;
    cycles_analyzed: number;
    computed_at: string;
    layer_breakdown?: {
      internal_entities: number;
      conceptual_entities: number;
      bridge_edges: number;
    };
  };
}

export interface StructuralHole {
  entity_a_id: string;
  entity_a_name: string;
  entity_b_id: string;
  entity_b_name: string;
  /** How many shared neighbors they have (higher = more likely connected) */
  shared_neighbors: number;
  /** Why we think they should be connected */
  reasoning: string;
  /** Knowledge layer this signal originates from (when tagLayers is enabled) */
  source_layer?: string;
}

export interface HiddenVariable {
  between_entity_ids: [string, string];
  between_entity_names: [string, string];
  /** What the hidden variable likely is */
  inferred_name: string;
  /** How it mediates the relationship */
  mediation_mechanism: string;
  /** Edge that this variable would explain better */
  explaining_edge_id?: string;
  /** Knowledge layer this signal originates from (when tagLayers is enabled) */
  source_layer?: string;
}

export interface CascadeVulnerability {
  entity_id: string;
  entity_name: string;
  /** How many downstream entities are affected if this fails */
  downstream_count: number;
  /** IDs of critical downstream entities */
  critical_downstream: string[];
  /** Whether there's redundancy (alternative paths exist) */
  has_redundancy: boolean;
  severity: "critical" | "high" | "moderate";
  /** Knowledge layer this signal originates from (when tagLayers is enabled) */
  source_layer?: string;
}

export interface FlipProneLoop {
  cycle_id: string;
  cycle_entity_ids: string[];
  /** Current classification */
  current_type: "reinforcing_positive" | "reinforcing_negative" | "balancing";
  /** What could cause it to flip */
  flip_trigger: string;
  /** Which edge is weakest (most likely to break) */
  weakest_edge_entity_ids: [string, string];
  weakest_edge_confidence: number;
  /** Knowledge layer this signal originates from (when tagLayers is enabled) */
  source_layer?: string;
}

// ── Helpers ──

function generateHypothesisId(type: string, entityIds: string[]): string {
  return `hyp_${type}_${entityIds.sort().join("_")}`.slice(0, 64);
}

/**
 * Build adjacency list from edges, keyed by display entity_id (e.g. "C1").
 * Edges store UUIDs in source_entity_id/target_entity_id, so we convert
 * using the provided uuid→display mapping.
 */
function buildAdjacency(
  edges: Edge[],
  uuidToDisplay: Map<string, string>
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    const src = uuidToDisplay.get(e.source_entity_id) ?? e.source_entity_id;
    const tgt = uuidToDisplay.get(e.target_entity_id) ?? e.target_entity_id;
    if (!adj.has(src)) adj.set(src, new Set());
    if (!adj.has(tgt)) adj.set(tgt, new Set());
    adj.get(src)!.add(tgt);
    adj.get(tgt)!.add(src);
  }
  return adj;
}

/**
 * Count shared neighbors between two entities.
 */
function countSharedNeighbors(
  a: string,
  b: string,
  adj: Map<string, Set<string>>
): number {
  const neighborsA = adj.get(a) ?? new Set();
  const neighborsB = adj.get(b) ?? new Set();
  let count = 0;
  for (const n of neighborsA) {
    if (neighborsB.has(n)) count++;
  }
  return count;
}

/**
 * BFS to count downstream reachable entities from a source (using display IDs).
 */
function countDownstream(
  sourceId: string,
  edges: Edge[],
  uuidToDisplay: Map<string, string>,
  maxDepth: number = 4
): { count: number; critical: string[]; entityIds: string[] } {
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    const src = uuidToDisplay.get(e.source_entity_id) ?? e.source_entity_id;
    const tgt = uuidToDisplay.get(e.target_entity_id) ?? e.target_entity_id;
    if (!outgoing.has(src)) outgoing.set(src, []);
    outgoing.get(src)!.push(tgt);
  }

  const visited = new Set<string>([sourceId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: sourceId, depth: 0 }];
  const critical: string[] = [];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    for (const tgt of outgoing.get(id) ?? []) {
      if (!visited.has(tgt)) {
        visited.add(tgt);
        queue.push({ id: tgt, depth: depth + 1 });
      }
    }
  }

  visited.delete(sourceId); // Don't count source
  return {
    count: visited.size,
    critical,
    entityIds: [...visited],
  };
}

// ── Main Extraction ──

/**
 * Extract trajectory-influencing signals from the knowledge graph.
 * Pure function — no DB calls, no LLM calls.
 */
export function extractSignals(
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  synthesisData: SynthesisData | null,
  options?: {
    /** Custom layer filter. Default: isAnalyzableLayer (excludes external) */
    layerFilter?: (layer: string | null) => boolean;
    /** Tag results with layer provenance */
    tagLayers?: boolean;
    /** Phase 8: Epistemic classification for framework-enhanced signal detection */
    epistemicClassification?: EpistemicClassification | null;
  }
): SignalExtractionResult {
  const entityMap = new Map<string, Entity>();
  for (const e of entities) entityMap.set(e.entity_id, e);

  // Build UUID ↔ display ID mappings so adjacency/BFS use display IDs
  const uuidToDisplay = new Map<string, string>();
  for (const e of entities) uuidToDisplay.set(e.id, e.entity_id);

  const layerCheck = options?.layerFilter ?? isAnalyzableLayer;
  const internalEntities = entities.filter((e) => layerCheck(e.knowledge_layer));
  const internalEdges = edges.filter((e) => layerCheck(e.knowledge_layer));

  const adj = buildAdjacency(internalEdges, uuidToDisplay);
  const hypotheses: SignalHypothesis[] = [];

  // ── 1. Structural Hole Detection ──
  // Find pairs of internal entities that share ≥2 neighbors but have no direct edge.
  // These are likely connected through a mechanism the analysis hasn't identified.

  const structuralHoles: StructuralHole[] = [];
  const directlyConnected = new Set<string>();
  for (const edge of internalEdges) {
    const src = uuidToDisplay.get(edge.source_entity_id) ?? edge.source_entity_id;
    const tgt = uuidToDisplay.get(edge.target_entity_id) ?? edge.target_entity_id;
    const key = [src, tgt].sort().join("|");
    directlyConnected.add(key);
  }

  // Only check important entities to avoid combinatorial explosion
  const importantEntities = internalEntities.filter(
    (e) =>
      e.is_leverage_point ||
      e.is_risk_point ||
      e.is_master_bottleneck ||
      e.importance === "fundamental" ||
      e.importance === "critical"
  );

  for (let i = 0; i < importantEntities.length; i++) {
    for (let j = i + 1; j < importantEntities.length; j++) {
      const a = importantEntities[i];
      const b = importantEntities[j];
      const key = [a.entity_id, b.entity_id].sort().join("|");

      if (directlyConnected.has(key)) continue; // Already connected

      const shared = countSharedNeighbors(a.entity_id, b.entity_id, adj);
      if (shared >= 2) {
        structuralHoles.push({
          entity_a_id: a.entity_id,
          entity_a_name: a.name,
          entity_b_id: b.entity_id,
          entity_b_name: b.name,
          shared_neighbors: shared,
          reasoning: `"${a.name}" and "${b.name}" share ${shared} common connections but aren't directly linked — likely connected through a mechanism the analysis hasn't captured`,
          ...(options?.tagLayers ? { source_layer: a.knowledge_layer ?? "internal" } : {}),
        });

        hypotheses.push({
          id: generateHypothesisId("structural_hole", [a.entity_id, b.entity_id]),
          type: "structural_hole",
          title: `Missing connection: ${a.name} ↔ ${b.name}`,
          description: `These two important entities share ${shared} neighbors but aren't directly connected. In most knowledge structures, this implies a hidden relationship.`,
          impact_reasoning: `If ${a.name} actually influences ${b.name} (or vice versa), the current analysis underestimates the blast radius of changes to either one.`,
          entity_ids: [a.entity_id, b.entity_id],
          confidence: Math.min(0.4 + shared * 0.15, 0.9),
          trajectory_impact: (a.is_leverage_point || b.is_leverage_point) ? 0.8 : 0.5,
          validation_action: `Investigate whether "${a.name}" and "${b.name}" have a direct causal or functional relationship`,
          research_query: `relationship between ${a.name} and ${b.name} in ${a.entity_type ?? "this domain"}`,
          ...(options?.tagLayers ? { source_layer: a.knowledge_layer ?? "internal" } : {}),
        });
      }
    }
  }

  // ── 2. Mediating Variable Inference ──
  // Find edges between important entities that have low confidence or are marked
  // as "inferred" — these likely have a hidden mediating variable.
  // Also find causal edges without named mechanisms.

  const hiddenVariables: HiddenVariable[] = [];

  for (const edge of internalEdges) {
    const srcDisplay = uuidToDisplay.get(edge.source_entity_id) ?? edge.source_entity_id;
    const tgtDisplay = uuidToDisplay.get(edge.target_entity_id) ?? edge.target_entity_id;
    const source = entityMap.get(srcDisplay);
    const target = entityMap.get(tgtDisplay);
    if (!source || !target) continue;

    // Only check edges between important entities or low-confidence causal edges
    const isImportantEdge =
      (source.is_leverage_point || source.is_risk_point || source.is_master_bottleneck) &&
      (target.is_leverage_point || target.is_risk_point || target.is_master_bottleneck);

    const isWeakCausal =
      edge.dimension === "causal" && edge.confidence < 0.6;

    const isLongRange =
      edge.dimension === "causal" &&
      !adj.get(srcDisplay)?.has(tgtDisplay);

    if (isImportantEdge || isWeakCausal) {
      // Check for "mechanism gap" — causal/functional edge without obvious intermediary
      const sharedNeighbors = countSharedNeighbors(
        srcDisplay,
        tgtDisplay,
        adj
      );

      // If two entities are causally connected but share few neighbors,
      // there's likely an unmodeled intermediary
      if (sharedNeighbors <= 1 && (edge.dimension === "causal" || edge.dimension === "functional")) {
        const inferredName = `[Hidden: ${source.name} → ? → ${target.name}]`;
        hiddenVariables.push({
          between_entity_ids: [source.entity_id, target.entity_id],
          between_entity_names: [source.name, target.name],
          inferred_name: inferredName,
          mediation_mechanism: `The ${edge.dimension} link from "${source.name}" to "${target.name}" likely operates through an unmodeled intermediary — the mechanism is ${edge.confidence < 0.6 ? "low confidence" : "structurally sparse"}`,
          explaining_edge_id: edge.id,
          ...(options?.tagLayers ? { source_layer: source.knowledge_layer ?? "internal" } : {}),
        });

        hypotheses.push({
          id: generateHypothesisId("hidden_variable", [source.entity_id, target.entity_id]),
          type: "hidden_variable",
          title: `Hidden mediator between ${source.name} and ${target.name}`,
          description: `The ${edge.dimension} relationship between these entities has ${sharedNeighbors <= 0 ? "no" : "only 1"} shared neighbor, suggesting an unmodeled variable mediates this connection.`,
          impact_reasoning: `If the hidden variable is identified, it becomes a new intervention point. If it's uncontrollable, it means the apparent connection between "${source.name}" and "${target.name}" may be unreliable.`,
          entity_ids: [source.entity_id, target.entity_id],
          confidence: 0.5 + (isWeakCausal ? 0.2 : 0) + (isImportantEdge ? 0.1 : 0),
          trajectory_impact: isImportantEdge ? 0.7 : 0.4,
          validation_action: `Identify what mechanism connects "${source.name}" to "${target.name}" — is there an intermediate step or variable?`,
          research_query: `mechanism linking ${source.name} to ${target.name} mediating variables`,
          ...(options?.tagLayers ? { source_layer: source.knowledge_layer ?? "internal" } : {}),
        });
      }
    }
  }

  // ── 3. Cascade Vulnerability Scanning ──
  // Find entities whose failure would cascade to many downstream entities,
  // especially when there's no redundancy (alternative paths).

  const cascadeVulnerabilities: CascadeVulnerability[] = [];

  for (const entity of internalEntities) {
    // Only scan entities with enough outgoing edges to matter
    const outDegree = internalEdges.filter(
      (e) => (uuidToDisplay.get(e.source_entity_id) ?? e.source_entity_id) === entity.entity_id
    ).length;
    if (outDegree < 2) continue;

    const downstream = countDownstream(entity.entity_id, internalEdges, uuidToDisplay);

    if (downstream.count >= 3) {
      // Check redundancy: for each direct target, is there an alternative path
      // from *other* entities? (simplified: check if targets have >1 incoming edge)
      const directTargets = internalEdges
        .filter((e) => (uuidToDisplay.get(e.source_entity_id) ?? e.source_entity_id) === entity.entity_id)
        .map((e) => uuidToDisplay.get(e.target_entity_id) ?? e.target_entity_id);

      const hasRedundancy = directTargets.every((targetId) => {
        const incomingCount = internalEdges.filter(
          (e) =>
            (uuidToDisplay.get(e.target_entity_id) ?? e.target_entity_id) === targetId &&
            (uuidToDisplay.get(e.source_entity_id) ?? e.source_entity_id) !== entity.entity_id
        ).length;
        return incomingCount >= 1;
      });

      // Find critical downstream (leverage points, bottleneck, risk points in cascade)
      const criticalDownstream = downstream.entityIds.filter((eid) => {
        const e = entityMap.get(eid);
        return e && (e.is_leverage_point || e.is_risk_point || e.is_master_bottleneck);
      });

      const severity: CascadeVulnerability["severity"] =
        criticalDownstream.length >= 2 && !hasRedundancy
          ? "critical"
          : criticalDownstream.length >= 1 || downstream.count >= 5
          ? "high"
          : "moderate";

      cascadeVulnerabilities.push({
        entity_id: entity.entity_id,
        entity_name: entity.name,
        downstream_count: downstream.count,
        critical_downstream: criticalDownstream,
        has_redundancy: hasRedundancy,
        severity,
        ...(options?.tagLayers ? { source_layer: entity.knowledge_layer ?? "internal" } : {}),
      });

      if (severity === "critical" || (severity === "high" && !hasRedundancy)) {
        hypotheses.push({
          id: generateHypothesisId("cascade_vulnerability", [entity.entity_id]),
          type: "cascade_vulnerability",
          title: `Single point of failure: ${entity.name}`,
          description: `If "${entity.name}" fails, ${downstream.count} downstream entities are affected${!hasRedundancy ? " with NO redundancy paths" : ""}. ${criticalDownstream.length} of these are leverage/risk points.`,
          impact_reasoning: `This is a structural vulnerability — the system's trajectory depends on this entity holding. No alternative paths exist to route around its failure.`,
          entity_ids: [entity.entity_id, ...criticalDownstream],
          confidence: 0.85,
          trajectory_impact: severity === "critical" ? 0.9 : 0.7,
          validation_action: `Verify whether "${entity.name}" has backup mechanisms or alternative paths. If not, it needs a contingency plan.`,
          ...(options?.tagLayers ? { source_layer: entity.knowledge_layer ?? "internal" } : {}),
        });
      }
    }
  }

  // ── 4. Flip-Prone Loop Detection ──
  // Find reinforcing cycles where at least one edge has low confidence
  // or negative polarity mixed in — these could flip from virtuous to vicious.

  const flipProneLoops: FlipProneLoop[] = [];

  for (const cycle of cycles) {
    if (!cycle.classification || cycle.classification === "balancing") continue;

    // Parse entity IDs from cycle
    const cycleEntityIds: string[] = Array.isArray(cycle.entity_ids)
      ? cycle.entity_ids
      : [];
    if (cycleEntityIds.length < 2) continue;

    // Find edges in this cycle
    const cycleEdges: Edge[] = [];
    for (let i = 0; i < cycleEntityIds.length; i++) {
      const from = cycleEntityIds[i];
      const to = cycleEntityIds[(i + 1) % cycleEntityIds.length];
      const edge = internalEdges.find(
        (e) =>
          (e.source_entity_id === from && e.target_entity_id === to) ||
          (e.source_entity_id === to && e.target_entity_id === from)
      );
      if (edge) cycleEdges.push(edge);
    }

    if (cycleEdges.length === 0) continue;

    // Find weakest edge
    const weakest = cycleEdges.reduce((min, e) =>
      (e.confidence ?? 1) < (min.confidence ?? 1) ? e : min
    );

    // Check for flip risk: low confidence edge, mixed polarity, or conditional edges
    const hasLowConfEdge = cycleEdges.some((e) => (e.confidence ?? 1) < 0.5);
    const hasMixedPolarity = cycleEdges.some((e) => e.polarity === "negative" || e.polarity === "conditional");
    const hasConditionalEdge = cycleEdges.some((e) => e.conditions != null);

    if (hasLowConfEdge || hasMixedPolarity || hasConditionalEdge) {
      const flipTrigger = hasLowConfEdge
        ? `Edge confidence as low as ${((weakest.confidence ?? 0) * 100).toFixed(0)}% — if this relationship breaks, the loop reverses`
        : hasMixedPolarity
        ? `Mixed polarity edges in the loop — a small shift could flip positive→negative`
        : `Conditional edges present — if conditions change, loop behavior changes`;

      const flipPrimaryEntity = cycleEntityIds[0] ? entityMap.get(cycleEntityIds[0]) : undefined;
      flipProneLoops.push({
        cycle_id: cycle.id,
        cycle_entity_ids: cycleEntityIds,
        current_type: cycle.classification,
        flip_trigger: flipTrigger,
        weakest_edge_entity_ids: [weakest.source_entity_id, weakest.target_entity_id],
        weakest_edge_confidence: weakest.confidence ?? 0.5,
        ...(options?.tagLayers ? { source_layer: flipPrimaryEntity?.knowledge_layer ?? "internal" } : {}),
      });

      hypotheses.push({
        id: generateHypothesisId("flip_prone_loop", cycleEntityIds),
        type: "flip_prone_loop",
        title: `Unstable ${cycle.classification} loop: ${cycle.name ?? cycleEntityIds.slice(0, 3).join("→")}`,
        description: flipTrigger,
        impact_reasoning: `A ${cycle.classification} loop flipping to ${cycle.classification === "reinforcing_positive" ? "reinforcing_negative" : "reinforcing_positive"} would reverse the trajectory — what was accelerating growth becomes accelerating decline.`,
        entity_ids: cycleEntityIds,
        confidence: hasLowConfEdge ? 0.7 : 0.5,
        trajectory_impact: 0.8,
        validation_action: `Strengthen the weakest edge or identify conditions under which this loop reverses`,
        research_query: cycleEntityIds.length > 0
          ? `feedback loop stability ${entityMap.get(cycleEntityIds[0])?.name ?? ""} reinforcing cycle reversal conditions`
          : undefined,
        ...(options?.tagLayers ? { source_layer: flipPrimaryEntity?.knowledge_layer ?? "internal" } : {}),
      });
    }
  }

  // ── 5. Assumption-at-Risk Detection ──
  // Find entities marked [ASSUMED] or with source_tag="assumed" that are
  // in the critical path (leverage/risk/bottleneck connections).

  for (const entity of internalEntities) {
    if (entity.source_tag !== "assumed") continue;

    // Check if this assumed entity is connected to anything important
    const connectedToImportant = internalEdges.some((e) => {
      const srcDisplay = uuidToDisplay.get(e.source_entity_id) ?? e.source_entity_id;
      const tgtDisplay = uuidToDisplay.get(e.target_entity_id) ?? e.target_entity_id;
      const otherId =
        srcDisplay === entity.entity_id
          ? tgtDisplay
          : tgtDisplay === entity.entity_id
          ? srcDisplay
          : null;
      if (!otherId) return false;
      const other = entityMap.get(otherId);
      return other && (other.is_leverage_point || other.is_risk_point || other.is_master_bottleneck);
    });

    if (connectedToImportant) {
      hypotheses.push({
        id: generateHypothesisId("assumption_at_risk", [entity.entity_id]),
        type: "assumption_at_risk",
        title: `Unvalidated assumption: ${entity.name}`,
        description: `"${entity.name}" is an ASSUMED entity (not explicitly stated or strongly inferred) that directly connects to leverage points, risks, or the bottleneck. If this assumption is wrong, critical findings collapse.`,
        impact_reasoning: `The strategic analysis depends on this being true, but it hasn't been externally validated.`,
        entity_ids: [entity.entity_id],
        confidence: 0.6,
        trajectory_impact: 0.7,
        validation_action: `Find external evidence that "${entity.name}" is true in this context`,
        research_query: `evidence for ${entity.name} validity ${entity.entity_type ?? ""}`,
        ...(options?.tagLayers ? { source_layer: entity.knowledge_layer ?? "internal" } : {}),
      });
    }
  }

  // ── 6. Temporal Window Detection ──
  // Find entities with temporal_validity that are expiring soon or have high decay_rate.

  for (const entity of internalEntities) {
    if (!entity.temporal_validity) continue;

    const tv = entity.temporal_validity as Record<string, unknown>;
    const DECAY_RATE_VALUES: Record<string, number> = {
      none: 0, slow: 0.2, moderate: 0.5, fast: 0.8, immediate: 1.0,
    };
    const decayRate = typeof tv.decay_rate === "string"
      ? (DECAY_RATE_VALUES[tv.decay_rate] ?? 0)
      : typeof tv.decay_rate === "number" ? tv.decay_rate : 0;
    const temporalScope = tv.temporal_scope as string | undefined;

    // High decay rate + connected to leverage = temporal window closing
    if (decayRate > 0.5 && (entity.is_leverage_point || entity.is_risk_point)) {
      hypotheses.push({
        id: generateHypothesisId("temporal_window", [entity.entity_id]),
        type: "temporal_window",
        title: `Time-sensitive: ${entity.name}`,
        description: `"${entity.name}" has a high decay rate (${(decayRate * 100).toFixed(0)}%) ${temporalScope ? `with scope "${temporalScope}"` : ""}. As a ${entity.is_leverage_point ? "leverage point" : "risk point"}, its window of relevance is closing.`,
        impact_reasoning: `Actions depending on this entity need to happen soon or the opportunity/risk window passes.`,
        entity_ids: [entity.entity_id],
        confidence: 0.75,
        trajectory_impact: 0.6,
        validation_action: `Verify current status of "${entity.name}" — is the window still open?`,
        research_query: `current status ${entity.name} ${temporalScope ?? ""} timeline`,
        ...(options?.tagLayers ? { source_layer: entity.knowledge_layer ?? "internal" } : {}),
      });
    }
  }

  // ── 7. Measurement Gap Detection ──
  // Find abstract/epistemic entities with high confidence that are treated as
  // actionable but likely can't be directly measured or acted upon.

  for (const entity of internalEntities) {
    if (
      (entity.entity_category === "abstract" || entity.entity_category === "epistemic") &&
      entity.confidence >= 0.7 &&
      (entity.is_leverage_point || entity.is_master_bottleneck)
    ) {
      // Abstract leverage points that can't be directly measured
      hypotheses.push({
        id: generateHypothesisId("measurement_gap", [entity.entity_id]),
        type: "measurement_gap",
        title: `Unmeasurable leverage: ${entity.name}`,
        description: `"${entity.name}" is an abstract/epistemic concept flagged as a ${entity.is_leverage_point ? "leverage point" : "bottleneck"} with ${(entity.confidence * 100).toFixed(0)}% confidence — but abstract concepts can't be directly measured or acted upon without a concrete proxy.`,
        impact_reasoning: `Without a measurable proxy, actions targeting this entity can't be validated. The strategy may be optimizing something it can't track.`,
        entity_ids: [entity.entity_id],
        confidence: 0.55,
        trajectory_impact: 0.5,
        validation_action: `Identify a concrete, measurable proxy for "${entity.name}" that would indicate whether interventions are working`,
        ...(options?.tagLayers ? { source_layer: entity.knowledge_layer ?? "internal" } : {}),
      });
    }
  }

  // ── 8. Toulmin-Aware: Claims Without Warrants (Phase 8) ──
  // When Toulmin framework is active, find claim entities that lack warrant connections.
  // These are assertions the analysis builds on that have no stated reasoning link.
  const classification = options?.epistemicClassification;
  if (classification?.toulmin.has_argument) {
    for (const entity of internalEntities) {
      const manifold = entity.manifold as Record<string, unknown> | null;
      const toulminRole = manifold?.toulmin_role as string | undefined;
      if (toulminRole !== "claim") continue;

      // Check if any edge connects a warrant/ground to this claim
      const hasWarrant = internalEdges.some((e) => {
        const srcDisplay = uuidToDisplay.get(e.source_entity_id) ?? e.source_entity_id;
        const tgtDisplay = uuidToDisplay.get(e.target_entity_id) ?? e.target_entity_id;
        if (tgtDisplay !== entity.entity_id && srcDisplay !== entity.entity_id) return false;
        const otherId = srcDisplay === entity.entity_id ? tgtDisplay : srcDisplay;
        const other = entityMap.get(otherId);
        if (!other) return false;
        const otherManifold = other.manifold as Record<string, unknown> | null;
        const otherRole = otherManifold?.toulmin_role as string | undefined;
        return otherRole === "warrant" || otherRole === "ground" || otherRole === "backing";
      });

      if (!hasWarrant) {
        hypotheses.push({
          id: generateHypothesisId("assumption_at_risk", [entity.entity_id, "toulmin"]),
          type: "assumption_at_risk",
          title: `Unwarranted claim: ${entity.name}`,
          description: `"${entity.name}" is classified as a CLAIM (Toulmin) but has no connected warrant, ground, or backing entity. The reasoning chain supporting this assertion is missing.`,
          impact_reasoning: `Claims without warrants are the weakest links in an argument. If this claim is load-bearing for the analysis, the entire structure above it is unsupported.`,
          entity_ids: [entity.entity_id],
          confidence: 0.7,
          trajectory_impact: entity.is_leverage_point || entity.is_risk_point ? 0.8 : 0.5,
          validation_action: `Identify the reasoning or evidence that supports the claim "${entity.name}"`,
          research_query: `evidence supporting ${entity.name}`,
          ...(options?.tagLayers ? { source_layer: entity.knowledge_layer ?? "internal" } : {}),
        });
      }
    }
  }

  // ── 9. Pearl-Aware: Causal Edges Without Mechanism (Phase 8) ──
  // When Pearl causal framework is active, find causal edges that lack mechanism specification.
  // Edges tagged as intervention/counterfactual without a named mechanism are suspect.
  if (classification && classification.causal_depth !== "association") {
    for (const edge of internalEdges) {
      if (edge.dimension !== "causal") continue;
      const util = edge.utility as Record<string, unknown> | null;
      const pearlLevel = util?.pearl_level as string | undefined;
      if (!pearlLevel || pearlLevel === "association") continue;

      // Check if the edge has mechanism detail (in dynamics or utility)
      const edgeDynamics = edge.dynamics ?? "";
      const edgeRelType = edge.relationship_type ?? "";
      const mechanismText = `${edgeDynamics} ${edgeRelType}`;
      const hasNoMechanism =
        mechanismText.trim().length < 20 ||
        !/mechanism|through|via|by means|because|causes/i.test(mechanismText);

      if (hasNoMechanism) {
        const srcDisplay = uuidToDisplay.get(edge.source_entity_id) ?? edge.source_entity_id;
        const tgtDisplay = uuidToDisplay.get(edge.target_entity_id) ?? edge.target_entity_id;
        const source = entityMap.get(srcDisplay);
        const target = entityMap.get(tgtDisplay);
        if (!source || !target) continue;

        hypotheses.push({
          id: generateHypothesisId("hidden_variable", [source.entity_id, target.entity_id, "pearl"]),
          type: "hidden_variable",
          title: `Mechanism gap: ${source.name} → ${target.name} (${pearlLevel})`,
          description: `This edge is tagged as "${pearlLevel}" on Pearl's causal ladder but lacks an explicit mechanism. ${pearlLevel === "counterfactual" ? "Counterfactual claims require the strongest mechanistic justification." : "Intervention claims need a named mechanism to be actionable."}`,
          impact_reasoning: `Without a mechanism, this ${pearlLevel}-level causal claim cannot be reliably acted upon. The intervention may not produce the expected effect.`,
          entity_ids: [source.entity_id, target.entity_id],
          confidence: 0.65,
          trajectory_impact: pearlLevel === "counterfactual" ? 0.8 : 0.6,
          validation_action: `Identify the causal mechanism connecting "${source.name}" to "${target.name}"`,
          research_query: `causal mechanism ${source.name} ${target.name}`,
          ...(options?.tagLayers ? { source_layer: source.knowledge_layer ?? "internal" } : {}),
        });
      }
    }
  }

  // ── 10. Epistemic Landscape: Speculation-Heavy Graph (Phase 8) ──
  // When the epistemic landscape is mostly_speculated, boost assumption_at_risk sensitivity
  const speculatedPct = classification?.evidence_distribution?.speculated ?? 0;
  if (classification?.epistemic_landscape === "mostly_theorized" || speculatedPct > 0.3) {
    // Lower the bar for assumption_at_risk — scan ALL assumed entities, not just those connected to important ones
    for (const entity of internalEntities) {
      if (entity.source_tag !== "assumed") continue;
      const alreadyFlagged = hypotheses.some(
        (h) => h.type === "assumption_at_risk" && h.entity_ids.includes(entity.entity_id),
      );
      if (alreadyFlagged) continue;

      // In speculation-heavy graphs, every assumed entity is a risk
      hypotheses.push({
        id: generateHypothesisId("assumption_at_risk", [entity.entity_id, "speculative_landscape"]),
        type: "assumption_at_risk",
        title: `Assumption in speculative landscape: ${entity.name}`,
        description: `"${entity.name}" is an ASSUMED entity in a graph where ${speculatedPct > 0.3 ? `${Math.round(speculatedPct * 100)}% of claims are speculative` : "the epistemic landscape is mostly theorized"}. Higher validation priority.`,
        impact_reasoning: `In a speculation-heavy analysis, each unvalidated assumption compounds risk. Validating or refuting this early reduces cascading uncertainty.`,
        entity_ids: [entity.entity_id],
        confidence: 0.5,
        trajectory_impact: 0.5,
        validation_action: `Find concrete evidence for or against "${entity.name}"`,
        research_query: `evidence ${entity.name} ${entity.entity_type ?? ""}`,
        ...(options?.tagLayers ? { source_layer: entity.knowledge_layer ?? "internal" } : {}),
      });
    }
  }

  // Sort hypotheses by trajectory_impact × confidence (expected impact)
  hypotheses.sort(
    (a, b) => b.trajectory_impact * b.confidence - a.trajectory_impact * a.confidence
  );

  return {
    hypotheses,
    structural_holes: structuralHoles,
    hidden_variables: hiddenVariables,
    cascade_vulnerabilities: cascadeVulnerabilities,
    flip_prone_loops: flipProneLoops,
    extraction_metadata: {
      entities_analyzed: internalEntities.length,
      edges_analyzed: internalEdges.length,
      cycles_analyzed: cycles.length,
      computed_at: new Date().toISOString(),
      layer_breakdown: options?.tagLayers ? {
        internal_entities: entities.filter(e => isUserLayer(e.knowledge_layer)).length,
        conceptual_entities: entities.filter(e => isConceptualLayer(e.knowledge_layer)).length,
        bridge_edges: edges.filter(e => e.knowledge_layer === "bridge").length,
      } : undefined,
    },
  };
}
