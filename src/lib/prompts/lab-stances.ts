// ── Lab-Design Stance Prompts (Phase 2 / Week 4 / W4.5) ──────────────
//
// TIER: 3 (situation-specialized causal model) — these prompts produce
//       the committed-experimental-design layer of the situation twin.
//
// Five parallel lab-design stances. Each is a distinct epistemology
// applied to the SAME chosen problem framing (from Phase 1) + KG,
// producing ONE competing LabConfigOption from its stance. The
// generation library (lab-options.ts, W4.6) runs all five in
// parallel and surfaces the 5 results to the user via the
// /app/space/[id]/lab/pick gate page.
//
// Why 5 and not 7: matches the framing panel's 5-lens shape
// architecturally + covers the canonical epistemological tradeoffs
// in experimental-design literature:
//
//   • Tight Experimentalist — internal validity (Campbell & Stanley)
//   • Naturalistic Observer — external validity (Cronbach)
//   • Adaptive Designer    — statistical efficiency (Bayesian seqs)
//   • Pragmatist           — feasibility (operations research lens)
//   • Mechanistic Prober   — hypothesis testing (Popper / Mayo)
//
// Each stance MUST produce a candidate_whole_lab object matching the
// LabConfigOption shape (src/types/lab-options.ts). Confidence is
// per-stance self-rating; lab-options.ts sorts options by confidence
// to pick rank-1. The user re-ranks via /lab/select on the gate page.
//
// Scaling notes:
//   • Cost profile: ~500 tokens system + ~400 tokens user per call,
//     ~700 output tokens. 5 parallel calls → ~3-4s wall time on
//     reasonable LLM providers; ~$0.04 per intake total.
//   • Cheaper than framing panel (~$0.025) because lab prompts have
//     tighter output specs and don't need cell-grid opinions.
//   • Stances can decline (return null for candidate_whole_lab) when
//     the chosen framing doesn't fit their stance — e.g., the Tight
//     Experimentalist returns null when the user's problem is
//     observational-only and an RCT would be unethical.
//
// Output shape is intentionally different from a merged lab spec:
// each stance reports its own pick; the user (or auto-rank=1)
// commits. There is no consensus-merge pass for lab options — they
// represent competing whole designs, not slices of one design.

import type {
  LabConfigOption,
  LabDesignType,
  LabMeasurementCadence,
} from "@/types/lab-options";
import type { LabStanceLensId } from "@/types/pipeline-events";

// ── Public types ─────────────────────────────────────────────────────

export const ALL_LAB_STANCE_IDS: readonly LabStanceLensId[] = [
  "tight_experimentalist",
  "naturalistic_observer",
  "adaptive_designer",
  "pragmatist",
  "mechanistic_prober",
];

/** What one lab stance returns. lab-options.ts collects N of these
 *  (where N ≤ 5; stances can return null when their stance doesn't
 *  fit), sorts by candidate_whole_lab.confidence DESC, persists as
 *  twin_proposals(kind='lab_twin').lab_payload.options[]. */
export interface LabStanceOutput {
  lens_id: LabStanceLensId;
  /** The lab proposal from this stance. NULL when the stance
   *  declined (genuinely doesn't fit this problem framing — better
   *  to surface 3 strong labs than 5 with 2 weak ones). */
  candidate_whole_lab: LabConfigOption | null;
  /** Lab-design-specific risks (not subject-specific risks). E.g.,
   *  "RCT assumes randomization is ethical for this intervention." */
  named_risks: string[];
  /** 0..1 self-rated. Lab-options ranking ignores this in favor of
   *  candidate_whole_lab.confidence (per-pick rating), but the
   *  overall confidence is logged for observability. */
  confidence: number;
}

export interface LabStancePromptInput {
  /** The user's original intake text (the problem they want to solve). */
  inputText: string;
  /** The chosen problem framing's `chosen_approach` + `load_bearing_
   *  assumption` from the approved problem_twin. The lab MUST be
   *  designed to TEST this framing, not the user's stated goal.
   *  Empty string when no framing has been approved (then stances
   *  decline → caller falls back to a single default lab). */
  chosenFramingContext: string;
  /** Optional list of sub-problems from the chosen framing. The
   *  lab's primary_iv / primary_dv typically map to one of these
   *  sub-problems. */
  subProblems?: string[];
  /** Optional list of {entity_id, name} pairs from the KG for
   *  primary_iv / primary_dv resolution. When non-empty, the LLM
   *  should prefer using these entities by name rather than
   *  inventing new ones. */
  candidateEntities?: Array<{ entity_id: string; name: string }>;
  /** Optional subject access constraints (from the user's intake
   *  metadata, e.g. "self only" vs "team of 5" vs "patient cohort
   *  of 200"). Drives the Pragmatist stance hard; informs others. */
  subjectAccessHint?: string;
}

export interface LabStancePromptParts {
  system: string;
  user: string;
}

// ── Shared blocks ────────────────────────────────────────────────────

const LAB_DESIGN_PRIMER = `LAB-DESIGN PRIMER

You're designing an experiment to TEST the user's committed problem framing. The lab is HOW we'll generate evidence about whether the framing is right.

Every lab has FIVE structural choices:

1. DESIGN TYPE — the experimental architecture
     rct                 — randomized controlled trial (gold standard, expensive)
     observational       — observe without intervention (cheap, weak causal)
     single_subject      — N-of-1 / case study (intensive, generalization unclear)
     sequential          — adaptive sampling, stop when evidence sufficient (statistically efficient, complex to operate)
     ab_compare          — A/B test between variants (clean comparison, requires randomization surface)
     what_if             — counterfactual simulation only (no real subjects, fast iteration)
     mixed_methods       — qualitative + quantitative combined (rich data, complex analysis)

2. SUBJECTS — who/what we measure. List proposed cohorts with rationale + estimated count.

3. FEATURES — what tools/instrumentation to enable. Each is a string slug:
     monte_carlo         — Monte Carlo simulation engine
     what_if             — counterfactual scenario builder
     ab_compare          — A/B variant comparison
     deepen_kg           — recursive decomposition on demand
     baseline_tracking   — track baseline values over time
     deviation_capture   — flag deviations from predicted
     game                — gamification / engagement layer
     ml_personalization  — per-subject ML tuning

4. MEASUREMENT CADENCE — how often we observe. One of:
     daily | weekly | biweekly | monthly | event_triggered

5. PRIMARY IV/DV — the independent variable (what we manipulate or vary) and dependent variable (what we measure). Entity IDs from the KG when resolvable; free-text name otherwise.`;

const LAB_OUTPUT_SPEC = `STRICT JSON OUTPUT — no markdown, no prose outside the JSON:

{
  "candidate_whole_lab": {
    "lab_id": "snake_case slug — e.g. 'tight_rct_8week_blinded', 'naturalistic_telemetry_quarterly', 'sequential_bayesian_stopping'",
    "lab_title": "3-6 word headline (e.g. 'Tight 8-Week RCT', 'Quarterly Naturalistic Survey')",
    "chosen_approach": "1-2 sentences describing the lab design and what it optimizes for",
    "design_type": "rct" | "observational" | "single_subject" | "sequential" | "ab_compare" | "what_if" | "mixed_methods",
    "subjects": [
      {
        "name": "Cohort name (e.g. 'Cohort A: caffeine consumers')",
        "rationale": "≤200 chars why this cohort",
        "estimated_count": "optional — number or range as string"
      }
    ],
    "features": ["feature_slug_1", "feature_slug_2", ...],
    "measurement_cadence": "daily" | "weekly" | "biweekly" | "monthly" | "event_triggered",
    "duration_estimate_weeks": number,
    "primary_iv": { "entity_id": "uuid-or-omit", "name": "Display name" },
    "primary_dv": { "entity_id": "uuid-or-omit", "name": "Display name" },
    "when_it_wins": "Short phrase — when this lab design is the right one for this framing",
    "when_it_fails": "Short phrase — when this lab design is wrong-fit",
    "confidence": 0.0-1.0,
    "lens_id": "tight_experimentalist" | "naturalistic_observer" | "adaptive_designer" | "pragmatist" | "mechanistic_prober"
  },
  "named_risks": ["risks to the LAB DESIGN itself — not to the user's goal"],
  "confidence": 0.0-1.0
}

CRITICAL — candidate_whole_lab rules:
- This is YOUR stance's competing lab design. It MUST be sharp and stance-flavored.
- If your stance genuinely can't produce a sharp lab for this framing (e.g. Tight Experimentalist on an unfalsifiable claim, Pragmatist on a problem requiring access you can't get), set candidate_whole_lab to null. Better to surface 3 strong labs than 5 with 2 weak ones.
- lab_id must be a stable snake_case slug — re-runs on the same framing should produce the same slug.
- subjects must be CONCRETE — what you'd actually enroll, not abstractions. "People who sleep poorly" is wrong; "Adults 25-45 with self-reported PSQI > 5, screened via REDCap" is right.
- features must come from the slug list in LAB_DESIGN_PRIMER. Don't invent feature slugs.
- when_it_wins / when_it_fails are the comparison crib notes the user reads on the gate page. Be precise.
- confidence here is SEPARATE from your overall confidence. Report honestly — a Pragmatist can have 0.9 overall confidence in their stance but only 0.5 in a particular lab pick if the situation is borderline.

Do NOT add preamble, markdown fences, or commentary around the JSON.`;

// ── Stance blocks — the epistemological difference ──────────────────

const STANCE_TIGHT_EXPERIMENTALIST = `YOUR STANCE — TIGHT EXPERIMENTALIST

You optimize for INTERNAL VALIDITY above all else. Your reflex is to ask:
- Can we isolate the causal effect cleanly? What confounds bind the inference?
- Is randomization possible? Is blinding possible?
- What's the smallest single IV we can manipulate to test the framing?
- Where does the user's framing make a PREDICTION the data could falsify?

Your TYPICAL CONTRIBUTIONS:
- design_type='rct' or 'ab_compare' when randomization is feasible; 'sequential' for tight stopping rules
- subjects = cohorts with EXPLICIT inclusion/exclusion criteria, screened
- features lean toward baseline_tracking + deviation_capture (instrument the control + treatment groups identically)
- measurement_cadence = weekly or biweekly (tight control on observation noise)
- primary_iv = the single manipulation; primary_dv = the framing's load-bearing prediction
- when_it_wins: "when the framing's load-bearing assumption is falsifiable with a clean RCT"

Your KNOWN BLIND SPOTS — do NOT overreach:
- Real-world generalization (Naturalistic Observer handles ecological validity)
- Whether the user can actually run an RCT (Pragmatist handles feasibility)
- Sequential/Bayesian sophistication (Adaptive Designer's territory)

Your named_risks should focus on internal-validity threats: "randomization may be ethically constrained," "blinding fails because subjects know whether they got the intervention," "compensatory equalization between arms," etc.

Your confidence should be HIGH when the framing predicts a clean cause-effect that's randomizable, LOWER when the situation involves observation-only data or unrandomizable interventions (don't force an RCT where it's wrong). Decline (return null candidate_whole_lab) when randomization would be unethical or fundamentally impossible.`;

const STANCE_NATURALISTIC_OBSERVER = `YOUR STANCE — NATURALISTIC OBSERVER

You optimize for EXTERNAL VALIDITY — does the finding hold in real conditions, not just in the lab? Your reflex is to ask:
- What's the behavior in the wild, with no intervention disruption?
- Where does telemetry/passive sensing get us closer to ground truth than self-report?
- What's the natural variation already happening in the user's environment?
- How long must we observe to capture the real periodicity / non-stationarity?

Your TYPICAL CONTRIBUTIONS:
- design_type='observational' or 'mixed_methods'; rarely 'rct'
- subjects = the actual user / their actual environment, sampled longitudinally
- features lean toward baseline_tracking + deviation_capture + ml_personalization (passive instrumentation, per-subject tuning)
- measurement_cadence = daily or event_triggered (catch the real-time signal)
- duration_estimate_weeks tends to be LONGER than experimentalist (need to see seasonal/cyclical variation)
- primary_iv often = an environmental variable the user does NOT manipulate (they observe it varying naturally)
- when_it_wins: "when the user's framing depends on real-world dynamics an RCT would distort"

Your KNOWN BLIND SPOTS — do NOT overreach:
- Causal precision (Tight Experimentalist handles that)
- Statistical efficiency (Adaptive Designer handles that)
- "Just measure everything" — your stance can drift into expensive over-collection

Your named_risks should focus on external-validity-specific threats: "confounders we don't observe pollute the inference," "self-selection bias in who consents to telemetry," "Hawthorne effect from being observed."

Your confidence should be HIGH when the framing's mechanism only operates under real-world stimulus patterns (sleep, mood, social dynamics, ecological systems). LOWER when the framing is mechanistically tight and benefits from cleaner manipulation. Decline when the user has no environmental signal to observe (pure-idea framings).`;

const STANCE_ADAPTIVE_DESIGNER = `YOUR STANCE — ADAPTIVE DESIGNER

You optimize for STATISTICAL EFFICIENCY — get the strongest evidence with the fewest samples. Your reflex is to ask:
- What's the smallest sample size that can settle the framing's prediction?
- Where can we use sequential / Bayesian / multi-armed-bandit designs to stop early when evidence accumulates?
- What's the prior on the framing's load-bearing assumption? Do we already have evidence we should update from?
- How do we handle interim analyses without inflating false-positive rates?

Your TYPICAL CONTRIBUTIONS:
- design_type='sequential' (Bayesian sequential / SPRT) or 'ab_compare' with adaptive randomization
- subjects = small initial cohort with stopping criteria; can scale up if evidence is ambiguous
- features lean toward monte_carlo + deviation_capture + ml_personalization (rolling re-estimation as data lands)
- measurement_cadence = often event_triggered (analyze when each subject's data lands) or weekly with weekly interim looks
- duration_estimate_weeks is FLEXIBLE — gives a "median" estimate but the actual duration depends on evidence accumulation
- primary_iv / primary_dv as Tight Experimentalist, but with prior elicitation

Your KNOWN BLIND SPOTS — do NOT overreach:
- Operational simplicity (Pragmatist's territory — sequential designs are hard to actually execute)
- Ecological validity (Naturalistic Observer)
- Hypothesis sharpness (Mechanistic Prober — your designs assume the prediction is already crisp)

Your named_risks should focus on adaptive-design threats: "interim look inflation," "the stopping rule misfires if priors are miscalibrated," "operational burden of running sequential analyses defeats the efficiency gain."

Your confidence should be HIGH when the framing has a clear prior + measurable outcome + the user has the operational sophistication to run sequential analyses. LOWER when the operator can't actually execute interim looks or when priors are vacuous (then a simple RCT beats a Bayesian one). Decline when no prior evidence exists to anchor the Bayesian update.`;

const STANCE_PRAGMATIST = `YOUR STANCE — PRAGMATIST

You optimize for FEASIBILITY — what's actually executable given the user's real constraints. Your reflex is to ask:
- How many subjects can the user actually access? Themselves? A team of 5? A cohort of 200?
- What's the user's time budget? Days? Weeks? Months?
- What instruments do they ALREADY have, vs what would they have to build from scratch?
- What's the simplest design that produces useful evidence even if it's not perfect?

Your TYPICAL CONTRIBUTIONS:
- design_type='single_subject' (N-of-1) when subject access is limited; 'observational' when intervention is hard; 'what_if' when no subjects available at all
- subjects = whoever's actually accessible; honest counts
- features lean toward what the user can operate without specialized training: baseline_tracking + deviation_capture + game (engagement to maintain compliance)
- measurement_cadence = weekly or biweekly (sustainable for the user)
- duration_estimate_weeks = honest given access constraints
- primary_iv / primary_dv as simple as possible

Your KNOWN BLIND SPOTS — do NOT overreach:
- Internal validity (Tight Experimentalist) — your designs accept weaker causal claims to gain feasibility
- Statistical efficiency (Adaptive Designer) — your designs accept more samples for operational simplicity
- "Just do the cheapest thing" — your stance can drift into "barely an experiment at all"

Your named_risks should focus on feasibility-specific threats: "the user gives up after 2 weeks because cadence was too aggressive," "compliance drops without engagement features," "the data is too noisy to detect the framing's effect given access constraints."

Your confidence should be HIGH when the user is solo / resource-constrained and any of the other stances would over-design. LOWER when the user has real research infrastructure (then Tight Experimentalist or Adaptive Designer wins). Always present the FEASIBLE option even if it's epistemically weaker — that's your job.

Use subject_access_hint heavily if provided. It's the strongest signal of what's actually feasible.`;

const STANCE_MECHANISTIC_PROBER = `YOUR STANCE — MECHANISTIC PROBER

You optimize for HYPOTHESIS TESTING — designs that put the framing's LOAD-BEARING ASSUMPTION on the line. Your reflex is to ask:
- What does the framing assert as its load-bearing assumption? What does it ASSUME without proof?
- If we ran the experiment and the load-bearing assumption is wrong, what would we observe?
- What's the SHARPEST prediction the framing makes — and is the lab designed to falsify that specific prediction?
- Where would we INTERVENE to break the mechanism on purpose to confirm it's load-bearing?

Your TYPICAL CONTRIBUTIONS:
- design_type='ab_compare' or 'sequential' targeting the framing's specific assumption; 'mixed_methods' when the assumption is partly qualitative
- subjects = chosen specifically to STRESS the assumption (e.g., if the framing claims "X mediates Y through mechanism M," recruit subjects where M is impaired or absent)
- features lean toward deviation_capture (the falsification signal) + monte_carlo (simulate what we should see if assumption holds vs. fails)
- measurement_cadence = whatever resolves the prediction (event_triggered when the prediction has a sharp moment)
- primary_iv = a manipulation that should affect outcome IF the assumption holds, and NOT if it fails
- primary_dv = the framing's load-bearing prediction

Your KNOWN BLIND SPOTS — do NOT overreach:
- General feasibility (Pragmatist)
- Statistical efficiency (Adaptive Designer)
- Ecological validity (Naturalistic Observer) — your designs are happy to be lab-bound if that's what tests the mechanism cleanly
- You can over-fit to one assumption and miss other things going on

Your named_risks should focus on hypothesis-test-specific threats: "the assumption is operationally untestable as stated," "multiple mechanisms could produce the same observable prediction (under-determination)," "the test confirms the assumption but the framing has OTHER load-bearing assumptions we didn't test."

Your confidence should be HIGH when the framing's load-bearing assumption is articulable AND has a sharp predictive consequence we could measure. LOWER when the framing is vague or the load-bearing assumption is genuinely qualitative. Decline when no load-bearing assumption is identifiable from the chosen framing.`;

// ── Public entry — build prompt for a given stance ────────────────────

export function buildLabStancePrompt(
  lensId: LabStanceLensId,
  input: LabStancePromptInput,
): LabStancePromptParts {
  const stance = stanceBlockFor(lensId);
  const system = [
    `You are one stance in a lab-design panel. You design ONE lab from a specific epistemological stance — OTHER stances cover other tradeoffs. Do not try to be comprehensive; do the work YOUR stance is best at, and let the user pick between stances via the gate page.`,
    stance,
    LAB_DESIGN_PRIMER,
    LAB_OUTPUT_SPEC,
  ].join("\n\n");

  const framingBlock = input.chosenFramingContext
    ? `\nUSER'S APPROVED PROBLEM FRAMING (the lab must TEST this — not the user's stated goal):\n"""\n${input.chosenFramingContext.slice(0, 1200)}\n"""\n`
    : "\nNO PROBLEM FRAMING APPROVED YET — fall back to a generic lab if your stance still fits.\n";

  const subProblemsBlock =
    Array.isArray(input.subProblems) && input.subProblems.length > 0
      ? `\nSUB-PROBLEMS FROM CHOSEN FRAMING (your primary_iv / primary_dv typically map to one of these):\n${input.subProblems.slice(0, 6).map((sp, i) => `  ${i + 1}. ${sp.slice(0, 200)}`).join("\n")}\n`
      : "";

  const entitiesBlock =
    Array.isArray(input.candidateEntities) && input.candidateEntities.length > 0
      ? `\nCANDIDATE KG ENTITIES (prefer using these by name in primary_iv/primary_dv; entity_id when resolvable):\n${input.candidateEntities.slice(0, 12).map((e) => `  - ${e.name} (id: ${e.entity_id.slice(0, 8)}…)`).join("\n")}\n`
      : "";

  const accessBlock = input.subjectAccessHint
    ? `\nSUBJECT-ACCESS CONSTRAINT (calibrate feasibility against this):\n${input.subjectAccessHint.slice(0, 400)}\n`
    : "";

  const user = `INTAKE (the user's raw text — context):
"""
${input.inputText.slice(0, 1800)}
"""
${framingBlock}${subProblemsBlock}${entitiesBlock}${accessBlock}
Apply YOUR stance. Return strict JSON.`;

  return { system, user };
}

function stanceBlockFor(lensId: LabStanceLensId): string {
  switch (lensId) {
    case "tight_experimentalist":
      return STANCE_TIGHT_EXPERIMENTALIST;
    case "naturalistic_observer":
      return STANCE_NATURALISTIC_OBSERVER;
    case "adaptive_designer":
      return STANCE_ADAPTIVE_DESIGNER;
    case "pragmatist":
      return STANCE_PRAGMATIST;
    case "mechanistic_prober":
      return STANCE_MECHANISTIC_PROBER;
  }
}

// ── Validator — per-stance output ────────────────────────────────────
//
// Coerces an unknown raw LLM JSON into a valid LabStanceOutput. Never
// throws. Mirrors the framing-lenses.ts validator pattern. When the
// LLM produces malformed output, returns an empty result with
// candidate_whole_lab=null (the stance effectively declined).

const VALID_DESIGN_TYPES: LabDesignType[] = [
  "rct",
  "observational",
  "single_subject",
  "sequential",
  "ab_compare",
  "what_if",
  "mixed_methods",
];

const VALID_CADENCES: LabMeasurementCadence[] = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "event_triggered",
];

export function validateLabStanceOutput(
  lensId: LabStanceLensId,
  raw: unknown,
): LabStanceOutput {
  const empty: LabStanceOutput = {
    lens_id: lensId,
    candidate_whole_lab: null,
    named_risks: [],
    confidence: 0,
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;

  return {
    lens_id: lensId,
    candidate_whole_lab: coerceLabOption(lensId, r.candidate_whole_lab),
    named_risks: Array.isArray(r.named_risks)
      ? (r.named_risks as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.slice(0, 200))
          .slice(0, 8)
      : [],
    confidence: clamp01(typeof r.confidence === "number" ? r.confidence : 0),
  };
}

function coerceLabOption(
  lensId: LabStanceLensId,
  raw: unknown,
): LabConfigOption | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const labId =
    typeof r.lab_id === "string" && r.lab_id.length > 0
      ? r.lab_id.slice(0, 80)
      : null;
  const labTitle =
    typeof r.lab_title === "string" && r.lab_title.length > 0
      ? r.lab_title.slice(0, 80)
      : null;
  const chosenApproach =
    typeof r.chosen_approach === "string" && r.chosen_approach.length > 0
      ? r.chosen_approach.slice(0, 600)
      : null;
  if (!labId || !labTitle || !chosenApproach) return null;

  // Design type — narrow to enum or default to 'observational' (safest).
  const designType = (
    VALID_DESIGN_TYPES as readonly string[]
  ).includes(r.design_type as string)
    ? (r.design_type as LabDesignType)
    : "observational";

  const cadence = (
    VALID_CADENCES as readonly string[]
  ).includes(r.measurement_cadence as string)
    ? (r.measurement_cadence as LabMeasurementCadence)
    : "weekly";

  const subjects = Array.isArray(r.subjects)
    ? (r.subjects as unknown[])
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const sr = s as Record<string, unknown>;
          if (typeof sr.name !== "string" || sr.name.length === 0) return null;
          return {
            name: sr.name.slice(0, 160),
            rationale:
              typeof sr.rationale === "string"
                ? sr.rationale.slice(0, 200)
                : "",
            estimated_count:
              typeof sr.estimated_count === "string"
                ? sr.estimated_count.slice(0, 60)
                : undefined,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .slice(0, 8)
    : [];

  const features = Array.isArray(r.features)
    ? (r.features as unknown[])
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .map((s) => s.slice(0, 60))
        .slice(0, 12)
    : [];

  const durationWeeks =
    typeof r.duration_estimate_weeks === "number" &&
    Number.isFinite(r.duration_estimate_weeks)
      ? Math.max(0, Math.min(520, r.duration_estimate_weeks)) // 0..10 years cap
      : 8;

  const primaryIv = coerceVar(r.primary_iv);
  const primaryDv = coerceVar(r.primary_dv);
  if (!primaryIv || !primaryDv) return null;

  return {
    lab_id: labId,
    lab_title: labTitle,
    chosen_approach: chosenApproach,
    design_type: designType,
    subjects,
    features,
    measurement_cadence: cadence,
    duration_estimate_weeks: durationWeeks,
    primary_iv: primaryIv,
    primary_dv: primaryDv,
    when_it_wins:
      typeof r.when_it_wins === "string" ? r.when_it_wins.slice(0, 200) : "",
    when_it_fails:
      typeof r.when_it_fails === "string"
        ? r.when_it_fails.slice(0, 200)
        : "",
    confidence: clamp01(typeof r.confidence === "number" ? r.confidence : 0),
    lens_id: lensId,
  };
}

function coerceVar(raw: unknown): { entity_id?: string; name: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.slice(0, 160) : null;
  if (!name || name.length === 0) return null;
  const entityId =
    typeof r.entity_id === "string" && r.entity_id.length > 0
      ? r.entity_id.slice(0, 80)
      : undefined;
  return entityId ? { entity_id: entityId, name } : { name };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
