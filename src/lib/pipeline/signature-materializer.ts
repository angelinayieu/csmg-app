// ── Signature Materializer — writes NodeSignature for an entity ──────
//
// Reads an entity + its neighborhood (edges, expansion, axis membership)
// and produces a canonical NodeSignature: ordered basis elements, each
// one a "ring" of variable-level resolution. Persists to
// entities.node_signature (JSONB). Emits `signature_deepened` for each
// ring added so the canvas painter can animate it.
//
// Three modes:
//   - SEED (no LLM)  → entity has no signature yet; produce a 1–3 ring
//                      seed from immediately available context. Purely
//                      deterministic from edges + axis memberships.
//                      Two seed entry points share the helpers below:
//                        • seedNodeSignature(SeedInput) — used by the
//                          /api/pipeline/materialize-signatures endpoint
//                          for backfill / synthesize-time top-up.
//                        • materializeFromContext(MaterializerContext) —
//                          used by the decompose-stage batch wiring,
//                          which has the richer narrowed input shape
//                          (typed importance, leverage flag, expansion).
//   - DEEPEN (LLM) → entity has a seed; add one new ring by asking the
//                    LLM which additional variable reduces residual
//                    uncertainty most. LLM call bounded to ~400 tokens.
//   - DEEPEN (deterministic) → caller already knows the variable; just
//                              append it. Used by later pipeline stages
//                              that discover a new ring without needing
//                              the model (e.g., proposal stage adds a
//                              leverage ring once a leverage point is
//                              flagged).
//
// The split is deliberate: seeding is cheap + batchable (backfill
// thousands of entities in a few seconds, no LLM cost). Deepening is
// expensive but the strategizer chooses WHICH entities get deepened,
// so cost stays bounded by the plan's budget.
//
// MERGED 2026-04-23 — collapsed two parallel signature-materializer
// libraries (lib/agents/* + lib/pipeline/*) into this single survivor.
// Symbol-code maps, classifyRelation, planResolution, decomposition +
// leverage rings, and the deterministic deepen variant came from the
// agents-side draft; LLM deepen, persist, emit, axis loader, and seed
// invariant validation came from the pipeline-side draft.

import { llmJSON } from "@/lib/llm";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { Entity, Edge } from "@/types";
import type {
  BasisElement,
  BasisEvidence,
  NodeSignature,
  RelationType,
  ResolutionLevel,
} from "@/types/node-signature";
import { buildCanonicalCode, validateNodeSignature } from "@/types/node-signature";
import type {
  ProbabilitySpaceAxis,
  SignatureDeepenedEvent,
} from "@/types/pipeline-events";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── Symbol-code maps ─────────────────────────────────────────────────
//
// Each ring contributes a short symbol to the canonical_code. Symbols
// (rather than truncated words) keep canonical_codes compact + visually
// distinct in dense layouts — "C.@.→.✶" reads at a glance, "concrete.
// causal_scenarios.causes.leverage" does not. Used by every helper that
// constructs a basis element.

const CATEGORY_CODE: Record<string, string> = {
  concrete: "C",
  abstract: "A",
  process: "P",
  relational: "R",
  epistemic: "E",
};

const AXIS_CODE: Record<ProbabilitySpaceAxis, string> = {
  financial: "$",
  timeline: "t",
  actors: "@",
  causal_scenarios: "c",
  evidence: "e",
  assumptions: "?",
  risk: "!",
  cultural: "✦",
};

const RELATION_CODE: Record<RelationType, string> = {
  causes: "→",
  enables: "↗",
  inhibits: "⊣",
  moderates: "~",
  mediates: "·",
  constrains: "⊓",
  composes: "⊂",
  competes: "⇄",
  temporally_precedes: "≺",
  relates_to: "?",
};

// ── Relation classifier ──────────────────────────────────────────────
//
// Maps (dimension, polarity, free-text hint) → typed RelationType.
// Deterministic; the free-text hint only nudges between close
// candidates. Unknown combos fall back to `relates_to` so the agent
// never blocks. Exported so the strategizer (and any other consumer
// that needs to reason about edge semantics) shares a single
// canonical mapping.

export interface ClassifyRelationInput {
  dimension:
    | "structural"
    | "functional"
    | "temporal"
    | "causal"
    | "correlational"
    | "logical"
    | "epistemic"
    | "comparative"
    | "agentive"
    | string;
  polarity: "positive" | "negative" | "neutral" | "conditional" | string | null;
  strength?: number;
  relationship_type?: string;
}

export function classifyRelation(edge: ClassifyRelationInput): RelationType {
  const hint = (edge.relationship_type ?? "").toLowerCase();

  // Explicit keyword matches win — the decomposer LLM is trained to
  // use these verbs when it's confident.
  if (/\b(cause|triggers?|produces?|drives?)\b/.test(hint)) return "causes";
  if (/\b(enable|permits?|allows?|unlocks?)\b/.test(hint)) return "enables";
  if (/\b(inhibit|blocks?|prevents?|suppress)/.test(hint)) return "inhibits";
  if (/\b(moderate|amplifie|damps?)\b/.test(hint)) return "moderates";
  if (/\b(mediate|through|via)\b/.test(hint)) return "mediates";
  if (/\b(constrain|bound|limits?|caps?)\b/.test(hint)) return "constrains";
  if (/\b(part of|composes?|contains?|includes?)\b/.test(hint)) return "composes";
  if (/\b(compete|rivals?|crowd(s|ed) out)\b/.test(hint)) return "competes";
  if (/\b(precede|before|earlier|sequential)\b/.test(hint)) return "temporally_precedes";

  // Fall back to the dimension × polarity table.
  const strength = typeof edge.strength === "number" ? edge.strength : 0.7;
  switch (edge.dimension) {
    case "causal":
      if (edge.polarity === "negative") return "inhibits";
      if (edge.polarity === "conditional") return "enables";
      if (edge.polarity === "positive" && strength >= 0.8) return "causes";
      return "enables";
    case "structural":
      return "composes";
    case "temporal":
      return "temporally_precedes";
    case "functional":
      return edge.polarity === "negative" ? "competes" : "moderates";
    case "logical":
    case "epistemic":
    case "comparative":
    case "correlational":
    case "agentive":
    default:
      return "relates_to";
  }
}

// ── Resolution planner ──────────────────────────────────────────────
//
// Collapses basis count + incident-edge count + expansion flag into a
// resolution level. Pure function so the UI can predict where a node
// sits on the zoom plane before the agent finishes. Exported so the
// strategizer's `uncertainty` signal can re-derive horizon when it
// projects forward (e.g. "if we deepen by one ring, where does this
// land on the zoom plane?").

export function planResolution(
  basisCount: number,
  incidentEdgeCount: number,
  isExpanded: boolean,
): ResolutionLevel {
  const zoom = Math.min(5, basisCount + (isExpanded ? 1 : 0)) as ResolutionLevel["zoom"];
  // Horizon widens with structural richness — a bare entity commits
  // only to "immediate"; a fully decomposed leverage point commits up
  // to "years". This is the agents-side mapping, which is more nuanced
  // than the prior pipeline-side hardcoded "days".
  const horizon: ResolutionLevel["horizon"] =
    zoom >= 5 ? "years" :
    zoom >= 4 ? "months" :
    zoom >= 3 ? "days" :
    zoom >= 2 ? "hours" :
    "immediate";
  const pinned_because: ResolutionLevel["pinned_because"] =
    incidentEdgeCount === 0 ? "awaiting_evidence" :
    zoom >= 5 ? "saturated" :
    "budget";
  return { zoom, horizon, pinned_because };
}

// ── Structured input path (decompose-stage batch wiring) ─────────────
//
// MaterializerContext is the richer narrowed shape used by the
// decompose-stage batch wiring (lib/pipeline/materialize-signatures.ts).
// It carries the fully-typed entity + neighborhood so all five ring
// helpers below can fire (including the optional decomposition +
// leverage rings the SeedInput path doesn't have access to).

export interface MaterializerEntityInput {
  id: string;
  name: string;
  entity_category: "concrete" | "abstract" | "process" | "relational" | "epistemic";
  entity_type: string;
  importance: "fundamental" | "critical" | "important" | "moderate" | null;
  confidence: number;
  is_leverage_point: boolean;
  is_expanded: boolean;
  manifold: {
    controllability?: "direct" | "indirect" | "uncontrollable";
    visibility?: "observable" | "latent" | "hidden";
    volatility?: "stable" | "fluctuating" | "chaotic";
  } | null;
}

export interface MaterializerEdgeInput {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  dimension: ClassifyRelationInput["dimension"];
  polarity: "positive" | "negative" | "neutral" | "conditional";
  strength: number;
  confidence: number;
  is_part_of_cycle: boolean;
}

export interface MaterializerContext {
  entity: MaterializerEntityInput;
  incidentEdges: MaterializerEdgeInput[];
  axisMemberships: ProbabilitySpaceAxis[];
  /** Count of sub-components when is_expanded. 0 otherwise. */
  subComponentCount: number;
}

// Ring builders. Each returns an optional basis + evidence pair; the
// driver assigns `index` after filtering nulls. Order matters: ring 0
// is the innermost, most stable fact about the node (its category).
// Later rings accrete context-dependent variables.

function ringObjectCategory(ctx: MaterializerContext): {
  basis: Omit<BasisElement, "index">;
  evidence: Omit<BasisEvidence, "basis_index">;
} {
  return {
    basis: {
      code: CATEGORY_CODE[ctx.entity.entity_category] ?? "?",
      label: `Object: ${ctx.entity.entity_category}`,
      source_axis: null,
      contribution: 0.4,
      confidence: ctx.entity.confidence,
      controllability: ctx.entity.manifold?.controllability ?? "indirect",
    },
    evidence: {
      source: "entity",
      source_ids: [ctx.entity.id],
      claim: `Entity category fixed by decomposer as ${ctx.entity.entity_category}`,
    },
  };
}

function ringDominantAxis(ctx: MaterializerContext): {
  basis: Omit<BasisElement, "index">;
  evidence: Omit<BasisEvidence, "basis_index">;
} | null {
  if (ctx.axisMemberships.length === 0) return null;
  const axis = ctx.axisMemberships[0];
  return {
    basis: {
      code: AXIS_CODE[axis] ?? axis.slice(0, 3),
      label: `Axis: ${axis}`,
      source_axis: axis,
      contribution: 0.2,
      confidence: 0.85,
      controllability: "indirect",
    },
    evidence: {
      source: "axis",
      source_ids: [axis],
      claim: `Frame extractor placed this node on the ${axis} axis`,
    },
  };
}

function ringDominantRelation(ctx: MaterializerContext): {
  basis: Omit<BasisElement, "index">;
  evidence: Omit<BasisEvidence, "basis_index">;
} | null {
  if (ctx.incidentEdges.length === 0) return null;
  const counts = new Map<RelationType, number>();
  const exampleEdgeIdByType = new Map<RelationType, string>();
  for (const e of ctx.incidentEdges) {
    const t = classifyRelation(e);
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (!exampleEdgeIdByType.has(t)) exampleEdgeIdByType.set(t, e.id);
  }
  let winner: RelationType = "relates_to";
  let best = -1;
  for (const [t, n] of counts) {
    if (n > best) { best = n; winner = t; }
  }
  const dominance = best / Math.max(1, ctx.incidentEdges.length);
  return {
    basis: {
      code: RELATION_CODE[winner],
      label: `Dominant relation: ${winner} (${best}/${ctx.incidentEdges.length})`,
      source_axis: null,
      contribution: 0.15 * dominance,
      confidence: 0.75,
      controllability: "indirect",
    },
    evidence: {
      source: "edge",
      source_ids: [exampleEdgeIdByType.get(winner) ?? ctx.incidentEdges[0].id],
      claim: `Most incident edges classify as ${winner}`,
    },
  };
}

function ringDecomposition(ctx: MaterializerContext): {
  basis: Omit<BasisElement, "index">;
  evidence: Omit<BasisEvidence, "basis_index">;
} | null {
  if (!ctx.entity.is_expanded || ctx.subComponentCount === 0) return null;
  const code = ctx.subComponentCount >= 5 ? "5+" : String(ctx.subComponentCount);
  return {
    basis: {
      code,
      label: `Decomposed: ${ctx.subComponentCount} sub-components`,
      source_axis: null,
      contribution: 0.1,
      confidence: 0.9,
      controllability: "direct",
    },
    evidence: {
      source: "expansion",
      source_ids: [ctx.entity.id],
      claim: `Entity has ${ctx.subComponentCount} expansion sub-components`,
    },
  };
}

function ringLeverage(ctx: MaterializerContext): {
  basis: Omit<BasisElement, "index">;
  evidence: Omit<BasisEvidence, "basis_index">;
} | null {
  if (!ctx.entity.is_leverage_point) return null;
  return {
    basis: {
      code: "✶",
      label: "Leverage point",
      source_axis: null,
      contribution: 0.1,
      confidence: 0.8,
      controllability: ctx.entity.manifold?.controllability ?? "direct",
    },
    evidence: {
      source: "entity",
      source_ids: [ctx.entity.id],
      claim: "Flagged as leverage point by the KG analyzer",
    },
  };
}

/**
 * Structured-input materializer used by the decompose-stage batch
 * wiring. Produces a 1–5 ring signature; rings 4 (decomposition) and 5
 * (leverage) only fire when the entity has the corresponding flags set.
 *
 * Idempotent: same context in → same canonical_code out. Validated
 * against the same invariant as seed/deepen so the DB trigger never
 * gets a malformed signature.
 */
export function materializeFromContext(ctx: MaterializerContext): NodeSignature {
  const candidates = [
    ringObjectCategory(ctx),
    ringDominantAxis(ctx),
    ringDominantRelation(ctx),
    ringDecomposition(ctx),
    ringLeverage(ctx),
  ].filter(Boolean) as Array<{
    basis: Omit<BasisElement, "index">;
    evidence: Omit<BasisEvidence, "basis_index">;
  }>;

  const basis: BasisElement[] = candidates.map((c, i) => ({ ...c.basis, index: i }));
  const evidence: BasisEvidence[] = candidates.map((c, i) => ({
    ...c.evidence,
    basis_index: i,
  }));
  const canonical_code = buildCanonicalCode(basis);
  const residual_uncertainty = Math.max(
    0,
    1 - basis.reduce((sum, b) => sum + b.contribution, 0),
  );

  const sig: NodeSignature = {
    entity_id: ctx.entity.id,
    canonical_code,
    rings: basis.length,
    basis,
    evidence,
    resolution: planResolution(
      basis.length,
      ctx.incidentEdges.length,
      ctx.entity.is_expanded,
    ),
    residual_uncertainty,
    composes_with: [],
    consequence_surface: [],
    materialized_at: new Date().toISOString(),
    version: 1,
  };

  const err = validateNodeSignature(sig);
  if (err) {
    throw new Error(`[signature_materializer] materializeFromContext invariant broken: ${err}`);
  }
  return sig;
}

// ── SEED path ─────────────────────────────────────────────────────────
//
// Deterministic: looks at what the node already IS in the graph and
// encodes that as the first few basis rings. No model calls. The
// rings it picks are the most structurally obvious variables about
// this node — its category, its importance tier, the dominant
// relation type on its edges.
//
// Why this matters: the strategizer's `uncertainty` signal depends on
// a signature existing. A seed signature with residual_uncertainty ≈
// 0.7 is MUCH better than null (null means "we don't know what we
// don't know" — signal omitted entirely). Seeds get every node into
// the strategizer's consideration set.

export interface SeedInput {
  entity: Entity;
  edges: Edge[]; // all edges touching this entity
  axisMemberships: ProbabilitySpaceAxis[]; // axes this entity appeared in (from space_entity_added events)
}

export function seedNodeSignature(input: SeedInput): NodeSignature {
  const { entity, edges, axisMemberships } = input;
  const basis: BasisElement[] = [];
  const evidence: BasisEvidence[] = [];

  // Ring 0 — entity category. Always present. Uses CATEGORY_CODE map
  // (single-char symbol) so canonical_codes stay compact + visually
  // distinct ("C.imp.→.fin" reads better than "concrete.imp.causes.
  // fin"). Falls through to a slug for unknown categories.
  const rawCat = (entity.entity_category ?? "entity").toLowerCase();
  const catCode =
    (CATEGORY_CODE[rawCat] ?? rawCat.slice(0, 6).replace(/[^a-z0-9]/g, "")) ||
    "ent";
  basis.push({
    index: 0,
    code: catCode,
    label: entity.entity_category ?? "Entity",
    source_axis: null,
    contribution: 0.4, // first ring resolves the most structural uncertainty
    confidence: 0.9,
    controllability: "indirect",
  });
  evidence.push({
    basis_index: 0,
    source: "entity",
    source_ids: [entity.id],
    claim: `Typed as ${entity.entity_category ?? "generic entity"} during decomposition.`,
  });

  // Ring 1 — importance tier. Skip if entity has no importance classification
  // to avoid painting a ring for nothing.
  if (entity.importance) {
    const impCode = entity.importance.slice(0, 3);
    basis.push({
      index: 1,
      code: impCode,
      label: `${entity.importance} importance`,
      source_axis: null,
      contribution: 0.15,
      confidence: 0.75,
      controllability: "indirect",
    });
    evidence.push({
      basis_index: 1,
      source: "entity",
      source_ids: [entity.id],
      claim: `Classified as ${entity.importance} importance.`,
    });
  }

  // Ring 2 — dominant relation type. The most common typed relation on
  // edges touching this node (in or out). Tells the layered ring what
  // ROLE the node plays in the graph — mediator, cause, composition
  // member, etc. Very high insight value for downstream strategizer.
  //
  // Routes every edge through classifyRelation() so free-text
  // relationship_type strings (the decomposer LLM frequently emits
  // "leads to" / "drives" / "feeds into") get canonicalized to one of
  // the 10 RelationType members rather than producing 100 micro-buckets
  // that never dominate.
  if (edges.length > 0) {
    const relCount = new Map<RelationType, number>();
    const exampleByType = new Map<RelationType, string>();
    for (const e of edges) {
      const r = classifyRelation({
        dimension: (e as unknown as { dimension?: string }).dimension ?? "causal",
        polarity: (e as unknown as { polarity?: string | null }).polarity ?? "neutral",
        strength: (e as unknown as { strength?: number }).strength,
        relationship_type:
          (e as unknown as { relation_type?: string }).relation_type ??
          e.relationship_type ??
          undefined,
      });
      relCount.set(r, (relCount.get(r) ?? 0) + 1);
      if (!exampleByType.has(r)) exampleByType.set(r, e.id);
    }
    let dominant: RelationType = "relates_to";
    let max = 0;
    for (const [k, v] of relCount) { if (v > max) { max = v; dominant = k; } }
    const ringIdx = basis.length;
    const dominance = max / Math.max(1, edges.length);
    basis.push({
      index: ringIdx,
      code: RELATION_CODE[dominant],
      label: `primary role: ${dominant}`,
      source_axis: null,
      contribution: 0.12 * Math.max(0.5, dominance), // floor so a 1/many dominant relation still earns its ring
      confidence: 0.7,
      controllability: dominant === "causes" || dominant === "inhibits" ? "direct" : "indirect",
    });
    evidence.push({
      basis_index: ringIdx,
      source: "edge",
      source_ids: [exampleByType.get(dominant) ?? edges[0].id],
      claim: `Dominant role across ${max}/${edges.length} edges classifies as ${dominant}.`,
    });
  }

  // Ring 3 (optional) — axis concentration. When an entity shows up in
  // 2+ probability-space axes, the FIRST axis it appeared in gets
  // encoded with its symbol code. Cross-space appearance = leverage
  // signal for the strategizer.
  if (axisMemberships.length >= 2) {
    const primaryAxis = axisMemberships[0];
    const ringIdx = basis.length;
    basis.push({
      index: ringIdx,
      code: AXIS_CODE[primaryAxis] ?? primaryAxis.slice(0, 3),
      label: `primary axis: ${primaryAxis}`,
      source_axis: primaryAxis,
      contribution: 0.1,
      confidence: 0.65,
      controllability: "indirect",
    });
    evidence.push({
      basis_index: ringIdx,
      source: "cross_space_link",
      source_ids: [entity.id],
      claim: `Surfaced in ${axisMemberships.length} axes; primary is ${primaryAxis}.`,
    });
  }

  // Residual uncertainty — starts HIGH for seeds. Each basis contribution
  // pulls it down. Seeded at 1 - sum(contribution).
  const contributionSum = basis.reduce((a, b) => a + b.contribution, 0);
  const residual = Math.max(0.15, Math.min(1, 1 - contributionSum));

  // Use the zoom-aware horizon mapping so seeds match what
  // materializeFromContext() produces for the same basis count.
  // Seed pinned_because defaults to "saturated" (this is as deep as a
  // zero-LLM seed can go) — planResolution would say "budget" given
  // edges exist, so we override to the correct semantic here.
  const baseResolution = planResolution(basis.length, edges.length, false);
  const resolution: ResolutionLevel = {
    ...baseResolution,
    pinned_because: "saturated",
  };

  const sig: NodeSignature = {
    entity_id: entity.id,
    canonical_code: buildCanonicalCode(basis),
    rings: basis.length,
    basis,
    evidence,
    resolution,
    residual_uncertainty: residual,
    composes_with: [],
    consequence_surface: [],
    materialized_at: new Date().toISOString(),
    version: 1,
  };

  const err = validateNodeSignature(sig);
  if (err) {
    // Defensive — the builder above always produces valid signatures,
    // but if some future edit breaks the invariant, fail loud rather
    // than persist a signature the DB trigger will reject.
    throw new Error(`[signature_materializer] seed invariant broken: ${err}`);
  }
  return sig;
}

// ── DEEPEN path ───────────────────────────────────────────────────────
//
// One LLM call. Input: the existing signature + a compact description
// of the node's neighborhood. Output: ONE new basis element to append,
// with its contribution + confidence estimates.
//
// The prompt pushes hard on: "propose a variable that (a) is NOT
// already in the basis, (b) is intervention-relevant, (c) you can
// cite evidence for." Low-novelty, high-controllability rings are
// preferred. If the model can't find a meaningful variable, it
// returns null and the signature stays at its current depth (pinned
// because saturated).

const DEEPEN_SYSTEM = `You are the Signature Materializer.

You deepen a node's canonical signature by ONE ring. Each ring encodes one additional variable the graph now resolves about this node.

Hard rules:
1. The new ring must describe a VARIABLE, not a restatement. "is important" is not a variable; "operates under regulatory scrutiny (moderate→high)" is.
2. The variable must be RELEVANT to intervention design — the user can use it to reason about levers. Purely descriptive rings (color, age, geography) are only acceptable when they gate a mechanism.
3. The variable must NOT duplicate an existing ring. Check the current basis list before proposing.
4. Contribution must be ≤ residual_uncertainty. If you can't justify any contribution > 0.05 after reasoning about the neighborhood, return null — do NOT fabricate a ring just to stay busy.
5. Confidence must reflect evidence strength, not enthusiasm. Cite which edge / axis / expansion supports the ring.

Output strict JSON. No prose outside the object.`;

interface DeepenLLMResponse {
  new_ring: {
    code: string;
    label: string;
    source_axis: ProbabilitySpaceAxis | null;
    contribution: number;
    confidence: number;
    controllability: "direct" | "indirect" | "uncontrollable";
    evidence_claim: string;
    evidence_source: "entity" | "edge" | "expansion" | "axis" | "cross_space_link" | "llm_inference";
  } | null;
  stop_reason: string; // non-empty even on success — "why this ring, not another?"
}

const DEEPEN_SCHEMA = {
  name: "signature_deepen_ring",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      new_ring: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              code: { type: "string", minLength: 1, maxLength: 10 },
              label: { type: "string", minLength: 3 },
              source_axis: {
                anyOf: [
                  { type: "null" },
                  {
                    type: "string",
                    enum: ["financial", "timeline", "actors", "causal_scenarios", "evidence", "assumptions", "risk", "cultural"],
                  },
                ],
              },
              contribution: { type: "number", minimum: 0, maximum: 1 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              controllability: { type: "string", enum: ["direct", "indirect", "uncontrollable"] },
              evidence_claim: { type: "string", minLength: 10 },
              evidence_source: { type: "string", enum: ["entity", "edge", "expansion", "axis", "cross_space_link", "llm_inference"] },
            },
            required: ["code", "label", "source_axis", "contribution", "confidence", "controllability", "evidence_claim", "evidence_source"],
          },
        ],
      },
      stop_reason: { type: "string", minLength: 8 },
    },
    required: ["new_ring", "stop_reason"],
  },
} as const;

export interface DeepenInput {
  entity: Entity;
  currentSignature: NodeSignature;
  neighborhood: {
    incoming: Array<{ relation: string; from_name: string; mechanism: string | null }>;
    outgoing: Array<{ relation: string; to_name: string; mechanism: string | null }>;
    axisMemberships: ProbabilitySpaceAxis[];
  };
}

export async function deepenNodeSignature(
  input: DeepenInput,
): Promise<{ updated: NodeSignature; added: BasisElement | null; stopReason: string }> {
  const { entity, currentSignature, neighborhood } = input;

  const basisList = currentSignature.basis
    .map((b) => `  - [${b.index}] ${b.code} — ${b.label} (contribution=${b.contribution.toFixed(2)})`)
    .join("\n");

  const incBlock = neighborhood.incoming.slice(0, 8).map((e) =>
    `  ← ${e.from_name} [${e.relation}]${e.mechanism ? `: ${e.mechanism}` : ""}`,
  ).join("\n") || "  (none)";
  const outBlock = neighborhood.outgoing.slice(0, 8).map((e) =>
    `  → ${e.to_name} [${e.relation}]${e.mechanism ? `: ${e.mechanism}` : ""}`,
  ).join("\n") || "  (none)";

  const user = `NODE
  name: ${entity.name}
  category: ${entity.entity_category ?? "(untyped)"}
  importance: ${entity.importance ?? "(unclassified)"}

CURRENT SIGNATURE
  canonical_code: ${currentSignature.canonical_code}
  rings: ${currentSignature.rings}
  residual_uncertainty: ${currentSignature.residual_uncertainty.toFixed(2)}
  basis:
${basisList}

NEIGHBORHOOD
  incoming:
${incBlock}
  outgoing:
${outBlock}
  axes this node appears in: ${neighborhood.axisMemberships.join(", ") || "(none)"}

TASK
Propose ONE new ring that most reduces this node's residual_uncertainty.
If no such ring meets the bar (contribution > 0.05, not a duplicate, evidence-cited), return new_ring: null with a stop_reason explaining why.

Output JSON only.`;

  const resp = await llmJSON<DeepenLLMResponse>({
    system: DEEPEN_SYSTEM,
    user,
    model: "gpt-4o",
    temperature: 0.25,
    maxTokens: 500,
    responseSchema: DEEPEN_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
  });

  if (!resp.new_ring) {
    const pinned: NodeSignature = {
      ...currentSignature,
      resolution: { ...currentSignature.resolution, pinned_because: "saturated" },
    };
    return { updated: pinned, added: null, stopReason: resp.stop_reason };
  }

  // Validate — duplicate code / out-of-envelope contribution
  const existingCodes = new Set(currentSignature.basis.map((b) => b.code));
  if (existingCodes.has(resp.new_ring.code)) {
    return {
      updated: {
        ...currentSignature,
        resolution: { ...currentSignature.resolution, pinned_because: "saturated" },
      },
      added: null,
      stopReason: `LLM proposed duplicate ring code ${resp.new_ring.code}; pinned.`,
    };
  }
  const clampedContribution = Math.min(
    resp.new_ring.contribution,
    currentSignature.residual_uncertainty,
  );
  if (clampedContribution < 0.03) {
    return {
      updated: {
        ...currentSignature,
        resolution: { ...currentSignature.resolution, pinned_because: "saturated" },
      },
      added: null,
      stopReason: `Proposed ring contribution (${clampedContribution.toFixed(3)}) below meaningful threshold.`,
    };
  }

  const newIndex = currentSignature.basis.length;
  const ring: BasisElement = {
    index: newIndex,
    code: resp.new_ring.code,
    label: resp.new_ring.label,
    source_axis: resp.new_ring.source_axis,
    contribution: clampedContribution,
    confidence: resp.new_ring.confidence,
    controllability: resp.new_ring.controllability,
  };

  const newEvidence: BasisEvidence = {
    basis_index: newIndex,
    source: resp.new_ring.evidence_source,
    source_ids: [entity.id], // executor can enrich with specific edge ids when known
    claim: resp.new_ring.evidence_claim,
  };

  const newBasis = [...currentSignature.basis, ring];
  const newResidual = Math.max(0.05, currentSignature.residual_uncertainty - clampedContribution);

  const updated: NodeSignature = {
    ...currentSignature,
    rings: newBasis.length,
    basis: newBasis,
    evidence: [...currentSignature.evidence, newEvidence],
    canonical_code: buildCanonicalCode(newBasis),
    residual_uncertainty: newResidual,
    resolution: {
      zoom: Math.min(5, newBasis.length) as ResolutionLevel["zoom"],
      horizon: currentSignature.resolution.horizon,
      pinned_because: newResidual > 0.25 ? "budget" : "saturated",
    },
    version: currentSignature.version + 1,
    materialized_at: new Date().toISOString(),
  };

  const err = validateNodeSignature(updated);
  if (err) {
    throw new Error(`[signature_materializer] deepen invariant broken: ${err}`);
  }
  return { updated, added: ring, stopReason: resp.stop_reason };
}

// ── DEEPEN path (deterministic — no LLM) ─────────────────────────────
//
// Used by pipeline stages that already KNOW the variable to add — e.g.
// the proposal stage flags a node as a leverage point and wants to
// append a leverage ring without paying for an LLM call. The caller
// constructs the ring + evidence; this function handles canonical_code
// rebuild, residual_uncertainty recompute, resolution re-plan, and
// invariant validation. Bumps version by 1.

export function deepenSignatureDeterministic(
  prev: NodeSignature,
  nextRing: Omit<BasisElement, "index">,
  nextEvidence: Omit<BasisEvidence, "basis_index">,
): { signature: NodeSignature; addedIndex: number } {
  const newIndex = prev.basis.length;
  const nextBasis: BasisElement[] = [...prev.basis, { ...nextRing, index: newIndex }];
  const nextEvidenceArr: BasisEvidence[] = [
    ...prev.evidence,
    { ...nextEvidence, basis_index: newIndex },
  ];
  const canonical_code = buildCanonicalCode(nextBasis);
  const residual_uncertainty = Math.max(
    0,
    1 - nextBasis.reduce((sum, b) => sum + b.contribution, 0),
  );
  const signature: NodeSignature = {
    ...prev,
    canonical_code,
    rings: nextBasis.length,
    basis: nextBasis,
    evidence: nextEvidenceArr,
    residual_uncertainty,
    // Re-plan resolution. We don't know current incident-edge count
    // from prev alone, so approximate from prior zoom (if it moved
    // past 0, at least one edge existed when prev was built).
    resolution: planResolution(
      nextBasis.length,
      prev.resolution.zoom > 0 ? 1 : 0,
      prev.resolution.zoom >= 4,
    ),
    version: prev.version + 1,
    materialized_at: new Date().toISOString(),
  };
  const err = validateNodeSignature(signature);
  if (err) {
    throw new Error(`[signature_materializer] deepenSignatureDeterministic invariant broken: ${err}`);
  }
  return { signature, addedIndex: newIndex };
}

// ── Persistence + event emission ─────────────────────────────────────

export async function persistSignature(
  db: AnyDb,
  entityId: string,
  sig: NodeSignature,
): Promise<boolean> {
  try {
    const { error } = await db
      .from("entities")
      .update({
        node_signature: sig,
        resolution_zoom: sig.resolution.zoom,
        resolution_horizon: sig.resolution.horizon,
      })
      .eq("id", entityId);
    if (error) {
      console.warn("[signature_materializer] persist failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[signature_materializer] persist threw:", err);
    return false;
  }
}

export async function emitSignatureDeepened(
  db: AnyDb,
  runId: string | null,
  sig: NodeSignature,
  added: BasisElement,
): Promise<void> {
  const event: SignatureDeepenedEvent = {
    type: "signature_deepened",
    entityId: sig.entity_id,
    canonicalCode: sig.canonical_code,
    addedRing: {
      index: added.index,
      code: added.code,
      label: added.label,
      sourceAxis: added.source_axis,
      contribution: added.contribution,
      confidence: added.confidence,
      controllability: added.controllability,
    },
    rings: sig.rings,
    residualUncertainty: sig.residual_uncertainty,
    version: sig.version,
  };
  await emitStructuralEvent(db, runId, event);
}

// ── Axis membership loader ──────────────────────────────────────────
//
// Reads `space_entity_added` events for this space's most recent runs
// and resolves which axes each entity appeared in. Returns a map
// entityName(normalized) → Set<axis>. Signature seed uses this for
// ring 3 when the node was cross-axis.

export async function loadAxisMembershipsByEntityId(
  db: AnyDb,
  spaceId: string,
): Promise<Map<string, ProbabilitySpaceAxis[]>> {
  const map = new Map<string, ProbabilitySpaceAxis[]>();
  try {
    // Find recent runs for this space
    const { data: runs } = await db
      .from("pipeline_runs")
      .select("id")
      .eq("space_id", spaceId)
      .order("started_at", { ascending: false })
      .limit(5);
    const runIds = ((runs ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (runIds.length === 0) return map;

    const { data: events } = await db
      .from("pipeline_run_events")
      .select("payload")
      .in("run_id", runIds)
      .eq("event_type", "space_entity_added");

    // Normalize by name then join to entities. We don't have a
    // stable entity UUID in the event payload, so normalize by name
    // and let the caller cross-reference.
    const nameAxisMap = new Map<string, Set<ProbabilitySpaceAxis>>();
    for (const row of (events ?? []) as Array<{ payload: { name?: string; spaceKey?: string } }>) {
      const name = row.payload?.name;
      const spaceKey = row.payload?.spaceKey;
      if (!name || !spaceKey) continue;
      const axis = spaceKey.split(":").pop() as ProbabilitySpaceAxis;
      const key = name.trim().toLowerCase();
      let set = nameAxisMap.get(key);
      if (!set) { set = new Set(); nameAxisMap.set(key, set); }
      set.add(axis);
    }

    const { data: entRows } = await db
      .from("entities")
      .select("id, name")
      .eq("space_id", spaceId);
    for (const ent of (entRows ?? []) as Array<{ id: string; name: string }>) {
      const key = ent.name.trim().toLowerCase();
      const axes = nameAxisMap.get(key);
      if (axes && axes.size > 0) map.set(ent.id, Array.from(axes));
    }
  } catch (err) {
    console.warn("[signature_materializer] axis membership load threw:", err);
  }
  return map;
}
