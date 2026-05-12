// ── Chosen-Lab loader + prompt formatter (Phase 2 / Week 4 / W4.12) ──
//
// TIER: 3 (situation-specialized causal model) — provides the
//       committed lab-design context to downstream stages so the
//       lab pick has TEETH (changes what execution-brief produces +
//       what generate-apps materializes).
//
// What this library does:
//   Loads the user-approved lab_twin for a space and returns the
//   chosen LabConfigOption. Also provides a prompt-ready formatter
//   so consumers (execution-brief, generate-apps, etc.) can append
//   the lab context to their LLM system prompts uniformly.
//
// Why this exists:
//   Sprint W4.10 shipped the gate page where users pick a lab.
//   Sprint W4.11 shipped the auto-fire + scaffold bridge.
//   Without W4.12, picking a different lab is visible-but-inert —
//   execution-brief and generate-apps don't read the lab context, so
//   the user's pick doesn't influence what apps materialize. This
//   library is the missing piece that makes the lab pick actually
//   matter.
//
// Soft-fail everywhere:
//   Returns null when no approved lab_twin exists (legacy spaces,
//   user disabled runLab, race condition). Callers degrade
//   gracefully — the prompt block becomes empty, the LLM proceeds
//   without lab conditioning.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LabConfigOption,
  LabPayload,
  LabDesignType,
  LabMeasurementCadence,
} from "@/types/lab-options";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── Loader ──────────────────────────────────────────────────────────

export interface LoadedLab {
  /** The twin_proposals.id of the approved lab_twin row. */
  proposalId: string;
  /** When the user approved (or auto-approved) the lab. */
  approvedAt: string | null;
  /** The chosen lab option (lab_payload.options[chosen_rank - 1]). */
  option: LabConfigOption;
}

/**
 * Load the user-approved lab_twin for a space. Returns null when no
 * approved row exists (legacy spaces / runLab disabled / no strategy
 * yet). Never throws.
 *
 * @param db — Supabase client (server-side)
 * @param spaceId — UUID of the space
 * @param userId — UUID of the owner (for RLS-safe owner-scoped query)
 */
export async function loadChosenLabForSpace(
  db: AnyDb,
  spaceId: string,
  userId: string,
): Promise<LoadedLab | null> {
  try {
    const { data, error } = await db
      .from("twin_proposals")
      .select("id, lab_payload, approved_at")
      .eq("space_id", spaceId)
      .eq("user_id", userId)
      .eq("kind", "lab_twin")
      .eq("user_status", "approved")
      .order("approved_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(
        "[load-chosen-lab] query failed:",
        error.message ?? error,
      );
      return null;
    }
    if (!data) return null;

    const row = data as {
      id: string;
      lab_payload: LabPayload | null;
      approved_at: string | null;
    };
    const payload = row.lab_payload;
    if (!payload || !Array.isArray(payload.options) || payload.options.length === 0) {
      return null;
    }

    const chosenIndex = Math.max(
      0,
      Math.min(payload.options.length - 1, (payload.chosen_rank ?? 1) - 1),
    );
    const option = payload.options[chosenIndex];
    if (!option) return null;

    return {
      proposalId: row.id,
      approvedAt: row.approved_at,
      option,
    };
  } catch (err) {
    console.warn(
      "[load-chosen-lab] threw:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ── Prompt formatter ────────────────────────────────────────────────

const DESIGN_TYPE_LABEL: Record<LabDesignType, string> = {
  rct: "Randomized Controlled Trial",
  observational: "Observational",
  single_subject: "N-of-1 / Single Subject",
  sequential: "Sequential / Adaptive",
  ab_compare: "A/B Comparison",
  what_if: "Counterfactual Simulation",
  mixed_methods: "Mixed Methods",
};

const CADENCE_LABEL: Record<LabMeasurementCadence, string> = {
  daily: "daily",
  weekly: "weekly",
  biweekly: "biweekly",
  monthly: "monthly",
  event_triggered: "on event",
};

/**
 * Format a chosen lab option as a system-prompt block. Designed to
 * append to existing LLM system prompts so the model knows what
 * experimental architecture its output must align with.
 *
 * Returns "" when no lab is provided — caller appends the block
 * unconditionally and gets either the lab context or nothing.
 *
 * Example output:
 *
 *   CHOSEN LAB DESIGN (the user-approved experimental architecture
 *   your output MUST align with):
 *
 *     • Design type: Sequential / Adaptive (chosen by the Adaptive
 *       Designer stance)
 *     • Primary IV → DV: caffeine_dose → reaction_time_p50
 *     • Measurement cadence: weekly, over ~12 weeks
 *     • Subjects: 1 cohort
 *       - Adults 25-45 with self-reported PSQI > 5 (~30 subjects)
 *     • Features enabled: monte_carlo, deviation_capture
 *     • When this lab design wins: …
 *     • When this lab design fails: …
 *
 *   Your output should respect this architecture: don't propose
 *   subjects that contradict the cohort scope, don't propose features
 *   the lab doesn't include, and target the primary IV/DV when
 *   possible.
 */
export function formatChosenLabForPrompt(
  lab: LoadedLab | null,
): string {
  if (!lab) return "";

  const opt = lab.option;
  const designLabel = DESIGN_TYPE_LABEL[opt.design_type] ?? opt.design_type;
  const cadenceLabel = CADENCE_LABEL[opt.measurement_cadence] ?? opt.measurement_cadence;
  const stanceLabel = opt.lens_id.replace(/_/g, " ");

  const subjectLines = opt.subjects.length > 0
    ? opt.subjects.slice(0, 4).map((s) => {
        const countSuffix = s.estimated_count ? ` (~${s.estimated_count})` : "";
        return `      - ${s.name.slice(0, 120)}${countSuffix}`;
      })
    : ["      (no specific cohorts proposed — defaults to whoever the user has access to)"];

  const featuresLine = opt.features.length > 0
    ? opt.features.join(", ")
    : "(none specified)";

  return [
    "CHOSEN LAB DESIGN (the user-approved experimental architecture your output MUST align with):",
    "",
    `  • Design type: ${designLabel} (chosen by the ${stanceLabel} stance)`,
    `  • Lab title: ${opt.lab_title}`,
    `  • Primary IV → DV: ${opt.primary_iv.name} → ${opt.primary_dv.name}`,
    `  • Measurement cadence: ${cadenceLabel}, over ~${opt.duration_estimate_weeks} weeks`,
    `  • Subjects: ${opt.subjects.length} ${opt.subjects.length === 1 ? "cohort" : "cohorts"}`,
    ...subjectLines,
    `  • Features enabled: ${featuresLine}`,
    opt.when_it_wins ? `  • When this lab design wins: ${opt.when_it_wins}` : "",
    opt.when_it_fails ? `  • When this lab design fails: ${opt.when_it_fails}` : "",
    "",
    "Your output should respect this architecture: don't propose subjects that contradict the cohort scope, don't propose features the lab doesn't include, and target the primary IV/DV when possible. If the chosen lab is fundamentally wrong-fit for what you'd recommend, surface that as a 'lab_mismatch' warning in your output rather than silently overriding it.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Convenience: load + format in one call. Returns "" when no lab.
 * Useful for prompt builders that want an unconditional append.
 */
export async function loadAndFormatChosenLab(
  db: AnyDb,
  spaceId: string,
  userId: string,
): Promise<string> {
  const lab = await loadChosenLabForSpace(db, spaceId, userId);
  return formatChosenLabForPrompt(lab);
}
