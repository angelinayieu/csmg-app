// ── Per-axis system prompts for probability-space generation ──
//
// The other tab's Tier 2 architecture fans out N parallel probability-
// space generators, one per axis. The quality of what each generator
// produces depends HEAVILY on how well the per-axis system prompt
// focuses the LLM on that axis's specific vocabulary, mechanisms, and
// output expectations.
//
// This file is the rigorous, axis-specific briefing layer. The
// orchestrator calls `getAxisPrompt(axis, context)` and gets back a
// fully-assembled system+user pair ready for an `llmGenerate` call —
// with:
//   • CoT unfolding (explicit reasoning steps)
//   • Few-shot exemplar SLOTS (pattern library fills these at runtime)
//   • Output-shape expectations aligned to SpaceEntityAddedEvent
//   • Domain vocabulary + mental model for the axis
//   • Anti-waste guidance (no jargon, no generic advice, ground every
//     entity in the input's actual context)
//
// Pattern library integration: `getAxisPrompt` accepts optional
// `exemplars` — high-quality historical outputs for this axis that get
// embedded as few-shot examples. The library call site passes them in;
// the prompt layer just slots them.
//
// Axis names are aligned to `ProbabilitySpaceAxis` in
// src/types/pipeline-events.ts so event emission is type-safe.

import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type { UserIntent } from "@/types/analysis";
import {
  buildDecompIntentBlock,
  buildDomainDecompBlock,
} from "@/lib/prompts/intent-context";
import { AXIS_CATALOG } from "@/lib/probability-space/axis-catalog";
import type {
  AxisSpec as RichAxisSpec,
  AxisInstrumentKind,
  AxisOutputShape,
} from "@/lib/probability-space/axis-spec";

export interface AxisExemplar {
  /** Brief description of the input that produced this exemplar. */
  inputGist: string;
  /** Prose excerpt showing what good generation looks like for this axis.
   *  Kept short (≤600 chars) so few-shotting doesn't blow context. */
  outputExcerpt: string;
}

export interface AxisPromptContext {
  /** The user's original prompt. */
  userInput: string;
  /** Optional — any domain classification the frame extractor produced. */
  domain?: string | null;
  /** Optional — high-quality historical outputs to few-shot against. */
  exemplars?: AxisExemplar[];
  /**
   * Phase 2E · PR 1 — user intent from analyze-time metadata
   * (user_role + primary_goal + context_type). When present, the
   * axis prompt pipes the input through the existing
   * buildDecompIntentBlock + buildDomainDecompBlock helpers so each
   * axis adapts to the user's goal + domain the SAME WAY Pass 1
   * decompose already does. Without this, axis prompts reran the
   * fixed 8-axis framing regardless of whether the user was making
   * a decision vs exploring a domain vs stress-testing a hypothesis.
   */
  intent?: UserIntent | null;
  /**
   * Phase 2E · PR 1.5 — output of the question-type classifier.
   * Tells the axis prompt what KIND of question this is (decision
   * / prediction / diagnosis / design / exploration / analysis /
   * evaluation / synthesis). Axes tune their emphasis accordingly:
   * the Risk axis emphasizes irreversibility for decisions; it
   * emphasizes failure-mode mechanisms for designs.
   */
  questionType?: QuestionType | null;
  /**
   * Phase 2E · Axis Richness (2026-04-24) — optional variant id
   * picked by the framing panel (AxisProposal.prompt_variant). When
   * present AND the axis's catalog entry registers this variant,
   * the variant's focus_delta replaces the default focus line in the
   * system prompt. When absent or unknown, default focus applies.
   */
  variant?: string | null;
}

/**
 * Phase 2E · PR 1.5 — question types the classifier produces.
 * Drawn from decision theory + epistemology literature. Each type
 * has a characteristic decomposition strategy that good analysts
 * use when approaching that kind of question.
 */
export type QuestionType =
  | "decision"
  | "prediction"
  | "diagnosis"
  | "design"
  | "exploration"
  | "analysis"
  | "evaluation"
  | "synthesis";

export interface AxisPromptResult {
  system: string;
  user: string;
  /** Suggested temperature. Lower for rigor-heavy axes (financial,
   *  evidence); higher for exploratory axes (cultural, causal_scenarios). */
  temperature: number;
  /** Max tokens. Axes that produce more structured content (causal
   *  scenarios) get more budget than sparse ones (assumptions). */
  maxTokens: number;
}

// ── Axis metadata ──

interface AxisSpec {
  /** Human-readable label for the axis card. */
  label: string;
  /** Short tagline shown under the label on the space shell. */
  tagline: string;
  /** The analyst role the LLM plays for this axis. */
  role: string;
  /** What concepts the LLM should surface. */
  focus: string;
  /** Domain vocabulary to prime the LLM. */
  vocabulary: string[];
  /** What to explicitly NOT produce (anti-generic guardrail). */
  avoid: string;
  /** Suggested temperature + token budget. */
  temperature: number;
  maxTokens: number;
}

const AXIS_SPECS: Record<ProbabilitySpaceAxis, AxisSpec> = {
  financial: {
    label: "Financial",
    tagline: "Money, unit economics, capital efficiency",
    role:
      "a CFO analyzing the financial surface of this situation with 15 years of venture operating experience",
    focus:
      "revenue drivers, cost structure, cash flow dynamics, unit economics, capital efficiency, pricing power, gross margins, payback periods, burn multiples, runway constraints",
    vocabulary: [
      "ARR", "MRR", "CAC", "LTV", "CAC payback", "gross margin",
      "burn rate", "runway", "operating leverage", "unit economics",
      "rule of 40", "NDR", "GDR", "magic number",
    ],
    avoid:
      "generic business advice ('reduce costs', 'increase revenue'). Every entity must name a SPECIFIC financial mechanism tied to this situation.",
    temperature: 0.3,
    maxTokens: 8192,
  },
  timeline: {
    label: "Timeline",
    tagline: "Phase transitions, cycle times, urgency gates",
    role:
      "a delivery strategist mapping the temporal surface — someone who's shipped 20+ product cycles and knows which dependencies compound time",
    focus:
      "phase transitions, leading/lagging indicators, cycle times, decay rates, urgency gates, sequencing constraints, time-to-signal, compounding-vs-linear time effects",
    vocabulary: [
      "phase transition", "leading indicator", "lagging indicator",
      "cycle time", "decay rate", "time-to-feedback", "milestone gate",
      "irreversible decision point", "optionality window", "compounding time",
    ],
    avoid:
      "vague time language ('soon', 'later'). Express every temporal entity with an explicit horizon (days / quarters / years) and flag assumptions that embed hidden timing risk.",
    temperature: 0.3,
    maxTokens: 6144,
  },
  actors: {
    label: "Actors",
    tagline: "Who decides, who's affected, what they optimize for",
    role:
      "a stakeholder analyst modeling the actor surface — someone who thinks in incentives and information asymmetry",
    focus:
      "customers, team members, competitors, regulators, investors, partners. For each: what do they optimize for, what would make them shift, what's their information asymmetry, what's their default action when uncertain",
    vocabulary: [
      "principal-agent", "information asymmetry", "switching cost",
      "coalition dynamics", "veto player", "incentive alignment",
      "revealed preference", "coordination problem", "default action",
    ],
    avoid:
      "treating actors as monoliths. Decompose each actor type into sub-segments with distinct incentives (e.g., not 'customers' but 'early adopters vs late majority vs churners').",
    temperature: 0.4,
    maxTokens: 8192,
  },
  causal_scenarios: {
    label: "Causal scenarios",
    tagline: "Optimistic, base, pessimistic — with mechanisms",
    role:
      "a scenario planner decomposing mechanisms — someone who thinks in causal chains and feedback loops, not predictions",
    focus:
      "3-5 distinct outcome scenarios, each with the specific causal chain that produces it. Identify fork points where small differences in input send trajectories apart. Name the feedback loops (reinforcing vs balancing) that amplify or dampen each scenario.",
    vocabulary: [
      "reinforcing loop", "balancing loop", "fork point",
      "trajectory divergence", "causal chain", "mediator", "moderator",
      "second-order effect", "delayed feedback", "nonlinear threshold",
    ],
    avoid:
      "just labeling scenarios 'good / bad / neutral'. Each scenario needs the MECHANISM (what specifically has to happen) and the FORK POINT (which variable sends us down this branch vs another).",
    temperature: 0.5,
    maxTokens: 10240,
  },
  evidence: {
    label: "Evidence",
    tagline: "What we know, what we suspect, what we're guessing",
    role:
      "an epistemologist auditing claims — someone who reflexively asks 'what's the basis for that?' about every assertion",
    focus:
      "explicit claims made in the input, implicit claims the input depends on, the source type of each (empirical / theoretical / anecdotal / assumed), confidence level, falsifiability. Flag claims that are load-bearing but unsupported.",
    vocabulary: [
      "empirical", "theoretical", "anecdotal", "assumed",
      "falsifiable", "load-bearing assumption", "reference class",
      "base rate", "survivorship bias", "selection effect",
    ],
    avoid:
      "just listing 'what's known.' The value is surfacing what's ASSUMED but presented as known. For every load-bearing claim, flag source quality and what evidence would flip it.",
    temperature: 0.2,
    maxTokens: 6144,
  },
  assumptions: {
    label: "Assumptions",
    tagline: "Hidden axioms this situation rests on",
    role:
      "a pre-mortem analyst — someone who surfaces the silent assumptions that, if wrong, would invalidate the entire frame",
    focus:
      "load-bearing assumptions that are HIDDEN (the user didn't state them but the problem rests on them). For each: what the assumption is, what would happen if it were false, how we'd test it cheaply.",
    vocabulary: [
      "load-bearing assumption", "hidden axiom", "if-false counterfactual",
      "cheap test", "pre-mortem", "invalidation criterion",
      "frame-dependent", "context collapse",
    ],
    avoid:
      "restating what the user already said. Hidden assumptions are the ones that make the problem possible but aren't named — 'this market exists', 'users want this', 'regulators will allow this'.",
    temperature: 0.3,
    maxTokens: 6144,
  },
  risk: {
    label: "Risk",
    tagline: "Failure modes, attack surface, blast radius",
    role:
      "a red-team analyst — someone who thinks about what could go wrong before what could go right",
    focus:
      "failure modes grouped by category (execution / market / regulatory / technical / adversarial). For each: likelihood characterization (not a number — a mechanism), severity, reversibility, early warning signals.",
    vocabulary: [
      "failure mode", "attack surface", "blast radius",
      "tail risk", "correlated failure", "cascading failure",
      "early warning signal", "graceful degradation", "irreversible loss",
    ],
    avoid:
      "generic risks ('market might shift'). Name the SPECIFIC failure path (what exactly has to happen for this to fail) and the earliest signal that it's starting.",
    temperature: 0.3,
    maxTokens: 8192,
  },
  cultural: {
    label: "Cultural",
    tagline: "Norms, identity, narrative, memetic dynamics",
    role:
      "a sociotechnical analyst — someone who treats culture as a load-bearing system, not window dressing",
    focus:
      "norms, identity markers, narrative frames, memetic dynamics, in-group/out-group signaling, what's taboo vs celebrated, how decisions get legitimized socially",
    vocabulary: [
      "norm", "taboo", "legitimacy", "identity marker",
      "memetic dynamic", "narrative frame", "in-group signaling",
      "status game", "coordination norm", "cultural load-bearing",
    ],
    avoid:
      "treating culture as a soft add-on. Every cultural entity should identify a CONCRETE mechanism — what behavior this norm produces, who enforces it, what breaks it.",
    temperature: 0.5,
    maxTokens: 6144,
  },
};

// ── Output-shape instructions (same across axes) ──

const OUTPUT_SHAPE = `
Return strict JSON with this shape:
{
  "entities": [
    {
      "id": "<short stable id, 2-4 chars uppercase>",
      "name": "<3-8 word concrete label>",
      "description": "<1-2 sentence MECHANISM, not a definition>",
      "importance": "fundamental" | "critical" | "important" | "moderate",
      "category": "concrete" | "abstract" | "process" | "relational" | "epistemic",
      "confidence": <0..1>,
      "source_tag": "explicit" | "implicit" | "assumed",
      "observables": ["<concrete leading indicator that would tell you this entity is active or shifting>", "..."],
      "failure_mode": "<what would invalidate or break this entity, in one phrase> | null",
      "intervention_handle": {
        "lever": "<the specific action / decision / instrument that moves this entity>",
        "controllability": "direct" | "indirect" | "uncontrollable",
        "cost": "low" | "med" | "high"
      } | null
    }
  ],
  "relationships": [
    {
      "source_id": "<entity id>",
      "target_id": "<entity id>",
      "mechanism": "<how A actually produces B — at least one full sentence naming the channel, not just a label>",
      "dimension": "structural" | "causal" | "temporal" | "logical" | "agentive",
      "polarity": "positive" | "negative" | "conditional" | "neutral",
      "dynamics": "linear" | "threshold" | "compounding" | "exponential" | "decay" | "delayed",
      "confidence": <0..1>,
      "condition_text": "<gating condition for when this edge fires; required when polarity = 'conditional', else empty string>"
    }
  ],
  "axis_summary": "<2-3 sentences: what the key insight from THIS axis is>"
}

Rules that matter more than the shape:
• Every entity must be SPECIFIC to the input. Generic-sounding entities are a sign the prompt was too shallow — expand or drop them.
• Every relationship must name a MECHANISM in a full sentence (≥40 chars). "A → B" is not enough; "A → B because (specific channel)" is the bar.
• Every entity should have at least ONE observable — a concrete leading indicator someone could actually look at to tell if the entity is firing or shifting. Vague observables ("market sentiment") are worse than no observable.
• \`failure_mode\` should be substantive when present — what would falsify this entity? what would render it irrelevant? null only when the entity is definitionally tautological.
• \`intervention_handle\` is null for purely epistemic / observational entities. For anything an actor could move on, name the LEVER (not just "policy") and rate honestly: most things are "indirect" controllability and "med" or "high" cost — say so.
• When polarity = "conditional", \`condition_text\` MUST be a real gating condition ("if X exceeds threshold Y", "given Z holds"), and it must NOT just restate the mechanism — those are different fields.
• 6-18 entities is the sweet spot. Fewer = too shallow; more = too fragmented.
• It's better to output FEWER high-quality entities than many vague ones. The next-stage scorer is semantic, not count-based.
`;

// ── CoT unfolding ──

const COT_UNFOLDING = `
Before you produce the JSON, think step by step in this order. Do this thinking internally — don't output the steps, just use them to structure your output.

1. What specifically is this input about? Name it in one sentence using the vocabulary of this axis.
2. What are the 4-6 most load-bearing concepts on THIS axis? (These become your highest-importance entities.)
3. For each load-bearing concept, what's the SPECIFIC mechanism by which it matters in this situation?
4. What 2-3 concepts OUTSIDE the obvious frame also apply here? (These are often the highest-insight entities.)
5. For every pair of entities, ask: is there a direct mechanism connecting them? Only add the edge if the answer is a concrete sentence, not a hand-wave.
6. What would a sharp peer-reviewer flag as vague or generic in your output? Strengthen those before emitting.
`;

// ── Main entry point ──

/**
 * Build a fully-assembled system+user prompt pair for a probability-
 * space generator on a specific axis. The caller just passes the
 * user's input and optional exemplars from the pattern library; this
 * returns everything needed for `llmGenerate({ provider: "anthropic",
 * system, user, temperature, maxTokens })`.
 */
export function getAxisPrompt(
  axis: ProbabilitySpaceAxis,
  ctx: AxisPromptContext,
): AxisPromptResult {
  const spec = AXIS_SPECS[axis];

  const exemplarBlock = renderExemplars(axis, ctx.exemplars);
  const domainBlock = ctx.domain
    ? `\nThe frame extractor classified this as domain=${ctx.domain}. Use that to narrow vocabulary and filter out obviously-inapplicable concepts.\n`
    : "";

  // Phase 2E · PR 1 — reuse the intent/domain prompt-adaptation
  // helpers that decompose Pass 1 already uses. Keeps axis prompts
  // in sync with the rest of the pipeline's prompt-building surface
  // rather than running a fixed script per axis.
  const intentBlock = ctx.intent
    ? "\n\n" + buildDecompIntentBlock(ctx.intent).trim() + "\n"
    : "";
  const domainVocabBlock = ctx.intent?.context_type
    ? "\n\n" + buildDomainDecompBlock(ctx.intent.context_type).trim() + "\n"
    : "";

  // Phase 2E · PR 1.5 — question-type adaptation. Different kinds
  // of questions demand different emphases per axis. A Risk axis
  // for a decision emphasizes reversibility + VoI; a Risk axis for
  // a design emphasizes failure-mode mechanisms; a Risk axis for
  // exploration emphasizes edge cases the user may not have
  // considered. Block is small + axis-specific to avoid prompt
  // bloat.
  const questionTypeBlock = ctx.questionType
    ? buildAxisQuestionTypeBlock(axis, ctx.questionType)
    : "";

  // Variant focus-delta swap. When the framing panel recorded a
  // variant hint on the AxisProposal (e.g. financial → payback_period),
  // and the catalog registers that variant on this axis, the variant's
  // focus_delta REPLACES the default focus line. Vocabulary + anti-
  // goal + CoT scaffolding remain intact so variant-specific guidance
  // composes with the axis's overall rigor bar. Unknown variant id =
  // silent no-op (default focus used). See axis-spec.ts for variant
  // contract.
  const catalogEntry = AXIS_CATALOG[axis];
  const variantEntry = ctx.variant
    ? catalogEntry.prompt_variants[ctx.variant]
    : undefined;
  const focusLine = variantEntry
    ? `Focus of this axis (variant: ${variantEntry.label}): ${variantEntry.focus_delta}`
    : `Focus of this axis: ${spec.focus}`;
  const variantNote = variantEntry
    ? `\nThe panel selected the "${variantEntry.label}" variant — lean into its focus without abandoning the axis's overall vocabulary.\n`
    : "";

  const system = [
    `You are ${spec.role}.`,
    `You are examining a situation through ONE specific lens: the ${spec.label} axis.`,
    ``,
    focusLine,
    variantNote,
    `Vocabulary to prime on (use these terms where they apply, don't force them where they don't): ${spec.vocabulary.join(", ")}.`,
    ``,
    `Anti-goal: ${spec.avoid}`,
    domainBlock,
    intentBlock,
    domainVocabBlock,
    questionTypeBlock,
    COT_UNFOLDING,
    exemplarBlock,
    OUTPUT_SHAPE,
  ].join("\n");

  const user = [
    `Situation to analyze through the ${spec.label} lens:`,
    ``,
    ctx.userInput.trim(),
    ``,
    `Produce the JSON now. Every entity must be specific to THIS situation — no generic placeholders.`,
  ].join("\n");

  return {
    system,
    user,
    temperature: spec.temperature,
    maxTokens: spec.maxTokens,
  };
}

// ── Phase 2E · PR 1.5 — question-type × axis matrix ────────────────
//
// For each (axis, questionType) pair, a short emphasis directive
// that nudges the axis's output toward what a skilled analyst
// would surface when approaching that KIND of question. Short so
// prompt bloat is minimal; targeted so each axis actually shifts
// behavior rather than returning the same 6-18 generic entities
// regardless of question type.
//
// When a pair isn't specified, we return empty string — the axis's
// default focus + vocabulary take over. Not every pair needs a
// custom directive.

const AXIS_QUESTION_TYPE_EMPHASIS: Partial<
  Record<
    ProbabilitySpaceAxis,
    Partial<Record<QuestionType, string>>
  >
> = {
  risk: {
    decision:
      "The user is deciding. Emphasize REVERSIBILITY and regret: for each failure mode, is it undoable? What's the exit cost if they choose wrong?",
    design:
      "The user is building. Emphasize FAILURE MECHANISMS in the design itself — what specific component failure produces system failure, not just generic market risk.",
    prediction:
      "The user is forecasting. Emphasize TAIL RISKS that would invalidate the prediction — what outcome is the base rate ignoring?",
    exploration:
      "The user is exploring. Emphasize EDGE CASES a typical analysis wouldn't catch — what's taboo to name, what's politically costly to consider?",
    diagnosis:
      "The user is diagnosing. Emphasize CASCADING failures — when primary failure happened, what secondary + tertiary effects are already in motion?",
  },
  evidence: {
    decision:
      "The user is deciding. Flag claims whose TRUTH would flip the decision — load-bearing on a specific choice vs cosmetic.",
    prediction:
      "The user is forecasting. Emphasize BASE RATES + REFERENCE CLASSES — what historical analogs exist? What's their resolution distribution?",
    diagnosis:
      "The user is diagnosing. Emphasize CAUSAL evidence — what rules out alternative explanations vs just correlates?",
    analysis:
      "The user is analyzing. Emphasize MECHANISM evidence — what explains the observed behavior, not just describes it?",
  },
  assumptions: {
    decision:
      "Prioritize assumptions whose falsity would REVERSE the choice — not all hidden assumptions matter equally when one decision hinges on them.",
    design:
      "Prioritize assumptions about CONSTRAINTS + USER behavior — what does the design silently assume users / environment will do?",
    exploration:
      "Prioritize FRAME-level assumptions — what's the user taking for granted about the question itself that boxes the exploration?",
  },
  causal_scenarios: {
    decision:
      "Each scenario ends with a DIFFERENT choice being correct — what distinguishes the world where A is right from the world where B is?",
    prediction:
      "Each scenario has a DIFFERENT outcome — identify the FORK POINT (specific variable value) that sends us down each branch.",
    design:
      "Each scenario describes a DIFFERENT failure mode of the design — what part breaks first in each.",
    exploration:
      "Each scenario represents a DIFFERENT way the domain could evolve — not just optimistic/pessimistic but structurally distinct futures.",
  },
  timeline: {
    decision:
      "Emphasize DEADLINE PRESSURE + IRREVERSIBLE decision points. When does the option actually close?",
    prediction:
      "Emphasize LEAD + LAG in the signal — by the time we observe the outcome, what was already set in motion N quarters ago?",
    design:
      "Emphasize PHASES of the design's lifecycle — what breaks at scale N=10, N=1000, N=1M?",
  },
  actors: {
    decision:
      "Who has VETO power over this decision going forward? Whose consent is required but not yet secured?",
    design:
      "Who will USE this? Decompose into sub-segments (novice / expert / adversary) with distinct mental models.",
    diagnosis:
      "Who was in the room when the thing went wrong? Who had information that could have prevented it but didn't act?",
  },
};

function buildAxisQuestionTypeBlock(
  axis: ProbabilitySpaceAxis,
  questionType: QuestionType,
): string {
  const axisTable = AXIS_QUESTION_TYPE_EMPHASIS[axis];
  if (!axisTable) return "";
  const directive = axisTable[questionType];
  if (!directive) return "";
  return `\n\nQUESTION TYPE CONTEXT — this input is a ${questionType}.\n${directive}\n`;
}

function renderExemplars(
  axis: ProbabilitySpaceAxis,
  exemplars?: AxisExemplar[],
): string {
  if (!exemplars || exemplars.length === 0) return "";
  const rendered = exemplars
    .slice(0, 2)
    .map(
      (ex, i) =>
        `Exemplar ${i + 1} — input gist: "${ex.inputGist}"\nOutput excerpt (${axis} axis):\n${ex.outputExcerpt}`,
    )
    .join("\n\n");
  return `\nHigh-quality historical outputs for this axis — match this depth and specificity, adapt to the new input:\n\n${rendered}\n`;
}

/**
 * Metadata accessor for orchestrators that need the label/tagline
 * before spawning a generator (e.g., emitting `space_opened` with
 * the human-readable label the UI will render).
 */
export function getAxisMeta(axis: ProbabilitySpaceAxis): {
  label: string;
  tagline: string;
} {
  const s = AXIS_SPECS[axis];
  return { label: s.label, tagline: s.tagline };
}

// ── Ad-hoc axis prompt builder (Phase 2E · Axis Richness) ────────────
//
// Ad-hoc axes are minted by the framing panel when ≥2 lenses
// independently propose a dimension not covered by the canonical 8.
// They arrive at the generator route with a live `AxisSpec` in the
// request payload (not a `ProbabilitySpaceAxis` key) and therefore
// cannot use AXIS_SPECS above — they have no hand-written role /
// vocabulary / avoid block.
//
// `getAdHocAxisPrompt` assembles a stance-aware generic prompt from
// the panel-provided AxisSpec fields:
//
//   • instrument_kind  → analyst role + cognitive stance
//   • output_shape     → what entities should look like
//   • generator_focus  → primary focus line
//   • hard/soft preconditions → briefing paragraph
//
// The output-shape scaffolding (entity schema) remains the same
// OUTPUT_SHAPE constant — axis-output-validator expects the same JSON
// shape for every axis, canonical or ad-hoc. What changes is the
// framing language that nudges the LLM toward producing relevant
// content for this ad-hoc dimension.

const INSTRUMENT_KIND_STANCE: Record<
  AxisInstrumentKind,
  { role: string; stance_note: string }
> = {
  calibration: {
    role:
      "a quantitative analyst producing bounded numerical estimates with explicit uncertainty ranges",
    stance_note:
      "Every entity that can be quantified should carry a range or distribution, not a point estimate. Flag which numbers are grounded vs extrapolated.",
  },
  constraint: {
    role:
      "a systems-safety analyst mapping the hard bounds and failure envelope of this situation",
    stance_note:
      "Every entity names a SPECIFIC limit, boundary condition, or failure mode — not generic warnings.",
  },
  enumeration: {
    role:
      "a taxonomist enumerating the distinct cases or instances relevant to this situation",
    stance_note:
      "Prefer completeness without redundancy — each entity should name a DIFFERENT case, not a variation of the same one.",
  },
  stratification: {
    role:
      "a segmentation analyst decomposing broad categories into distinctive sub-groups",
    stance_note:
      "Each sub-segment must have a different MENTAL MODEL or DECISION LOGIC — segments that behave the same are one segment, not two.",
  },
  decomposition: {
    role:
      "a mechanism analyst breaking the situation into its constituent moving parts",
    stance_note:
      "Every entity names a SPECIFIC mechanism — what it does, how it couples to neighbors, not a restatement of its label.",
  },
  counterfactual: {
    role:
      "a scenario planner tracing what would happen if key variables took different values",
    stance_note:
      "Each entity represents a DIFFERENT world — not different adjectives for the same world. Name the fork point that sends us down each branch.",
  },
  evidentiary: {
    role:
      "an epistemologist auditing claims against their supporting evidence",
    stance_note:
      "Every entity names a specific CLAIM with its source type (empirical / theoretical / anecdotal / assumed) and what would flip it.",
  },
};

const OUTPUT_SHAPE_NOTE: Record<AxisOutputShape, string> = {
  numeric_with_distribution:
    "Where numeric, entities carry a range not a point. Describe the shape (skew, tail) when it matters.",
  named_stakeholder_set:
    "Entities are specific named actors or well-defined sub-segments, each with distinct incentives and default actions.",
  scenario_tree:
    "Entities represent distinct possible worlds linked by fork-point mechanisms. Each scenario has a concrete trigger condition.",
  claim_ledger:
    "Entities are specific claims with source-type tags and load-bearing vs cosmetic classification.",
  assumption_ledger:
    "Entities are hidden axioms the situation rests on, each with an if-false counterfactual.",
  failure_mode_catalog:
    "Entities are named failure paths with likelihood mechanism, severity, reversibility, and earliest signal.",
  temporal_phase_map:
    "Entities are phases / gates ordered in time, each with entry + exit conditions and the signal that advances it.",
  norm_and_identity_map:
    "Entities are concrete norms or identity markers — who enforces them, what behavior they produce, what breaks them.",
  constraint_envelope:
    "Entities are binding constraints with numeric or categorical bounds and the consequence of breaching them.",
  precedent_set:
    "Entities are historical analogs with a mapping back to this situation — what matches, what doesn't.",
  generic_entity_set:
    "Entities may be any concept central to the axis; every one must still be SPECIFIC to the input, not generic.",
};

export interface AdHocAxisPromptContext {
  /** The user's original prompt. */
  userInput: string;
  /** Optional domain classification from the frame extractor. */
  domain?: string | null;
  /** Optional analyze-time intent. */
  intent?: UserIntent | null;
  /** Optional question-type classification. */
  questionType?: QuestionType | null;
}

/**
 * Build a generator prompt for an ad-hoc axis. Uses the panel-
 * minted `AxisSpec` to pick a stance (from instrument_kind), a
 * shape note (from output_shape), and anchors the focus line on
 * the spec's `generator_focus`.
 *
 * Returns the same shape as `getAxisPrompt` — the caller can route
 * uniformly through `llmJSON` regardless of catalog vs ad-hoc.
 */
export function getAdHocAxisPrompt(
  spec: RichAxisSpec,
  ctx: AdHocAxisPromptContext,
): AxisPromptResult {
  const stance = INSTRUMENT_KIND_STANCE[spec.instrument_kind];
  const shapeNote = OUTPUT_SHAPE_NOTE[spec.output_shape];

  const domainBlock = ctx.domain
    ? `\nThe frame extractor classified this as domain=${ctx.domain}. Use that to narrow vocabulary and filter out obviously-inapplicable concepts.\n`
    : "";
  const intentBlock = ctx.intent
    ? "\n\n" + buildDecompIntentBlock(ctx.intent).trim() + "\n"
    : "";
  const domainVocabBlock = ctx.intent?.context_type
    ? "\n\n" + buildDomainDecompBlock(ctx.intent.context_type).trim() + "\n"
    : "";
  const questionTypeBlock = ctx.questionType
    ? `\n\nQUESTION TYPE CONTEXT — this input is a ${ctx.questionType}. Tune the lens accordingly.\n`
    : "";

  const precondBlock =
    spec.hard_preconditions.length > 0 || spec.soft_preconditions.length > 0
      ? `\nWhy this axis was opened:\n${[...spec.hard_preconditions, ...spec.soft_preconditions].map((p) => `- ${p}`).join("\n")}\n`
      : "";

  const system = [
    `You are ${stance.role}.`,
    `You are examining a situation through ONE specific lens: the ${spec.label} axis (${spec.tagline}).`,
    ``,
    `Focus of this axis: ${spec.generator_focus}`,
    ``,
    `Output shape expectation: ${shapeNote}`,
    ``,
    `Stance note: ${stance.stance_note}`,
    precondBlock,
    domainBlock,
    intentBlock,
    domainVocabBlock,
    questionTypeBlock,
    COT_UNFOLDING,
    OUTPUT_SHAPE,
  ].join("\n");

  const user = [
    `Situation to analyze through the ${spec.label} lens:`,
    ``,
    ctx.userInput.trim(),
    ``,
    `Produce the JSON now. Every entity must be specific to THIS situation — no generic placeholders.`,
  ].join("\n");

  // Ad-hoc axes inherit a moderate temperature (0.4) unless the
  // instrument_kind is rigor-heavy (calibration, evidentiary).
  const temperature =
    spec.instrument_kind === "calibration" ||
    spec.instrument_kind === "evidentiary"
      ? 0.25
      : 0.4;
  const maxTokens = Math.max(
    4000,
    Math.min(10000, spec.cost_profile.tokens_estimate),
  );

  return { system, user, temperature, maxTokens };
}
