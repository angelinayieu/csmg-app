// ── Objective Canvas — middle-out 4-stage room generator (v2) ──
//
// Generates the contents of one sub-objective's room with a real
// causal chain per item:
//
//   PAIN POINT     root_causes[] →  pain title (effect)  →  negative_outcome
//   FEATURE        first_principles[] →  feature title  →  positive_outcome
//   OUTCOME        title + measured_by (a concrete signal)
//   OBJECTIVE      a single anchor (the sub-objective title)
//
// Middle-out order: pain points first (they anchor the bottom);
// outcomes next (anchored by pains + the objective); features last
// (anchored by both ends). After entities exist a separate pass
// produces ranked cross-layer correlation edges.
//
// We also surface a room-level `top_negative_outcome`: the single
// most-impactful downstream consequence across all pain points,
// used as the room's header anchor ("Counters: …").

import { llmJSON } from "@/lib/llm";

interface LayerRow {
  id: string;
  slug: string;
  label: string;
}

export interface RoomContext {
  spaceId: string;
  userId: string;
  subObjectiveId: string;
  subObjectiveTitle: string;
  subObjectiveDescription: string | null;
  coreObjectiveText: string;
  clarifyingAnswers: Array<{ question: string; answer: string }>;
  layersBySlug: Map<"pain" | "features" | "outcomes" | "objective", LayerRow>;
}

// ── Output shapes ──────────────────────────────────────────────────

export interface PainItem {
  name: string;
  /** What this pain leads to downstream — a single concrete state. */
  negative_outcome: string;
  /** 2-4 short noun phrases (≤6 words each) — the underlying causes. */
  root_causes: string[];
  /** 0-5 LLM self-assessment of how central this pain is. Higher =
   *  this pain influences / contributes to more other pains. The
   *  highest-ranked pain in the room renders with the Root ⭐ badge. */
  influence_rank: number;
}

export interface FeatureItem {
  name: string;
  /** What this feature produces when it lands — single concrete state. */
  positive_outcome: string;
  /** 2-4 short noun phrases (≤6 words each) — why this works. */
  first_principles: string[];
}

export interface OutcomeItem {
  name: string;
  /** A concrete proxy / signal that says "yes this happened". */
  measured_by: string;
}

// ── Shared scaffolding ─────────────────────────────────────────────

const ANTI_PLATITUDE = `ANTI-PLATITUDE: every item references something specific from the sub-objective or clarifying answers. Items that could appear unchanged on a different sub-objective MUST be rewritten.`;

const TITLE_RULES = `TITLE: noun phrase, ≤6 words. Do NOT start with action verbs (develop/implement/create/design/build/enhance/establish). Title-case OK; no terminal punctuation.`;

function clarifyingBlock(
  answers: RoomContext["clarifyingAnswers"],
): string {
  if (answers.length === 0) return "";
  return `\n\nCLARIFYING ANSWERS:\n${answers
    .map((a, i) => `  ${i + 1}. ${a.question} → ${a.answer}`)
    .join("\n")}`;
}

// ── Stage A: Pain points (with causal chain) ───────────────────────

interface PainShape {
  items?: Array<{
    name?: unknown;
    negative_outcome?: unknown;
    root_causes?: unknown;
    influence_rank?: unknown;
  }>;
  top_negative_outcome?: unknown;
  lane_labels?: {
    pain?: unknown;
    features?: unknown;
    outcomes?: unknown;
    objective?: unknown;
  };
}

/** Adaptive lane labels — the four bucket nouns chosen by the LLM
 *  to match the sub-objective's domain. Empty strings collapse to
 *  the canonical fallbacks in the room view. */
export interface LaneLabels {
  pain: string;
  features: string;
  outcomes: string;
  objective: string;
}

interface PainPassResult {
  items: PainItem[];
  /** Single line synthesizing the worst downstream consequence
   *  across all pains — the room header anchor. */
  top_negative_outcome: string;
  /** Domain-specific 4 lane labels (≤2 words each). */
  lane_labels: LaneLabels;
}

async function generatePainPoints(
  ctx: RoomContext,
): Promise<PainPassResult> {
  const system = `You map the load-bearing pain points a sub-objective must address — with their causal chain made explicit.

A pain point is an observable EFFECT in the user's world. Every pain has TWO ENDS we want named:
  • root_causes — the underlying reasons it exists. 2-4 short noun phrases (≤6 words each). Concrete and orthogonal. These are what a SOLUTION would attack.
  • negative_outcome — what this pain leads to downstream if not addressed. Single line, one concrete state.

Also include an INFLUENCE_RANK (0-5): how much does this pain feed / amplify other pains? A pain that causes 3 other pains scores high; an isolated pain scores low.

ROOM SYNTHESIS:
After listing the pains, produce a single TOP_NEGATIVE_OUTCOME: the worst downstream consequence the room exists to counter, synthesizing across all pains. One short line — used as the room's header anchor.

LANE LABELS (adaptive):
Also pick four short noun labels that match the user's DOMAIN — these rename the four lanes of the room so they speak the user's language. Each label is ≤2 words, title-case, no terminal punctuation:
  • lane_labels.pain      → the bucket name for "problems / frictions / symptoms" in this domain
  • lane_labels.features  → the bucket name for "solutions / mechanisms / levers / bets" in this domain
  • lane_labels.outcomes  → the bucket name for "results / states / wins" in this domain
  • lane_labels.objective → name the umbrella anchor for this domain (often "Objective" or "Goal")

Examples by domain:
  App / product:        { pain: "Frictions",  features: "Features",    outcomes: "Outcomes",         objective: "Objective" }
  Curriculum / course:  { pain: "Gaps",       features: "Lessons",     outcomes: "Skills",           objective: "Mastery"   }
  Clinical / therapy:   { pain: "Symptoms",   features: "Mechanisms",  outcomes: "Functional gains", objective: "Recovery"  }
  Strategy / business:  { pain: "Frictions",  features: "Bets",        outcomes: "Wins",             objective: "Goal"      }
  Research:             { pain: "Open Qs",    features: "Investigations", outcomes: "Findings",      objective: "Thesis"    }
  Workout / health:     { pain: "Limits",     features: "Movements",   outcomes: "Capacities",       objective: "Goal"      }
  Operations:           { pain: "Frictions",  features: "Levers",      outcomes: "Throughput",       objective: "Target"    }

Pick labels FROM the user's actual domain. Never invent jargon. Stay specific.

PAIN RULES:
- 3-5 pains, ordered by influence_rank descending.
- ${TITLE_RULES}
- Pain titles name the EFFECT ("Low engagement depth"), not the cause ("Generic results") and not the outcome ("Superficial browsing"). Those go in the root_causes and negative_outcome fields respectively.
- negative_outcome is short, single line.
- root_causes are independent — don't repeat. Cross-pain reuse of identical strings is encouraged (shared causes drive the shared-pill UI).

${ANTI_PLATITUDE}

Return strict JSON.`;

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText}\n"""\n\nSUB-OBJECTIVE (room scope):\n"""\n${ctx.subObjectiveTitle}${
    ctx.subObjectiveDescription
      ? `\n\n${ctx.subObjectiveDescription}`
      : ""
  }\n"""${clarifyingBlock(ctx.clarifyingAnswers)}

Generate 3-5 pain points with full causal chains, plus the single TOP_NEGATIVE_OUTCOME for the room.`;

  const raw = await llmJSON<PainShape>({
    system,
    user,
    responseSchema: {
      name: "pain_points_v2",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          top_negative_outcome: { type: "string" },
          lane_labels: {
            type: "object",
            additionalProperties: false,
            properties: {
              pain: { type: "string" },
              features: { type: "string" },
              outcomes: { type: "string" },
              objective: { type: "string" },
            },
            required: ["pain", "features", "outcomes", "objective"],
          },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                negative_outcome: { type: "string" },
                root_causes: {
                  type: "array",
                  items: { type: "string" },
                },
                influence_rank: { type: "number" },
              },
              required: [
                "name",
                "negative_outcome",
                "root_causes",
                "influence_rank",
              ],
            },
          },
        },
        required: ["items", "top_negative_outcome", "lane_labels"],
      },
    },
    temperature: 0.5,
    maxTokens: 2400,
  });

  const items = cleanPains(raw?.items);
  const top =
    typeof raw?.top_negative_outcome === "string"
      ? raw.top_negative_outcome.trim().slice(0, 200)
      : "";
  const lane_labels = cleanLaneLabels(raw?.lane_labels);
  return { items, top_negative_outcome: top, lane_labels };
}

// ── Stage B: Outcomes ──────────────────────────────────────────────

interface OutcomeShape {
  items?: Array<{ name?: unknown; measured_by?: unknown }>;
}

async function generateOutcomes(
  ctx: RoomContext,
  painPoints: PainItem[],
): Promise<OutcomeItem[]> {
  const system = `You name the outcomes the sub-objective should produce — anchored on both ends.

An OUTCOME is a desired state — a measurable/observable thing being true when the sub-objective is delivered. Each outcome must plausibly DISSOLVE one or more of the pain points listed, while rolling up toward the parent objective.

For each outcome include MEASURED_BY: a concrete proxy/signal that says "yes this happened" (e.g. "8+ min/session", "85% return next day", "self-reported flow 4/5"). One short line.

OUTCOME RULES:
- 3-5 outcomes, ordered by how directly they signal sub-objective success.
- ${TITLE_RULES}
- name describes the STATE, not the action. "Sustained deep-dive sessions" not "Increase session length".

${ANTI_PLATITUDE}

Return strict JSON.`;

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText}\n"""\n\nSUB-OBJECTIVE:\n"""\n${ctx.subObjectiveTitle}\n"""${clarifyingBlock(ctx.clarifyingAnswers)}

PAIN POINTS (each with its negative_outcome):
${painPoints.map((p, i) => `  ${i + 1}. ${p.name} → ${p.negative_outcome}`).join("\n")}

Generate 3-5 outcomes that, taken together, would dissolve those pains and roll up to the parent objective.`;

  const raw = await llmJSON<OutcomeShape>({
    system,
    user,
    responseSchema: {
      name: "outcomes_v2",
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
                measured_by: { type: "string" },
              },
              required: ["name", "measured_by"],
            },
          },
        },
        required: ["items"],
      },
    },
    temperature: 0.5,
    maxTokens: 1800,
  });
  return cleanOutcomes(raw?.items);
}

// ── Stage C: Features (with first principles + positive outcome) ───

interface FeatureShape {
  items?: Array<{
    name?: unknown;
    positive_outcome?: unknown;
    first_principles?: unknown;
  }>;
}

async function generateFeatures(
  ctx: RoomContext,
  painPoints: PainItem[],
  outcomes: OutcomeItem[],
): Promise<FeatureItem[]> {
  const system = `You design the features that BRIDGE pain points to outcomes — anchored on both ends with first principles named.

A FEATURE is a concrete solution / mechanism / capability the system provides. For each feature, surface:
  • first_principles — 2-4 short noun phrases (≤6 words each) explaining WHY this works. The mechanism it leverages, the lever it pulls.
  • positive_outcome — what this feature produces when it lands. Single line. Often paired with an outcome above.

Features are generated LAST because they're anchored by both ends. Every feature must plausibly counter ≥1 pain AND produce ≥1 outcome. Features without two anchors are useless — drop them.

FEATURE RULES:
- 3-6 features, ordered by how much pain → outcome they cover.
- ${TITLE_RULES}
- first_principles reuse across features is encouraged where real (shared principles drive shared-pill UI).

${ANTI_PLATITUDE}

Return strict JSON.`;

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText}\n"""\n\nSUB-OBJECTIVE:\n"""\n${ctx.subObjectiveTitle}\n"""${clarifyingBlock(ctx.clarifyingAnswers)}

PAIN POINTS (with negative_outcomes):
${painPoints.map((p, i) => `  ${i + 1}. ${p.name} → ${p.negative_outcome}`).join("\n")}

DESIRED OUTCOMES:
${outcomes.map((o, i) => `  ${i + 1}. ${o.name} (measured by: ${o.measured_by})`).join("\n")}

Generate 3-6 features that bridge the pains to the outcomes. Each feature must plausibly counter ≥1 pain AND produce ≥1 outcome.`;

  const raw = await llmJSON<FeatureShape>({
    system,
    user,
    responseSchema: {
      name: "features_v2",
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
                positive_outcome: { type: "string" },
                first_principles: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["name", "positive_outcome", "first_principles"],
            },
          },
        },
        required: ["items"],
      },
    },
    temperature: 0.55,
    maxTokens: 2200,
  });
  return cleanFeatures(raw?.items);
}

// ── Stage D: Cross-layer correlations (unchanged from v1) ──────────

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

  const tagged = items.map((it, i) => ({
    ...it,
    tag: `${it.layer[0].toUpperCase()}${i + 1}`,
  }));
  const idByTag = new Map(tagged.map((t) => [t.tag, t.id]));

  const system = `You rank cross-layer correlations inside one sub-objective room.

Items live in four layers (Pain → Features → Outcomes → Objective). Produce edges that connect items across layers — never connect items "because they're in the same room."

Allowed directions:
  pain → features         (feature addresses this pain)
  features → outcomes     (feature produces this outcome)
  pain → outcomes         (the absence-of-pain itself is the outcome)
  outcomes → objective    (outcome rolls up to the parent)
  features → pain         (rare — only if feature notably AGGRAVATES it)

EDGE PROPERTIES:
- relationship: SHORT lowercase verb phrase (1-3 words).
- strength ∈ [0,1]: load-bearing-ness. ≥0.7 critical, 0.4-0.7 supportive, <0.4 weak.
- polarity: positive | negative | ambiguous.
- rationale: ONE sentence on the mechanism. No tautologies.

5-12 strongest edges. Quality > coverage. Drop strength < 0.3.

Return strict JSON.`;

  const user = `SUB-OBJECTIVE: ${ctx.subObjectiveTitle}

ITEMS BY TAG:
${tagged.map((it) => `  ${it.tag} [${it.layer}] ${it.name}`).join("\n")}

Generate 5-12 cross-layer edges using the tags above.`;

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
  return cleaned.slice(0, 12);
}

// ── Orchestrator ───────────────────────────────────────────────────

export async function runLayeredGeneration(ctx: RoomContext): Promise<{
  pain: PainItem[];
  outcomes: OutcomeItem[];
  features: FeatureItem[];
  top_negative_outcome: string;
  lane_labels: LaneLabels;
}> {
  const painPass = await generatePainPoints(ctx);
  const outcomes = await generateOutcomes(ctx, painPass.items);
  const features = await generateFeatures(ctx, painPass.items, outcomes);
  return {
    pain: painPass.items,
    outcomes,
    features,
    top_negative_outcome: painPass.top_negative_outcome,
    lane_labels: painPass.lane_labels,
  };
}

export async function linkCorrelations(
  ctx: RoomContext,
  items: ItemRef[],
) {
  return generateCorrelations(ctx, items);
}

// ── Cleaners (with verb-prefix safety net) ─────────────────────────

const VERB_PREFIX_PATTERN =
  /^(develop|implement|create|design|build|enhance|establish|drive|deliver|provide|enable|generate|produce|conduct)\s+(a\s+|the\s+)?/i;

function stripVerbPrefix(s: string): string {
  const stripped = s.replace(VERB_PREFIX_PATTERN, "").trim();
  if (stripped.length === 0) return s.trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function trimList(raw: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, max);
}

/** Normalize lane_labels: each label is trimmed, capped at 24 chars
 *  (compact enough to fit in a lane header), and falls back to the
 *  canonical name when missing so the UI always has something to
 *  show. */
function cleanLaneLabels(raw: unknown): LaneLabels {
  const fallback: LaneLabels = {
    pain: "Pain points",
    features: "Features",
    outcomes: "Outcomes",
    objective: "Objective",
  };
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const one = (key: keyof LaneLabels): string => {
    const v = r[key];
    if (typeof v !== "string") return fallback[key];
    const cleaned = v.trim().replace(/[.!?,:;]+$/g, "").slice(0, 24).trim();
    return cleaned.length > 0 ? cleaned : fallback[key];
  };
  return {
    pain: one("pain"),
    features: one("features"),
    outcomes: one("outcomes"),
    objective: one("objective"),
  };
}

function cleanPains(raw: unknown): PainItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): PainItem | null => {
      if (!p || typeof p !== "object") return null;
      const r = p as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (name.length === 0) return null;
      const neg =
        typeof r.negative_outcome === "string" ? r.negative_outcome.trim() : "";
      const causes = trimList(r.root_causes, 4, 80);
      const rank =
        typeof r.influence_rank === "number" && Number.isFinite(r.influence_rank)
          ? Math.max(0, Math.min(5, r.influence_rank))
          : 2.5;
      return {
        name: stripVerbPrefix(name).slice(0, 200),
        negative_outcome: neg.slice(0, 200),
        root_causes: causes,
        influence_rank: rank,
      };
    })
    .filter((p): p is PainItem => p !== null)
    .slice(0, 5);
}

function cleanFeatures(raw: unknown): FeatureItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): FeatureItem | null => {
      if (!p || typeof p !== "object") return null;
      const r = p as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (name.length === 0) return null;
      const pos =
        typeof r.positive_outcome === "string" ? r.positive_outcome.trim() : "";
      const principles = trimList(r.first_principles, 4, 80);
      return {
        name: stripVerbPrefix(name).slice(0, 200),
        positive_outcome: pos.slice(0, 200),
        first_principles: principles,
      };
    })
    .filter((p): p is FeatureItem => p !== null)
    .slice(0, 6);
}

function cleanOutcomes(raw: unknown): OutcomeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): OutcomeItem | null => {
      if (!p || typeof p !== "object") return null;
      const r = p as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (name.length === 0) return null;
      const measured =
        typeof r.measured_by === "string" ? r.measured_by.trim() : "";
      return {
        name: stripVerbPrefix(name).slice(0, 200),
        measured_by: measured.slice(0, 150),
      };
    })
    .filter((p): p is OutcomeItem => p !== null)
    .slice(0, 5);
}
