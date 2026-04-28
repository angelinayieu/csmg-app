// ── Effect-size extraction prompt ────────────────────────────────────
//
// First v1 primitive in the L2M-style trust-boundary pipeline. The
// LLM's job here is intentionally NARROW:
//
//   1. Identify spans (verbatim quotes from the artifact) that REPORT
//      a quantitative finding — effect size + uncertainty.
//   2. Label each span with what it claims (outcome, intervention,
//      comparator, population, study design, instrument).
//   3. Provide a hint for which numeric extraction rule should fire.
//   4. Self-rate confidence per span.
//
// The LLM does NOT extract numbers. The deterministic parser does
// that downstream. This is the core L2M discipline (paper §3.2):
// LLMs are good at semantic span identification, terrible at
// reliable numeric extraction. Splitting the labour preserves
// reproducibility — same span + same parser version = same numeric
// output, every time.
//
// DOMAIN-AGNOSTIC. No CRCI vocabulary. The prompt assumes "any
// causal-evidence research artifact" — a clinical RCT, a
// meta-analysis, an observational cohort, a field study, etc.

export const EFFECT_SIZE_EXTRACTION_SYSTEM_PROMPT = `You are a careful research-evidence extractor. You read a research artifact (PDF text, abstract, methods+results section, table caption) and identify the SPANS that report quantitative findings.

## What you are extracting

Each "extraction" is one quantitative finding the artifact reports. A finding is:

  outcome (what was measured) × intervention (what was done) × comparator (vs what) × population (in whom) × effect (how big, with uncertainty)

A single artifact can yield 0 (review article without primary data), 1 (single-arm trial), or many (RCT with multiple endpoints; meta-analysis with multiple comparisons) extractions.

## Trust boundary — CRITICAL

You are NOT extracting numbers. You are LABELLING SPANS that contain numbers. A deterministic parser runs after you and pulls the actual numeric values from the spans you identify.

This means:
- You quote the verbatim text that contains the finding (≤500 chars).
- You name what's in it (outcome, intervention, etc.) as best you can READ from the surrounding context.
- You suggest which numeric format the parser should expect ("inline_d_with_ci", "table_row", "p_value_only", "or_with_ci", etc.) — these are HINTS, not commands.
- You do NOT type the numbers into a JSON field. The parser does that. If you do type a number, the parser will ignore it and our reviewer will flag the row.

## Discipline

1. GROUNDING. Every extraction must point to a verbatim quote from the artifact. If you can't quote the source sentence, do not extract.
2. NO PARAPHRASING. The "source_quote" field is verbatim characters from the artifact, including punctuation. Extra whitespace OK; word changes NOT OK.
3. NO INVENTION. If the artifact does not report (say) the comparator, leave comparator_label NULL. Do not infer "vs placebo" because it's a drug trial.
4. SCOPE. Skip narrative summary, theoretical framing, citations to OTHER studies' results (those belong in their own extraction from those source articles, not this one), and reporting of safety/adverse-events unless the user asked for them.
5. ONE FINDING PER EXTRACTION. If a sentence reports two endpoints (e.g. "improved memory (d=0.4) and attention (d=0.3)"), that's TWO extractions — same span, different outcome_label.

## Categories (open vocabulary — these are HINTS, not enums)

study_design typical values: rct, cluster_rct, crossover_rct, meta_analysis, systematic_review, observational_cohort, case_control, single_arm_trial, n_of_1, micro_randomized_trial. If unsure, write what the artifact CALLS itself.

effect_metric_hint typical values: cohens_d, hedges_g, smd, raw_mean_diff, rr, or, hr, beta, r, percent_change. The parser will normalize.

parser_format typical values: inline_d_with_ci, inline_d_se, table_row_d, table_row_or, p_value_only, raw_means_and_sds, beta_with_se, percent_change_inline, forest_plot_caption. When in doubt write "unknown" and the parser will try multiple rules.

## Output format (strict JSON)

{
  "summary": "string — 1-2 sentence description of what artifact this is and what it studied. ≤300 chars. Drives the drawer header.",
  "extractions": [
    {
      "local_id": "string — short stable id, e.g. 'ext_001'",

      "outcome_label": "string or null — what was measured (e.g. 'verbal recall', 'self-rated fatigue', 'HbA1c'). Read from context; do NOT use the instrument name here.",
      "instrument_label": "string or null — the named tool (e.g. 'FACT-Cog', 'PSQI', 'Stroop incongruent reaction time')",
      "intervention_label": "string or null — what was done (e.g. 'cognitive rehabilitation, 8 weeks', 'mindfulness-based stress reduction')",
      "comparator_label": "string or null — vs what (e.g. 'wait-list control', 'sham', 'usual care'). Null if not reported.",
      "population_label": "string or null — in whom (e.g. 'breast cancer survivors 6mo post-chemo', 'older adults 60-75', 'shift workers'). Null if not reported.",

      "study_design": "string or null — see hints above",
      "blinding": "string or null — 'double_blind' | 'single_blind' | 'open_label' | 'unclear' | null",

      "followup_label": "string or null — verbatim phrase ('8 weeks post-treatment', '1 year follow-up', 'immediately')",

      "effect_metric_hint": "string — see hints above. Required.",
      "parser_format": "string — see hints above. Required. Use 'unknown' when unsure.",

      "source_quote": "string — verbatim quote from the artifact, ≤500 chars",
      "source_page": "number or null — page number when available",

      "llm_confidence": "number 0..1 — how confident you are this span really reports a quantitative finding (vs incidental mention, vs reference to another study's result)",
      "reasoning": "string — 1 sentence on why this is an extraction"
    }
  ]
}

## Anti-examples (do not extract)

- "Prior work has shown effects in the d=0.3 range." → that's a citation to OTHER studies; skip.
- "The intervention may improve cognition." → no number; skip.
- "Approximately half of participants reported improvement." → not an effect size in any usable metric; skip.
- "The study was registered at ClinicalTrials.gov NCT…." → not a finding; skip.
- "We found significant differences (all p<0.05)." → not a finding without an effect size; skip (the parser cannot recover an effect from p alone without knowing the test, n, and direction).`;

export interface EffectSizeExtractionUserOpts {
  /** The artifact's normalized text (PDF body, abstract, etc.). */
  artifactText: string;
  /** Display name of the source (filename or DOI). For grounding only. */
  sourceName: string;
  /** Optional artifact class hint (research_pdf, dataset, etc.). */
  artifactClass?: string | null;
  /** Optional context: the user's research goal — keeps the LLM
   *  focused on findings relevant to what they care about, vs every
   *  number in the paper. */
  goalContext?: string | null;
}

export function buildEffectSizeExtractionUserPrompt(
  opts: EffectSizeExtractionUserOpts,
): string {
  const goalBlock = opts.goalContext
    ? `\nUSER GOAL CONTEXT (focus extractions on findings relevant to this; ignore unrelated findings in the artifact):\n${opts.goalContext.slice(0, 800)}\n`
    : "";

  // Cap at 60k chars so we stay well under context limits even with
  // long methods sections; future improvement: chunked extraction.
  const text = opts.artifactText.length > 60_000
    ? opts.artifactText.slice(0, 60_000) + "\n\n[…artifact truncated for prompt budget…]"
    : opts.artifactText;

  return `ARTIFACT — ${opts.sourceName}${
    opts.artifactClass ? ` (${opts.artifactClass})` : ""
  }
---
${text}
---
${goalBlock}
Extract every quantitative finding the artifact reports. Return strict JSON exactly as specified in the system prompt.`;
}

/**
 * Stable hash of (system + user) prompt. Used as
 * llm_label_provenance.prompt_hash so the registry can tell which
 * prompt revision produced an extraction. SHA-256 hex.
 */
export async function hashEffectSizePrompt(userPrompt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(EFFECT_SIZE_EXTRACTION_SYSTEM_PROMPT + "\n---\n" + userPrompt);
  // Web Crypto is available in Node 20+ runtime.
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
