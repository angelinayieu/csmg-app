/**
 * Mechanism grounding (D7) — explicit phenomenology vs mechanism
 * separation for synthesis output. Attaches to leverage_points,
 * risk_points, and master_bottleneck so a reader can:
 *
 *   1. ACT on the phenomenology even if they reject the mechanism
 *      (the surface-level pattern is observable; the user can
 *      respond to it independently)
 *   2. TEST the mechanism via the falsifiable_prediction
 *   3. TRACE the mechanism's evidence via literature_grounding
 *
 * The phenomenology / mechanism / literature / falsifiable-prediction
 * split is the core honesty contract of D7. Without it, synthesis
 * output mixes "what we observe" with "why we think it happens" and
 * users can't distinguish the two — leading to over-trust in the
 * model's causal claims.
 *
 * See docs/KG_DEPTH_CRITIQUE.md §9 D7 for context. The synthesis
 * prompt at src/lib/prompts/synthesis.ts owns the contract; this
 * type mirrors what the LLM emits.
 */

/**
 * Strength of evidence backing the mechanism. Be honest — fabricated
 * citations are worse than no citations. "inferred" is the right
 * answer when the mechanism is your domain expertise without citable
 * backing.
 */
export type EvidenceStrength =
  | "empirical" // peer-reviewed data
  | "theoretical" // formal model widely accepted in the domain
  | "inferred" // domain pattern with reasonable support but no canonical citation
  | "anecdotal"; // single case from practice

/**
 * One literature reference supporting the mechanism. Authors named
 * specifically; year either numeric or short-text ("meta-analysis 2021").
 */
export interface LiteratureCitation {
  /** Author surname or organization name. */
  author: string;
  /** Year (number) or short-text (e.g. "meta-analysis 2021", "preprint Q1 2024"). */
  year: number | string;
  /** The specific claim from this source supporting the mechanism. */
  claim: string;
}

/**
 * Per-finding mechanism grounding block. Attached to leverage_points,
 * risk_points, and master_bottleneck.
 *
 * The risk_points variant uses `failure_mechanism` instead of
 * `mechanism_explanation` for semantic clarity; both fields are
 * optional in the type so all three call-sites can share the shape.
 * Validator enforces that exactly one is populated per finding.
 */
export interface MechanismGrounding {
  /**
   * What is OBSERVED. Surface-layer description of the symptom or
   * pattern, NOT the cause. (e.g. "users drop off after day 7";
   * "engagement spikes 3× when users cross day-21"; "trust collapses
   * after first hallucinated answer")
   */
  phenomenology: string;
  /**
   * The CAUSAL mechanism producing the phenomenology. Reaches past
   * folk-vocabulary toward a NAMED process or theory of action. Used
   * by master_bottleneck and leverage_points.
   */
  mechanism_explanation?: string;
  /**
   * The CAUSAL mechanism producing the FAILURE pattern. Used by
   * risk_points specifically — semantic distinction from
   * mechanism_explanation makes risk-vs-leverage scanning easier in
   * downstream UI.
   */
  failure_mechanism?: string;
  /**
   * Specific named sources backing the mechanism. Required to be
   * non-empty when evidence_strength is "empirical" or "theoretical".
   * Empty array allowed for "inferred" or "anecdotal" — but only when
   * the corresponding strength tag is honestly set.
   */
  literature_grounding: LiteratureCitation[];
  /** Honest evidence-strength tag. Drives downstream UI confidence
   *  rendering and prevents fabricated citations. */
  evidence_strength: EvidenceStrength;
  /**
   * A CONCRETE testable claim that would refute the mechanism if it
   * failed. Must specify metric + magnitude + timeframe. If the LLM
   * cannot write one, the mechanism is too vague — the prompt
   * explicitly instructs to rewrite the mechanism rather than omit
   * the prediction.
   */
  falsifiable_prediction: string;
}

// ── Validator (lenient — extracts what's there, drops malformed) ───

const ALLOWED_STRENGTHS: ReadonlyArray<EvidenceStrength> = [
  "empirical",
  "theoretical",
  "inferred",
  "anecdotal",
];

/**
 * Lenient validator. Soft-fails (returns null) when the input is
 * unrecognizable; otherwise returns a normalized MechanismGrounding
 * with field-length caps + enum coercion.
 *
 * Returns null when:
 *   - not an object
 *   - no phenomenology field
 *   - both mechanism_explanation AND failure_mechanism are missing
 */
export function validateMechanismGrounding(
  raw: unknown,
): MechanismGrounding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const phenomenology =
    typeof obj.phenomenology === "string" && obj.phenomenology.trim().length > 0
      ? obj.phenomenology.trim().slice(0, 1000)
      : null;
  if (!phenomenology) return null;

  const mechExplanation =
    typeof obj.mechanism_explanation === "string" &&
    obj.mechanism_explanation.trim().length > 0
      ? obj.mechanism_explanation.trim().slice(0, 4000)
      : undefined;
  const failureMech =
    typeof obj.failure_mechanism === "string" &&
    obj.failure_mechanism.trim().length > 0
      ? obj.failure_mechanism.trim().slice(0, 4000)
      : undefined;
  if (!mechExplanation && !failureMech) return null;

  const evidenceStrength: EvidenceStrength =
    typeof obj.evidence_strength === "string" &&
    (ALLOWED_STRENGTHS as ReadonlyArray<string>).includes(obj.evidence_strength)
      ? (obj.evidence_strength as EvidenceStrength)
      : "inferred";

  const falsifiable =
    typeof obj.falsifiable_prediction === "string" &&
    obj.falsifiable_prediction.trim().length > 0
      ? obj.falsifiable_prediction.trim().slice(0, 1000)
      : "";

  const literature: LiteratureCitation[] = [];
  if (Array.isArray(obj.literature_grounding)) {
    for (const cite of obj.literature_grounding) {
      if (typeof cite !== "object" || cite === null) continue;
      const c = cite as Record<string, unknown>;
      const author =
        typeof c.author === "string" ? c.author.trim().slice(0, 200) : "";
      const year: number | string =
        typeof c.year === "number"
          ? c.year
          : typeof c.year === "string"
            ? c.year.trim().slice(0, 100)
            : "";
      const claim =
        typeof c.claim === "string" ? c.claim.trim().slice(0, 1000) : "";
      if (author && claim) {
        literature.push({ author, year, claim });
      }
    }
  }

  return {
    phenomenology,
    ...(mechExplanation ? { mechanism_explanation: mechExplanation } : {}),
    ...(failureMech ? { failure_mechanism: failureMech } : {}),
    literature_grounding: literature,
    evidence_strength: evidenceStrength,
    falsifiable_prediction: falsifiable,
  };
}
