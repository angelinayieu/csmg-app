export const REASONING_PROMPTS = {
  centrality: `You are analyzing a knowledge graph. Given the entities and edges below, rank the top 5 entities by approximate centrality — which entities appear in the most relationships and which, if removed, would break the most downstream chains.

Return ONLY valid JSON matching this schema:
{
  "rankings": [
    {
      "entity_id": "C5",
      "name": "string",
      "score": 0.0-1.0,
      "degree": number,
      "broken_paths": number,
      "explanation": "string — why this entity is central"
    }
  ]
}`,

  cycles: `You are analyzing a knowledge graph. Trace ALL feedback loops. For every constraining or enabling edge, follow the chain forward to see if it loops back to the origin.

Return ONLY valid JSON matching this schema:
{
  "cycles": [
    {
      "cycle_id": "cycle_1",
      "name": "string — descriptive name",
      "classification": "reinforcing_positive | reinforcing_negative | balancing",
      "entity_ids": ["C1", "C5", "C8"],
      "intervention_point": "C5",
      "intervention_description": "string — what to do at this point",
      "description": "string — what this cycle means"
    }
  ]
}`,

  cascade: (entityId: string) => `You are analyzing a knowledge graph. Simulate the failure of entity ${entityId}. Trace all downstream effects — which entities become unreachable, which bridges break, which capabilities are lost.

Return ONLY valid JSON matching this schema:
{
  "failed_entity": "${entityId}",
  "blast_radius": number,
  "affected_entities": [
    {
      "entity_id": "string",
      "name": "string",
      "distance": number,
      "impact": "string — how it's affected"
    }
  ],
  "broken_bridges": ["string — bridge descriptions"],
  "narrative": "string — overall impact summary"
}`,

  link_prediction: `You are analyzing a knowledge graph. For entity pairs that are NOT directly connected, predict plausible missing relationships that likely exist but weren't explicitly stated.

Return ONLY valid JSON matching this schema:
{
  "predictions": [
    {
      "source_id": "C1",
      "target_id": "C15",
      "relationship_type": "enables",
      "dimension": "functional",
      "confidence": 0.0-1.0,
      "reasoning": "string — why this connection likely exists"
    }
  ]
}`,

  path: (fromId: string, toId: string) => `You are analyzing a knowledge graph. Find the shortest meaningful path from entity ${fromId} to entity ${toId}. Explain what the path means — how does influence flow from source to target?

Return ONLY valid JSON matching this schema:
{
  "path": [
    { "entity_id": "string", "name": "string" }
  ],
  "edges": [
    { "relationship_type": "string", "dimension": "string" }
  ],
  "interpretation": "string — what this path means and how influence flows"
}`,
};

export type ReasoningOperation = keyof typeof REASONING_PROMPTS;
