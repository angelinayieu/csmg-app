import type { ContextType } from "@/types/execution-brief";

/**
 * Generate system + user prompt pair for producing an ExecutionBrief.
 *
 * The LLM output should be valid JSON matching the ExecutionBrief structure
 * minus `recommendation_id`, `generated_at`, and `test_lab` (set client-side
 * or via a separate call).
 */
export function getExecutionBriefPrompt(params: {
  recommendationTitle: string;
  recommendationText: string;
  relatedEntities: Array<{
    name: string;
    entity_id: string;
    type?: string;
    is_leverage?: boolean;
    is_risk?: boolean;
  }>;
  relatedEdges: Array<{
    source_name: string;
    target_name: string;
    relationship_type: string;
    reasoning?: string;
  }>;
  synthesisContext?: string;
  contextDetection?: {
    context_type: ContextType;
    detected_reference: string;
    current_state: string;
  };
  userIntent?: string;
}): { system: string; user: string } {
  const {
    recommendationTitle,
    recommendationText,
    relatedEntities,
    relatedEdges,
    synthesisContext,
    contextDetection,
    userIntent,
  } = params;

  // ── System prompt ──

  const system = `You are a domain-specific execution planner. You receive a recommendation from a strategic analysis along with the entities and relationships backing it. Your job is to produce a concrete execution brief: what evidence supports this, what alternatives exist, and exactly how to execute it step by step.

Rules:
- Reference entities by their ACTUAL NAME from the data. Never say "the key entity" — say "Content Quality" or "User Retention Loop" or whatever the name is.
- Never use generic strategy jargon: no "leverage synergies," "holistic approach," "strategic alignment," "optimize workflows." Every sentence must be specific to THIS situation.
- Evidence sources must trace back to specific entities or edges in the provided data. Do not invent evidence.
- Alternative approaches must have genuine tradeoffs — not "slightly worse version of the main approach." Each alternative should make a different bet about what matters most.
- Execution steps must be concrete enough that someone could start working on step 1 today. Include infrastructure notes when the system itself could automate or set up part of the step.
- When context_detection data is provided, incorporate it: explain what currently exists and what specifically would change.

Return ONLY valid JSON. No markdown fencing, no explanation outside the JSON.`;

  // ── User prompt ──

  // Format entities
  const entityBlock =
    relatedEntities.length > 0
      ? relatedEntities
          .map((e) => {
            const tags: string[] = [];
            if (e.is_leverage) tags.push("LEVERAGE");
            if (e.is_risk) tags.push("RISK");
            if (e.type) tags.push(e.type);
            const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
            return `  - ${e.entity_id}: ${e.name}${tagStr}`;
          })
          .join("\n")
      : "  (none provided)";

  // Format edges
  const edgeBlock =
    relatedEdges.length > 0
      ? relatedEdges
          .map((e) => {
            const reasoning = e.reasoning ? ` — ${e.reasoning}` : "";
            return `  - ${e.source_name} → ${e.target_name} (${e.relationship_type})${reasoning}`;
          })
          .join("\n")
      : "  (none provided)";

  // Context detection block
  let contextBlock = "";
  if (contextDetection) {
    contextBlock = `

CONTEXT DETECTION (the recommendation references something the system already knows about):
  Type: ${contextDetection.context_type}
  Reference: ${contextDetection.detected_reference}
  Current state: ${contextDetection.current_state}
Include a "context_detection" field in your output that builds on this — explain what currently exists and what specifically would change. Include related_entity_ids from the entities above.`;
  }

  // Synthesis context block
  let synthesisBlock = "";
  if (synthesisContext) {
    synthesisBlock = `

SYNTHESIS CONTEXT (relevant excerpt from the broader analysis):
${synthesisContext}`;
  }

  // User intent block
  let intentBlock = "";
  if (userIntent) {
    intentBlock = `

USER INTENT: ${userIntent}`;
  }

  const user = `RECOMMENDATION TO EXPAND:
Title: ${recommendationTitle}
Text: ${recommendationText}

RELATED ENTITIES:
${entityBlock}

RELATED RELATIONSHIPS:
${edgeBlock}${contextBlock}${synthesisBlock}${intentBlock}

Produce a JSON execution brief with this structure:

{
  "recommendation_title": "${recommendationTitle}",
  "research_backing": {
    "evidence_sources": [
      {
        "type": "entity | edge | cycle | external | research | intersection",
        "reference_id": "string — entity_id or edge descriptor",
        "reference_name": "string — human-readable name",
        "description": "string — how this evidence supports the recommendation",
        "strength": "strong | moderate | weak"
      }
    ],
    "causal_chain": "string — 2-3 sentences explaining the cause-effect chain: why doing X leads to outcome Y, tracing through specific entities",
    "confidence": "high | moderate | low"
  },
  "alternative_approaches": [
    {
      "title": "string — name of the alternative",
      "description": "string — what this approach does differently and why someone might prefer it",
      "tradeoffs": [
        { "pro": "string — specific advantage", "con": "string — specific cost or risk" }
      ],
      "effort": "low | medium | high",
      "impact": "low | medium | high",
      "confidence": "high | moderate | low"
    }
  ],${contextDetection ? '\n  "context_detection": {\n    "context_type": "' + contextDetection.context_type + '",\n    "detected_reference": "string",\n    "current_state": "string",\n    "proposed_changes": "string",\n    "before_after": { "before": "string", "after": "string" },\n    "related_entity_ids": ["string"]\n  },' : ""}
  "execution_steps": [
    {
      "order": 1,
      "action": "string — imperative verb phrase: 'Map the current X', 'Build a Y', 'Test Z'",
      "detail": "string — 2-3 sentences on exactly how to do this, referencing specific entities",
      "entity_id": "string or omit — the entity this step acts on",
      "depends_on": [],
      "estimated_effort": "string — e.g. '2-3 hours', '1 week', '30 minutes'",
      "infrastructure_note": "string or omit — what the system could automate or pre-populate"
    }
  ]
}

REQUIREMENTS:
- evidence_sources: 2-5 items, each referencing a REAL entity or edge from the data above. Do not fabricate entities.
- alternative_approaches: 3-5 items with genuinely different strategies, not minor variations.
- execution_steps: 3-7 ordered steps. Step 1 must be startable immediately. Use depends_on to show which steps require prior steps (by order number). Include infrastructure_note when the analysis system could pre-populate data, run a sub-analysis, or set up tracking.
- Every string must be specific to the entities and relationships provided. No generic advice.`;

  return { system, user };
}
