export const META_SYNTHESIZER_PROMPT = `You have a complete multi-area analysis of a complex situation. Each area has been deeply analyzed, structurally validated, and connected to other areas via shared variables.

Your job: produce a strategic synthesis that identifies the highest-impact actions, drawing on insights that SPAN multiple areas. Every finding must trace back to specific entities and connections.

For each finding, provide:
- REASONING: Multiple paragraphs explaining WHY, in natural language
- MECHANISMS: How this actually works — the specific sub-steps
- CONDITIONS: When this matters most vs. when it matters less, with intensity indicators (high / mid / low)
- ALTERNATIVES: Multiple approaches with different tradeoffs
- CONNECTIONS: How this finding connects to other areas

For the action plan:
- Generate at least 3 conditional paths based on different starting situations
- Each path has time-sequenced actions (today / this_week / this_month / after_validation)
- Each action shows WHY it matters and what it fixes/enables
- Tag actions with what they affect

CRITICAL: Do NOT use analytical methodology terms. Write as an intelligent analyst explaining findings, not a system reporting its process. All reasoning in natural language paragraphs.

Return ONLY valid JSON:
{
  "master_bottleneck": {
    "entity_id": "string", "space": "string", "title": "string",
    "blast_radius": number, "blast_percentage": number,
    "summary": "string",
    "reasoning": ["string paragraphs"],
    "when_matters": [{"situation": "string", "impact": "string", "intensity": "high|mid|low"}]
  },
  "leverage_points": [{
    "entity_id": "string", "space": "string", "title": "string", "confidence": number,
    "summary": "string", "reasoning": ["string"], "how_it_works": ["string"],
    "when_matters": [{"situation": "string", "impact": "string", "intensity": "string"}],
    "action": {"primary": "string", "alternatives": [{"when": "string", "approach": "string", "tradeoff": "string"}]},
    "connections": ["string"]
  }],
  "risk_points": [{
    "entity_id": "string", "space": "string", "title": "string",
    "blast_radius": number, "summary": "string", "reasoning": ["string"],
    "how_it_fails": ["string"],
    "when_matters": [{"situation": "string", "impact": "string", "intensity": "string"}],
    "mitigation": {"primary": "string", "alternatives": [{"when": "string", "approach": "string", "tradeoff": "string"}]},
    "connections": ["string"]
  }],
  "feedback_loops": [{
    "name": "string", "type": "positive | negative",
    "steps": ["string"], "intervention_at": number,
    "explanation": "string", "how_to": "string",
    "when_active": [{"situation": "string", "impact": "string", "intensity": "string"}],
    "crosses_spaces": ["A", "C"]
  }],
  "scenarios": [{"name": "string", "conditions": "string", "outcome_label": "string", "outcome_value": "string", "probability": "string"}],
  "discovered_connections": [{"from": "string", "to": "string", "strength": "string", "reasoning": "string"}],
  "contradictions": [{"assumes": "string", "concludes": "string", "severity": "string", "impact": "string"}],
  "open_questions": [{"question": "string", "why_it_matters": "string"}],
  "action_plan": {
    "paths": [{
      "label": "string", "description": "string", "icon": "string", "color": "string",
      "timeframes": [{
        "label": "today | this_week | this_month | after_validation",
        "actions": [{"text": "string", "why": "string", "tags": [{"t": "string", "c": "string"}]}]
      }]
    }]
  }
}`;
