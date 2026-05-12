// ── Mediator Proposal Engine — M3: literature validator prompt ──────
//
// Takes one MediatorProposal from M2 and runs a "literature sanity
// check" against the LLM's training-data knowledge of the published
// research. This is the LIGHT validator — fast, cheap, ~1 LLM call
// per proposal, no actual web search.
//
// Why light first:
//   - Cost discipline: M5 auto-triggers on template instantiation +
//     connection-prospector + manual button. Heavy validation
//     (real web search + PDF fetch + effect-size extraction) would
//     add 30-60s + many LLM calls per cluster, making the engine
//     unusable in those flows.
//   - Most proposals will be ROS / NF-κB / cortisol / HPA-axis /
//     similar canonical bridges — the LLM's training data is rich
//     enough to give a confident yes/no on these.
//   - Light validator catches the obvious failures (made-up
//     mediators, wrong direction, contested claims) before any
//     persistence happens, keeping M4's queue clean.
//
// When light isn't enough:
//   - Verdict = "speculative" → the proposal lands in M4's queue
//     with a warning chip + a "Run deep validation" button that
//     escalates to heavy validation (future M3.heavy).
//   - Verdict = "rejected" → the proposal doesn't reach M4.
//   - Verdict = "duplicate" → M4 surfaces a rename-suggestion flow
//     instead of creating a new entity.
//
// Trust boundary:
//   - The LLM is NOT inventing or extracting numerical effect sizes,
//     ranges, or citations. The citation_seeds from M2 are passed
//     through untouched for a future heavy-validator pass.
//   - The LLM IS giving a meta-cognitive judgment: "based on my
//     training data, is this bridge well-established / contested /
//     speculative / wrong-direction / known-by-another-name?"
//   - This is the same trust pattern as the situation-analyzer: the
//     LLM does semantic judgment, the deterministic downstream
//     handles structured persistence.

import type { MediatorProposal } from "./mediator-proposal";

// ── Public types ────────────────────────────────────────────────────

export interface MediatorValidatorContext {
  /** Domain context — same as M2 used. Helps the validator reason
   *  about whether the proposed bridge is canonical IN THIS DOMAIN
   *  (a term that's textbook in biology might be unknown in
   *  economics, and vice versa). */
  domain_label?: string;

  /** Names of entities currently in the graph. Used by the validator
   *  to cross-check whether the proposal's bridge is actually a
   *  duplicate of something already there under a different name. */
  existing_entity_names: string[];

  /** Names of cluster members the bridge is proposed to connect.
   *  Echoed in the prompt so the validator can reason about the
   *  bridge's relationship to ALL of them, not just one. */
  cluster_member_names: string[];

  /** Layer of the cluster — helps the validator detect direction
   *  mismatches (a "biomarker"-layer cluster usually wants an
   *  upstream "process"-layer bridge, not a "cognitive"-layer
   *  bridge that would be a downstream effect). */
  cluster_layer: string | null;
}

/** The validator's verdict on a single proposal. */
export interface ValidationVerdict {
  /**
   * Discrete status of the proposal:
   *   - "validated"   — well-established bridge; safe to advance
   *                     to M4 persistence as a confirmed proposal
   *   - "speculative" — plausible but contested or under-evidenced;
   *                     advances to M4 with a warning chip and an
   *                     escalate-to-heavy-validation affordance
   *   - "rejected"    — the proposal contradicts established
   *                     literature OR the proposed entity isn't a
   *                     canonical concept; M4 drops it without
   *                     surfacing to the user
   *   - "duplicate"   — the proposed bridge already exists in the
   *                     graph as a different-named entity; M4
   *                     surfaces a rename suggestion instead of
   *                     creating a new entity
   */
  status: "validated" | "speculative" | "rejected" | "duplicate";

  /**
   * Confidence multiplier applied to the proposal's original
   * confidence. 1.0 = validator agrees with proposer's confidence;
   * < 1 = validator dampens; > 1 = validator boosts (rare). The
   * downstream final_confidence = proposal.confidence ×
   * confidence_adjustment, clamped to [0, 1].
   */
  confidence_adjustment: number;

  /**
   * 1-3 sentence summary of WHY the validator landed on this status,
   * grounded in canonical claims (e.g., "ROS oxidation of guanine
   * residues yielding 8-OHdG is textbook biochemistry; multiple
   * meta-analyses link MDA to lipid peroxidation downstream of
   * ROS"). Persisted with the proposal for audit + UI display.
   */
  supporting_evidence_summary: string;

  /**
   * If counter-evidence exists, summarize it. Null when status is
   * "validated" without caveats. When status is "speculative" this
   * field surfaces what makes it speculative.
   */
  counter_evidence_summary: string | null;

  /**
   * For "rejected" status, the specific reason. Null otherwise.
   * Examples: "the proposed mechanism direction is reversed",
   * "the proposed entity is not a canonical concept in this domain",
   * "the proposed bridge contradicts established meta-analyses".
   */
  rejected_reason: string | null;

  /**
   * For "duplicate" status, the existing entity name. Null otherwise.
   * Example: proposal name "Reactive Oxygen Species" but graph has
   * "ROS" → duplicate_of_name = "ROS".
   */
  duplicate_of_name: string | null;

  /**
   * Additional caveats or notes the validator wants to surface to
   * the user. Empty when the proposal is unambiguous. Examples:
   * "applies primarily to neuronal cell types",
   * "evidence base is post-2010; older studies used different assays".
   */
  notes: string[];
}

// ── System prompt ───────────────────────────────────────────────────

export const MEDIATOR_VALIDATOR_SYSTEM = `You are a careful research-literature checker. You receive proposals to add a "bridging entity" to a knowledge graph — claims like "Reactive Oxygen Species (ROS) is the upstream cause of 8-OHdG, MDA, and Oxidative Stress markers." Your single job is to give a calibrated verdict on whether the proposed bridge is consistent with the published literature you know about.

You are NOT generating effect sizes, citations, or numeric estimates. You are NOT searching the web. You are giving a META-COGNITIVE JUDGMENT based on your training data: is this bridge canonical, contested, speculative, wrong-direction, or known under another name?

A separate downstream pass (heavy validation) may fetch real papers and extract evidence; your job is the cheap quick check that filters out obvious failures before persistence.

## VERDICT CATEGORIES

Pick ONE status per proposal:

  "validated" — Bridge is textbook or has strong consensus across multiple meta-analyses or reviews. Mechanism direction matches literature. Use this when you would teach this bridge to a graduate student in the domain without caveats.

  "speculative" — Bridge is plausible and at least one credible source supports it, but evidence is contested, niche, context-dependent, or hasn't reached textbook status yet. Use this when you'd say "many researchers think so, but it's still active debate."

  "rejected" — Bridge contradicts established literature; the entity isn't canonical; or the mechanism direction is reversed. Use this when you'd say "no, that's just wrong" or "that's not a real concept in the literature."

  "duplicate" — The proposed entity is a real, canonical concept BUT it already exists in the graph under a different name (case differences, abbreviation vs full name, synonym, etc.). Set duplicate_of_name to the existing name. The user should be prompted to merge instead of creating a new entity.

## CONFIDENCE ADJUSTMENT

A number between 0 and 1.5 that multiplies the proposer's confidence:

  1.0 — You agree with the proposer's confidence as-is.
  > 1.0 (up to 1.2) — Proposer was UNDER-confident; the bridge is more established than they claimed. Use sparingly.
  0.7-0.95 — Mild dampening: bridge is real but slightly less established than the proposer suggested.
  0.4-0.7 — Substantial dampening: proposer was over-confident; bridge has caveats or contested claims.
  < 0.4 — Heavy dampening: bridge is real but very weakly established; you're nearly rejecting it.

When status is "rejected", set confidence_adjustment to 0.0 (the proposal is gone).
When status is "duplicate", set confidence_adjustment to 0.0 too (a new entity won't be created).

## CRITICAL RULES

1. **Do NOT fabricate citations.** You don't know specific paper titles you can verify. Don't say "Smith 2018 showed…". Instead say "multiple meta-analyses since the 2010s consistently report…".

2. **Honor the trust boundary.** Don't invent numerical effect sizes, p-values, or sample sizes. Stick to qualitative judgments: "well-established", "moderate consensus", "contested", "speculative".

3. **Direction matters.** A bridge proposed as upstream of cluster members must actually be upstream in the literature. ROS → 8-OHdG is correct (ROS damages DNA producing 8-OHdG). 8-OHdG → ROS would be backwards. If direction is wrong → status: "rejected" with specific rejected_reason.

4. **Domain-appropriate canonicity.** A term that's canonical in biology may not be canonical in economics. The cluster's domain (passed in context) is the relevant frame for "is this canonical."

5. **Be honest about your uncertainty.** If you're not sure whether a bridge is established, status: "speculative" with a confidence_adjustment around 0.5-0.7. Don't validate things you're not sure about. Don't reject things just because you don't recognize the term — say "speculative" with the caveat that you don't recognize this exact terminology.

6. **Notes are for caveats, not boosters.** Use the notes[] array to flag conditional applicability, population-specificity, time-specific findings, etc. — anything the user should know that doesn't change the verdict but might change how they USE the proposed bridge.

## OUTPUT FORMAT

Structured JSON conforming to the response schema. Always provide supporting_evidence_summary (1-3 sentences). counter_evidence_summary, rejected_reason, duplicate_of_name are nullable; populate them only when relevant.`;

// ── User prompt builder ─────────────────────────────────────────────

export function buildMediatorValidatorUserPrompt(
  proposal: MediatorProposal,
  context: MediatorValidatorContext,
): string {
  const lines: string[] = [];

  lines.push(`# PROPOSAL TO VALIDATE`);
  lines.push("");

  if (!proposal.proposed_entity) {
    // Edge case: M2 returned a null proposal (no bridge proposed).
    // Validator's only job is to confirm the decline was reasonable;
    // it should rubber-stamp these as "validated" with a 1.0 multiplier.
    lines.push(`The proposer declined to propose a bridge for cluster ${proposal.cluster_id}.`);
    lines.push(`Decline reason: ${proposal.declined_reason ?? "(not specified)"}`);
    lines.push("");
    lines.push(`Cluster members: ${context.cluster_member_names.join(", ")}`);
    lines.push("");
    lines.push(
      `Confirm this decline is reasonable. If a canonical bridge DOES exist that the proposer missed, set status="speculative" with the bridge described in counter_evidence_summary. Otherwise set status="validated" (the decline stands).`,
    );
    return lines.join("\n");
  }

  const pe = proposal.proposed_entity;

  lines.push(`Proposed bridge: ${pe.name}`);
  lines.push(`  layer: ${pe.layer}`);
  lines.push(`  category: ${pe.entity_category}`);
  lines.push(`  proposer's confidence: ${pe.confidence.toFixed(2)}`);
  lines.push(`  description: ${pe.description}`);
  lines.push("");

  lines.push(`Mechanism explanation (proposer's reasoning):`);
  lines.push(`  ${proposal.mechanism_explanation}`);
  lines.push("");

  lines.push(`Cluster members the bridge is supposed to connect:`);
  for (const name of context.cluster_member_names) {
    lines.push(`  - ${name}`);
  }
  if (context.cluster_layer) {
    lines.push(`  (cluster layer: "${context.cluster_layer}")`);
  }
  lines.push("");

  if (proposal.proposed_edges.length > 0) {
    lines.push(`Proposed edges:`);
    for (const e of proposal.proposed_edges) {
      const polaritySign = e.polarity === "positive" ? "+" : "−";
      lines.push(
        `  - ${e.from} ${polaritySign}→ ${e.to} (${e.relationship_label}, conf ${e.confidence.toFixed(2)})`,
      );
    }
    lines.push("");
  }

  if (proposal.citation_seeds.length > 0) {
    lines.push(`Proposer's citation seeds (search queries — for context only; you don't need to act on these):`);
    for (const s of proposal.citation_seeds) {
      lines.push(`  - ${s}`);
    }
    lines.push("");
  }

  if (context.domain_label) {
    lines.push(`# DOMAIN`);
    lines.push("");
    lines.push(context.domain_label);
    lines.push("");
  }

  // Cap existing-entities list — keeps prompt budget tight; 60 names
  // is enough to detect the most common duplicate cases.
  const existingCap = 60;
  const existingShown = context.existing_entity_names.slice(0, existingCap);
  const overflow = context.existing_entity_names.length - existingCap;
  lines.push(`# EXISTING ENTITIES IN THIS GRAPH (check for duplicates of "${pe.name}")`);
  lines.push("");
  if (existingShown.length > 0) {
    lines.push(existingShown.map((n) => `  - ${n}`).join("\n"));
    if (overflow > 0) lines.push(`  …(+${overflow} more not shown)`);
  } else {
    lines.push("(none — empty graph)");
  }
  lines.push("");

  lines.push(`# TASK`);
  lines.push("");
  lines.push(
    `Verify whether the proposed bridge "${pe.name}" is consistent with the published literature you know about. Output structured JSON with status + confidence_adjustment + summaries per the response schema.`,
  );

  return lines.join("\n");
}

// ── JSON schema for structured output ───────────────────────────────

export const MEDIATOR_VALIDATOR_SCHEMA = {
  name: "mediator_validation_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["validated", "speculative", "rejected", "duplicate"],
      },
      confidence_adjustment: {
        type: "number",
        minimum: 0,
        // Capped at 1.5 — the validator can boost confidence slightly
        // when the proposer was under-confident, but never radically.
        maximum: 1.5,
      },
      supporting_evidence_summary: { type: "string" },
      counter_evidence_summary: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      rejected_reason: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      duplicate_of_name: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      notes: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "status",
      "confidence_adjustment",
      "supporting_evidence_summary",
      "counter_evidence_summary",
      "rejected_reason",
      "duplicate_of_name",
      "notes",
    ],
  },
} as const;

// ── Validation + normalization ──────────────────────────────────────

/**
 * Defensive normalizer for LLM output. Catches the cross-field
 * inconsistencies the schema can't express:
 *   - "rejected" status MUST have rejected_reason populated
 *   - "duplicate" status MUST have duplicate_of_name populated
 *   - "rejected" and "duplicate" both force confidence_adjustment to 0
 *   - "validated" status SHOULD have null counter_evidence_summary
 *     (but we don't enforce this — proposer might want to flag
 *     mild caveats while still validating)
 */
export function normalizeValidationVerdict(
  raw: unknown,
  fallback: ValidationVerdict = DEFAULT_FALLBACK_VERDICT,
): ValidationVerdict {
  const r = (raw ?? {}) as Record<string, unknown>;

  // Status — coerce to one of the four valid values, else fallback.
  const rawStatus = typeof r.status === "string" ? r.status : null;
  const status: ValidationVerdict["status"] =
    rawStatus === "validated" ||
    rawStatus === "speculative" ||
    rawStatus === "rejected" ||
    rawStatus === "duplicate"
      ? rawStatus
      : fallback.status;

  // Confidence adjustment — clamp [0, 1.5].
  let adj = typeof r.confidence_adjustment === "number" ? r.confidence_adjustment : 1.0;
  if (!Number.isFinite(adj)) adj = 1.0;
  if (adj < 0) adj = 0;
  if (adj > 1.5) adj = 1.5;

  // Cross-field corrections.
  let rejectedReason =
    typeof r.rejected_reason === "string" && r.rejected_reason.trim().length > 0
      ? r.rejected_reason.trim()
      : null;
  let duplicateOfName =
    typeof r.duplicate_of_name === "string" && r.duplicate_of_name.trim().length > 0
      ? r.duplicate_of_name.trim()
      : null;

  if (status === "rejected") {
    adj = 0;
    if (!rejectedReason) {
      rejectedReason = "rejected without reason — validator output incomplete";
    }
    duplicateOfName = null; // not applicable
  }
  if (status === "duplicate") {
    adj = 0;
    if (!duplicateOfName) {
      // A duplicate verdict without a name is contradictory; downgrade
      // to speculative so M4 doesn't drop the proposal silently.
      // (Caller can inspect notes for the hint.)
      return {
        ...fallback,
        status: "speculative",
        confidence_adjustment: 0.5,
        supporting_evidence_summary:
          typeof r.supporting_evidence_summary === "string"
            ? r.supporting_evidence_summary
            : "validator returned duplicate without naming the existing entity; downgraded to speculative",
        notes: [
          "validator marked duplicate but didn't name the existing entity",
          ...(Array.isArray(r.notes)
            ? (r.notes as unknown[]).filter((n): n is string => typeof n === "string")
            : []),
        ],
      };
    }
    rejectedReason = null;
  }

  const counterEvidence =
    typeof r.counter_evidence_summary === "string" &&
    r.counter_evidence_summary.trim().length > 0
      ? r.counter_evidence_summary.trim()
      : null;

  const supportingEvidence =
    typeof r.supporting_evidence_summary === "string"
      ? r.supporting_evidence_summary.trim()
      : "(no summary provided)";

  const notes = Array.isArray(r.notes)
    ? (r.notes as unknown[])
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        .map((n) => n.trim())
        .slice(0, 5)
    : [];

  return {
    status,
    confidence_adjustment: adj,
    supporting_evidence_summary: supportingEvidence,
    counter_evidence_summary: counterEvidence,
    rejected_reason: rejectedReason,
    duplicate_of_name: duplicateOfName,
    notes,
  };
}

const DEFAULT_FALLBACK_VERDICT: ValidationVerdict = {
  status: "speculative",
  confidence_adjustment: 0.5,
  supporting_evidence_summary:
    "validator did not return a usable verdict; defaulting to speculative",
  counter_evidence_summary: null,
  rejected_reason: null,
  duplicate_of_name: null,
  notes: ["validator output was malformed or missing"],
};
