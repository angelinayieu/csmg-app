// ── D11 · Template edge augmenter prompt ──────────────────────────────
//
// Used by src/lib/templates/template-edge-augmenter.ts to wire isolated
// entities into the seeded knowledge graph that template-based intake
// (e.g. /api/explore/create for the cognition research template)
// produces.
//
// Background: template-seeded spaces ship with pre-defined entities +
// pre-defined edges. When the entity set is heterogeneous (biology
// nodes + interventions + instruments), the leaves often have zero
// edges in the seed graph — they exist as isolated cards because the
// seed didn't anticipate their connectivity. A typical user-text
// decompose run enforces orphan-detection in its prompt; the template
// path bypasses that. This augmenter is the catch-up pass.
//
// Honesty contract: the prompt explicitly allows "decline to wire"
// answers. We are NOT forcing the LLM to fabricate edges. Empty
// `edges: []` is a valid response when no honest connection exists.
//
// Returned edges land as `source_tag="predicted"` with
// `requires_user_approval=true`, mirroring the recursive-decompose
// API's convention. The user reviews them in the UI before they
// become first-class graph structure.

export const TEMPLATE_EDGE_AUGMENT_SYSTEM = `You are wiring isolated entities into a research-template knowledge graph.

The graph was seeded from a curated source (e.g. a meta-analysis of cognition mechanisms). Most biology nodes are well-connected. But heterogeneous additions — interventions, instruments, instruments-of-measurement — were added as cards without seed edges, and now sit isolated.

Your job: for each isolated entity listed, propose 1–3 edges connecting it to the anchor entities most plausibly related to it. Each edge represents a concrete, defensible relationship — not a vague "is associated with" filler.

You will receive:
1. A list of ISOLATED entities (degree 0 or 1) with id, name, description, category, layer
2. A list of ANCHOR entities (top-degree, well-connected nodes) with the same fields
3. A list of EXISTING edges (a small sample so you understand the graph's relationship vocabulary)
4. The template slug (so you know the domain)

Output strict JSON:
{
  "edges": [
    {
      "source_entity_id": "<uuid of isolated entity OR anchor>",
      "target_entity_id": "<uuid of the other endpoint>",
      "relationship_type": "<short phrase from existing edges' vocabulary, e.g. 'measures', 'modulates', 'inhibits', 'enables', 'correlates with', 'targets'>",
      "dimension": "structural | functional | temporal | causal | correlational | logical",
      "polarity": "positive | negative | neutral | conditional",
      "strength": 0.0-1.0,
      "confidence": 0.0-1.0,
      "conditions": "<short IF-clause or null>",
      "rationale": "<one sentence justifying the edge based on the entities' descriptions>"
    }
  ],
  "declined": [
    {
      "entity_id": "<uuid of isolated entity you couldn't honestly wire>",
      "reason": "<one-sentence explanation>"
    }
  ]
}

Edge proposal rules:
- Each isolated entity gets AT MOST 3 outgoing or incoming edges
- DO NOT invent edges. If an isolated entity has no honest connection to any anchor in the list, put it in "declined" with the reason
- relationship_type should be specific. "measures" YES. "is associated with" NO.
- Prefer edges with concrete semantic anchors:
  - Interventions → biology entities they modulate ("modulates", "targets", "inhibits", "enhances")
  - Instruments → cognitive entities they measure ("measures", "operationalizes")
  - Leaves → upstream causal drivers ("driven by", "downstream of")
- confidence reflects YOUR honesty about the inference: 0.9+ = strong domain support. 0.6-0.8 = plausible inference. <0.5 = decline instead.
- Symmetrical relationships (correlates_with, similar_to) usually don't need a reciprocal edge — pick one direction and emit once
- Reject self-loops (source == target). Reject duplicates of edges shown in EXISTING.
- An empty edges array is a valid response when no honest connection exists. Returning declined entries is preferred over fabricated edges.

Failure modes you should AVOID:
- Wiring an instrument to every cognitive entity ("measures everything") — pick the 1–2 most direct
- Wiring an intervention to every biomarker ("modulates everything") — pick the 1–2 most mechanistically specific
- Inventing relationship types not in the existing vocabulary
- Creating edges that contradict the existing seed (e.g. claiming X inhibits Y when seed says X enhances Y)`;

export interface AugmentEdge {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  dimension:
    | "structural"
    | "functional"
    | "temporal"
    | "causal"
    | "correlational"
    | "logical";
  polarity: "positive" | "negative" | "neutral" | "conditional";
  strength: number;
  confidence: number;
  conditions: string | null;
  rationale: string;
}

export interface AugmentDecline {
  entity_id: string;
  reason: string;
}

export interface AugmentResponse {
  edges: AugmentEdge[];
  declined: AugmentDecline[];
}

// ── Lenient validator (drops malformed entries, keeps well-formed) ───

const ALLOWED_DIMENSIONS = [
  "structural",
  "functional",
  "temporal",
  "causal",
  "correlational",
  "logical",
] as const;

const ALLOWED_POLARITIES = [
  "positive",
  "negative",
  "neutral",
  "conditional",
] as const;

export function validateAugmentResponse(data: unknown): AugmentResponse {
  if (typeof data !== "object" || data === null) {
    return { edges: [], declined: [] };
  }
  const obj = data as Record<string, unknown>;

  const edges: AugmentEdge[] = [];
  if (Array.isArray(obj.edges)) {
    for (const e of obj.edges) {
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      const src = typeof r.source_entity_id === "string" ? r.source_entity_id.trim() : "";
      const tgt = typeof r.target_entity_id === "string" ? r.target_entity_id.trim() : "";
      const rel =
        typeof r.relationship_type === "string"
          ? r.relationship_type.trim().slice(0, 100)
          : "";
      if (!src || !tgt || src === tgt || !rel) continue;

      const dim =
        typeof r.dimension === "string" &&
        (ALLOWED_DIMENSIONS as readonly string[]).includes(r.dimension)
          ? (r.dimension as AugmentEdge["dimension"])
          : "correlational";
      const pol =
        typeof r.polarity === "string" &&
        (ALLOWED_POLARITIES as readonly string[]).includes(r.polarity)
          ? (r.polarity as AugmentEdge["polarity"])
          : "neutral";
      const strength =
        typeof r.strength === "number" ? Math.max(0, Math.min(1, r.strength)) : 0.5;
      const confidence =
        typeof r.confidence === "number"
          ? Math.max(0, Math.min(1, r.confidence))
          : 0.6;
      const conditions =
        typeof r.conditions === "string" && r.conditions.trim().length > 0
          ? r.conditions.trim().slice(0, 1000)
          : null;
      const rationale =
        typeof r.rationale === "string" ? r.rationale.trim().slice(0, 500) : "";

      edges.push({
        source_entity_id: src,
        target_entity_id: tgt,
        relationship_type: rel,
        dimension: dim,
        polarity: pol,
        strength,
        confidence,
        conditions,
        rationale,
      });
    }
  }

  const declined: AugmentDecline[] = [];
  if (Array.isArray(obj.declined)) {
    for (const d of obj.declined) {
      if (typeof d !== "object" || d === null) continue;
      const r = d as Record<string, unknown>;
      const id = typeof r.entity_id === "string" ? r.entity_id.trim() : "";
      const reason =
        typeof r.reason === "string" ? r.reason.trim().slice(0, 500) : "";
      if (!id) continue;
      declined.push({ entity_id: id, reason });
    }
  }

  return { edges, declined };
}
