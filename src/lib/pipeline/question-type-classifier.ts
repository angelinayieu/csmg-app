// ── Question-type classifier (Phase 2E · PR 1.5) ──
//
// Upstream of the frame extractor. Classifies the user's input
// into one of 8 question types (drawn from decision theory +
// epistemology) + a coarse domain tag + a complexity score. The
// frame extractor then uses this to prioritize or filter which
// axes are candidates for generation.
//
// Why this lives above the frame extractor:
//
//   A quantum physics input shouldn't run the Financial axis at
//   all. No amount of role-play prompt engineering inside the
//   Financial generator rescues its output for a QFT question —
//   the axis simply shouldn't be a candidate in the first place.
//   Question type + domain determine which axes are even eligible.
//
// Cost: one cheap LLM call (~150 output tokens, ~2s). Adds a
// tractable latency tax for a large axis-relevance quality gain.
//
// Graceful degradation: if the classifier fails, the frame
// extractor falls back to its current unconditioned behavior
// (fixed 8-axis catalog). The classifier is ENHANCEMENT, never a
// hard dependency.

import { llmJSON } from "@/lib/llm";
import type { QuestionType } from "@/lib/prompts/axis-prompts";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export type DomainTag =
  | "business"
  | "science"
  | "engineering"
  | "personal"
  | "philosophy"
  | "medical"
  | "legal"
  | "creative"
  | "research"
  | "policy"
  | "other";

export type Complexity = "simple" | "moderate" | "high";

export interface QuestionTypeResult {
  type: QuestionType;
  /** Secondary type when the input is a hybrid (e.g. a decision
   *  that requires prediction). Null when the input is mono-typed. */
  secondary_type: QuestionType | null;
  domain: DomainTag;
  complexity: Complexity;
  /** LLM self-assessed classification confidence 0..1. Honest
   *  signal that the classifier was unsure — frame extractor can
   *  broaden axis set when confidence is low. */
  confidence: number;
  /** One-sentence rationale surfaced in the HUD and in the frame
   *  extractor's space_opened events so users see why the system
   *  chose these lenses. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are a meta-analyst classifying a user's input to decide what KIND of question they're asking. Your output drives which analytical lenses the downstream system uses.

Eight question types exist:
- decision: choosing between explicit options (hire X or Y? pivot or stay?). Demands decision-tree + reversibility + VoI analysis.
- prediction: forecasting an outcome (will churn hit 15%? when will QEC be viable?). Demands priors + drivers + calibration.
- diagnosis: figuring out WHY something happened (why did retention drop? why did the experiment fail?). Demands causal backtracking + counterfactuals.
- design: building or structuring something (how should we architect X? what's the right team structure?). Demands constraints + tradeoffs + function-structure-behavior decomposition.
- exploration: mapping a domain (what's the landscape of AI alignment research?). Demands ontology + gap identification + counter-positions.
- analysis: understanding a phenomenon (what's really happening in our user base? what are the mechanisms behind X?). Demands mechanism decomposition + levels-of-explanation.
- evaluation: judging against criteria (is this product-market fit? is this research credible?). Demands rubric + weights + edge cases.
- synthesis: combining disparate ideas (how does X relate to Y? what's the unified framework connecting these?). Demands mapping + novel connections + conceptual architecture.

Eleven domain tags: business, science, engineering, personal, philosophy, medical, legal, creative, research, policy, other.

Three complexity tiers:
- simple: single-concept question, <2 dependencies, <30s to answer rigorously.
- moderate: 2-5 interacting components, multiple lenses required.
- high: many-variable system, long-horizon, significant unknowns.

Return strict JSON:
{
  "type": "<primary question type>",
  "secondary_type": "<secondary type when hybrid, else null>",
  "domain": "<one of 11 domain tags>",
  "complexity": "simple" | "moderate" | "high",
  "confidence": <0..1, self-assessed classification confidence>,
  "rationale": "one sentence explaining the primary type + domain choice, <25 words"
}

Rules:
- Pick the MOST SPECIFIC type that fits. "Analysis" is a fallback when the input doesn't fit the other seven cleanly.
- Assign "other" domain only when none of the 10 specific tags apply.
- Confidence below 0.5 signals genuine ambiguity — don't fake certainty.
- Rationale must be specific to THIS input, not generic type description.
- Do NOT add preamble or markdown fences around the JSON.`;

const VALID_TYPES: QuestionType[] = [
  "decision",
  "prediction",
  "diagnosis",
  "design",
  "exploration",
  "analysis",
  "evaluation",
  "synthesis",
];

const VALID_DOMAINS: DomainTag[] = [
  "business",
  "science",
  "engineering",
  "personal",
  "philosophy",
  "medical",
  "legal",
  "creative",
  "research",
  "policy",
  "other",
];

function validateQuestionType(raw: unknown): QuestionTypeResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("classifier returned non-object");
  }
  const obj = raw as Record<string, unknown>;

  const type = VALID_TYPES.includes(obj.type as QuestionType)
    ? (obj.type as QuestionType)
    : "analysis";

  const secondaryType =
    obj.secondary_type && VALID_TYPES.includes(obj.secondary_type as QuestionType)
      ? (obj.secondary_type as QuestionType)
      : null;

  const domain = VALID_DOMAINS.includes(obj.domain as DomainTag)
    ? (obj.domain as DomainTag)
    : "other";

  const complexityRaw = obj.complexity;
  const complexity: Complexity =
    complexityRaw === "simple" || complexityRaw === "high"
      ? complexityRaw
      : "moderate";

  const confidenceRaw = obj.confidence;
  const confidence =
    typeof confidenceRaw === "number" && confidenceRaw >= 0 && confidenceRaw <= 1
      ? confidenceRaw
      : 0.5;

  const rationale =
    typeof obj.rationale === "string" ? obj.rationale.slice(0, 220) : "";

  return {
    type,
    secondary_type: secondaryType,
    domain,
    complexity,
    confidence,
    rationale,
  };
}

const FALLBACK: QuestionTypeResult = {
  type: "analysis",
  secondary_type: null,
  domain: "other",
  complexity: "moderate",
  confidence: 0,
  rationale: "Classifier unavailable; falling back to generic analysis frame.",
};

/**
 * Run the classifier. ~2s / ~$0.002. Soft-fails to a neutral
 * fallback so the pipeline never gates on this step.
 */
export async function classifyQuestionType(
  inputText: string,
): Promise<QuestionTypeResult> {
  const trimmed = inputText.trim().slice(0, 3500);
  if (trimmed.length < 10) return FALLBACK;

  try {
    return await llmJSON<QuestionTypeResult>({
      system: SYSTEM_PROMPT,
      user: `Input to classify:\n"""\n${trimmed}\n"""\n\nReturn the JSON described in the system prompt.`,
      maxTokens: 500,
      temperature: 0.1,
      validator: validateQuestionType,
      fallback: FALLBACK,
    });
  } catch (err) {
    console.warn("[question-type-classifier] failed:", err);
    return FALLBACK;
  }
}

// ── Axis applicability matrix ──────────────────────────────────────
//
// Pre-LLM guardrail. Tells the frame extractor which axes are
// reasonable candidates for a given (type, domain) before it asks
// the LLM to pick. Prevents Financial from being offered for
// a philosophy question no matter what the frame extractor's LLM
// happens to output.
//
// Semantics: for each (type, domain), a list of axes that are
// NATURAL FITS. The frame extractor treats non-listed axes as
// requiring explicit justification from the LLM to be included —
// raises the bar rather than hard-blocks them. Load-bearing
// assumption axes ("assumptions" for all) always pass through.
//
// The matrix encodes domain expertise — when it's wrong, the fix
// is one line here, not a prompt rewrite.

export function applicableAxesFor(
  type: QuestionType,
  domain: DomainTag,
): ProbabilitySpaceAxis[] {
  const base: ProbabilitySpaceAxis[] = ["assumptions"];

  // Type-driven defaults
  const byType: Record<QuestionType, ProbabilitySpaceAxis[]> = {
    decision: [
      "causal_scenarios",
      "risk",
      "actors",
      "timeline",
      "evidence",
    ],
    prediction: ["evidence", "causal_scenarios", "timeline", "risk"],
    diagnosis: ["actors", "causal_scenarios", "evidence", "timeline"],
    design: ["actors", "risk", "causal_scenarios", "timeline"],
    exploration: ["evidence", "causal_scenarios", "cultural", "actors"],
    analysis: ["causal_scenarios", "evidence", "actors"],
    evaluation: ["evidence", "risk", "actors", "causal_scenarios"],
    synthesis: ["evidence", "causal_scenarios", "cultural"],
  };

  // Domain-driven additions / removals
  const byDomain: Partial<Record<DomainTag, {
    add: ProbabilitySpaceAxis[];
    remove: ProbabilitySpaceAxis[];
  }>> = {
    business: { add: ["financial", "actors", "timeline"], remove: [] },
    personal: { add: ["cultural", "actors"], remove: [] },
    philosophy: {
      add: ["cultural", "evidence"],
      remove: ["financial", "timeline"],
    },
    science: {
      add: ["evidence", "causal_scenarios"],
      remove: ["financial"],
    },
    medical: {
      add: ["evidence", "actors", "risk", "timeline"],
      remove: ["financial"],
    },
    engineering: {
      add: ["risk", "causal_scenarios", "timeline"],
      remove: [],
    },
    legal: { add: ["actors", "evidence", "risk"], remove: [] },
    creative: { add: ["cultural", "actors"], remove: ["financial", "risk"] },
    research: { add: ["evidence", "causal_scenarios"], remove: [] },
    policy: {
      add: ["actors", "evidence", "risk", "cultural"],
      remove: [],
    },
    other: { add: [], remove: [] },
  };

  const typeSet = new Set<ProbabilitySpaceAxis>([...base, ...byType[type]]);
  const domainRule = byDomain[domain];
  if (domainRule) {
    for (const a of domainRule.add) typeSet.add(a);
    for (const a of domainRule.remove) typeSet.delete(a);
  }
  return Array.from(typeSet);
}
