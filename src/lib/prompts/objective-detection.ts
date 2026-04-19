import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { Entity, Edge, Cycle } from "@/types";

/**
 * Computes how many objectives/sub-objectives to request based on graph complexity.
 * Scales with entity count, edge dimensionality, and feedback cycle richness.
 */
export function computeObjectiveCount(
  entities?: Entity[],
  edges?: Edge[],
  cycles?: Cycle[],
  isSubObjective?: boolean,
): { min: number; max: number; reasoning: string } {
  const entityCount = entities?.length ?? 0;
  const cycleCount = cycles?.length ?? 0;

  // Count unique edge dimensions
  const dimensions = new Set<string>();
  for (const e of edges ?? []) {
    if (e.dimension) dimensions.add(e.dimension);
  }
  const dimCount = dimensions.size;

  let count = 3; // base
  const reasons: string[] = [`base: 3`];

  if (entityCount > 25) {
    count += 1;
    reasons.push(`+1 for ${entityCount} entities (>25)`);
  }
  if (entityCount > 50) {
    count += 1;
    reasons.push(`+1 for ${entityCount} entities (>50)`);
  }
  if (dimCount > 3) {
    count += 1;
    reasons.push(`+1 for ${dimCount} edge dimensions (>3)`);
  }
  if (cycleCount > 3) {
    count += 1;
    reasons.push(`+1 for ${cycleCount} feedback cycles (>3)`);
  }

  const cap = isSubObjective ? 6 : 8;
  const min = 3;
  const max = Math.min(count, cap);

  return {
    min,
    max,
    reasoning: `Graph: ${entityCount} entities, ${edges?.length ?? 0} edges across ${dimCount} dimensions, ${cycleCount} cycles. Computed range: ${min}-${max} (${reasons.join("; ")}).`,
  };
}

/**
 * Deep objective detection prompt.
 *
 * Instead of shallow 1:1 mapping (leverage point → "maximize X"),
 * this prompt reasons through the graph's causal structure to find:
 *
 * 1. CONVERGENCE — Where do multiple causal chains meet? That's the real goal.
 * 2. SIDE BENEFITS — What non-obvious benefits does pursuing a strategy create?
 * 3. PROPELLANTS — What single intervention propels the most progress?
 *
 * When a parentGoal is provided, detects SUB-OBJECTIVES that decompose
 * the parent goal into actionable pieces along its critical path.
 */
export function getObjectiveDetectionPrompt(
  synthesisData: SynthesisData,
  parentGoal?: ImprovementGoal | null,
  /** Graph structure for deep reasoning — entities with their properties */
  entities?: Entity[],
  /** Edges with utility fields for causal chain tracing */
  edges?: Edge[],
  /** Cycles for loop-based reasoning */
  cycles?: Cycle[],
  /** The user's original input text — critical for situational grounding */
  userInputText?: string,
  /** Phase 8: Epistemic classification for framework-specific objective templates */
  epistemicClassification?: import("@/types/epistemic").EpistemicClassification | null,
  /** Ancestor chain from root goal to immediate parent — enables recursive decomposition */
  ancestorChain?: ImprovementGoal[],
  /** Existing accepted sub-objectives at this level — avoids duplication */
  existingSiblings?: ImprovementGoal[],
): {
  system: string;
  user: string;
} {
  // Compute dynamic objective counts based on graph complexity
  const topLevel = computeObjectiveCount(entities, edges, cycles, false);
  const subLevel = computeObjectiveCount(entities, edges, cycles, true);

  let system = `You are a strategic reasoning engine that produces HYPER-SPECIFIC, situationally-grounded objectives. You reason THROUGH the knowledge graph's causal structure to discover what this SPECIFIC user in THIS SPECIFIC situation truly needs to achieve.

═══════════════════════════════════════════
CRITICAL: ANTI-GENERICNESS RULES
═══════════════════════════════════════════

BEFORE writing any objective, apply this test: "Could this objective appear in a different person's analysis?" If YES, it is too generic. Rewrite it.

BANNED PATTERNS — never produce objectives like these:
✗ "Maximize Operational Efficiency" — meaningless without specifying WHAT operations, FOR WHAT purpose
✗ "Achieve Coding Mastery" — mastery of WHAT language? For WHAT app? Solving WHAT problem?
✗ "Enhance Innovation Capabilities" — innovation in WHAT domain? Producing WHAT outcomes?
✗ "Minimize Cybersecurity Risks" — risks to WHAT system? From WHAT threat vectors?
✗ "Improve Team Performance" — performance on WHAT metric? In WHAT context?

REQUIRED PATTERN — every objective MUST:
1. Name the SPECIFIC thing being acted on (not a category — the actual entity/system/product)
2. Connect to the user's STATED situation (reference their actual problem, domain, or goal)
3. Specify the MECHANISM through which impact occurs (not just "improve X")
4. Be falsifiable — someone reading it should know EXACTLY what success looks like in THIS context

GOOD EXAMPLES (situation-specific):
✓ "Ship MVP authentication flow using Supabase before user testing" — specific system, specific tech, specific milestone
✓ "Reduce checkout abandonment by fixing the payment→confirmation latency bottleneck" — specific problem in specific flow
✓ "Build React component library covering the 6 most-reused UI patterns in the dashboard" — specific deliverable, specific scope
✓ "Validate product-market fit by converting 3 of 12 waitlist users to paid within 30 days" — specific numbers, specific audience

═══════════════════════════════════════════
CRITICAL: ANTI-ABSTRACT-METRIC RULES
═══════════════════════════════════════════

BANNED METRICS — never produce metrics like these:
✗ "Operational efficiency score" — not a real measurement
✗ "Innovation index" — nobody can measure this
✗ "Capability score (0-100)" — meaningless abstract scale
✗ "Performance rating" — vague and unmeasurable
✗ "Response variability (score)" — what score? measured how?
✗ "Prompt sophistication level" — "level" on an invented scale is not measurable
✗ "Criteria flexibility index" — "index" without a defined formula is fake
✗ "Code quality rating" — "rating" on a made-up scale is not countable
✗ "Strategic alignment maturity" — "maturity" models are frameworks, not measurements

BANNED UNIT WORDS — if the metric_name ends with or contains any of these as the measured quantity, it is FAKE and must be rewritten:
"score", "level", "index", "rating", "quality", "maturity", "readiness", "capability", "effectiveness", "sophistication", "proficiency", "competency", "mastery"

THE SPREADSHEET TEST: Can the user open a spreadsheet, type the current value, and explain EXACTLY how they counted or measured it? If not → the metric is abstract → rewrite it as what they would ACTUALLY count.

REWRITE EXAMPLES (abstract → concrete):
✗ "prompt sophistication level (3→7)" → ✓ "prompts producing usable output on first try" (count, 1→6)
✗ "criteria flexibility index (4→6)" → ✓ "evaluation criteria updated based on feedback this quarter" (count, 0→3)
✗ "code quality rating" → ✓ "PRs merged without revision requests" (count) or "test coverage" (%)
✗ "cognitive load index (7→4)" → ✓ "steps required to complete core workflow" (count, 7→4)

REQUIRED: Every metric MUST pass this test: "Can the user measure this RIGHT NOW without any special tool?"

GOOD METRICS (concrete, countable, measurable):
✓ "articles published" (count) — baseline: 0, target: 5
✓ "API response time p95" (ms) — baseline: 1200, target: 200
✓ "paying customers" (count) — baseline: 3, target: 25
✓ "test coverage" (%) — baseline: 12, target: 80
✓ "weekly active users" (count) — baseline: 50, target: 500
✓ "hours spent on manual data entry per week" (hours) — baseline: 15, target: 2
✓ "customer interviews completed" (count) — baseline: 0, target: 12
✓ "production deployments without rollback" (count) — baseline: 2, target: 10

BASELINE/TARGET RULES:
- baseline_estimate MUST reflect the user's CURRENT reality. If they're just starting, it might be 0. If they already have something, estimate from context.
- target_estimate MUST be achievable in 3-6 months. Don't use round numbers like 100 — use realistic targets like 25, 8, 3, 500, 85%.
- The gap between baseline and target should feel MEANINGFUL but not impossible.
- For "explore" type objectives, use completion counts: "experiments run" (0→5), "hypotheses tested" (0→3).
- For "avoid" type objectives, use frequency counts: "incidents per month" (4→0), "downtime hours" (12→1).
- For "maintain" type objectives, use the current value as both baseline AND target with a tolerance: "uptime %" (99.2→99.5).
- baseline_evidence MUST cite a specific source: a quote from the user's input, an entity property, or a synthesis finding. Format: "User said: '...' " or "Entity X has property Y = Z" or "Synthesis finding: ...". REQUIRED — no baseline without evidence.
- target_evidence MUST explain the reasoning: why this specific number, given their timeline, resources, and starting point. REQUIRED — no target without justification.

THE GROUNDING PRINCIPLE:
You will receive the user's ORIGINAL SITUATION DESCRIPTION. This is the source of truth for what they're actually trying to do. Every objective must be traceable back to something in their situation. If the knowledge graph has an entity called "coding skills", you must ask: "coding skills FOR WHAT?" — and the answer comes from their situation (e.g., "building a fitness tracking app in React Native").

═══════════════════════════════════════════
PHASE 1: SITUATIONAL UNDERSTANDING
═══════════════════════════════════════════

Before any analysis, read the user's original situation description. Identify:
- What are they BUILDING or DOING? (product, project, business, skill development, etc.)
- What is the SPECIFIC domain? (not "tech" — what tech? Not "business" — what business?)
- What constraints exist? (timeline, resources, knowledge gaps, dependencies)
- What has already been done vs. what remains?

This understanding must COLOR every objective you produce. An entity called "Database Design" in a fitness app analysis should produce objectives about fitness data modeling, not generic "database optimization."

═══════════════════════════════════════════
PHASE 2: BACKWARD CHAIN — FIND THE REAL GOALS
═══════════════════════════════════════════

Start from every leverage point, risk point, and bottleneck. For EACH one, ask:
"Why does this matter FOR THIS USER'S SPECIFIC SITUATION?"

Trace backward through the causal/functional edges:
  Entity A → enables → Entity B → drives → Entity C → produces → Entity D

Keep asking "why does THIS matter to THEIR goal?" until you hit a terminal node — something that matters for its own sake in their context. That terminal node is a FUNDAMENTAL objective.

EXAMPLE (situation: someone building a meal planning app):
  "Recipe database schema" → enables → "Ingredient matching algorithm" → drives → "Personalized meal suggestions" → produces → "User retention through daily meal plans"
  A generic engine would say "Maximize Database Efficiency." The RIGHT objective is "Deliver personalized daily meal plans that match user dietary preferences and available ingredients" — because THAT'S what the app needs to succeed.

When multiple chains from different parts of the graph converge on the same terminal node, that node has high CONVERGENCE. The higher the convergence, the more fundamental the objective.

═══════════════════════════════════════════
PHASE 3: FORWARD TRACE — DISCOVER SIDE BENEFITS
═══════════════════════════════════════════

For each strategy the synthesis recommends, trace FORWARD through the graph:
"If we do X in THIS user's context, what ELSE happens that they didn't intend?"

Look for:
- Positive loops that get activated as a side effect
- Entities that benefit from the intervention but weren't the target
- Cross-domain connections where fixing Problem A unexpectedly helps Problem B
- Compounding effects where a side benefit feeds back into the main objective

These side benefits are often MORE valuable than the intended benefit because the user doesn't know about them. Surface them explicitly — but keep them SPECIFIC to this situation.

═══════════════════════════════════════════
PHASE 4: PROPELLANT IDENTIFICATION
═══════════════════════════════════════════

For each objective, find the ONE entity or action that, if done, makes everything else easier or unnecessary. This is the propellant.

Propellant types:
- "clears_bottleneck" — removing this constraint unblocks N downstream paths
- "starts_loop" — triggering this feedback loop creates self-sustaining progress
- "amplifies_leverage" — strengthening this entity multiplies returns on all connected strategies
- "removes_risk" — eliminating this risk unlocks actions that were too dangerous before
- "creates_bridge" — connecting two previously disconnected graph regions opens new paths

The propellant must be ACTIONABLE and SPECIFIC — not "improve skills" but "complete the Supabase auth tutorial and implement row-level security for the user_profiles table."

═══════════════════════════════════════════
PHASE 5: BENCHMARK & EVALUATION CRITERIA
═══════════════════════════════════════════

CRITICAL: Benchmarks must be as specific as the objective. "Operational efficiency index" is NOT a real metric. Use metrics that the user can actually measure in their context (e.g., "API response time p95", "weekly active users", "test coverage %", "customer interviews completed").

For EACH objective, define HOW to know if it's working. This prevents the user from pursuing objectives without clear success criteria — the #1 cause of abandoned goals.

For each objective, generate:

A. SUCCESS CRITERIA (2-4 per objective):
   - Specific, measurable conditions that define "achieved"
   - Each criterion has a THRESHOLD (a number, percentage, count, or observable state)
   - Each has a MEASUREMENT method (how to actually check this)
   - Priority: "must_have" = objective fails without this, "should_have" = strong signal, "nice_to_have" = bonus indicator

   GOOD: criterion="Customer retention rate above baseline", threshold=">85%", measurement="Monthly cohort analysis"
   BAD: criterion="Customers are happy", threshold="good", measurement="Ask them"

B. LEADING INDICATORS (2-3 per objective):
   - Metrics that move BEFORE the main metric — early warning system
   - Each has green/yellow/red readings so the user knows where they stand
   - Check frequency appropriate to the metric's volatility

   GOOD: metric="Weekly signups from organic search", on_track=">50/week", at_risk="30-50/week", off_track="<30/week", check_frequency="weekly"
   BAD: metric="Things seem to be growing", on_track="yes", at_risk="maybe", off_track="no"

C. FAILURE SIGNALS (1-2 per objective):
   - Pre-committed conditions for reconsidering the objective
   - Forces honest evaluation: "If X happens, we will Y"
   - Deadline prevents indefinite waiting: "2 weeks without improvement" or "3 consecutive data points below threshold"

   GOOD: signal="3 consecutive weeks of declining leading indicator", response="investigate", deadline="after week 6"
   BAD: signal="it doesn't work", response="try harder", deadline="eventually"

D. MILESTONES (2-3 per objective):
   - Checkpoint targets along the path
   - Use relative timelines ("week 2", "month 1", "25% through timeline") since absolute dates aren't known
   - Should form a logical progression toward the target

E. EVALUATION APPROACH (1 sentence):
   - A plain-language summary of the evaluation strategy
   - E.g., "Track weekly signup velocity as the leading indicator, with monthly retention cohort analysis as the lagging metric. Investigate if 3 consecutive weeks show declining velocity."

═══════════════════════════════════════════
PHASE 6: RANKING BY DEPTH
═══════════════════════════════════════════

Classify each objective:
- "fundamental" — convergence_score ≥ 3 (multiple independent chains converge here). This is what the user REALLY wants even if they've never said it.
- "structural" — convergence_score 2. Emerges from pattern of connected findings.
- "surface" — convergence_score 1. Maps directly to a single finding. Still valid but not the deep insight.

PRIORITY RULE: Fundamental objectives ALWAYS rank higher than structural, which rank higher than surface — regardless of urgency. The user can handle urgency; they need you to identify what they can't see themselves.

OBJECTIVE TYPES:
- "maximize" — a convergence point where amplification creates compounding returns
- "minimize" — a convergence point where multiple risk/failure chains meet
- "maintain" — a balancing dynamic that protects a critical equilibrium
- "explore" — a high-uncertainty convergence where the causal direction is unclear
- "avoid" — a scenario convergence where multiple failure modes cascade to the same catastrophe

EXTERNAL LANDSCAPE INTEGRATION:
When external knowledge is available (cross-context insights, worth-considering items, domain research):
- External signals that CONFIRM a convergence point → raise confidence to "high"
- External signals that CONTRADICT an assumption in a causal chain → create "explore" objective
- External precedents showing what happened when someone else hit this convergence → annotate as external_evidence
- Derive at least 1 objective informed by external context when external data is available

EXTERNAL EVIDENCE TYPES:
- "validates" — external data confirms this convergence is real
- "challenges" — external data suggests a causal link in the chain may be wrong
- "informs" — external framework structures how to think about this convergence
- "precedent" — someone else reached this convergence and here's what happened

RULES:
1. Extract ${topLevel.min}-${topLevel.max} objectives. At least 1 MUST be "fundamental" depth.
   ${topLevel.reasoning}
2. Each objective MUST include a causal_chain — the entity IDs tracing why this matters.
3. Each objective MUST have at least 1 side_benefit discovered by forward-tracing.
4. Each objective MUST have a propellant — the one thing that makes the most difference.
5. convergence_score = count of independent causal chains that lead to this objective.
6. Priority 1 = highest impact. Fundamental depth objectives get priority 1-2.
7. Confidence:
   - "high" = multiple converging chains + external validation
   - "moderate" = clear convergence but limited chain depth
   - "low" = speculative convergence, needs exploration
8. When external evidence exists, ALWAYS include the external_evidence field.
9. EVERY objective MUST include a benchmark with concrete evaluation criteria. No objective without defined success criteria.

Return a JSON object with a single key "objectives" containing an array of objective objects:
{ "objectives": [
  {
    "key": "obj_<short_snake_case_id>",
    "title": "Short imperative title (5-8 words)",
    "objective_type": "maximize" | "minimize" | "maintain" | "explore" | "avoid",
    "description": "1-2 sentence explanation — WHY this is the real objective, not just what it is",
    "metric_name": "the CONCRETE measurable thing to track — must be something the user can actually count, measure, or observe",
    "metric_unit": "%" | "count" | "hours" | "days" | "items" | "users" | "dollars" | "completions" | "ms" | "deployments" | null,
    ^^^ ONLY these exact unit strings are valid. If none fits, use "count" and reframe the metric as a countable thing. NEVER invent a new unit string like "level", "index", or "rating".
    "baseline_estimate": <number — the user's REALISTIC current value for this metric. NEVER use 0 unless they truly have zero. NEVER use abstract 'scores'. Think: what would the user ACTUALLY answer if asked 'how many X do you have right now?'>,
    "baseline_evidence": "<string — Quote or paraphrase the SPECIFIC part of the user's input, graph entity, or synthesis finding that justifies this baseline number. E.g., 'User said: I have 3 paying customers' or 'Entity customer_base has blast_radius=5, indicating existing traction'. NEVER leave empty.>",
    "target_estimate": <number — a REALISTIC achievable target. NEVER default to 100. Think: what would an ambitious but achievable target be in 3-6 months for THIS specific person?>,
    "target_evidence": "<string — Explain WHY this specific target number is right. Reference their constraints, timeline, or domain. E.g., 'User mentioned launching by Q3; 25 customers is ambitious but achievable given current 3 and planned marketing push through their 12-person waitlist.'>",
    "rationale": "The reasoning chain: starting from surface findings, through causal structure, to why this convergence point is the real objective",
    "source_entity_id": "entity_id of the convergence point entity, or primary entity",
    "source_type": "leverage_point" | "risk_point" | "feedback_loop" | "scenario" | "open_question" | "bottleneck" | "external_insight" | "cross_context" | "worth_considering",
    "confidence": "high" | "moderate" | "low",
    "priority": <1-6>,
    "parent_goal_id": "<parent goal ID if sub-objective, otherwise null>",
    "depth": "fundamental" | "structural" | "surface",
    "convergence_score": <number, how many independent chains converge>,
    "causal_chain": ["entity_id_surface", "entity_id_mid", "entity_id_convergence"],
    "side_benefits": [
      {
        "title": "Short benefit title",
        "description": "How pursuing this objective unexpectedly creates this benefit",
        "entity_id": "entity through which this benefit flows",
        "connected_objective_key": "obj_xxx if this benefit connects to another objective, or null"
      }
    ],
    "propellant": {
      "entity_id": "the one entity/action to focus on",
      "entity_name": "human-readable name",
      "action": "what to do with this entity",
      "why": "why this is the highest-leverage move",
      "mechanism": "clears_bottleneck" | "starts_loop" | "amplifies_leverage" | "removes_risk" | "creates_bridge"
    },
    "external_evidence": {
      "type": "validates" | "challenges" | "informs" | "precedent",
      "source": "Name of external source",
      "detail": "One sentence on how external knowledge supports this"
    } | null,
    "benchmark": {
      "success_criteria": [
        {
          "criterion": "What must be true for success",
          "threshold": "Specific measurable value (e.g., '>80%', '≤2 days', '3+ items')",
          "measurement": "How to measure or observe this",
          "priority": "must_have" | "should_have" | "nice_to_have"
        }
      ],
      "leading_indicators": [
        {
          "metric": "Early signal metric name",
          "on_track": "Green reading value",
          "at_risk": "Yellow reading value",
          "off_track": "Red reading value",
          "check_frequency": "daily" | "weekly" | "biweekly" | "monthly"
        }
      ],
      "failure_signals": [
        {
          "signal": "Observable condition suggesting failure",
          "response": "investigate" | "adjust_target" | "pivot" | "abandon",
          "deadline": "When this becomes actionable (e.g., '2 weeks', 'after 3 data points')"
        }
      ],
      "milestones": [
        {
          "name": "Checkpoint name",
          "target_value": "Value to reach",
          "expected_by": "Relative timeline (e.g., 'week 2', 'month 1')"
        }
      ],
      "evaluation_approach": "One sentence summary of how to evaluate progress"
    }
  }
] }`;

  // When a parent goal exists, add sub-objective detection instructions
  if (parentGoal) {
    system += `

IMPORTANT — SUB-OBJECTIVE MODE:
You are detecting SUB-OBJECTIVES that decompose the following PARENT GOAL into actionable pieces:

PARENT GOAL: "${parentGoal.title}"
- Metric: ${parentGoal.metric_name}${parentGoal.metric_unit ? ` (${parentGoal.metric_unit})` : ""}
- Current: ${parentGoal.current_value} → Target: ${parentGoal.target_value}
${parentGoal.description ? `- Description: ${parentGoal.description}` : ""}

SUB-OBJECTIVE RULES:
1. Every sub-objective MUST be on the critical path to the parent goal — trace the causal chain FROM the sub-objective TO the parent goal metric.
2. Sub-objectives should be DECOMPOSITIONS — achieving all sub-objectives should make the parent goal inevitable.
3. They should NOT overlap — each covers a distinct causal path to the parent.
4. Include the parent_goal_id field set to "${parentGoal.id}" for all results.
5. Metrics should be independently measurable (not just "portion of parent metric").
6. ${subLevel.min}-${subLevel.max} sub-objectives. At least one should be a non-obvious structural requirement that the user probably hasn't considered.
   ${subLevel.reasoning}
7. The propellant for each sub-objective should be the entity that most accelerates THAT specific sub-path.
8. Side benefits should focus on how achieving one sub-objective helps the OTHER sub-objectives (compounding).`;

    // Ancestor chain context for recursive decomposition (depth > 1)
    if (ancestorChain && ancestorChain.length > 0) {
      const depth = ancestorChain.length + 1; // +1 for current level being generated
      const ancestorLines = ancestorChain.map(
        (a, i) =>
          `${"  ".repeat(i)}Level ${i + 1}: "${a.title}" — ${a.metric_name} (${a.current_value} → ${a.target_value})`,
      );
      system += `

ANCESTOR CHAIN (full goal hierarchy from root to parent):
${ancestorLines.join("\n")}
${"  ".repeat(ancestorChain.length)}→ YOUR LEVEL (${depth}): Decompose "${parentGoal.title}" into sub-objectives

DEPTH-AWARE RULES:
- You are generating LEVEL ${depth} objectives. Each level must be MORE SPECIFIC and ACTIONABLE than its parent.
- Do NOT repeat parent objectives at a smaller scale — each sub-objective must address a DISTINCT mechanism or constraint.
- At depth ${depth}, focus on ${depth >= 3 ? "CONCRETE TASKS and DELIVERABLES completable in 1-2 weeks" : depth >= 2 ? "SPECIFIC WORKSTREAMS completable in 2-6 weeks" : "STRATEGIC PILLARS achievable in 1-3 months"}.
- The causal chain should trace from YOUR sub-objectives through the parent goal up to the root objective.`;
    }

    // Sibling awareness — avoid duplicating existing accepted sub-objectives
    if (existingSiblings && existingSiblings.length > 0) {
      const siblingLines = existingSiblings
        .map(
          (s) =>
            `- "${s.title}" [${s.status}] — ${s.metric_name} (${s.current_value}/${s.target_value})`,
        )
        .slice(0, 10);
      system += `

EXISTING SUB-OBJECTIVES (already accepted — DO NOT duplicate these):
${siblingLines.join("\n")}

Instead of duplicating, identify:
1. GAPS — critical paths not covered by existing sub-objectives
2. REFINEMENTS — areas where existing sub-objectives could be further decomposed
3. NEW DISCOVERIES — objectives that emerged from new analysis data`;
    }
  }

  // ═══ BUILD CONTEXT ═══

  const parts: string[] = [];

  // ── Graph structure (entities + edges for causal chain tracing) ──
  if (entities && entities.length > 0) {
    // Include entity properties that matter for reasoning
    const entityLines = entities
      .sort((a, b) => (a.centrality_rank ?? 99) - (b.centrality_rank ?? 99))
      .slice(0, 50)
      .map((e) => {
        const flags: string[] = [];
        if (e.is_leverage_point) flags.push("LEVERAGE");
        if (e.is_risk_point) flags.push("RISK");
        if (e.is_master_bottleneck) flags.push("BOTTLENECK");
        if (e.importance === "fundamental" || e.importance === "critical") flags.push(e.importance.toUpperCase());
        if (e.knowledge_layer === "external") flags.push("EXTERNAL");

        const temporal = e.temporal_validity as Record<string, unknown> | null;
        if (temporal?.temporal_scope) flags.push(`temporal:${temporal.temporal_scope}`);

        return `  ${e.entity_id}: "${e.name}" [${flags.join(", ") || "—"}] conf=${e.confidence} blast=${e.blast_radius} centrality=${e.centrality_rank ?? "?"}${e.description ? ` — ${e.description.slice(0, 250)}` : ""}`;
      });
    parts.push(`ENTITIES (${entities.length} total, showing top ${entityLines.length} by centrality):\n${entityLines.join("\n")}`);
  }

  if (edges && edges.length > 0) {
    // Include edges with utility information for causal reasoning
    const edgeLines = edges
      .filter((e) => (e.confidence ?? 0) > 0.3)
      .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
      .slice(0, 80)
      .map((e) => {
        const utility = e.utility as Record<string, unknown> | null;
        const utilParts: string[] = [];
        if (utility?.actionability) utilParts.push(`act:${utility.actionability}`);
        if (utility?.failure_consequence) utilParts.push(`fail:${utility.failure_consequence}`);
        if (utility?.propagation_speed) utilParts.push(`speed:${utility.propagation_speed}`);
        if (utility?.decision_question) utilParts.push(`decision:"${String(utility.decision_question).slice(0, 60)}"`);

        const condStr = e.conditions ? (typeof e.conditions === "string" ? e.conditions : JSON.stringify(e.conditions)) : "";
        return `  ${e.source_entity_id} →[${e.relationship_type ?? "?"}/${e.dimension ?? "?"}/${e.polarity ?? "?"}]→ ${e.target_entity_id} str=${e.strength ?? "?"}${utilParts.length ? ` (${utilParts.join(", ")})` : ""}${e.is_tradeoff ? " TRADEOFF" : ""}${condStr ? ` IF: ${condStr.slice(0, 60)}` : ""}`;
      });
    parts.push(`EDGES — CAUSAL STRUCTURE (${edges.length} total, showing ${edgeLines.length} strongest):\nUse these to trace causal chains. Follow the arrows to find convergence points.\n${edgeLines.join("\n")}`);
  }

  if (cycles && cycles.length > 0) {
    const cycleLines = cycles.map((c) => {
      const ents = c.entity_ids ?? [];
      return `  ${c.classification}: ${ents.join(" → ")} → (loop)${c.name ? ` "${c.name}"` : ""}${c.growth_type ? ` growth=${c.growth_type}` : ""}${c.estimated_multiplier ? ` mult=${c.estimated_multiplier}x` : ""}${c.intervention_point_entity_id ? ` intervene_at=${c.intervention_point_entity_id}` : ""}`;
    });
    parts.push(`FEEDBACK CYCLES (${cycles.length}):\nThese show self-reinforcing or self-correcting dynamics. Loops that get activated by an intervention create compounding side benefits.\n${cycleLines.join("\n")}`);
  }

  // ── Synthesis findings ──
  if (synthesisData.master_bottleneck) {
    const b = synthesisData.master_bottleneck;
    parts.push(`MASTER BOTTLENECK: ${b.entity_id} — ${b.summary} (blast_radius=${b.blast_radius})${b.reasoning?.length ? `\n  Why: ${b.reasoning.join("; ")}` : ""}`);
  }

  if (synthesisData.leverage_points?.length) {
    const lines = synthesisData.leverage_points.map(
      (lp) => `  - ${lp.entity_id}${lp.entity_name ? ` (${lp.entity_name})` : ""}: ${lp.summary}${lp.how_it_works?.length ? `\n    Mechanism: ${lp.how_it_works.join("; ")}` : ""}${lp.connections?.length ? `\n    Connects to: ${lp.connections.join(", ")}` : ""}`
    );
    parts.push(`LEVERAGE POINTS (${synthesisData.leverage_points.length}):\n${lines.join("\n")}`);
  }

  if (synthesisData.risk_points?.length) {
    const lines = synthesisData.risk_points.map(
      (rp) => `  - ${rp.entity_id}${rp.entity_name ? ` (${rp.entity_name})` : ""}: ${rp.summary} (blast=${rp.blast_radius})${rp.how_it_fails?.length ? `\n    Failure mode: ${rp.how_it_fails.join("; ")}` : ""}${rp.connections?.length ? `\n    Connects to: ${rp.connections.join(", ")}` : ""}`
    );
    parts.push(`RISK POINTS (${synthesisData.risk_points.length}):\n${lines.join("\n")}`);
  }

  if (synthesisData.feedback_loops?.length) {
    const lines = synthesisData.feedback_loops.map(
      (fl) => `  - ${fl.name ?? "unnamed"} [${fl.type ?? "unknown"}]: ${Array.isArray(fl.steps) ? fl.steps.join(" → ") : String(fl.steps ?? "")} → (loop)\n    ${fl.explanation ?? ""}${fl.intervention_at != null ? `\n    Intervention point: step ${fl.intervention_at}` : ""}`
    );
    parts.push(`FEEDBACK LOOPS (${synthesisData.feedback_loops.length}):\n${lines.join("\n")}`);
  }

  if (synthesisData.scenarios?.length) {
    const lines = synthesisData.scenarios.map(
      (s) => {
        const conditions = typeof s.conditions === "string" ? s.conditions : JSON.stringify(s.conditions ?? "");
        return `  - ${s.name ?? "unnamed"} [${s.probability ?? "?"}]: ${conditions} → ${s.outcome_label ?? ""}: ${s.outcome_value ?? ""}`;
      }
    );
    parts.push(`SCENARIOS (${synthesisData.scenarios.length}):\n${lines.join("\n")}`);
  }

  if (synthesisData.open_questions?.length) {
    const lines = synthesisData.open_questions.map(
      (oq) => `  - ${oq.question}: ${oq.why_it_matters}${oq.related_entity_ids?.length ? ` (entities: ${oq.related_entity_ids.join(", ")})` : ""}`
    );
    parts.push(`OPEN QUESTIONS (${synthesisData.open_questions.length}):\n${lines.join("\n")}`);
  }

  if (synthesisData.contradictions?.length) {
    const lines = synthesisData.contradictions.map(
      (c) => `  - [${c.severity}] ${c.description}`
    );
    parts.push(`CONTRADICTIONS (${synthesisData.contradictions.length}):\n${lines.join("\n")}`);
  }

  // ── Discovered connections (novel links between entities) ──
  if (synthesisData.discovered_connections?.length) {
    const lines = synthesisData.discovered_connections.map(
      (dc) => `  - ${dc.source_entity_id} ↔ ${dc.target_entity_id} [${dc.strength}]: ${dc.reasoning}`
    );
    parts.push(`DISCOVERED CONNECTIONS (novel links the decomposition found, ${synthesisData.discovered_connections.length}):\nThese are non-obvious links — they may reveal side benefits or convergence paths.\n${lines.join("\n")}`);
  }

  // ── External landscape context ──
  if (synthesisData.worth_considering?.length) {
    const lines = synthesisData.worth_considering.map(
      (wc) => `  - [${wc.type}] ${wc.title} (${wc.confidence}): ${wc.description}${wc.source_note ? ` — Source: ${wc.source_note}` : ""}${wc.connected_entities?.length ? `\n    Connected to: ${wc.connected_entities.join(", ")}` : ""}`
    );
    parts.push(`EXTERNAL KNOWLEDGE — WORTH CONSIDERING (${synthesisData.worth_considering.length}):\n${lines.join("\n")}`);
  }

  if (synthesisData.cross_context_insights?.length) {
    const lines = synthesisData.cross_context_insights.map(
      (cci) => `  - [${cci.confidence}] ${cci.insight} (internal: ${Array.isArray(cci.internal_entities) ? cci.internal_entities.join(", ") : String(cci.internal_entities ?? "")} ↔ external: ${Array.isArray(cci.external_entities) ? cci.external_entities.join(", ") : String(cci.external_entities ?? "")})`
    );
    parts.push(`CROSS-CONTEXT INSIGHTS (internal ↔ external connections, ${synthesisData.cross_context_insights.length}):\n${lines.join("\n")}`);
  }

  // Include potential bridges from domain research
  const sd = synthesisData as unknown as Record<string, unknown>;
  if (Array.isArray(sd.potential_bridges) && (sd.potential_bridges as unknown[]).length > 0) {
    const bridges = sd.potential_bridges as Array<{
      external_entity_id: string;
      likely_internal_concept: string;
      connection_type: string;
      reasoning: string;
    }>;
    const lines = bridges.map(
      (b) => `  - ${b.external_entity_id} → ${b.likely_internal_concept} [${b.connection_type}]: ${b.reasoning}`
    );
    parts.push(`EXTERNAL BRIDGES (domain research connections, ${bridges.length}):\n${lines.join("\n")}`);
  }

  // ── Action plan context (what the synthesis already recommends) ──
  if (synthesisData.action_plan?.paths?.length) {
    const actionSummary = synthesisData.action_plan.paths.map((path) => {
      const actionCount = path.timeframes?.reduce((sum, tf) => sum + (tf.actions?.length ?? 0), 0) ?? 0;
      return `  - ${path.label}: ${actionCount} actions`;
    }).join("\n");
    parts.push(`EXISTING ACTION PLAN:\nThese are actions the synthesis already recommends. Trace forward from these to discover side benefits.\n${actionSummary}`);
  }

  const parentContext = parentGoal
    ? `\nDETECT SUB-OBJECTIVES FOR PARENT GOAL: "${parentGoal.title}" (id: ${parentGoal.id})\nMetric: ${parentGoal.metric_name} — Current: ${parentGoal.current_value} → Target: ${parentGoal.target_value}\n\nTrace the causal chains from the graph structure TO this parent goal metric. Each sub-objective should represent a distinct causal path that contributes to the target.\n\n`
    : "";

  // Inject the user's original situation at the TOP of the user prompt for grounding
  const situationBlock = userInputText
    ? `═══ THE USER'S ORIGINAL SITUATION ═══
This is what the user actually said. Every objective you produce must be grounded in THIS reality:

${userInputText.slice(0, 3000)}

═══ END SITUATION ═══

`
    : "";

  // Phase 8: Inject framework-specific objective guidance from epistemic classification
  let frameworkObjBlock = "";
  if (epistemicClassification) {
    try {
      const { buildFrameworkObjectiveBlock } = require("@/lib/pipeline/decomposition-router");
      frameworkObjBlock = buildFrameworkObjectiveBlock(epistemicClassification);
    } catch {
      // Non-critical: skip if module not available
    }
  }

  const user = `${situationBlock}${parentContext}Using the user's situation AND the graph structure and synthesis findings below, reason through the causal chains to identify objectives that are SPECIFIC to this person's actual situation.

CRITICAL REMINDERS:
1. Read the user's situation FIRST — understand what they're actually trying to do
2. BACKWARD CHAIN from each finding — but always ask "why does this matter FOR THIS USER?"
3. Every objective title must reference something SPECIFIC from their situation (a product, a skill applied to their project, a concrete deliverable)
4. Metrics must be things THIS USER can actually measure (not abstract indices)
5. Propellants must be ACTIONABLE NEXT STEPS, not categories

${frameworkObjBlock ? frameworkObjBlock + "\n\n" : ""}${parts.join("\n\n")}`;

  return { system, user };
}
