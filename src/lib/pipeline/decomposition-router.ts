// Phase 8: Epistemic Routing Layer — Decomposition Router
// Produces framework-specific prompt blocks based on classification results

import type {
  CynefinDomain,
  EpistemicClassification,
} from "@/types/epistemic";

// ─────────────────────────────────────────────
// Cynefin Domain Guidance
// ─────────────────────────────────────────────

export function getCynefinGuidance(domain: CynefinDomain): string {
  switch (domain) {
    case "simple":
      return `COMPLEXITY CONTEXT: SIMPLE (Clear Domain)
Best practices exist and are known. Look for established cause-effect relationships.
Extract known patterns and standard operating procedures.
Flag any deviations from best practice — these are likely errors, not innovations.
Recommendations should reference established methods. Do NOT over-complicate.`;

    case "complicated":
      return `COMPLEXITY CONTEXT: COMPLICATED (Expert Domain)
Multiple right answers exist — requires expertise to evaluate tradeoffs.
Extract the expert knowledge needed to analyze this situation.
Identify analytical frameworks that apply and where expert disagreement exists.
Recommendations should present options with tradeoffs, not single answers.`;

    case "complex":
      return `COMPLEXITY CONTEXT: COMPLEX (Emergent Domain)
Cause and effect are only knowable in retrospect. The system exhibits emergence.
Extract emergent patterns and feedback loops that create non-linear behavior.
Identify safe-to-fail experiments that could reveal system dynamics.
DO NOT recommend "best practices" — they don't exist in complex domains.
Instead, recommend PROBES: small, reversible actions that generate learning.
Flag any recommendation that assumes predictable outcomes — it's likely wrong.`;

    case "chaotic":
      return `COMPLEXITY CONTEXT: CHAOTIC (Novel Domain)
No discernible cause-effect patterns. Stability must be established first.
Extract immediate constraints and the most urgent actions needed.
Focus on establishing anchor points and basic stability before analyzing.
DO NOT generate elaborate strategy — identify what to do RIGHT NOW.
Recommendations must be: immediate, actionable, and stabilizing.`;

    case "disorder":
      return `COMPLEXITY CONTEXT: DISORDER (Unclear Domain)
Cannot yet determine which complexity domain applies.
Extract multiple possible framings of the situation.
Flag where different framings would lead to different conclusions.
Recommendations should focus on CLARIFYING which domain this is.`;
  }
}

// ─────────────────────────────────────────────
// Decomposition Framework Block
// ─────────────────────────────────────────────

/**
 * Build framework-specific prompt blocks for decomposition.
 * Returns "" when classification is null (backward compat).
 */
export function buildFrameworkDecompBlock(
  classification: EpistemicClassification | null
): string {
  if (!classification) return "";

  const sections: string[] = [];
  const strategy = classification.decomposition_strategy;

  // ── Section 0: Input Type Context ──
  sections.push(
    `INPUT CLASSIFICATION: ${classification.input_type.toUpperCase()} (confidence: ${(classification.input_type_confidence * 100).toFixed(0)}%)
Signals: ${classification.input_type_signals.join(", ")}`
  );

  // ── Section 1: Cynefin Guidance (always) ──
  sections.push(getCynefinGuidance(classification.cynefin_domain));

  // ── Section 2: Toulmin Layer ──
  if (strategy.use_toulmin_layer) {
    sections.push(`ARGUMENT STRUCTURE ANALYSIS (Toulmin Framework):
This input contains argumentative structure (${classification.toulmin.claim_count} claims detected).
In addition to standard entity extraction, apply the following:

CLAIM ENTITIES: Extract every assertion, thesis, or conclusion as an entity. Tag each with:
  - toulmin_role: "claim"
  - Set entity_category to "epistemic"
  - Note claim strength in description: definitive, hedged, or conditional

GROUND ENTITIES: Extract evidence, data, and facts supporting each claim:
  - toulmin_role: "ground"
  - Note ground type in description: empirical, statistical, anecdotal, authoritative, or logical
  - Note ground quality: verified (peer-reviewed/replicated), cited (referenced), claimed (stated without source), unverified

WARRANT ENTITIES: Extract the reasoning connecting grounds to claims:
  - toulmin_role: "warrant"
  - Note warrant type: causal, analogical, categorical, precedent, or principle
  - Mark whether the warrant is EXPLICIT (stated in text) or IMPLICIT (you inferred it)

QUALIFIER ENTITIES: Extract hedges, scope limitations, confidence bounds:
  - toulmin_role: "qualifier"

REBUTTAL ENTITIES: Extract counterarguments, exceptions, objections:
  - toulmin_role: "rebuttal"

ARGUMENT CHAIN EDGES: For every claim, create these edges:
  - ground --[supports]--> claim (strength based on ground quality)
  - warrant --[justifies]--> claim (strength based on warrant explicitness)
  - rebuttal --[challenges]--> claim (always include if present)
  - qualifier --[limits]--> claim (narrows scope)

ANTI-ORPHAN RULE: Every claim MUST have at least one ground. If a claim has no evidence, create a MISSING_GROUND entity (epistemic_status: "speculated") and connect it.`);
  }

  // ── Section 3: Pearl Causal Layer ──
  if (strategy.use_pearl_causal_layer) {
    sections.push(`CAUSAL HIERARCHY ANALYSIS (Pearl's Ladder of Causation):
Classification detected causal depth: ${classification.causal_depth.toUpperCase()}

For EVERY edge with dimension "causal", "functional", or relationship_type containing "causes", "enables", "triggers", "inhibits":
Classify by Pearl's three rungs and set pearl_level:

  ASSOCIATION (rung 1): "X and Y tend to co-occur"
    - Correlational, no intervention claim
    - pearl_level: "association"
    - CONSTRAINT: Association edges CANNOT support action recommendations (they predict but don't cause)

  INTERVENTION (rung 2): "If we DO X, Y will change"
    - Requires naming a MECHANISM — not just "A affects B" but HOW
    - pearl_level: "intervention"
    - CONSTRAINT: Every intervention edge must describe the mechanism in its conditions field

  COUNTERFACTUAL (rung 3): "If X had NOT happened, Y would not have occurred"
    - Strongest causal claim — requires but-for reasoning
    - pearl_level: "counterfactual"
    - CONSTRAINT: Must pass the removal test — if you mentally remove X, does Y actually disappear?

CONFOUNDER CHECK: For every causal edge, ask: "Is there a third variable Z that causes BOTH X and Y?"
If yes: Create Z as a [CONFOUNDER] entity (epistemic_status: "theorized", entity_category: "epistemic") and add edges:
  - Z --[confounds]--> source entity (causal, pearl_level: "association")
  - Z --[confounds]--> target entity (causal, pearl_level: "association")

CAUSAL CHAIN VALIDATION: If a chain of causal edges exists (A→B→C), verify that each link maintains or increases causal rigor. A counterfactual conclusion cannot rest on merely associational premises.`);
  }

  // ── Section 4: Marr Decomposition ──
  if (strategy.use_marr_decomposition) {
    sections.push(`MULTI-LEVEL DECOMPOSITION (Marr's Three Levels):
Applicable levels: ${classification.marr_levels.join(", ").toUpperCase()}

For each relevant entity, tag its analysis level with marr_level:

  COMPUTATIONAL: What is the GOAL of this component? What problem does it solve? What are the constraints?
    - marr_level: "computational"
    - Focus on: objectives, requirements, success criteria, constraints
    - Example: "User authentication" at computational level = "verify user identity with <1% false positive rate"

  ALGORITHMIC: HOW does it achieve the goal? What strategy, representation, or process is used?
    - marr_level: "algorithmic"
    - Focus on: approaches, methods, algorithms, workflows, decision procedures
    - Example: "User authentication" at algorithmic level = "OAuth 2.0 flow with JWT tokens and refresh rotation"

  IMPLEMENTATIONAL: How is it PHYSICALLY/TECHNICALLY realized? What technology implements it?
    - marr_level: "implementational"
    - Focus on: specific technologies, tools, infrastructure, resources, materials
    - Example: "User authentication" at implementational level = "Auth0 SDK + PostgreSQL session store + Redis token cache"

CROSS-LEVEL EDGES: Create edges between levels:
  - computational --[specifies]--> algorithmic ("the WHAT constrains the HOW")
  - algorithmic --[implemented_by]--> implementational ("the HOW is realized by the WITH WHAT")

ANTI-CONFLATION RULE: NEVER mix levels in the same entity. If an entity describes BOTH what something does AND how it does it, split it into separate entities at each level and connect them with cross-level edges.`);
  }

  // ── Section 5: Epistemic Status Enhancement (always when classified) ──
  sections.push(`ENHANCED EPISTEMIC STATUS TRACKING:
Beyond the standard source_tag (explicit/implicit/assumed), assign each entity a formal epistemic_status:

  OBSERVED: Directly measured, experienced, or documented with verifiable evidence.
    - The entity represents a fact that has been independently verified.
    - Examples: published metrics, experimental results, documented events.

  INFERRED: Logically derived from observed facts, but not directly observed itself.
    - The reasoning from observations to this entity is explicit and traceable.
    - Examples: calculated metrics, logical consequences, derived constraints.

  THEORIZED: Based on an established framework or theory, but not tested in this specific context.
    - A recognized model or theory predicts this entity's existence/behavior.
    - Examples: theoretical constructs, framework-derived entities, model predictions.

  SPECULATED: Plausible conjecture without strong evidence or theoretical backing.
    - Reasonable but untested. Could go either way.
    - Examples: hypotheses, guesses, "might be" claims, unverified assumptions.

  CONTESTED: Multiple credible perspectives actively disagree about this entity.
    - Not just uncertain — actively debated with competing evidence.
    - Examples: controversial claims, conflicting data, paradigm disputes.

Apply this to EVERY entity. The distribution should roughly match: ${JSON.stringify(classification.evidence_distribution)}`);

  // ── Section 6: Entity & Edge Emphasis ──
  if (strategy.entity_emphasis.length > 0 || strategy.edge_emphasis.length > 0) {
    const emphParts: string[] = [];
    if (strategy.entity_emphasis.length > 0) {
      emphParts.push(`PRIORITIZE these entity types: ${strategy.entity_emphasis.join(", ")}`);
    }
    if (strategy.edge_emphasis.length > 0) {
      emphParts.push(`PRIORITIZE these edge types: ${strategy.edge_emphasis.join(", ")}`);
    }
    sections.push(`INPUT-SPECIFIC EXTRACTION PRIORITIES:\n${emphParts.join("\n")}`);
  }

  return sections.join("\n\n");
}

// ─────────────────────────────────────────────
// Synthesis Framework Block
// ─────────────────────────────────────────────

/**
 * Build framework-specific prompt blocks for synthesis.
 * Returns "" when classification is null (backward compat).
 */
export function buildFrameworkSynthesisBlock(
  classification: EpistemicClassification | null
): string {
  if (!classification) return "";

  const sections: string[] = [];

  // Input-type-specific synthesis guidance
  switch (classification.input_type) {
    case "research_paper":
      sections.push(`RESEARCH PAPER SYNTHESIS GUIDANCE:
• Evaluate evidence hierarchy: empirical > statistical > theoretical > anecdotal > assumed.
• Distinguish correlation from causation — use pearl_level annotations on edges.
• Flag claims without warrants as potential blind spots.
• Weight findings by epistemic_status: observed > inferred > theorized > speculated.
• Leverage points should cite their evidentiary basis.
• Risk points should note methodological limitations.
• Worth_considering should reference replication status and external validity.`);
      break;
    case "business_problem":
      sections.push(`BUSINESS PROBLEM SYNTHESIS GUIDANCE:
• Focus on actionability and resource constraints — every recommendation needs a concrete first step.
• Quantify impact where possible (revenue, time, cost, user count).
• Leverage points must be tied to measurable business outcomes.
• Risk points must include blast_radius in business terms (revenue impact, customer loss, timeline delay).
• Action plans should respect resource constraints mentioned in input.
• Worth_considering should include competitive precedents and market analogies.`);
      break;
    case "argument":
      sections.push(`ARGUMENT SYNTHESIS GUIDANCE:
• Map claim-evidence-warrant chains. Identify the WEAKEST warrants.
• Surface unstated assumptions — these are often where arguments break.
• Every leverage point must cite its evidentiary basis (which grounds support it?).
• Contradictions are especially important — flag where claims contradict each other.
• Risk points should focus on logical vulnerabilities (unfalsifiable claims, circular reasoning, missing rebuttals).
• Open questions should target evidence gaps (what data would strengthen/weaken the argument?).`);
      break;
    case "question":
      sections.push(`QUESTION SYNTHESIS GUIDANCE:
• Structure findings around ANSWERING the question, not just analyzing related topics.
• Leverage points = factors that most influence the answer.
• Risk points = things that could make the "obvious" answer wrong.
• Scenarios should represent different possible answers with their conditions.
• Action plan should help the user DECIDE or UNDERSTAND, not just act.`);
      break;
  }

  // Cynefin-aware synthesis
  if (classification.cynefin_domain === "complex") {
    sections.push(`COMPLEX DOMAIN SYNTHESIS:
• PROBE-SENSE-RESPOND: Do NOT recommend best practices — they don't exist here.
• Recommend safe-to-fail EXPERIMENTS instead of definitive strategies.
• Surface emergence patterns and feedback loop sensitivities.
• Action plan timeframes should be shorter (rapid iteration, not long-term planning).
• Flag any recommendation that assumes predictable outcomes.`);
  } else if (classification.cynefin_domain === "chaotic") {
    sections.push(`CHAOTIC DOMAIN SYNTHESIS:
• ACT-SENSE-RESPOND: Focus on immediate stabilization actions.
• Do NOT generate elaborate long-term strategy.
• Identify anchor points — what can we stabilize first?
• Leverage points = things that create stability.
• Risk points = things that deepen the chaos.
• Action plan should have ONE immediate path, not multiple options.`);
  }

  // Pearl causal awareness
  if (classification.causal_depth !== "association") {
    sections.push(`CAUSAL RIGOR CHECK (Pearl Level: ${classification.causal_depth}):
• Verify that leverage points rest on intervention or counterfactual edges, not mere association.
• Any recommendation built on associational edges should be flagged with a caveat.
• Action plans must name the MECHANISM by which each action produces its effect.`);
  }

  return sections.join("\n\n");
}

// ─────────────────────────────────────────────
// Objective Detection Framework Block
// ─────────────────────────────────────────────

/**
 * Build framework-specific prompt blocks for objective detection.
 * Returns "" when classification is null (backward compat).
 */
export function buildFrameworkObjectiveBlock(
  classification: EpistemicClassification | null
): string {
  if (!classification) return "";

  const sections: string[] = [];

  // Input-type-specific objective templates
  const templates: Record<string, string> = {
    research_paper: `INPUT TYPE: RESEARCH PAPER
Preferred objective types: validate, explore, build
Templates:
  • "Validate [specific hypothesis] using [methodology from paper]" (validate)
  • "Extend [finding] to [new domain/context]" (explore)
  • "Apply [methodology] to [user's specific problem]" (build)
  • "Challenge [assumption] by testing [alternative hypothesis]" (validate)
Objectives should reference specific claims, methods, or findings from the input.`,
    business_problem: `INPUT TYPE: BUSINESS PROBLEM
Preferred objective types: maximize, build, minimize, defend
Templates:
  • "Grow [specific metric] from [baseline] to [target]" (maximize)
  • "Build [specific product/feature/capability]" (build)
  • "Reduce [cost/churn/risk metric] below [threshold]" (minimize)
  • "Defend [competitive advantage] against [specific threat]" (defend)
Objectives MUST have concrete, measurable metrics — not abstract scores.`,
    argument: `INPUT TYPE: ARGUMENT
Preferred objective types: validate, explore, build
Templates:
  • "Strengthen [specific claim] with [type of evidence needed]" (build)
  • "Address [specific rebuttal/objection]" (defend)
  • "Find [empirical/statistical] evidence for [warrant]" (validate)
  • "Qualify scope of [claim] to account for [limitation]" (explore)
Objectives should target the weakest links in the argument chain.`,
    question: `INPUT TYPE: QUESTION
Preferred objective types: explore, validate, maximize
Templates:
  • "Answer [the core question] by evaluating [key tradeoffs]" (explore)
  • "Evaluate [option A] vs [option B] on [criteria]" (validate)
  • "Make [specific decision] with [confidence level] certainty" (maximize)
Objectives should move toward ANSWERING the question, not just analyzing it.`,
  };

  const template = templates[classification.input_type];
  if (template) {
    sections.push(template);
  }

  // Include preliminary objectives as refinement context
  if (classification.preliminary_objectives.length > 0) {
    const objLines = classification.preliminary_objectives.map(
      (o) => `  • ${o.title} (${o.objective_type}, confidence: ${o.confidence}): ${o.rationale}`
    );
    sections.push(`PRELIMINARY OBJECTIVES (detected pre-decomposition — refine, validate, or replace):
${objLines.join("\n")}

These were detected BEFORE the full graph analysis. Now that you have the complete entity/edge/cycle structure:
1. CONFIRM objectives that the graph analysis supports (keep with increased confidence)
2. MODIFY objectives where the graph reveals nuances the pre-analysis missed
3. REPLACE objectives that the full analysis shows were misguided
4. ADD new objectives that only the graph structure could reveal`);
  }

  return sections.join("\n\n");
}
