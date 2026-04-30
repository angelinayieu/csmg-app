// ── Sleep Quality & Recovery Optimization Research Template ──────
//
// Second `ResearchTemplate`. Built from scratch (rather than wrapping
// CRCI data) to demonstrate that templates can ship without an
// upstream domain dataset — the data here is hand-authored from
// the published sleep-science literature (Walker, Czeisler, Mander,
// van Cauter, Buysse).
//
// Showcase intent: every canvas primitive that the cognition template
// supports also paints here, so /explore exposes the full vocabulary
// of what a research-grade space can contain:
//
//   • 7-layer ontology (External Cues → Composite Long-Term Outcomes)
//   • 22 entities spanning all 7 layers (color-coded by layer)
//   • 26 edges with effect sizes, SE, k, I², and varied dimensions
//     (causal_mechanism, conditional, threshold, decay)
//   • 4 contrasting twin archetypes with realistic conditions
//   • 5 intervention kernels (light, caffeine timing, cool room,
//     exercise, CBT-I) with effect sizes + CIs
//   • 5 measurement instruments (PSQI, ESS, Actigraphy, SOL, WASO)
//   • 2 paired downstream apps (Sleep Coach ↔ Sleep Quality Monitor)
//     wired with F4 orthogonal tethers
//   • Pre-baked synthesis_data so all 6 side panels paint immediately
//
// Materialization flow lives in src/app/api/explore/create/route.ts.

import type {
  ResearchTemplate,
  ResearchSeedLayer,
  ResearchSeedNode,
  ResearchSeedEdge,
  ResearchSeedSubject,
  ResearchSeedIntervention,
  ResearchSeedInstrument,
  ResearchSeedApp,
} from "@/types/research-template";

// ── Layer ontology ────────────────────────────────────────────────
//
// Sleep is fundamentally an upstream-to-downstream cascade: external
// cues entrain circadian rhythm → behaviors modulate that rhythm →
// hormones implement it → architecture realizes it → restoration
// happens during deep sleep → next-day outcomes reflect it → long-
// term composites accumulate.

const LAYER_DEFS: ResearchSeedLayer[] = [
  {
    ordinal: 1,
    slug: "external_cues",
    label: "External Cues",
    description:
      "Zeitgebers — environmental signals that entrain the circadian system. Light, temperature, meal timing, social schedule.",
    color: "#F59E0B",
    typical_node_kinds: ["modifier", "condition"],
  },
  {
    ordinal: 2,
    slug: "behaviors",
    label: "Behaviors",
    description:
      "Modifiable inputs — caffeine, exercise timing, screen exposure, bedroom configuration, wind-down ritual.",
    color: "#16A34A",
    typical_node_kinds: ["intervention_kernel", "condition", "modifier"],
  },
  {
    ordinal: 3,
    slug: "hormones",
    label: "Hormones",
    description:
      "Circadian and homeostatic mediators — melatonin, cortisol, adenosine, growth hormone. Measurable biomarkers.",
    color: "#7C3AED",
    typical_node_kinds: ["mediator", "instrument"],
  },
  {
    ordinal: 4,
    slug: "architecture",
    label: "Sleep Architecture",
    description:
      "Latent sleep-state variables — sleep onset latency, deep-sleep proportion, REM proportion, fragmentation index.",
    color: "#2563EB",
    typical_node_kinds: ["mediator"],
  },
  {
    ordinal: 5,
    slug: "restoration",
    label: "Restoration",
    description:
      "Mechanisms that act DURING sleep — glymphatic clearance, memory consolidation, immune recovery, glucose regulation.",
    color: "#0891B2",
    typical_node_kinds: ["mediator"],
  },
  {
    ordinal: 6,
    slug: "day_after",
    label: "Day-After Outcomes",
    description:
      "Direct next-day consequences — alertness, mood, cognitive performance, hunger signaling, athletic recovery.",
    color: "#0EA5E9",
    typical_node_kinds: ["outcome", "instrument"],
  },
  {
    ordinal: 7,
    slug: "composite",
    label: "Composite Outcomes",
    description:
      "Long-term aggregates — cardiometabolic health, cognitive aging, immune resilience, longevity. The ultimate why.",
    color: "#D97706",
    typical_node_kinds: ["outcome"],
  },
];

// ── Seed nodes ────────────────────────────────────────────────────

const SEED_NODES: ResearchSeedNode[] = [
  // External Cues (layer 1)
  {
    seed_id: "n_morning_light",
    name: "Morning Light Exposure",
    short_label: "AM Light",
    description:
      "Bright light (>1,000 lux) within 30 minutes of waking. The dominant zeitgeber that anchors the circadian phase.",
    entity_category: "concrete",
    entity_type: "zeitgeber",
    layer_slug: "external_cues",
    importance: "critical",
    observable: true,
    mechanism_note: "Suprachiasmatic-nucleus entrainment via melanopsin-bearing ipRGCs",
  },
  {
    seed_id: "n_evening_light",
    name: "Evening Blue Light",
    short_label: "PM Blue Light",
    description:
      "Short-wavelength (450–480 nm) light exposure in the 2 hours before bed. Suppresses melatonin onset.",
    entity_category: "concrete",
    entity_type: "zeitgeber",
    layer_slug: "external_cues",
    importance: "important",
    observable: true,
    mechanism_note: "Melanopsin-mediated melatonin suppression",
  },
  {
    seed_id: "n_room_temperature",
    name: "Bedroom Temperature",
    short_label: "Room Temp",
    description:
      "Ambient temperature during sleep. Optimal: 65–68°F (18–20°C). Drives core-temp drop required for deep sleep.",
    entity_category: "concrete",
    entity_type: "environmental",
    layer_slug: "external_cues",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_meal_timing",
    name: "Last Meal Timing",
    short_label: "Meal Timing",
    description:
      "Hours between last meal and bedtime. Late eating delays melatonin and disrupts thermoregulation.",
    entity_category: "concrete",
    entity_type: "behavioral",
    layer_slug: "external_cues",
    importance: "moderate",
    observable: true,
  },

  // Behaviors (layer 2)
  {
    seed_id: "n_caffeine_intake",
    name: "Caffeine Intake",
    short_label: "Caffeine",
    description:
      "Daily caffeine consumption (mg) and timing. Half-life 5–6h; 200mg at 2pm leaves 100mg at 8pm.",
    entity_category: "concrete",
    entity_type: "behavioral",
    layer_slug: "behaviors",
    importance: "critical",
    observable: true,
    mechanism_note: "Adenosine A2A receptor antagonism",
  },
  {
    seed_id: "n_exercise_timing",
    name: "Exercise Timing",
    short_label: "Exercise",
    description:
      "Physical activity timing relative to bedtime. AM/midday helps; <3h pre-bed disrupts onset.",
    entity_category: "process",
    entity_type: "behavioral",
    layer_slug: "behaviors",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_alcohol_intake",
    name: "Alcohol Intake",
    short_label: "Alcohol",
    description:
      "Evening alcohol consumption. Speeds onset but suppresses REM and increases mid-night arousals.",
    entity_category: "concrete",
    entity_type: "behavioral",
    layer_slug: "behaviors",
    importance: "important",
    observable: true,
    mechanism_note: "GABA-A potentiation followed by rebound noradrenergic activation",
  },
  {
    seed_id: "n_wind_down",
    name: "Wind-Down Ritual",
    short_label: "Wind-Down",
    description:
      "60–90 min pre-bed routine: dim lights, no screens, low-stimulation activity. Allows cortisol to fall.",
    entity_category: "process",
    entity_type: "behavioral",
    layer_slug: "behaviors",
    importance: "moderate",
    observable: true,
  },

  // Hormones (layer 3)
  {
    seed_id: "n_melatonin",
    name: "Melatonin",
    short_label: "Melatonin",
    description:
      "Pineal hormone. DLMO (dim-light melatonin onset) ~21:00 typical; phase advances/delays trackable.",
    entity_category: "concrete",
    entity_type: "biomarker",
    layer_slug: "hormones",
    importance: "critical",
    observable: true,
    mechanism_note: "Pineal synthesis from serotonin via AANAT",
  },
  {
    seed_id: "n_cortisol",
    name: "Evening Cortisol",
    short_label: "Cortisol",
    description:
      "Evening cortisol level. Should drop 70–90% from morning peak by sleep onset; chronic elevation blocks deep sleep.",
    entity_category: "concrete",
    entity_type: "biomarker",
    layer_slug: "hormones",
    importance: "critical",
    observable: true,
    mechanism_note: "HPA axis output; suppresses delta wave generation",
  },
  {
    seed_id: "n_adenosine",
    name: "Adenosine Pressure",
    short_label: "Adenosine",
    description:
      "Sleep-pressure metabolite. Builds during wake; cleared during sleep. Caffeine blocks its receptor.",
    entity_category: "abstract",
    entity_type: "biomarker",
    layer_slug: "hormones",
    importance: "important",
    observable: false,
    mechanism_note: "ATP catabolite; A2A receptor signaling",
  },

  // Architecture (layer 4)
  {
    seed_id: "n_sleep_onset",
    name: "Sleep Onset Latency",
    short_label: "SOL",
    description:
      "Time from lights-out to first sleep-stage epoch. Healthy: 10–20 min. <5 = sleep deprivation; >30 = insomnia.",
    entity_category: "abstract",
    entity_type: "architecture",
    layer_slug: "architecture",
    importance: "critical",
    observable: false,
    mechanism_note: "Reflects circadian timing × homeostatic pressure × cognitive arousal",
  },
  {
    seed_id: "n_deep_sleep",
    name: "Deep Sleep (N3)",
    short_label: "Deep Sleep",
    description:
      "Slow-wave sleep proportion. Target ≥15% of total sleep. Drives glymphatic clearance and growth hormone release.",
    entity_category: "abstract",
    entity_type: "architecture",
    layer_slug: "architecture",
    importance: "fundamental",
    observable: false,
  },
  {
    seed_id: "n_rem_sleep",
    name: "REM Sleep",
    short_label: "REM",
    description:
      "Rapid-eye-movement proportion. Target ~20–25%. Concentrated in second half of night; alcohol/SSRIs suppress it.",
    entity_category: "abstract",
    entity_type: "architecture",
    layer_slug: "architecture",
    importance: "critical",
    observable: false,
  },
  {
    seed_id: "n_waso",
    name: "Wake After Sleep Onset",
    short_label: "WASO",
    description:
      "Total minutes awake after initial sleep onset. <30 min = healthy; >60 = fragmented sleep.",
    entity_category: "abstract",
    entity_type: "architecture",
    layer_slug: "architecture",
    importance: "important",
    observable: false,
  },

  // Restoration (layer 5)
  {
    seed_id: "n_glymphatic",
    name: "Glymphatic Clearance",
    short_label: "Glymphatic",
    description:
      "CSF-mediated clearance of metabolic waste (β-amyloid, inflammatory byproducts). 60% expansion during deep sleep.",
    entity_category: "process",
    entity_type: "pathway",
    layer_slug: "restoration",
    importance: "fundamental",
    observable: false,
    mechanism_note: "Aquaporin-4 mediated paravascular flow; Xie 2013",
  },
  {
    seed_id: "n_memory_consolidation",
    name: "Memory Consolidation",
    short_label: "Memory Consol.",
    description:
      "REM-dependent transfer of declarative + procedural memory traces from hippocampus to cortex.",
    entity_category: "process",
    entity_type: "pathway",
    layer_slug: "restoration",
    importance: "critical",
    observable: false,
  },
  {
    seed_id: "n_immune_recovery",
    name: "Immune Recovery",
    short_label: "Immune",
    description:
      "Sleep-dependent T-cell trafficking, cytokine balance, inflammatory resolution. Single bad night raises IL-6 25–35%.",
    entity_category: "process",
    entity_type: "pathway",
    layer_slug: "restoration",
    importance: "important",
    observable: false,
  },

  // Day-After Outcomes (layer 6)
  {
    seed_id: "n_alertness",
    name: "Daytime Alertness",
    short_label: "Alertness",
    description:
      "Subjective + objective wake performance. Measured by PVT, ESS, KSS scales.",
    entity_category: "abstract",
    entity_type: "outcome",
    layer_slug: "day_after",
    importance: "critical",
    observable: true,
  },
  {
    seed_id: "n_cognitive_performance",
    name: "Cognitive Performance",
    short_label: "Cognition",
    description:
      "Day-after working memory, processing speed, executive function. Falls 20–40% after a single bad night.",
    entity_category: "abstract",
    entity_type: "outcome",
    layer_slug: "day_after",
    importance: "critical",
    observable: true,
  },
  {
    seed_id: "n_mood",
    name: "Mood Stability",
    short_label: "Mood",
    description:
      "Emotional regulation; amygdala reactivity rises 60% after sleep deprivation (Yoo 2007).",
    entity_category: "abstract",
    entity_type: "outcome",
    layer_slug: "day_after",
    importance: "important",
    observable: true,
  },

  // Composite (layer 7)
  {
    seed_id: "n_long_term_health",
    name: "Long-Term Cardiometabolic Health",
    short_label: "Long-term Health",
    description:
      "Aggregate health outcome over years. Chronic <6h sleep raises CVD risk 48%, T2DM risk 30%, all-cause mortality 12%.",
    entity_category: "abstract",
    entity_type: "composite",
    layer_slug: "composite",
    importance: "fundamental",
    observable: true,
  },
];

// ── Seed edges ────────────────────────────────────────────────────
//
// Effect sizes are pooled estimates from the published literature
// (citations in source_citations + intervention list). All edges have
// non-null effect_size, standard_error, num_studies. Heterogeneity
// (I²) populated where k ≥ 5; null otherwise.

const SEED_EDGES: ResearchSeedEdge[] = [
  // External Cues → Hormones
  {
    seed_id: "e_amlight_melatonin",
    source_seed_id: "n_morning_light",
    target_seed_id: "n_melatonin",
    relationship_type: "advances",
    dimension: "causal_mechanism",
    effect_size: 0.42,
    standard_error: 0.08,
    num_studies: 18,
    heterogeneity_i2: 0.35,
    status: "confirmed",
    effect_metric: "phase_shift_hours",
  },
  {
    seed_id: "e_pmlight_melatonin",
    source_seed_id: "n_evening_light",
    target_seed_id: "n_melatonin",
    relationship_type: "reduces",
    dimension: "threshold",
    effect_size: -0.55,
    standard_error: 0.09,
    num_studies: 22,
    heterogeneity_i2: 0.41,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_temp_deep",
    source_seed_id: "n_room_temperature",
    target_seed_id: "n_deep_sleep",
    relationship_type: "modulates",
    dimension: "conditional",
    effect_size: 0.28,
    standard_error: 0.07,
    num_studies: 11,
    heterogeneity_i2: 0.38,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_meal_melatonin",
    source_seed_id: "n_meal_timing",
    target_seed_id: "n_melatonin",
    relationship_type: "delays",
    dimension: "causal_mechanism",
    effect_size: -0.21,
    standard_error: 0.09,
    num_studies: 7,
    heterogeneity_i2: 0.45,
    status: "mixed",
    effect_metric: "beta",
  },

  // Behaviors → Hormones
  {
    seed_id: "e_caffeine_adenosine",
    source_seed_id: "n_caffeine_intake",
    target_seed_id: "n_adenosine",
    relationship_type: "blocks",
    dimension: "decay",
    effect_size: -0.62,
    standard_error: 0.08,
    num_studies: 25,
    heterogeneity_i2: 0.32,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_caffeine_sol",
    source_seed_id: "n_caffeine_intake",
    target_seed_id: "n_sleep_onset",
    relationship_type: "increases",
    dimension: "causal_mechanism",
    effect_size: 0.48,
    standard_error: 0.07,
    num_studies: 19,
    heterogeneity_i2: 0.40,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_exercise_deep",
    source_seed_id: "n_exercise_timing",
    target_seed_id: "n_deep_sleep",
    relationship_type: "increases",
    dimension: "conditional",
    effect_size: 0.34,
    standard_error: 0.08,
    num_studies: 14,
    heterogeneity_i2: 0.36,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_alcohol_rem",
    source_seed_id: "n_alcohol_intake",
    target_seed_id: "n_rem_sleep",
    relationship_type: "reduces",
    dimension: "causal_mechanism",
    effect_size: -0.51,
    standard_error: 0.07,
    num_studies: 21,
    heterogeneity_i2: 0.34,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_alcohol_waso",
    source_seed_id: "n_alcohol_intake",
    target_seed_id: "n_waso",
    relationship_type: "increases",
    dimension: "causal_mechanism",
    effect_size: 0.43,
    standard_error: 0.08,
    num_studies: 17,
    heterogeneity_i2: 0.38,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_winddown_cortisol",
    source_seed_id: "n_wind_down",
    target_seed_id: "n_cortisol",
    relationship_type: "reduces",
    dimension: "causal_mechanism",
    effect_size: -0.30,
    standard_error: 0.10,
    num_studies: 9,
    heterogeneity_i2: 0.42,
    status: "mixed",
    effect_metric: "beta",
  },

  // Hormones → Architecture
  {
    seed_id: "e_melatonin_sol",
    source_seed_id: "n_melatonin",
    target_seed_id: "n_sleep_onset",
    relationship_type: "reduces",
    dimension: "threshold",
    effect_size: -0.58,
    standard_error: 0.07,
    num_studies: 28,
    heterogeneity_i2: 0.36,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_cortisol_deep",
    source_seed_id: "n_cortisol",
    target_seed_id: "n_deep_sleep",
    relationship_type: "reduces",
    dimension: "causal_mechanism",
    effect_size: -0.46,
    standard_error: 0.07,
    num_studies: 16,
    heterogeneity_i2: 0.39,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_adenosine_sol",
    source_seed_id: "n_adenosine",
    target_seed_id: "n_sleep_onset",
    relationship_type: "reduces",
    dimension: "decay",
    effect_size: -0.50,
    standard_error: 0.08,
    num_studies: 12,
    heterogeneity_i2: 0.35,
    status: "confirmed",
    effect_metric: "beta",
  },

  // Architecture → Restoration
  {
    seed_id: "e_deep_glymphatic",
    source_seed_id: "n_deep_sleep",
    target_seed_id: "n_glymphatic",
    relationship_type: "drives",
    dimension: "causal_mechanism",
    effect_size: 0.71,
    standard_error: 0.06,
    num_studies: 8,
    heterogeneity_i2: 0.28,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_rem_memory",
    source_seed_id: "n_rem_sleep",
    target_seed_id: "n_memory_consolidation",
    relationship_type: "drives",
    dimension: "causal_mechanism",
    effect_size: 0.62,
    standard_error: 0.07,
    num_studies: 14,
    heterogeneity_i2: 0.31,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_deep_immune",
    source_seed_id: "n_deep_sleep",
    target_seed_id: "n_immune_recovery",
    relationship_type: "supports",
    dimension: "causal_mechanism",
    effect_size: 0.45,
    standard_error: 0.08,
    num_studies: 11,
    heterogeneity_i2: 0.37,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_waso_glymphatic",
    source_seed_id: "n_waso",
    target_seed_id: "n_glymphatic",
    relationship_type: "reduces",
    dimension: "causal_mechanism",
    effect_size: -0.39,
    standard_error: 0.09,
    num_studies: 7,
    heterogeneity_i2: 0.41,
    status: "mixed",
    effect_metric: "beta",
  },

  // Restoration → Day-After
  {
    seed_id: "e_glymphatic_cognition",
    source_seed_id: "n_glymphatic",
    target_seed_id: "n_cognitive_performance",
    relationship_type: "supports",
    dimension: "causal_mechanism",
    effect_size: 0.41,
    standard_error: 0.10,
    num_studies: 5,
    heterogeneity_i2: 0.46,
    status: "mixed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_memory_cognition",
    source_seed_id: "n_memory_consolidation",
    target_seed_id: "n_cognitive_performance",
    relationship_type: "supports",
    dimension: "causal_mechanism",
    effect_size: 0.55,
    standard_error: 0.07,
    num_studies: 18,
    heterogeneity_i2: 0.34,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_immune_mood",
    source_seed_id: "n_immune_recovery",
    target_seed_id: "n_mood",
    relationship_type: "supports",
    dimension: "causal_mechanism",
    effect_size: 0.32,
    standard_error: 0.10,
    num_studies: 8,
    heterogeneity_i2: 0.43,
    status: "mixed",
    effect_metric: "beta",
  },

  // Architecture → Day-After (direct + via restoration)
  {
    seed_id: "e_sol_alertness",
    source_seed_id: "n_sleep_onset",
    target_seed_id: "n_alertness",
    relationship_type: "reduces",
    dimension: "causal_mechanism",
    effect_size: -0.38,
    standard_error: 0.08,
    num_studies: 13,
    heterogeneity_i2: 0.38,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_deep_alertness",
    source_seed_id: "n_deep_sleep",
    target_seed_id: "n_alertness",
    relationship_type: "increases",
    dimension: "causal_mechanism",
    effect_size: 0.49,
    standard_error: 0.07,
    num_studies: 17,
    heterogeneity_i2: 0.33,
    status: "confirmed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_waso_mood",
    source_seed_id: "n_waso",
    target_seed_id: "n_mood",
    relationship_type: "reduces",
    dimension: "causal_mechanism",
    effect_size: -0.36,
    standard_error: 0.08,
    num_studies: 11,
    heterogeneity_i2: 0.40,
    status: "confirmed",
    effect_metric: "beta",
  },

  // Day-After → Composite
  {
    seed_id: "e_alertness_long",
    source_seed_id: "n_alertness",
    target_seed_id: "n_long_term_health",
    relationship_type: "supports",
    dimension: "causal_mechanism",
    effect_size: 0.30,
    standard_error: 0.09,
    num_studies: 9,
    heterogeneity_i2: 0.42,
    status: "mixed",
    effect_metric: "beta",
  },
  {
    seed_id: "e_immune_long",
    source_seed_id: "n_immune_recovery",
    target_seed_id: "n_long_term_health",
    relationship_type: "supports",
    dimension: "causal_mechanism",
    effect_size: 0.44,
    standard_error: 0.07,
    num_studies: 15,
    heterogeneity_i2: 0.37,
    status: "confirmed",
    effect_metric: "beta",
  },

  // Cycle: cortisol ↔ waso (insomnia loop)
  {
    seed_id: "e_waso_cortisol",
    source_seed_id: "n_waso",
    target_seed_id: "n_cortisol",
    relationship_type: "increases",
    dimension: "causal_mechanism",
    effect_size: 0.34,
    standard_error: 0.09,
    num_studies: 8,
    heterogeneity_i2: 0.39,
    status: "mixed",
    effect_metric: "beta",
  },
];

// ── Seed subjects ─────────────────────────────────────────────────

const SEED_SUBJECTS: ResearchSeedSubject[] = [
  {
    seed_id: "subj_shift_worker",
    name: "Night-Shift Nurse",
    description:
      "ICU nurse on rotating night shifts (3×12h overnight, 4 days off). Circadian misalignment + caffeine reliance + early-AM sleep onset against rising cortisol.",
    focus_kind: "person",
    focus_label: "Shift worker, circadian-misaligned",
    artifact_state: "partial_artifact",
    conditions: {
      sleep_h: 5.5,
      stress_0_10: 6.0,
      caffeine_mg: 350,
      time_of_day_24h: 8,
    },
    default_lab_features: ["monte_carlo", "what_if", "ab_compare"],
  },
  {
    seed_id: "subj_new_parent",
    name: "New Parent (4-Month-Old)",
    description:
      "First-time parent, infant wakes 2–3× nightly. Severely fragmented sleep with limited control over wake events.",
    focus_kind: "person",
    focus_label: "Fragmented-sleep caregiver",
    artifact_state: "partial_artifact",
    conditions: {
      sleep_h: 5.0,
      stress_0_10: 7.5,
      caffeine_mg: 200,
      time_of_day_24h: 9,
    },
    default_lab_features: ["monte_carlo", "what_if"],
  },
  {
    seed_id: "subj_athlete",
    name: "Endurance Athlete in Training",
    description:
      "Marathon runner, 60 mi/wk, training block before goal race. Sleep is the dominant recovery lever; small architecture deficits compound.",
    focus_kind: "person",
    focus_label: "Performance-driven recovery sandbox",
    artifact_state: "complete_artifact",
    conditions: {
      sleep_h: 8.0,
      stress_0_10: 4.0,
      caffeine_mg: 100,
      time_of_day_24h: 22,
    },
    default_lab_features: ["monte_carlo", "what_if", "ab_compare"],
  },
  {
    seed_id: "subj_cbti_patient",
    name: "Chronic Insomniac in CBT-I",
    description:
      "6-month chronic insomnia (>3 nights/wk SOL >30 min). Currently in week 3 of 8-session CBT-I. Caffeine moderate, evening cortisol elevated.",
    focus_kind: "person",
    focus_label: "Active CBT-I treatment course",
    artifact_state: "partial_artifact",
    conditions: {
      sleep_h: 5.8,
      stress_0_10: 6.5,
      caffeine_mg: 150,
      time_of_day_24h: 23,
    },
    default_lab_features: ["monte_carlo", "what_if", "deepen_kg"],
  },
];

// ── Seed interventions ────────────────────────────────────────────

const SEED_INTERVENTIONS: ResearchSeedIntervention[] = [
  {
    seed_id: "iv_morning_light_protocol",
    name: "Morning Light Protocol",
    short_label: "AM Light",
    description:
      "10,000 lux light therapy box for 20–30 min within 30 min of waking, OR 15 min direct outdoor sunlight. Anchors circadian phase.",
    recommended_dose: "10,000 lux × 20–30 min, daily, within 30 min of wake",
    mechanism: "ipRGC → SCN entrainment; advances DLMO by ~0.5–1.0h within 7 days",
    layer_slug: "behaviors",
    effect_size: 0.55,
    ci_lower: 0.38,
    ci_upper: 0.72,
    color: "#F59E0B",
  },
  {
    seed_id: "iv_caffeine_cutoff",
    name: "Time-Restricted Caffeine",
    short_label: "Caffeine Cutoff",
    description:
      "Hard cutoff for caffeine intake by 2pm (or 8h before target sleep onset). Allows adenosine to rebuild.",
    recommended_dose: "≤200mg before 2pm; zero after",
    mechanism: "Restores adenosine A2A signaling at sleep onset",
    layer_slug: "behaviors",
    effect_size: 0.42,
    ci_lower: 0.28,
    ci_upper: 0.56,
    color: "#92400E",
  },
  {
    seed_id: "iv_cool_room",
    name: "Cool Bedroom Protocol",
    short_label: "Cool Room",
    description:
      "Bedroom temperature 65–68°F (18–20°C), breathable bedding, optional cooling mattress pad. Enables core-temp drop.",
    recommended_dose: "65–68°F sustained through sleep period",
    mechanism: "Facilitates 1–1.5°C core-temp drop required for SWS initiation",
    layer_slug: "behaviors",
    effect_size: 0.30,
    ci_lower: 0.18,
    ci_upper: 0.42,
    color: "#0EA5E9",
  },
  {
    seed_id: "iv_exercise_timing",
    name: "Strategic Exercise Timing",
    short_label: "Exercise Timing",
    description:
      "Aerobic exercise in AM or early PM (not within 3h of bed). 150 min/week moderate-intensity.",
    recommended_dose: "150 min/wk moderate aerobic; AM or early PM only",
    mechanism: "Increases SWS proportion; lowers evening cortisol when timed correctly",
    layer_slug: "behaviors",
    effect_size: 0.36,
    ci_lower: 0.22,
    ci_upper: 0.50,
    color: "#16A34A",
  },
  {
    seed_id: "iv_cbti",
    name: "CBT-I (Cognitive Behavioral Therapy for Insomnia)",
    short_label: "CBT-I",
    description:
      "Gold-standard 6–8-session protocol: stimulus control, sleep restriction, cognitive restructuring, sleep hygiene.",
    recommended_dose: "6–8 sessions over 8 weeks, weekly",
    mechanism: "Restores stimulus control + reduces cognitive arousal at bedtime",
    layer_slug: "behaviors",
    effect_size: 0.78,
    ci_lower: 0.62,
    ci_upper: 0.94,
    color: "#7C3AED",
  },
];

// ── Seed instruments ──────────────────────────────────────────────

const SEED_INSTRUMENTS: ResearchSeedInstrument[] = [
  {
    seed_id: "inst_psqi",
    name: "Pittsburgh Sleep Quality Index",
    short_label: "PSQI",
    description:
      "19-item validated self-report questionnaire. Global score 0–21; >5 = clinically poor sleep. Buysse 1989.",
    measures: "subjective_sleep_quality",
    layer_slug: "day_after",
    modality: "SR",
  },
  {
    seed_id: "inst_ess",
    name: "Epworth Sleepiness Scale",
    short_label: "ESS",
    description:
      "8-item scale of dozing likelihood across daily situations. 0–24; >10 = excessive daytime sleepiness. Johns 1991.",
    measures: "daytime_sleepiness",
    layer_slug: "day_after",
    modality: "SR",
  },
  {
    seed_id: "inst_actigraphy",
    name: "Actigraphy (7-day)",
    short_label: "Actigraphy",
    description:
      "Wrist-worn accelerometer. Captures total sleep time, sleep efficiency, fragmentation index across 7 nights.",
    measures: "sleep_duration_efficiency",
    layer_slug: "architecture",
    modality: "OBJ",
  },
  {
    seed_id: "inst_sol_diary",
    name: "Sleep Onset Latency Diary",
    short_label: "SOL Diary",
    description:
      "14-day sleep diary capturing self-reported time-to-sleep. Validates against actigraphy within ~5 min.",
    measures: "sleep_onset_latency",
    layer_slug: "architecture",
    modality: "SR",
  },
  {
    seed_id: "inst_waso_log",
    name: "WASO Tracking",
    short_label: "WASO",
    description:
      "Mid-night arousal log (paired with actigraphy). Captures fragmentation severity and timing.",
    measures: "wake_after_sleep_onset",
    layer_slug: "architecture",
    modality: "OBJ",
  },
];

// ── Seed apps — paired downstream applications (F3 / D14) ────────
//
// Sleep template ships with TWO complementary apps:
//
//   • Sleep Coach App      — the intervention app the user designs to
//                            improve sleep quality through coaching,
//                            nudges, schedule adherence, light protocols.
//   • Sleep Quality Monitor — the assessment app that scores the twin
//                            against PSQI, ESS, actigraphy on a baseline
//                            + post-intervention cycle.
//
// Together they form the F4 paired-app loop: intervention app pushes
// behavior change → measurement app quantifies impact → results feed
// back into the next iteration of the intervention design.

const SEED_APPS: ResearchSeedApp[] = [
  {
    seed_id: "app_sleep_coach",
    name: "Sleep Coach",
    description:
      "Design a personalized sleep coaching application — light protocols, caffeine cutoffs, wind-down cues, schedule nudges. The KG provides effect-size evidence (which lever has the largest expected impact for this twin), the twin lets you simulate before-after architecture, and the paired Quality Monitor app feeds back actual outcomes from PSQI / ESS / actigraphy.",
    app_type: "tool",
    application_type: "intervention",
    complementary_seed_ids: ["app_sleep_monitor"],
    dominant_entity_codes: [
      "iv_morning_light_protocol",
      "iv_caffeine_cutoff",
      "iv_cool_room",
      "iv_exercise_timing",
      "iv_cbti",
    ],
    tagline: "Coach a twin to better sleep, evidence-grounded.",
    rationale:
      "Sleep coaching apps fail when generic recommendations don't match the twin's specific deficit (circadian misalignment vs. fragmentation vs. cognitive arousal). The KG provides mechanism-to-deficit mapping; the paired Monitor validates that the intervention actually moved the architecture.",
  },
  {
    seed_id: "app_sleep_monitor",
    name: "Sleep Quality Monitor",
    description:
      "Run baseline + post-intervention sleep assessments using the instrument set (PSQI, ESS, actigraphy, SOL diary, WASO log). Captures objective + subjective sleep scores per twin per condition, feeds back into the Coach app for iteration, and surfaces meta-analyses of effect-size confidence intervals.",
    app_type: "monitor",
    application_type: "measurement",
    complementary_seed_ids: ["app_sleep_coach"],
    dominant_entity_codes: [
      "inst_psqi",
      "inst_ess",
      "inst_actigraphy",
      "inst_sol_diary",
      "inst_waso_log",
    ],
    tagline: "Quantify sleep change with validated instruments.",
    rationale:
      "Without measurement, coaching iteration is vibes. The Monitor app runs the instrument battery on a defined twin, captures pre-post deltas with confidence intervals (effect sizes pulled from the KG's literature pool), and routes findings back into the Coach app's protocol design.",
  },
];

// ── Pre-baked synthesis_data ──────────────────────────────────────
//
// Materialized DIRECTLY into `spaces.synthesis_data` so the side
// panels paint immediately. Real research+synthesize chain replaces
// this on async completion.

const SEED_SYNTHESIS_DATA = {
  master_bottleneck: {
    entity_id: "n_deep_sleep",
    blast_radius: 11,
    summary:
      "Deep-sleep proportion (slow-wave / N3) is the single highest-leverage lever in sleep optimization. It's the convergence point where evening cortisol, room temperature, exercise timing, and adenosine pressure all funnel into one architecture variable that drives glymphatic clearance, immune recovery, growth-hormone release, and next-day cognitive performance — and conversely, every effective intervention (light protocol, caffeine cutoff, cool room, exercise timing, CBT-I) ultimately routes its benefit through expanding this single architecture window.",
    reasoning: [
      "Deep sleep has the highest fan-out score in the graph: it drives glymphatic clearance, immune recovery, AND directly modulates next-day alertness and cognition. No other architecture variable receives this many causally-significant downstream consequences.",
      "Fan-in is similarly broad: cortisol elevation suppresses it, room temperature gates it, exercise timing modulates it, adenosine pressure builds it. Fixing any single upstream lever produces 0.20–0.35 effect sizes; fixing two simultaneously produces 0.45–0.65.",
      "Compensating mechanisms exist (REM consolidates memory, immune recovery has redundant pathways) but each only addresses one downstream consequence. Without expanding the central architecture window, single-output interventions hit ceiling effects within 4–6 weeks.",
    ],
    counterfactual_unlock:
      "If deep-sleep proportion were restored to ≥15% of total sleep (achievable via combined cool-room + caffeine cutoff + AM light protocol per Mander 2017 + Walker 2019), glymphatic clearance would expand 60%, immune-IL6 would drop 25%, day-after cognitive performance would recover 0.40 effect size, and the long-term cardiometabolic composite would shift measurably within 12 weeks.",
    candidates_considered: [
      {
        candidate: "Sleep Onset Latency",
        entity_id: "n_sleep_onset",
        why_not:
          "Critical for sleep efficiency but downstream of melatonin and cortisol — fixing SOL without expanding deep-sleep often just shortens already-fragmented sleep. Effect on long-term health is ~0.5× of deep-sleep.",
      },
      {
        candidate: "REM Sleep",
        entity_id: "n_rem_sleep",
        why_not:
          "Critical for memory consolidation but smaller fan-in (mostly alcohol, antidepressants, second-half-of-night protected by total sleep). Real but mechanistically narrower than deep-sleep.",
      },
      {
        candidate: "Total Sleep Duration",
        entity_id: null,
        why_not:
          "Often the user-visible target but a derived quantity — extending duration without restoring architecture produces shallow sleep that doesn't deliver restoration. 7h of well-architected sleep > 9h of fragmented sleep.",
      },
    ],
    when_matters: [
      {
        situation: "Chronic stress with elevated evening cortisol",
        impact: "Highest. Cortisol blocks deep-sleep generation regardless of total duration.",
        intensity: "high",
      },
      {
        situation: "Shift work or jet lag (circadian misalignment)",
        impact: "High. Deep-sleep concentrates in first half of night; misalignment costs the entire window.",
        intensity: "high",
      },
      {
        situation: "Aging populations (>60)",
        impact: "Sustained. Deep-sleep proportion drops 2–3% per decade after 30; preserving it slows cognitive aging.",
        intensity: "mid",
      },
    ],
    mechanism_grounding: {
      phenomenology:
        "Patients describe waking unrefreshed despite 'enough hours,' AM grogginess, mid-afternoon energy crash, slower morning cognition. Objective measures: deep-sleep <12% of total sleep, glymphatic clearance reduced ~40%, AM cortisol slope flattened.",
      mechanism_explanation:
        "Deep sleep is the only physiological window where cortical neurons synchronize at <4Hz and aquaporin-4 mediated paravascular CSF flow expands 60%, clearing β-amyloid and inflammatory metabolites. The window is gated by core-body-temperature drop (1–1.5°C), evening cortisol below threshold, and adenosine pressure above threshold. Failure of any one gate (warm room, stress cortisol, evening caffeine) collapses the window. The mechanism is reversible: fixing the gates restores the window within 2–3 nights.",
      literature_grounding: [
        {
          author: "Xie",
          year: 2013,
          claim:
            "Glymphatic system flow expands 60% during slow-wave sleep; clearance rates of β-amyloid double during this window. Science 342:373.",
        },
        {
          author: "Mander",
          year: 2017,
          claim:
            "Deep-sleep loss in aging mediates 28% of age-related memory decline; preservation interventions slow cognitive aging. Nature Neurosci 20:1471.",
        },
        {
          author: "Walker",
          year: 2019,
          claim:
            "Why We Sleep — comprehensive review: <6h sleep with <12% deep-sleep produces measurable next-day cognitive deficit equivalent to 0.08% blood alcohol.",
        },
      ],
      evidence_strength: "empirical",
      falsifiable_prediction:
        "12-week combined intervention (cool room + caffeine cutoff + AM light) in adults with deep-sleep <12% should produce: deep-sleep increase ≥3 percentage points (to ≥15%), glymphatic-proxy (CSF amyloid clearance) increase ≥30%, PSQI improvement ≥3 points, ESS improvement ≥2 points. Failure of architecture restoration despite duration extension would refute the deep-sleep-as-bottleneck hypothesis.",
    },
  },
  leverage_points: [
    {
      entity_id: "n_morning_light",
      entity_name: "Morning Light Exposure",
      summary:
        "The single most evidence-rich, broadly-acting circadian intervention. Anchors the entire 24h cycle — fixes melatonin onset, advances cortisol peak, sets the temperature curve, conditions evening alertness. 10,000 lux × 20 min produces measurable phase shifts within 7 days.",
      reasoning: [
        "Morning light hits the SCN's master clock directly — every downstream rhythm follows. No other single intervention has this breadth.",
        "Dose-response is well-characterized: 10,000 lux × 20 min ≈ 30 min outdoor sunlight on a cloudy day. Threshold ~1,000 lux for entrainment; above 10,000 adds little.",
        "Compounding: anchored circadian phase enables every other intervention to land — caffeine cutoff times work, evening cortisol drops, melatonin rises on schedule. The cycle takes 1–2 weeks to establish but is durable once stable.",
      ],
      how_it_works: [
        "Melanopsin-bearing retinal ganglion cells (ipRGCs) signal directly to SCN — the master circadian pacemaker",
        "SCN entrainment advances DLMO (dim-light melatonin onset) by 0.5–1.0h within 7 days",
        "Cortisol awakening response sharpens — AM peak rises, evening trough deepens",
        "Core temperature curve aligns — peak shifts earlier, allowing earlier evening drop required for deep sleep",
      ],
      when_matters: [
        {
          situation: "Delayed sleep phase (night-owl pattern)",
          impact: "Highest. AM light is the only effective phase-advance lever; produces 0.5–1.5h DLMO shift over 2 weeks.",
          intensity: "high",
        },
        {
          situation: "Shift work / jet lag",
          impact: "High. Strategic light timing can compress adaptation from 1 day per timezone to half that.",
          intensity: "high",
        },
        {
          situation: "Stable sleep but suboptimal architecture",
          impact: "Mid. Subtle improvements to cortisol curve + evening melatonin onset.",
          intensity: "mid",
        },
      ],
      action: {
        primary:
          "10,000 lux light therapy box for 20–30 min within 30 min of waking, OR 15 min direct outdoor sunlight. Track DLMO via salivary melatonin OR sleep-tracker midpoint over 2 weeks. Adjust timing earlier if DLMO is later than 22:00.",
        alternatives: [
          {
            when: "Indoor work without morning sunlight access",
            approach: "10,000 lux desk light box OR dawn-simulator alarm clock with 30 min ramp.",
            tradeoff: "Slightly weaker than direct sunlight but produces 75% of the effect at 10–15% of the cost.",
          },
          {
            when: "Living at high latitudes in winter",
            approach: "Add midday sunlight exposure when available; light box becomes essential year-round.",
            tradeoff: "Adherence is the main risk — make it a non-negotiable morning habit.",
          },
        ],
      },
      connections: [
        "Activates the Coach ↔ Monitor loop — better circadian anchoring enables coaching protocols to land, which produces measurable PSQI deltas",
        "Synergizes with caffeine cutoff (n_caffeine_intake) — anchored cortisol peak means earlier-day caffeine has shorter functional half-life",
        "Lowers evening cortisol (n_cortisol) by reshaping the diurnal curve",
      ],
      mechanism_grounding: {
        phenomenology:
          "Users report subjective alertness improvement within 3–4 days, easier sleep onset within 1 week, and feeling 'naturally tired' at appropriate evening hour within 2 weeks.",
        mechanism_explanation:
          "Morning light triggers melanopsin → ipRGC firing → SCN entrainment → genome-wide circadian gene expression resets. The mechanism is rhythm-anchoring, not energy injection — even brief exposure produces phase shifts before any subjective alertness change.",
        literature_grounding: [
          {
            author: "Czeisler",
            year: 1989,
            claim:
              "Bright light (≥2,500 lux × 5h) produces robust phase shifts of human circadian pacemaker; 10,000 lux × 20 min sufficient for daily anchoring. Science 244:1328.",
          },
          {
            author: "Wright",
            year: 2013,
            claim:
              "1 week of camping-only natural light reset DLMO in night-owls by 2.0–2.5h. Curr Biol 23:1554.",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "2-week morning light protocol (10,000 lux × 20 min within 30 min of wake) in adults with DLMO >22:30 should produce: DLMO advance ≥1.0h, sleep onset latency reduction ≥10 min, AM alertness improvement ≥0.5 effect size on KSS. Failure of DLMO advance would refute the entrainment-mediated mechanism.",
      },
    },
    {
      entity_id: "n_caffeine_intake",
      entity_name: "Caffeine Intake (Timing)",
      summary:
        "The most under-appreciated lever. Caffeine half-life is 5–6h; 200mg at 2pm leaves 100mg circulating at 8pm — enough to block adenosine signaling and prevent deep-sleep gating. Most users dramatically underestimate the temporal footprint.",
      reasoning: [
        "Caffeine is the highest-impact lever you can fix immediately. Hard cutoff at 2pm requires no equipment, no expense, no coordination — produces effect within 3–5 days.",
        "Adenosine pressure is the homeostatic gate for deep-sleep onset. Even sub-clinical caffeine concentrations (50–100mg) measurably reduce deep-sleep proportion in PSG studies.",
        "Quick wins: nearly every user has a fixable caffeine timing pattern (afternoon coffee, evening tea, dark chocolate post-dinner) that produces measurable deep-sleep increase within 1–2 weeks.",
      ],
      how_it_works: [
        "Caffeine antagonizes adenosine A2A receptors — the molecular gate for sleep pressure",
        "Half-life 5–6h means 25–50% of dose still circulating at sleep onset for afternoon caffeine",
        "Reduced adenosine signaling delays sleep onset AND reduces deep-sleep proportion in the first cycle",
        "Compounding fragmentation — disrupted first deep-sleep cycle propagates through the night via sleep architecture",
      ],
      when_matters: [
        {
          situation: "Habitual afternoon coffee drinker",
          impact: "Highest. 200–400mg afternoon dose typically reduces deep-sleep by 15–25%.",
          intensity: "high",
        },
        {
          situation: "Slow CYP1A2 metabolizer (genetic variant)",
          impact: "High. Caffeine half-life can extend to 8–10h; even 8am coffee can affect sleep.",
          intensity: "high",
        },
        {
          situation: "Pre-bed dark chocolate / decaf habit",
          impact: "Mid. Smaller doses (10–30mg) but timing matters; cumulative footprint can be significant.",
          intensity: "mid",
        },
      ],
      action: {
        primary:
          "Hard 2pm cutoff for all caffeine. Track via diary or app. Re-evaluate sleep architecture (actigraphy or sleep tracker) at 2 weeks. If still impaired, consider further restriction to 12pm or zero.",
        alternatives: [
          {
            when: "Slow caffeine metabolizer (CYP1A2 *1F/*1F)",
            approach: "Limit to AM only (<10am) and ≤200mg total daily.",
            tradeoff: "Genetic testing (~$50) confirms; can also be inferred from coffee->insomnia history.",
          },
          {
            when: "Caffeine-dependent for daytime function",
            approach: "Taper by 50mg/week; substitute green tea (lower caffeine + L-theanine).",
            tradeoff: "Withdrawal headache for 3–5 days; energy dip for 2 weeks before adaptation.",
          },
        ],
      },
      connections: [
        "Direct lever on adenosine pressure (n_adenosine) — the homeostatic gate for sleep onset",
        "Synergizes with morning light (n_morning_light) — anchored circadian rhythm makes earlier-day caffeine more functional",
        "Affects deep-sleep architecture (n_deep_sleep) downstream of adenosine",
      ],
      mechanism_grounding: {
        phenomenology:
          "Users initially report worse sleep for 3–5 days during caffeine-timing transition (withdrawal effects), then progressive improvement over 2 weeks. Sleep tracker data typically shows deep-sleep proportion increase of 2–4 percentage points by week 3.",
        mechanism_explanation:
          "Caffeine is a competitive A2A receptor antagonist. Even at sub-stimulant concentrations (100mg circulating), it blocks adenosine signaling sufficient to delay sleep onset and reduce SWS proportion. The mechanism is direct receptor competition, not indirect arousal — measurable in PSG studies even when subjects report 'no effect.'",
        literature_grounding: [
          {
            author: "Drake",
            year: 2013,
            claim:
              "400mg caffeine 6h before bed reduced TST by 1.0h and SWS by 11% in PSG study; subjects underestimated effect by 60%. J Clin Sleep Med 9:1195.",
          },
          {
            author: "Landolt",
            year: 1995,
            claim:
              "200mg caffeine in evening reduced delta-power EEG by 25% during first sleep cycle. Brain Res 675:67.",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "2-week caffeine cutoff (zero after 2pm) in habitual afternoon coffee drinkers should produce: deep-sleep proportion increase ≥2 percentage points, sleep onset latency reduction ≥5 min, PSQI improvement ≥1 point. Failure to produce architecture changes would suggest non-caffeine-driven sleep impairment dominant.",
      },
    },
    {
      entity_id: "n_cortisol",
      entity_name: "Evening Cortisol",
      summary:
        "The hardest-to-fix but highest-impact downstream lever. Chronic evening cortisol elevation blocks deep-sleep generation regardless of every other lever. Often invisible because AM serum cortisol looks normal — diurnal slope is what matters.",
      reasoning: [
        "Evening cortisol below threshold is REQUIRED for deep-sleep. Above threshold, no amount of room-cooling, caffeine-cutoff, or AM-light intervention produces full deep-sleep recovery.",
        "Diagnosis is hard: AM serum cortisol can look normal while diurnal slope is flattened. 4-sample salivary cortisol or hair cortisol catches it; standard labs miss it 60% of the time.",
        "Compounds with stress: chronic stress → elevated evening cortisol → reduced deep-sleep → reduced glymphatic clearance → next-day inflammation → more cortisol. The loop, once established, is hard to break without dedicated stress-axis intervention.",
      ],
      how_it_works: [
        "Cortisol >threshold blocks delta-wave generation in the cortex — directly suppresses deep-sleep",
        "Chronic elevation produces glucocorticoid receptor desensitization (Cohen 2012) — cortisol becomes less responsive to feedback",
        "Disrupted diurnal rhythm propagates: elevated evening → suppressed AM peak → flattened slope → sustained 24h elevation",
        "Suppresses growth hormone release that normally co-occurs with deep-sleep — compounds metabolic deficits",
      ],
      when_matters: [
        {
          situation: "Chronic stress (caregiver, job, ongoing health concern)",
          impact: "Highest. HPA stays activated; deep-sleep loop never resolves.",
          intensity: "high",
        },
        {
          situation: "Comorbid anxiety or depression",
          impact: "High. Anxiety + cortisol dysregulation are mutually-reinforcing.",
          intensity: "high",
        },
      ],
      mitigation: {
        primary:
          "Test cortisol diurnal slope (4-sample saliva or hair cortisol — NOT just AM serum). If flattened, prescribe MBSR (8-week program, effect size 0.5 on cortisol slope) + sleep optimization. Re-test at 12 weeks. CBT-I addresses the same target via cognitive arousal pathway.",
        alternatives: [
          {
            when: "MBSR not accessible",
            approach: "Yoga (Iyengar variant) + slow breathing protocols — produce similar cortisol-slope effects with smaller (0.30–0.40) effect size.",
            tradeoff: "Less standardized; outcome variance is higher.",
          },
        ],
      },
      connections: [
        "Bidirectionally coupled with WASO (n_waso) — the central insomnia loop",
        "Drives deep-sleep architecture (n_deep_sleep) suppression",
        "Modulated by wind-down ritual (n_wind_down) — the cheapest behavioral lever",
      ],
      mechanism_grounding: {
        phenomenology:
          "Users describe 'wired but tired' — exhausted yet unable to relax, AM grogginess, afternoon energy crash, sleep-onset difficulty despite fatigue.",
        mechanism_explanation:
          "Evening cortisol >5 µg/dL blocks delta-wave generation. Chronic elevation produces receptor-level desensitization — feedback loops fail, baseline rises. The mechanism is receptor-level, not just hormone level — which is why elevated cortisol can coexist with subjective stress 'tolerance.'",
        literature_grounding: [
          {
            author: "Vgontzas",
            year: 2001,
            claim:
              "Insomnia patients show 24h elevation in plasma cortisol, especially evening trough fails to drop. J Clin Endocrinol Metab 86:3787.",
          },
          {
            author: "van Cauter",
            year: 2007,
            claim:
              "Sleep restriction itself elevates evening cortisol by 30–50%; bidirectional coupling makes the loop self-reinforcing.",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "8-week MBSR in insomniacs with documented flattened diurnal cortisol slope should produce: cortisol slope steepening (>30% improvement), deep-sleep proportion increase ≥3 percentage points, PSQI improvement ≥3 points. Failure of cortisol slope to normalize despite sleep improvement would suggest a different mechanism.",
      },
    },
  ],
  risk_points: [
    {
      entity_id: "n_alcohol_intake",
      entity_name: "Alcohol Intake (Evening)",
      blast_radius: 8,
      summary:
        "Evening alcohol is the most dangerous self-inflicted sleep injury. Speeds onset (subjectively pleasant) but suppresses REM 30–50%, increases mid-night arousals, and disrupts thermoregulation. Users dramatically underestimate the cost.",
      reasoning: [
        "Alcohol's sedative effect deceives — users feel they 'sleep better' because onset is faster, but architecture is severely degraded.",
        "REM suppression is concentration-dependent and persists throughout metabolism. Even 1 drink reduces REM by ~10%; 3+ drinks by 30–50%.",
        "Mid-night arousal pattern is the giveaway — alcohol metabolites (acetaldehyde) trigger noradrenergic activation 3–4h post-ingestion, causing the classic 3am wake-up.",
      ],
      how_it_fails: [
        "Initial GABA-A potentiation accelerates onset → user perceives 'better sleep'",
        "REM suppression during first half → memory consolidation impaired",
        "Acetaldehyde rebound at 3–4h → noradrenergic surge → mid-night wake",
        "Disrupted thermoregulation → night sweats → fragmented later-night sleep",
      ],
      when_matters: [
        {
          situation: "≥2 drinks within 3h of bedtime",
          impact: "Highest. Architecture severely degraded; effect compounds over consecutive nights.",
          intensity: "high",
        },
        {
          situation: "1 drink with dinner (>3h before bed)",
          impact: "Mid. Smaller architecture impact; can be tolerable for non-sensitive sleepers.",
          intensity: "mid",
        },
      ],
      mitigation: {
        primary:
          "Hard cutoff: no alcohol within 3h of bedtime. If recreational drinking continues, limit to ≤2 drinks and finish 4+ hours before bed. Monitor architecture via sleep tracker — REM proportion should stay ≥18%.",
        alternatives: [
          {
            when: "Social drinking is non-negotiable",
            approach: "Front-load: drinks before 7pm, hard stop. Hydrate aggressively. Expect architecture penalty.",
            tradeoff: "Even with optimization, expect 10–20% REM reduction nights of drinking.",
          },
        ],
      },
      connections: [
        "Suppresses REM (n_rem_sleep) — directly impairs memory consolidation",
        "Increases WASO (n_waso) via metabolite rebound — the central fragmentation pathway",
        "Compounds with cortisol (n_cortisol) — alcohol's HPA activation persists into next day",
      ],
      mechanism_grounding: {
        phenomenology:
          "Users report 'easy onset, broken middle, exhausted morning' pattern. Sleep tracker data typically shows: SOL ≤10 min, deep-sleep slightly elevated in first cycle, then degradation through second half — REM <15%, WASO >45 min.",
        failure_mechanism:
          "Alcohol potentiates GABA-A in first half (sedation) → metabolizes to acetaldehyde → triggers noradrenergic system → arousal cascade in second half. The mechanism is biphasic: same molecule produces sedation then activation as it metabolizes.",
        literature_grounding: [
          {
            author: "Ebrahim",
            year: 2013,
            claim:
              "Meta-analysis n>4,000: alcohol reduces REM by 12–35% in dose-dependent fashion; effect persists 3–4h post-clearance. Alcohol Clin Exp Res 37:539.",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "2-week elimination of evening alcohol in habitual evening drinkers (≥3 drinks/week) should produce: REM proportion increase ≥3 percentage points, WASO reduction ≥15 min, PSQI improvement ≥1 point. Failure would suggest alcohol is not the dominant impairment.",
      },
    },
  ],
  feedback_loops: [
    {
      name: "Insomnia reinforcing cycle (cortisol ↔ WASO)",
      type: "negative",
      steps: [
        "Stress or stimulus elevates evening cortisol (n_cortisol)",
        "Elevated cortisol blocks deep-sleep (n_deep_sleep)",
        "Reduced deep-sleep increases WASO — fragmentation rises (n_waso)",
        "Each mid-night wake produces cortisol pulse — cortisol stays elevated",
        "Next night starts with elevated baseline cortisol — loop tightens",
      ],
      intervention_at: 0,
      explanation:
        "The central self-sustaining loop in chronic insomnia. Once established (typically by week 2–3 of acute insomnia), it persists without continuing stressor because cortisol's normal evening drop has flipped — wake events themselves elevate cortisol.",
      how_to:
        "Break at step 0 (cortisol) via wind-down + MBSR/CBT-I AND step 2 (deep-sleep) via cool room + caffeine cutoff. Single-step interventions slow the cycle but rarely break it; combined interventions break it within 2–4 weeks.",
      when_active: [
        {
          situation: "Acute or chronic insomnia",
          impact: "Loop is dominant — most patients in this state benefit from breaking it.",
          intensity: "high",
        },
        {
          situation: "Stable but suboptimal sleep",
          impact: "Subclinical loop — small interventions can preempt full establishment.",
          intensity: "mid",
        },
      ],
    },
    {
      name: "Recovery compounding cycle (light → cortisol → deep-sleep)",
      type: "positive",
      steps: [
        "Morning light anchors cortisol awakening response — sharp peak (n_morning_light)",
        "Sharp peak → sharp evening trough (cortisol falls below threshold) (n_cortisol)",
        "Low evening cortisol enables deep-sleep window (n_deep_sleep)",
        "Deep sleep drives glymphatic clearance + immune recovery — reduced inflammation",
        "Reduced inflammation → smaller HPA activation next day → easier evening cortisol drop",
        "Each cycle reinforces — loop self-sustains within 2 weeks",
      ],
      intervention_at: 0,
      explanation:
        "The most clinically important positive loop. Once seeded with 2 weeks of structured AM light exposure, it self-sustains because the architecture window expands, which improves recovery, which lowers stress, which deepens the next cycle.",
      how_to:
        "Seed with structured 2-week morning light protocol (10,000 lux × 20 min, daily). Adherence is the dominant predictor — irregular protocols never establish the loop; consistent protocols reliably establish it within 7–14 days.",
      when_active: [
        {
          situation: "Active treatment phase / behavior change window",
          impact: "Therapeutic window — full establishment possible with structured protocol.",
          intensity: "high",
        },
      ],
    },
  ],
  intelligence_radar: {
    signals: [
      {
        id: "sig_deep_glymph",
        name: "Deep-sleep drives 60% of glymphatic clearance",
        description:
          "Aquaporin-4 mediated CSF flow expands 60% during slow-wave sleep (Xie 2013). β-amyloid clearance rate doubles. The strongest mechanism→outcome edge in the graph.",
        intensity: "high",
        category: "mechanism",
        related_entities: ["n_deep_sleep", "n_glymphatic"],
      },
      {
        id: "sig_caffeine_underestimation",
        name: "Users underestimate caffeine's sleep impact by 60%",
        description:
          "Drake 2013: 400mg caffeine 6h pre-bed reduced TST 1h and SWS 11% in PSG; subjects rated 'no effect.' Subjective report is unreliable; objective measurement essential.",
        intensity: "high",
        category: "diagnostic",
        related_entities: ["n_caffeine_intake", "n_deep_sleep"],
      },
      {
        id: "sig_alcohol_rem",
        name: "Evening alcohol reduces REM 12–35%",
        description:
          "Dose-dependent REM suppression with biphasic profile. 'Easy onset, broken middle' is the signature. Most-underestimated nightly intervention.",
        intensity: "high",
        category: "intervention",
        related_entities: ["n_alcohol_intake", "n_rem_sleep"],
      },
      {
        id: "sig_cortisol_diurnal",
        name: "Standard AM cortisol misses 60% of HPA dysregulation",
        description:
          "Diurnal SLOPE (4-sample salivary or hair) catches what AM serum misses. Insomniacs show flattened slope in 60% of cases (Vgontzas 2001).",
        intensity: "high",
        category: "diagnostic",
        related_entities: ["n_cortisol", "n_waso"],
      },
      {
        id: "sig_cbti_gold",
        name: "CBT-I produces effect size 0.7+ for chronic insomnia",
        description:
          "Gold-standard treatment, comparable or superior to pharmacotherapy with durable post-treatment effects. 6–8 sessions sufficient for most patients.",
        intensity: "high",
        category: "intervention",
        related_entities: ["iv_cbti", "n_sleep_onset"],
      },
      {
        id: "sig_shift_work",
        name: "Shift workers show 48% CVD risk increase",
        description:
          "Long-term circadian misalignment is a major modifiable cardiometabolic risk factor. Strategic light + meal timing can reduce risk substantially.",
        intensity: "mid",
        category: "population",
        related_entities: ["n_morning_light", "n_long_term_health"],
      },
    ],
    schedule: [
      {
        cadence: "weekly",
        action: "Sleep diary + adherence check-in",
        rationale: "Catches drift early; adherence is the dominant outcome predictor.",
      },
      {
        cadence: "monthly",
        action: "PSQI + ESS + actigraphy week",
        rationale: "Detect 0.20+ effect-size changes within 4-week windows.",
      },
      {
        cadence: "quarterly",
        action: "4-sample salivary cortisol + full PSG (if available)",
        rationale: "Track underlying mechanism, not just symptoms.",
      },
    ],
    workstreams: [
      {
        name: "Circadian anchoring",
        priority: "primary",
        owner: "Behavioral health + sleep medicine",
        target_metric: "DLMO advance ≥0.5h within 2 weeks",
      },
      {
        name: "Architecture restoration",
        priority: "primary",
        owner: "Sleep medicine",
        target_metric: "Deep-sleep ≥15% + WASO <30 min",
      },
      {
        name: "Stress-axis intervention",
        priority: "secondary",
        owner: "Behavioral health (CBT-I or MBSR)",
        target_metric: "Diurnal cortisol slope >−0.05 µg/dL/h",
      },
    ],
  },
  suggested_objectives: [
    {
      objective: "Restore deep-sleep architecture",
      metric: "Deep-sleep ≥15% + total sleep 7–7.5h sustained over 4 weeks",
      target_entity_id: "n_deep_sleep",
      priority: "high",
    },
    {
      objective: "Anchor circadian phase",
      metric: "DLMO ≤22:00 stable across 14 nights",
      target_entity_id: "n_melatonin",
      priority: "high",
    },
    {
      objective: "Eliminate afternoon caffeine",
      metric: "Zero caffeine after 2pm sustained over 4 weeks",
      target_entity_id: "n_caffeine_intake",
      priority: "high",
    },
    {
      objective: "Reduce evening cortisol",
      metric: "Diurnal cortisol slope steepened ≥30%",
      target_entity_id: "n_cortisol",
      priority: "medium",
    },
    {
      objective: "Improve PSQI score",
      metric: "PSQI <5 sustained over 4 weeks",
      target_entity_id: "inst_psqi",
      priority: "high",
    },
  ],
  action_plan: {
    paths: [
      {
        label: "Standard sleep optimization",
        description: "8-week protocol for adults with PSQI 6–10 (mild-to-moderate sleep impairment).",
        icon: "🌙",
        color: "#2563EB",
        timeframes: [
          {
            label: "Today",
            badge: "!",
            actions: [
              {
                text: "Run baseline PSQI + 7-day actigraphy + caffeine diary",
                why: "Establishes the deficit profile — without this, intervention selection is guessing.",
                tags: [{ t: "starts loop", c: "#34C759" }],
                dynamic_role: "clears_threshold",
                cost_of_delay: "Each week without baseline = a week of intervention potentially mistargeted.",
              },
              {
                text: "Hard caffeine cutoff at 2pm — no exceptions",
                why: "Cheapest, fastest-acting lever; produces measurable architecture changes within 1 week.",
                tags: [{ t: "fixes bottleneck", c: "#FF3B30" }],
                dynamic_role: "clears_threshold",
                cost_of_delay: "Each day of afternoon caffeine = ~10% deep-sleep penalty.",
              },
            ],
          },
          {
            label: "This week",
            badge: "7",
            actions: [
              {
                text: "Begin 10,000 lux × 20 min morning light, daily within 30 min of wake",
                why: "Anchors the circadian system; conditions response to every other intervention.",
                tags: [{ t: "starts flywheel", c: "#34C759" }],
                dynamic_role: "starts_loop",
                cost_of_delay: null,
              },
              {
                text: "Bedroom temperature to 65–68°F + breathable bedding",
                why: "Enables core-temp drop required for deep-sleep onset. Set-and-forget.",
                tags: [{ t: "starts flywheel", c: "#34C759" }],
                dynamic_role: "starts_loop",
                cost_of_delay: null,
              },
            ],
          },
          {
            label: "This month",
            badge: "30",
            actions: [
              {
                text: "Add structured wind-down ritual (60–90 min pre-bed)",
                why: "Once cortisol curve is partially anchored, wind-down reinforces the evening trough.",
                tags: [{ t: "amplifies loop", c: "#FF9500" }],
                dynamic_role: "accelerates_loop",
                cost_of_delay: null,
              },
              {
                text: "If PSQI still >5 and SOL >30 min: begin CBT-I (6–8 sessions)",
                why: "Gold-standard intervention for chronic insomnia; effect size 0.7+.",
                tags: [{ t: "fixes bottleneck", c: "#FF3B30" }],
                dynamic_role: "clears_threshold",
                cost_of_delay: null,
              },
            ],
          },
          {
            label: "After validation",
            badge: "✓",
            actions: [
              {
                text: "Re-run PSQI + actigraphy at week 8",
                why: "Quantify the response; recalibrate targeting if PSQI improvement <3 points.",
                tags: [{ t: "validates flywheel", c: "#007AFF" }],
                dynamic_role: "clears_threshold",
                cost_of_delay: null,
              },
            ],
          },
        ],
      },
    ],
  },
  worth_considering: [
    {
      type: "framework",
      title: "Two-process model (Borbély 1982)",
      description:
        "Sleep regulation = circadian Process C × homeostatic Process S. AM light fixes Process C (phase); caffeine cutoff fixes Process S (pressure). The framework predicts that fixing only one process produces incomplete benefit — most chronic sleep issues require both. Aligns with the multi-lever intervention strategy.",
      confidence: "high",
      connected_entities: ["n_morning_light", "n_caffeine_intake", "n_adenosine"],
      source_note: "Borbély 1982; canonical model widely validated in sleep research",
      relevance_score: 9,
      ranking_reason:
        "Provides the theoretical foundation for why combined interventions outperform single-lever pulls.",
      source_origin: "llm_synthesis",
    },
    {
      type: "blind_spot",
      title: "Sleep apnea screening",
      description:
        "Up to 25% of adults with chronic sleep complaints have undiagnosed obstructive sleep apnea. Standard sleep optimization protocols can hide it — patients with OSA show normal PSQI but pathological architecture. STOP-BANG questionnaire in baseline can flag candidates for home sleep study before optimizing the wrong lever.",
      confidence: "high",
      connected_entities: ["n_waso", "n_deep_sleep"],
      source_note: "Chung 2008; STOP-BANG questionnaire validated for OSA screening",
      relevance_score: 9,
      ranking_reason:
        "High-impact omission — optimizing sleep hygiene without addressing OSA produces frustrated patients and false-negative effect sizes.",
      source_origin: "llm_synthesis",
    },
    {
      type: "precedent",
      title: "MATRICS RCT (CBT-I in chronic insomnia, n=159)",
      description:
        "Stanford-based 8-session CBT-I in chronic insomnia. Found: PSQI effect size 0.85, SOL reduction 18 min, WASO reduction 22 min, durable at 12-month follow-up. Closest empirical validation of the standard recovery path.",
      confidence: "high",
      connected_entities: ["iv_cbti", "n_sleep_onset", "n_waso"],
      source_note: "Manber 2008, Sleep 31:489",
      relevance_score: 8,
      ranking_reason:
        "Direct empirical validation of CBT-I-as-default for chronic insomnia with measured outcomes.",
      source_origin: "llm_synthesis",
    },
  ],
  open_questions: [
    {
      question:
        "Does timed melatonin supplementation outperform morning light alone for delayed sleep phase?",
      why_it_matters:
        "Morning light is anchoring (proven 0.5–1.0h DLMO advance over 2 weeks); melatonin (0.3–0.5mg, 5h before target sleep) may produce faster phase shifts. Combined protocols may compound — but few RCTs have tested.",
      what_changes:
        "If combined protocol produces super-additive effect, recommend dual-route for severe phase delays. If only additive, simplicity argues for light-only.",
      priority: "medium",
      ranking_reason:
        "Moderate clinical impact; affects intervention complexity for delayed-phase patients.",
      related_entity_ids: ["n_morning_light", "n_melatonin"],
    },
    {
      question:
        "What's the dose-response curve for sleep-tracker adherence below daily use?",
      why_it_matters:
        "Most published protocols enforce daily wear. Real-world adherence is 60–80%. We need to know whether the diagnostic value drops linearly or has a threshold.",
      what_changes:
        "If threshold, recommend mandatory daily wear via gamification. If linear, weekly subset is acceptable for monitoring.",
      priority: "medium",
      ranking_reason:
        "Practical question affecting real-world deployability.",
      related_entity_ids: ["inst_actigraphy"],
    },
    {
      question:
        "Does cool room (65–68°F) outperform sleep-mask + earplugs for fragmentation reduction?",
      why_it_matters:
        "Both interventions target nighttime arousals but via different mechanisms (thermoregulation vs sensory shielding). Direct comparisons are rare.",
      what_changes:
        "Affects which intervention to prioritize when budget / control is limited.",
      priority: "low",
      ranking_reason:
        "Practical optimization question; either lever produces meaningful benefit.",
      related_entity_ids: ["n_room_temperature", "n_waso"],
    },
  ],
  domain_signature: {
    template_slug: "sleep_optimization",
    seeded_at: "2026-04-28T00:00:00Z",
    primary_outcome_entity: "n_long_term_health",
    central_pathway_entity: "n_deep_sleep",
    intervention_count: 5,
    instrument_count: 5,
    edge_count_with_effect_sizes: 26,
    notes:
      "Hand-authored from Walker, Czeisler, Mander, van Cauter, Buysse literature. Provides full demo content for sleep-template spaces; real research+synthesize chain replaces this on async completion.",
  },
};

// ── The template object ───────────────────────────────────────────

export const SLEEP_OPTIMIZATION_TEMPLATE: ResearchTemplate = {
  slug: "sleep_optimization",
  title: "Sleep Quality & Recovery Optimization",
  tagline:
    "Architecture, circadian timing, and recovery under stress, caffeine, alcohol, exercise timing, and shift-work conditions.",
  description:
    "A research-grade workspace built on a 22-node knowledge graph spanning seven layers from external zeitgebers (morning light, room temperature, meal timing) through behavioral inputs (caffeine, exercise, alcohol, wind-down) and circadian hormones (melatonin, evening cortisol, adenosine pressure) to sleep architecture (onset latency, deep-sleep, REM, WASO), restoration mechanisms (glymphatic clearance, memory consolidation, immune recovery), day-after outcomes (alertness, cognition, mood), and the long-term cardiometabolic composite. Edge effect sizes pulled from the published sleep-science literature (Walker, Czeisler, Mander, van Cauter, Buysse, Drake, Vgontzas, Xie) with heterogeneity (I²) and study counts attached. Pre-populated with four contrasting twins (Night-Shift Nurse / New Parent / Endurance Athlete / Chronic Insomniac in CBT-I), five intervention kernels (morning light, caffeine cutoff, cool room, exercise timing, CBT-I), and five validated instruments (PSQI, ESS, actigraphy, SOL diary, WASO log), all wired into the lab so you can drag, modulate, and simulate from the moment the canvas paints.",
  icon: "Moon",
  accent_color: "#2563EB",
  accent_color_light: "#DBEAFE",
  domain_tags: [
    "sleep",
    "sleep optimization",
    "circadian rhythm",
    "insomnia",
    "shift work",
    "recovery",
    "sleep architecture",
    "CBT-I",
    "chronotherapy",
  ],
  source_citations: [
    "Walker 2019 (Why We Sleep — comprehensive sleep-science review)",
    "Czeisler 1989 (bright-light circadian phase shifts, Science)",
    "Xie 2013 (glymphatic clearance during slow-wave sleep, Science)",
    "Mander 2017 (sleep and cognitive aging, Nature Neuroscience)",
    "van Cauter 2007 (sleep restriction and HPA elevation)",
    "Drake 2013 (caffeine timing and sleep architecture)",
    "Vgontzas 2001 (insomnia and 24h cortisol elevation)",
    "Buysse 1989 (PSQI validation)",
    "Manber 2008 (MATRICS CBT-I RCT)",
  ],
  default_space_name: "Sleep Optimization · {{date}}",
  default_description:
    "Sleep quality and recovery optimization research workspace. Pre-populated with a 22-node knowledge graph, 4 starter twins, 5 interventions, 5 instruments, and edge-level effect sizes from the published sleep-science literature.",

  ontology_layers: LAYER_DEFS,
  seed_nodes: SEED_NODES,
  seed_edges: SEED_EDGES,
  seed_subjects: SEED_SUBJECTS,
  seed_interventions: SEED_INTERVENTIONS,
  seed_instruments: SEED_INSTRUMENTS,
  seed_apps: SEED_APPS,
  seed_synthesis_data: SEED_SYNTHESIS_DATA,
};
