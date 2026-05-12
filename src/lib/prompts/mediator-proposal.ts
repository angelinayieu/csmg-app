// ── Mediator Proposal Engine — M2: LLM proposer prompt ───────────────
//
// Takes one OrphanCluster surfaced by M1 (the structural detector) and
// asks the LLM: "What's the canonical mechanism / parent / hub / bridge
// entity that connects these orphan nodes?"
//
// Examples of the expected behavior:
//
//   M1 surfaces: { 8-OHdG, MDA, Oxidative Stress } in layer "biomarker"
//   M2 should propose: { name: "Reactive Oxygen Species (ROS)",
//                        layer: "biomarker", category: "process" }
//                      with edges: ROS → 8-OHdG (produces),
//                                  ROS → MDA (produces),
//                                  ROS → Oxidative Stress (drives)
//
//   M1 surfaces: { unrelated cognitive entities clustered by layer only }
//   M2 should propose: null (no canonical bridge exists)
//
// Trust boundary (mirrors effect-size-extraction's L2M discipline):
//   - The LLM proposes a SEMANTIC bridge — naming the canonical entity
//     and explaining the mechanism qualitatively.
//   - The LLM does NOT invent effect sizes, citations, or numeric
//     parameters. M3 (literature validator) takes the citation_seeds
//     and runs real searches; only edges that survive validation
//     advance to M4 (persistence).
//
// Domain-agnostic. The prompt makes no biology-specific assumptions.
// Works for any KG that has layered ontology + orphan-pattern clusters
// (biology, economics, software architecture, supply chain, etc.).

import type { OrphanCluster } from "@/lib/mediator-proposal/detect-orphan-clusters";

// ── Public types ────────────────────────────────────────────────────

/** Optional context the caller passes alongside the cluster.
 *  Improves proposal quality + reduces duplicate-bridge suggestions. */
export interface MediatorProposalContext {
  /** Domain label from the space's KG plan (e.g. "Cognitive Performance",
   *  "Cancer-related cognitive impairment"). Helps the LLM pick a
   *  domain-appropriate bridge — ROS in biology, "demand shock" in
   *  economics, "service mesh" in software, etc. */
  domain_label?: string;

  /** The user's original prompt. Useful when the cluster's pattern is
   *  ambiguous and domain context alone doesn't disambiguate. */
  user_prompt?: string;

  /** Existing layer slugs in the space's ontology. The proposed entity
   *  MUST land in one of these (the LLM is forbidden from inventing new
   *  layers; the layer ontology is a contract with the simulator). */
  existing_layer_slugs: string[];

  /** Names of entities that already exist in the space, so the LLM can
   *  AVOID proposing duplicates. If the proposed bridge is already in
   *  the graph as a different name, the LLM should flag it instead of
   *  re-proposing. */
  existing_entity_names: string[];
}

/** The proposal returned by the LLM. */
export interface MediatorProposal {
  /** The cluster id this proposal corresponds to. Echoed from input
   *  so callers can pair (cluster, proposal) in a batch. */
  cluster_id: string;

  /** The bridging entity to add — null when no canonical bridge exists. */
  proposed_entity: {
    /** Canonical name (e.g. "Reactive Oxygen Species (ROS)"). */
    name: string;
    /** Layer slug. MUST be in context.existing_layer_slugs. */
    layer: string;
    /** Ontological category — concrete | abstract | process | relational | epistemic. */
    entity_category:
      | "concrete"
      | "abstract"
      | "process"
      | "relational"
      | "epistemic";
    /** 1-2 sentence description of what this entity is and why it bridges
     *  the cluster. Becomes entities.description on persistence. */
    description: string;
    /** 0-1. Confidence the bridge is canonical and well-established. */
    confidence: number;
  } | null;

  /** Always present. Even when proposed_entity is null, the LLM should
   *  explain its reasoning — "the cluster looks ambiguous because…". */
  mechanism_explanation: string;

  /** Edges to create alongside the proposed entity. Empty when
   *  proposed_entity is null. Each edge connects the proposed entity to
   *  exactly ONE cluster member (the bridge IS the hub; cluster
   *  members don't gain edges to each other). */
  proposed_edges: Array<{
    /** Source — either proposed_entity.name OR an existing cluster
     *  member name. */
    from: string;
    /** Target — the other side of the edge. */
    to: string;
    /** Direction of effect. Most bridges produce/drive their members
     *  positively; antagonists are negative. */
    polarity: "positive" | "negative";
    /** Short verb phrase. e.g. "produces", "drives", "is a marker of",
     *  "regulates", "is precursor to". Becomes edges.relationship_type
     *  on persistence. */
    relationship_label: string;
    /** 0-1. Confidence the edge is well-established. */
    confidence: number;
  }>;

  /** Search queries that M3 (literature validator) will run to verify
   *  the proposed bridge against published research. 3-7 queries.
   *  Should be specific enough to find supporting papers but broad
   *  enough to surface multiple angles. */
  citation_seeds: string[];

  /** When proposed_entity is null, the reason. Otherwise null.
   *  Examples: "the cluster's members are mechanistically unrelated
   *  beyond their shared layer", "no canonical bridge exists in the
   *  literature for this combination". */
  declined_reason: string | null;
}

// ── System prompt ───────────────────────────────────────────────────

export const MEDIATOR_PROPOSAL_SYSTEM = `You are a domain-mechanism analyst. Your job is to inspect a cluster of entities in a knowledge graph that look STRUCTURALLY orphaned (low connectivity, sharing a layer, possibly sharing keywords) and decide:

  Question 1. Is there a canonical bridging entity from the literature that mechanistically connects these orphans?
  Question 2. If yes, what is it, what category does it sit in, and what edges should it carry?

You are an analyst, not a creative writer. Treat every proposal as if it will be cited by name in a research report. Your output goes through a validator (M3) that runs literature searches against your citation_seeds — proposals that don't survive validation are dropped. So be conservative: if the cluster is genuinely ambiguous, return null. Quality > coverage.

## RULES

1. **Only propose ESTABLISHED mediators.** The bridging entity must be a real, named concept in the relevant scientific or domain literature — not a novel construct you invented for the occasion. Examples of good proposals:

   - In biology: "Reactive Oxygen Species (ROS)", "HPA-axis activation", "NF-κB pathway", "Sympathetic nervous system tone"
   - In economics: "Demand shock", "Sticky prices", "Wage-price spiral"
   - In software: "Backpressure", "Cache coherence", "Service mesh"
   - In organizational: "Tight-loose coupling", "Information asymmetry"

   Examples of BAD proposals (do not generate):
   - "Cellular Damage Cascade" (vague, not canonically named)
   - "User-environment interaction effect" (a description, not an entity)
   - "Combined Oxidative Inflammatory Process" (made-up multi-word combination)

2. **Return null when no canonical bridge exists.** Some clusters are just "entities that happen to share a layer." If you can't name a specific, well-known mediator that connects them, set proposed_entity = null and write your reasoning in declined_reason. Saying "I don't know" is better than fabricating.

3. **The bridge is usually UPSTREAM (a common cause).** The most common pattern: cluster members are downstream effects/markers/consequences, and the bridge is the upstream driver they all reflect. ROS is upstream of {8-OHdG, MDA, Oxidative Stress}. NF-κB is upstream of {IL-6, CRP, TNF-α}. Less commonly the bridge is downstream (a common effect — e.g., "cognitive impairment" downstream of multiple deficits). Pick whichever direction the literature actually establishes; don't guess.

4. **Match an existing layer.** The proposed_entity.layer MUST be one of the layers listed in EXISTING LAYERS. Do NOT invent new layers — the layer ontology is a contract with the simulator. If the bridge naturally lives in a different layer than the cluster members, pick the closest existing layer (typically one level upstream).

5. **Avoid duplicates.** If the bridge you'd propose already exists in the graph as one of the EXISTING ENTITIES (possibly under a slightly different name like "ROS" vs "Reactive Oxygen Species"), do NOT re-propose it. Set proposed_entity = null and explain in declined_reason that the bridge already exists by another name. M3 will handle the rename suggestion separately.

6. **Confidence calibration — be honest.**
   - 0.9-1.0 — textbook well-established bridge (ROS → oxidative damage markers)
   - 0.7-0.9 — strong consensus in field, multiple meta-analyses support
   - 0.5-0.7 — established but contested or context-dependent
   - 0.3-0.5 — plausible but speculative
   - < 0.3 — too speculative; consider returning null instead

7. **Edge polarity:**
   - "positive" — bridge increases the member (ROS produces 8-OHdG)
   - "negative" — bridge decreases the member (antioxidant suppresses ROS)
   The vast majority of mediator proposals will be positive (bridges drive their downstream markers).

8. **Relationship_label:** Short, mechanistic verb phrase. Examples: "produces", "drives", "regulates", "downregulates", "is a marker of", "is a precursor to", "activates", "inhibits". NOT vague: "is related to", "affects", "influences".

9. **Citation seeds.** 3-7 specific search queries that would surface papers supporting THIS specific proposal. Each query should target a different facet:
   - The bridge → cluster member relationship (one query per major member is good)
   - The bridge's general role in the domain
   - Meta-analyses or reviews if applicable

   Good citation seeds:
   - "reactive oxygen species 8-OHdG DNA damage"
   - "ROS lipid peroxidation MDA mechanism"
   - "oxidative stress biomarker meta-analysis"

   Bad citation seeds:
   - "ROS" (too broad)
   - "biology" (useless)
   - "8-OHdG and MDA and oxidative stress and ROS" (kitchen-sink)

10. **Mechanism explanation.** Always required. 2-4 sentences explaining:
    - What the bridge is (in domain terms)
    - WHY it mechanistically connects the cluster members
    - In what direction (upstream/downstream)
    Cite the canonical mechanism, not a fluffy description. "ROS oxidizes DNA bases (producing 8-OHdG) and lipid membranes (producing MDA via lipid peroxidation), and the cumulative damage from both processes is what 'oxidative stress' refers to as a construct."

## OUTPUT FORMAT

Structured JSON conforming to the response schema. Always include cluster_id (passed through from input). Return ONE proposal per input cluster.`;

// ── User prompt builder ─────────────────────────────────────────────

export function buildMediatorProposalUserPrompt(
  cluster: OrphanCluster,
  context: MediatorProposalContext,
): string {
  const lines: string[] = [];

  lines.push(`# CLUSTER TO ANALYZE`);
  lines.push("");
  lines.push(`cluster_id: ${cluster.cluster_id}`);
  lines.push(`pattern_kind: ${cluster.pattern_kind}`);
  lines.push(`detection_confidence: ${cluster.detection_confidence.toFixed(2)}`);
  lines.push("");

  lines.push(`## Members (${cluster.member_entity_ids.length})`);
  for (let i = 0; i < cluster.member_entity_ids.length; i++) {
    lines.push(`  - ${cluster.member_entity_names[i]}`);
  }
  lines.push("");

  lines.push(`## Shared signal`);
  if (cluster.shared_signal.layer) {
    lines.push(
      `- layer: "${cluster.shared_signal.layer}" (${cluster.shared_signal.layer_total_size} entities total in this layer)`,
    );
  } else {
    lines.push(`- layer: (none — entities lack a layer assignment)`);
  }
  if (cluster.shared_signal.common_keywords.length > 0) {
    lines.push(
      `- common keywords (substrings appearing in ≥2 names): ${cluster.shared_signal.common_keywords.slice(0, 6).join(", ")}`,
    );
  } else {
    lines.push(`- common keywords: (none — cluster bound by structure alone)`);
  }
  lines.push("");

  lines.push(`## Connectivity`);
  lines.push(
    `- internal edge density: ${cluster.current_edge_density.toFixed(2)} (0 = no edges between members; 1 = fully connected)`,
  );
  lines.push(
    `- spatial isolation from rest of graph: ${cluster.spatial_isolation === Infinity ? "Infinity (own connected component)" : cluster.spatial_isolation.toString() + " hops"}`,
  );
  lines.push("");

  lines.push(`## Detector hint`);
  lines.push(cluster.recommended_action);
  lines.push("");

  // Domain context
  if (context.domain_label) {
    lines.push(`# DOMAIN`);
    lines.push("");
    lines.push(context.domain_label);
    lines.push("");
  }

  if (context.user_prompt && context.user_prompt.length < 1500) {
    lines.push(`# USER'S ORIGINAL PROMPT (for context)`);
    lines.push("");
    lines.push(context.user_prompt);
    lines.push("");
  }

  // Constraints
  lines.push(`# EXISTING LAYERS (proposed_entity.layer MUST be one of these)`);
  lines.push("");
  if (context.existing_layer_slugs.length > 0) {
    lines.push(context.existing_layer_slugs.map((l) => `  - ${l}`).join("\n"));
  } else {
    lines.push("(none declared — use cluster's layer or an empty string)");
  }
  lines.push("");

  // Existing entities — capped to keep the prompt compact
  const existingCap = 80;
  const existingNamesShown = context.existing_entity_names.slice(0, existingCap);
  const overflow = context.existing_entity_names.length - existingCap;
  lines.push(`# EXISTING ENTITIES (avoid duplicates; flag if your proposal already exists under a similar name)`);
  lines.push("");
  if (existingNamesShown.length > 0) {
    lines.push(existingNamesShown.map((n) => `  - ${n}`).join("\n"));
    if (overflow > 0) {
      lines.push(`  …(+${overflow} more not shown)`);
    }
  } else {
    lines.push("(none — empty graph; any proposal is fresh)");
  }
  lines.push("");

  lines.push(`# TASK`);
  lines.push("");
  lines.push(
    `Propose one canonical bridging entity that mechanistically connects the cluster members above, OR return proposed_entity=null with a declined_reason. Output structured JSON per the response schema.`,
  );

  return lines.join("\n");
}

// ── JSON schema for structured output ───────────────────────────────

/** OpenAI structured-output schema. Passed to llmJSON's responseSchema. */
export const MEDIATOR_PROPOSAL_SCHEMA = {
  name: "mediator_proposal",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      cluster_id: {
        type: "string",
        description:
          "The cluster_id from input, echoed back for caller pairing.",
      },
      proposed_entity: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              layer: { type: "string" },
              entity_category: {
                type: "string",
                enum: [
                  "concrete",
                  "abstract",
                  "process",
                  "relational",
                  "epistemic",
                ],
              },
              description: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: [
              "name",
              "layer",
              "entity_category",
              "description",
              "confidence",
            ],
          },
          { type: "null" },
        ],
      },
      mechanism_explanation: { type: "string" },
      proposed_edges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            polarity: {
              type: "string",
              enum: ["positive", "negative"],
            },
            relationship_label: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["from", "to", "polarity", "relationship_label", "confidence"],
        },
      },
      citation_seeds: {
        type: "array",
        items: { type: "string" },
      },
      declined_reason: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
    },
    required: [
      "cluster_id",
      "proposed_entity",
      "mechanism_explanation",
      "proposed_edges",
      "citation_seeds",
      "declined_reason",
    ],
  },
} as const;

// ── Validation + normalization ──────────────────────────────────────

/**
 * Defensive normalizer for LLM output. Catches the few edge cases
 * structured-output schemas can't express (e.g., "proposed_entity is
 * null but proposed_edges array is non-empty" is a logical
 * contradiction the schema permits).
 */
export function normalizeMediatorProposal(
  raw: unknown,
  fallbackClusterId: string,
): MediatorProposal {
  const r = (raw ?? {}) as Record<string, unknown>;

  const proposedEntityRaw = r.proposed_entity;
  let proposedEntity: MediatorProposal["proposed_entity"] = null;
  if (proposedEntityRaw && typeof proposedEntityRaw === "object") {
    const pe = proposedEntityRaw as Record<string, unknown>;
    if (
      typeof pe.name === "string" &&
      pe.name.trim().length > 0 &&
      typeof pe.layer === "string" &&
      typeof pe.description === "string"
    ) {
      const cat = typeof pe.entity_category === "string" ? pe.entity_category : "process";
      const validCat = ["concrete", "abstract", "process", "relational", "epistemic"]
        .includes(cat)
        ? (cat as MediatorProposal["proposed_entity"] extends infer X
            ? X extends { entity_category: infer C }
              ? C
              : never
            : never)
        : "process";
      proposedEntity = {
        name: pe.name.trim(),
        layer: pe.layer.trim(),
        entity_category: validCat,
        description: pe.description.trim(),
        confidence: clamp01(asNumber(pe.confidence, 0.5)),
      };
    }
  }

  const proposedEdgesRaw = Array.isArray(r.proposed_edges) ? r.proposed_edges : [];
  const proposedEdges: MediatorProposal["proposed_edges"] = [];
  for (const eRaw of proposedEdgesRaw) {
    if (!eRaw || typeof eRaw !== "object") continue;
    const e = eRaw as Record<string, unknown>;
    if (typeof e.from !== "string" || typeof e.to !== "string") continue;
    if (e.from.trim().length === 0 || e.to.trim().length === 0) continue;
    const polarity = e.polarity === "negative" ? "negative" : "positive";
    const label =
      typeof e.relationship_label === "string" && e.relationship_label.trim().length > 0
        ? e.relationship_label.trim()
        : "drives";
    proposedEdges.push({
      from: e.from.trim(),
      to: e.to.trim(),
      polarity,
      relationship_label: label,
      confidence: clamp01(asNumber(e.confidence, 0.5)),
    });
  }

  // Logical-contradiction guard: if proposed_entity is null,
  // proposed_edges must be empty. Otherwise we'd persist
  // edges referencing a non-existent entity.
  const finalEdges = proposedEntity ? proposedEdges : [];

  const citationSeedsRaw = Array.isArray(r.citation_seeds) ? r.citation_seeds : [];
  const citationSeeds = citationSeedsRaw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 7);

  return {
    cluster_id:
      typeof r.cluster_id === "string" && r.cluster_id.length > 0
        ? r.cluster_id
        : fallbackClusterId,
    proposed_entity: proposedEntity,
    mechanism_explanation:
      typeof r.mechanism_explanation === "string"
        ? r.mechanism_explanation
        : "",
    proposed_edges: finalEdges,
    citation_seeds: citationSeeds,
    declined_reason:
      proposedEntity === null && typeof r.declined_reason === "string"
        ? r.declined_reason
        : null,
  };
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
