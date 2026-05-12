// ── Chosen problem framing loader ────────────────────────────────────
//
// Shared helper for downstream pipeline stages that want to condition
// their work on the problem framing the user (or the auto-approve)
// picked. Reads the latest approved twin_proposals row with
// kind='problem_twin' for a space and returns the chosen option from
// frame_payload.options[chosen_rank - 1].
//
// Used by:
//   - propose-plan (KG plan generator's user prompt)
//   - strategy-engine (diagnosis + synthesis prompts)
//
// Soft-fail contract: every consumer must keep working when this
// returns null. Reasons it might return null:
//   - frame-panel never ran for this space (no problem_twin row)
//   - the row exists but frame_payload is malformed
//   - the chosen_rank points past the end of options[] (defensive)
//   - the row's smallest_first_step is true (fallback merged frame
//     with no real divergence — return null because there's nothing
//     meaningful for the downstream LLM to condition on)
//
// formatChosenFramingForPrompt is the canonical way to inject the
// framing into an LLM system or user prompt block — keeps wording
// consistent across consumers.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface ChosenFraming {
  /** twin_proposals.id of the source row. Lets callers audit which
   *  approval the framing came from. */
  proposal_id: string;
  /** Snake_case slug, e.g. 'mechanism_bottleneck'. */
  framing_id: string;
  /** 2-5 word headline. */
  framing_title: string;
  /** 1-2 sentence "the real problem this lens sees." */
  chosen_approach: string;
  /** What falls apart if this framing is wrong. */
  load_bearing_assumption: string;
  /** Short phrase — when this framing wins. */
  when_it_wins: string;
  /** Short phrase — when this framing fails. */
  when_it_fails: string;
  /** Concrete sub-problems implied by this framing. */
  sub_objectives: string[];
  /** 0..1 confidence the lens reported. */
  confidence: number;
  /** Lens(es) that backed this framing. Length 1 in the divergent
   *  path; length N in the fallback merged-frame path. */
  supporting_lenses: string[];
  /** 1-indexed rank within the proposal's options[]. Always >=1
   *  when this is non-null. */
  chosen_rank: number;
  /** Total options available for picking. Tells the LLM how big the
   *  divergence cloud was — useful context for "how committed
   *  should I be to this framing?" */
  option_count: number;
}

interface FramePayloadOption {
  framing_id: string;
  framing_title: string;
  chosen_approach: string;
  load_bearing_assumption: string;
  proposed_axes: unknown[];
  supporting_lenses: string[];
  why_this_framing: string;
  when_it_wins: string;
  when_it_fails: string;
  sub_objectives: string[];
  confidence: number;
}

interface FramePayload {
  options: FramePayloadOption[];
  chosen_rank: number;
  rejected_options: unknown[];
  framed_at: string;
  smallest_first_step: boolean;
}

/** Load the chosen framing for this space. Returns null if no usable
 *  framing exists (no row, malformed payload, fallback-only, etc.).
 *  Never throws — wraps the DB call in try/catch so a transient
 *  Supabase hiccup doesn't break the downstream pipeline. */
export async function loadChosenFramingForSpace(
  db: AnyDb,
  spaceId: string,
  userId: string,
): Promise<ChosenFraming | null> {
  try {
    const { data: rawRow, error } = await db
      .from("twin_proposals")
      .select("id, frame_payload, kind, user_status")
      .eq("space_id", spaceId)
      .eq("user_id", userId)
      .eq("kind", "problem_twin")
      .eq("user_status", "approved")
      .order("approved_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(
        "[load-chosen-framing] query failed (returning null):",
        error.message ?? error,
      );
      return null;
    }
    if (!rawRow) return null;

    const row = rawRow as { id: string; frame_payload: FramePayload | null };
    const payload = row.frame_payload;

    if (!payload || !Array.isArray(payload.options) || payload.options.length === 0) {
      return null;
    }

    // Fallback-only rows don't have a meaningful divergence; the
    // synthetic single option is just a re-statement of the merged
    // frame, which downstream stages already have via
    // spaces.situation_frame. Returning null here keeps prompts
    // clean (no padding) when the lens panel didn't produce real
    // competing framings.
    if (payload.smallest_first_step) return null;

    // Clamp chosen_rank to valid bounds (defensive against bad data)
    const rank = Math.max(1, Math.min(payload.options.length, payload.chosen_rank ?? 1));
    const opt = payload.options[rank - 1];
    if (!opt) return null;

    return {
      proposal_id: row.id,
      framing_id: opt.framing_id,
      framing_title: opt.framing_title,
      chosen_approach: opt.chosen_approach,
      load_bearing_assumption: opt.load_bearing_assumption,
      when_it_wins: opt.when_it_wins,
      when_it_fails: opt.when_it_fails,
      sub_objectives: opt.sub_objectives,
      confidence: opt.confidence,
      supporting_lenses: opt.supporting_lenses,
      chosen_rank: rank,
      option_count: payload.options.length,
    };
  } catch (err) {
    console.warn(
      "[load-chosen-framing] threw (returning null):",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Format the chosen framing as a prompt block for downstream LLMs.
 *  Returns an empty string when framing is null so callers can
 *  unconditionally concatenate without an `if`.
 *
 *  Why this shape: every downstream stage reads the same block in the
 *  same place — prevents per-stage prompt drift. The phrasing tells
 *  the LLM that this is the USER'S PICK (not a suggestion) and that
 *  it must condition its work on this framing, not re-derive the
 *  problem from scratch.
 *
 *  Three variants depending on caller intent — pass `variant` to pick:
 *    - "plan": for the plan-generator (what KG to build for this
 *      framing). Emphasizes axes + ontology should serve the framing.
 *    - "diagnosis": for strategy-engine's getDiagnosisPrompt.
 *      Emphasizes that the diagnosis should refine, not replace,
 *      this framing's core_problem statement.
 *    - "synthesis": for strategy-engine's getSynthesisPrompt.
 *      Emphasizes that proposed strategies must target the
 *      sub-objectives the framing names. */
export function formatChosenFramingForPrompt(
  framing: ChosenFraming | null,
  variant: "plan" | "diagnosis" | "synthesis" = "plan",
): string {
  if (!framing) return "";

  const subProblemsBlock =
    framing.sub_objectives.length > 0
      ? `\nSub-problems this framing decomposes into:\n${framing.sub_objectives.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`
      : "";

  const lensAttribution =
    framing.supporting_lenses.length > 0
      ? ` (backed by: ${framing.supporting_lenses.join(", ")})`
      : "";

  const divergenceContext =
    framing.option_count > 1
      ? `Picked rank ${framing.chosen_rank} of ${framing.option_count} candidate framings.`
      : "Single framing available.";

  const variantDirective = (() => {
    switch (variant) {
      case "plan":
        return "Build the KG plan AROUND this framing. The layer ontology and axis proposals you generate must serve this problem statement — they are the analytical scaffolding for THIS framing, not a generic decomposition of the user's prompt.";
      case "diagnosis":
        return "Your structural diagnosis must REFINE this framing — adding causal precision, naming specific bottlenecks, identifying convergent root causes — not REPLACE it with a different problem statement. If the KG structure genuinely contradicts this framing, flag it as a divergence; do not silently re-frame.";
      case "synthesis":
        return "Every strategy option you propose must target the sub-problems this framing names. Strategies that solve a DIFFERENT problem (no matter how plausible) are off-contract here — the user picked THIS framing as the one they want anchored.";
    }
  })();

  return `## CHOSEN PROBLEM FRAMING (locked by user)${lensAttribution}

${divergenceContext}

Framing: ${framing.framing_title}
Confidence: ${(framing.confidence * 100).toFixed(0)}%

Chosen approach:
${framing.chosen_approach}

Load-bearing assumption (if WRONG, this framing collapses):
${framing.load_bearing_assumption}

When this framing wins: ${framing.when_it_wins}
When this framing fails: ${framing.when_it_fails}
${subProblemsBlock}

Directive:
${variantDirective}`;
}
