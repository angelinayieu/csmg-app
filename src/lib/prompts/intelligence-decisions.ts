/**
 * Intelligence Decision & Meta-Intelligence Prompts
 *
 * Three prompt generators:
 * 1. Decision specificity — converts signal clusters into concrete decision forks
 * 2. Meta-intelligence — extracts core tension, unknowns, contradictions
 * 3. Structural patterns — identifies triads and archetypes (optional enrichment)
 */

// ── Decision Specificity Prompt ──

export function getDecisionSpecificityPrompt(params: {
  signalDescriptions: string[];
  connectionSummaries: string[];
  strategyContext: string;
  entityNames: string[];
  maxDecisions: number;
}): { system: string; user: string } {
  const system = `You are a strategic intelligence analyst. Your job is to convert vague intelligence signals into concrete, actionable decision forks.

Each decision must be specific enough that a busy executive could read it and immediately understand:
1. What QUESTION needs answering
2. What OPTIONS exist (2-4, not abstract)
3. What TRADEOFFS each option involves
4. Which option you RECOMMEND and why
5. What CONCRETE NEXT STEP to take and by when

CRITICAL RULES:
- Never produce abstract advice like "investigate further" or "monitor trends"
- Every option must be a specific action, not a category of actions
- Tradeoffs must name specific entities or mechanisms, not generic risks
- Next steps must be executable in 1-2 days
- Due windows: "now" = within 48 hours, "this_week" = within 7 days, "this_month" = within 30 days
- Confidence: 0.0-1.0 based on evidence quality. Below 0.4 = speculative, flag it.

Return ONLY valid JSON, no markdown fencing.`;

  const user = [
    `Convert these intelligence signals into ${params.maxDecisions} concrete decision forks.`,
    ``,
    `SIGNALS:`,
    ...params.signalDescriptions.map((s, i) => `${i + 1}. ${s}`),
    ``,
    params.connectionSummaries.length > 0
      ? `CONNECTION CONTEXT:\n${params.connectionSummaries.join("\n")}`
      : null,
    ``,
    params.strategyContext
      ? `STRATEGY CONTEXT:\n${params.strategyContext}`
      : null,
    ``,
    `ENTITIES INVOLVED: ${params.entityNames.join(", ")}`,
    ``,
    `Return JSON:`,
    `{`,
    `  "decisions": [`,
    `    {`,
    `      "entity_id": "the primary entity this decision is about",`,
    `      "entity_name": "entity name",`,
    `      "decision_question": "Specific yes/no or A/B/C question",`,
    `      "options": [`,
    `        {`,
    `          "id": "opt_1",`,
    `          "label": "Short label (3-5 words)",`,
    `          "description": "What this option means concretely",`,
    `          "upside": "Specific benefit",`,
    `          "downside": "Specific cost or risk",`,
    `          "effort": "low|medium|high",`,
    `          "reversibility": "high|medium|low"`,
    `        }`,
    `      ],`,
    `      "tradeoffs": ["Named tradeoff 1", "Named tradeoff 2"],`,
    `      "recommended_option_id": "opt_1",`,
    `      "recommended_reason": "Why this option, referencing specific entities",`,
    `      "next_action": "Concrete step executable in 1-2 days",`,
    `      "due_window": "now|this_week|this_month",`,
    `      "confidence": 0.7,`,
    `      "evidence_level": "stated|inferred|predicted",`,
    `      "evidence_refs": ["entity or edge names that support this"],`,
    `      "affected_entities": ["entity_ids affected by this decision"]`,
    `    }`,
    `  ]`,
    `}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}

// ── Meta-Intelligence Prompt ──

export function getMetaIntelligencePrompt(params: {
  entitySummaries: string[];
  edgeSummaries: string[];
  signalSummaries: string[];
  leveragePoints: string[];
  riskPoints: string[];
  cycleSummaries: string[];
}): { system: string; user: string } {
  const system = `You are a systems thinking analyst. Analyze the knowledge graph structure to extract META-level intelligence — the tensions, unknowns, and contradictions that exist BETWEEN the data points, not just within them.

CORE TENSION: The single most important strategic tension in this system. A tension is two legitimate but opposing forces that cannot both be maximized. Example: "Speed of expansion vs. quality of integration" — not vague, tied to specific entities.

UNKNOWNS: Things the system SHOULD know but DOESN'T. Not generic "more research needed" — specific questions whose answers would change decisions. Each unknown must have a concrete "next probe" action.

CONTRADICTIONS: Places where the system's own data conflicts with itself. Entity A says X, but Entity B's behavior implies not-X. These are high-value because resolving them changes multiple downstream conclusions.

Return ONLY valid JSON, no markdown fencing.`;

  const user = [
    `Analyze this knowledge graph for meta-intelligence:`,
    ``,
    `ENTITIES (${params.entitySummaries.length}):`,
    ...params.entitySummaries.slice(0, 20).map((s) => `- ${s}`),
    ``,
    `KEY RELATIONSHIPS (${params.edgeSummaries.length}):`,
    ...params.edgeSummaries.slice(0, 15).map((s) => `- ${s}`),
    ``,
    params.leveragePoints.length > 0
      ? `LEVERAGE POINTS: ${params.leveragePoints.join(", ")}`
      : null,
    params.riskPoints.length > 0
      ? `RISK POINTS: ${params.riskPoints.join(", ")}`
      : null,
    params.cycleSummaries.length > 0
      ? `FEEDBACK LOOPS:\n${params.cycleSummaries.join("\n")}`
      : null,
    ``,
    params.signalSummaries.length > 0
      ? `ACTIVE SIGNALS:\n${params.signalSummaries.join("\n")}`
      : null,
    ``,
    `Return JSON:`,
    `{`,
    `  "core_tension": {`,
    `    "title": "X vs Y (specific entities named)",`,
    `    "description": "2-3 sentences: why these forces conflict and why it matters",`,
    `    "entity_ids": ["entities at the heart of this tension"]`,
    `  },`,
    `  "unknowns": [`,
    `    {`,
    `      "id": "unk_1",`,
    `      "question": "Specific question whose answer changes decisions",`,
    `      "impact": "low|medium|high",`,
    `      "next_probe": "Concrete action to resolve this unknown",`,
    `      "status": "open"`,
    `    }`,
    `  ],`,
    `  "contradictions": [`,
    `    {`,
    `      "id": "contra_1",`,
    `      "a": "What entity/data A claims (with entity name)",`,
    `      "b": "What entity/data B implies (with entity name)",`,
    `      "why_it_matters": "What downstream conclusions change if resolved",`,
    `      "resolution_paths": ["Option 1", "Option 2"],`,
    `      "confidence": 0.6`,
    `    }`,
    `  ]`,
    `}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}

// ── Structural Patterns Prompt ──

export function getStructuralPatternsPrompt(params: {
  entitySummaries: string[];
  edgeSummaries: string[];
  cycleSummaries: string[];
  intersectionSummaries: string[];
  /** Pre-computed deterministic findings from V1 signal extraction to ground analysis */
  v1DetectorContext?: string[];
}): { system: string; user: string } {
  const system = `You are a structural pattern analyst specializing in system archetypes and triadic relationships.

TRIADS: Three-entity patterns where one entity mediates, moderates, or commonly causes the relationship between the other two. These reveal hidden control points.
- mediator: A→B→C (B mediates A's effect on C)
- moderator: A→C is stronger/weaker depending on B
- common_cause: B←A→C (A drives both B and C, creating spurious correlation)
- feedback_triad: A→B→C→A (three-node reinforcing cycle)

ARCHETYPES: Known system patterns from systems thinking:
- flywheel: Reinforcing loop that compounds over time
- bottleneck: Single constraint limiting the whole system
- cold_start: System needs critical mass before it works
- principal_agent: Misaligned incentives between controller and executor
- network_effects: Value increases with each additional node

For each finding, provide EVIDENCE (specific entities/edges supporting it) and COUNTEREVIDENCE (what doesn't fit).

Return ONLY valid JSON, no markdown fencing.`;

  const user = [
    `Identify structural patterns in this graph:`,
    ``,
    `ENTITIES:`,
    ...params.entitySummaries.slice(0, 20).map((s) => `- ${s}`),
    ``,
    `RELATIONSHIPS:`,
    ...params.edgeSummaries.slice(0, 20).map((s) => `- ${s}`),
    ``,
    params.cycleSummaries.length > 0
      ? `CYCLES:\n${params.cycleSummaries.join("\n")}`
      : null,
    params.intersectionSummaries.length > 0
      ? `PROBABILITY SPACE INTERSECTIONS:\n${params.intersectionSummaries.join("\n")}`
      : null,
    params.v1DetectorContext && params.v1DetectorContext.length > 0
      ? `\nPRE-COMPUTED STRUCTURAL ANALYSIS (deterministic graph detectors already identified these — use as grounding, do NOT just re-state them):\n${params.v1DetectorContext.join("\n")}\n\nImportant: These are ALGORITHMIC findings. Your job is to add SEMANTIC meaning — explain WHY these patterns matter strategically, whether they form higher-order archetypes, and what triadic relationships they reveal.`
      : null,
    ``,
    `Return JSON:`,
    `{`,
    `  "triads": [`,
    `    {`,
    `      "id": "triad_1",`,
    `      "a": "entity_id_1",`,
    `      "b": "entity_id_2 (the mediator/moderator/common cause)",`,
    `      "c": "entity_id_3",`,
    `      "pattern_type": "mediator|moderator|common_cause|feedback_triad",`,
    `      "confidence": 0.7,`,
    `      "rationale": "Why this triad matters and what control lever it reveals"`,
    `    }`,
    `  ],`,
    `  "archetype_matches": [`,
    `    {`,
    `      "id": "arch_1",`,
    `      "name": "flywheel|bottleneck|cold_start|principal_agent|network_effects",`,
    `      "fit_score": 0.8,`,
    `      "evidence": ["Specific entity/edge supporting this match"],`,
    `      "counterevidence": ["What doesn't fit this pattern"]`,
    `    }`,
    `  ]`,
    `}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}

// ── Narrative Synthesis Prompt ──

export function getNarrativeSynthesisPrompt(params: {
  coreTensionTitle: string | null;
  coreTensionDescription: string | null;
  unknownQuestions: string[];
  contradictionSummaries: string[];
  decisionQuestions: string[];
  triadDescriptions: string[];
  archetypeDescriptions: string[];
  signalCount: number;
  entityCount: number;
  layerBreakdown?: {
    internal_count: number;
    conceptual_count: number;
    external_count: number;
    cross_layer_edges: number;
    validation_chains: number;
    layer_tensions: number;
  };
}): { system: string; user: string } {
  const system = `You are an intelligence analyst writing a brief for a decision-maker. Your job is to connect the dots between findings into a coherent narrative.

RULES:
- Write 2-4 sentences for the executive_summary that CONNECTS findings (don't just list them)
- The narrative should tell a STORY: "Because X tension exists, Y unknown becomes critical, and Z contradiction suggests..."
- change_summary: null if this is the first analysis, otherwise 1-2 sentences on what shifted
- attention_items: Top 3 things requiring attention, ranked by urgency. Each must cite a source (decision, contradiction, unknown, archetype, triad, or signal)
- Be concrete: name specific entities and patterns, not abstract categories
- Be brief: executives scan, they don't read
${params.layerBreakdown ? `
LAYER AWARENESS:
The system has 3 knowledge layers. When connecting findings, reference which layer insights come from:
- User Assets (internal): What the user's system contains
- Concept Model (conceptual): How things work — mechanisms from entity expansion
- Research (external): External evidence and sources
The most valuable insights connect across layers: "Research shows X, which challenges mechanism Y, putting asset Z at risk."` : ""}

Return ONLY valid JSON, no markdown fencing.`;

  const user = [
    `Synthesize these intelligence findings into a cohesive narrative:`,
    ``,
    params.coreTensionTitle
      ? `CORE TENSION: ${params.coreTensionTitle}\n${params.coreTensionDescription ?? ""}`
      : `CORE TENSION: None identified`,
    ``,
    params.unknownQuestions.length > 0
      ? `KEY UNKNOWNS (${params.unknownQuestions.length}):\n${params.unknownQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
      : null,
    params.contradictionSummaries.length > 0
      ? `CONTRADICTIONS (${params.contradictionSummaries.length}):\n${params.contradictionSummaries.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : null,
    params.decisionQuestions.length > 0
      ? `PENDING DECISIONS (${params.decisionQuestions.length}):\n${params.decisionQuestions.map((d, i) => `${i + 1}. ${d}`).join("\n")}`
      : null,
    params.triadDescriptions.length > 0
      ? `STRUCTURAL PATTERNS:\n${params.triadDescriptions.join("\n")}`
      : null,
    params.archetypeDescriptions.length > 0
      ? `SYSTEM ARCHETYPES:\n${params.archetypeDescriptions.join("\n")}`
      : null,
    ``,
    params.layerBreakdown
      ? `LAYER BREAKDOWN: ${params.layerBreakdown.internal_count} user assets, ${params.layerBreakdown.conceptual_count} concept model entities, ${params.layerBreakdown.external_count} research entities, ${params.layerBreakdown.cross_layer_edges} cross-layer edges, ${params.layerBreakdown.validation_chains} validation chains, ${params.layerBreakdown.layer_tensions} layer tensions`
      : null,
    `SCOPE: ${params.entityCount} entities, ${params.signalCount} active signals.`,
    ``,
    `Return JSON:`,
    `{`,
    `  "executive_summary": "2-4 sentences connecting the key findings into a coherent narrative",`,
    `  "change_summary": null,`,
    `  "attention_items": [`,
    `    {`,
    `      "title": "Short title (5-8 words)",`,
    `      "reason": "Why this needs attention now (1-2 sentences)",`,
    `      "entity_ids": ["entity_ids involved"],`,
    `      "source": "decision|contradiction|unknown|archetype|triad|signal"`,
    `    }`,
    `  ]`,
    `}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}

// ── Landscape Clustering Prompt ──

export function getLandscapeClusteringPrompt(params: {
  entityDescriptions: string[];
  edgeSummaries: string[];
  coreTensionTitle: string | null;
}): { system: string; user: string } {
  const system = `You are an intelligence analyst. Given a set of entities and their relationships from a knowledge graph, identify 5-8 semantic theme clusters that represent the key conceptual areas of this intelligence landscape.

RULES:
- Each cluster should be a meaningful DOMAIN AREA relevant to the user's scope — not a metadata type
- Clusters should be named with short, clear labels (2-4 words) that a decision-maker would recognize
- Every entity must belong to exactly one cluster
- signal_strength (0-1) reflects how much intelligence activity concentrates in this cluster — based on entity count, connection density, and strategic importance
- Aim for 5-8 clusters. Fewer if the landscape is narrow, more if it's broad
- Labels should be specific to this user's domain, not generic categories like "Technology" or "Market"

Return ONLY valid JSON, no markdown fencing.`;

  const user = [
    `Identify semantic theme clusters for this intelligence landscape:`,
    ``,
    `ENTITIES:`,
    ...params.entityDescriptions.slice(0, 60).map((s, i) => `${i + 1}. ${s}`),
    ``,
    params.edgeSummaries.length > 0
      ? `KEY RELATIONSHIPS:\n${params.edgeSummaries.slice(0, 30).join("\n")}`
      : null,
    ``,
    params.coreTensionTitle
      ? `CORE TENSION: ${params.coreTensionTitle}`
      : null,
    ``,
    `Return JSON:`,
    `{`,
    `  "clusters": [`,
    `    {`,
    `      "id": "cluster_short_name",`,
    `      "label": "Human-Readable Label",`,
    `      "entity_ids": ["entity_id_1", "entity_id_2"],`,
    `      "signal_strength": 0.8`,
    `    }`,
    `  ]`,
    `}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}
