// ── Hierarchical decomposition prompts ──
// Three coordinated passes that produce a layered graph at scale:
//   Pass A — Systems (3D blocks)  : ~8-12 top-level systems
//   Pass B — Domains (2D surfaces): per-system, ~3-5 domains each
//   Pass C — Threads (1D lines)   : per-domain, ~2-4 threads + semantic edges
//
// Why layered: single-pass decomposition degrades past ~50 entities. Each
// LLM call here stays in the 5-30 entity sweet spot and only sees its local
// context (parent + siblings), so depth-of-reasoning per entity stays high
// even when the total graph grows to 150+ entities.
//
// Structural `composes` edges are generated deterministically by the route
// (parent → child). LLM-generated edges are the SEMANTIC relationships
// within a layer or across parents.

// ── Pass A: Systems ──
//
// A "system" is a 3D block — a bounded sub-world with its own internal logic.
// For a startup: "Product engineering", "Go-to-market", "Capital strategy",
// "Regulatory posture" are systems. They are the macro-structure everything
// else hangs from.

export const HIERARCHICAL_SYSTEMS_PROMPT = `You are performing the TOP level of a hierarchical decomposition. Your job is to identify 8-12 SYSTEMS (3D blocks) — the major sub-worlds of the user's situation.

A SYSTEM is a bounded area with its own internal logic, its own actors, and its own success metrics. Systems are how a skilled operator carves up a complex problem into pieces they can reason about separately.

WHAT A SYSTEM IS (examples):
- For a startup: Product engineering, Go-to-market motion, Capital strategy, Regulatory posture, Team composition, Competitive positioning
- For a research project: Theoretical framework, Experimental apparatus, Data pipeline, Publication strategy, Collaboration network
- For a career decision: Skill capital, Network leverage, Financial runway, Identity/values alignment, Optionality preservation

WHAT IS NOT A SYSTEM:
- A single concept ("the pricing model") — that's a thread inside a system
- A single person or product — that's a node inside a domain
- A tension or tradeoff — that's a fault between systems
- A fact or metric — that's a claim

RULES:
1. Target 8-12 systems. Fewer than 6 means you're lumping; more than 14 means you haven't abstracted enough.
2. Each system MUST be CUT from the input — not a generic template. For an AI nutrition app, "Scientific validation" is a system; "Operations" is too generic.
3. Each system should have NON-EMPTY intersection with another system along at least one axis — that's where the cross-system tensions live.
4. Each system name must pass the "could we assign a team owner?" test. If the name is so vague that no one could own it, refine.
5. NEVER nest systems inside other systems at this level. If you find yourself wanting to, split into two separate systems at the same level.

OUTPUT: a JSON object with this shape:

{
  "systems": [
    {
      "entity_id": "SYS1",
      "name": "string — specific, actor-ownable name",
      "description": "string — 2-3 sentences. What this system is responsible for. Who operates in it. What its primary success metric is.",
      "layer": "system",
      "importance": "fundamental | critical | important",
      "confidence": 0.0-1.0,
      "why_it_matters": "string — 1 sentence on why this system is load-bearing for the user's goal"
    }
  ],
  "cross_system_tensions": [
    {
      "source_system_id": "SYS1",
      "target_system_id": "SYS3",
      "tension_description": "string — the specific conflict or tradeoff between these systems",
      "relationship_type": "trades-off-against | constrains | depends-on | contradicts"
    }
  ],
  "metadata": {
    "name": "string — name for the overall analysis space",
    "description": "string — 1-2 sentences summarizing what this analysis is about",
    "synthesis_text": "string — 3-4 sentences on the macro-structure: what the dominant systems are and how they interlock"
  }
}

IDs: use "SYS1", "SYS2", ... "SYS12".

Be ruthlessly specific to THIS input. If the same system list would apply to any random startup, you have failed.`;

// ── Pass B: Domains ──
//
// A "domain" is a 2D surface — a bounded slice of one system. For the system
// "Product engineering", domains might be "Model quality", "Inference
// infrastructure", "Data pipeline", "Developer experience". Domains are where
// actual work happens — they have measurable outputs and specific risks.

export const HIERARCHICAL_DOMAINS_PROMPT = `You are performing the MIDDLE level of a hierarchical decomposition. You have been given ONE system and you need to identify 3-5 DOMAINS (2D surfaces) inside it.

A DOMAIN is a bounded area of focused work within a system. Domains are:
- Narrower than their parent system (one system contains multiple domains)
- Wider than a single thread (each domain contains multiple threads, tensions, unknowns)
- Each has its own success metric, its own sub-actors, and its own failure modes

Think: if the system is "Go-to-market motion", domains might be:
- Customer discovery
- Pricing strategy
- Channel selection
- Brand positioning
- Sales pipeline design

DO NOT produce:
- Generic domains that apply to any system ("strategy", "execution") — too abstract
- Single-concept domains ("the CAC metric") — that's a thread
- Domains that belong to a different system — keep strictly inside the parent
- More than 5 domains — if you need more, one of them is actually a sub-system and should be escalated

RULES:
1. Target 3-5 domains per system. Fewer than 3 = you're missing internal structure. More than 5 = you're adding noise.
2. Domains should TILE the system — together they should cover the system's scope without major gaps.
3. Domains should NOT overlap heavily. If two domains share >60% of their concerns, merge them.
4. Each domain MUST be grounded in the parent system's specific character, not a generic breakdown.

OUTPUT: JSON:

{
  "domains": [
    {
      "entity_id": "D_<parent_id>_1",
      "name": "string — specific domain name inside the parent system",
      "description": "string — 2-3 sentences. What this domain covers. What its primary outputs are. What its dominant failure mode is.",
      "layer": "domain",
      "importance": "fundamental | critical | important | moderate",
      "confidence": 0.0-1.0,
      "parent_system_id": "the parent SYS id passed in context"
    }
  ],
  "intra_system_edges": [
    {
      "source_entity_id": "D_<parent_id>_1",
      "target_entity_id": "D_<parent_id>_3",
      "relationship_type": "constrains | enables | trades-off-against | amplifies",
      "dimension": "functional | causal | structural | logical",
      "reasoning": "string — the specific mechanism",
      "topology": "meets | overlap | disjoint"
    }
  ]
}

IDs: use "D_<parent_id>_1", "D_<parent_id>_2" etc. If parent is "SYS3" then domains are "D_SYS3_1", "D_SYS3_2", etc.

Topology tag: "meets" = adjacent, touches at a boundary. "overlap" = shared concern. "disjoint" = explicitly separate concerns that happen to share a parent system. Use liberally here — domains within a system are naturally set-theoretic.`;

// ── Pass C: Threads ──
//
// A "thread" is a 1D line — a specific causal chain, tension, or argument
// within a domain. For the domain "Pricing strategy", threads might be:
// - The usage-based-vs-subscription tradeoff chain
// - The freemium → paid conversion path
// - The enterprise procurement friction thread
// Threads are where the real moves live. They have concrete intervention
// points and specific assumptions.

export const HIERARCHICAL_THREADS_PROMPT = `You are performing the BOTTOM level of a hierarchical decomposition. You have been given ONE domain and you need to identify 2-4 THREADS (1D lines) inside it, plus the semantic edges between them.

A THREAD is a specific causal chain, tension, dependency, or argument. Threads are narrower than domains and wider than individual claims. A thread has:
- A specific direction (X → Y → Z)
- A concrete intervention point (if we change N, the thread's outcome changes)
- An identifiable failure mode (what happens if the thread breaks)

Examples: for the domain "Customer discovery":
- Thread: "problem-solution fit validation" — the chain from interview → insight → hypothesis → test → decision
- Thread: "wrong-persona risk" — the tension between what users say they want vs. what they pay for
- Thread: "speed-vs-depth tradeoff in customer interviews"

NOT threads:
- A single entity ("the user persona") — too atomic, belongs as a claim
- An entire domain ("pricing") — too broad, belongs as a domain
- A generic process ("validate with users") — too abstract to intervene on

RULES:
1. Target 2-4 threads per domain. One thread = you're not decomposing. Five+ = you're listing claims not threads.
2. Each thread should have a clear intervention point — name it explicitly.
3. Threads can span domains within the same parent system. If a thread crosses systems, note it.
4. ADD semantic edges between threads: causal, enabling, tradeoff edges. This is where the bulk of edges come from.

OUTPUT: JSON:

{
  "threads": [
    {
      "entity_id": "T_<parent_id>_1",
      "name": "string — direction-bearing name like 'X to Y tension' or 'A → B → C chain'",
      "description": "string — 2-3 sentences. The chain or tension. What moves it. What breaks it.",
      "layer": "thread",
      "importance": "critical | important | moderate",
      "confidence": 0.0-1.0,
      "parent_domain_id": "the parent D_ id passed in context",
      "intervention_point": "string — the specific point where a change most affects this thread's outcome"
    }
  ],
  "semantic_edges": [
    {
      "source_entity_id": "T_<parent_id>_1",
      "target_entity_id": "T_<parent_id>_2",
      "relationship_type": "causes | enables | constrains | trades-off-against | amplifies | contradicts",
      "dimension": "causal | functional | logical",
      "strength": 0.0-1.0,
      "confidence": 0.0-1.0,
      "reasoning": "string — the specific mechanism",
      "polarity": "positive | negative | neutral",
      "topology": "inside | overlap | meets | disjoint (OPTIONAL — only when obvious)"
    }
  ],
  "cross_domain_edges": [
    {
      "source_entity_id": "T_<parent_id>_1",
      "target_entity_id": "T_<OTHER_DOMAIN>_N",
      "relationship_type": "string",
      "reasoning": "string — why this thread connects across domains"
    }
  ],
  "contradictions": [
    {
      "assumption_text": "string",
      "conclusion_text": "string",
      "severity": "critical | moderate | minor",
      "description": "string",
      "involved_entity_ids": ["T_<parent_id>_1", "T_<parent_id>_2"]
    }
  ]
}

IDs: "T_<parent_id>_1" etc. If parent domain is "D_SYS3_2", threads are "T_D_SYS3_2_1", etc.

cross_domain_edges is OPTIONAL and should only fire when the thread clearly bridges into another domain (use full IDs including the other domain's prefix — even if you don't know the exact ID yet, name the domain).`;

/**
 * Build the per-system context block for the domains pass.
 */
export function buildDomainsContext(opts: {
  userInput: string;
  spaceName: string;
  spaceDescription: string;
  parentSystem: { entity_id: string; name: string; description: string; why_it_matters?: string };
  siblingSystems: Array<{ entity_id: string; name: string }>;
}): string {
  const siblings = opts.siblingSystems
    .filter((s) => s.entity_id !== opts.parentSystem.entity_id)
    .map((s) => `- ${s.entity_id}: ${s.name}`)
    .join("\n");

  return `ORIGINAL INPUT:
${opts.userInput}

SPACE: ${opts.spaceName}
${opts.spaceDescription}

PARENT SYSTEM (decompose domains within this one):
${opts.parentSystem.entity_id}: ${opts.parentSystem.name}
${opts.parentSystem.description}
${opts.parentSystem.why_it_matters ? `Why it matters: ${opts.parentSystem.why_it_matters}` : ""}

SIBLING SYSTEMS (for boundary awareness — do not produce domains that belong to these):
${siblings || "(none)"}

Produce 3-5 domains that tile the parent system's scope. Stay strictly within the parent system.`;
}

/**
 * Build the per-domain context block for the threads pass.
 */
export function buildThreadsContext(opts: {
  userInput: string;
  spaceName: string;
  parentSystem: { entity_id: string; name: string };
  parentDomain: { entity_id: string; name: string; description: string };
  siblingDomains: Array<{ entity_id: string; name: string }>;
}): string {
  const siblings = opts.siblingDomains
    .filter((d) => d.entity_id !== opts.parentDomain.entity_id)
    .map((d) => `- ${d.entity_id}: ${d.name}`)
    .join("\n");

  return `ORIGINAL INPUT:
${opts.userInput}

SPACE: ${opts.spaceName}

PARENT SYSTEM: ${opts.parentSystem.entity_id}: ${opts.parentSystem.name}

PARENT DOMAIN (decompose threads within this one):
${opts.parentDomain.entity_id}: ${opts.parentDomain.name}
${opts.parentDomain.description}

SIBLING DOMAINS (in the same parent system — threads can reference these via cross_domain_edges):
${siblings || "(none)"}

Produce 2-4 threads inside this domain. Each thread MUST have a named intervention point. Add semantic edges between the threads you create.`;
}
