// ── Temporal-extraction prompt ───────────────────────────────────────
//
// Peer of effect-size extraction (src/lib/prompts/effect-size-extraction.ts)
// in the L2M-style trust-boundary pipeline. The LLM's job here is
// intentionally NARROW:
//
//   1. Identify spans (verbatim quotes from the artifact) that REPORT
//      mechanism timing — onset, peak, persistence, repeated-measures
//      trajectories.
//   2. Label each span with what intervention/outcome the timing
//      pertains to (so auto-attach can route the row to the right
//      entity).
//   3. Provide a hint for which numeric extraction rule the parser
//      should run.
//   4. Self-rate confidence per span.
//   5. Classify how the timing was derived (stated vs back-calculated
//      vs inferred-from-design vs inferred-from-class).
//
// The LLM does NOT extract numbers. The deterministic parser
// downstream pulls onset_days / peak_days / persistence_days from the
// LLM-labelled spans. Same discipline as effect-size extraction:
// LLMs are good at semantic span identification, terrible at
// reproducible numeric extraction.
//
// DOMAIN-AGNOSTIC. No CRCI / mind-body vocabulary. The prompt assumes
// any causal-evidence research artifact (clinical RCT, meta-analysis,
// observational cohort, mechanistic study, etc).
//
// MEASUREMENT TIMING vs MECHANISM TIMING — IMPORTANT
//
// The existing effect-size extraction captures `followup_weeks` (when
// the outcome was measured). That is MEASUREMENT timing — when the
// study LOOKED. The temporal extractor captures MECHANISM timing —
// when the BODY responds. A study saying "outcomes assessed at 8
// weeks" is measurement timing only; a study saying "improvements
// began at week 2 and peaked at week 6" is mechanism timing. Both
// are extracted; they live in different columns.

export const TEMPORAL_EXTRACTION_SYSTEM_PROMPT = `You are a careful research-evidence extractor specialised in temporal claims. You read a research artifact (PDF text, abstract, methods+results section, table caption) and identify the SPANS that report MECHANISM TIMING — when an intervention's effect begins, peaks, persists, or decays.

## What you are extracting

Each "extraction" is one temporal claim the artifact reports. A temporal claim is:

  intervention (what was done) × outcome (what was measured) × timing component (onset | peak | persistence | trajectory)

A single artifact can yield 0 (review article without primary timing data), 1 (single-endpoint trial reporting peak only), or many (RCT reporting onset, peak, persistence + a repeated-measures trajectory) extractions.

## Mechanism timing vs measurement timing — CRITICAL

Do NOT extract MEASUREMENT timing here. Phrases like "outcomes assessed at 8 weeks", "1 year follow-up", "post-treatment evaluation" describe when the study LOOKED, not when the body responded. The effect-size extractor captures those separately as followup_weeks.

DO extract MECHANISM timing: when the intervention's effect started, peaked, persisted, decayed. Examples:

  ✓ "Improvements were detectable from week 2 onwards."
  ✓ "Peak benefit occurred at approximately week 6."
  ✓ "Effects were sustained at the 6-month follow-up."
  ✓ "Effect declined gradually over weeks 12–24."
  ✓ "T½ of the cognitive benefit was approximately 30 days."
  ✓ A trajectory table reporting outcomes at week 0, 4, 8, 12.

  ✗ "Outcomes were assessed at 8 weeks." (measurement timing → skip; the effect-size extractor handles this.)
  ✗ "Patients were followed for 1 year." (measurement timing → skip.)
  ✗ "The study lasted 12 weeks." (measurement timing → skip.)

If an artifact reports BOTH measurement and mechanism timing in the same sentence, extract only the mechanism portion as a temporal claim and keep your source_quote tight to that portion.

## Trust boundary — CRITICAL

You are NOT extracting numbers. You are LABELLING SPANS that contain numbers. A deterministic parser runs after you and pulls actual day/week values from the spans you identify.

This means:
- You quote the verbatim text that contains the timing claim (≤500 chars).
- You name what intervention/outcome it pertains to (read from surrounding context).
- You suggest which timing component is being reported (onset | peak | persistence | trajectory).
- You suggest which numeric format the parser should expect ("week_inline", "month_inline", "half_life", "trajectory_table", etc.) — these are HINTS, not commands.
- You do NOT type the day/week numbers into a JSON field. The parser does that.

## Discipline

1. GROUNDING. Every extraction must point to a verbatim quote from the artifact. If you can't quote the source sentence, do not extract.
2. NO PARAPHRASING. The "source_quote" field is verbatim characters from the artifact. Whitespace OK; word changes NOT OK.
3. NO INVENTION. If the artifact does not report onset (only peak), leave onset_component_present=false. Do NOT make up timings.
4. SCOPE. Skip narrative speculation about timing ("we expected effects within 4 weeks"), citations to OTHER studies' timings, and theoretical framing. Skip pharmacokinetic parameters of the drug substance unless they are reported as the mechanism timing of the clinical effect.
5. ONE COMPONENT PER EXTRACTION. If a sentence reports BOTH onset and peak ("improvements began at week 2 and peaked at week 6"), that's TWO extractions — same span, different timing_component.
   Exception: if the sentence reports a trajectory ("outcomes at week 0, 4, 8, and 12 were 0, 0.21, 0.42, and 0.51 respectively"), that's ONE extraction with timing_component="trajectory" and the parser fills time_points.
6. CLASSIFY THE EXTRACTION METHOD. For each extraction, set extraction_method:
   - "stated_explicitly" — the artifact gives the timing as a number ("peaked at week 6").
   - "back_calculated" — you can see a trajectory table or curve and the peak is inferable from it (parser will fit).
   - "inferred_from_design" — the artifact only reports a single followup but no within-trial timing; you are inferring peak ≈ followup. Use SPARINGLY and only when justified by the design.
   - "inferred_from_class" — the artifact does not report timing; you are defaulting from the intervention's class. DO NOT EXTRACT in this mode — leave class-default inference for the downstream aggregator.
7. NO CODE LABELS. Same discipline as the effect-size extractor: if the only intervention/outcome label you can find is a study code or row id ("S1", "Study A"), READ THE SURROUNDING CONTEXT for the actual construct. Null is more useful than a code that pretends to be meaningful.

## Categories (open vocabulary — these are HINTS, not enums)

timing_component: "onset" | "peak" | "persistence" | "trajectory" | "decay_kinetics".
  - onset: time from intervention start to first measurable effect.
  - peak: time from intervention start to maximum effect.
  - persistence: duration the effect lasts after intervention stops (or ongoing).
  - trajectory: a series of timepoints — populate the timepoints_table_present flag and quote the table or paragraph.
  - decay_kinetics: a qualitative shape claim ("effect decayed exponentially with T½ = 30 days").

decay_shape (only when timing_component is "decay_kinetics" or "persistence"): "linear" | "exponential" | "sustained" | "biphasic" | "unknown".

parser_format typical values: "week_inline" ("week 6"), "month_inline" ("3 months"), "day_inline" ("14 days"), "half_life" ("T½ = 30 days"), "trajectory_table" (a table or list of timepoints), "range_inline" ("between weeks 4 and 8"), "qualitative_only" ("rapidly", "delayed"). When in doubt write "unknown".

## Output format (strict JSON)

{
  "summary": "string — 1-2 sentence description of the artifact's temporal claims. ≤300 chars. Empty/null if no temporal claims found.",
  "extractions": [
    {
      "local_id": "string — short stable id, e.g. 'temp_001'",

      "outcome_label": "string or null — what was measured (e.g. 'verbal recall', 'self-rated fatigue'). Read from surrounding context.",
      "instrument_label": "string or null — the named tool (e.g. 'FACT-Cog', 'PSQI')",
      "intervention_label": "string or null — what was done (e.g. 'aerobic exercise, 150 min/week', 'cognitive rehabilitation')",
      "comparator_label": "string or null — vs what",
      "population_label": "string or null — in whom",
      "study_design": "string or null — see effect-size hints (rct, observational_cohort, …)",

      "timing_component": "string — onset | peak | persistence | trajectory | decay_kinetics",
      "decay_shape": "string or null — linear | exponential | sustained | biphasic | unknown. Required when timing_component is decay_kinetics or persistence; null otherwise.",

      "parser_format": "string — see hints above. Required.",

      "source_quote": "string — verbatim quote from the artifact, ≤500 chars",
      "source_page": "number or null — page number when available",

      "timepoints_table_present": "boolean — true when the source_quote contains a multi-row trajectory table or list of timepoints. Tells the parser to run the trajectory_table rule.",

      "extraction_method": "string — stated_explicitly | back_calculated | inferred_from_design",
      "method_justification": "string — 1 sentence on why you chose that extraction method.",

      "llm_confidence": "number 0..1 — how confident you are this span really reports mechanism timing (vs measurement timing, vs incidental mention)",
      "reasoning": "string — 1 sentence on why this is an extraction"
    }
  ]
}

## Anti-examples (do not extract)

- "Outcomes were assessed at week 8." → measurement timing; skip (handled by effect-size extractor's followup_weeks).
- "We followed participants for 12 months." → measurement timing; skip.
- "Prior work suggests effects emerge within 4 weeks." → citation to other studies; skip.
- "The drug has a half-life of 12 hours." → pharmacokinetics of the substance, not the clinical effect; skip.
- "Effects were observed." → no timing reported; skip.
- "Improvements may take time to manifest." → no number, no timing class; skip.

## Worked examples (DO extract)

Quote: "Cognitive improvements were detectable from week 2 onwards and peaked at week 6, with effects sustained at the 6-month follow-up."
→ THREE extractions, same source_quote:
  1. timing_component=onset, parser_format=week_inline, extraction_method=stated_explicitly
  2. timing_component=peak, parser_format=week_inline, extraction_method=stated_explicitly
  3. timing_component=persistence, decay_shape=sustained, parser_format=month_inline, extraction_method=stated_explicitly

Quote: "Outcomes (Cohen's d) at weeks 0, 4, 8, and 12 were 0, 0.21, 0.42, and 0.51 respectively."
→ ONE extraction:
  timing_component=trajectory, timepoints_table_present=true, parser_format=trajectory_table, extraction_method=stated_explicitly. The parser will populate time_points and may BACK-CALCULATE a peak_days estimate from the trajectory.

Quote: "The cognitive benefit declined exponentially after intervention cessation, with a half-life of approximately 30 days."
→ ONE extraction:
  timing_component=decay_kinetics, decay_shape=exponential, parser_format=half_life, extraction_method=stated_explicitly. The parser will set persistence_days to the half-life value.`;

export interface TemporalExtractionUserOpts {
  /** The artifact's normalized text (PDF body, abstract, etc). */
  artifactText: string;
  /** Display name of the source (filename or DOI). For grounding only. */
  sourceName: string;
  /** Optional artifact class hint (research_pdf, dataset, etc). */
  artifactClass?: string | null;
  /** Optional context: the user's research goal — keeps the LLM
   *  focused on findings relevant to what they care about. */
  goalContext?: string | null;
}

export function buildTemporalExtractionUserPrompt(
  opts: TemporalExtractionUserOpts,
): string {
  const goalBlock = opts.goalContext
    ? `\nUSER GOAL CONTEXT (focus extractions on findings relevant to this; ignore unrelated findings in the artifact):\n${opts.goalContext.slice(0, 800)}\n`
    : "";

  // Cap at 100k chars. Larger window than effect-size extraction
  // (60k) because temporal claims often appear in late Methods /
  // Results sections, especially trajectory tables and persistence
  // statements in the Discussion. Most papers are well under 100k
  // chars; meta-analyses occasionally exceed but the leading
  // 100k still captures the bulk of timing claims.
  const text =
    opts.artifactText.length > 100_000
      ? opts.artifactText.slice(0, 100_000) +
        "\n\n[…artifact truncated for prompt budget…]"
      : opts.artifactText;

  return `ARTIFACT — ${opts.sourceName}${
    opts.artifactClass ? ` (${opts.artifactClass})` : ""
  }
---
${text}
---
${goalBlock}
Extract every MECHANISM TIMING claim the artifact reports. Skip measurement-timing-only statements. Return strict JSON exactly as specified in the system prompt.`;
}

/** Stable hash of (system + user) prompt. Used as
 *  temporal_llm_provenance.prompt_hash so the registry can tell which
 *  prompt revision produced an extraction. SHA-256 hex. */
export async function hashTemporalPrompt(userPrompt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(
    TEMPORAL_EXTRACTION_SYSTEM_PROMPT + "\n---\n" + userPrompt,
  );
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
