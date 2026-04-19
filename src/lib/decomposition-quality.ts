// ── Decomposition Quality Scoring ──
// Pure, deterministic quality scoring for decomposition output.
// No external dependencies. No project imports.

type Depth = "quick" | "standard" | "deep";

export interface DecompositionQualityReport {
  overall: number;
  metrics: {
    entityCount: { score: number; actual: number; target: number };
    edgeDensity: { score: number; actual: number; target: number };
    implicitRatio: { score: number; actual: number; target: number };
    manifoldCompleteness: { score: number; complete: number; required: number };
    orphanCount: { score: number; actual: number; target: number };
    edgePerEntity: {
      score: number;
      minEdges: number;
      meanEdges: number;
      belowThreshold: number;
    };
    descriptionDepth: { score: number; adequate: number; total: number };
    importanceDistribution: {
      score: number;
      fundamental: number;
      critical: number;
    };
    // ── Edge semantic richness (novel: measures Tier 3 preservation) ──
    topologyCoverage: { score: number; populated: number; total: number };
    dynamicsCoverage: { score: number; populated: number; total: number };
    relationshipDiversity: { score: number; uniqueTypes: number; total: number; dominantType: string | null; dominantRatio: number };
    confidenceCalibration: { score: number; lowConfidence: number; total: number };
  };
  deficiencies: string[];
  retryRecommended: boolean;
  retryGuidance: string;
}

// ── Depth-specific targets ──

interface DepthTargets {
  entityTarget: number;
  edgeDensityTarget: number;
  minEdgesPerEntity: number;
  descriptionMinChars: number;
  fundamentalTarget: number;
  criticalTarget: number;
  retryThreshold: number;
}

const TARGETS: Record<Depth, DepthTargets> = {
  quick: {
    entityTarget: 15,
    edgeDensityTarget: 2.5,   // Raised from 2.0: even quick tier needs connected graph
    minEdgesPerEntity: 2,
    descriptionMinChars: 50,
    fundamentalTarget: 1,
    criticalTarget: 2,
    retryThreshold: 0.55,     // Raised from 0.5: don't accept poor quality
  },
  standard: {
    entityTarget: 25,
    edgeDensityTarget: 3.0,   // Raised from 2.5: prompt targets 1.5× which is 37.5 edges for 25 entities
    minEdgesPerEntity: 3,
    descriptionMinChars: 150,
    fundamentalTarget: 2,
    criticalTarget: 3,
    retryThreshold: 0.62,     // Raised from 0.6: slightly tighter
  },
  deep: {
    entityTarget: 25,
    edgeDensityTarget: 3.5,   // Raised from 2.5: deep analysis should be richly connected
    minEdgesPerEntity: 4,
    descriptionMinChars: 300,
    fundamentalTarget: 2,
    criticalTarget: 3,
    retryThreshold: 0.65,     // Unchanged
  },
};

const WEIGHTS = {
  // ── Connectivity / structural metrics (0.78 total) ──
  entityCount: 0.08,              // reduced from 0.12
  edgeDensity: 0.18,              // reduced from 0.22
  implicitRatio: 0.10,            // reduced from 0.12
  manifoldCompleteness: 0.10,
  orphanCount: 0.12,
  edgePerEntity: 0.10,            // reduced from 0.12
  descriptionDepth: 0.10,
  importanceDistribution: 0.10,
  // ── Edge semantic richness metrics (0.12 total) ──
  // These measure whether Tier 3 annotations (topology, dynamics, relationship types,
  // confidence) actually survived the structuring pass. Previously un-measured —
  // graphs could score high on connectivity while being semantically undifferentiated.
  topologyCoverage: 0.04,
  dynamicsCoverage: 0.04,
  relationshipDiversity: 0.02,
  confidenceCalibration: 0.02,
} as const;

// ── Helpers ──

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

interface ManifoldShape {
  strategic?: Record<string, unknown> | null;
  operational?: Record<string, unknown> | null;
  epistemic?: Record<string, unknown> | null;
}

function isManifoldComplete(manifold: unknown): boolean {
  if (!manifold || typeof manifold !== "object") return false;
  const m = manifold as ManifoldShape;
  return (
    !!m.strategic &&
    typeof m.strategic === "object" &&
    Object.keys(m.strategic).length > 0 &&
    !!m.operational &&
    typeof m.operational === "object" &&
    Object.keys(m.operational).length > 0 &&
    !!m.epistemic &&
    typeof m.epistemic === "object" &&
    Object.keys(m.epistemic).length > 0
  );
}

// ── Main scorer ──

export function scoreDecompositionQuality(
  entities: Array<{
    entity_id: string;
    name: string;
    description?: string;
    source_tag?: string;
    importance?: string;
    manifold?: unknown;
  }>,
  edges: Array<{
    source_entity_id: string;
    target_entity_id: string;
    relationship_type?: string;
    topology?: string | null;
    dynamics?: string | null;
    dynamics_properties?: Record<string, unknown> | null;
    confidence?: number;
  }>,
  depth: Depth
): DecompositionQualityReport {
  const t = TARGETS[depth];
  const entityCount = entities.length;
  const edgeCount = edges.length;

  // 1. Entity count
  const entityCountScore = entityCount > 0 ? Math.min(1, entityCount / t.entityTarget) : 0;

  // 2. Edge density
  const density = entityCount > 0 ? edgeCount / entityCount : 0;
  const edgeDensityScore = Math.min(1, density / t.edgeDensityTarget);

  // 3. Implicit ratio
  const implicitCount = entities.filter((e) => e.source_tag === "implicit").length;
  const implicitRatio = entityCount > 0 ? implicitCount / entityCount : 0;
  const implicitRatioScore = Math.min(1, implicitRatio / 0.25);

  // 4. Manifold completeness
  const highImportanceEntities = entities.filter(
    (e) => e.importance === "fundamental" || e.importance === "critical"
  );
  const requiredManifolds = highImportanceEntities.length;
  const completeManifolds = highImportanceEntities.filter((e) =>
    isManifoldComplete(e.manifold)
  ).length;
  const manifoldScore =
    requiredManifolds > 0 ? completeManifolds / requiredManifolds : 1.0;

  // 5. Orphan count (entities with <2 edges)
  const adjacency = new Map<string, number>();
  for (const e of entities) {
    adjacency.set(e.entity_id, 0);
  }
  for (const edge of edges) {
    adjacency.set(edge.source_entity_id, (adjacency.get(edge.source_entity_id) ?? 0) + 1);
    adjacency.set(edge.target_entity_id, (adjacency.get(edge.target_entity_id) ?? 0) + 1);
  }
  const orphans = entities.filter((e) => (adjacency.get(e.entity_id) ?? 0) < 2).length;
  const orphanScore = entityCount > 0 ? clamp01(1 - orphans / entityCount) : 1.0;

  // 6. Edge per entity
  const edgeCounts = entities.map((e) => adjacency.get(e.entity_id) ?? 0);
  const minEdges = edgeCounts.length > 0 ? Math.min(...edgeCounts) : 0;
  const meanEdges =
    edgeCounts.length > 0
      ? edgeCounts.reduce((a, b) => a + b, 0) / edgeCounts.length
      : 0;
  const belowThreshold = edgeCounts.filter((c) => c < t.minEdgesPerEntity).length;
  const edgePerEntityScore =
    entityCount > 0 ? clamp01(1 - belowThreshold / entityCount) : 1.0;

  // 7. Description depth
  const descTargetEntities = highImportanceEntities;
  const adequateDescriptions = descTargetEntities.filter(
    (e) => (e.description?.length ?? 0) >= t.descriptionMinChars
  ).length;
  const descriptionDepthScore =
    descTargetEntities.length > 0
      ? adequateDescriptions / descTargetEntities.length
      : 1.0;

  // 8. Importance distribution
  const fundamentalCount = entities.filter((e) => e.importance === "fundamental").length;
  const criticalCount = entities.filter((e) => e.importance === "critical").length;
  const importanceScore = Math.min(
    1,
    (Math.min(1, fundamentalCount / t.fundamentalTarget) +
      Math.min(1, criticalCount / t.criticalTarget)) /
      2
  );

  // ── Edge semantic richness (novel metrics — measure Tier 3 preservation) ──
  // These were previously unmeasured. A graph could have high edge density but
  // undifferentiated, untyped, untopo'd, linear-by-default edges.
  const totalEdges = edgeCount;

  // Topology coverage: % of edges with non-null, non-empty topology
  const topologyPopulated = edges.filter(
    (e) => typeof e.topology === "string" && e.topology.trim().length > 0,
  ).length;
  const topologyCoverageRaw = totalEdges > 0 ? topologyPopulated / totalEdges : 0;
  // Target: at least 40% of edges should have topology (not all relationships are
  // set-theoretic, so 100% is unrealistic)
  const topologyCoverageScore = totalEdges === 0 ? 1.0 : clamp01(topologyCoverageRaw / 0.4);

  // Dynamics coverage: % of edges with dynamics other than default "linear"
  // Default "linear" is a fallback from sanitizeEdge; non-default means LLM actually
  // picked a dynamics class (compounding, threshold, decay, etc.)
  const dynamicsPopulated = edges.filter((e) => {
    const d = e.dynamics;
    if (typeof d !== "string") return false;
    const dLow = d.trim().toLowerCase();
    return dLow.length > 0 && dLow !== "linear" && dLow !== "null";
  }).length;
  const dynamicsCoverageRaw = totalEdges > 0 ? dynamicsPopulated / totalEdges : 0;
  // Target: at least 30% non-linear dynamics. Most edges ARE linear, but in a rigorous
  // decomposition you'd expect compounding/threshold/decay edges for cycles, bottlenecks.
  const dynamicsCoverageScore = totalEdges === 0 ? 1.0 : clamp01(dynamicsCoverageRaw / 0.3);

  // Relationship type diversity: detect "everything is relates-to" failure mode
  const relationshipTypeCounts = new Map<string, number>();
  for (const e of edges) {
    const rt = (e.relationship_type || "").trim().toLowerCase() || "unknown";
    relationshipTypeCounts.set(rt, (relationshipTypeCounts.get(rt) ?? 0) + 1);
  }
  const uniqueRelationshipTypes = relationshipTypeCounts.size;
  let dominantType: string | null = null;
  let dominantCount = 0;
  for (const [type, count] of relationshipTypeCounts) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantType = type;
    }
  }
  const dominantRatio = totalEdges > 0 ? dominantCount / totalEdges : 0;
  // Score: combine unique-type count (normalized to target 5) with dominance penalty.
  // Heavy penalty if >60% of edges share the same type ("relates-to" spam).
  const typeCountScore = totalEdges === 0 ? 1.0 : clamp01(uniqueRelationshipTypes / 5);
  const dominancePenalty = dominantRatio > 0.6 ? (1 - (dominantRatio - 0.6) / 0.4) : 1.0;
  const relationshipDiversityScore = clamp01(typeCountScore * dominancePenalty);

  // Confidence calibration: % of edges with confidence < 0.4 (soft-low). Unlike the
  // hard filter at 0.2, this tracks edges that survived filtering but are still
  // low-confidence — signals an LLM that's emitting hedged edges. Too many = poor
  // calibration. We penalize if > 25% of edges are soft-low.
  const lowConfidenceCount = edges.filter(
    (e) => typeof e.confidence === "number" && e.confidence < 0.4,
  ).length;
  const lowConfidenceRatio = totalEdges > 0 ? lowConfidenceCount / totalEdges : 0;
  const confidenceCalibrationScore = totalEdges === 0
    ? 1.0
    : lowConfidenceRatio <= 0.25
      ? 1.0
      : clamp01(1 - (lowConfidenceRatio - 0.25) / 0.5);

  // ── Build metrics ──
  const metrics: DecompositionQualityReport["metrics"] = {
    entityCount: { score: entityCountScore, actual: entityCount, target: t.entityTarget },
    edgeDensity: {
      score: edgeDensityScore,
      actual: Math.round(density * 100) / 100,
      target: t.edgeDensityTarget,
    },
    implicitRatio: {
      score: implicitRatioScore,
      actual: Math.round(implicitRatio * 100) / 100,
      target: 0.25,
    },
    manifoldCompleteness: {
      score: manifoldScore,
      complete: completeManifolds,
      required: requiredManifolds,
    },
    orphanCount: { score: orphanScore, actual: orphans, target: 0 },
    edgePerEntity: {
      score: edgePerEntityScore,
      minEdges,
      meanEdges: Math.round(meanEdges * 100) / 100,
      belowThreshold,
    },
    descriptionDepth: {
      score: descriptionDepthScore,
      adequate: adequateDescriptions,
      total: descTargetEntities.length,
    },
    importanceDistribution: {
      score: importanceScore,
      fundamental: fundamentalCount,
      critical: criticalCount,
    },
    topologyCoverage: {
      score: topologyCoverageScore,
      populated: topologyPopulated,
      total: totalEdges,
    },
    dynamicsCoverage: {
      score: dynamicsCoverageScore,
      populated: dynamicsPopulated,
      total: totalEdges,
    },
    relationshipDiversity: {
      score: relationshipDiversityScore,
      uniqueTypes: uniqueRelationshipTypes,
      total: totalEdges,
      dominantType,
      dominantRatio: Math.round(dominantRatio * 100) / 100,
    },
    confidenceCalibration: {
      score: confidenceCalibrationScore,
      lowConfidence: lowConfidenceCount,
      total: totalEdges,
    },
  };

  // ── Weighted overall ──
  const overall =
    entityCountScore * WEIGHTS.entityCount +
    edgeDensityScore * WEIGHTS.edgeDensity +
    implicitRatioScore * WEIGHTS.implicitRatio +
    manifoldScore * WEIGHTS.manifoldCompleteness +
    orphanScore * WEIGHTS.orphanCount +
    edgePerEntityScore * WEIGHTS.edgePerEntity +
    descriptionDepthScore * WEIGHTS.descriptionDepth +
    importanceScore * WEIGHTS.importanceDistribution +
    topologyCoverageScore * WEIGHTS.topologyCoverage +
    dynamicsCoverageScore * WEIGHTS.dynamicsCoverage +
    relationshipDiversityScore * WEIGHTS.relationshipDiversity +
    confidenceCalibrationScore * WEIGHTS.confidenceCalibration;

  // ── Deficiencies ──
  const deficiencies: string[] = [];

  if (entityCountScore < 0.8) {
    deficiencies.push(
      `Entity count is ${entityCount}, target is ${t.entityTarget} (score: ${(entityCountScore * 100).toFixed(0)}%)`
    );
  }
  if (edgeDensityScore < 0.8) {
    deficiencies.push(
      `Edge density is ${density.toFixed(2)} edges/entity, target is ${t.edgeDensityTarget} (score: ${(edgeDensityScore * 100).toFixed(0)}%)`
    );
  }
  if (implicitRatioScore < 0.8) {
    deficiencies.push(
      `Only ${(implicitRatio * 100).toFixed(0)}% of entities are implicit (${implicitCount}/${entityCount}), target is 25% (score: ${(implicitRatioScore * 100).toFixed(0)}%)`
    );
  }
  if (manifoldScore < 0.8) {
    const incomplete = highImportanceEntities
      .filter((e) => !isManifoldComplete(e.manifold))
      .map((e) => e.name);
    deficiencies.push(
      `${completeManifolds}/${requiredManifolds} fundamental/critical entities have complete manifolds. Missing: ${incomplete.join(", ")} (score: ${(manifoldScore * 100).toFixed(0)}%)`
    );
  }
  if (orphanScore < 0.8) {
    deficiencies.push(
      `${orphans} entities have fewer than 2 edges (orphans), out of ${entityCount} total (score: ${(orphanScore * 100).toFixed(0)}%)`
    );
  }
  if (edgePerEntityScore < 0.8) {
    deficiencies.push(
      `${belowThreshold} entities have fewer than ${t.minEdgesPerEntity} edges (min: ${minEdges}, mean: ${meanEdges.toFixed(1)}). Target: ${t.minEdgesPerEntity}+ edges per entity (score: ${(edgePerEntityScore * 100).toFixed(0)}%)`
    );
  }
  if (descriptionDepthScore < 0.8) {
    deficiencies.push(
      `${adequateDescriptions}/${descTargetEntities.length} fundamental/critical entities have descriptions >= ${t.descriptionMinChars} chars (score: ${(descriptionDepthScore * 100).toFixed(0)}%)`
    );
  }
  if (importanceScore < 0.8) {
    deficiencies.push(
      `Importance distribution: ${fundamentalCount} fundamental (target: ${t.fundamentalTarget}), ${criticalCount} critical (target: ${t.criticalTarget}) (score: ${(importanceScore * 100).toFixed(0)}%)`
    );
  }

  // ── Edge semantic richness deficiencies ──
  // These surface Tier 3 preservation failures. If the structuring pass loses the
  // topology/dynamics annotations the LLM emitted in Pass 1, these scores drop.
  if (totalEdges > 0 && topologyCoverageScore < 0.6) {
    deficiencies.push(
      `Only ${topologyPopulated}/${totalEdges} edges have topology annotations (${(topologyCoverageRaw * 100).toFixed(0)}%). Pass 1 Tier 3 likely emitted [TOPOLOGY: ...] tags that were lost during structuring. Target: 40%+ (score: ${(topologyCoverageScore * 100).toFixed(0)}%)`
    );
  }
  if (totalEdges > 0 && dynamicsCoverageScore < 0.5) {
    deficiencies.push(
      `Only ${dynamicsPopulated}/${totalEdges} edges have non-linear dynamics (${(dynamicsCoverageRaw * 100).toFixed(0)}%). Cycles, bottlenecks, and feedback loops typically have compounding/threshold/decay dynamics — extract these from Pass 1 Tier 3 annotations. Target: 30%+ (score: ${(dynamicsCoverageScore * 100).toFixed(0)}%)`
    );
  }
  if (totalEdges >= 5 && relationshipDiversityScore < 0.5) {
    const dominantNote = dominantType && dominantRatio > 0.6
      ? ` (${(dominantRatio * 100).toFixed(0)}% of edges are "${dominantType}" — undifferentiated)`
      : "";
    deficiencies.push(
      `Relationship types are not diverse: ${uniqueRelationshipTypes} distinct types across ${totalEdges} edges${dominantNote}. Use the full edge taxonomy: causes, enables, constrains, requires, contradicts, part_of, precedes, depends_on, etc. Generic "relates-to" is a cop-out. (score: ${(relationshipDiversityScore * 100).toFixed(0)}%)`
    );
  }
  if (totalEdges >= 5 && confidenceCalibrationScore < 0.6) {
    deficiencies.push(
      `${lowConfidenceCount}/${totalEdges} edges are low-confidence (<0.4), ${(lowConfidenceRatio * 100).toFixed(0)}% of the graph. Either ground these edges with evidence (raising confidence) or drop the ones that don't hold up. Hedged edges dilute the analysis. (score: ${(confidenceCalibrationScore * 100).toFixed(0)}%)`
    );
  }

  // ── Hard gates: individual critical metrics that force retry regardless of overall score ──
  // These prevent the scenario where a high overall score masks a single catastrophic gap.
  // Tightened from original thresholds: orphan 30%→15%, density 1.2→1.8, added importance gate.
  const hardGateFailures: string[] = [];

  if (depth !== "quick") {
    // Manifold completeness: for standard/deep, at least 50% of high-importance must have manifolds
    if (requiredManifolds > 0 && manifoldScore < 0.5) {
      hardGateFailures.push(`Manifold completeness critically low (${(manifoldScore * 100).toFixed(0)}% — need at least 50% for ${depth} tier)`);
    }
    // Orphan rate: more than 15% orphans is unacceptable — graph is too disconnected
    // (tightened from 30%: allowing 30% orphans produced visually fragmented graphs)
    if (entityCount > 0 && orphans / entityCount > 0.15) {
      hardGateFailures.push(`Orphan rate critically high (${orphans}/${entityCount} = ${((orphans / entityCount) * 100).toFixed(0)}% — max 15%). Every entity MUST have at least 2 edges. For orphans: either add missing relationships, or demote to properties of connected entities.`);
    }
    // Edge density: for standard/deep, minimum 1.8 edges per entity (tightened from 1.2)
    // A density of 1.2 means barely 1 edge per entity — completely unusable for analysis.
    // The prompt explicitly targets 1.5× entity count minimum (density 1.5).
    if (entityCount > 0 && density < 1.8) {
      hardGateFailures.push(`Edge density critically low (${density.toFixed(2)} — absolute minimum 1.8 for ${depth} tier). The decomposition prompt targets 1.5× entity count. For EVERY entity, ask: what does it depend on? what does it produce? what constrains it?`);
    }
    // Importance distribution: at least 1 fundamental entity required for standard/deep
    // Without fundamental entities, the graph has no hierarchy anchor points and expansion
    // cannot identify targets. This was previously a soft deficiency — now a hard gate.
    if (entityCount >= 10 && fundamentalCount === 0 && criticalCount < 2) {
      hardGateFailures.push(`No fundamental entities and fewer than 2 critical entities. A ${depth}-tier analysis of ${entityCount} entities MUST identify at least 1 fundamental entity (highest structural importance, anchor for hierarchy). Mark the entity most central to the user's goal as fundamental.`);
    }
  }

  // Quick tier: still enforce minimum connectivity
  if (depth === "quick") {
    if (entityCount > 0 && orphans / entityCount > 0.25) {
      hardGateFailures.push(`Orphan rate too high for quick tier (${orphans}/${entityCount} = ${((orphans / entityCount) * 100).toFixed(0)}% — max 25%)`);
    }
    if (entityCount > 0 && density < 1.5) {
      hardGateFailures.push(`Edge density too low for quick tier (${density.toFixed(2)} — minimum 1.5)`);
    }
  }

  if (depth === "deep") {
    // Deep tier: implicit ratio at least 15% (absolute floor)
    if (entityCount > 5 && implicitRatio < 0.15) {
      hardGateFailures.push(`Implicit entity ratio critically low (${(implicitRatio * 100).toFixed(0)}% — deep tier requires at least 15%)`);
    }
    // Deep tier: require at least 2 fundamental entities
    if (entityCount >= 10 && fundamentalCount < 2) {
      hardGateFailures.push(`Deep tier requires at least 2 fundamental entities (found ${fundamentalCount}). Identify the most structurally important concepts and mark them fundamental.`);
    }
  }

  // ── Retry guidance ──
  const retryRecommended = overall < t.retryThreshold || hardGateFailures.length > 0;

  let retryGuidance = "";
  const allIssues = [...deficiencies, ...hardGateFailures.map((f) => `CRITICAL: ${f}`)];
  if (allIssues.length > 0) {
    const numbered = allIssues.map((d, i) => `${i + 1}. ${d}`).join("\n");
    const depthLabel = depth === "quick" ? "Quick" : depth === "standard" ? "Standard" : "Deep";
    const requirements: string[] = [];
    if (entityCountScore < 0.8) requirements.push(`at least ${t.entityTarget} entities`);
    if (edgeDensityScore < 0.8)
      requirements.push(`edge density of ${t.edgeDensityTarget}+ edges per entity`);
    if (implicitRatioScore < 0.8) requirements.push(`at least 25% implicit entities`);
    if (edgePerEntityScore < 0.8)
      requirements.push(`${t.minEdgesPerEntity}+ edges per entity`);
    if (importanceScore < 0.8)
      requirements.push(`at least ${t.fundamentalTarget} fundamental and ${t.criticalTarget} critical entities`);
    if (orphanScore < 0.85)
      requirements.push(`fewer than 15% orphan entities (currently ${orphans}/${entityCount})`);

    // Add Tier 3 preservation directives if semantic-richness metrics are failing
    const tier3Directives: string[] = [];
    if (topologyCoverageScore < 0.6) tier3Directives.push("- For each edge, tag its set-theoretic topology when it applies: inside, overlap, meets, disjoint, composes, cover, equal. Do NOT leave topology null for edges that obviously have one (e.g., 'X is part of Y' → composes; 'X contradicts Y' → disjoint).");
    if (dynamicsCoverageScore < 0.5) tier3Directives.push("- For each edge, classify dynamics: threshold (no effect until condition met), linear (proportional), compounding (each turn amplifies), delayed (effect lags), decay (fades over time), step_function (discrete jumps). Default-linear is a sign the LLM didn't actually analyze the relationship.");
    if (relationshipDiversityScore < 0.5) tier3Directives.push("- Use specific relationship_type labels: causes, enables, constrains, requires, produces, depends_on, contradicts, part_of, precedes, synchronizes_with, competes_with. STOP using generic 'relates-to' — if you need 'relates-to', you haven't analyzed the relationship yet.");
    if (confidenceCalibrationScore < 0.6) tier3Directives.push("- For every edge below confidence 0.5, either ground it with specific evidence (raising confidence) or drop it. Hedged edges dilute the graph.");

    const tier3Block = tier3Directives.length > 0
      ? `\n\nTIER 3 PRESERVATION — the structuring pass lost annotations from the free-form decomposition. Retry must preserve them:\n${tier3Directives.join("\n")}`
      : "";

    retryGuidance = `The previous decomposition had the following quality issues:\n${numbered}\n\nCRITICAL REQUIREMENTS FOR RETRY:\n- Every entity MUST have at least ${t.minEdgesPerEntity} edges. For each entity, systematically ask: What enables it? What does it produce? What constrains it? What is it in tension with?\n- Mark at least ${t.fundamentalTarget} entities as "fundamental" and ${t.criticalTarget} as "critical". These are the highest-importance structural anchors.\n- Target edge density: ${t.edgeDensityTarget}× entity count (if ${t.entityTarget} entities → at least ${Math.ceil(t.entityTarget * t.edgeDensityTarget)} edges).\n- Zero orphans. Every entity must connect to at least 2 others.${tier3Block}\n\nPlease re-analyze and specifically address these gaps. ${depthLabel}-tier analysis requires ${requirements.length > 0 ? requirements.join(", ") : "higher overall quality"}.`;
  }

  return {
    overall: Math.round(overall * 1000) / 1000,
    metrics,
    deficiencies: [...deficiencies, ...hardGateFailures],
    retryRecommended,
    retryGuidance,
  };
}

// ── Structuring guidance builder ──

export function buildStructuringGuidance(
  report: DecompositionQualityReport,
  entities: Array<{ entity_id: string; name: string; importance?: string }>
): string {
  if (report.deficiencies.length === 0) return "";

  const lines: string[] = [
    "STRUCTURING QUALITY GUIDANCE — address the following deficiencies during structuring:",
    "",
  ];

  const { metrics } = report;

  if (metrics.manifoldCompleteness.score < 0.8) {
    const needManifold = entities
      .filter(
        (e) =>
          (e.importance === "fundamental" || e.importance === "critical")
      )
      .map((e) => `${e.entity_id} (${e.name})`);
    if (needManifold.length > 0) {
      lines.push(
        `- These fundamental/critical entities need complete manifolds (strategic + operational + epistemic): ${needManifold.join(", ")}. Infer manifold values from context where not explicitly stated.`
      );
    }
  }

  if (metrics.descriptionDepth.score < 0.8) {
    const needDescription = entities
      .filter(
        (e) =>
          (e.importance === "fundamental" || e.importance === "critical")
      )
      .map((e) => `${e.entity_id} (${e.name})`);
    if (needDescription.length > 0) {
      lines.push(
        `- These entities need longer descriptions explaining WHY they matter to the system: ${needDescription.join(", ")}. Minimum ${metrics.descriptionDepth.total > 0 ? "required" : "expected"} length not met.`
      );
    }
  }

  if (metrics.implicitRatio.score < 0.8) {
    lines.push(
      `- The decomposition lacks implicit entities. Currently ${(metrics.implicitRatio.actual * 100).toFixed(0)}% are implicit vs. the 25% target. Add domain-inferred entities the user did not explicitly mention (processes, mechanisms, dependencies, assumptions, market forces).`
    );
  }

  if (metrics.edgeDensity.score < 0.8 || metrics.edgePerEntity.score < 0.8) {
    lines.push(
      `- Edge coverage is thin. Current density: ${metrics.edgeDensity.actual} edges/entity (target: ${metrics.edgeDensity.target}). ${metrics.edgePerEntity.belowThreshold} entities are under-connected. Add causal, temporal, and enabling relationships between existing entities.`
    );
  }

  if (metrics.orphanCount.score < 0.8) {
    lines.push(
      `- ${metrics.orphanCount.actual} entities are near-orphans (<2 edges). Every entity should participate in at least 2 relationships. Connect orphaned entities or remove them if they add no analytical value.`
    );
  }

  if (metrics.entityCount.score < 0.8) {
    lines.push(
      `- Only ${metrics.entityCount.actual} entities found vs. target of ${metrics.entityCount.target}. Expand the decomposition with missing concepts: constraints, dependencies, external forces, feedback mechanisms.`
    );
  }

  if (metrics.importanceDistribution.score < 0.8) {
    lines.push(
      `- Importance distribution is skewed: ${metrics.importanceDistribution.fundamental} fundamental (need ${report.metrics.importanceDistribution.fundamental >= 0 ? "more" : ""}), ${metrics.importanceDistribution.critical} critical. Ensure the most impactful entities are properly classified.`
    );
  }

  return lines.join("\n");
}
