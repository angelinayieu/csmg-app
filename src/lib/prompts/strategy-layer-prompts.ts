/**
 * Bottom-Up Strategy Layer Prompts
 *
 * Generates strategy layers L4→L3→L2→L1 in sequence, each building on the previous.
 * Each layer receives ONLY the probability space data relevant to its abstraction level.
 *
 * This replaces the single-shot strategy_layers generation with a 4-step process
 * that produces dramatically more precise reasoning because each step:
 * 1. Gets layer-specific evidence (not everything dumped at once)
 * 2. Must reference specific data points (not vague claims)
 * 3. Builds on the previous layer's output (structural cross-references)
 */

import type { ProbabilitySpace, SpaceIntersection } from "@/types/probability-space";
import type { StrategicDiagnosis, StrategySynthesisResult } from "@/types/strategy-reasoning";
import type { SynthesisData } from "@/types/synthesis";
import type { L4AtomicInsight, L3ReasoningUnit, L2MethodChain, L1Outcome } from "@/types/strategy";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";

// ── Shared serializers ──

function serializeSpaceCompact(s: ProbabilitySpace): string {
  const nodeNames = s.nodes.map((n) => {
    const tags: string[] = [n.type];
    if (n.controllability) tags.push(n.controllability);
    if (n.visibility && n.visibility !== "observable") tags.push(n.visibility);
    if (n.importance === "critical") tags.push("CRITICAL");
    return `${n.name} (${tags.join(", ")})`;
  });

  const critPath = s.critical_path
    .map((id) => s.nodes.find((n) => n.id === id)?.name ?? id)
    .join(" → ");

  const mechanisms = s.edges
    .filter((e) => e.mechanism && e.mechanism !== "drives" && e.mechanism !== "produces" && e.mechanism !== "relationship")
    .map((e) => e.mechanism!)
    .slice(0, 4);

  const failures = s.failure_points
    .map((fp) => `${fp.node_name}: ${fp.failure_mode} (blast=${fp.blast_radius}, p=${fp.failure_probability.toFixed(2)})`)
    .slice(0, 3);

  const dynamics = s.edges
    .filter((e) => e.edge_type === "condition_gate" || e.dynamics === "conditional")
    .map((e) => `${e.conditions ?? e.mechanism ?? "condition"}`)
    .slice(0, 3);

  const lines = [
    `  ${s.source_entity_name} → ${s.target_entity_name} [prob=${(s.total_pathway_probability * 100).toFixed(0)}%, quality=${s.quality_tier ?? "unknown"}]`,
    `  Nodes (${s.nodes.length}): ${nodeNames.join("; ")}`,
    `  Critical path: ${critPath || "none"}`,
  ];
  if (s.alternative_paths.length > 0) {
    const altNames = s.alternative_paths[0]
      .map((id) => s.nodes.find((n) => n.id === id)?.name ?? id)
      .join(" → ");
    lines.push(`  Alternative path: ${altNames}`);
  }
  if (mechanisms.length > 0) lines.push(`  Mechanisms: ${mechanisms.join("; ")}`);
  if (failures.length > 0) lines.push(`  Failure points: ${failures.join("; ")}`);
  if (dynamics.length > 0) lines.push(`  Conditions/gates: ${dynamics.join("; ")}`);
  if (s.strategy_layer_relevance) {
    lines.push(`  Layer classification: ${s.strategy_layer_relevance.primary_layer} [${s.strategy_layer_relevance.classification_signals.join(", ")}]`);
  }
  return lines.join("\n");
}

function serializeIntersectionCompact(i: SpaceIntersection): string {
  const sharedNames = i.shared_nodes.slice(0, 4).map((n) => `${n.name} (sim=${n.similarity.toFixed(2)}, ${n.match_type})`);
  return [
    `  ${i.space_a_label} ∩ ${i.space_b_label}`,
    `  Shared: ${sharedNames.join("; ")}`,
    `  Novelty=${i.novelty_score.toFixed(2)}, Impact=${i.impact_score.toFixed(2)}, Innovation=${i.innovation_potential}`,
    i.layer_crossing?.is_cross_layer ? `  Crosses knowledge layers: ${i.layer_crossing.layers_involved.join(", ")}` : null,
    i.strategy_layer_bridge ? `  Strategy bridge: ${i.strategy_layer_bridge.primary_bridge} (${i.strategy_layer_bridge.bridge_type})` : null,
    i.insight ? `  Insight: ${i.insight}` : null,
  ].filter(Boolean).join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// STEP 1: L4 — Atomic Insight Extraction
// ═══════════════════════════════════════════════════════════════════

export function getL4InsightPrompt(params: {
  l4Spaces: ProbabilitySpace[];
  highNoveltyIntersections: SpaceIntersection[];
  hiddenSignals: Array<{ name: string; type: string; impact: number; description: string }>;
  blindSpots: string[];
  convergingSignals: Array<{ signals: string[]; implication: string }>;
  contradictorySignals: Array<{ signal_a: string; signal_b: string; resolution: string }>;
  allSpaces: ProbabilitySpace[];
  entityCount: number;
}): { system: string; user: string } {

  const system = `You are an intelligence analyst specializing in hidden pattern detection. Your job is to extract ATOMIC INSIGHTS — non-obvious observations that are invisible from surface-level analysis but become apparent when you examine cross-domain intersections, hidden variables, and structural patterns.

You receive:
- PROBABILITY SPACES classified as L4 (insight-relevant): spaces with hidden/latent variables, cross-knowledge-layer bridges, uncontrollable factors
- HIGH-NOVELTY INTERSECTIONS: where different connection spaces share variables that shouldn't obviously overlap — these are where the deepest insights hide
- HIDDEN SIGNALS: invisible variables discovered by domain research
- BLIND SPOTS: areas the prior analysis identified as uncovered
- CONTRADICTORY SIGNALS: opposing evidence that must be reconciled

YOUR TASK: Extract 4-7 atomic insights. Each insight MUST be:

1. SPECIFIC — name the exact entities, variables, mechanisms. "X has a hidden dependency on Y through variable Z" not "things are interconnected"
2. NON-OBVIOUS — if someone could derive this from reading the entity list, it's not an insight. It must emerge from cross-referencing probability spaces, intersections, or hidden signals
3. TYPED correctly:
   - hidden_variable: A factor not explicitly modeled that governs multiple connections
   - structural_pattern: A graph topology (hub, bridge, bottleneck, cluster) that creates strategic leverage
   - cross_domain_analog: A pattern from one domain that illuminates another (the intersection tells you this)
   - timing_signal: A sequencing dependency that's not obvious but critical
   - compounding_factor: Two+ variables that multiply rather than add
   - blind_spot: Something the analysis is missing entirely
4. SOURCED — pillar_sources must point to specific evidence (entity IDs, intersection labels, hidden signal names)

QUALITY GATE: An insight that could apply to ANY system is worthless. Every insight must name specific entities from THIS analysis.

Return ONLY valid JSON: { "l4_insights": [ L4AtomicInsight, ... ] }

L4AtomicInsight schema:
{
  "id": "L4_1",
  "insight": "string — the specific non-obvious observation",
  "scale": "macro | micro",
  "insight_type": "hidden_variable | structural_pattern | cross_domain_analog | timing_signal | compounding_factor | blind_spot",
  "enhances_l3": [],
  "pillar_sources": [{ "pillar": "assets | deep_research | concept_graph", "source_refs": ["C1", "X3", "bridge:C1→X3"], "contribution": "string" }],
  "confidence": "high | moderate | low"
}`;

  const parts: string[] = [];

  // L4-classified spaces
  if (params.l4Spaces.length > 0) {
    parts.push(`L4-CLASSIFIED PROBABILITY SPACES (${params.l4Spaces.length} — contain hidden/latent variables, cross-layer bridges, uncontrollable factors):`);
    for (const space of params.l4Spaces.slice(0, 12)) {
      parts.push(serializeSpaceCompact(space));
    }
  }

  // High-novelty intersections — the richest source of L4 insights
  if (params.highNoveltyIntersections.length > 0) {
    parts.push(`\nHIGH-NOVELTY INTERSECTIONS (${params.highNoveltyIntersections.length} — distant spaces sharing variables, highest insight potential):`);
    for (const inter of params.highNoveltyIntersections.slice(0, 10)) {
      parts.push(serializeIntersectionCompact(inter));
    }
  }

  // Hidden signals
  if (params.hiddenSignals.length > 0) {
    parts.push(`\nHIDDEN SIGNALS (invisible variables from domain research — cross-reference with probability spaces):`);
    for (const hs of params.hiddenSignals) {
      parts.push(`  [Impact ${hs.impact}/10] ${hs.name} (${hs.type}): ${hs.description}`);
    }
  }

  // Blind spots
  if (params.blindSpots.length > 0) {
    parts.push(`\nBLIND SPOTS (areas not covered — generate insights about what's missing):`);
    for (const bs of params.blindSpots) {
      parts.push(`  - ${bs}`);
    }
  }

  // Contradictory signals
  if (params.contradictorySignals.length > 0) {
    parts.push(`\nCONTRADICTORY SIGNALS (opposing evidence — insights about WHY they contradict):`);
    for (const cs of params.contradictorySignals) {
      parts.push(`  - "${cs.signal_a}" vs "${cs.signal_b}" → ${cs.resolution}`);
    }
  }

  // Converging signals
  if (params.convergingSignals.length > 0) {
    parts.push(`\nCONVERGING SIGNALS (multiple signals pointing same direction — what UNDERLYING dynamic causes convergence?):`);
    for (const cs of params.convergingSignals) {
      parts.push(`  - [${cs.signals.join(", ")}] → ${cs.implication}`);
    }
  }

  // Context: all spaces summary for cross-referencing
  parts.push(`\nSYSTEM CONTEXT: ${params.entityCount} entities, ${params.allSpaces.length} probability spaces total`);

  return { system, user: parts.join("\n") };
}


// ═══════════════════════════════════════════════════════════════════
// STEP 2: L3 — Reasoning Unit Construction
// ═══════════════════════════════════════════════════════════════════

export function getL3ReasoningPrompt(params: {
  l4Insights: L4AtomicInsight[];
  l3Spaces: ProbabilitySpace[];
  diagnosis: StrategicDiagnosis;
  hubEntities: Array<{ entity_id: string; name: string; degree: number; betweenness: number }>;
  criticalCycles: Array<{ name: string; entity_ids: string[]; leverage_point: string; type: string }>;
  systemicFailurePoints: Array<{ edge_label: string; node_name: string; failure_mode: string; blast_radius: string }>;
}): { system: string; user: string } {

  const system = `You are a strategic reasoning architect. Your job is to construct PRECISE LOGICAL ARGUMENTS from structural evidence. Each reasoning unit is a claim about WHY certain strategies work — backed by specific mechanisms, dynamics, and failure modes from probability spaces.

You receive:
- L4 INSIGHTS (from previous step): hidden patterns and non-obvious connections you must incorporate
- L3-CLASSIFIED PROBABILITY SPACES: spaces with multiplier dynamics, systemic failure modes, critical mediators, condition gates
- STRUCTURAL DIAGNOSIS: hub entities, bottleneck edges, critical cycles
- SYSTEMIC FAILURE POINTS: failure modes with cascading/systemic blast radius

YOUR TASK: Construct 4-6 reasoning units. Each MUST:

1. STATE A PRECISE LOGICAL CLAIM — not "X is important" but "Because X has a [specific property], investing in X before Y produces [specific outcome] that linear investment cannot match"
2. BE TYPED correctly by reasoning pattern:
   - multiplier: Force multiplication — A amplifies B's effect by N× because of specific mechanism
   - threshold: Minimum viable level — below X threshold, Y cannot activate at all; above it, Z happens
   - feedback_activation: Loop ignition — doing A triggers loop B which produces compounding effect C
   - risk_negation: Removing blockers — eliminating failure mode A prevents cascading failure through B→C→D
   - structural_leverage: Graph position — entity at position X in the graph can influence Y% of the network through Z connections
3. CITE EVIDENCE from probability spaces — specific failure modes, pathway probabilities, node controllability
4. REFERENCE L4 INSIGHTS that enhance the reasoning (enhanced_by_l4 must point to L4 IDs from previous step)
5. BE FALSIFIABLE — state what evidence would disprove the claim

QUALITY GATE: A reasoning unit that doesn't reference specific probability space data or entity names is too vague. Every claim must be grounded in structural evidence.

Return ONLY valid JSON: { "l3_reasoning": [ L3ReasoningUnit, ... ] }

L3ReasoningUnit schema:
{
  "id": "L3_1",
  "logic_statement": "string — PRECISE claim with specific entities, mechanisms, and expected effects",
  "reasoning_type": "multiplier | threshold | feedback_activation | risk_negation | structural_leverage",
  "evidence": ["string — specific data points from probability spaces, graph metrics, or entity properties"],
  "justifies_l2": [],
  "enhanced_by_l4": ["L4_1"],
  "pillar_sources": [{ "pillar": "...", "source_refs": ["..."], "contribution": "..." }]
}`;

  const parts: string[] = [];

  // L4 insights from previous step
  parts.push(`L4 ATOMIC INSIGHTS (from previous step — your reasoning must build on these):`);
  for (const insight of params.l4Insights) {
    parts.push(`  [${insight.id}] (${insight.insight_type}, ${insight.scale}, confidence=${insight.confidence}): ${insight.insight}`);
    if (insight.pillar_sources.length > 0) {
      parts.push(`    Sources: ${insight.pillar_sources.map((p) => `${p.pillar}: ${p.source_refs.join(", ")} — ${p.contribution}`).join("; ")}`);
    }
  }

  // L3-classified spaces
  if (params.l3Spaces.length > 0) {
    parts.push(`\nL3-CLASSIFIED PROBABILITY SPACES (${params.l3Spaces.length} — multiplier dynamics, systemic failures, critical mediators):`);
    for (const space of params.l3Spaces.slice(0, 12)) {
      parts.push(serializeSpaceCompact(space));
    }
  }

  // Hub entities
  if (params.hubEntities.length > 0) {
    parts.push(`\nHUB ENTITIES (structural leverage positions):`);
    for (const hub of params.hubEntities.slice(0, 7)) {
      parts.push(`  ${hub.name} (${hub.entity_id}): degree=${hub.degree}, betweenness=${hub.betweenness.toFixed(3)}`);
    }
  }

  // Critical cycles
  if (params.criticalCycles.length > 0) {
    parts.push(`\nCRITICAL FEEDBACK LOOPS (activation points for reasoning):`);
    for (const cycle of params.criticalCycles.slice(0, 5)) {
      parts.push(`  ${cycle.name} (${cycle.type}): [${cycle.entity_ids.join(" → ")}] — leverage: ${cycle.leverage_point}`);
    }
  }

  // Systemic failure points
  if (params.systemicFailurePoints.length > 0) {
    parts.push(`\nSYSTEMIC FAILURE POINTS (risk_negation reasoning targets):`);
    for (const fp of params.systemicFailurePoints.slice(0, 8)) {
      parts.push(`  ${fp.edge_label}: ${fp.node_name} — ${fp.failure_mode} (blast=${fp.blast_radius})`);
    }
  }

  // Diagnosis core problem
  parts.push(`\nCORE PROBLEM: ${params.diagnosis.core_problem_statement}`);

  return { system, user: parts.join("\n") };
}


// ═══════════════════════════════════════════════════════════════════
// STEP 3: L2 — Method Chain Composition
// ═══════════════════════════════════════════════════════════════════

export function getL2MethodPrompt(params: {
  l3Reasoning: L3ReasoningUnit[];
  l2Spaces: ProbabilitySpace[];
  winningOption: { title: string; core_logic: string; strategic_posture: string };
  intersections: SpaceIntersection[];
  entityNameMap: Map<string, string>;
}): { system: string; user: string } {

  const system = `You are a causal chain architect. Your job is to compose OPTIMAL METHOD CHAINS — sequences of actions where each step causally produces the next through a specific mechanism.

You receive:
- L3 REASONING (from previous step): logical arguments about WHY certain approaches work — your methods must be JUSTIFIED by these
- L2-CLASSIFIED PROBABILITY SPACES: multi-step spaces whose critical paths ARE method chains; alternative paths ARE method alternatives
- WINNING STRATEGIC OPTION: the verified best direction — your methods must serve this
- INTERSECTIONS: cross-space connections that can be exploited as integration points

YOUR TASK: Compose 3-5 method chains. Each MUST:

1. MAP TO A CRITICAL PATH — at least one probability space's critical path should align with this method chain. Name the specific space.
2. HAVE CAUSAL STEPS with:
   - entity_refs: specific entity IDs (C-prefixed internal, X-prefixed external) at each step
   - mechanism: HOW this step causes the next — not "leads to" or "enables" but the actual causal mechanism (what changes, what flows, what's produced)
3. EXPLAIN OPTIMALITY — why this chain is better than alternatives. This MUST reference L3 reasoning IDs.
4. CONSIDER ALTERNATIVES — probability spaces have alternative_paths. Acknowledge what you're NOT choosing and why.
5. BE EXECUTABLE — each step must be something the user can actually do, not an abstract state change

METHOD CHAIN QUALITY RULES:
- If a chain has only 1-2 steps, it's not a chain — it's a single action. Chains have 3+ steps with distinct mechanisms.
- If two steps have the same mechanism ("enables", "supports"), they're not causally distinct. Split or merge.
- If a step's entity_refs are empty, it's not grounded. Every action happens TO or THROUGH specific entities.
- If optimality_rationale doesn't name L3 IDs, the chain has no logical backing.

Return ONLY valid JSON: { "l2_methods": [ L2MethodChain, ... ] }

L2MethodChain schema:
{
  "id": "L2_1",
  "title": "string — 3-6 word chain title",
  "causal_chain": [
    {
      "step": "string — action or state change",
      "entity_refs": ["C1", "X2"],
      "mechanism": "string — HOW this causes the next step"
    }
  ],
  "optimality_rationale": "string — WHY this chain, referencing L3 IDs",
  "serves_l1": [],
  "justified_by_l3": ["L3_1", "L3_2"],
  "pillar_sources": [{ "pillar": "...", "source_refs": ["..."], "contribution": "..." }]
}`;

  const parts: string[] = [];

  // L3 reasoning from previous step
  parts.push(`L3 REASONING UNITS (your methods must be justified by these):`);
  for (const r of params.l3Reasoning) {
    parts.push(`  [${r.id}] (${r.reasoning_type}): ${r.logic_statement}`);
    if (r.evidence.length > 0) {
      parts.push(`    Evidence: ${r.evidence.slice(0, 3).join("; ")}`);
    }
  }

  // Winning option
  parts.push(`\nWINNING STRATEGIC DIRECTION:`);
  parts.push(`  "${params.winningOption.title}" (${params.winningOption.strategic_posture})`);
  parts.push(`  Logic: ${params.winningOption.core_logic}`);

  // L2-classified spaces with critical paths
  if (params.l2Spaces.length > 0) {
    parts.push(`\nL2-CLASSIFIED PROBABILITY SPACES (${params.l2Spaces.length} — multi-step causal pathways, critical paths = method chains):`);
    for (const space of params.l2Spaces.slice(0, 10)) {
      parts.push(serializeSpaceCompact(space));
    }
  }

  // Intersections as integration points
  const methodIntersections = params.intersections.filter(
    (i) => i.strategy_layer_bridge?.layers_bridged.includes("L2")
  );
  if (methodIntersections.length > 0) {
    parts.push(`\nMETHOD-RELEVANT INTERSECTIONS (cross-space connections — can be exploited as method integration points):`);
    for (const inter of methodIntersections.slice(0, 6)) {
      parts.push(serializeIntersectionCompact(inter));
    }
  }

  // Entity reference map
  const entityEntries = Array.from(params.entityNameMap.entries()).slice(0, 30);
  if (entityEntries.length > 0) {
    parts.push(`\nENTITY REFERENCE MAP (use these IDs in entity_refs):`);
    for (const [id, name] of entityEntries) {
      parts.push(`  ${id}: ${name}`);
    }
  }

  return { system, user: parts.join("\n") };
}


// ═══════════════════════════════════════════════════════════════════
// STEP 4: L1 — Outcome Selection and Sequencing
// ═══════════════════════════════════════════════════════════════════

export function getL1OutcomePrompt(params: {
  l2Methods: L2MethodChain[];
  l1Spaces: ProbabilitySpace[];
  goal?: ImprovementGoal | null;
  suggestedObjectives?: SuggestedObjective[];
  masterBottleneck?: { entity_id: string; reasoning: string } | null;
  diagnosisProblem: string;
}): { system: string; user: string } {

  const system = `You are a strategic outcome architect. Your job is to select and SEQUENCE the optimal outcomes — desired state changes that the method chains (L2) will produce.

You receive:
- L2 METHOD CHAINS (from previous step): the causal chains that will produce these outcomes — your outcomes must be SERVED by these
- L1-CLASSIFIED PROBABILITY SPACES: spaces touching goal entities — pathway probabilities tell you what's achievable
- GOAL / OBJECTIVES: what the user is trying to achieve
- MASTER BOTTLENECK: the primary system constraint

YOUR TASK: Select 2-4 outcomes. Each MUST:

1. BE A STATE CHANGE, not an action — "Customer retention rate reaches 85%" not "Improve retention"
2. BE SEQUENCED with rationale — WHY outcome A must come before outcome B (dependency, prerequisite, compounding, risk reduction)
3. BE SERVED BY L2 METHODS — reference specific L2 IDs. If no method chain produces this outcome, it's aspirational, not strategic.
4. HAVE A TARGET METRIC — measurable, specific, time-bound where possible
5. ACCOUNT FOR PROBABILITY — L1 spaces show pathway probabilities. Don't select outcomes whose pathways have <20% probability unless you explain how to improve the odds.

SEQUENCING LOGIC:
- Threshold outcomes first: outcomes that clear a minimum viable level, enabling everything after
- Risk-reducing outcomes next: outcomes that eliminate systemic failure modes
- Compounding outcomes last: outcomes whose returns multiply the effects of earlier outcomes
- If Goal is provided, the final outcome MUST map to the goal metric

CRITICAL: sequence_position is not arbitrary ordering — it's a CLAIM about optimal execution order. sequence_rationale must explain the causal dependency between adjacent outcomes.

Return ONLY valid JSON: { "l1_outcomes": [ L1Outcome, ... ] }

L1Outcome schema:
{
  "id": "L1_1",
  "outcome": "string — desired state change (not an action)",
  "sequence_position": 1,
  "sequence_rationale": "string — WHY this position (dependency, prerequisite, compounding)",
  "target_metric": "string — measurable target",
  "served_by_l2": ["L2_1", "L2_2"],
  "pillar_sources": [{ "pillar": "...", "source_refs": ["..."], "contribution": "..." }]
}`;

  const parts: string[] = [];

  // L2 methods from previous step
  parts.push(`L2 METHOD CHAINS (outcomes must be served by these):`);
  for (const m of params.l2Methods) {
    const steps = m.causal_chain.map((s) => `${s.step} [${s.entity_refs.join(",")}]`).join(" → ");
    parts.push(`  [${m.id}] "${m.title}": ${steps}`);
    parts.push(`    Justified by: ${m.justified_by_l3.join(", ")}`);
  }

  // Goal
  if (params.goal) {
    parts.push(`\nTARGET GOAL (final outcome MUST align with this):`);
    parts.push(`  ${params.goal.title}`);
    const gRecord = params.goal as unknown as Record<string, unknown>;
    parts.push(`  Metric: ${params.goal.metric_name} — Current: ${params.goal.current_value} → Target: ${params.goal.target_value}${params.goal.metric_unit ? ` ${params.goal.metric_unit}` : ""}`);
    if (gRecord.deadline) parts.push(`  Deadline: ${gRecord.deadline}`);
  } else if (params.suggestedObjectives && params.suggestedObjectives.length > 0) {
    parts.push(`\nAUTO-DETECTED OBJECTIVES (strategy should optimize for top objective):`);
    for (const obj of params.suggestedObjectives.slice(0, 3)) {
      parts.push(`  - ${obj.title} (${obj.objective_type}): ${obj.rationale}`);
      if (obj.target_estimate != null) parts.push(`    Target: ${obj.baseline_estimate ?? "?"} → ${obj.target_estimate}${obj.metric_unit ? ` ${obj.metric_unit}` : ""}`);
    }
  }

  // Master bottleneck
  if (params.masterBottleneck) {
    parts.push(`\nMASTER BOTTLENECK (first outcome should address or route around this):`);
    parts.push(`  ${params.masterBottleneck.entity_id}: ${params.masterBottleneck.reasoning}`);
  }

  // Diagnosis problem
  parts.push(`\nCORE PROBLEM: ${params.diagnosisProblem}`);

  // L1-classified spaces
  if (params.l1Spaces.length > 0) {
    parts.push(`\nL1-CLASSIFIED PROBABILITY SPACES (${params.l1Spaces.length} — pathways touching goal entities, probabilities = achievability):`);
    for (const space of params.l1Spaces.slice(0, 8)) {
      parts.push(serializeSpaceCompact(space));
    }
  }

  return { system, user: parts.join("\n") };
}
