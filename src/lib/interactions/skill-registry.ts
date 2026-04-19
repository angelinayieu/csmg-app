/**
 * Skill Registry — Layer 16 (Evolution)
 *
 * Formalizes all reasoning operations as self-describing, chainable skills.
 * Each skill declares its inputs, outputs, dependencies, and cost profile.
 * This enables:
 *   1. Automatic pipeline composition (given available data, which skills can run?)
 *   2. Cost estimation before execution
 *   3. Dependency resolution (run skills in correct order)
 *   4. Future: user-facing "reasoning toolkit" UI
 */

import type { SkillDescriptor, SkillResult } from "@/types/interactions";

// ── Skill descriptors ──

const SKILL_DEFINITIONS: SkillDescriptor[] = [
  {
    id: "scope",
    name: "Domain Scoping",
    description: "Discovers analytical domains within user input, producing orthogonal spaces that create productive tension between perspectives.",
    inputs: ["user_text", "user_intent"],
    outputs: ["space_configs", "summary", "detected_context"],
    depends_on: [],
    cost: "moderate",
    requires_llm: true,
  },
  {
    id: "decompose",
    name: "Entity-Edge Decomposition",
    description: "Extracts entities, edges, cycles, leverage/risk points from text using a 2-pass reasoning-then-structuring approach. 6-tier depth from surface parse to cross-domain.",
    inputs: ["user_text", "space_config", "sibling_context", "reasoning_depth"],
    outputs: ["entities", "edges", "cycles", "leverage_points", "risk_points", "master_bottleneck", "open_questions"],
    depends_on: ["scope"],
    cost: "heavy",
    requires_llm: true,
  },
  {
    id: "critique",
    name: "Structural Critique",
    description: "7-point structural validation: orphan analysis, centrality audit, cycle detection, edge prediction, density assessment, relationship validation, dynamics-cycle consistency.",
    inputs: ["entities", "edges", "cycles"],
    outputs: ["predicted_edges", "missed_cycles", "centrality_corrections", "relationship_violations"],
    depends_on: ["decompose"],
    cost: "heavy",
    requires_llm: true,
  },
  {
    id: "research",
    name: "Domain Expert Research",
    description: "Enriches the knowledge graph with external knowledge via domain expert reasoning and optional web search. Produces external entities, potential bridges, and cross-context insights.",
    inputs: ["entities", "space_configs", "input_summary", "research_depth"],
    outputs: ["external_entities", "external_edges", "potential_bridges", "cross_context_insights"],
    depends_on: ["decompose"],
    cost: "heavy",
    requires_llm: true,
  },
  {
    id: "interaction_fields",
    name: "Interaction Field Computation",
    description: "Pure graph computation: per-entity influence fields, strategic corridors, field intersections, and tension zones. Accounts for edge strength, polarity, dynamics, and cycle amplification.",
    inputs: ["entities", "edges", "cycles"],
    outputs: ["interaction_fields", "strategic_corridors", "field_intersections", "tension_zones"],
    depends_on: ["critique"],
    cost: "light",
    requires_llm: false,
  },
  {
    id: "weave",
    name: "Cross-Space Weaving",
    description: "Discovers bridges between analytical spaces, creating cross-domain connections that reveal hidden dependencies and opportunities.",
    inputs: ["space_ids"],
    outputs: ["bridges", "cross_space_edges"],
    depends_on: ["research"],
    cost: "moderate",
    requires_llm: true,
  },
  {
    id: "synthesize",
    name: "Strategic Synthesis",
    description: "Generates domain-expert-level strategic insights from the complete enriched graph. Produces leverage analysis, risk assessment, feedback loops, scenarios, action plans, and sequencing rationale.",
    inputs: ["entities", "edges", "cycles", "interaction_metadata", "research_metadata", "user_intent", "active_goal"],
    outputs: ["synthesis_data"],
    depends_on: ["critique", "interaction_fields", "research"],
    cost: "heavy",
    requires_llm: true,
  },
  {
    id: "coherence_check",
    name: "Semantic Coherence Check",
    description: "Programmatic post-synthesis validation. Cross-references synthesis entity_id references against actual entity data. 8 checks including orphaned references, flag consistency, bottleneck alignment.",
    inputs: ["synthesis_data", "entity_ids", "leverage_ids", "risk_ids", "bottleneck_id"],
    outputs: ["coherence_score", "coherence_issues"],
    depends_on: ["synthesize"],
    cost: "trivial",
    requires_llm: false,
  },
  {
    id: "change_detection",
    name: "Change Detection",
    description: "Compares old vs new synthesis to detect what shifted: leverage/risk changes, bottleneck moves, loop additions, question resolution. Computes health score delta and overall magnitude.",
    inputs: ["old_synthesis", "new_synthesis", "entities", "edges", "cycles"],
    outputs: ["change_detection"],
    depends_on: ["synthesize"],
    cost: "trivial",
    requires_llm: false,
  },
  {
    id: "twin_state",
    name: "Digital Twin State",
    description: "Computes the Digital Twin macro state: health score (0-100), coverage metrics, risk exposure, dynamics profile. Per-entity health contributions for drill-down.",
    inputs: ["space", "entities", "edges", "cycles", "synthesis_data"],
    outputs: ["twin_state", "entity_health_contributions"],
    depends_on: ["synthesize"],
    cost: "trivial",
    requires_llm: false,
  },
  {
    id: "reasoning_centrality",
    name: "Centrality Analysis",
    description: "Graph-theoretic centrality computation: degree, betweenness, eigenvector centrality for all entities.",
    inputs: ["entities", "edges"],
    outputs: ["centrality_rankings"],
    depends_on: ["critique"],
    cost: "light",
    requires_llm: false,
  },
  {
    id: "reasoning_cascade",
    name: "Cascade Modeling",
    description: "Simulates what happens when a specific entity changes: propagation through edges, cycle amplification, blast radius computation.",
    inputs: ["entities", "edges", "cycles", "target_entity_id"],
    outputs: ["cascade_result"],
    depends_on: ["critique"],
    cost: "moderate",
    requires_llm: true,
  },
  {
    id: "goal_recommendations",
    name: "Goal-Aligned Recommendations",
    description: "Ranks synthesis findings by relevance to the active improvement goal. Produces prioritized recommendations with impact estimates.",
    inputs: ["active_goal", "synthesis_data"],
    outputs: ["ranked_recommendations"],
    depends_on: ["synthesize"],
    cost: "moderate",
    requires_llm: true,
  },
  {
    id: "objective_detection",
    name: "Objective Auto-Detection",
    description: "Analyzes synthesis findings to suggest measurable improvement goals when none are set. Identifies what the user should be optimizing for.",
    inputs: ["synthesis_data"],
    outputs: ["suggested_objectives"],
    depends_on: ["synthesize"],
    cost: "moderate",
    requires_llm: true,
  },
];

// ── Registry API ──

class SkillRegistry {
  private skills: Map<string, SkillDescriptor>;

  constructor(definitions: SkillDescriptor[]) {
    this.skills = new Map(definitions.map((d) => [d.id, d]));
  }

  /** Get a skill by ID */
  get(id: string): SkillDescriptor | undefined {
    return this.skills.get(id);
  }

  /** Get all registered skills */
  all(): SkillDescriptor[] {
    return Array.from(this.skills.values());
  }

  /** Given available outputs, which skills can now run? */
  runnableWith(availableOutputs: Set<string>): SkillDescriptor[] {
    return this.all().filter((skill) =>
      skill.inputs.every((input) => availableOutputs.has(input))
    );
  }

  /** Topological sort: execution order respecting dependencies */
  executionOrder(targetSkillIds: string[]): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const skill = this.skills.get(id);
      if (!skill) return;
      for (const dep of skill.depends_on) visit(dep);
      order.push(id);
    };

    for (const id of targetSkillIds) visit(id);
    return order;
  }

  /** Estimate total cost for a set of skills */
  estimateCost(skillIds: string[]): { llm_calls: number; compute_only: number } {
    let llm = 0;
    let compute = 0;
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (!skill) continue;
      if (skill.requires_llm) llm++;
      else compute++;
    }
    return { llm_calls: llm, compute_only: compute };
  }

  /** Get the dependency graph as adjacency list (for visualization) */
  dependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const skill of this.skills.values()) {
      graph.set(skill.id, skill.depends_on);
    }
    return graph;
  }
}

/** Singleton registry instance */
export const skillRegistry = new SkillRegistry(SKILL_DEFINITIONS);

/** Helper: wrap a computation as a SkillResult */
export async function executeSkill<T>(
  skillId: string,
  fn: () => T | Promise<T>
): Promise<SkillResult<T>> {
  const start = performance.now();
  try {
    const data = await fn();
    return {
      skill_id: skillId,
      success: true,
      data,
      duration_ms: Math.round(performance.now() - start),
    };
  } catch (err) {
    return {
      skill_id: skillId,
      success: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Math.round(performance.now() - start),
    };
  }
}
