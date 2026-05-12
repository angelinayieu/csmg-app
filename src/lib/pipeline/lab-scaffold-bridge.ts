// ── Lab Scaffold Materialization Bridge (Phase 2 / Week 4 / W4.11) ──
//
// TIER: 3 (situation-specialized causal model) — connects the new
//       lab_twin diverge-converge layer to the existing lab_scaffolds
//       single-row commitment layer.
//
// What this bridge does:
//   When a lab_twin row's user_status flips proposed → approved, this
//   bridge derives a lab_scaffolds row (status='proposed') from the
//   chosen LabConfigOption. The existing canvas-lab-proposal-chip
//   polls for status='proposed' lab_scaffolds rows, opens the
//   LabProposalWizard, and materializes subjects on approval.
//
// Why this exists (Layer-on-top architecture per the W4 validation
// audit):
//   The validation audit found two existing systems we MUST NOT
//   orphan:
//     1. canvas-lab-proposal-chip + LabProposalWizard
//     2. lab_scaffolds → subjects materialization pipeline
//
//   These both expect a status='proposed' lab_scaffolds row to act
//   on. Layer-on-top means lab_twin is the NEW upstream picker; on
//   approval, we derive ONE lab_scaffolds row pre-filled from the
//   chosen LabConfigOption. The existing wizard then takes over for
//   final subject materialization. No code-path duplication, no
//   double chip showing.
//
// Soft-fail discipline:
//   The bridge logs errors but doesn't roll back the lab_twin
//   approval. The approval is the user's intent — if the bridge
//   fails, the lab_twin row stays approved and the canvas-lab-
//   proposal-chip can re-trigger on next render. Worst case the
//   user manually re-fires lab generation.
//
// Idempotency:
//   Each call inserts one fresh lab_scaffolds row + supersedes any
//   prior status='proposed' rows for the same space. Re-running the
//   bridge produces a single status='proposed' row (the most recent)
//   + N status='superseded' rows in the audit trail.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LabConfigOption } from "@/types/lab-options";
import type {
  ProposedSubject,
  ProposedFeature,
} from "@/types/subject";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── ProposedFeature.id allowed values (must match the type union) ──
//
// The v1 wizard supports a closed enum of feature slugs. Lab stance
// outputs can include other slugs (baseline_tracking, deviation_
// capture, game, etc.) which the bridge filters out — they'll be
// recorded in proposed_parameters.feature_slugs_extended so they're
// not lost from the audit trail, just not wizard-visible.
const WIZARD_VISIBLE_FEATURES: readonly ProposedFeature["id"][] = [
  "monte_carlo",
  "what_if",
  "ab_compare",
  "deepen_kg",
];

function isWizardFeature(slug: string): slug is ProposedFeature["id"] {
  return (WIZARD_VISIBLE_FEATURES as readonly string[]).includes(slug);
}

// ── Public types ────────────────────────────────────────────────────

export interface BridgeInput {
  spaceId: string;
  userId: string;
  /** The lab_twin row's id (twin_proposals.id) for provenance. */
  twinProposalId: string;
  /** The chosen LabConfigOption. */
  chosenOption: LabConfigOption;
  /** Optional run_id for provenance + future SSE event emission. */
  pipelineRunId?: string | null;
}

export interface BridgeResult {
  ok: boolean;
  /** The new lab_scaffolds.id, or null on failure. */
  scaffoldId: string | null;
  /** Count of prior status='proposed' rows that got superseded. */
  supersededCount: number;
  errors: string[];
}

/**
 * Derive a lab_scaffolds row payload from the chosen LabConfigOption.
 * Pure function — exposed for tests + composability. The caller
 * decides whether to persist it.
 */
export function deriveLabScaffold(input: BridgeInput): {
  space_id: string;
  user_id: string;
  proposed_subjects: ProposedSubject[];
  proposed_features: ProposedFeature[];
  proposed_parameters: Record<string, unknown>;
  status: "proposed";
  pipeline_run_id: string | null;
} {
  const opt = input.chosenOption;

  // Map LabConfigOption.subjects → ProposedSubject[].
  // The wizard's ProposedSubject shape is richer than what the stance
  // emits. We map what we can; the wizard fills in the rest from
  // user input (suggested_scope_system_id, suggested_conditions, etc.).
  //
  // focus_kind: default to "topic" — the LLM doesn't emit focus_kind
  // today. Users can change this in the wizard. "topic" is the
  // safest default for a freshly-named cohort.
  //
  // artifact_state: default to "bare_topic" — same rationale. Users
  // signal whether they have a partial or complete artifact later.
  const proposedSubjects: ProposedSubject[] = opt.subjects.map((s) => ({
    focus_kind: "topic" as const,
    focus_label: s.name.slice(0, 120),
    name: s.name.slice(0, 120),
    description: s.rationale ? s.rationale.slice(0, 600) : undefined,
    artifact_state: "bare_topic" as const,
    rationale: s.rationale ? s.rationale.slice(0, 400) : undefined,
  }));

  // Map LabConfigOption.features → ProposedFeature[].
  // Filter to wizard-visible feature slugs. Stance-specific extras
  // (baseline_tracking, deviation_capture, game, ml_personalization)
  // land in proposed_parameters.feature_slugs_extended for audit.
  const visibleFeatures: ProposedFeature[] = [];
  const extendedFeatures: string[] = [];
  for (const slug of opt.features) {
    if (isWizardFeature(slug)) {
      visibleFeatures.push({
        id: slug,
        default_on: true,
        rationale: `Proposed by the ${opt.lens_id.replace(/_/g, " ")} stance.`,
      });
    } else {
      extendedFeatures.push(slug);
    }
  }

  // proposed_parameters captures the lab-design metadata that the
  // wizard can read for its preview + the future execution-brief
  // generator (W4.12) will consume.
  const proposedParameters: Record<string, unknown> = {
    design_type: opt.design_type,
    measurement_cadence: opt.measurement_cadence,
    duration_estimate_weeks: opt.duration_estimate_weeks,
    primary_iv: opt.primary_iv,
    primary_dv: opt.primary_dv,
    when_it_wins: opt.when_it_wins,
    when_it_fails: opt.when_it_fails,
    lens_id: opt.lens_id,
    lab_title: opt.lab_title,
    confidence: opt.confidence,
    // Provenance — link back to the lab_twin so downstream code can
    // query "what was the lab_twin that produced this scaffold?"
    source_lab_twin_proposal_id: input.twinProposalId,
    source_lab_id: opt.lab_id,
    // Feature slugs not in the v1 wizard enum but still captured.
    feature_slugs_extended: extendedFeatures,
  };

  return {
    space_id: input.spaceId,
    user_id: input.userId,
    proposed_subjects: proposedSubjects,
    proposed_features: visibleFeatures,
    proposed_parameters: proposedParameters,
    status: "proposed",
    pipeline_run_id: input.pipelineRunId ?? null,
  };
}

/**
 * Persist a lab_scaffolds row derived from the chosen LabConfigOption.
 * Supersedes any prior status='proposed' rows for the space so the
 * canvas-lab-proposal-chip always sees ONE actionable row.
 *
 * Never throws — accumulates errors in the result object.
 */
export async function persistLabScaffold(
  db: AnyDb,
  input: BridgeInput,
): Promise<BridgeResult> {
  const errors: string[] = [];

  // ── Supersede any prior status='proposed' rows ──────────────────
  // The existing chip polls for proposed rows; if multiple exist,
  // the chip would surface the first it finds, which may not be the
  // one tied to the latest lab_twin approval. Sweep prior ones to
  // 'superseded' before the insert so there's exactly one
  // actionable row at any time.
  let supersededCount = 0;
  try {
    const { data: supersededRows, error: supersedeErr } = await db
      .from("lab_scaffolds")
      .update({ status: "superseded" })
      .eq("space_id", input.spaceId)
      .eq("user_id", input.userId)
      .eq("status", "proposed")
      .select("id");
    if (supersedeErr) {
      errors.push(
        `supersede prior lab_scaffolds failed: ${supersedeErr.message ?? "(unknown)"}`,
      );
    } else if (Array.isArray(supersededRows)) {
      supersededCount = (supersededRows as Array<unknown>).length;
    }
  } catch (err) {
    errors.push(
      `supersede prior lab_scaffolds threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Insert the new row ──────────────────────────────────────────
  const payload = deriveLabScaffold(input);
  try {
    const { data, error: insertErr } = await db
      .from("lab_scaffolds")
      .insert(payload)
      .select("id")
      .single();
    if (insertErr || !data) {
      errors.push(
        `lab_scaffolds insert failed: ${insertErr?.message ?? "(unknown)"}`,
      );
      return {
        ok: false,
        scaffoldId: null,
        supersededCount,
        errors,
      };
    }
    return {
      ok: true,
      scaffoldId: (data as { id: string }).id,
      supersededCount,
      errors,
    };
  } catch (err) {
    errors.push(
      `lab_scaffolds insert threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      ok: false,
      scaffoldId: null,
      supersededCount,
      errors,
    };
  }
}
