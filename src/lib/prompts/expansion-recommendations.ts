// ── Concept-expansion recommendation prompt ────────────────────────────
//
// Used by /api/canvas/expansion-recommendations to suggest 2-4
// expansions for a single raw-signal card. The user toggles this on
// in the triple-lab raw signal panel, and Claude proposes concepts
// they could add to deepen / connect / disambiguate the card.
//
// THE FIVE GUARDRAILS (these are the load-bearing constraints —
// every recommendation must pass all five or it's filtered out):
//
//   G1. DOMAIN ANCHORING
//       Recommendations must stay within the space's domain/layer
//       ontology. If the space is sleep-physiology, "team morale" is
//       a hard-no even if mechanistically interesting.
//
//   G2. MECHANISM REQUIREMENT
//       Every recommendation must name the specific mechanism by
//       which it connects to an existing card. Not "related to" —
//       a typed edge (causes/enables/inhibits/mediates/...) with
//       a 1-sentence why-this-mechanism rationale.
//
//   G3. RING-NOVELTY GATE
//       Look at the entity's current rings (zoom levels in
//       node_signature). Reject expansions that repeat an existing
//       ring; require each recommendation to add a NEW ring of
//       structural information (different abstraction, different
//       layer, different temporal scope, different causal direction).
//
//   G4. ANTI-GENERIC FILTER
//       Reject these names outright: strategy, optimization,
//       innovation, ecosystem, solution, framework, approach,
//       management, leadership, process, system, paradigm.
//       Names must be specific enough that someone in the domain
//       could write a one-line operational definition.
//
//   G5. COUNTERFACTUAL UNLOCK
//       Every recommendation must state: "if this is added, what
//       insight/connection/loop becomes visible that's currently
//       hidden?" — forces articulation of the VALUE of the
//       expansion, not just its plausibility.

import { buildGuardrailBlock } from "./guardrail-questions";

export interface ExpansionContext {
  // The card being expanded
  entity: {
    id: string;
    name: string;
    description: string | null;
    layer: string | null;
    knowledge_layer: string | null;
    entity_category: string | null;
    importance: string | null;
    ring_count: number; // from node_signature.rings if available
    rings_summary: string | null; // textual summary of existing rings
  };
  // Direct neighbors (1-hop) — used for ring-novelty + mechanism gate
  neighbors: Array<{
    name: string;
    relation: string;
    direction: "out" | "in";
  }>;
  // Space-level context for domain anchoring
  space_meta: {
    title: string | null;
    domain: string | null; // from synthesis_data or user_profile
    layer_ontology_labels: string[]; // L0..L4 names from layer_ontology
    user_goal: string | null;
  };
  // User-set guardrail answers — canonical shape now (was a legacy
  // qid→string map). Rendered via the shared buildGuardrailBlock
  // helper so the prompt block stays consistent across surfaces.
  guardrail_answers: Record<string, import("./guardrail-questions").GuardrailAnswer>;
}

export interface ExpansionRecommendation {
  id: string; // client-side temp id like "exp-1"
  name: string; // proposed entity name (specific, not generic)
  description: string; // 1-2 sentence operational definition
  // ── Guardrail-enforced fields ──
  mechanism: {
    // Which existing entity in the space this connects to
    target_entity_id: string;
    target_entity_name: string;
    // Typed relation (matches edges.relationship_type taxonomy)
    relation_type:
      | "causes"
      | "enables"
      | "inhibits"
      | "moderates"
      | "mediates"
      | "constrains"
      | "composes"
      | "competes"
      | "temporally_precedes"
      | "relates_to";
    // Direction
    direction: "out" | "in";
    // Why this specific mechanism — operational, not generic
    rationale: string;
  };
  ring_novelty: {
    // Which ring this expansion adds — should be different from
    // existing rings reported in ExpansionContext.entity.rings_summary
    new_ring_kind: "structural" | "temporal" | "scale" | "causal_direction" | "abstraction";
    // What the new ring reveals that wasn't visible before
    description: string;
  };
  counterfactual_unlock: string; // "If added, this becomes visible: …"
  confidence: number; // 0..1; reject < 0.5 client-side
  evidence_required: {
    // What would the user need to FIND/OBSERVE/CITE to substantiate this?
    kind: "paper" | "interview" | "observation" | "calculation" | "experiment" | "domain_pattern";
    description: string;
  };
}

export interface ExpansionRecommendationsResponse {
  recommendations: ExpansionRecommendation[];
  // Honesty flag — when Claude can't find 2-4 high-quality candidates
  // it MUST say so rather than synthesizing weak ones. Track separately
  // so the UI can show a "graph is saturated here" affordance instead
  // of forcing generic chips.
  saturation_signal: {
    is_saturated: boolean;
    reason: string | null;
  };
}

const ANTI_GENERIC = [
  "strategy",
  "optimization",
  "innovation",
  "ecosystem",
  "solution",
  "framework",
  "approach",
  "management",
  "leadership",
  "process",
  "system",
  "paradigm",
  "infrastructure",
  "synergy",
  "value",
  "engagement",
  "experience",
  "performance",
];

export function isAntiGeneric(name: string): boolean {
  const lower = name.trim().toLowerCase();
  // Reject if the entire name IS a generic word, or it's "<generic> <noun>"
  // pattern (e.g. "growth strategy", "innovation framework").
  for (const w of ANTI_GENERIC) {
    if (lower === w) return true;
    if (lower.split(/\s+/).every((tok) => ANTI_GENERIC.includes(tok))) return true;
  }
  return false;
}

export function buildExpansionRecommendationsPrompt(
  ctx: ExpansionContext,
): { system: string; user: string } {
  // Render via the shared helper — same constraints text + budget cap
  // as every other prompt site (decompose, synth, critique, strategy).
  const guardrailBlock = buildGuardrailBlock(ctx.guardrail_answers);

  const ontologyBlock =
    ctx.space_meta.layer_ontology_labels.length > 0
      ? `\nLayer ontology in this space: ${ctx.space_meta.layer_ontology_labels.join(" → ")}`
      : "";

  const neighborBlock =
    ctx.neighbors.length === 0
      ? "(no direct neighbors yet — this card is currently an orphan in the KG)"
      : ctx.neighbors
          .slice(0, 12)
          .map(
            (n) =>
              `  - ${n.direction === "out" ? `[${ctx.entity.name}] —[${n.relation}]→ [${n.name}]` : `[${n.name}] —[${n.relation}]→ [${ctx.entity.name}]`}`,
          )
          .join("\n");

  const ringBlock = ctx.entity.rings_summary
    ? `Existing rings on this entity:\n${ctx.entity.rings_summary}`
    : `(no node signature computed yet — treat all rings as available)`;

  const system = `You are a domain-expert concept-expansion assistant for a knowledge graph. Your job: given ONE entity card and its neighborhood, propose 2-4 specific concept expansions the user could add to deepen / connect / disambiguate this card.

You are NOT a generic brainstormer. Every recommendation must pass FIVE non-negotiable guardrails:

G1. DOMAIN ANCHORING — recommendations must stay within the space's domain and layer ontology. If the space is sleep-physiology, do not propose "team morale" or "marketing strategy" even if they're abstractly connectable.

G2. MECHANISM REQUIREMENT — every recommendation MUST name (a) the specific existing entity it connects to, (b) the typed relation (causes/enables/inhibits/moderates/mediates/constrains/composes/competes/temporally_precedes/relates_to), (c) the direction, (d) a one-sentence rationale grounded in the mechanism — not "related to," not "important for."

G3. RING-NOVELTY GATE — look at the existing rings (zoom levels) on the entity. Each recommendation MUST add a NEW ring of structural information: a different abstraction layer, a different temporal scope, a different scale, a different causal direction, or a different structural perspective. Do not propose expansions that repeat an existing ring.

G4. ANTI-GENERIC FILTER — reject any name that is or contains only these words: strategy, optimization, innovation, ecosystem, solution, framework, approach, management, leadership, process, system, paradigm, infrastructure, synergy, value, engagement, experience, performance. Names must be specific enough that a domain expert could write a one-line operational definition.

G5. COUNTERFACTUAL UNLOCK — every recommendation must state, explicitly, what new insight / loop / connection becomes visible if this expansion is added. "Without X, you cannot see Y" — forces articulation of the VALUE of the expansion, not just its plausibility.

QUALITY OVER QUANTITY: if you cannot find at least 2 recommendations that pass all 5 guardrails, return FEWER recommendations and set saturation_signal.is_saturated = true with a one-sentence reason. Do NOT pad. Padding with weak recommendations is a worse outcome than honest saturation.

REASONING DEPTH: For each candidate, think through the FIVE guardrails in order. If any fail, drop the candidate and try a different angle. Specifically:
- For G2, name the existing entity by its exact name and use the typed relation taxonomy.
- For G3, articulate what NEW kind of ring this introduces vs. what's already there.
- For G5, the unlock must be CONCRETE: "this lets you see the X → Y → Z chain that's currently invisible" or "this surfaces the implicit assumption that …" — not "this gives more context."

Return ONLY JSON matching this schema (no markdown fencing):
{
  "recommendations": [
    {
      "id": "exp-1",
      "name": "string — specific, operational, passes G4",
      "description": "string — 1-2 sentences, operational definition",
      "mechanism": {
        "target_entity_id": "string — must match an existing entity id from the neighborhood block below",
        "target_entity_name": "string",
        "relation_type": "causes | enables | inhibits | moderates | mediates | constrains | composes | competes | temporally_precedes | relates_to",
        "direction": "out | in",
        "rationale": "string — one sentence explaining the mechanism, not the importance"
      },
      "ring_novelty": {
        "new_ring_kind": "structural | temporal | scale | causal_direction | abstraction",
        "description": "string — what kind of ring this is and what it reveals"
      },
      "counterfactual_unlock": "string — 'If added, [specific insight/loop/connection] becomes visible'",
      "confidence": 0.0,
      "evidence_required": {
        "kind": "paper | interview | observation | calculation | experiment | domain_pattern",
        "description": "string — what would substantiate this"
      }
    }
  ],
  "saturation_signal": {
    "is_saturated": false,
    "reason": null
  }
}`;

  const user = `## ENTITY TO EXPAND

Name: ${ctx.entity.name}
ID: ${ctx.entity.id}
Layer / category: ${[ctx.entity.knowledge_layer, ctx.entity.layer, ctx.entity.entity_category].filter(Boolean).join(" / ") || "unclassified"}
Importance: ${ctx.entity.importance ?? "unknown"}
Description: ${ctx.entity.description ?? "(none)"}

${ringBlock}

## NEIGHBORHOOD (1-hop edges)

${neighborBlock}

## SPACE CONTEXT

Title: ${ctx.space_meta.title ?? "(untitled space)"}
Domain: ${ctx.space_meta.domain ?? "(unspecified — infer from neighborhood)"}
User goal: ${ctx.space_meta.user_goal ?? "(unspecified)"}${ontologyBlock}${guardrailBlock}

## TASK

Propose 2-4 concept expansions that pass ALL FIVE guardrails. Each must connect to an existing entity in the neighborhood (use the exact target_entity_id from the neighborhood block). If you cannot find 2 that pass, return fewer and set saturation_signal accordingly. Return JSON only.`;

  return { system, user };
}
