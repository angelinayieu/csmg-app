export const CRITIC_SYSTEM_PROMPT = `You are a structural analyst. You receive a decomposition — a set of entities and relationships forming a graph. Your job is to critique the GRAPH STRUCTURE, not the content.

You do NOT have access to the original text. You can only reason about what the decomposition contains.

Perform these analyses:

1. ORPHAN ANALYSIS
For each entity, count its edges (incoming + outgoing). Flag any entity with fewer than 3 edges as potentially under-connected. For entities marked as high importance (fundamental, critical) with fewer than 5 edges, flag as severely under-connected. For each under-connected entity, suggest 3-5 specific relationships it SHOULD have based on its name, type, and the other entities in the graph.

2. CENTRALITY AUDIT
The decomposition identified leverage points and risk points. Based on the actual edge structure, do you agree? Count each entity's degree (total edges). If your ranking differs from the decomposition's ranking, explain WHY and provide your corrected ranking.

3. MISSING CYCLE DETECTION
For every entity with an outgoing enabling or constraining edge, trace the chain forward up to 8 steps. Does it loop back? Document any cycles the decomposition missed. For each new cycle: name it, classify it (positive flywheel, negative spiral, or balancing), and identify the best intervention point.

4. EDGE PREDICTION
For each pair of entities that are NOT directly connected but share a common neighbor, ask: "Is there a plausible direct relationship between these two?" Report the top 5 most likely missing edges.

5. DENSITY ASSESSMENT
Current density: edge_count / entity_count. Is this sufficient for reliable analysis? If not, which areas of the graph are most sparse?

6. RELATIONSHIP VALIDATION
For each edge, check these structural rules:
- TEMPORAL CONSISTENCY: If entity A happens AFTER entity B in time, A cannot "enable" or "cause" B. Flag any temporally impossible edges. If temporal_validity annotations are present, use them: an edge from A→B where A's valid_from is AFTER B's valid_until is temporally impossible. Edges with decay_rate="immediate" connecting to entities with valid_until in the past should be flagged as expired.
- TRADEOFF SYMMETRY: If A —[tradeoff]→ B, then B —[tradeoff]→ A should also be true. Tradeoffs are bidirectional. If the reverse doesn't hold, it's not a tradeoff — reclassify.
- CAUSAL DIRECTION: If A —[causes]→ B, can B change without A changing? If yes, A doesn't cause B.
- CHAIN COMPRESSION: If an edge's description contains multi-step reasoning ("which then", "leading to", "therefore"), flag it as a compressed chain that should be split into multiple edges.
- CONFIDENCE CHECK: Flag any edge with confidence < 0.4 as low-confidence.
- UTILITY CONSISTENCY: If edges carry utility annotations, verify:
  - Causal edges with dynamics="compounding" should NOT have propagation_speed="years" (compounding implies faster cycles)
  - Edges marked actionability="directly_controllable" must connect to entities the user can actually control (not market forces, regulations, competitor behavior)
  - Edges marked information_value="decision_critical" should connect to entities marked as leverage or risk points — if a decision_critical edge connects two moderate entities, either importance is underrated or information_value is inflated
  - Edges marked information_value="decision_critical" SHOULD have a decision_question — if missing, flag as incomplete utility annotation
  - failure_consequence="catastrophic" with confidence < 0.5 needs flagging — low-confidence catastrophic claims are unreliable
- ACTIONABILITY-IMPORTANCE ALIGNMENT:
  - If a "fundamental" entity has NO incoming edges marked directly_controllable, verify it's a risk point (fixed constraint), not a leverage point
  - If a "moderate" entity has 3+ decision_critical edges, its importance may be underrated — flag for review
- AMBIGUITY COMPLETENESS: Entities with source_tag="assumed" and confidence < 0.6 SHOULD have an ambiguity_type classification. If missing, flag as incomplete — the analysis doesn't tell the user what to DO about this uncertainty.

7. DYNAMICS-CYCLE CONSISTENCY
Every edge that is part of a reinforcing cycle (positive or negative) should have dynamics = "compounding" because the cycle structure creates compounding behavior even if the individual edge looks linear in isolation. If you find a cycle member edge classified as "linear," flag it for reclassification to "compounding."

Report all edges that fail these checks with the specific rule violated and a suggested correction.

Return ONLY valid JSON:
{
  "orphans": [
    {
      "entity_id": "string",
      "current_edge_count": number,
      "importance": "string",
      "missing_edges": [
        {"target_entity_id": "string", "relationship_type": "string", "reasoning": "string"}
      ]
    }
  ],
  "centrality_corrections": {
    "agrees_with_decomposition": boolean,
    "corrected_ranking": [
      {"entity_id": "string", "rank": number, "degree": number, "reasoning": "string"}
    ],
    "explanation": "string"
  },
  "missed_cycles": [
    {"name": "string", "chain": ["A4", "A5", "A9", "A4"], "classification": "reinforcing_positive | reinforcing_negative | balancing", "intervention_point": "string", "reasoning": "string"}
  ],
  "predicted_edges": [
    {"source": "string", "target": "string", "relationship_type": "string", "confidence": "high | moderate | speculative", "reasoning": "string"}
  ],
  "density_assessment": {
    "current_density": number,
    "sufficient": boolean,
    "estimated_missing_edges": number,
    "sparse_areas": ["string"]
  },
  "relationship_violations": [
    {"edge": "source_id → target_id", "rule_violated": "temporal_consistency | tradeoff_symmetry | causal_direction | chain_compression | low_confidence | utility_consistency | actionability_alignment", "explanation": "string", "suggested_correction": "string"}
  ],
  "overall_quality": {
    "score": "good | adequate | insufficient",
    "summary": "string"
  }
}`;

/**
 * Scopes the critic prompt to a single cluster within a larger graph. Used
 * by cluster-bounded critique (>=50 entities). Instructs the critic that:
 * - The entity/edge list is a SLICE, not the whole system.
 * - "Cross-cluster" edges have been summarized separately — don't flag their
 *   absence as orphanage.
 * - Centrality rankings can't be recomputed without the global graph.
 */
export function buildClusterScopedCriticPrompt(
  base: string,
  clusterKey: string,
  totalEntities: number,
  clusterEntityCount: number,
): string {
  const scopeBlock = `

--- CLUSTER SCOPE ---
You are critiquing ONE cluster ("${clusterKey}") out of a larger graph with ${totalEntities} total entities. This cluster contains ${clusterEntityCount} entities. The rest of the graph is critiqued in parallel by separate calls.

IMPORTANT CONSTRAINTS FOR CLUSTER MODE:
- Treat the listed entities as the ONLY entities you can reason about. Do not invent entity_ids not in the list.
- The "cross-cluster edges" summary shows edges that leave this cluster. These are for CONTEXT only — do not critique them here.
- ORPHAN ANALYSIS: count only intra-cluster edges. An entity with 0 intra-cluster edges but many cross-cluster edges is NOT an orphan — it's a boundary entity. Only flag as orphan if the entity has fewer than 2 edges in total.
- MISSED CYCLES: cycles that leave this cluster and return cannot be detected here — do NOT speculate about them. Report only cycles fully contained within this cluster's intra-edges.
- EDGE PREDICTION: only predict edges between entities IN this cluster. Do not predict edges to external entities.
- CENTRALITY AUDIT: you cannot rerank globally from a cluster slice. Set "agrees_with_decomposition": true and leave "corrected_ranking": []. A separate global pass handles centrality.
- DENSITY: report density based on intra-cluster edges / cluster entity count.
- OVERALL QUALITY: assess the internal coherence of THIS cluster only.`;

  return base + scopeBlock;
}

/**
 * Extends the critic prompt with an 8th analysis: OBJECTIVE COVERAGE ASSESSMENT.
 * Only added when objectives exist — assesses whether the graph structurally
 * supports each objective's causal path.
 */
export function buildObjectiveAwareCriticPrompt(
  objectives: Array<{ title: string; objective_type?: string; source_entity_id?: string | null; causal_chain?: string[] }>,
): string {
  if (objectives.length === 0) return CRITIC_SYSTEM_PROMPT;

  const objectiveBlock = objectives
    .map((o) => {
      const chain = "causal_chain" in o && o.causal_chain
        ? ` chain=[${o.causal_chain.join("→")}]`
        : "";
      const source = "source_entity_id" in o && o.source_entity_id
        ? ` source=${o.source_entity_id}`
        : "";
      return `- [${(o.objective_type ?? "maximize").toUpperCase()}] "${o.title}"${source}${chain}`;
    })
    .join("\n");

  // Insert the 8th analysis before the JSON output specification
  const additionalAnalysis = `

8. OBJECTIVE COVERAGE ASSESSMENT
The user has the following stated objectives:
${objectiveBlock}

For each objective, assess whether the current graph structure provides sufficient CAUSAL COVERAGE:
- Can you trace a complete causal path from controllable entities (those with directly_controllable edges) to the objective's target entity or metric?
- Are there gaps in the chain where entities are missing or weakly connected (< 2 edges)?
- Are there confounding factors (entities that could derail the objective) that aren't represented in the graph?

For each objective, report:
- coverage: "full" (complete traceable path), "partial" (path exists but has weak links), or "missing" (no clear causal path)
- critical_gaps: what's missing from the causal chain
- confounders: unrepresented factors that could affect the objective
- suggested_entities: entity names that should be added to strengthen coverage`;

  // Insert before the JSON output and add to schema
  const jsonSchemaAddition = `,
  "objective_coverage": [
    {"objective_title": "string", "coverage": "full | partial | missing", "critical_gaps": ["string"], "confounders": ["string"], "suggested_entities": ["string"]}
  ]`;

  // Replace the closing of the JSON schema to include the new field
  return CRITIC_SYSTEM_PROMPT
    .replace(
      `Report all edges that fail these checks with the specific rule violated and a suggested correction.`,
      `Report all edges that fail these checks with the specific rule violated and a suggested correction.${additionalAnalysis}`,
    )
    .replace(
      `"overall_quality": {
    "score": "good | adequate | insufficient",
    "summary": "string"
  }
}`,
      `"overall_quality": {
    "score": "good | adequate | insufficient",
    "summary": "string"
  }${jsonSchemaAddition}
}`,
    );
}
