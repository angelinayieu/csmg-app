// ── Objective Canvas — sub-objective decompose prompt ──
//
// Generates 4–5 sub-objective proposals from the refined objective
// + clarifying answers. The LLM marks 3 as `recommended=true` (the
// picker UI pre-checks these). Confidence is the LLM's
// self-assessed plausibility, 0–1.

import type { ClarifyingBlock } from "./clarifying-state";
import type { ObjectiveAnnotation } from "./generate-annotations";
import type {
  SubObjectiveIntent,
  SubObjectiveProposal,
} from "./sub-objective-state";
import {
  buildPriorConceptsBlock,
  PRIOR_CONCEPTS_RULE,
  type RelevantCanonicalConcept,
} from "./canonical-concept-lookup";

export interface BuildDecomposeArgs {
  objective: string;
  clarifying: ClarifyingBlock | null;
  /** Optional RESEARCH CONTEXT block from research-service.
   *  buildRagBlock(). When present, prepended to the user prompt so
   *  the decomposition is grounded in real sources. Empty string =
   *  no research yet (decomposition falls back to LLM-only). */
  ragBlock?: string;
  /** Variant Lab — intent steering this generation. Defaults to
   *  "initial" for the first pass; subsequent regens carry a steering
   *  intent that changes the system prompt + temperature. */
  intent?: SubObjectiveIntent;
  /** Variant Lab — proposals from prior batches. When present, an
   *  ANTI-DUPLICATE block is injected: the LLM must NOT trivially
   *  paraphrase the existing set. */
  existingProposals?: SubObjectiveProposal[];
  /** Variant Lab — parent objective annotation lens (top-8 weight-
   *  sorted). When present, lens block is included + each new
   *  proposal must emit lens_coverage[] back. */
  lens?: ObjectiveAnnotation[];
  /** Variant Lab — 1-based annotation indices NOT YET covered by
   *  any elected proposal. Powers the gap_fill intent: prompt
   *  highlights these as targets the new batch should attack. */
  uncoveredLensIndices?: number[];
  /** Cross-space KG — canonical concepts the user has already
   *  explored across other spaces, ranked by relevance to this
   *  objective. Injected as a "link or diverge" block. Empty
   *  array → block is omitted, generation falls through to
   *  intra-space-only context (legacy behavior). */
  priorConcepts?: RelevantCanonicalConcept[];
  /** O2 — Concept memory feed. Distinct from priorConcepts:
   *  priorConcepts is SIMILARITY-scoped to this objective (precision);
   *  recentConcepts is ACTIVITY-scoped (recency × cross-space spread,
   *  regardless of similarity to this objective). Surfaces what's HOT
   *  in the user's mind across all spaces. When natural overlap with
   *  the objective's decomposition exists, prefer that framing — when
   *  it doesn't, treat as background attention signal, don't force.
   *
   *  Empty / undefined tolerated; cold-start users have none. */
  recentConcepts?: Array<{
    display_name: string;
    description: string | null;
    entity_count: number;
    space_count: number;
  }>;
  /** Phase 11.A.4 — when the objective's layer stack has been
   *  generated, pass it here so the system prompt gains a JOB 3
   *  (tag each proposal with layer_ordinals + layer_position_label)
   *  and the user prompt injects an AVAILABLE LAYERS block. Without
   *  this, the proposer behaves identically to pre-11.A — proposals
   *  are emitted without layer tags. Back-compat preserved. */
  objectiveStack?: import("./layer-model").ObjectiveStack;
}

/** Intent-specific mixins appended to the base system prompt. Each
 *  is a complete instruction block that pushes the LLM toward a
 *  distinct generation behavior. */
const INTENT_MIXINS: Record<SubObjectiveIntent, string> = {
  initial: ``,
  creative: `

INTENT — CREATIVE (override the default decomposition style):
Pick a DISTANT-DOMAIN analogy from the parent objective and decompose AS IF the user were working in that other domain. Then translate the proposals back to the user's domain. Self-test: each title should be one the user would NOT have generated themselves — surprising but defensibly load-bearing. Avoid contrived weirdness — every proposal must still pass the load-bearing test.`,
  concrete: `

INTENT — CONCRETE (override the default decomposition style):
Be ruthlessly implementation-anchored. Each proposal must name a SPECIFIC artifact the user would ship within 2 weeks of starting it (a UI screen, a database table, a measurable metric, a specific document). Reject any proposal that's abstract enough to mean different things to different people.`,
  contrarian: `

INTENT — CONTRARIAN (override the default decomposition style):
Read the EXISTING PROPOSALS below. Identify the SHARED ASSUMPTION underlying them (what they all take for granted about how the user should approach the parent objective). INVERT that assumption. Generate proposals that would only make sense if the inverted assumption holds. Name the inverted assumption explicitly in each proposal's rationale.`,
  gap_fill: `

INTENT — GAP FILL (override the default decomposition style):
The user already has proposals covering most facets of the parent. Below you'll see UNCOVERED LENS ENTRIES — readings from the parent objective that NO existing proposal addresses. Your job: generate proposals that SPECIFICALLY attack the uncovered entries. Each proposal's rationale must reference which lens entry it covers (by phrase).`,
  ambitious: `

INTENT — AMBITIOUS (override the default decomposition style):
Extend the time horizon. Propose sub-objectives that would only be worth pursuing if the user committed 6+ months. Each proposal must name the long-horizon payoff explicitly in its rationale — what's the compounding return that justifies the longer timeline?`,
  wildcard: `

INTENT — WILDCARD (override the default decomposition style):
Generate ONE proposal you'd normally reject as too weird. Then justify why it might be the right cut anyway — what assumption it violates productively, what evidence would tell us if it works. Be honest in the rationale: "this is unusual because…". The other 3-4 proposals should follow the default style as a stabilizing baseline.`,
};

const INTENT_TEMPERATURE: Record<SubObjectiveIntent, number> = {
  initial: 0.55,
  creative: 0.75,
  concrete: 0.35,
  contrarian: 0.55,
  gap_fill: 0.5,
  ambitious: 0.55,
  wildcard: 0.85,
};

export function temperatureForIntent(intent: SubObjectiveIntent): number {
  return INTENT_TEMPERATURE[intent] ?? 0.55;
}

export function buildSystemPrompt(
  intent: SubObjectiveIntent = "initial",
  hcdMode: boolean = false,
  hasLayerStack: boolean = false,
): string {
  const mixin = INTENT_MIXINS[intent] ?? "";
  const hcd = hcdMode ? HCD_MIXIN : "";
  const layers = hasLayerStack ? LAYER_TAGGING_MIXIN : "";
  return baseSystemPrompt() + mixin + hcd + layers;
}

// Phase 11.A.4 — Layer tagging instructions. Only included when an
// ObjectiveStack is supplied to the user prompt. Tells the LLM to
// tag every proposal with which layers it operates at + a
// human-readable layer_position_label. The available layers + their
// variables get listed in the user prompt's AVAILABLE LAYERS block.
const LAYER_TAGGING_MIXIN = `

JOB 3 — TAG EACH PROPOSAL WITH ITS LAYER POSITION:
You will receive an AVAILABLE LAYERS block in the user prompt listing the objective's causal stack (4-6 layers, ordinal 1 = substrate / inputs, ordinal N = outcome / measurement).

For EACH proposal, populate two fields:

  layer_ordinals : integer[]
    — The layer(s) this proposal MOST DIRECTLY operates at. List the PRIMARY-effect layer FIRST.
    — A SINGLE layer is the common, correct case — the one layer where the proposal's main effect lands.
    — Use TWO ordinals ONLY when the proposal genuinely BRIDGES two layers (e.g. a feature that turns a mechanism into a social process). Prefer adjacent layers, and put the dominant one first.
    — NEVER 3+ layers. If a proposal feels like it touches "everything" (a dashboard, an engine, a container), pick the 1-2 layers where its PRIMARY effect lands — not every layer it grazes.
    — Use the ordinals exactly as shown in the AVAILABLE LAYERS block. Never invent ordinals beyond what's listed.

  layer_position_label : string
    — Standard format based on layer_ordinals (the server recomputes this, so just approximate):
      Single layer:        "L3 · Direct"
      Adjacent pair:       "L2→L3 · Bridge"
      Non-adjacent pair:   "L1+L4 · Span"
    — Use L<ordinal> where the layer's actual id matches. Don't include layer NAMES in the label — that's just the ordinal.

ACCURACY OVER COVERAGE:
Place each proposal where it ACTUALLY belongs — at the layer its primary effect lands. NEVER redistribute proposals across layers for visual balance or "coverage." If several proposals genuinely operate at the same layer, tag them all there: concentration at one load-bearing layer is a REAL signal, not a smell. A wrong-layer placement is worse than an uneven spread.`;

// Phase 11 — Human-Centered Design bias. Appended when the space has
// hcd_mode=true. Pushes proposals to anchor on real users + observable
// pain + early prototyping, not on tech-first abstractions. Intent
// mixins still steer style (creative / concrete / contrarian / etc.);
// HCD layers a separate axis on top of that.
const HCD_MIXIN = `

HUMAN-CENTERED DESIGN BIAS — APPLY TO EVERY PROPOSAL:
- Anchor each sub-objective in a SPECIFIC user role / segment whose pain it addresses (mention the role in the rationale).
- Prefer proposals that name an observable USER BEHAVIOR or felt need over proposals that name a technology, system, or process. (Bad: "AI recommendation engine." Good: "Reducing decision fatigue for first-time users.")
- Each rationale must reference how the user would EXPERIENCE the result — what changes in their day if this sub-objective lands.
- Bias toward proposals that can be PROTOTYPED quickly and tested with a real user within 2 weeks, even if the longer-term form is bigger. Mention the prototype angle in the rationale when it isn't obvious.
- Treat accessibility, inclusivity, and edge-case users as load-bearing dimensions. Reject proposals that only work for the canonical happy-path user.`;

function baseSystemPrompt(): string {
  return `You are a strategy decomposer.

The user has refined an objective through a short clarifying-question pass. Your job is to do two things:

JOB 1 — NAME THE CATEGORY
Pick the single best noun that describes what KIND of bucket these sub-objectives are. The category is dictated by the parent objective:
  - Building an app / product           → "Features"
  - Building a curriculum / course      → "Lessons" or "Modules"
  - Designing a workout                 → "Movements" or "Exercises"
  - Running a research program          → "Research areas" or "Investigations"
  - Defining a business strategy        → "Strategic moves" or "Bets"
  - Writing a book / report             → "Sections" or "Chapters"
  - Optimizing operations               → "Workflows" or "Levers"
The category is ONE WORD or a short noun phrase (≤3 words). Pick from the parent's actual domain — never invent abstract jargon ("Initiatives", "Components", "Items" — too generic).

JOB 2 — PROPOSE 4–5 SUB-OBJECTIVES (within that category)

SUB-OBJECTIVE RULES:
- Each is independently meaningful — a person could spend a week on it without needing the others.
- Cumulatively the set covers the load-bearing facets of the parent. No overlapping, no trivially-subdividing.
- Each is concrete enough to spawn its own Pain → Features → Outcomes → Objective layered analysis downstream.

TITLE RULES (strict):
- title MUST be a NOUN PHRASE naming the thing itself. Not an action.
- title MUST NOT start with action verbs: Develop / Implement / Create / Design / Build / Enhance / Establish / Drive / Deliver / Provide / Enable / Generate / Produce / Conduct.
- BAD: "Develop Vivid Search Interface" / "Implement Gamification Elements" / "Enhance AI Personalization"
- GOOD: "Vivid search interface" / "Gamification layer" / "AI personalization engine"
- ≤6 words. Title-case is fine; no terminal punctuation.

SUMMARY + RATIONALE:
- summary: 1 sentence describing what the sub-objective IS (state of the world), not what you'll DO to it.
- rationale: 1 sentence on why it's load-bearing for the parent objective.

OUTPUT:
- Return 4–5 proposals. No fewer, no more.
- Mark exactly 3 with recommended=true (the ones you'd start with if the user could only do three).
- confidence ∈ [0,1] — your plausibility estimate.

ANTI-PLATITUDE:
If a proposal could appear unchanged on a different user's objective, rewrite it to reference something specific from THIS user's prompt or clarifying answers.

Return strict JSON.`;
}

export function buildUserPrompt(args: BuildDecomposeArgs): string {
  const {
    objective,
    clarifying,
    ragBlock,
    existingProposals,
    lens,
    uncoveredLensIndices,
    priorConcepts,
    recentConcepts,
    objectiveStack,
  } = args;

  const clarifyingBlock =
    clarifying && clarifying.questions.length > 0
      ? `\n\nCLARIFYING ANSWERS:\n${clarifying.questions
          .map((q) => {
            const a = clarifying.answers[q.id];
            if (!a) return `  Q: ${q.question}\n  A: (not answered)`;
            if (a.status === "skipped")
              return `  Q: ${q.question}\n  A: (skipped — user said this gap is not load-bearing)`;
            return `  Q: ${q.question}\n  A: ${a.value ?? ""}`;
          })
          .join("\n")}`
      : "";

  // RAG context — research-service.buildRagBlock output, prepended
  // when available. Empty string when no useful research exists, so
  // the user prompt continues to work in legacy / weak-search modes.
  const researchBlock =
    ragBlock && ragBlock.length > 0 ? `\n\n${ragBlock}\n` : "";

  // Variant Lab — ANTI-DUPLICATE block. The single biggest diversity
  // lever isn't temperature — it's telling the LLM "don't repeat
  // these specifically." Every regen pass sees the prior set.
  const existingBlock =
    existingProposals && existingProposals.length > 0
      ? `\n\nEXISTING PROPOSALS (the user ALREADY has these — do NOT duplicate, trivially paraphrase, or restate at a different abstraction level. Your new proposals must attack DIFFERENT facets, surface NEW assumptions, or cover gaps the existing set misses):\n${existingProposals
          .map((p, i) => `  ${i + 1}. ${p.title} — ${p.summary}`)
          .join(
            "\n",
          )}\n\nHARD RULES:\n  1. Every new proposal must be conceptually distinct from EVERY entry above — no overlap in core mechanism, target user, or outcome.\n  2. Self-test before emitting: read each new title alongside the existing titles. If a new one could swap in for an existing one without changing meaning, REWRITE it from a different angle.\n  3. Self-test again on rationale: if the underlying argument would also justify an existing proposal, you're duplicating — REWRITE.\n  4. If you can't generate enough genuinely-distinct proposals to fill the quota, emit FEWER rather than padding with near-duplicates.`
      : "";

  // Variant Lab — ANNOTATION LENS. Same lens shape as the room
  // generator; renders the top-weighted readings of the parent
  // objective so each new proposal can be lens-aware + emit
  // lens_coverage[] back.
  const lensBlock =
    lens && lens.length > 0
      ? `\n\nANNOTATION LENS (the parent objective's load-bearing semantic readings — weight-sorted, 1-based):\n${lens
          .map((a, i) => {
            const lines = [`  [${i + 1}] "${a.phrase}"`];
            if (a.reading) lines.push(`        reading: ${a.reading}`);
            if (a.fragility?.when)
              lines.push(`        fragility: when ${a.fragility.when}`);
            if (a.tensions?.length) {
              const t = a.tensions[0];
              lines.push(`        ${t.kind}: ${t.note}`);
            }
            return lines.join("\n");
          })
          .join("\n")}`
      : "";

  const lensCoverageRule =
    lens && lens.length > 0
      ? `\n\nFor each new proposal, emit lens_coverage[] — the 1-based lens indices this proposal directly derives from (0-3 entries; empty array when the proposal is lens-independent).`
      : "";

  // Variant Lab — UNCOVERED LENS ENTRIES block for gap_fill intent.
  // Only included when uncoveredLensIndices is non-empty AND lens is
  // available; the system prompt's INTENT — GAP FILL mixin tells the
  // model to target these specifically.
  const uncoveredBlock =
    lens &&
    lens.length > 0 &&
    uncoveredLensIndices &&
    uncoveredLensIndices.length > 0
      ? `\n\nUNCOVERED LENS ENTRIES (no existing proposal addresses these — target them):\n${uncoveredLensIndices
          .map((idx) => {
            const a = lens[idx - 1];
            return a ? `  [${idx}] "${a.phrase}" — ${a.reading || "(no reading)"}` : null;
          })
          .filter((s): s is string => s !== null)
          .join("\n")}`
      : "";

  // Cross-space KG — prior canonical concepts the user has explored
  // semantically related to this objective. Build the block + the
  // companion "link or diverge" rule, both empty when none found.
  const priorConceptsBlock =
    priorConcepts && priorConcepts.length > 0
      ? buildPriorConceptsBlock(priorConcepts)
      : "";
  const priorConceptsRule =
    priorConcepts && priorConcepts.length > 0
      ? `\n\n${PRIOR_CONCEPTS_RULE}\n`
      : "";

  // O2 — Recent concept memory feed. Distinct from priorConcepts:
  // these are ACTIVITY-ranked (the user has been thinking about them
  // across spaces, regardless of similarity to this objective).
  // Bias proposals TOWARD natural overlap when sensible — don't
  // force a hot concept into a proposal where it doesn't fit. This is
  // an attention signal, not a directive.
  const recentConceptsBlock =
    recentConcepts && recentConcepts.length > 0
      ? `\n\nRECENT CONCEPT MEMORY (top concepts the user has been actively reasoning across in OTHER spaces — hot in their mind right now):\n${recentConcepts
          .slice(0, 6)
          .map((c, i) => {
            const desc = c.description
              ? ` — ${c.description.slice(0, 140)}`
              : "";
            const spread =
              c.space_count > 1 ? ` · ${c.space_count} spaces` : "";
            return `  ${i + 1}. ${c.display_name}${spread}${desc}`;
          })
          .join(
            "\n",
          )}\n  RECENT-CONCEPT RULE: When a proposal NATURALLY overlaps with one of these concepts, name the connection explicitly in its rationale ("connects to your work on X"). When no natural overlap exists, IGNORE — don't manufacture an attention link. This is an ambient signal, not a directive.`
      : "";

  // Phase 11.A.4 — AVAILABLE LAYERS block. Renders the ObjectiveStack
  // top-down so ordinals are visually obvious. Each layer lists its
  // archetype + 3-7 variables; the LLM uses this to tag every
  // proposal with layer_ordinals + layer_position_label.
  const layerBlock =
    objectiveStack && objectiveStack.layers.length > 0
      ? `\n\nAVAILABLE LAYERS (the objective's causal stack, ordinal 1 = substrate / ordinal N = outcome):\n${[
          ...objectiveStack.layers,
        ]
          .sort((a, b) => b.ordinal - a.ordinal)
          .map((l) => {
            const varNames = l.variables
              .slice(0, 7)
              .map((v) => v.name)
              .join(", ");
            return `  L${l.ordinal} · ${l.archetype} · ${l.name}\n     ${l.description}\n     variables: ${varNames}`;
          })
          .join("\n")}`
      : "";

  return `REFINED OBJECTIVE:
"""
${objective.slice(0, 4000)}
"""${clarifyingBlock}${researchBlock}${lensBlock}${layerBlock}${priorConceptsBlock}${recentConceptsBlock}${existingBlock}${uncoveredBlock}${lensCoverageRule}${priorConceptsRule}

Propose 4–5 sub-objectives per the system instructions. Mark exactly 3 as recommended=true (the ones most load-bearing for delivering the parent).`;
}

/** Schema is built dynamically — when a lens is in play, every
 *  proposal must include lens_coverage[]. Keeps strict-mode happy
 *  (every field in `required`). Phase 11.A.4 — hasLayerStack adds
 *  layer_ordinals + layer_position_label to the proposal schema. */
export function buildResponseSchema(
  hasLens: boolean,
  hasLayerStack: boolean = false,
) {
  const proposalProps: Record<string, unknown> = {
    title: { type: "string" },
    summary: { type: "string" },
    rationale: { type: "string" },
    confidence: { type: "number" },
    recommended: { type: "boolean" },
  };
  const proposalRequired: string[] = [
    "title",
    "summary",
    "rationale",
    "confidence",
    "recommended",
  ];
  if (hasLens) {
    proposalProps.lens_coverage = {
      type: "array",
      items: { type: "number" },
    };
    proposalRequired.push("lens_coverage");
  }
  if (hasLayerStack) {
    proposalProps.layer_ordinals = {
      type: "array",
      items: { type: "integer" },
    };
    proposalProps.layer_position_label = { type: "string" };
    proposalRequired.push("layer_ordinals", "layer_position_label");
  }

  return {
    name: "objective_decompose",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        // The picker UI shows this above the proposals as
        // "5 {category} proposed" so the user knows what kind of
        // bucket they're picking from (Features / Lessons / Bets / …).
        category: { type: "string" },
        proposals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: proposalProps,
            required: proposalRequired,
          },
        },
      },
      required: ["category", "proposals"],
    },
  } as const;
}

/** Back-compat — legacy callers that imported the constant. New
 *  callers should use buildResponseSchema(hasLens) instead. */
export const RESPONSE_SCHEMA = buildResponseSchema(false);
