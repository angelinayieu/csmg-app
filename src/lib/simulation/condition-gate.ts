// ── Condition-text → numeric gate (Phase 4 §5.4) ──────────────────────
//
// The Monte Carlo engine accepts a `conditionGate ∈ [0,1]` per
// conditional edge — the per-iteration Bernoulli probability that the
// edge fires. Until now, simulate-entity-chain has used edge
// `confidence` as a stand-in (called out as a placeholder in the
// file's docstring): "conditional edges fire roughly as often as the
// LLM is confident in the relationship."
//
// That proxy is wrong in spirit. Edge confidence measures HOW SURE the
// LLM is that the relationship exists; condition-text describes HOW
// OFTEN the gate fires WHEN the relationship exists. They're orthogonal:
// a high-confidence edge with condition "only during quarterly reviews"
// should fire ~25% of iterations, not ~90% (its confidence). A low-
// confidence edge with condition "always fires when X" should fire
// 100% of the iterations the LLM was right about.
//
// This module reads the condition prose and returns a numeric gate.
//
// Approach: heuristic-first. Lexical hedging language is dense in
// these condition strings (the axis generator prompt explicitly asks
// for it: "always" / "usually" / "sometimes" / "rarely" / "only if"
// / "unless"). A token-spotting heuristic resolves the common case
// in O(condition_length) without an LLM call. When no token matches,
// we fall back to confidence (preserves prior behavior — conservative
// degradation).
//
// Out of scope: LLM-based parsing of complex conditional logic
// ("fires when A AND NOT B unless C"). The current axis prompt
// generates condition_text in plain prose with hedging adverbs;
// compound logic is rare. If telemetry shows the heuristic missing
// often (lots of "no token matched, falling back to confidence"
// log lines), upgrade to LLM-eval next.

const ALWAYS_TOKENS = [
  "always",
  "every time",
  "guaranteed",
  "certain",
  "definite",
  "100%",
  "consistently",
  "invariably",
];

const USUALLY_TOKENS = [
  "usually",
  "typically",
  "often",
  "frequently",
  "most of the time",
  "in most cases",
  "generally",
  "predominantly",
  "largely",
];

const SOMETIMES_TOKENS = [
  "sometimes",
  "occasionally",
  "may ",
  "might ",
  "can ",
  "could ",
  "at times",
  "intermittently",
  "periodically",
];

const RARELY_TOKENS = [
  "rarely",
  "seldom",
  "infrequently",
  "uncommon",
  "occasional edge case",
  "in rare cases",
];

const NEVER_TOKENS = [
  "never",
  "not when",
  "not if",
  " no longer",
  "without exception does not",
];

// "Conditional" hedging — the gate fires only when an external state
// holds. Treat as moderately uncertain: 0.4. Lower than "sometimes"
// because conditional gates tend to express predicates the simulator
// can't evaluate, so we should be cautious.
const CONDITIONAL_TOKENS = [
  "only if",
  "only when",
  "unless",
  "depending on",
  "depends on",
  "provided that",
  "subject to",
  "contingent on",
  "if and only if",
  "iff ",
];

const ALWAYS_GATE = 1.0;
const USUALLY_GATE = 0.78;
const SOMETIMES_GATE = 0.5;
const RARELY_GATE = 0.22;
const NEVER_GATE = 0.05;
const CONDITIONAL_GATE = 0.4;

export interface ConditionGateResult {
  /** Numeric gate in [0,1]. */
  gate: number;
  /** How the gate was derived — useful for telemetry + audit. */
  source: "always" | "usually" | "sometimes" | "rarely" | "never" | "conditional" | "confidence_fallback" | "default_neutral";
  /** Confidence we have in this assignment. 1 for unambiguous lexical
   *  hits, 0.7 for confidence_fallback, 0.5 for default_neutral. The
   *  caller can use this to decide whether to widen the priors on
   *  edges with shaky gates. */
  certainty: number;
}

/**
 * Resolve a condition-text string to a numeric gate.
 *
 * @param conditionText - the prose from edges.conditions. Empty / null
 *   strings short-circuit to confidence_fallback or default_neutral.
 * @param confidence - the edge's confidence value, used as fallback
 *   when no lexical token is matched (preserves the pre-Phase-4
 *   behavior so simulations don't shift unpredictably for edges with
 *   condition_text that doesn't trip the heuristic). Optional —
 *   omitted/NaN falls back to a neutral 0.5.
 */
export function resolveConditionGate(
  conditionText: string | null | undefined,
  confidence?: number | null,
): ConditionGateResult {
  const text = (conditionText ?? "").toLowerCase().trim();

  // Empty / no condition: not actually a conditional edge — caller
  // shouldn't be calling this, but degrade gracefully.
  if (text.length === 0) {
    if (typeof confidence === "number" && Number.isFinite(confidence)) {
      return {
        gate: clamp01(confidence),
        source: "confidence_fallback",
        certainty: 0.7,
      };
    }
    return { gate: 0.5, source: "default_neutral", certainty: 0.5 };
  }

  // Token spotting — order matters when phrases overlap. Check more
  // specific markers first ("only if" before "if"; "never" before
  // "always" so a negated-always doesn't trip the always branch).
  if (matchesAny(text, NEVER_TOKENS)) {
    return { gate: NEVER_GATE, source: "never", certainty: 1 };
  }
  if (matchesAny(text, CONDITIONAL_TOKENS)) {
    return { gate: CONDITIONAL_GATE, source: "conditional", certainty: 1 };
  }
  if (matchesAny(text, ALWAYS_TOKENS)) {
    return { gate: ALWAYS_GATE, source: "always", certainty: 1 };
  }
  if (matchesAny(text, USUALLY_TOKENS)) {
    return { gate: USUALLY_GATE, source: "usually", certainty: 1 };
  }
  if (matchesAny(text, RARELY_TOKENS)) {
    return { gate: RARELY_GATE, source: "rarely", certainty: 1 };
  }
  if (matchesAny(text, SOMETIMES_TOKENS)) {
    return { gate: SOMETIMES_GATE, source: "sometimes", certainty: 1 };
  }

  // No token hit — fall back to edge confidence so behavior matches
  // the pre-Phase-4 placeholder for edges the heuristic can't read.
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    return {
      gate: clamp01(confidence),
      source: "confidence_fallback",
      certainty: 0.7,
    };
  }
  return { gate: 0.5, source: "default_neutral", certainty: 0.5 };
}

function matchesAny(text: string, tokens: string[]): boolean {
  for (const t of tokens) {
    if (text.includes(t)) return true;
  }
  return false;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
