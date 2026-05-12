// ── Mediator Proposal Engine — M3 orchestrator ──────────────────────
//
// Glue between propose-mediator (M2) and the LLM (via llmJSON). Takes
// a MediatorProposal + context, runs the validator prompt, and returns
// a ValidatedMediatorProposal that bundles the original proposal with
// the verdict + a final adjusted confidence.
//
// Designed for swappability: this is the LIGHT validator (one LLM call,
// fast, ~2s, no web search). The heavy validator (real literature
// search via the existing research pipeline) will land later as a
// drop-in replacement with the same interface — only the underlying
// implementation differs.
//
// Cost discipline: one llmJSON call per proposal. M2 outputs ≤ 8
// proposals per detector run (M1's maxClustersToReturn), so the full
// detect → propose → validate pipeline is bounded at ~16 LLM calls
// per space, ~5-10s end-to-end.
//
// Failure semantics: any individual validation that throws degrades
// to a "speculative" verdict with confidence_adjustment 0.5 and the
// error captured in notes. The proposal still advances to M4; the
// downstream queue surfaces the issue rather than dropping the
// proposal silently.

import { llmJSON } from "@/lib/llm";
import type { MediatorProposal } from "@/lib/prompts/mediator-proposal";
import {
  MEDIATOR_VALIDATOR_SYSTEM,
  MEDIATOR_VALIDATOR_SCHEMA,
  buildMediatorValidatorUserPrompt,
  normalizeValidationVerdict,
  type MediatorValidatorContext,
  type ValidationVerdict,
} from "@/lib/prompts/mediator-validator";

// ── Public types ────────────────────────────────────────────────────

/**
 * The proposal + verdict bundle, with the final confidence already
 * computed. M4 (persistence) reads this directly to decide:
 *   - status="validated"   → insert as proposed_mediator with
 *                            edges flagged status="proposed"
 *   - status="speculative" → insert with an additional `speculative`
 *                            tag so the M6 UI can warn the user
 *   - status="rejected"    → drop without persisting
 *   - status="duplicate"   → don't insert; surface a rename hint
 *                            via a separate flow
 */
export interface ValidatedMediatorProposal {
  /** The original proposal from M2, unchanged. */
  proposal: MediatorProposal;

  /** The validator's verdict from M3. */
  verdict: ValidationVerdict;

  /**
   * Final confidence after applying the validator's adjustment to the
   * proposal's confidence: clamp01(proposal.proposed_entity.confidence
   * × verdict.confidence_adjustment). Returns 0 when the proposal
   * declined a bridge (proposed_entity is null) OR when the verdict
   * is "rejected" or "duplicate".
   *
   * M4 uses this for ordering the review queue (highest first) and
   * for the warning-chip threshold (< 0.5 = speculative styling).
   */
  confidence_final: number;
}

export interface ValidateMediatorOptions {
  /** Override the default model. Caller usually leaves unset. */
  model?: string;
  /** 0-1. Default 0.1 — very low because we want consistent verdicts;
   *  this is calibration, not creative judgment. */
  temperature?: number;
  /** Cap on output tokens. ~400 is plenty for one verdict. */
  maxTokens?: number;
}

// ── Public functions ────────────────────────────────────────────────

/**
 * Validate a single mediator proposal against the LLM's training-data
 * knowledge of the published literature. Always returns a valid
 * ValidatedMediatorProposal — failure degrades to a speculative verdict
 * rather than throwing, so the outer batch loop is monotonic.
 */
export async function validateMediatorProposal(
  proposal: MediatorProposal,
  context: MediatorValidatorContext,
  options: ValidateMediatorOptions = {},
): Promise<ValidatedMediatorProposal> {
  // Edge case: M2 returned a null proposal (proposer declined). The
  // validator's job there is just to confirm the decline was reasonable.
  // We still call the LLM (cheap) so we capture any "the proposer
  // missed an obvious bridge" callouts.
  let verdict: ValidationVerdict;

  try {
    const user = buildMediatorValidatorUserPrompt(proposal, context);
    const raw = await llmJSON<unknown>({
      system: MEDIATOR_VALIDATOR_SYSTEM,
      user,
      responseSchema: MEDIATOR_VALIDATOR_SCHEMA,
      temperature: options.temperature ?? 0.1,
      maxTokens: options.maxTokens ?? 400,
      model: options.model,
      fallback: null,
    });
    verdict = normalizeValidationVerdict(raw);
  } catch (err) {
    verdict = {
      status: "speculative",
      confidence_adjustment: 0.5,
      supporting_evidence_summary:
        "validator threw during LLM call; defaulting to speculative",
      counter_evidence_summary: null,
      rejected_reason: null,
      duplicate_of_name: null,
      notes: [
        `validator_error: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  return {
    proposal,
    verdict,
    confidence_final: computeFinalConfidence(proposal, verdict),
  };
}

/**
 * Validate a batch of proposals. Runs sequentially so per-proposal
 * progress can be reported by callers (M5 will surface "validating
 * 3 of 8" status). Each validation is independent — one failure
 * doesn't block the others. Returns proposals in the same order as
 * input.
 */
export async function validateMediatorProposals(
  proposals: MediatorProposal[],
  context: MediatorValidatorContext,
  options: ValidateMediatorOptions = {},
): Promise<ValidatedMediatorProposal[]> {
  const validated: ValidatedMediatorProposal[] = [];
  for (const proposal of proposals) {
    validated.push(await validateMediatorProposal(proposal, context, options));
  }
  return validated;
}

// ── Internal helpers ────────────────────────────────────────────────

function computeFinalConfidence(
  proposal: MediatorProposal,
  verdict: ValidationVerdict,
): number {
  if (!proposal.proposed_entity) return 0; // declined proposals carry no bridge
  if (verdict.status === "rejected" || verdict.status === "duplicate") return 0;
  const product =
    proposal.proposed_entity.confidence * verdict.confidence_adjustment;
  if (product < 0) return 0;
  if (product > 1) return 1;
  return product;
}
