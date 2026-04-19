/**
 * Interweave Analyst Prompt
 *
 * Analyzes graph topology after research to identify structural gaps:
 * - Disconnected clusters that should be connected
 * - Under-connected nodes (degree < 2)
 * - Entities that should be further decomposed
 * - Missing edges (connection hypotheses with validation queries)
 *
 * This agent does NOT discover new knowledge — other agents do that.
 * It looks at what exists and says "these things SHOULD be connected but aren't."
 */

export interface InterweaveAnalysis {
  /** Groups of entities that form isolated components and need bridges */
  disconnected_clusters: Array<{
    cluster_entities: string[];
    bridge_targets: string[];
    reasoning: string;
  }>;
  /** External entities that are too broad/vague and should be broken into sub-topics */
  decomposition_requests: Array<{
    entity_id: string;
    entity_name: string;
    sub_topics: string[];
    reasoning: string;
  }>;
  /** Specific edges that SHOULD exist — each with a validation query */
  connection_hypotheses: Array<{
    source_entity_id: string;
    target_entity_id: string;
    hypothesized_relationship: string;
    dimension: string;
    strength_estimate: number;
    validation_query: string;
    reasoning: string;
  }>;
  /** Targeted web searches to fill remaining gaps */
  further_research_queries: Array<{
    query: string;
    targets: string[];
    expected_output: string;
    priority: "critical" | "high" | "medium";
  }>;
  /** 0-100 health score: % entities with degree >= 2, component connectivity, bridge ratio */
  connectivity_score: number;
  /** Whether another iteration would meaningfully improve connectivity */
  should_continue: boolean;
  /** If should_continue is false, why */
  termination_reason?: string;
}

export interface InterweavePromptInput {
  internalEntities: Array<{
    entity_id: string;
    name: string;
    description: string;
    degree: number;
    knowledge_layer: string;
  }>;
  externalEntities: Array<{
    entity_id: string;
    name: string;
    description: string;
    degree: number;
    knowledge_layer: string;
    category?: string;
  }>;
  bridgeEntities: Array<{
    entity_id: string;
    name: string;
    description: string;
    degree: number;
    knowledge_layer: string;
  }>;
  edges: Array<{
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    dimension: string;
    knowledge_layer: string;
    strength: number;
  }>;
  metrics: {
    node_count: number;
    edge_count: number;
    density: number;
    avg_degree: number;
    max_degree: number;
    component_count: number;
  };
  components: Array<{
    component_id: number;
    entity_ids: string[];
    size: number;
  }>;
  iteration: number;
  maxIterations: number;
  priorIterationState?: {
    iteration: number;
    connectivity_score: number;
    hypotheses_validated: number;
    hypotheses_refuted: number;
    decompositions_performed: number;
  } | null;
}

const SYSTEM_PROMPT = `You are a knowledge graph topology analyst. Your job is NOT to discover new knowledge — other agents already did that. Your job is to identify STRUCTURAL GAPS in an existing knowledge graph where connections SHOULD exist but are MISSING.

You are given a graph with three layers:
- INTERNAL entities (the user's situation — these are anchors)
- EXTERNAL entities (landscape knowledge discovered by research — these should connect to anchors)
- BRIDGE entities (connections between layers — we want MORE of these)

YOUR CORE TASK: Make the graph well-connected. Every external entity should connect back to the user's situation. Disconnected facts are useless.

ANALYSIS STEPS:

1. COMPONENT ANALYSIS
Identify disconnected components. If there are 2+ components, propose specific bridge edges between them. Two clusters about related topics (e.g., "market competition" and "pricing strategy") obviously SHOULD be connected — find the conceptual bridge.

2. UNDER-CONNECTED NODES
External entities with degree < 2 are floating facts — they add noise, not insight. For each under-connected external entity:
- Hypothesize at least 1 connection to an INTERNAL entity (how does this external fact affect the user's situation?)
- Hypothesize at least 1 connection to another EXTERNAL entity (how does this fact relate to other landscape knowledge?)
- Provide a specific validation query (a web search that would confirm/refute the connection)

3. DECOMPOSITION CANDIDATES
External entities with vague/broad descriptions should be decomposed. Indicators:
- Name contains broad terms like "market dynamics", "competitive landscape", "industry trends"
- Description is generic rather than specific
- The entity covers multiple sub-topics that would each be their own node
Propose 2-4 specific sub-topics for each candidate.

4. CONNECTION HYPOTHESES
For each hypothesized edge, provide:
- source_entity_id and target_entity_id (use EXACT entity IDs from the lists provided)
- hypothesized_relationship: a specific verb phrase (e.g., "constrains pricing of", "validates approach to")
- dimension: one of structural|functional|temporal|causal|correlational|logical|epistemic|comparative|agentive
- strength_estimate: 0.3-0.9 (how confident are you this connection exists?)
- validation_query: a specific web search query that would confirm or refute this connection
- reasoning: 1-2 sentences explaining WHY this connection should exist

5. TARGETED RESEARCH QUERIES
If the graph has gaps that can't be filled by hypothesizing connections (the knowledge simply doesn't exist in the graph yet), propose targeted research queries. Prioritize:
- CRITICAL: connections between internal entities and external entities that are clearly related but have no bridge
- HIGH: decomposition of broad entities into specific sub-topics
- MEDIUM: additional landscape coverage for under-represented areas

6. CONNECTIVITY SCORE (0-100)
Compute based on:
- % of entities with degree >= 2 (weight: 40%)
- Whether all components are reachable from each other (weight: 30%)
- Bridge edge ratio: bridge_edges / total_external_entities (weight: 20%)
- Average degree normalized to target of 3+ (weight: 10%)

7. TERMINATION DECISION
Set should_continue=false when ANY of:
- connectivity_score > 70
- All components are reachable from each other (component_count <= 2)
- Every entity has degree >= 2
- You have no new hypotheses to propose (everything is already connected)
- You're on the last iteration

OUTPUT FORMAT: Return a JSON object matching the InterweaveAnalysis schema. Use EXACT entity IDs from the input lists.`;

export function buildInterweavePrompt(input: InterweavePromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const {
    internalEntities,
    externalEntities,
    bridgeEntities,
    edges,
    metrics,
    components,
    iteration,
    maxIterations,
    priorIterationState,
  } = input;

  // Format entity lists compactly
  const internalLines = internalEntities
    .map((e) => `  ${e.entity_id} | "${e.name}" | degree=${e.degree} | ${e.description.slice(0, 120)}`)
    .join("\n");

  const externalLines = externalEntities
    .map(
      (e) =>
        `  ${e.entity_id} | "${e.name}" | degree=${e.degree} | cat=${e.category ?? "?"} | ${e.description.slice(0, 120)}`
    )
    .join("\n");

  const bridgeLines = bridgeEntities.length > 0
    ? bridgeEntities
        .map((e) => `  ${e.entity_id} | "${e.name}" | degree=${e.degree}`)
        .join("\n")
    : "  (none)";

  // Format edges compactly — use entity_id not UUID
  const edgeLines = edges
    .map(
      (e) =>
        `  ${e.source_entity_id} → ${e.target_entity_id} | ${e.relationship_type} | ${e.dimension} | layer=${e.knowledge_layer} | str=${e.strength}`
    )
    .join("\n");

  // Find orphan entities (degree 0)
  const orphans = [...internalEntities, ...externalEntities, ...bridgeEntities]
    .filter((e) => e.degree === 0)
    .map((e) => `${e.entity_id} ("${e.name}")`)
    .join(", ");

  // Find under-connected entities (degree 1)
  const underConnected = [...internalEntities, ...externalEntities, ...bridgeEntities]
    .filter((e) => e.degree === 1)
    .map((e) => `${e.entity_id} ("${e.name}")`)
    .join(", ");

  // Component breakdown
  const componentLines = components
    .map((c) => `  Component ${c.component_id}: ${c.size} entities — [${c.entity_ids.join(", ")}]`)
    .join("\n");

  // Prior iteration context
  let priorSection = "";
  if (priorIterationState) {
    priorSection = `
PRIOR ITERATION RESULTS (iteration ${priorIterationState.iteration}):
- Connectivity score was: ${priorIterationState.connectivity_score}/100
- Hypotheses validated: ${priorIterationState.hypotheses_validated}
- Hypotheses refuted: ${priorIterationState.hypotheses_refuted}
- Decompositions performed: ${priorIterationState.decompositions_performed}
Focus on what STILL needs connecting — avoid re-proposing connections that were already validated or refuted.`;
  }

  const userPrompt = `GRAPH STATE (Iteration ${iteration}/${maxIterations}):

INTERNAL ENTITIES (anchors — the user's situation):
${internalLines || "  (none)"}

EXTERNAL ENTITIES (landscape — discovered by research):
${externalLines || "  (none)"}

BRIDGE ENTITIES:
${bridgeLines}

ALL EDGES (${edges.length} total):
${edgeLines || "  (none)"}

GRAPH METRICS:
- Nodes: ${metrics.node_count}
- Edges: ${metrics.edge_count}
- Components: ${metrics.component_count} (target: 1-2)
- Density: ${metrics.density}
- Average degree: ${metrics.avg_degree} (target: 3+)
- Max degree: ${metrics.max_degree}

CONNECTED COMPONENTS:
${componentLines || "  Single component (all connected)"}

ORPHAN ENTITIES (degree 0): ${orphans || "(none)"}
UNDER-CONNECTED (degree 1): ${underConnected || "(none)"}
${priorSection}

Analyze the topology and produce your InterweaveAnalysis JSON.`;

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  };
}
