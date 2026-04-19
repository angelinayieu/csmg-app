/**
 * Phase 7: Multi-Step Strategy Prompts
 *
 * Step 1: Diagnosis — structural analysis of the real problem
 * Step 2: Synthesis — generate strategic options with reasoning
 * Step 3: Verification — stress-test options against failure modes
 */

import type { SynthesisData } from "@/types/synthesis";
import type { GraphStructure } from "@/lib/pipeline/graph-structure";
import type { ProbabilitySpace, SpaceIntersection } from "@/types/probability-space";
import type { ImprovementGoal } from "@/types/goals";
import type { StrategicDiagnosis, StrategySynthesisResult } from "@/types/strategy-reasoning";
import type { StrategicRecommendation } from "@/types/strategy";

// ── Step 1: Diagnosis ──

export function getDiagnosisPrompt(params: {
  graphStructure: GraphStructure;
  probabilitySpaces: Array<{
    edge_label: string;
    total_probability: number;
    failure_points: Array<{ name: string; mode: string; probability: number; blast_radius: string }>;
    critical_path: string[];
  }>;
  intersections: Array<{
    label_a: string;
    label_b: string;
    shared_variables: string[];
    novelty: number;
    impact: number;
    innovation_potential: string;
    insight: string;
  }>;
  synthesis: SynthesisData;
  hiddenSignals: Array<{
    name: string;
    type: string;
    impact: number;
    description: string;
  }>;
  convergences?: Array<{
    depth: string;
    shared_element_name: string;
    converging_branches: number;
    structural_value: number;
    explanation: string;
  }>;
  entityCount: number;
  edgeCount: number;
}): { system: string; user: string } {

  const system = `You are a structural diagnostician. Your job is NOT to recommend strategy — it is to diagnose the REAL structural problem in this system.

You will receive:
1. GRAPH STRUCTURE — centrality rankings, bridge edges (single points of failure), connected components, density
2. PROBABILITY SPACES — sub-graphs showing how connections between entities actually work, with failure points and critical paths
3. PROBABILITY SPACE INTERSECTIONS — where different connection spaces share variables, creating novel opportunities
4. SYNTHESIS FINDINGS — leverage points, risk points, master bottleneck, feedback loops from prior analysis
5. HIDDEN SIGNALS — invisible variables discovered by domain research

Your task: Analyze ALL of this to produce a STRUCTURAL DIAGNOSIS. Not surface symptoms — the underlying structural dynamics causing the problem.

Key principles:
- Hub entities with high betweenness are information chokepoints — if they fail, communication breaks
- Bridge edges are single points of failure — the system is fragile at these connections
- Probability space failure points with high blast radius are systemic risks, not local issues
- Intersection opportunities are where cross-domain innovation is possible — these are the highest-leverage interventions
- Converging hidden signals point to an underlying dynamic the user hasn't modeled
- Isolated clusters represent disconnected capabilities that waste potential
- Convergence points where L4 (invariant) or L3 (logic) tiers bridge multiple categories are the highest structural leverage — acting here changes many downstream branches at once

Return ONLY valid JSON matching the StrategicDiagnosis schema.`;

  // Build user message with all data
  const parts: string[] = [];

  // Graph structure
  parts.push(`GRAPH STRUCTURE (${params.entityCount} entities, ${params.edgeCount} edges, density: ${params.graphStructure.metrics.density}):`);

  if (params.graphStructure.centrality_rankings.length > 0) {
    parts.push(`\nHUB ENTITIES (by centrality):`);
    for (const hub of params.graphStructure.centrality_rankings.slice(0, 7)) {
      parts.push(`  - ${hub.name} (${hub.entity_id}): degree=${hub.degree}, betweenness=${hub.betweenness}, in=${hub.in_degree}, out=${hub.out_degree}`);
    }
  }

  if (params.graphStructure.bridge_edges.length > 0) {
    parts.push(`\nBRIDGE EDGES (single points of failure — removing these disconnects the graph):`);
    for (const be of params.graphStructure.bridge_edges) {
      parts.push(`  - ${be.source_name} → ${be.target_name}`);
    }
  }

  if (params.graphStructure.components.length > 1) {
    parts.push(`\nDISCONNECTED CLUSTERS (${params.graphStructure.components.length} components):`);
    for (const comp of params.graphStructure.components) {
      parts.push(`  - Component ${comp.component_id}: ${comp.size} entities [${comp.entity_ids.slice(0, 5).join(", ")}${comp.size > 5 ? "..." : ""}]`);
    }
  }

  if (params.graphStructure.cycle_summary.length > 0) {
    parts.push(`\nFEEDBACK LOOPS (${params.graphStructure.cycle_summary.length}):`);
    for (const cycle of params.graphStructure.cycle_summary.slice(0, 5)) {
      parts.push(`  - ${cycle.name} (${cycle.type}, ${cycle.length} entities): [${cycle.entity_ids.join(" → ")}]`);
    }
  }

  // Probability spaces
  if (params.probabilitySpaces.length > 0) {
    parts.push(`\nPROBABILITY SPACES (${params.probabilitySpaces.length} connection sub-graphs analyzed):`);
    for (const space of params.probabilitySpaces.slice(0, 8)) {
      parts.push(`\n  ${space.edge_label} (overall probability: ${(space.total_probability * 100).toFixed(0)}%):`);
      parts.push(`    Critical path: ${space.critical_path.join(" → ")}`);
      if (space.failure_points.length > 0) {
        for (const fp of space.failure_points.slice(0, 3)) {
          parts.push(`    ⚠ Failure: ${fp.name} — ${fp.mode} (p=${fp.probability}, blast=${fp.blast_radius})`);
        }
      }
    }
  }

  // Intersections
  if (params.intersections.length > 0) {
    parts.push(`\nPROBABILITY SPACE INTERSECTIONS (${params.intersections.length} cross-domain connections):`);
    for (const inter of params.intersections.slice(0, 6)) {
      parts.push(`  - ${inter.label_a} ∩ ${inter.label_b}: shared=[${inter.shared_variables.join(", ")}], novelty=${inter.novelty.toFixed(2)}, innovation=${inter.innovation_potential}`);
      parts.push(`    Insight: ${inter.insight}`);
    }
  }

  // Synthesis findings
  parts.push(`\nSYNTHESIS FINDINGS:`);
  if (params.synthesis.master_bottleneck) {
    const mb = params.synthesis.master_bottleneck as unknown as Record<string, unknown>;
    parts.push(`  Master bottleneck: ${mb.entity_id ?? "unknown"} — ${mb.reasoning ?? mb.description ?? ""}`);
  }
  if (Array.isArray(params.synthesis.leverage_points)) {
    parts.push(`  Leverage points (${params.synthesis.leverage_points.length}):`);
    for (const lp of params.synthesis.leverage_points.slice(0, 5)) {
      const lpObj = lp as unknown as Record<string, unknown>;
      parts.push(`    - ${lpObj.entity_id}: ${lpObj.reasoning ?? lpObj.description ?? ""}`);
    }
  }
  if (Array.isArray(params.synthesis.risk_points)) {
    parts.push(`  Risk points (${params.synthesis.risk_points.length}):`);
    for (const rp of params.synthesis.risk_points.slice(0, 5)) {
      const rpObj = rp as unknown as Record<string, unknown>;
      parts.push(`    - ${rpObj.entity_id}: ${rpObj.reasoning ?? rpObj.description ?? ""}`);
    }
  }

  // Hidden signals
  if (params.hiddenSignals.length > 0) {
    parts.push(`\nHIDDEN SIGNALS (invisible variables from domain research):`);
    for (const hs of params.hiddenSignals.slice(0, 8)) {
      parts.push(`  - [Impact: ${hs.impact}/10] ${hs.name} (${hs.type}): ${hs.description}`);
    }
  }

  // Convergence points (cross-category leverage)
  if (params.convergences && params.convergences.length > 0) {
    parts.push(`\nCONVERGENCE POINTS (cross-category leverage where different domains share a common element \u2014 deeper tier = higher structural value):`);
    for (const c of params.convergences.slice(0, 6)) {
      parts.push(`  [${c.depth}] ${c.shared_element_name}: ${c.converging_branches} branches converge (structural value: ${(c.structural_value * 100).toFixed(0)}%)`);
      parts.push(`    \u2192 ${c.explanation}`);
    }
  }

  return { system, user: parts.join("\n") };
}


// ── Step 2: Synthesis ──

export function getSynthesisPrompt(params: {
  diagnosis: StrategicDiagnosis;
  synthesis: SynthesisData;
  intersections: Array<{
    label_a: string;
    label_b: string;
    shared_variables: string[];
    innovation_potential: string;
    insight: string;
  }>;
  goal?: ImprovementGoal | null;
  confirmedStrategy?: StrategicRecommendation | null;
}): { system: string; user: string } {

  const system = `You are a strategic architect. Given a structural diagnosis, your job is to design 2-3 strategic OPTIONS — not recommendations, but genuine alternatives the user must choose between.

Each option must:
1. DIRECTLY ADDRESS the core problem from the diagnosis (not symptoms)
2. Explain its CORE LOGIC — the causal chain: "We do X, which triggers Y, which produces Z"
3. State which GRAPH INSIGHT it leverages (hub entity, bridge edge, cycle, cluster connection)
4. State which INTERSECTION OPPORTUNITY it exploits (if any) — intersections are the highest-leverage moves
5. Explain what PROBABILITY SPACE DATA validates or challenges this option
6. Name the KEY TRADEOFF — what you sacrifice by choosing this
7. Include a REASONING TRACE — the step-by-step logic that led to this option

Also produce REJECTED OPTIONS — strategies you considered but discarded. For each, explain which failure mode from the diagnosis killed it. The user needs to see what was considered, not just what survived.

${params.confirmedStrategy ? `NOTE: A strategy is already confirmed ("${params.confirmedStrategy.title}"). Generate options that EVOLVE or CHALLENGE the confirmed strategy based on new diagnosis data.` : ""}

Return ONLY valid JSON matching the StrategySynthesisResult schema.`;

  const parts: string[] = [];

  // Inject diagnosis
  parts.push(`STRUCTURAL DIAGNOSIS:`);
  parts.push(`Core problem: ${params.diagnosis.core_problem_statement}`);
  parts.push(`Confidence: ${params.diagnosis.confidence}`);

  if (params.diagnosis.graph_insights.hub_entities.length > 0) {
    parts.push(`\nGraph hubs: ${params.diagnosis.graph_insights.hub_entities.map(h => `${h.name} (${h.why_critical})`).join("; ")}`);
  }
  if (params.diagnosis.graph_insights.bottleneck_edges.length > 0) {
    parts.push(`Bottleneck edges: ${params.diagnosis.graph_insights.bottleneck_edges.map(b => `${b.source}→${b.target}: ${b.constraint}`).join("; ")}`);
  }
  if (params.diagnosis.probability_insights.intersection_opportunities.length > 0) {
    parts.push(`\nIntersection opportunities:`);
    for (const opp of params.diagnosis.probability_insights.intersection_opportunities) {
      parts.push(`  - ${opp.shared_variable}: ${opp.insight} (${opp.innovation_potential})`);
    }
  }
  if (params.diagnosis.probability_insights.high_risk_failure_points.length > 0) {
    parts.push(`\nHigh-risk failure points:`);
    for (const fp of params.diagnosis.probability_insights.high_risk_failure_points) {
      parts.push(`  - ${fp.edge_label}: ${fp.failure_mode} (blast=${fp.blast_radius})`);
    }
  }
  if (params.diagnosis.signal_synthesis.blind_spots.length > 0) {
    parts.push(`\nBlind spots: ${params.diagnosis.signal_synthesis.blind_spots.join("; ")}`);
  }
  parts.push(`\nReasoning trace: ${params.diagnosis.reasoning_trace.join(" → ")}`);

  // Goal context
  if (params.goal) {
    parts.push(`\nACTIVE GOAL: "${params.goal.title}" — optimize ${(params.goal as unknown as Record<string, unknown>).target_metric ?? "unknown metric"}`);
  }

  // Intersections for exploitation
  if (params.intersections.length > 0) {
    parts.push(`\nAVAILABLE INTERSECTIONS TO LEVERAGE:`);
    for (const inter of params.intersections.slice(0, 6)) {
      parts.push(`  - ${inter.label_a} ∩ ${inter.label_b}: ${inter.insight} (${inter.innovation_potential})`);
    }
  }

  // Synthesis context (leverage points, feedback loops)
  if (Array.isArray(params.synthesis.feedback_loops) && params.synthesis.feedback_loops.length > 0) {
    parts.push(`\nFEEDBACK LOOPS available to activate:`);
    for (const fl of params.synthesis.feedback_loops.slice(0, 4)) {
      const flObj = fl as unknown as Record<string, unknown>;
      parts.push(`  - ${flObj.name ?? flObj.loop_name ?? "unnamed"}: ${flObj.description ?? ""}`);
    }
  }

  return { system, user: parts.join("\n") };
}


// ── Step 3: Verification ──

export function getVerificationPrompt(params: {
  synthesisResult: StrategySynthesisResult;
  diagnosis: StrategicDiagnosis;
  probabilitySpaces: Array<{
    edge_label: string;
    total_probability: number;
    failure_points: Array<{ name: string; mode: string; probability: number; blast_radius: string }>;
  }>;
}): { system: string; user: string } {

  const system = `You are a strategy stress-tester. Your job is to BREAK these strategies — find their failure modes, expose their assumptions, and check their internal coherence.

For EACH strategic option:
1. FAILURE MODE EXPOSURE: Match each option against probability space failure points. Which failure modes would hurt this strategy? What's the mitigation? What residual risk remains?
2. CRITICAL ASSUMPTIONS: What must be TRUE for this strategy to work? Assign probability (0-1) to each assumption. What happens if each assumption is wrong?
3. POLICY COHERENCE: Does this strategy's actions actually serve its stated logic? Or does it contradict itself?
4. VERIFIED CONFIDENCE: After stress-testing, what's your adjusted confidence? This may be LOWER or HIGHER than the option's self-estimated confidence.

Then produce a FINAL RANKING. The rank may differ from the synthesis step — verification can reorder options. For each rank change, explain why.

Be adversarial. Your job is to protect the user from overconfident strategies. A strategy that survives verification is worth executing.

Return ONLY valid JSON matching the StrategyVerification schema.`;

  const parts: string[] = [];

  // Options to verify
  parts.push(`STRATEGIC OPTIONS TO STRESS-TEST:`);
  for (let i = 0; i < params.synthesisResult.options.length; i++) {
    const opt = params.synthesisResult.options[i];
    parts.push(`\n--- Option ${i + 1}: "${opt.title}" ---`);
    parts.push(`Posture: ${opt.strategic_posture}`);
    parts.push(`Core logic: ${opt.core_logic}`);
    parts.push(`Self-estimated confidence: ${opt.estimated_confidence}`);
    parts.push(`Key tradeoff: ${opt.key_tradeoff}`);
    if (opt.leverages_intersection) {
      parts.push(`Leverages intersection: ${opt.leverages_intersection}`);
    }
    parts.push(`Prob space validation: ${opt.probability_space_validation}`);
    parts.push(`Reasoning: ${opt.reasoning_trace.join(" → ")}`);
  }

  // Probability spaces for stress-testing
  if (params.probabilitySpaces.length > 0) {
    parts.push(`\nPROBABILITY SPACE FAILURE MODES (test each option against these):`);
    for (const space of params.probabilitySpaces.slice(0, 10)) {
      if (space.failure_points.length > 0) {
        parts.push(`\n  ${space.edge_label} (overall p=${(space.total_probability * 100).toFixed(0)}%):`);
        for (const fp of space.failure_points) {
          parts.push(`    - ${fp.name}: ${fp.mode} (p=${fp.probability}, blast=${fp.blast_radius})`);
        }
      }
    }
  }

  // Diagnosis context for coherence checking
  parts.push(`\nDIAGNOSIS CONTEXT (strategies must address this):`);
  parts.push(`Core problem: ${params.diagnosis.core_problem_statement}`);
  if (params.diagnosis.signal_synthesis.contradictory_signals.length > 0) {
    parts.push(`Contradictory signals (strategies must resolve these):`);
    for (const cs of params.diagnosis.signal_synthesis.contradictory_signals) {
      parts.push(`  - ${cs.signal_a} vs ${cs.signal_b}: ${cs.resolution}`);
    }
  }

  // Rejected options for reference
  if (params.synthesisResult.rejected_options.length > 0) {
    parts.push(`\nREJECTED OPTIONS (verify the rejections were correct):`);
    for (const rej of params.synthesisResult.rejected_options) {
      parts.push(`  - "${rej.title}": rejected because ${rej.rejection_reason} (failure: ${rej.failure_mode_exposed})`);
    }
  }

  return { system, user: parts.join("\n") };
}
