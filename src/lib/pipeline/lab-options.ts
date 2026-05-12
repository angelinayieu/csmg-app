// ── Lab Options Orchestrator (Phase 2 / Week 4 / W4.6) ───────────────
//
// TIER: 3 (situation-specialized causal model) — produces the
//       committed-lab-design payload that anchors execution-brief +
//       generate-apps downstream.
//
// What this library does:
//   Runs all 5 lab-design stances in parallel against the user's
//   chosen problem framing, validates each output, sorts by
//   confidence DESC, and returns a ready-to-persist LabPayload.
//
// Slot in the strategy chain:
//   strategy-refresh
//     → wireTwinProposalAndMechanisms (strategy_twin)
//     → [THIS LIBRARY runs in after()] lab-options
//     → twin_proposals(kind='lab_twin', user_status='proposed')
//     → emits lab_proposed event
//     → chrome card + gate page
//     → user picks → /api/spaces/[id]/lab/select
//     → user_status flips to 'approved'
//     → lab_scaffolds bridge writes the canonical row
//     → existing wizard + subject pipeline takes over
//
// Why no consensus-merge (unlike framing-panel.ts):
//   The 5 stance-flavored lab designs are COMPETING WHOLES — not
//   slices of one design to merge. The user picks ONE, not a hybrid.
//   We sort by confidence and surface all N (where N ≤ 5; stances
//   can decline). The select_alternative re-rank UX from Phase 1
//   ports over directly.
//
// Soft-fail discipline:
//   Each stance's LLM call is wrapped — a stance failure produces a
//   declined output (candidate_whole_lab=null) but doesn't abort the
//   batch. The final LabPayload is built from whichever stances
//   produced valid candidates. When ALL stances declined or all
//   calls failed, we return a fallback single-option LabPayload so
//   the downstream wizard still has something to materialize.
//
// Cost profile: ~5 parallel LLM calls @ ~$0.008 each ≈ $0.04 per
// run. Wall-time ~3-4s on reasonable providers. Cheaper than the
// framing-panel because lab prompts have tighter output specs +
// don't ask for cell-grid opinions.

import { llmJSON } from "@/lib/llm";
import {
  ALL_LAB_STANCE_IDS,
  buildLabStancePrompt,
  validateLabStanceOutput,
  type LabStanceOutput,
} from "@/lib/prompts/lab-stances";
import type { LabConfigOption, LabPayload } from "@/types/lab-options";
import type { LabStanceLensId } from "@/types/pipeline-events";

// ── Public types ─────────────────────────────────────────────────────

export interface RunLabOptionsInput {
  /** The user's raw intake text. Trimmed/sliced internally to fit
   *  prompt budgets. */
  inputText: string;
  /** Concatenated chosen_approach + load_bearing_assumption from the
   *  approved problem_twin. The lab MUST test this, not the user's
   *  stated goal. Empty string disables the framing-aware path. */
  chosenFramingContext: string;
  /** Sub-problems from the chosen framing. Lab primary_iv/primary_dv
   *  typically map to one of these. */
  subProblems?: string[];
  /** KG entities the lab can reference by entity_id for IV/DV
   *  resolution. The library passes these to the LLM as candidate
   *  pointers; the LLM may or may not use them by entity_id. */
  candidateEntities?: Array<{ entity_id: string; name: string }>;
  /** Subject-access constraint hint (e.g., "solo user", "team of 5",
   *  "patient cohort of 200"). The Pragmatist stance reads this
   *  heavily; others use it for cadence calibration. */
  subjectAccessHint?: string;
  /** Override the stance composition. Production: leave unset to use
   *  all 5. Useful for tests / future "I only want fast-feasible
   *  options" caller modes. */
  stances?: readonly LabStanceLensId[];
  /** LLM model override. Defaults to the llmJSON default. */
  model?: string;
  /** Temperature. Defaults to 0.4 (same as framing-panel) — stance
   *  prompts are creative-enough to need some variance but not so
   *  much that the output_spec breaks. */
  temperature?: number;
  /** Output token cap per stance. Defaults to 1500 — labs are
   *  smaller outputs than framings since there's no cell grid. */
  maxTokens?: number;
}

export interface RunLabOptionsResult {
  /** Ready-to-persist payload. options[] is sorted by confidence
   *  DESC; chosen_rank starts at 1 (highest-confidence option).
   *  generated_at is the timestamp of THIS run. */
  payload: LabPayload;
  /** Lens-id of the chosen rank-1 option (for the lab_proposed
   *  event's chosenLens field). */
  chosenLens: LabStanceLensId;
  /** Observability — which stances ran, which failed, how long. */
  stats: {
    stances_called: LabStanceLensId[];
    stances_failed: LabStanceLensId[];
    stances_declined: LabStanceLensId[];
    fallback_used: boolean;
    duration_ms: number;
    per_stance_duration_ms: Partial<Record<LabStanceLensId, number>>;
  };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Run all 5 (or specified subset of) lab-design stances in parallel.
 * Each stance produces ZERO or ONE LabConfigOption; the library
 * sorts surviving options by confidence DESC and returns a
 * LabPayload ready for twin_proposals(kind='lab_twin').lab_payload
 * persistence.
 *
 * Never throws. Soft-fails per stance + per stance-output coercion.
 * Returns a guaranteed-non-empty payload (fallback option when all
 * stances declined).
 */
export async function runLabOptions(
  input: RunLabOptionsInput,
): Promise<RunLabOptionsResult> {
  const startedAt = Date.now();
  const stances =
    input.stances && input.stances.length > 0
      ? input.stances
      : ALL_LAB_STANCE_IDS;
  const perStanceDuration: Partial<Record<LabStanceLensId, number>> = {};
  const failed: LabStanceLensId[] = [];
  const declined: LabStanceLensId[] = [];

  // ── Kick off all stance calls in parallel ────────────────────────
  // Each call soft-fails to a declined output (candidate_whole_lab=
  // null) on error so Promise.all never rejects.
  const stanceOutputs = await Promise.all(
    stances.map(async (lensId): Promise<LabStanceOutput> => {
      const t0 = Date.now();
      try {
        const { system, user } = buildLabStancePrompt(lensId, {
          inputText: input.inputText,
          chosenFramingContext: input.chosenFramingContext,
          subProblems: input.subProblems,
          candidateEntities: input.candidateEntities,
          subjectAccessHint: input.subjectAccessHint,
        });
        const raw = await llmJSON<unknown>({
          system,
          user,
          model: input.model,
          maxTokens: input.maxTokens ?? 1500,
          temperature: input.temperature ?? 0.4,
          fallback: {},
        });
        const out = validateLabStanceOutput(lensId, raw);
        perStanceDuration[lensId] = Date.now() - t0;
        if (out.candidate_whole_lab === null) {
          declined.push(lensId);
        }
        return out;
      } catch (err) {
        console.warn(`[lab-options] stance=${lensId} failed:`, err);
        failed.push(lensId);
        perStanceDuration[lensId] = Date.now() - t0;
        // Return a declined output so the rest of the pipeline
        // sees a uniform shape.
        return validateLabStanceOutput(lensId, null);
      }
    }),
  );

  // ── Collect surviving options ────────────────────────────────────
  const options: LabConfigOption[] = stanceOutputs
    .map((o) => o.candidate_whole_lab)
    .filter((o): o is LabConfigOption => o !== null);

  // ── Sort by confidence DESC, with deterministic tiebreaker ───────
  // Tiebreaker: lens_id alphabetically. This makes re-runs on the
  // same input produce the same chosen_rank=1 — important for
  // reproducibility + audit.
  options.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.lens_id.localeCompare(b.lens_id);
  });

  // ── Fallback when no stance produced a valid option ──────────────
  // All 5 declined OR all 5 LLM calls failed. We synthesize ONE
  // observational option so downstream (lab_scaffolds bridge, gate
  // page) still has something to materialize. The smallest_first_step
  // sentinel signals this is a fallback — the gate page renders a
  // "no real divergence" explainer instead of N comparison cards.
  let fallbackUsed = false;
  if (options.length === 0) {
    fallbackUsed = true;
    options.push(buildFallbackOption(input));
  }

  // ── Build the LabPayload ─────────────────────────────────────────
  // options[] is already sorted; chosen_rank=1 lands on the highest-
  // confidence option (or the fallback). rejected_options stays
  // empty for v0 — the user populates it via re-pick events.
  const payload: LabPayload = {
    options,
    chosen_rank: 1,
    rejected_options: [],
    generated_at: new Date().toISOString(),
  };

  const chosenLens = options[0]!.lens_id;

  return {
    payload,
    chosenLens,
    stats: {
      stances_called: [...stances],
      stances_failed: failed,
      stances_declined: declined,
      fallback_used: fallbackUsed,
      duration_ms: Date.now() - startedAt,
      per_stance_duration_ms: perStanceDuration,
    },
  };
}

// ── Internals ───────────────────────────────────────────────────────

/**
 * Synthesize a minimal lab option when all stances declined or all
 * LLM calls failed. Produces an observational design with weekly
 * cadence — the safest default that's compatible with any framing.
 *
 * The fallback's lens_id is "pragmatist" because that stance's
 * declining is rarest (it's the stance designed to always find a
 * feasible answer). Confidence is intentionally low (0.3) so the
 * gate page's "Narrative grounding" badge fires.
 */
function buildFallbackOption(input: RunLabOptionsInput): LabConfigOption {
  return {
    lab_id: "fallback_observational_weekly",
    lab_title: "Observational baseline",
    chosen_approach:
      "Fallback lab — no stance produced a sharp design for this framing. Default to weekly observational measurement against the user's stated outcome until the framing is refined.",
    design_type: "observational",
    subjects: [
      {
        name: "Self (or available cohort)",
        rationale:
          "Default subject when no stance proposed a specific cohort.",
      },
    ],
    features: ["baseline_tracking", "deviation_capture"],
    measurement_cadence: "weekly",
    duration_estimate_weeks: 8,
    primary_iv: { name: "Situation context (unspecified)" },
    primary_dv: { name: "Outcome (unspecified)" },
    when_it_wins:
      "Used when no stance-flavored option could be designed — re-run with a sharpened framing for better options.",
    when_it_fails:
      "Always — this is a placeholder, not a real lab design. The framing is too vague or the stances all declined.",
    confidence: 0.3,
    lens_id: "pragmatist",
  };
}
