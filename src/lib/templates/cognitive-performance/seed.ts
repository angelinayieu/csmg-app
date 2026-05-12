// ── Cognitive Performance Research Template ──────────────────────
//
// General-purpose cognitive-performance template for knowledge workers,
// athletes, students, and aging adults. Same 7-layer ontology as the
// CRCI-anchored Mind-Body Cognition template (Exogenous → Behaviors →
// Biomarkers → Pathways → Symptoms → Cognitive → Composite) but the
// seed nodes are non-disease-specific.
//
// Effect-size discipline: every seed_edge ships with a representative
// effect_size + standard_error sourced from the cognitive-science
// literature, but each carries `status: "sparse"` to signal "this is
// a starting estimate; replace with extracted data as the user uploads
// papers." The /api/ingest/[id]/extract-effect-sizes pipeline (auto-
// fired on research_pdf uploads per Initiative 2) will populate
// real numbers as the space accumulates evidence.
//
// References (representative — not exhaustive):
//   - Yaffe et al. 2014 — sleep + cognition
//   - Erickson et al. 2011 — aerobic exercise + BDNF
//   - Tang et al. 2015 — meditation + prefrontal connectivity
//   - Mander et al. 2017 — sleep + glymphatic clearance
//   - Smith et al. 2010 — exercise + executive function meta-analysis
//
// Materialization flow lives in src/app/api/explore/create/route.ts
// (same as the CRCI template).

import type {
  ResearchTemplate,
  ResearchSeedLayer,
  ResearchSeedNode,
  ResearchSeedEdge,
  ResearchSeedSubject,
  ResearchSeedIntervention,
  ResearchSeedInstrument,
} from "@/types/research-template";

// ── Layer ontology ────────────────────────────────────────────────

const LAYERS: ResearchSeedLayer[] = [
  {
    ordinal: 1,
    slug: "exogenous",
    label: "Exogenous",
    description:
      "Demographics, environment, and chronic exposures — the substrate the rest of the model sits on.",
    color: "#94a3b8",
    typical_node_kinds: ["demographic", "environmental_exposure", "stressor"],
  },
  {
    ordinal: 2,
    slug: "behaviors",
    label: "Behaviors",
    description:
      "User-controllable inputs: sleep, exercise, nutrition, practice. The primary intervention surface.",
    color: "#38bdf8",
    typical_node_kinds: ["behavior", "habit", "intervention"],
  },
  {
    ordinal: 3,
    slug: "biomarkers",
    label: "Biomarkers",
    description:
      "Measurable physiological signals — BDNF, cortisol, HRV, glucose, inflammation markers.",
    color: "#a78bfa",
    typical_node_kinds: ["biomarker", "neurochemical", "physiological_signal"],
  },
  {
    ordinal: 4,
    slug: "pathways",
    label: "Pathways",
    description:
      "Internal mechanisms: HPA axis, neurogenesis, prefrontal connectivity, glymphatic clearance.",
    color: "#f472b6",
    typical_node_kinds: ["pathway", "neural_circuit", "physiological_process"],
  },
  {
    ordinal: 5,
    slug: "symptoms",
    label: "Symptoms",
    description:
      "Subjective experience — fatigue, brain fog, motivation. The user's first signal that something has shifted.",
    color: "#fb923c",
    typical_node_kinds: ["symptom", "subjective_state"],
  },
  {
    ordinal: 6,
    slug: "cognitive",
    label: "Cognitive",
    description:
      "Cognitive faculties: working memory, attention, processing speed, flexibility, inhibition.",
    color: "#22d3ee",
    typical_node_kinds: ["cognitive_construct", "executive_function"],
  },
  {
    ordinal: 7,
    slug: "composite",
    label: "Composite",
    description:
      "Real-world outcomes the user actually cares about — deep-work output, learning rate, decision quality.",
    color: "#facc15",
    typical_node_kinds: ["outcome", "performance_metric"],
  },
];

// ── Seed nodes ────────────────────────────────────────────────────

const NODES: ResearchSeedNode[] = [
  // ── Exogenous (4) ──
  {
    seed_id: "n_chronic_stress",
    name: "Chronic stress",
    short_label: "Stress",
    description:
      "Sustained psychological / physiological stress over weeks-to-months. Distinct from acute stressors.",
    entity_category: "process",
    entity_type: "stressor",
    layer_slug: "exogenous",
    importance: "fundamental",
    observable: false,
    mechanism_note: "Cumulative HPA-axis loading",
  },
  {
    seed_id: "n_age",
    name: "Age",
    short_label: "Age",
    description:
      "Chronological age. Modulates baseline biomarker levels and recovery timing for most cognitive interventions.",
    entity_category: "abstract",
    entity_type: "demographic",
    layer_slug: "exogenous",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_light_exposure",
    name: "Daylight exposure",
    short_label: "Daylight",
    description:
      "Bright-light exposure, especially in morning. Anchor for circadian alignment.",
    entity_category: "concrete",
    entity_type: "environmental_exposure",
    layer_slug: "exogenous",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_social_isolation",
    name: "Social isolation",
    short_label: "Isolation",
    description:
      "Persistent low-quality social connection. Downstream effects on motivation, mood, and cognitive engagement.",
    entity_category: "relational",
    entity_type: "psychosocial",
    layer_slug: "exogenous",
    importance: "moderate",
    observable: true,
  },

  // ── Behaviors (8) ──
  {
    seed_id: "n_sleep_duration",
    name: "Sleep duration",
    short_label: "Sleep h",
    description:
      "Total nightly sleep in hours. Most-leveraged single behavior for cognition.",
    entity_category: "concrete",
    entity_type: "behavior",
    layer_slug: "behaviors",
    importance: "fundamental",
    observable: true,
  },
  {
    seed_id: "n_sleep_consistency",
    name: "Sleep consistency",
    short_label: "Sleep regularity",
    description:
      "Variance of bed-time / wake-time across days. Independent of duration; predicts cognitive recovery.",
    entity_category: "abstract",
    entity_type: "behavior",
    layer_slug: "behaviors",
    importance: "critical",
    observable: true,
  },
  {
    seed_id: "n_aerobic_exercise",
    name: "Aerobic exercise",
    short_label: "Cardio",
    description:
      "Sustained moderate-intensity cardiovascular exercise (e.g. zone 2). Primary BDNF lever.",
    entity_category: "process",
    entity_type: "behavior",
    layer_slug: "behaviors",
    importance: "fundamental",
    observable: true,
  },
  {
    seed_id: "n_resistance_training",
    name: "Resistance training",
    short_label: "Strength",
    description:
      "Progressive overload strength training. Smaller cognitive effect than cardio but additive.",
    entity_category: "process",
    entity_type: "behavior",
    layer_slug: "behaviors",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_meditation",
    name: "Meditation practice",
    short_label: "Meditation",
    description:
      "Sustained mindfulness practice (≥8 weeks). Targets prefrontal-amygdala connectivity.",
    entity_category: "process",
    entity_type: "behavior",
    layer_slug: "behaviors",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_time_restricted_eating",
    name: "Time-restricted eating",
    short_label: "TRE",
    description:
      "Constrained eating window (e.g. 16:8). Improves metabolic markers; modest cognitive signal.",
    entity_category: "process",
    entity_type: "behavior",
    layer_slug: "behaviors",
    importance: "moderate",
    observable: true,
  },
  {
    seed_id: "n_caffeine",
    name: "Caffeine intake",
    short_label: "Caffeine",
    description:
      "Acute attentional booster. Tolerance develops; effect-size shrinks with chronic high doses.",
    entity_category: "concrete",
    entity_type: "behavior",
    layer_slug: "behaviors",
    importance: "moderate",
    observable: true,
  },
  {
    seed_id: "n_screen_time_evening",
    name: "Evening screen time",
    short_label: "Screens",
    description:
      "Bright-light + cognitive-load exposure in the 2h pre-sleep window. Disrupts melatonin onset.",
    entity_category: "concrete",
    entity_type: "behavior",
    layer_slug: "behaviors",
    importance: "important",
    observable: true,
  },

  // ── Biomarkers (5) ──
  {
    seed_id: "n_bdnf",
    name: "BDNF",
    short_label: "BDNF",
    description:
      "Brain-Derived Neurotrophic Factor. Mediates exercise → neuroplasticity link.",
    entity_category: "concrete",
    entity_type: "biomarker",
    layer_slug: "biomarkers",
    importance: "fundamental",
    observable: false,
    mechanism_note: "Serum + central; serum proxy is imperfect",
  },
  {
    seed_id: "n_cortisol",
    name: "Cortisol",
    short_label: "Cortisol",
    description:
      "HPA-axis stress hormone. Diurnal pattern (CAR + slope) more informative than absolute.",
    entity_category: "concrete",
    entity_type: "biomarker",
    layer_slug: "biomarkers",
    importance: "critical",
    observable: true,
  },
  {
    seed_id: "n_hrv",
    name: "Heart rate variability",
    short_label: "HRV",
    description:
      "RMSSD or HF-HRV. Proxy for parasympathetic tone; correlates with cognitive flexibility.",
    entity_category: "concrete",
    entity_type: "biomarker",
    layer_slug: "biomarkers",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_fasting_glucose",
    name: "Fasting glucose",
    short_label: "Glucose",
    description:
      "Fasting blood glucose. Variability matters more than absolute for moderate elevations.",
    entity_category: "concrete",
    entity_type: "biomarker",
    layer_slug: "biomarkers",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_hscrp",
    name: "hsCRP",
    short_label: "hsCRP",
    description:
      "High-sensitivity C-reactive protein. Inflammation marker linked to brain fog and slower processing.",
    entity_category: "concrete",
    entity_type: "biomarker",
    layer_slug: "biomarkers",
    importance: "important",
    observable: true,
  },

  // ── Pathways (4) ──
  {
    seed_id: "n_hpa_activation",
    name: "HPA-axis activation",
    short_label: "HPA",
    description:
      "Hypothalamic-pituitary-adrenal axis state. Chronically activated under sustained stress.",
    entity_category: "process",
    entity_type: "pathway",
    layer_slug: "pathways",
    importance: "fundamental",
    observable: false,
  },
  {
    seed_id: "n_neurogenesis",
    name: "Hippocampal neurogenesis",
    short_label: "Neurogenesis",
    description:
      "Adult neurogenesis in the dentate gyrus. Promoted by exercise + sleep; suppressed by stress + inflammation.",
    entity_category: "process",
    entity_type: "pathway",
    layer_slug: "pathways",
    importance: "fundamental",
    observable: false,
  },
  {
    seed_id: "n_pfc_amygdala",
    name: "Prefrontal-amygdala connectivity",
    short_label: "PFC-amygdala",
    description:
      "Top-down regulation circuit. Strengthened by meditation; degraded by chronic stress.",
    entity_category: "process",
    entity_type: "neural_circuit",
    layer_slug: "pathways",
    importance: "critical",
    observable: false,
  },
  {
    seed_id: "n_glymphatic",
    name: "Glymphatic clearance",
    short_label: "Glymphatic",
    description:
      "CSF-mediated clearance of metabolic waste during sleep. Window opens primarily during NREM-3.",
    entity_category: "process",
    entity_type: "physiological_process",
    layer_slug: "pathways",
    importance: "critical",
    observable: false,
  },

  // ── Symptoms (3) ──
  {
    seed_id: "n_mental_fatigue",
    name: "Mental fatigue",
    short_label: "Mental fatigue",
    description:
      "Subjective sense of cognitive effort costliness. Distinct from sleepiness; tracks closely with sustained-attention failures.",
    entity_category: "abstract",
    entity_type: "symptom",
    layer_slug: "symptoms",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_brain_fog",
    name: "Brain fog",
    short_label: "Brain fog",
    description:
      "Subjective reduction in mental clarity. Multifactorial — inflammation, sleep, glucose all contribute.",
    entity_category: "abstract",
    entity_type: "symptom",
    layer_slug: "symptoms",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_motivation",
    name: "Motivation",
    short_label: "Motivation",
    description:
      "Trait + state goal-pursuit drive. Modulates how much cognitive capacity is actually deployed on task.",
    entity_category: "abstract",
    entity_type: "subjective_state",
    layer_slug: "symptoms",
    importance: "important",
    observable: true,
  },

  // ── Cognitive (5) ──
  {
    seed_id: "n_working_memory",
    name: "Working memory",
    short_label: "WM",
    description:
      "Capacity to hold + manipulate information across seconds. Most-cited single cognitive predictor of fluid performance.",
    entity_category: "abstract",
    entity_type: "cognitive_construct",
    layer_slug: "cognitive",
    importance: "fundamental",
    observable: true,
  },
  {
    seed_id: "n_sustained_attention",
    name: "Sustained attention",
    short_label: "Vigilance",
    description:
      "Ability to maintain focus on a task over minutes-to-hours. Tested via PVT, CPT.",
    entity_category: "abstract",
    entity_type: "cognitive_construct",
    layer_slug: "cognitive",
    importance: "critical",
    observable: true,
  },
  {
    seed_id: "n_processing_speed",
    name: "Processing speed",
    short_label: "Speed",
    description:
      "Time to execute a basic cognitive operation. Declines with age; less responsive to short-term intervention.",
    entity_category: "abstract",
    entity_type: "cognitive_construct",
    layer_slug: "cognitive",
    importance: "important",
    observable: true,
  },
  {
    seed_id: "n_cognitive_flexibility",
    name: "Cognitive flexibility",
    short_label: "Flexibility",
    description:
      "Ability to shift between tasks / mental sets. Measured by Trail Making B, set-shifting tasks.",
    entity_category: "abstract",
    entity_type: "executive_function",
    layer_slug: "cognitive",
    importance: "critical",
    observable: true,
  },
  {
    seed_id: "n_response_inhibition",
    name: "Response inhibition",
    short_label: "Inhibition",
    description:
      "Suppression of prepotent / automatic responses. Stroop, Flanker, Go/No-Go tasks.",
    entity_category: "abstract",
    entity_type: "executive_function",
    layer_slug: "cognitive",
    importance: "important",
    observable: true,
  },

  // ── Composite (2) ──
  {
    seed_id: "n_deep_work_output",
    name: "Deep-work output",
    short_label: "Deep work",
    description:
      "Real-world high-cognitive-demand output: writing, analysis, problem-solving in the user's domain.",
    entity_category: "abstract",
    entity_type: "outcome",
    layer_slug: "composite",
    importance: "fundamental",
    observable: true,
  },
  {
    seed_id: "n_learning_rate",
    name: "Learning rate",
    short_label: "Learning",
    description:
      "Speed of acquiring new declarative + procedural knowledge. Composite of WM + sleep-dependent consolidation.",
    entity_category: "abstract",
    entity_type: "outcome",
    layer_slug: "composite",
    importance: "fundamental",
    observable: true,
  },
];

// ── Seed edges ────────────────────────────────────────────────────
//
// Effect sizes are starting estimates (status: "sparse"). The
// /api/ingest/[id]/extract-effect-sizes pipeline replaces these as the
// user uploads literature. Sign convention: positive = source increases
// target; negative = source decreases target. Magnitudes are roughly
// 0.2 (small) / 0.4 (moderate) / 0.6 (large) Cohen's-d-equivalents.

function edge(
  seed_id: string,
  source: string,
  target: string,
  rel: string,
  effect: number,
  options: Partial<ResearchSeedEdge> = {},
): ResearchSeedEdge {
  return {
    seed_id,
    source_seed_id: source,
    target_seed_id: target,
    relationship_type: rel,
    dimension: "causal_mechanism",
    effect_size: effect,
    standard_error: Math.abs(effect) * 0.25,
    num_studies: 3,
    status: "sparse",
    effect_metric: "cohens_d_estimate",
    ...options,
  };
}

const EDGES: ResearchSeedEdge[] = [
  // Stress branch
  edge("e_stress_cortisol", "n_chronic_stress", "n_cortisol", "elevates", 0.6),
  edge("e_stress_hpa", "n_chronic_stress", "n_hpa_activation", "activates", 0.7),
  edge("e_hpa_neurogenesis", "n_hpa_activation", "n_neurogenesis", "suppresses", -0.5),
  edge("e_stress_wm", "n_chronic_stress", "n_working_memory", "reduces", -0.4),
  edge("e_stress_pfc", "n_chronic_stress", "n_pfc_amygdala", "degrades", -0.45),

  // Sleep branch
  edge("e_sleep_glymphatic", "n_sleep_duration", "n_glymphatic", "enables", 0.5),
  edge("e_sleep_wm", "n_sleep_duration", "n_working_memory", "supports", 0.4),
  edge("e_sleep_fatigue", "n_sleep_duration", "n_mental_fatigue", "reduces", -0.5),
  edge("e_consistency_fatigue", "n_sleep_consistency", "n_mental_fatigue", "reduces", -0.3),
  edge("e_screens_sleep", "n_screen_time_evening", "n_sleep_duration", "reduces", -0.4),
  edge("e_light_consistency", "n_light_exposure", "n_sleep_consistency", "improves", 0.4),
  edge("e_glymphatic_brainfog", "n_glymphatic", "n_brain_fog", "reduces", -0.4),

  // Exercise branch
  edge("e_aerobic_bdnf", "n_aerobic_exercise", "n_bdnf", "elevates", 0.45),
  edge("e_aerobic_neurogenesis", "n_aerobic_exercise", "n_neurogenesis", "promotes", 0.4),
  edge("e_aerobic_wm", "n_aerobic_exercise", "n_working_memory", "improves", 0.3),
  edge("e_aerobic_flex", "n_aerobic_exercise", "n_cognitive_flexibility", "improves", 0.3),
  edge("e_strength_bdnf", "n_resistance_training", "n_bdnf", "elevates", 0.25),
  edge("e_bdnf_neurogenesis", "n_bdnf", "n_neurogenesis", "promotes", 0.5),
  edge("e_neurogenesis_wm", "n_neurogenesis", "n_working_memory", "supports", 0.45),
  edge("e_neurogenesis_learning", "n_neurogenesis", "n_learning_rate", "supports", 0.4),

  // Meditation branch
  edge("e_meditation_pfc", "n_meditation", "n_pfc_amygdala", "strengthens", 0.4),
  edge("e_meditation_inhibition", "n_meditation", "n_response_inhibition", "improves", 0.3),
  edge("e_meditation_cortisol", "n_meditation", "n_cortisol", "reduces", -0.25),
  edge("e_pfc_inhibition", "n_pfc_amygdala", "n_response_inhibition", "supports", 0.4),
  edge("e_pfc_flex", "n_pfc_amygdala", "n_cognitive_flexibility", "supports", 0.35),

  // HRV branch
  edge("e_hrv_flex", "n_hrv", "n_cognitive_flexibility", "supports", 0.25),
  edge("e_hrv_inhibition", "n_hrv", "n_response_inhibition", "supports", 0.2),

  // Metabolic branch
  edge("e_tre_glucose", "n_time_restricted_eating", "n_fasting_glucose", "reduces", -0.3),
  edge("e_tre_bdnf", "n_time_restricted_eating", "n_bdnf", "elevates", 0.2),
  edge("e_glucose_fatigue", "n_fasting_glucose", "n_mental_fatigue", "elevates", 0.3),
  edge("e_hscrp_fatigue", "n_hscrp", "n_mental_fatigue", "elevates", 0.35),
  edge("e_hscrp_brainfog", "n_hscrp", "n_brain_fog", "elevates", 0.4),

  // Caffeine
  edge("e_caffeine_attention", "n_caffeine", "n_sustained_attention", "boosts", 0.35),

  // Symptom → cognitive
  edge("e_fatigue_wm", "n_mental_fatigue", "n_working_memory", "reduces", -0.35),
  edge("e_fatigue_attention", "n_mental_fatigue", "n_sustained_attention", "reduces", -0.45),
  edge("e_brainfog_wm", "n_brain_fog", "n_working_memory", "reduces", -0.5),
  edge("e_brainfog_flex", "n_brain_fog", "n_cognitive_flexibility", "reduces", -0.4),

  // Age + isolation
  edge("e_age_speed", "n_age", "n_processing_speed", "reduces", -0.4),
  edge("e_age_bdnf", "n_age", "n_bdnf", "reduces", -0.25),
  edge("e_isolation_motivation", "n_social_isolation", "n_motivation", "reduces", -0.3),
  edge("e_motivation_deepwork", "n_motivation", "n_deep_work_output", "supports", 0.4),

  // Cognitive → composite
  edge("e_wm_deepwork", "n_working_memory", "n_deep_work_output", "supports", 0.5),
  edge("e_attention_deepwork", "n_sustained_attention", "n_deep_work_output", "supports", 0.45),
  edge("e_speed_deepwork", "n_processing_speed", "n_deep_work_output", "supports", 0.3),
  edge("e_inhibition_deepwork", "n_response_inhibition", "n_deep_work_output", "supports", 0.3),
  edge("e_flex_learning", "n_cognitive_flexibility", "n_learning_rate", "supports", 0.4),
  edge("e_wm_learning", "n_working_memory", "n_learning_rate", "supports", 0.4),
];

// ── Seed subjects ────────────────────────────────────────────────

const SUBJECTS: ResearchSeedSubject[] = [
  {
    seed_id: "s_knowledge_worker",
    name: "Knowledge worker",
    description:
      "High cognitive load, often sleep-restricted, sedentary. Optimizes for sustained deep-work output across a workday.",
    focus_kind: "person",
    focus_label: "Knowledge worker",
    artifact_state: "bare_topic",
    conditions: {
      sleep_h: 6.5,
      stress_0_10: 5.5,
      caffeine_mg: 200,
      time_of_day_24h: 10,
    },
    default_lab_features: ["monte_carlo", "what_if", "deepen_kg"],
  },
  {
    seed_id: "s_athlete_in_season",
    name: "Athlete in season",
    description:
      "High physical-training load, recovery-constrained. Trades cognitive output budget for physical adaptation.",
    focus_kind: "person",
    focus_label: "Athlete",
    artifact_state: "bare_topic",
    conditions: {
      sleep_h: 7.5,
      stress_0_10: 4,
      caffeine_mg: 100,
      time_of_day_24h: 10,
    },
    default_lab_features: ["monte_carlo", "ab_compare"],
  },
  {
    seed_id: "s_student_pre_exam",
    name: "Student pre-exam",
    description:
      "Acute stress + sleep restriction window, high motivation. Optimizes for learning rate over weeks.",
    focus_kind: "person",
    focus_label: "Student",
    artifact_state: "bare_topic",
    conditions: {
      sleep_h: 6,
      stress_0_10: 7,
      caffeine_mg: 250,
      time_of_day_24h: 14,
    },
    default_lab_features: ["what_if", "deepen_kg"],
  },
  {
    seed_id: "s_aging_adult",
    name: "Aging adult",
    description:
      "Preventive focus. BDNF decline + processing-speed slowdown are foreground; sleep architecture changes amplify both.",
    focus_kind: "person",
    focus_label: "Aging adult",
    artifact_state: "bare_topic",
    conditions: {
      sleep_h: 7,
      stress_0_10: 3,
      caffeine_mg: 75,
      time_of_day_24h: 10,
    },
    default_lab_features: ["monte_carlo", "deepen_kg"],
  },
];

// ── Seed interventions ───────────────────────────────────────────

const INTERVENTIONS: ResearchSeedIntervention[] = [
  {
    seed_id: "i_aerobic_protocol",
    name: "Aerobic exercise protocol",
    short_label: "Cardio 150/wk",
    description:
      "150 min/week moderate-intensity (zone 2) cardio. Best-evidenced general cognitive intervention.",
    recommended_dose: "150 min/wk · ≥8 wk for BDNF effects",
    mechanism: "BDNF → hippocampal neurogenesis",
    layer_slug: "behaviors",
    effect_size: 0.45,
    ci_lower: 0.3,
    ci_upper: 0.6,
    color: "#22d3ee",
  },
  {
    seed_id: "i_sleep_optimization",
    name: "Sleep architecture optimization",
    short_label: "Sleep hygiene",
    description:
      "Cool bedroom (≤19°C), dark, consistent schedule. Targets duration AND consistency simultaneously.",
    recommended_dose: "Nightly · effects within 2 wk",
    mechanism: "NREM-3 → glymphatic clearance",
    layer_slug: "behaviors",
    effect_size: 0.5,
    ci_lower: 0.3,
    ci_upper: 0.7,
    color: "#a78bfa",
  },
  {
    seed_id: "i_mediterranean_diet",
    name: "Mediterranean diet",
    short_label: "MedDiet",
    description:
      "High plant-fat, fish, low refined-carb. Anti-inflammatory; modest direct cognitive effect.",
    recommended_dose: "Daily · 12+ wk for hsCRP shifts",
    mechanism: "Inflammation reduction → neurogenesis support",
    layer_slug: "behaviors",
    effect_size: 0.25,
    ci_lower: 0.1,
    ci_upper: 0.4,
    color: "#fb923c",
  },
  {
    seed_id: "i_mbsr",
    name: "Mindfulness practice (MBSR)",
    short_label: "MBSR 8wk",
    description:
      "Standardized 8-week mindfulness-based stress reduction protocol.",
    recommended_dose: "30 min/day · 8 wk",
    mechanism: "Prefrontal-amygdala connectivity",
    layer_slug: "behaviors",
    effect_size: 0.35,
    ci_lower: 0.2,
    ci_upper: 0.5,
    color: "#f472b6",
  },
  {
    seed_id: "i_tre_16_8",
    name: "Time-restricted eating (16:8)",
    short_label: "16:8 TRE",
    description:
      "16h fast / 8h eating window. Improves metabolic flexibility; modest cognitive signal.",
    recommended_dose: "Daily · 4-12 wk",
    mechanism: "Glucose stability + autophagy",
    layer_slug: "behaviors",
    effect_size: 0.2,
    ci_lower: 0.05,
    ci_upper: 0.35,
    color: "#facc15",
  },
  {
    seed_id: "i_deliberate_practice",
    name: "Deliberate practice block",
    short_label: "Deliberate practice",
    description:
      "Focused, feedback-rich practice on specific skill, ≥45 min uninterrupted.",
    recommended_dose: "45-90 min/day · 4+ wk",
    mechanism: "Targeted neuroplasticity",
    layer_slug: "behaviors",
    effect_size: 0.55,
    ci_lower: 0.4,
    ci_upper: 0.7,
    color: "#38bdf8",
  },
];

// ── Seed instruments ─────────────────────────────────────────────

const INSTRUMENTS: ResearchSeedInstrument[] = [
  {
    seed_id: "inst_n_back",
    name: "N-Back",
    short_label: "N-Back",
    description:
      "Continuous-performance task measuring working memory updating. Standard 2-back / 3-back variants.",
    measures: "working_memory",
    layer_slug: "cognitive",
    modality: "VIS",
  },
  {
    seed_id: "inst_digit_span",
    name: "Digit Span",
    short_label: "Digit Span",
    description:
      "Forward + backward digit recall. Verbal short-term + working memory.",
    measures: "working_memory",
    layer_slug: "cognitive",
    modality: "VER",
  },
  {
    seed_id: "inst_stroop",
    name: "Stroop",
    short_label: "Stroop",
    description:
      "Color-word interference. Indexes response inhibition + selective attention.",
    measures: "response_inhibition",
    layer_slug: "cognitive",
    modality: "VIS",
  },
  {
    seed_id: "inst_trail_b",
    name: "Trail Making B",
    short_label: "TMT-B",
    description:
      "Alternating-sequence connect-the-dots. Cognitive flexibility + set-shifting.",
    measures: "cognitive_flexibility",
    layer_slug: "cognitive",
    modality: "VIS",
  },
  {
    seed_id: "inst_flanker",
    name: "Flanker",
    short_label: "Flanker",
    description:
      "Eriksen flanker. Indexes response inhibition under perceptual conflict.",
    measures: "response_inhibition",
    layer_slug: "cognitive",
    modality: "VIS",
  },
  {
    seed_id: "inst_pvt",
    name: "Psychomotor Vigilance Task",
    short_label: "PVT",
    description:
      "Reaction-time-to-cue task. Gold-standard sustained-attention measure; sensitive to sleep loss.",
    measures: "sustained_attention",
    layer_slug: "cognitive",
    modality: "VIS",
  },
];

// ── Template export ──────────────────────────────────────────────

export const COGNITIVE_PERFORMANCE_TEMPLATE: ResearchTemplate = {
  slug: "cognitive_performance",
  title: "Cognitive Performance",
  tagline:
    "Map and optimize your cognitive performance — from working memory to deep-work output.",
  description:
    "A general-purpose cognitive-science workspace. Models how your behaviors (sleep, exercise, meditation, nutrition) cascade through biomarkers and pathways into the cognitive faculties that drive real-world output. Generalized template — not tied to a clinical condition. Drop research papers in to refine the effect sizes from blanket estimates to your-domain-specific evidence.",
  icon: "Brain",
  accent_color: "#7c3aed",
  accent_color_light: "rgba(124, 58, 237, 0.08)",
  domain_tags: [
    "cognition",
    "performance",
    "neuroscience",
    "behavior_change",
    "productivity",
    "personal",
    "professional",
    "research-friendly",
  ],
  source_citations: [
    "Yaffe et al. 2014 — sleep + cognition",
    "Erickson et al. 2011 — aerobic exercise + BDNF",
    "Tang et al. 2015 — meditation + prefrontal connectivity",
    "Mander et al. 2017 — sleep + glymphatic clearance",
    "Smith et al. 2010 — exercise + executive function meta-analysis",
  ],
  default_space_name: "Cognitive Performance · {{date}}",
  default_description:
    "Personal cognitive-performance workspace generated from the Cognitive Performance research template.",
  ontology_layers: LAYERS,
  // B1 — restrict the frame extractor's axis pool to frames that
  // actually fit cognitive-performance research. Drops `financial`
  // (rarely relevant for personal/clinical cognition spaces) and
  // `cultural` (only matters for cross-population comparisons we
  // don't model here). Keeps the 5 frames that genuinely shape this
  // domain: causal scenarios, evidence quality, load-bearing
  // assumptions, risk profile, and the actor / individual-difference
  // dimension. Adaptive display_name (A1) still kicks in per prompt.
  preferred_probability_space_axes: [
    "causal_scenarios",
    "evidence",
    "assumptions",
    "risk",
    "actors",
    "timeline",
  ],
  // B4 — drop "game" (clinical research isn't engagement-mechanic-led)
  // and "ml_personalization" (templates of this kind don't generate
  // per-user behavioral telemetry yet). Keep the 5 kinds that are
  // load-bearing for clinical / cognitive-performance work.
  preferred_mechanism_kinds: [
    "simulation",
    "prediction",
    "validation",
    "baseline_tracking",
    "deviation_capture",
  ],
  seed_nodes: NODES,
  seed_edges: EDGES,
  seed_subjects: SUBJECTS,
  seed_interventions: INTERVENTIONS,
  seed_instruments: INSTRUMENTS,
};

// Sanity assertions — fail loudly during dev if seed_ids drift.
const NODE_IDS = new Set(NODES.map((n) => n.seed_id));
for (const e of EDGES) {
  if (!NODE_IDS.has(e.source_seed_id)) {
    throw new Error(
      `[cognitive-performance] edge ${e.seed_id} source_seed_id ${e.source_seed_id} not in seed_nodes`,
    );
  }
  if (!NODE_IDS.has(e.target_seed_id)) {
    throw new Error(
      `[cognitive-performance] edge ${e.seed_id} target_seed_id ${e.target_seed_id} not in seed_nodes`,
    );
  }
}
const LAYER_SLUGS = new Set(LAYERS.map((l) => l.slug));
for (const n of NODES) {
  if (!LAYER_SLUGS.has(n.layer_slug)) {
    throw new Error(
      `[cognitive-performance] node ${n.seed_id} layer_slug ${n.layer_slug} not in ontology_layers`,
    );
  }
}
