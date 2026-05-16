// Synthesis quality scorer — Gap 5
// Rates synthesis depth, specificity, utility-grounding, evidence quality, actionability, external coverage
// Programmatic validation (~5ms), no LLM call

import type { Entity, Edge } from "@/types";
import type { SynthesisData, SynthesisQualityScore, QualityFlag } from "@/types/synthesis";
import type { EpistemicClassification } from "@/types/epistemic";

/**
 * Score synthesis quality across 6 dimensions.
 * Detects shallow reasoning, generic actions, overconfidence, and ungrounded findings.
 */
export function scoreSynthesisQuality(
  synthesis: SynthesisData,
  entities: Entity[],
  edges: Edge[],
  expansionEntityIds?: Set<string>,
  epistemicClassification?: EpistemicClassification | null,
): SynthesisQualityScore {
  const flags: QualityFlag[] = [];
  const entityIds = new Set(entities.map((e) => e.entity_id));

  // ── Depth (0-100): reasoning richness ──
  let depth = 0;
  for (const lp of synthesis.leverage_points ?? []) {
    const reasonCount = lp.reasoning?.length ?? 0;
    depth += Math.min(reasonCount * 5, 20);
    if (reasonCount < 2) flags.push("shallow_leverage");
  }
  for (const rp of synthesis.risk_points ?? []) {
    depth += Math.min((rp.how_it_fails?.length ?? 0) * 5, 15);
  }
  if (synthesis.master_bottleneck) {
    depth += Math.min((synthesis.master_bottleneck.reasoning?.length ?? 0) * 5, 15);
  }
  for (const loop of synthesis.feedback_loops ?? []) {
    if (loop.intervention_at != null) depth += 10;
  }
  depth = Math.min(depth, 20 + 15 + 15 + 20); // max from loops
  for (const sc of synthesis.scenarios ?? []) {
    if (sc.probability) depth += 5;
  }
  depth = Math.min(depth, 100);
  // Penalty for shallow leverage
  for (const lp of synthesis.leverage_points ?? []) {
    if ((lp.reasoning?.length ?? 0) < 2) depth = Math.max(0, depth - 10);
  }

  // ── Specificity (0-100): grounded in specific entities ──
  let specificity = 0;
  for (const lp of synthesis.leverage_points ?? []) {
    if (lp.entity_id && entityIds.has(lp.entity_id)) specificity += 10;
    else if (!lp.entity_id || lp.entity_id === "unknown") flags.push("shallow_leverage");
  }
  for (const rp of synthesis.risk_points ?? []) {
    if (rp.entity_id && entityIds.has(rp.entity_id)) specificity += 10;
    else if (!rp.entity_id || rp.entity_id === "unknown") flags.push("ungrounded_risk");
  }
  specificity = Math.min(specificity, 30);
  // Action tags
  let taggedActions = 0;
  for (const path of synthesis.action_plan?.paths ?? []) {
    for (const tf of path.timeframes ?? []) {
      for (const action of tf.actions ?? []) {
        if (action.tags?.length) taggedActions++;
      }
    }
  }
  specificity += Math.min(taggedActions * 5, 20);
  // Scenarios with conditions
  for (const sc of synthesis.scenarios ?? []) {
    if (sc.conditions) specificity += 10;
  }
  specificity = Math.min(specificity, 100);
  // Loops with steps
  for (const loop of synthesis.feedback_loops ?? []) {
    if (loop.steps?.length >= 2) specificity += 10;
  }
  specificity = Math.min(specificity, 100);

  // ── Utility Grounding (0-100): references edge utilities ──
  let utilityGrounding = 0;
  const utilityEdges = edges.filter((e) => {
    const util = e.utility as Record<string, unknown> | null;
    return util && (util.actionability || util.failure_consequence || util.decision_question);
  });
  // Base: proportion of edges with utility annotations (scaled)
  if (edges.length > 0) {
    utilityGrounding += Math.min(Math.round((utilityEdges.length / edges.length) * 40), 40);
  }
  // Actions with dynamic_role
  let dynamicRoleCount = 0;
  let costOfDelayCount = 0;
  for (const path of synthesis.action_plan?.paths ?? []) {
    for (const tf of path.timeframes ?? []) {
      for (const action of tf.actions ?? []) {
        if (action.dynamic_role) dynamicRoleCount++;
        if (action.cost_of_delay) costOfDelayCount++;
      }
    }
  }
  utilityGrounding += Math.min(dynamicRoleCount * 10, 30);
  utilityGrounding += Math.min(costOfDelayCount * 10, 30);
  utilityGrounding = Math.min(utilityGrounding, 100);

  // ── Evidence Quality (0-100): acknowledges uncertainty ──
  let evidenceQuality = 0;
  // Contradictions identified
  const contradictionCount = synthesis.contradictions?.length ?? 0;
  evidenceQuality += Math.min(contradictionCount * 10, 20);
  // Open questions identified
  const questionCount = synthesis.open_questions?.length ?? 0;
  evidenceQuality += Math.min(questionCount * 5, 15);
  // Worth-considering with source_note
  for (const wc of synthesis.worth_considering ?? []) {
    if (wc.source_note) evidenceQuality += 5;
  }
  evidenceQuality = Math.min(evidenceQuality, 50);
  // Leverage/risk mentioning confidence
  for (const lp of synthesis.leverage_points ?? []) {
    const mentions = lp.reasoning?.some((r) =>
      /confiden|uncertain|assum|speculative|evidence/i.test(r)
    );
    if (mentions) evidenceQuality += 10;
  }
  for (const rp of synthesis.risk_points ?? []) {
    const mentions = rp.reasoning?.some((r) =>
      /confiden|uncertain|assum|speculative|evidence/i.test(r)
    );
    if (mentions) evidenceQuality += 10;
  }
  evidenceQuality = Math.min(evidenceQuality, 100);
  // Penalty: overconfident (no contradictions AND no open questions)
  // Only penalise when graph is large enough that zero contradictions is suspicious
  const entityCount = entities.length;
  if (contradictionCount === 0 && questionCount === 0 && entityCount >= 15) {
    const penalty = entityCount >= 30 ? 20 : 10;
    evidenceQuality = Math.max(0, evidenceQuality - penalty);
    flags.push("overconfident");
  }

  // ── Actionability (0-100): clear next steps ──
  let actionability = 0;
  const paths = synthesis.action_plan?.paths ?? [];
  if (paths.length > 0) actionability += 20;
  for (const path of paths) {
    for (const tf of path.timeframes ?? []) {
      if (tf.actions?.length >= 2) actionability += 10;
    }
  }
  actionability = Math.min(actionability, 50);
  // Actions with cost_of_delay
  actionability += Math.min(costOfDelayCount * 10, 20);
  // Actions referencing entity names
  let entityRefActions = 0;
  const entityNames = new Set(entities.map((e) => e.name.toLowerCase()));
  for (const path of paths) {
    for (const tf of path.timeframes ?? []) {
      for (const action of tf.actions ?? []) {
        const text = action.text.toLowerCase();
        for (const name of entityNames) {
          if (text.includes(name)) { entityRefActions++; break; }
        }
      }
    }
  }
  actionability += Math.min(entityRefActions * 5, 20);
  actionability = Math.min(actionability, 100);
  // Penalty: all actions generic (no entity references)
  if (entityRefActions === 0 && paths.length > 0) {
    actionability = Math.max(0, actionability - 20);
    flags.push("generic_actions");
  }

  // ── External Coverage (0-100): external entity & bridge quality ──
  let externalCoverage = 0;
  const externalEntities = entities.filter((e) => e.knowledge_layer === "external");
  const bridgeEdges = edges.filter((e) => e.knowledge_layer === "bridge");
  const highAuthorityExternals = externalEntities.filter(
    (e) => e.authority_level === "high"
  );

  // Has any external entities
  if (externalEntities.length > 0) externalCoverage += 15;
  // External count >= 5
  if (externalEntities.length >= 5) externalCoverage += 10;
  // External count >= 10
  if (externalEntities.length >= 10) externalCoverage += 10;
  // Has bridge edges
  if (bridgeEdges.length > 0) externalCoverage += 15;
  // Bridge count >= 3
  if (bridgeEdges.length >= 3) externalCoverage += 10;
  // Any high-authority external entities
  if (highAuthorityExternals.length > 0) externalCoverage += 15;
  // High-authority >= 3
  if (highAuthorityExternals.length >= 3) externalCoverage += 10;
  // Cross-context insights exist
  const hasCrossContext =
    (synthesis.cross_context_insights?.length ?? 0) > 0 ||
    (synthesis.worth_considering ?? []).some(
      (wc) => wc.source_origin === "external_research" || wc.source_origin === "bridge_analysis"
    );
  if (hasCrossContext) externalCoverage += 15;

  externalCoverage = Math.min(externalCoverage, 100);

  // Flag: many entities but zero external
  if (entities.length >= 10 && externalEntities.length === 0) {
    flags.push("weak_external_coverage");
  }

  // ── Additional flags ──
  if (!synthesis.feedback_loops?.length) flags.push("missing_dynamics");
  for (const rp of synthesis.risk_points ?? []) {
    if (!rp.blast_radius && !rp.how_it_fails?.length) flags.push("ungrounded_risk");
  }

  // ── Expansion depth checks ──
  if (expansionEntityIds && expansionEntityIds.size > 0) {
    // Bonus: leverage points that reference expanded entities get depth credit
    for (const lp of synthesis.leverage_points ?? []) {
      if (lp.entity_id && expansionEntityIds.has(lp.entity_id)) {
        depth = Math.min(100, depth + 5);
        specificity = Math.min(100, specificity + 5);
      }
    }
    // Bonus: risk points with expanded entities get evidence credit
    for (const rp of synthesis.risk_points ?? []) {
      if (rp.entity_id && expansionEntityIds.has(rp.entity_id)) {
        evidenceQuality = Math.min(100, evidenceQuality + 5);
      }
    }
  }

  // Flag: important entities (leverage/risk/bottleneck) that haven't been expanded
  // This is a soft flag — expansion isn't always necessary but reveals internal structure
  if (expansionEntityIds) {
    const leverageIds = (synthesis.leverage_points ?? []).map((lp) => lp.entity_id).filter(Boolean);
    const riskIds = (synthesis.risk_points ?? []).map((rp) => rp.entity_id).filter(Boolean);
    const bottleneckId = synthesis.master_bottleneck?.entity_id;
    const criticalIds = [...new Set([...leverageIds, ...riskIds, ...(bottleneckId ? [bottleneckId] : [])])];
    const unexpandedCritical = criticalIds.filter((id) => id && !expansionEntityIds.has(id));

    // Only flag if we have SOME expansions (indicating user has used the feature)
    // but the most important entities remain unexpanded
    if (expansionEntityIds.size > 0 && unexpandedCritical.length > 0 && unexpandedCritical.length >= criticalIds.length * 0.5) {
      // More than half of critical entities are unexpanded
      depth = Math.max(0, depth - 5);
      flags.push("unexpanded_critical");
    }
  }

  // ── Display-readiness flags ──
  // Catches the specific defects that make the right-rail render as
  // "Bottleneck / Bottleneck / blast radius 18.00" — empty summaries,
  // missing entity_name, or platitude summaries the synthesis prompt
  // explicitly forbids.
  const entityNamesLower = new Set(
    entities
      .map((e) => (e.name ?? "").toLowerCase().trim())
      .filter((n) => n.length > 0),
  );
  const isParroting = (text: string): boolean => {
    const t = (text ?? "").toLowerCase().trim();
    if (t.length < 20) return false;
    // Banned generic phrases — the synthesis prompt warns against
    // these explicitly. Hitting two or more is a hard parroting flag.
    const banned = [
      "improve overall",
      "enhance overall",
      "optimize overall",
      "increase overall",
      "improve effectiveness",
      "reduce effectiveness",
      "increase efficiency",
      "improve understanding",
      "enhances productivity",
      "drives success",
      "key to success",
      "best practices",
      "leverage synergies",
    ];
    const hits = banned.filter((p) => t.includes(p)).length;
    if (hits >= 1) return true;
    // No named entity from the graph mentioned anywhere in the
    // summary — true sign the LLM is generalising not grounding.
    if (entityNamesLower.size > 0) {
      const referencesAnEntity = Array.from(entityNamesLower).some(
        (name) => name.length >= 4 && t.includes(name),
      );
      if (!referencesAnEntity) return true;
    }
    return false;
  };

  for (const lp of synthesis.leverage_points ?? []) {
    const name = (
      (lp as unknown as { entity_name?: string }).entity_name ?? ""
    ).trim();
    const summary = (lp.summary ?? "").trim();
    if (name.length === 0) flags.push("missing_insight_name");
    if (summary.length < 20) flags.push("empty_insight_summary");
    else if (isParroting(summary)) flags.push("parroting_summary");
  }
  for (const rp of synthesis.risk_points ?? []) {
    const name = (
      (rp as unknown as { entity_name?: string }).entity_name ?? ""
    ).trim();
    const summary = (rp.summary ?? "").trim();
    if (name.length === 0) flags.push("missing_insight_name");
    if (summary.length < 20) flags.push("empty_insight_summary");
    else if (isParroting(summary)) flags.push("parroting_summary");
  }
  if (synthesis.master_bottleneck) {
    const summary = (synthesis.master_bottleneck.summary ?? "").trim();
    if (summary.length < 20) flags.push("empty_insight_summary");
    else if (isParroting(summary)) flags.push("parroting_summary");
  }

  // ── Phase 8: Classification-aware quality flags ──
  if (epistemicClassification) {
    // Flag: classification detected argument structure but synthesis lacks Toulmin entities
    if (epistemicClassification.toulmin.has_argument) {
      const hasToulminEntities = entities.some((e) => {
        const m = e.manifold as Record<string, unknown> | null;
        return m?.toulmin_role != null;
      });
      if (!hasToulminEntities) {
        flags.push("missing_epistemic_framework");
      }
    }

    // Flag: classification detected causal depth but edges lack pearl_level
    if (epistemicClassification.causal_depth !== "association") {
      const hasPearlEdges = edges.some((e) => {
        const u = e.utility as Record<string, unknown> | null;
        return u?.pearl_level != null;
      });
      if (!hasPearlEdges) {
        flags.push("causal_level_mismatch");
      }
    }
  }

  // ── Overall (rebalanced for 6 dimensions, classification-adjusted) ──
  // Phase 8: Adjust dimension weights based on input type
  let wDepth = 0.22, wSpecificity = 0.18, wUtility = 0.14;
  let wEvidence = 0.18, wActionability = 0.18, wExternal = 0.10;

  if (epistemicClassification) {
    switch (epistemicClassification.input_type) {
      case "research_paper":
        // Evidence quality matters more; actionability less
        wEvidence = 0.27; wActionability = 0.11; wDepth = 0.24;
        break;
      case "business_problem":
      case "strategic_plan":
        // Actionability matters more; evidence less
        wActionability = 0.27; wEvidence = 0.11; wSpecificity = 0.20;
        break;
      case "argument":
        // Depth (evidence chain completeness) matters more
        wDepth = 0.30; wEvidence = 0.22; wActionability = 0.10;
        break;
      // All others: default weights
    }
  }

  const overall = Math.round(
    depth * wDepth +
    specificity * wSpecificity +
    utilityGrounding * wUtility +
    evidenceQuality * wEvidence +
    actionability * wActionability +
    externalCoverage * wExternal
  );

  return {
    overall,
    dimensions: {
      depth,
      specificity,
      utility_grounding: utilityGrounding,
      evidence_quality: evidenceQuality,
      actionability,
      external_coverage: externalCoverage,
    },
    flags: [...new Set(flags)], // deduplicate
  };
}
