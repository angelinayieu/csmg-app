export const STRUCTURING_SYSTEM_PROMPT = `You are a parser. Convert the analysis below into a JSON object matching this exact schema. Return ONLY valid JSON with no markdown fencing, no explanation, no preamble.

Schema:
{
  "metadata": {
    "name": "string — a concise name for this analysis space (3-8 words)",
    "description": "string — one sentence describing the space",
    "space_prefix": "string — single uppercase letter (A, B, C, etc.)",
    "entity_count": number,
    "edge_count": number,
    "orphan_count": number,
    "cycle_count": number,
    "maturity": "actionable_now | waiting_on_dependency | theoretical | blocked",
    "activation_dependencies": ["string — what must be true before this is actionable"],
    "synthesis_text": "string — the full synthesis section text"
  },
  "entities": [
    {
      "entity_id": "C1",
      "name": "string",
      "description": "string — one sentence",
      "source_tag": "explicit | implicit | assumed",
      "entity_type": "string — e.g. capability, constraint, product, person, metric",
      "entity_category": "concrete | abstract | process | relational | epistemic",
      "layer": "string — e.g. core_entities, capabilities, constraints, dynamics, epistemic",
      "importance": "fundamental | critical | important | moderate",
      "confidence": 0.0-1.0,
      "is_leverage_point": boolean,
      "is_risk_point": boolean,
      "is_master_bottleneck": boolean,
      "blast_radius": number,
      "centrality_rank": number or null,
      "is_shared_variable": boolean,
      "is_decomposable": boolean
    }
  ],
  "edges": [
    {
      "source_entity_id": "C1",
      "target_entity_id": "C5",
      "relationship_type": "enables",
      "dimension": "structural | functional | temporal | causal | correlational | logical | epistemic | comparative | agentive",
      "source_tag": "stated | inferred | predicted",
      "strength": 0.0-1.0,
      "polarity": "positive | negative | neutral | conditional",
      "confidence": 0.0-1.0,
      "conditions": "string or null",
      "is_tradeoff": boolean,
      "resolved_by_entity_id": "string or null",
      "is_part_of_cycle": boolean,
      "cycle_id": "string or null"
    }
  ],
  "cycles": [
    {
      "cycle_id": "cycle_1",
      "name": "string — descriptive name",
      "classification": "reinforcing_positive | reinforcing_negative | balancing",
      "entity_ids": ["C1", "C5", "C8"],
      "intervention_point": "C5",
      "intervention_description": "string — what to do at the intervention point",
      "description": "string",
      "reasoning": "string — what drives this loop and why it matters",
      "when_active": [
        {
          "situation": "string — when this loop activates",
          "impact": "string — what happens",
          "intensity": "high | mid | low"
        }
      ]
    }
  ],
  "propositions": [
    {
      "proposition_id": "P1",
      "statement": "string",
      "proposition_type": "certain | probable | possible | speculative | irreducible",
      "confidence": 0.0-1.0,
      "depends_on": ["P2", "P3"],
      "entity_ids": ["C1", "C5"]
    }
  ],
  "novel_connections": [
    {
      "source_entity_id": "C5",
      "target_entity_id": "C22",
      "relationship_type": "enables",
      "strength": "strong | moderate | speculative",
      "reasoning": "string — why this connection exists"
    }
  ],
  "contradictions": [
    {
      "assumption_text": "string",
      "conclusion_text": "string",
      "severity": "critical | moderate | minor",
      "description": "string — impact and implication"
    }
  ],
  "scenarios": [
    {
      "name": "string",
      "conditions": "string",
      "outcome_label": "string",
      "outcome_value": "string",
      "probability": "likely | possible | unlikely"
    }
  ],
  "action_items": [
    {
      "timeframe": "today | this_week | this_month | after_validation",
      "path_label": "builder | team | pivot",
      "action_text": "string — specific action to take",
      "why_text": "string — reasoning for why this action matters",
      "derived_from_entity_id": "string or null",
      "tags": [{"t": "string — tag label like 'fixes bottleneck' or 'starts flywheel'", "c": "string — hex color like '#FF3B30' or '#34C759'"}]
    }
  ],
  "leverage_points": [
    {
      "entity_id": "C5",
      "summary": "string — 1-2 sentence overview of why this is high-leverage",
      "reasoning": ["string — paragraph 1 explaining the deep logic", "string — paragraph 2 with more context", "string — paragraph 3 if needed"],
      "how_it_works": ["string — mechanism 1", "string — mechanism 2", "string — mechanism 3"],
      "when_matters": [
        {"situation": "string", "impact": "string", "intensity": "high | mid | low"},
        {"situation": "string", "impact": "string", "intensity": "high | mid | low"}
      ],
      "action": {
        "primary": "string — the recommended next step",
        "alternatives": [
          {"when": "string — situation this applies", "approach": "string — what to do", "tradeoff": "string — cost or downside"}
        ]
      },
      "connections": ["string — how this connects to other parts of the system"]
    }
  ],
  "risk_points": [
    {
      "entity_id": "C8",
      "blast_radius": 14,
      "summary": "string — 1-2 sentence overview of the risk",
      "reasoning": ["string — paragraph explaining why this is dangerous"],
      "how_it_fails": ["string — failure mechanism 1", "string — mechanism 2"],
      "when_matters": [
        {"situation": "string", "impact": "string", "intensity": "high | mid | low"}
      ],
      "mitigation": {
        "primary": "string — recommended protection",
        "alternatives": [
          {"when": "string", "approach": "string", "tradeoff": "string"}
        ]
      },
      "connections": ["string — downstream impacts"]
    }
  ],
  "master_bottleneck": {
    "entity_id": "C1",
    "blast_radius": 18,
    "summary": "string — why this is the highest-impact constraint",
    "reasoning": ["string — detailed paragraph 1", "string — paragraph 2", "string — paragraph 3"],
    "when_matters": [
      {"situation": "string", "impact": "string", "intensity": "high | mid | low"}
    ]
  },
  "shared_variables": [
    {
      "entity_id": "C5",
      "shared_variable_name": "output quality",
      "potential_bridge_spaces": ["string"]
    }
  ]
}

CRITICAL RULES:
- Return ONLY the JSON object. No markdown code fences, no explanation, no preamble.
- Every entity referenced in edges must exist in the entities array.
- Use entity_id values (C1, C2, etc.) consistently across all arrays.
- Ensure all enum values match exactly (e.g., "concrete" not "Concrete").
- Mark exactly one entity as is_master_bottleneck: true (highest blast_radius + centrality).
- Mark edges that represent tradeoffs with is_tradeoff: true.

LEVERAGE POINTS / RISK POINTS — DEPTH REQUIREMENTS:
- Each leverage point MUST have 2-4 "reasoning" paragraphs explaining WHY in depth.
- Each MUST have 2-4 "how_it_works" numbered mechanisms.
- Each MUST have 2-3 "when_matters" scenarios with intensity levels.
- Each MUST have a primary action AND 1-3 alternatives with tradeoffs.
- Each MUST have 1-3 connections showing how it links to other areas.
- Same depth requirements apply to risk_points (use "how_it_fails" for mechanisms).
- Master bottleneck MUST have 2-3 reasoning paragraphs and 2-3 when_matters scenarios.

ACTION ITEMS — CONDITIONAL PATHS:
- Generate action items for THREE paths: "builder" (solo execution), "team" (with collaborators), "pivot" (if current approach fails).
- Each action MUST have why_text explaining the reasoning.
- Each action SHOULD have 1-2 tags with hex colors: red=#FF3B30 (fixes problems), green=#34C759 (positive outcomes), blue=#007AFF (leverage), amber=#FF9500 (growth), purple=#AF52DE (strategic).
- Prioritize: leverage-derived actions first, then risk mitigations, then cycle interventions.

CYCLES — DEPTH:
- Each cycle MUST have a "reasoning" string explaining what drives the loop.
- Each cycle MUST have 2-3 "when_active" scenarios with intensity levels.

If information for a field is truly absent from the analysis, provide reasonable inferences. The goal is rich, actionable output.`;
