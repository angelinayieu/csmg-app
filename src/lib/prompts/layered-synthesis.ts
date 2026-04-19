// ── Layered synthesis prompts ──
// Flat synthesis on a 200-entity graph degrades into generic "here are 12
// leverage points" output because every entity looks moderately-connected
// when you squint at the full list. Layered synthesis operates in three
// stages that mirror how humans actually reason about complex problems:
//
//   Stage 1 — Fulcrum system: of the 8-12 systems, which one is where a
//             change propagates hardest? This is a small-N decision the LLM
//             can actually make well, because it only sees systems.
//   Stage 2 — Critical domain: inside the fulcrum system, which domain
//             carries the tension? Again, small-N (3-5 domains in the
//             fulcrum system).
//   Stage 3 — Load-bearing thread: inside the critical domain, which
//             specific causal chain or tension is the intervention point?
//             Small-N again (2-4 threads).
//
// The output is a nested strategic narrative: "In System A, domain A2 has
// a causal chain between threads X, Y, Z — and thread Y is the one to move
// because [mechanism]." This is what "contribute to strategy development"
// actually looks like at 200-entity scale.

export const SYNTHESIS_STAGE_FULCRUM_SYSTEM = `You are a strategic analyst. You are given a set of SYSTEMS (top-level structural areas) and the tensions/dependencies BETWEEN them. Your job is to identify THE ONE FULCRUM SYSTEM — the system where a well-placed intervention propagates hardest through the rest of the graph.

Do NOT be diplomatic. Pick ONE. "They're all important" is a failure output.

A fulcrum system has these properties, ranked by importance:
1. HIGH LEVERAGE: changes inside it propagate to multiple other systems
2. CURRENTLY CONTESTED: it has active tensions (in_tension_with, constrains, contradicts edges to other systems)
3. USER-ACTIONABLE: the user can actually change things inside it (not "the regulatory environment")
4. UNRESOLVED: the decomposition suggests this system has open tradeoffs, not a settled answer

OUTPUT (JSON):
{
  "fulcrum_system_id": "SYS3",
  "fulcrum_system_name": "string",
  "case_for_fulcrum": [
    "string — concrete mechanism 1 by which changes here propagate",
    "string — concrete mechanism 2",
    "string — concrete mechanism 3"
  ],
  "systems_considered_and_rejected": [
    {
      "system_id": "SYS1",
      "system_name": "string",
      "reason_rejected": "string — specific reason this isn't the fulcrum (e.g. 'user cannot change it', 'already settled in current strategy', 'downstream effect, not cause')"
    }
  ],
  "cross_system_consequences": "string — 2-3 sentences on what happens to OTHER systems if the fulcrum is moved",
  "confidence": 0.0-1.0
}

Reject diplomatic language. The user needs a pick, not a survey.`;

export const SYNTHESIS_STAGE_CRITICAL_DOMAIN = `You are a strategic analyst continuing a layered synthesis. The fulcrum system has been chosen. Your job now is to identify THE ONE CRITICAL DOMAIN inside that system — the domain that carries the tension.

Again: pick ONE. Don't list candidates.

A critical domain has these properties:
1. CARRIES UNRESOLVED TENSION: contains contradictions, tradeoffs, or constraints that haven't been resolved
2. CONCENTRATES FAILURE MODES: if this domain fails, the system fails
3. SMALL CHANGES HAVE DISPROPORTIONATE EFFECTS: moving this domain moves the whole system
4. HAS HIGH INTERVENTION ROI: user effort applied here produces the biggest per-unit change

OUTPUT (JSON):
{
  "critical_domain_id": "D_SYS3_2",
  "critical_domain_name": "string",
  "why_this_domain": [
    "string — concrete reason 1, grounded in specific entities/edges from the input",
    "string — concrete reason 2",
    "string — concrete reason 3"
  ],
  "sibling_domains_rejected": [
    {
      "domain_id": "D_SYS3_1",
      "domain_name": "string",
      "reason_rejected": "string"
    }
  ],
  "tension_description": "string — 2-3 sentences describing the specific tension or tradeoff this domain carries",
  "confidence": 0.0-1.0
}`;

export const SYNTHESIS_STAGE_LOAD_BEARING_THREAD = `You are a strategic analyst completing a layered synthesis. Both the fulcrum system and the critical domain have been chosen. Your job now is to identify THE ONE LOAD-BEARING THREAD inside that domain — the specific causal chain or tension that, if moved, moves the outcome.

Pick ONE.

A load-bearing thread has these properties:
1. HAS A CLEAR INTERVENTION POINT: a specific node where an action changes the thread's outcome
2. IS CURRENTLY BLOCKING: removing this thread unblocks other threads
3. HAS ASYMMETRIC PAYOFF: if the thread resolves favorably, outsized value; if unfavorably, contained downside (or vice versa — name which)
4. HAS TESTABLE ASSUMPTIONS: you can name 1-3 specific things that must be true for the thread to resolve as hoped

OUTPUT (JSON):
{
  "load_bearing_thread_id": "T_D_SYS3_2_1",
  "load_bearing_thread_name": "string",
  "intervention_point": "string — the specific point where to act",
  "why_this_thread": [
    "string — concrete reason 1",
    "string — concrete reason 2",
    "string — concrete reason 3"
  ],
  "sibling_threads_rejected": [
    {
      "thread_id": "T_D_SYS3_2_2",
      "reason_rejected": "string"
    }
  ],
  "testable_assumptions": [
    "string — assumption 1 that must hold for the intervention to work",
    "string — assumption 2",
    "string — assumption 3"
  ],
  "failure_mode": "string — what specifically goes wrong if this thread breaks",
  "first_move": "string — the single most valuable next action the user can take, concrete enough to do this week",
  "confidence": 0.0-1.0
}`;

export const SYNTHESIS_STAGE_FINAL_NARRATIVE = `You are a strategic analyst writing the final synthesis narrative. The three stages have produced: fulcrum system, critical domain, load-bearing thread, intervention point, testable assumptions, failure mode, and first move.

Your job: weave these into a coherent strategic narrative that the user can act on. NOT a summary of what the analysis found — a directive recommendation.

STRUCTURE the output as JSON:
{
  "headline": "string — one sentence capturing the strategic recommendation",
  "narrative": "string — 3-5 paragraphs. Paragraph 1: the structural insight (why THIS system is the fulcrum). Paragraph 2: the domain-level tension (why it carries the load). Paragraph 3: the specific intervention (the thread + the first move). Paragraph 4: what must be true for this to work (assumptions). Paragraph 5: what goes wrong if not (failure mode + contingency).",
  "key_decision": "string — the single decision the user is actually making",
  "opposing_view": "string — 1-2 sentences steelmanning the strongest case AGAINST this recommendation",
  "confidence": 0.0-1.0,
  "open_questions": [
    "string — an unresolved question that would change the recommendation if answered"
  ]
}

Anti-patterns to reject:
- Lists of "considerations" or "things to keep in mind"
- Diplomatic hedging that softens the pick
- Generic advice that could apply to any situation
- Repetition of what the decomposition already said`;

// ── Context builders ──
// These assemble the per-stage input from the graph, filtering down to what
// each stage needs to see. Crucial for cost — Stage 1 never sees threads,
// Stage 3 never sees systems it doesn't need.

export interface SystemForSynthesis {
  entity_id: string;
  name: string;
  description: string;
  importance?: string;
  why_it_matters?: string;
}

export interface DomainForSynthesis {
  entity_id: string;
  name: string;
  description: string;
  importance?: string;
  parent_system_id: string;
}

export interface ThreadForSynthesis {
  entity_id: string;
  name: string;
  description: string;
  importance?: string;
  parent_domain_id: string;
  intervention_point?: string;
}

export interface EdgeForSynthesis {
  source_id: string;
  target_id: string;
  relationship_type: string;
  dimension?: string;
  topology?: string;
  reasoning?: string | null;
}

export function buildFulcrumContext(opts: {
  userInput: string;
  spaceName: string;
  systems: SystemForSynthesis[];
  crossSystemEdges: EdgeForSynthesis[];
  // Fault entities scoped to cross-system concerns.
  systemLevelFaults: Array<{ name: string; description: string; involved_ids: string[] }>;
}): string {
  const sysBlock = opts.systems
    .map((s) => {
      const whyLine = s.why_it_matters ? `\n    why_it_matters: ${s.why_it_matters}` : "";
      return `- ${s.entity_id}: ${s.name}${s.importance ? ` [${s.importance}]` : ""}
    ${s.description}${whyLine}`;
    })
    .join("\n");

  const edgeBlock = opts.crossSystemEdges.length > 0
    ? opts.crossSystemEdges
        .map((e) => `- ${e.source_id} → ${e.target_id} [${e.relationship_type}${e.topology ? `, topology=${e.topology}` : ""}]${e.reasoning ? ` — ${e.reasoning}` : ""}`)
        .join("\n")
    : "(No cross-system edges — flag this: a well-decomposed graph should have inter-system tensions)";

  const faultBlock = opts.systemLevelFaults.length > 0
    ? opts.systemLevelFaults
        .map((f) => `- ${f.name}: ${f.description} [implicates: ${f.involved_ids.join(", ")}]`)
        .join("\n")
    : "(No cross-system faults surfaced.)";

  return `SPACE: ${opts.spaceName}

ORIGINAL INPUT:
${opts.userInput}

SYSTEMS (${opts.systems.length}):
${sysBlock}

CROSS-SYSTEM TENSIONS (${opts.crossSystemEdges.length}):
${edgeBlock}

CROSS-SYSTEM FAULTS:
${faultBlock}

Now identify THE ONE fulcrum system.`;
}

export function buildCriticalDomainContext(opts: {
  fulcrumSystem: SystemForSynthesis;
  domainsInSystem: DomainForSynthesis[];
  intraSystemEdges: EdgeForSynthesis[];
  // Faults that implicate entities within this system.
  faultsInScope: Array<{ name: string; description: string; involved_ids: string[] }>;
}): string {
  const domainBlock = opts.domainsInSystem
    .map((d) => `- ${d.entity_id}: ${d.name}${d.importance ? ` [${d.importance}]` : ""}
    ${d.description}`)
    .join("\n");

  const edgeBlock = opts.intraSystemEdges.length > 0
    ? opts.intraSystemEdges
        .map((e) => `- ${e.source_id} → ${e.target_id} [${e.relationship_type}${e.topology ? `, topology=${e.topology}` : ""}]${e.reasoning ? ` — ${e.reasoning}` : ""}`)
        .join("\n")
    : "(No intra-system edges)";

  const faultBlock = opts.faultsInScope.length > 0
    ? opts.faultsInScope
        .map((f) => `- ${f.name}: ${f.description} [implicates: ${f.involved_ids.join(", ")}]`)
        .join("\n")
    : "(No faults in scope.)";

  return `FULCRUM SYSTEM (chosen in previous stage):
${opts.fulcrumSystem.entity_id}: ${opts.fulcrumSystem.name}
${opts.fulcrumSystem.description}

DOMAINS INSIDE THIS SYSTEM (${opts.domainsInSystem.length}):
${domainBlock}

INTRA-SYSTEM EDGES BETWEEN DOMAINS (${opts.intraSystemEdges.length}):
${edgeBlock}

FAULTS IMPLICATING ENTITIES IN THIS SYSTEM:
${faultBlock}

Now identify THE ONE critical domain inside this fulcrum system.`;
}

export function buildLoadBearingThreadContext(opts: {
  fulcrumSystem: SystemForSynthesis;
  criticalDomain: DomainForSynthesis;
  threadsInDomain: ThreadForSynthesis[];
  intraDomainEdges: EdgeForSynthesis[];
  // Cross-domain edges FROM threads in this domain — context only.
  crossDomainEdges: EdgeForSynthesis[];
  faultsInScope: Array<{ name: string; description: string; involved_ids: string[] }>;
}): string {
  const threadBlock = opts.threadsInDomain
    .map((t) => {
      const ivp = t.intervention_point ? `\n    intervention_point: ${t.intervention_point}` : "";
      return `- ${t.entity_id}: ${t.name}${t.importance ? ` [${t.importance}]` : ""}
    ${t.description}${ivp}`;
    })
    .join("\n");

  const edgeBlock = opts.intraDomainEdges.length > 0
    ? opts.intraDomainEdges
        .map((e) => `- ${e.source_id} → ${e.target_id} [${e.relationship_type}${e.topology ? `, topology=${e.topology}` : ""}]${e.reasoning ? ` — ${e.reasoning}` : ""}`)
        .join("\n")
    : "(No intra-domain edges — this is a red flag, the LLM's thread pass produced labeled nouns, not causal chains)";

  const crossBlock = opts.crossDomainEdges.length > 0
    ? opts.crossDomainEdges
        .slice(0, 15)
        .map((e) => `- ${e.source_id} → ${e.target_id} [${e.relationship_type}]`)
        .join("\n")
    : "(No cross-domain edges from these threads.)";

  const faultBlock = opts.faultsInScope.length > 0
    ? opts.faultsInScope
        .map((f) => `- ${f.name}: ${f.description} [implicates: ${f.involved_ids.join(", ")}]`)
        .join("\n")
    : "(No faults in scope.)";

  return `FULCRUM SYSTEM: ${opts.fulcrumSystem.entity_id}: ${opts.fulcrumSystem.name}
CRITICAL DOMAIN: ${opts.criticalDomain.entity_id}: ${opts.criticalDomain.name}
${opts.criticalDomain.description}

THREADS INSIDE THIS DOMAIN (${opts.threadsInDomain.length}):
${threadBlock}

INTRA-DOMAIN EDGES BETWEEN THREADS (${opts.intraDomainEdges.length}):
${edgeBlock}

CROSS-DOMAIN EDGES FROM THESE THREADS (context only, not for intervention):
${crossBlock}

FAULTS IMPLICATING ENTITIES IN THIS DOMAIN:
${faultBlock}

Now identify THE ONE load-bearing thread and its intervention point.`;
}

export function buildFinalNarrativeContext(opts: {
  userInput: string;
  fulcrumDecision: { id: string; name: string; case_for: string[] };
  domainDecision: { id: string; name: string; why: string[]; tension: string };
  threadDecision: {
    id: string;
    name: string;
    intervention_point: string;
    testable_assumptions: string[];
    failure_mode: string;
    first_move: string;
  };
}): string {
  return `INPUT: ${opts.userInput}

LAYERED DECISIONS:
- Fulcrum system: ${opts.fulcrumDecision.name} (${opts.fulcrumDecision.id})
  Case: ${opts.fulcrumDecision.case_for.map((c) => `• ${c}`).join("\n  ")}

- Critical domain: ${opts.domainDecision.name} (${opts.domainDecision.id})
  Why: ${opts.domainDecision.why.map((w) => `• ${w}`).join("\n  ")}
  Tension: ${opts.domainDecision.tension}

- Load-bearing thread: ${opts.threadDecision.name} (${opts.threadDecision.id})
  Intervention point: ${opts.threadDecision.intervention_point}
  Testable assumptions:
    ${opts.threadDecision.testable_assumptions.map((a) => `• ${a}`).join("\n    ")}
  Failure mode: ${opts.threadDecision.failure_mode}
  First move: ${opts.threadDecision.first_move}

Write the final strategic narrative that ties these into a recommendation.`;
}
