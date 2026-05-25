// ── Objective Canvas — middle-out 4-stage room generator ──
//
// Generates the contents of one sub-objective's room: Pain points →
// Outcomes → Features → cross-layer Correlations. "Middle-out" =
// the objective anchors the top end and pain points anchor the
// bottom end FIRST; outcomes are generated next (anchored by both);
// features bridge the two and are generated LAST. This gives
// features two real anchors instead of being invented in a vacuum.
//
// Persists:
//   - entities (one per layer item) — tagged with
//     parent_sub_objective_id + layer_ontology_id
//   - edges (one per cross-layer correlation) — tagged with
//     parent_sub_objective_id, polarity / strength from LLM
//
// Returns a summary so the API caller can render counts. The room
// page itself re-queries entities + edges on next paint.

import { llmJSON } from "@/lib/llm";

interface LayerRow {
  id: string;
  slug: string;
  label: string;
}

export interface RoomContext {
  spaceId: string;
  userId: string;
  /** improvement_goals.id of the sub-objective (room owner). */
  subObjectiveId: string;
  subObjectiveTitle: string;
  subObjectiveDescription: string | null;
  /** The parent (core) objective text — sits in the "objective" layer
   *  as a single anchor entity. */
  coreObjectiveText: string;
  /** Clarifying answers as a flat list — helps the LLM pin the
   *  problem space. Skipped entries dropped by caller. */
  clarifyingAnswers: Array<{ question: string; answer: string }>;
  /** 4 layer_ontology rows for this space, keyed by slug. */
  layersBySlug: Map<"pain" | "features" | "outcomes" | "objective", LayerRow>;
}

export interface GenerationSummary {
  pain_count: number;
  outcome_count: number;
  feature_count: number;
  edge_count: number;
}

// ── Shared prompt scaffolding ──────────────────────────────────────

const ANTI_PLATITUDE = `ANTI-PLATITUDE RULE: every item must reference something specific from the sub-objective or clarifying answers. Items that could appear unchanged on a different sub-objective MUST be rewritten.`;

function clarifyingBlock(
  answers: RoomContext["clarifyingAnswers"],
): string {
  if (answers.length === 0) return "";
  return `\n\nCLARIFYING ANSWERS THE USER COMMITTED TO:\n${answers
    .map((a, i) => `  ${i + 1}. ${a.question} → ${a.answer}`)
    .join("\n")}`;
}

// ── Stage A: Pain points ───────────────────────────────────────────

interface PainShape {
  items?: Array<{ name?: unknown; description?: unknown }>;
}

async function generatePainPoints(
  ctx: RoomContext,
): Promise<Array<{ name: string; description: string }>> {
  const system = `You map the load-bearing pain points a sub-objective must address.

A "pain point" is a problem, bottleneck, friction, or unmet need. Pain points are observable in the user's world today — not what the system will produce, but what's broken without it.

OUTPUT:
- 3–5 pain points, ordered by severity / centrality (most blocking first).
- name: 4–10 words, concrete.
- description: 1–2 sentences. State WHO experiences it + WHY it bites.

${ANTI_PLATITUDE}

Return strict JSON.`;

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText}\n"""\n\nSUB-OBJECTIVE (room scope):\n"""\n${ctx.subObjectiveTitle}${
    ctx.subObjectiveDescription
      ? `\n\n${ctx.subObjectiveDescription}`
      : ""
  }\n"""${clarifyingBlock(ctx.clarifyingAnswers)}

Generate 3–5 pain points that this sub-objective must address. They are the BOTTOM end of the middle-out flow; outcomes and features will be anchored by them.`;

  const raw = await llmJSON<PainShape>({
    system,
    user,
    responseSchema: {
      name: "pain_points",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" },
              },
              required: ["name", "description"],
            },
          },
        },
        required: ["items"],
      },
    },
    temperature: 0.5,
    maxTokens: 1500,
  });
  return cleanItems(raw?.items, 5);
}

// ── Stage B: Outcomes ──────────────────────────────────────────────

interface OutcomeShape {
  items?: Array<{ name?: unknown; description?: unknown }>;
}

async function generateOutcomes(
  ctx: RoomContext,
  painPoints: Array<{ name: string; description: string }>,
): Promise<Array<{ name: string; description: string }>> {
  const system = `You map the outcomes a sub-objective should produce.

An "outcome" is a desired state — a measurable / observable thing being true when the sub-objective is delivered. Outcomes are anchored by both the objective (top) and the pain points (bottom): each outcome must be a plausible bridge between SOMETHING that bites in the pain layer and the parent objective.

OUTPUT:
- 3–5 outcomes, ordered by how directly they signal sub-objective success.
- name: 4–10 words, concrete, ideally something observable.
- description: 1–2 sentences. State what's true when this outcome lands.

${ANTI_PLATITUDE}

Return strict JSON.`;

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText}\n"""\n\nSUB-OBJECTIVE (room scope):\n"""\n${ctx.subObjectiveTitle}${
    ctx.subObjectiveDescription ? `\n\n${ctx.subObjectiveDescription}` : ""
  }\n"""${clarifyingBlock(ctx.clarifyingAnswers)}

PAIN POINTS (already generated):
${painPoints.map((p, i) => `  ${i + 1}. ${p.name} — ${p.description}`).join("\n")}

Generate 3–5 outcomes that, taken together, would constitute delivering this sub-objective. Each outcome should plausibly DISSOLVE one or more of the pain points listed.`;

  const raw = await llmJSON<OutcomeShape>({
    system,
    user,
    responseSchema: {
      name: "outcomes",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" },
              },
              required: ["name", "description"],
            },
          },
        },
        required: ["items"],
      },
    },
    temperature: 0.5,
    maxTokens: 1500,
  });
  return cleanItems(raw?.items, 5);
}

// ── Stage C: Features (anchored by BOTH pain + outcomes) ────────────

interface FeatureShape {
  items?: Array<{ name?: unknown; description?: unknown }>;
}

async function generateFeatures(
  ctx: RoomContext,
  painPoints: Array<{ name: string; description: string }>,
  outcomes: Array<{ name: string; description: string }>,
): Promise<Array<{ name: string; description: string }>> {
  const system = `You design the features that BRIDGE pain points to outcomes for one sub-objective.

A "feature" is a concrete solution, mechanism, intervention, or capability the system provides. Features are generated LAST in the middle-out flow because they're anchored by both ends: each feature must touch ≥1 pain point AND ≥1 outcome. Features that aren't anchored on both sides are useless — rewrite or drop them.

OUTPUT:
- 3–6 features, ordered by how much pain → outcome they cover.
- name: 4–10 words, concrete and unambiguous.
- description: 1–2 sentences. State HOW it actually works.

${ANTI_PLATITUDE}

Return strict JSON.`;

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText}\n"""\n\nSUB-OBJECTIVE (room scope):\n"""\n${ctx.subObjectiveTitle}\n"""${clarifyingBlock(ctx.clarifyingAnswers)}

PAIN POINTS:
${painPoints.map((p, i) => `  ${i + 1}. ${p.name} — ${p.description}`).join("\n")}

DESIRED OUTCOMES:
${outcomes.map((o, i) => `  ${i + 1}. ${o.name} — ${o.description}`).join("\n")}

Generate 3–6 features that bridge the pain points to the outcomes. Each feature must plausibly touch at least one pain AND at least one outcome.`;

  const raw = await llmJSON<FeatureShape>({
    system,
    user,
    responseSchema: {
      name: "features",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" },
              },
              required: ["name", "description"],
            },
          },
        },
        required: ["items"],
      },
    },
    temperature: 0.55,
    maxTokens: 1600,
  });
  return cleanItems(raw?.items, 6);
}

// ── Stage D: Cross-layer correlations ──────────────────────────────

interface CorrelationShape {
  edges?: Array<{
    source?: unknown;
    target?: unknown;
    relationship?: unknown;
    strength?: unknown;
    polarity?: unknown;
    rationale?: unknown;
  }>;
}

interface ItemRef {
  id: string;
  name: string;
  layer: "pain" | "outcomes" | "features" | "objective";
}

async function generateCorrelations(
  ctx: RoomContext,
  items: ItemRef[],
): Promise<
  Array<{
    sourceId: string;
    targetId: string;
    relationship: string;
    strength: number;
    polarity: "positive" | "negative" | "ambiguous";
    rationale: string;
  }>
> {
  if (items.length < 2) return [];

  // Compact identifier for the LLM: stable short tags so it doesn't
  // have to echo full uuids. We map back after.
  const tagged = items.map((it, i) => ({
    ...it,
    tag: `${it.layer[0].toUpperCase()}${i + 1}`,
  }));
  const tagById = new Map(tagged.map((t) => [t.id, t.tag]));
  const idByTag = new Map(tagged.map((t) => [t.tag, t.id]));

  const system = `You rank the cross-layer correlations inside one sub-objective room.

The room has items in four layers (Pain → Features → Outcomes → Objective). You will produce EDGES that connect items across these layers. Each edge must be meaningful — never connect things "because they're in the same room."

Allowed edge directions:
  - pain → features         (feature addresses this pain)
  - features → outcomes     (feature produces this outcome)
  - features → pain         (rare — only if the feature notably AGGRAVATES it)
  - outcomes → objective    (this outcome rolls up to the parent)
  - pain → outcomes         (the absence-of-pain itself is the outcome)

EDGE PROPERTIES:
- relationship: a SHORT lowercase verb phrase, 1–3 words ("addresses", "produces", "blocks", "rolls up to", "depends on", "aggravates").
- strength ∈ [0,1]: how load-bearing this link is. ≥0.7 = critical, 0.4–0.7 = supportive, <0.4 = weak / nice-to-have.
- polarity: "positive" (the source PROMOTES the target), "negative" (REDUCES it), or "ambiguous" (depends on context).
- rationale: ONE sentence. Cite the mechanism — not a tautology.

OUTPUT:
- Return 5–12 of the strongest edges. Quality over quantity. If only 4 are real, return 4.

${ANTI_PLATITUDE}

Return strict JSON.`;

  const user = `SUB-OBJECTIVE:\n"""\n${ctx.subObjectiveTitle}\n"""

ITEMS BY TAG:
${tagged
  .map((it) => `  ${it.tag} [${it.layer}] ${it.name}`)
  .join("\n")}

Generate 5–12 cross-layer edges. Use the tags above as source / target (e.g. "P1" → "F2"). Skip any edge whose strength would be below 0.3 — quality over coverage.`;

  const raw = await llmJSON<CorrelationShape>({
    system,
    user,
    responseSchema: {
      name: "correlations",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          edges: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                source: { type: "string" },
                target: { type: "string" },
                relationship: { type: "string" },
                strength: { type: "number" },
                polarity: {
                  type: "string",
                  enum: ["positive", "negative", "ambiguous"],
                },
                rationale: { type: "string" },
              },
              required: [
                "source",
                "target",
                "relationship",
                "strength",
                "polarity",
                "rationale",
              ],
            },
          },
        },
        required: ["edges"],
      },
    },
    temperature: 0.4,
    maxTokens: 2200,
  });
  const cleaned: Array<{
    sourceId: string;
    targetId: string;
    relationship: string;
    strength: number;
    polarity: "positive" | "negative" | "ambiguous";
    rationale: string;
  }> = [];
  for (const e of raw?.edges ?? []) {
    const srcTag =
      typeof e?.source === "string" ? e.source.trim().toUpperCase() : "";
    const tgtTag =
      typeof e?.target === "string" ? e.target.trim().toUpperCase() : "";
    const srcId = idByTag.get(srcTag);
    const tgtId = idByTag.get(tgtTag);
    if (!srcId || !tgtId || srcId === tgtId) continue;
    const relationship =
      typeof e?.relationship === "string"
        ? e.relationship.trim().toLowerCase().slice(0, 40)
        : "";
    if (relationship.length === 0) continue;
    const strength =
      typeof e?.strength === "number" && Number.isFinite(e.strength)
        ? Math.max(0, Math.min(1, e.strength))
        : 0.5;
    if (strength < 0.3) continue;
    const polarity =
      e?.polarity === "positive" ||
      e?.polarity === "negative" ||
      e?.polarity === "ambiguous"
        ? e.polarity
        : "positive";
    const rationale =
      typeof e?.rationale === "string" ? e.rationale.trim() : "";
    cleaned.push({
      sourceId: srcId,
      targetId: tgtId,
      relationship,
      strength,
      polarity,
      rationale,
    });
  }
  // Use tagById to silence unused warning + future hover annotation.
  void tagById;
  return cleaned.slice(0, 12);
}

// ── Orchestrator ───────────────────────────────────────────────────

/**
 * Run all four stages back-to-back. The DB writes are factored out
 * so the API route owns transaction-ish ordering (entities first,
 * then edges that reference them).
 */
export async function runLayeredGeneration(ctx: RoomContext): Promise<{
  pain: Array<{ name: string; description: string }>;
  outcomes: Array<{ name: string; description: string }>;
  features: Array<{ name: string; description: string }>;
  // Correlations are filled by `linkCorrelations` AFTER entities are
  // persisted (so we have ids to reference). Returned empty here.
  correlations: never[];
}> {
  const pain = await generatePainPoints(ctx);
  const outcomes = await generateOutcomes(ctx, pain);
  const features = await generateFeatures(ctx, pain, outcomes);
  return { pain, outcomes, features, correlations: [] };
}

/**
 * Second pass that runs after entities are persisted. Takes the
 * full item set (id + layer + name) and asks the LLM for ranked
 * cross-layer edges.
 */
export async function linkCorrelations(
  ctx: RoomContext,
  items: ItemRef[],
) {
  return generateCorrelations(ctx, items);
}

// ── Helpers ────────────────────────────────────────────────────────

function cleanItems(
  raw: unknown,
  max: number,
): Array<{ name: string; description: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it): { name: string; description: string } | null => {
      if (!it || typeof it !== "object") return null;
      const r = it as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (name.length === 0) return null;
      const description =
        typeof r.description === "string" ? r.description.trim() : "";
      return { name: name.slice(0, 200), description: description.slice(0, 600) };
    })
    .filter((x): x is { name: string; description: string } => x !== null)
    .slice(0, max);
}
