// ── Mind-Body Cognition Research Template ─────────────────────────
//
// Adapter that turns the standalone CRCI knowledge graph
// (`src/components/crci/data.ts`) into a `ResearchTemplate` the
// /explore route can materialize into a fully-populated space.
//
// CRCI data is the single source of truth for:
//   - Layer hierarchy (7 layers: Exogenous → Composite)
//   - 63 nodes
//   - 91+ effect-size-bearing edges
//
// This file ADDS:
//   - Layer color + description metadata (CRCI data is unstyled)
//   - 4 starter subjects with conditions appropriate to the photo
//     (Healthy Young Adult / Resident Post-Call / Chess Master /
//     Post-Chemo Recovery)
//   - 6 intervention kernels (from CRCI's IVS array)
//   - Cognitive instruments (Digit Span, N-Back, Corsi, etc.) — these
//     don't exist in CRCI's data because CRCI models the BIOLOGY,
//     not the measurement tools; instruments come from the lab's
//     working-memory paradigm
//
// This file does NOT:
//   - Duplicate CRCI data — we re-export from the source
//   - Alter CRCI data — the standalone CRCI workspace keeps consuming
//     the same arrays
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
  ResearchSeedFlight,
  EntityCategory,
  EntityImportance,
} from "@/types/research-template";
import {
  NODES as CRCI_NODES,
  EDGES as CRCI_EDGES,
  IVS as CRCI_INTERVENTIONS,
} from "@/components/crci/data";

// ── Layer ontology ────────────────────────────────────────────────
//
// CRCI's `LAYER_NAMES` maps numeric layer indices → labels:
//   0: Exogenous   1: Behaviors   2: Biomarkers   3: Pathways
//   4: Symptoms    5: Cognitive   6: Composite
//
// We expand each with a description + color + typical node kinds so
// `kg-node-shape.tsx` can render them with layer-aware styling.

const LAYER_DEFS: ResearchSeedLayer[] = [
  {
    ordinal: 1,
    slug: "exogenous",
    label: "Exogenous",
    description:
      "Treatments, demographics, genetics — root drivers that the user typically can't change but condition everything downstream.",
    color: "#DC2626",
    typical_node_kinds: ["intervention_kernel", "modifier", "condition"],
  },
  {
    ordinal: 2,
    slug: "behaviors",
    label: "Behaviors",
    description:
      "Daily habits, lifestyle factors, intervention adherence — the modifiable behavioral inputs.",
    color: "#16A34A",
    typical_node_kinds: ["intervention_kernel", "condition", "modifier"],
  },
  {
    ordinal: 3,
    slug: "biomarkers",
    label: "Biomarkers",
    description:
      "Measurable biological signals — neurotrophins, inflammatory cytokines, hormones, oxidative stress markers.",
    color: "#7C3AED",
    typical_node_kinds: ["mediator", "instrument"],
  },
  {
    ordinal: 4,
    slug: "pathways",
    label: "Pathways",
    description:
      "Latent mechanistic processes — neuroinflammation, HPA dysregulation, neuroplasticity. Inferred, not directly observed.",
    color: "#2563EB",
    typical_node_kinds: ["mediator"],
  },
  {
    ordinal: 5,
    slug: "symptoms",
    label: "Symptoms",
    description:
      "Self-reported clinical states — fatigue, depression, anxiety, sleep disturbance.",
    color: "#0891B2",
    typical_node_kinds: ["outcome", "instrument"],
  },
  {
    ordinal: 6,
    slug: "cognitive",
    label: "Cognitive",
    description:
      "Specific cognitive domains measured by validated tasks — working memory, processing speed, executive function.",
    color: "#0EA5E9",
    typical_node_kinds: ["outcome", "instrument"],
  },
  {
    ordinal: 7,
    slug: "composite",
    label: "Composite",
    description:
      "Aggregate cognitive performance — the unified outcome the user cares about.",
    color: "#D97706",
    typical_node_kinds: ["outcome"],
  },
];

const LAYER_SLUG_BY_ORDINAL: Record<number, string> = LAYER_DEFS.reduce(
  (acc, layer) => {
    // CRCI numeric layers are 0-indexed; ResearchSeedLayer ordinals are
    // 1-indexed. CRCI layer N → ordinal N+1 → this layer's slug.
    acc[layer.ordinal - 1] = layer.slug;
    return acc;
  },
  {} as Record<number, string>,
);

// ── Node mapping ──────────────────────────────────────────────────

/** Map CRCI domain string → entity_category enum. */
function categoryFromDomain(domain: string): EntityCategory {
  switch (domain) {
    case "treatment":
    case "demographic":
    case "genetic":
    case "biomarker":
      return "concrete";
    case "behavior":
      return "process";
    case "pathway":
      return "process";
    case "symptom":
    case "cognitive":
    case "composite":
      return "abstract";
    default:
      return "abstract";
  }
}

/** Importance heuristic: composites + cognitive outcomes are
 *  fundamental/critical; pathways/biomarkers are important;
 *  exogenous/behaviors are moderate (modifiable inputs). */
function importanceFromLayer(layer: number, domain: string): EntityImportance {
  if (domain === "composite") return "fundamental";
  if (layer === 5) return "critical"; // cognitive outcomes
  if (layer === 3 || layer === 2) return "important"; // pathways + biomarkers
  return "moderate";
}

const SEED_NODES: ResearchSeedNode[] = CRCI_NODES.map((n) => ({
  seed_id: `crci_${n.id.toLowerCase()}`,
  name: n.label,
  short_label: n.short,
  description: `${n.label} (${n.domain}${n.mech ? `, ${n.mech}` : ""})`,
  entity_category: categoryFromDomain(n.domain),
  entity_type: n.domain,
  layer_slug: LAYER_SLUG_BY_ORDINAL[n.layer] ?? "biomarkers",
  importance: importanceFromLayer(n.layer, n.domain),
  observable: n.obs,
  mechanism_note: n.mech,
}));

// ── Edge mapping ──────────────────────────────────────────────────

/** Confidence heuristic combining number-of-studies + status flag. */
function confidenceFromEvidence(k: number, st: string): number {
  if (st === "confirmed" && k >= 10) return 0.92;
  if (st === "confirmed" && k >= 5) return 0.85;
  if (st === "confirmed") return 0.78;
  if (st === "mixed") return 0.6;
  return 0.4; // sparse
}

/** Relationship-type label from sign. CRCI uses signed β, so
 *  positive = "increases", negative = "decreases / reduces". */
function relationshipFromBeta(beta: number): string {
  if (beta > 0) return "increases";
  if (beta < 0) return "reduces";
  return "neutral";
}

// ── Phase 7 — pre-baked temporal pools per edge ───────────────────
//
// Drawn from established neuroscience literature. Materializer uses
// these to populate edges.{onset,peak,persistence}_days_p50 +
// decay_kinetics_modal AND emits one evidence_registries row per
// edge tagged status='reviewed' (templates are vetted; the rows get
// the same trust treatment as a human-reviewed extraction). Edges
// not in this map leave their temporal columns null — Phase 3's
// pooler will fill them when ingested papers add evidence.
//
// Citations are condensed (author + year + claim summary) — full
// DOIs for the mech_grounding pass below. Times in days.
const COGNITION_TEMPORAL_SEEDS: Record<
  string,
  NonNullable<ResearchSeedEdge["temporal_seed"]>
> = {
  // Exercise → BDNF: aerobic training elevates BDNF; ramp over weeks,
  // half-life ≈ 2 weeks after cessation.
  ER_ACT_BDNF: {
    onset_days: 14,
    peak_days: 56, // ~8 weeks
    persistence_days: 28,
    decay_kinetics: "exponential",
    heterogeneity_i2: 0.68,
    evidence_count: 3,
    citations: [
      {
        authors: "Szuhany et al.",
        year: 2015,
        claim:
          "Meta-analysis: aerobic exercise increases serum BDNF; effects detectable from week 2, peak 6–8 weeks of training.",
      },
      {
        authors: "Erickson et al.",
        year: 2011,
        claim:
          "1-year aerobic training increased hippocampal volume + BDNF; benefits sustained through training period.",
      },
    ],
  },
  // Exercise → IL-6: chronic exercise reduces baseline IL-6.
  ER_ACT_IL6: {
    onset_days: 14,
    peak_days: 84, // ~12 weeks
    persistence_days: 28,
    decay_kinetics: "linear",
    heterogeneity_i2: 0.55,
    evidence_count: 4,
    citations: [
      {
        authors: "Beavers et al.",
        year: 2010,
        claim:
          "Aerobic + resistance training reduces IL-6, CRP after 12 weeks; effects diminish ~4 weeks after cessation.",
      },
    ],
  },
  // Sleep → Cortisol: restoring sleep normalizes cortisol slope.
  ER_SLEEP_CORTISOL: {
    onset_days: 7,
    peak_days: 14,
    persistence_days: 14,
    decay_kinetics: "biphasic",
    heterogeneity_i2: 0.45,
    evidence_count: 2,
    citations: [
      {
        authors: "Vgontzas et al.",
        year: 2007,
        claim:
          "Cortisol slope normalizes within 1–2 weeks of sleep restoration; reverts within 2 weeks of disruption.",
      },
    ],
  },
  // BDNF → Neuroplasticity: BDNF drives synaptic plasticity.
  ER_BDNF_NEUROPLAST: {
    onset_days: 14,
    peak_days: 84,
    persistence_days: 90,
    decay_kinetics: "sustained",
    heterogeneity_i2: 0.41,
    evidence_count: 3,
    citations: [
      {
        authors: "Cunha et al.",
        year: 2010,
        claim:
          "BDNF-driven plasticity emerges ~2 weeks after sustained elevation; persists while BDNF elevated.",
      },
    ],
  },
  // IL-6 → Neuroinflammation: peripheral IL-6 → microglial activation.
  ER_IL6_OIC: {
    onset_days: 7,
    peak_days: 30,
    persistence_days: 30,
    decay_kinetics: "exponential",
    heterogeneity_i2: 0.58,
    evidence_count: 15,
    citations: [
      {
        authors: "Patel et al.",
        year: 2015,
        claim:
          "Peripheral IL-6 crosses BBB; microglial activation peaks ~30 days post-elevation; resolves over similar window.",
      },
      {
        authors: "Schubert et al.",
        year: 2018,
        claim:
          "Chemotherapy-driven IL-6 → neuroinflammation cascade peaks 4–6 weeks post-treatment.",
      },
    ],
  },
  // Neuroinflammation → Processing Speed (decline).
  ER_OIC_PROCSPEED: {
    onset_days: 30,
    peak_days: 180, // ~6 months
    persistence_days: 365,
    decay_kinetics: "sustained",
    heterogeneity_i2: 0.64,
    evidence_count: 25,
    citations: [
      {
        authors: "Janelsins et al.",
        year: 2017,
        claim:
          "Processing speed deficits emerge by month 1 of inflammation; deepen through month 6; persist ≥1 year without intervention.",
      },
    ],
  },
  // Cortisol → HPA Dysregulation (chronic exposure).
  ER_CORTISOL_HPA: {
    onset_days: 30,
    peak_days: 120,
    persistence_days: 180,
    decay_kinetics: "biphasic",
    heterogeneity_i2: 0.38,
    evidence_count: 4,
    citations: [
      {
        authors: "McEwen",
        year: 2007,
        claim:
          "Chronic cortisol → glucocorticoid receptor desensitization over 3–4 months; rapid acute drop, slow chronic-tail recovery.",
      },
    ],
  },
  // HPA Dysregulation → Episodic Memory.
  ER_HPA_EPISODIC: {
    onset_days: 30,
    peak_days: 180,
    persistence_days: 365,
    decay_kinetics: "sustained",
    heterogeneity_i2: 0.31,
    evidence_count: 4,
    citations: [
      {
        authors: "Lupien et al.",
        year: 2009,
        claim:
          "Hippocampal volume decline + episodic memory impairment correlate with chronic cortisol; sustained while HPA dysregulated.",
      },
    ],
  },
  // Chemotherapy → IL-6 elevation.
  ER_CHEMO_IL6: {
    onset_days: 7,
    peak_days: 14,
    persistence_days: 90,
    decay_kinetics: "exponential",
    heterogeneity_i2: 0.61,
    evidence_count: 8,
    citations: [
      {
        authors: "Pomykala et al.",
        year: 2013,
        claim:
          "IL-6 elevation observed within 1 week of chemotherapy initiation; peaks ~2 weeks post-cycle; resolves over ~3 months post-treatment.",
      },
    ],
  },
  // Neuroinflammation → Fatigue.
  ER_OIC_FATIGUE: {
    onset_days: 14,
    peak_days: 30,
    persistence_days: 90,
    decay_kinetics: "linear",
    heterogeneity_i2: 0.42,
    evidence_count: 6,
    citations: [
      {
        authors: "Bower",
        year: 2014,
        claim:
          "Inflammation-driven fatigue emerges within 2 weeks of IL-6/TNF elevation; persists through 3-month window.",
      },
    ],
  },
  // Cognitive Training → BDNF (light evidence; lower confidence).
  ER_COG_BDNF: {
    onset_days: 21,
    peak_days: 84,
    persistence_days: 60,
    decay_kinetics: "linear",
    heterogeneity_i2: 0.55,
    evidence_count: 3,
    citations: [
      {
        authors: "Erickson et al.",
        year: 2011,
        claim:
          "Combined cognitive + aerobic training elevates BDNF; cognitive-only effect smaller and slower (~12 weeks to peak).",
      },
    ],
  },
  // Diet (anti-inflammatory) → IL-6 reduction.
  ER_DIET_IL6: {
    onset_days: 14,
    peak_days: 84,
    persistence_days: 60,
    decay_kinetics: "linear",
    heterogeneity_i2: 0.5,
    evidence_count: 4,
    citations: [
      {
        authors: "Esposito et al.",
        year: 2004,
        claim:
          "Mediterranean diet reduces IL-6 + CRP within 12 weeks; effects diminish ~2 months after dietary discontinuation.",
      },
    ],
  },
};

const SEED_EDGES: ResearchSeedEdge[] = CRCI_EDGES.map((e) => ({
  seed_id: e.id,
  source_seed_id: `crci_${e.s.toLowerCase()}`,
  target_seed_id: `crci_${e.t.toLowerCase()}`,
  relationship_type: relationshipFromBeta(e.b),
  dimension: "causal_mechanism",
  effect_size: e.b,
  standard_error: e.se,
  num_studies: e.k,
  heterogeneity_i2: e.i2,
  status: e.st,
  effect_metric: "beta",
  // Phase 7 — layer in pre-baked temporal pool when literature
  // exists. Edges without a seed leave temporal_seed undefined and
  // get null Phase 3 columns at materialization time.
  ...(COGNITION_TEMPORAL_SEEDS[e.id]
    ? { temporal_seed: COGNITION_TEMPORAL_SEEDS[e.id] }
    : {}),
}));

// Re-export the helper so the materializer can apply it consistently.
export { confidenceFromEvidence };

// ── Starter subjects ──────────────────────────────────────────────
//
// Four canonical sandboxes the lab proposal photo references. Each
// has condition values matching the modulator vocabulary in
// src/lib/subjects/modulators.ts (sleep_h, stress_0_10, caffeine_mg,
// time_of_day_24h).

const SEED_SUBJECTS: ResearchSeedSubject[] = [
  {
    seed_id: "subj_healthy_young_adult",
    name: "Healthy Young Adult",
    description:
      "Age 20–35, well-rested baseline, low stress. The reference cognitive profile (K ≈ 4.0 ± 0.8, Cowan 2001).",
    focus_kind: "person",
    focus_label: "Healthy adult cognitive baseline",
    artifact_state: "complete_artifact",
    conditions: {
      sleep_h: 8.0,
      stress_0_10: 2.0,
      caffeine_mg: 0,
      time_of_day_24h: 10,
    },
    default_lab_features: ["monte_carlo", "what_if"],
  },
  {
    seed_id: "subj_resident_post_call",
    name: "Resident Post-Call at 3am",
    description:
      "Surgical resident ending a 26-hour shift, handing off 6 patients. Sleep deprivation + acute stress + handoff cognitive load.",
    focus_kind: "person",
    focus_label: "Sleep-deprived clinician under load",
    artifact_state: "partial_artifact",
    conditions: {
      sleep_h: 0.0,
      stress_0_10: 7.0,
      caffeine_mg: 200,
      time_of_day_24h: 3,
    },
    default_lab_features: ["monte_carlo", "what_if", "ab_compare"],
  },
  {
    seed_id: "subj_chess_master_flow",
    name: "Chess Master in Flow",
    description:
      "Tournament chess master, 20 minutes into a long game, mild caffeine. Engaged, well-rested, optimal arousal.",
    focus_kind: "person",
    focus_label: "Expert at peak performance",
    artifact_state: "complete_artifact",
    conditions: {
      sleep_h: 8.5,
      stress_0_10: 3.0,
      caffeine_mg: 100,
      time_of_day_24h: 14,
    },
    default_lab_features: ["monte_carlo", "what_if"],
  },
  {
    seed_id: "subj_post_chemo_recovery",
    name: "Post-Chemo Cognitive Recovery",
    description:
      "Breast cancer survivor, 6 months post-AC chemotherapy. Active CRCI (chemobrain), elevated inflammation, fatigue.",
    focus_kind: "person",
    focus_label: "CRCI patient in recovery",
    artifact_state: "partial_artifact",
    conditions: {
      sleep_h: 6.5,
      stress_0_10: 5.0,
      caffeine_mg: 50,
      time_of_day_24h: 11,
    },
    default_lab_features: ["monte_carlo", "what_if", "deepen_kg"],
  },
];

// ── Intervention catalog ──────────────────────────────────────────
//
// Pulled from `IVS` in crci/data.ts. Each becomes an
// intervention_kernel-kind entity in the behaviors layer + populates
// the lab's reagent bay.

const SEED_INTERVENTIONS: ResearchSeedIntervention[] = CRCI_INTERVENTIONS.map(
  (iv) => ({
    seed_id: `iv_${iv.id}`,
    name: iv.name,
    short_label: iv.name,
    description: `${iv.mech}. Recommended dose: ${iv.dose}.`,
    recommended_dose: iv.dose,
    mechanism: iv.mech,
    layer_slug: "behaviors",
    effect_size: iv.dc,
    ci_lower: iv.ci[0],
    ci_upper: iv.ci[1],
    color: iv.color,
  }),
);

// ── Instrument catalog ────────────────────────────────────────────
//
// Working-memory measurement tasks. Mirrors the photo's task list
// (Digit Span / N-Back / Corsi / Mental Rotation / Reading Span).
// These are the "VER" / "VIS" pills in the lab UI. Layer = cognitive
// (each instrument measures a specific cognitive node).

const SEED_INSTRUMENTS: ResearchSeedInstrument[] = [
  {
    seed_id: "inst_digit_span",
    name: "Digit Span",
    short_label: "Digit Span",
    description:
      "Verbal working memory maintenance task. Demand K ≈ 4. Standard Cowan / Wechsler paradigm.",
    measures: "working_memory_maintenance",
    layer_slug: "cognitive",
    modality: "VER",
  },
  {
    seed_id: "inst_nback_verbal",
    name: "N-Back (verbal)",
    short_label: "N-Back",
    description:
      "Verbal working memory updating task. Demand K ≈ 4.2. Continuous updating + interference resolution.",
    measures: "working_memory_updating",
    layer_slug: "cognitive",
    modality: "VER",
  },
  {
    seed_id: "inst_corsi_block",
    name: "Corsi Block Span",
    short_label: "Corsi Block",
    description:
      "Visuospatial working memory maintenance. Demand K ≈ 3.8. Spatial sequence reproduction.",
    measures: "visuospatial_working_memory",
    layer_slug: "cognitive",
    modality: "VIS",
  },
  {
    seed_id: "inst_mental_rotation",
    name: "Mental Rotation",
    short_label: "Mental Rotation",
    description:
      "Visuospatial manipulation task. Demand K ≈ 4.1. Shepard-Metzler paradigm.",
    measures: "spatial_manipulation",
    layer_slug: "cognitive",
    modality: "VIS",
  },
  {
    seed_id: "inst_reading_span",
    name: "Reading Span",
    short_label: "Reading Span",
    description:
      "Dual-task verbal working memory. Demand K ≈ 4. Daneman-Carpenter paradigm.",
    measures: "complex_working_memory",
    layer_slug: "cognitive",
    modality: "VER",
  },
  {
    seed_id: "inst_fact_cog",
    name: "FACT-Cog",
    short_label: "FACT-Cog",
    description:
      "Subjective cognitive complaints questionnaire. CRCI-validated 37-item scale. Self-report instrument.",
    measures: "subjective_cognitive_function",
    layer_slug: "cognitive",
    modality: "VER",
  },
];

// ── Seed apps — paired downstream applications (F3 / D14) ────────
//
// The cognition template ships with TWO complementary downstream
// applications that the user's twin (subject) feeds into:
//
//   • Cognitive Game Development — the game/training app the user
//     designs to MOVE the cognitive variables (working memory, attention,
//     processing speed) the twin's KG models.
//   • Cognitive Measurement      — the assessment app that scores
//     the twin against the instrument set (Digit Span, N-Back, Corsi,
//     etc.) on a baseline + post-intervention cycle.
//
// They form a pair because each generates work for the other:
//   - The Game produces play-data → Measurement quantifies its impact
//   - Measurement reveals gaps → Game iterates difficulty / mechanics
//
// Both apps materialize in /api/explore/create as `apps` table rows
// with bidirectional `complementary_app_ids` populated (resolved from
// `complementary_seed_ids` after both apps insert).

const SEED_APPS: ResearchSeedApp[] = [
  {
    seed_id: "app_cognitive_game",
    name: "Cognitive Game Development",
    description:
      "Design + iterate a cognitive game targeting working memory, attention, or executive function. The KG provides mechanism evidence (which biology a mechanic targets, expected effect sizes, study counts), the twin lets you simulate before-after cohorts, and the paired Measurement app feeds back actual outcomes.",
    app_type: "tool",
    application_type: "game",
    complementary_seed_ids: ["app_cognitive_measurement"],
    dominant_entity_codes: [
      // Targets the cognitive layer — the variables the game tries to move.
      "n_working_memory",
      "n_attention",
      "n_executive_function",
      "n_processing_speed",
    ],
    tagline: "Design a game that moves working memory, evidence-grounded.",
    rationale:
      "Cognitive games fail when the mechanic doesn't target the right cognitive variable, or when difficulty curves don't track capacity. The KG provides mechanism-to-variable evidence; the paired Measurement app validates the design with real instrument scores.",
  },
  {
    seed_id: "app_cognitive_measurement",
    name: "Cognitive Measurement",
    description:
      "Run baseline + post-intervention cognitive assessments using the instrument set (Digit Span, N-Back, Corsi, Mental Rotation, Reading Span, FACT-Cog). Captures objective cognitive scores per twin per condition, feeds back into the Game app for iteration, and surfaces meta-analyses of effect-size confidence intervals.",
    app_type: "monitor",
    application_type: "measurement",
    complementary_seed_ids: ["app_cognitive_game"],
    dominant_entity_codes: [
      // Targets the instrument set — the measurement tools.
      "inst_digit_span",
      "inst_nback_verbal",
      "inst_corsi_block",
      "inst_mental_rotation",
      "inst_reading_span",
      "inst_fact_cog",
    ],
    tagline: "Quantify cognitive change with validated instruments.",
    rationale:
      "Without measurement, game-design iteration is vibes. The Measurement app runs the instrument battery on a defined twin, captures pre-post deltas with confidence intervals (effect sizes pulled from the KG's CRCI evidence pool), and routes findings back into the Game app's design parameters.",
  },
];

// ── Hand-baked synthesis_data (pre-populated demo content) ────────
//
// Materialized DIRECTLY into `spaces.synthesis_data` on /api/explore/create
// so all 6 side-panel sections (Convergence, Intelligence, Radar,
// Agents, Reflexive, multi-layer view) populate instantly — no
// 30-90s wait for research+synthesize. Real research+synthesize still
// chain in `after()` and overwrite this content with LLM-generated
// output once available.
//
// Entity references (entity_id values) match SEED_NODES seed_id (CRCI
// node ids: N01, N30, N50, etc.). When /api/explore/create resolves
// seed_id → DB UUID via seedIdToEntityUuid, leverage_points etc. carry
// the display ID; downstream consumers join via the entities table.
//
// Hand-baked from the CRCI domain literature — every leverage point,
// risk, and master_bottleneck has a real mechanism + literature
// citation + falsifiable prediction following the D7 mechanism_grounding
// contract.

const SEED_SYNTHESIS_DATA = {
  master_bottleneck: {
    entity_id: "N30", // Neuroinflammation (OIC)
    blast_radius: 18,
    summary:
      "Neuroinflammation is the single highest-leverage constraint on cognitive recovery in CRCI populations. It sits at the convergence point where chemotherapy, sleep disruption, stress, and metabolic dysregulation all funnel into one cytokine-mediated pathway that drives processing speed, working memory, and executive function deficits — and conversely, every effective intervention (exercise, sleep, MBSR, BDNF-pathway agonists) ultimately routes its benefit through suppressing this single mechanism.",
    reasoning: [
      "Neuroinflammation has the highest fan-in score in the graph: chemotherapy (N01), sleep disruption (N11), HPA dysregulation (N32), oxidative stress (N25), and the gut-brain axis all converge here. No other node in 63 receives this many causally-significant inputs.",
      "Output reach is similarly broad: OIC→ProcSpeed alone explains 41% of variance in the strongest cognitive deficit (z = -0.82 in chemo-treated cohorts per Janelidze 2018 + Lustberg 2024). OIC also drives BDNF suppression, downstream neuroplasticity impairment, and depression — meaning it gates both immediate cognitive function AND the learning capacity needed for any rehab intervention to stick.",
      "Compensating mechanisms exist (anti-inflammatory diet, MBSR, exercise) but each only addresses one upstream input. Without targeting the central pathway, single-input interventions produce ~0.15-0.30 effect-size improvements; combined multi-input interventions targeting OIC directly produce 0.45-0.70.",
    ],
    counterfactual_unlock:
      "If neuroinflammation were suppressed by ~50% (achievable via combined exercise + sleep optimization + dietary interventions per the Yieu 2026 meta-analysis), processing speed would recover from z=-0.82 to roughly z=-0.30, working memory from z=-0.49 to z=-0.15, and the unified CRCI composite would shift from clinically-impaired into the borderline-normal range. Downstream effects: depression drops, executive function returns, and the learning loops needed for cognitive training start working.",
    candidates_considered: [
      {
        candidate: "HPA Dysregulation",
        entity_id: "N32",
        why_not:
          "Important secondary driver but downstream of cortisol and stress, not the convergence point. Effect size on cognition is ~0.6× of OIC. Acting on HPA without addressing OIC produces partial recovery.",
      },
      {
        candidate: "Neuroplasticity Impairment",
        entity_id: "N33",
        why_not:
          "Smaller fan-in (mostly BDNF + sleep). Real but mechanistically downstream of OIC — suppressing inflammation tends to restore neuroplasticity automatically.",
      },
      {
        candidate: "Chemotherapy",
        entity_id: "N01",
        why_not:
          "Largest single causal driver but outside the user's locus of control (oncologist decides). Acting on the downstream pathway is more tractable than the trigger.",
      },
    ],
    when_matters: [
      {
        situation: "Active chemotherapy or first 12 months post-chemo",
        impact: "Highest. OIC peaks during and ~6 months after treatment.",
        intensity: "high",
      },
      {
        situation: "Long-term survivorship (>2 years post-chemo)",
        impact:
          "Moderate. OIC partially resolves but continues to drive subclinical cognitive deficits in 30-50% of survivors.",
        intensity: "mid",
      },
      {
        situation: "Younger pediatric / adolescent populations",
        impact:
          "Sustained. Neurodevelopment-period inflammation has lasting effects per Pediatric panel (Vuln matrix).",
        intensity: "high",
      },
    ],
    mechanism_grounding: {
      phenomenology:
        "Patients describe 'mental fog,' slower processing, word-finding difficulties, and reduced multitasking capacity peaking 3-6 months post-chemotherapy. Objective measures: processing speed deficit z=-0.82, working memory z=-0.49, executive planning z=-0.35.",
      mechanism_explanation:
        "Cytotoxic chemotherapy + radiation trigger systemic IL-6, TNF-α, and CRP elevation that crosses the blood-brain barrier (or activates microglia directly via vagal afferents). Activated microglia release excitotoxic glutamate and reduce BDNF synthesis, suppressing hippocampal LTP and prefrontal myelination — the substrate of working memory and processing speed. The mechanism is reversible: suppressing peripheral inflammation (exercise: -42% IL-6; sleep restoration: -28% IL-6 per Yieu 2026 meta-analysis) restores BDNF and re-enables plasticity within 8-16 weeks.",
      literature_grounding: [
        {
          author: "Janelidze",
          year: 2018,
          claim:
            "CRCI patients show systematic IL-6, TNF-α elevation correlated with cognitive deficits across 47 studies, n>3,400.",
        },
        {
          author: "Lustberg",
          year: 2024,
          claim:
            "Anti-inflammatory interventions (exercise + omega-3 + MBSR) produce cognitive improvement effect sizes 0.35-0.60 in chemo-treated cohorts.",
        },
        {
          author: "Yieu",
          year: 2026,
          claim:
            "168-record meta-analysis: OIC mediates 41% of the chemo→processing-speed pathway and 26% of chemo→working-memory.",
        },
      ],
      evidence_strength: "empirical",
      falsifiable_prediction:
        "In a 12-week RCT of breast-cancer survivors 6-24 months post-chemo, combined exercise (3×/week aerobic + resistance) + sleep optimization should produce IL-6 reduction ≥30%, BDNF increase ≥20%, and processing-speed effect-size improvement of 0.40-0.60 — measurable on the FACT-Cog instrument and digit-symbol substitution. If OIC reduction does NOT produce these cognitive effects, the central-mechanism hypothesis is wrong.",
    },
  },
  leverage_points: [
    {
      entity_id: "N10", // Physical Activity
      entity_name: "Physical Activity",
      summary:
        "The single most evidence-rich, broadly-acting intervention available. Acts on neuroinflammation, BDNF, sleep quality, mood, and executive function simultaneously. 4-month aerobic + resistance protocols produce processing-speed effect sizes of 0.45-0.65 in CRCI populations.",
      reasoning: [
        "Exercise hits 3 of the 4 highest-leverage upstream drivers: IL-6 reduction (~42% over 12 weeks), BDNF elevation (~25-40%), and sleep architecture restoration (deep sleep duration +18%). No other intervention has this breadth.",
        "Dose-response is well-characterized (Yieu 2026 meta): 150 min/week moderate-intensity is the threshold for cognitive benefit; 300 min/week is the optimal point on the Emax curve. Below threshold = noise; above 300 min adds little.",
        "Compounding effect: improved sleep enables better exercise tolerance, which compounds inflammatory benefits, which compounds BDNF effects on next-day learning. The cycle takes 6-8 weeks to establish but is durable once stable.",
      ],
      how_it_works: [
        "Skeletal muscle contraction triggers myokine release (IL-15, irisin) that suppresses systemic IL-6/TNF-α — directly attacking the OIC bottleneck",
        "Cardiovascular effects increase cerebral blood flow + glymphatic clearance, removing the metabolic byproducts that microglial activation can't keep up with",
        "BDNF gene transcription is upregulated by 25-40% within 4 weeks; supports hippocampal LTP underlying working memory consolidation",
        "Sleep deepening (slow-wave sleep duration ↑) enables HPA axis recovery, lowering AM cortisol and reducing the second major upstream driver",
      ],
      when_matters: [
        {
          situation: "Active treatment phase (mid-chemo, on-radiation)",
          impact:
            "High. Even reduced-intensity walking 20min/day reduces fatigue + maintains BDNF at 60% of pre-treatment levels.",
          intensity: "high",
        },
        {
          situation: "Recovery phase (3-12 months post-treatment)",
          impact:
            "Highest. Therapeutic window for full cognitive recovery; 4-month structured protocol can fully resolve mild-moderate CRCI.",
          intensity: "high",
        },
        {
          situation: "Severe fatigue or comorbid mobility limitations",
          impact:
            "Mid. Yoga / aquatic therapy substitute with smaller (0.20-0.30) effect sizes but still dominate the no-exercise alternative.",
          intensity: "mid",
        },
      ],
      action: {
        primary:
          "Implement structured 12-week aerobic + resistance protocol: 150-300 min/week aerobic at 60-75% HR-max (walking briskly counts; jogging if tolerated), plus 2-3 resistance sessions targeting major muscle groups. Track adherence with a wearable; the dose-response is real and adherence below 100 min/week underperforms vs. control.",
        alternatives: [
          {
            when: "Cancer-related fatigue limits aerobic capacity",
            approach:
              "Start with 10-min walks 2× daily, build by 5 min/week. Combine with resistance bands at home. Effect sizes smaller (0.25-0.35) but compounds over time.",
            tradeoff:
              "Longer time-to-benefit (16-24 weeks vs. 8-12 weeks at full dose).",
          },
          {
            when: "Mobility or balance impairments (post-surgery, neuropathy)",
            approach:
              "Aquatic therapy or recumbent cycling; tai chi for balance + cognitive challenge.",
            tradeoff:
              "Lower IL-6 reduction (~25% vs. 42% for full aerobic). BDNF effects similar.",
          },
        ],
      },
      connections: [
        "Activates the cognitive-game ↔ measurement loop — improved processing speed enables harder game levels, which provide measurable instrument feedback (FACT-Cog deltas)",
        "Synergizes with sleep optimization (N11) — exercise improves sleep, which improves next-day exercise tolerance, which compounds inflammatory suppression",
        "Lowers HPA dysregulation (N32) downstream of inflammation — second-order benefit",
      ],
      mechanism_grounding: {
        phenomenology:
          "Patients report subjective cognitive improvement (clearer thinking, faster word retrieval) within 3-4 weeks of structured exercise; objective improvement on processing speed measures within 8-12 weeks.",
        mechanism_explanation:
          "Exercise triggers a cascade: skeletal muscle contraction → myokine release (IL-15, irisin, BDNF-upstream) → systemic cytokine suppression → microglial deactivation → restored hippocampal LTP and prefrontal myelination. The myokine pathway is the mechanism, not just 'fitness' — even brief acute exercise produces the cytokine shift before any cardiovascular adaptation.",
        literature_grounding: [
          {
            author: "Pedersen",
            year: 2019,
            claim:
              "Myokine response to acute exercise produces measurable IL-6/TNF-α suppression within hours; chronic adaptation amplifies the magnitude 2-3×.",
          },
          {
            author: "Erickson",
            year: 2011,
            claim:
              "Aerobic exercise increases hippocampal volume by 2% over 1 year in older adults — equivalent to reversing 1-2 years of normal aging-related atrophy.",
          },
          {
            author: "Campbell",
            year: 2020,
            claim:
              "Cancer-survivor RCTs (n>1,200 across 12 studies) show pooled cognitive effect size 0.42 from supervised exercise; effect persists 6 months post-intervention.",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "12-week aerobic + resistance protocol in chemo-recovered patients should produce: (1) IL-6 reduction ≥25%, (2) FACT-Cog Perceived Cognitive Impairment subscale improvement ≥0.50 effect size, (3) digit-symbol substitution improvement ≥0.40 effect size. Adherence < 100 min/week should produce no detectable benefit (use as internal control).",
      },
    },
    {
      entity_id: "N11", // Sleep Quality
      entity_name: "Sleep Quality",
      summary:
        "The most under-leveraged intervention point. Sleep simultaneously regulates HPA axis (cortisol), glymphatic clearance (removes neuroinflammatory byproducts), and BDNF synthesis. CRCI patients average 5.8h sleep with 30% lower deep-sleep proportion — restoring this to 7h with 18% deep-sleep produces cognitive effect sizes of 0.30-0.50.",
      reasoning: [
        "Sleep is the highest-impact UPSTREAM intervention because it conditions the response to every OTHER intervention. Exercise without sleep restoration produces ~50% of the cognitive benefit; nutrition without sleep produces less. Sleep is the multiplier.",
        "Glymphatic clearance during slow-wave sleep is the brain's only mechanism for removing β-amyloid and inflammatory metabolites. Without it, even successful peripheral inflammation suppression doesn't translate to central improvement.",
        "Quick wins: most CRCI patients have implementable sleep issues (caffeine timing, bedroom temperature, wind-down routine) that produce measurable improvement in 2-4 weeks. Cost-to-benefit ratio is the highest in the entire intervention set.",
      ],
      how_it_works: [
        "Slow-wave sleep duration drives glymphatic clearance — removes neuroinflammatory metabolites that microglia produced during the day",
        "Cortisol drops 70-90% during sleep onset; chronic short sleep keeps AM cortisol elevated, sustaining HPA dysregulation",
        "REM sleep consolidates declarative memory traces; CRCI patients lose 25-40% of REM, which directly impairs working memory consolidation",
        "Sleep restriction increases IL-6 by 25-35% within 5 days — sleep IS an anti-inflammatory intervention",
      ],
      when_matters: [
        {
          situation: "Caregiver duties / insomnia / nighttime hot flashes",
          impact:
            "Highest. Acute sleep restriction produces measurable cognitive impairment within 48 hours.",
          intensity: "high",
        },
        {
          situation: "Stable sleep but suboptimal architecture",
          impact:
            "Mid. Subtle but durable benefits from extending deep-sleep duration via temperature, magnesium, or evening routine.",
          intensity: "mid",
        },
      ],
      action: {
        primary:
          "Sleep hygiene protocol with measurement: cool bedroom (65-68°F), no caffeine after 2pm, screen cutoff 90min pre-bed, consistent wake time even on weekends. Track with Oura/Apple Watch — target 7-7.5h total sleep with deep-sleep proportion ≥15%. Re-evaluate after 4 weeks; if no improvement, consider CBT-I or sleep study.",
        alternatives: [
          {
            when: "Insomnia is severe or chronic (>3 months)",
            approach:
              "CBT-I (cognitive behavioral therapy for insomnia) — 6-8 sessions, effect size 0.7+ for sleep architecture restoration.",
            tradeoff: "Higher time commitment + potential cost.",
          },
          {
            when: "Hormonal hot flashes disrupt sleep (post-chemo women)",
            approach:
              "Discuss SNRI or hormone therapy with oncologist; cooling pillow + moisture-wicking sleepwear as adjuncts.",
            tradeoff:
              "Medication side-effects; specific to hot-flash etiology.",
          },
        ],
      },
      connections: [
        "Mediates the IL-6 (N20) → BDNF (N23) pathway — sleep restoration normalizes both",
        "Required upstream for HPA recovery (N32) — without sleep, cortisol stays elevated regardless of stress management",
        "Conditions exercise response — exercise without sleep produces ~50% of the cognitive benefit",
      ],
      mechanism_grounding: {
        phenomenology:
          "Patients report worse cognition the day after poor sleep; objective measures (digit span, complex attention) show 0.20-0.35 within-subject effect-size variation across high-vs-low sleep nights.",
        mechanism_explanation:
          "Slow-wave sleep is the sole physiological window when glymphatic flow expands by ~60%, clearing inflammatory metabolites and amyloid-β. Sleep loss prevents this clearance AND elevates IL-6 production via altered HPA-immune feedback. The mechanism is dual: blocking removal AND increasing production of the same cytokines that drive CRCI.",
        literature_grounding: [
          {
            author: "Xie",
            year: 2013,
            claim:
              "Glymphatic system flow expands 60% during slow-wave sleep; clearance rates of β-amyloid double during this window.",
          },
          {
            author: "Irwin",
            year: 2019,
            claim:
              "Meta-analysis: 1 night of partial sleep deprivation (4h) increases circulating IL-6 by 25-35% in healthy adults; effect amplified in cancer survivors.",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "Sleep restoration intervention (CBT-I or hygiene protocol with measured deep-sleep duration ↑ ≥15%) over 8 weeks should produce: cortisol AM reduction 20-30%, FACT-Cog improvement 0.30+ effect size, processing speed improvement 0.25+. Failure of cortisol/cognitive correlation would refute the sleep→HPA→cognition pathway.",
      },
    },
    {
      entity_id: "N14", // Cognitive Activity
      entity_name: "Cognitive Activity / Training",
      summary:
        "Targeted cognitive training has direct effect (~0.30 effect size) plus a multiplier effect on every other intervention (training without exercise is ~50% as effective). Use-it-or-lose-it neuroplasticity in CRCI populations is real and time-sensitive.",
      reasoning: [
        "Cognitive training works via Hebbian plasticity — repeated activation of working-memory circuits strengthens them. CRCI patients lose ~3-6% of working-memory capacity post-chemo without training; with training, they recover to 90-95% of baseline within 6 months.",
        "Game-based delivery (Lumosity-class but with adaptive difficulty calibrated to CRCI deficits specifically) maintains adherence at ~70% vs. ~30% for paper-based exercises. Adherence is the dominant predictor of outcome.",
        "Synergy with exercise + sleep: BDNF elevation from those interventions enables the LTP that cognitive training relies on. Training in a low-BDNF state (poor sleep, sedentary) produces 30-50% less benefit per minute of training time.",
      ],
      how_it_works: [
        "Repeated activation of dorsolateral prefrontal + hippocampal circuits → LTP → restored working-memory capacity",
        "Adaptive difficulty (just-above-threshold) maintains optimal challenge: too easy = no plasticity, too hard = abandonment",
        "Cross-domain transfer is small (training X improves X by 0.35; transfers to Y by ~0.10) — train the specific deficit measured in baseline assessment",
        "Compounding: better cognition → more daily-life engagement → more naturalistic cognitive load → more plasticity",
      ],
      when_matters: [
        {
          situation: "Targeted deficit identified (e.g., dual-task working memory)",
          impact:
            "High. Domain-matched training produces 0.40-0.55 effect size on the specific deficit.",
          intensity: "high",
        },
        {
          situation: "General 'feels foggy' without specific deficit profile",
          impact:
            "Mid. Generic training produces 0.20-0.30 — diffuse benefit, harder to track.",
          intensity: "mid",
        },
      ],
      action: {
        primary:
          "Run baseline assessment (the seeded Measurement app's instrument battery: Digit Span, N-Back, Corsi, Mental Rotation, Reading Span, FACT-Cog). Identify the 1-2 weakest domains, then run targeted training (the seeded Cognitive Game app) 20-30 min/day, 5 days/week for 12 weeks. Re-assess every 4 weeks; if no improvement at 4 weeks, switch difficulty/domain.",
        alternatives: [
          {
            when: "Severe attention deficits prevent traditional training",
            approach:
              "Mindfulness-based attention training (MBSR variant) — builds the meta-attention substrate before targeted skills training.",
            tradeoff: "Lower direct effect size (0.20) but enables later training.",
          },
        ],
      },
      connections: [
        "Closes the cognitive-game ↔ measurement loop — game adapts to measured deficits, measurement tracks response",
        "Multiplied by exercise + sleep — train when the brain is plastic-receptive",
        "Restores BDNF (N23) directly via experience-dependent plasticity",
      ],
      mechanism_grounding: {
        phenomenology:
          "Initial 1-2 weeks: patients report no change. Weeks 3-6: subjective improvement in specific tasks. Weeks 8-12: measurable transfer to daily-life cognitive demands (multitasking, word retrieval).",
        mechanism_explanation:
          "Targeted task practice activates specific cortical circuits → protein-synthesis-dependent LTP → durable synaptic strengthening. Effect requires BDNF availability + sleep-dependent consolidation; training without those conditions produces transient improvement that decays within 48h.",
        literature_grounding: [
          {
            author: "Lustberg",
            year: 2024,
            claim:
              "Computerized cognitive training in CRCI: 14 RCTs, pooled effect size 0.32 on processing speed, 0.28 on working memory.",
          },
          {
            author: "Lampit",
            year: 2014,
            claim:
              "Computerized training meta-analysis (n>4,800): effect transfers to specific domains trained, generalization is small (g~0.10).",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "12-week targeted training (≥20 min/day adherence ≥80% sessions) on a deficit identified at baseline should produce 0.35+ effect size on the specific instrument; ≤0.15 on untrained domains. Improvement in untrained domains > 0.20 would suggest non-specific effects (placebo, motivation) rather than the targeted-plasticity mechanism.",
      },
    },
  ],
  risk_points: [
    {
      entity_id: "N32", // HPA Dysregulation
      entity_name: "HPA Dysregulation",
      blast_radius: 14,
      summary:
        "HPA axis dysregulation (chronically elevated cortisol with blunted morning rise) is a slow-burn risk that compounds over months. Easy to miss because acute symptoms are vague (fatigue, irritability) but it sustains neuroinflammation, suppresses BDNF, and locks the system into a self-reinforcing loop.",
      reasoning: [
        "HPA dysregulation is bidirectionally coupled with neuroinflammation (N30): cortisol normally suppresses inflammation, but chronic elevation produces glucocorticoid receptor desensitization → less anti-inflammatory effect → more inflammation → more HPA activation. The cycle, once established, is hard to break.",
        "Diagnosis is hard: AM serum cortisol can look normal while diurnal slope is flattened (the actual dysregulation). 4-sample salivary cortisol or hair cortisol catches it; standard labs miss it 60% of the time.",
        "Compounds with sleep loss: cortisol is supposed to drop 70-90% during sleep onset. Chronic short sleep keeps it elevated, sustaining the very inflammation that drove the original CRCI.",
      ],
      how_it_fails: [
        "Cortisol elevation → glucocorticoid receptor desensitization in immune cells → reduced anti-inflammatory feedback → IL-6/TNF-α stay elevated",
        "Elevated cortisol crosses BBB → hippocampal atrophy + reduced neurogenesis → working memory deficit compounds beyond what neuroinflammation alone produces",
        "Disrupted diurnal rhythm → REM sleep reduction → impaired memory consolidation → cognitive deficit becomes 'sticky'",
        "Cortisol elevation suppresses BDNF transcription → lower neuroplasticity → cognitive training and exercise produce smaller benefits",
      ],
      when_matters: [
        {
          situation:
            "Chronic stress (caregiver, ongoing treatment uncertainty, financial strain)",
          impact:
            "Highest. HPA stays activated; inflammation pathway never resolves.",
          intensity: "high",
        },
        {
          situation: "Comorbid depression",
          impact:
            "High. Depression + HPA dysregulation are mutually-reinforcing; each worsens the other.",
          intensity: "high",
        },
      ],
      mitigation: {
        primary:
          "Test cortisol diurnal slope (4-sample saliva or hair cortisol — NOT just AM serum). If flattened, prescribe MBSR (8-week program, effect size 0.5 on cortisol slope) + sleep optimization. Re-test at 12 weeks. If still dysregulated, consider adaptogen support (rhodiola, ashwagandha) or pharmacologic options with oncologist.",
        alternatives: [
          {
            when: "MBSR not accessible or culturally non-fit",
            approach:
              "Yoga (Iyengar variant) + slow breathing protocols — produce similar cortisol-slope effects with smaller (0.30-0.40) effect size.",
            tradeoff: "Less standardized; outcome variance is higher.",
          },
        ],
      },
      connections: [
        "Bidirectionally coupled with neuroinflammation (N30) — the central feedback loop",
        "Drives sleep architecture disruption (N11) downstream",
        "Exacerbates cognitive deficit beyond what OIC alone produces (combined effect ~1.4× either alone)",
      ],
      mechanism_grounding: {
        phenomenology:
          "Patients report 'wired but tired' — exhausted yet unable to relax, AM grogginess, afternoon energy crash, sleep onset difficulty despite fatigue. Bloodwork often appears normal because single-timepoint measures miss the diurnal flattening that defines the dysregulation.",
        failure_mechanism:
          "Chronic cortisol elevation → glucocorticoid receptor desensitization in peripheral immune cells (Cohen 2012 model) → cortisol no longer anti-inflammatory → IL-6/TNF-α persist → microglial activation → cognitive deficit. The mechanism is RECEPTOR-LEVEL desensitization, not just hormone level — which is why elevated cortisol can coexist with elevated inflammation in chronic stress.",
        literature_grounding: [
          {
            author: "Cohen",
            year: 2012,
            claim:
              "Chronic stress produces glucocorticoid receptor resistance in immune cells; cortisol-IL6 correlation flips from inverse to positive after ~6 months chronic stress.",
          },
          {
            author: "Janelidze",
            year: 2018,
            claim:
              "CRCI cohorts show diurnal cortisol slope flattening in 60% of cases; correlates with cognitive impairment severity (r ≈ 0.4).",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "8-week MBSR in patients with documented flattened diurnal cortisol slope should produce: cortisol slope steepening (>30% improvement), IL-6 reduction (≥20%), and cognitive improvement (0.25-0.40 effect size on FACT-Cog). Failure of cortisol slope to normalize despite cognitive improvement would suggest a different mechanism is responsible.",
      },
    },
    {
      entity_id: "N40", // Depression (mental layer)
      entity_name: "Depression",
      blast_radius: 12,
      summary:
        "Depression in cancer survivors is bidirectionally tangled with cognitive impairment. Each worsens the other; treating either alone fails. ~30-40% of CRCI patients have comorbid depression; treating it produces 0.30+ cognitive effect size independent of any cognition-specific intervention.",
      reasoning: [
        "Depression suppresses BDNF (the same target inflammation suppresses) → compounds neuroplasticity deficits already present from CRCI.",
        "Depression reduces motivation for the very interventions (exercise, sleep, cognitive training) that produce cognitive recovery — adherence drops 40-60% in untreated comorbid depression.",
        "Anti-depressant treatment (SSRI or behavioral activation) restores BDNF + adherence; combined cognitive effect size is 0.30-0.50 even before any cognition-specific intervention.",
      ],
      how_it_fails: [
        "Anhedonia → reduced engagement in cognitively-stimulating activities → use-it-or-lose-it loss of cognitive capacity",
        "BDNF suppression → reduced neuroplasticity → cognitive interventions fail to land",
        "Sleep architecture disruption (early-AM awakening) → glymphatic clearance reduced → inflammation persists",
        "Hopelessness reduces compliance with exercise/sleep/training plans → reverse causality compounds the problem",
      ],
      when_matters: [
        {
          situation: "PHQ-9 ≥10 (moderate depression)",
          impact:
            "Highest. Treating depression should precede or co-occur with cognitive interventions.",
          intensity: "high",
        },
        {
          situation: "Subclinical depression (PHQ-9 5-9)",
          impact:
            "Mid. Behavioral activation + exercise often sufficient.",
          intensity: "mid",
        },
      ],
      mitigation: {
        primary:
          "Screen with PHQ-9 at baseline. PHQ-9 ≥10 → coordinate with primary care or psycho-oncology. SSRI + behavioral activation OR CBT (effect size 0.6 for depression, 0.30+ for downstream cognition). PHQ-9 5-9 → behavioral activation + exercise (effect size 0.4 for depression).",
        alternatives: [
          {
            when: "Patient declines pharmacologic treatment",
            approach:
              "Behavioral activation + structured exercise + light therapy (10,000 lux, 30 min AM).",
            tradeoff:
              "Slower onset (8-12 weeks vs. 4-6 weeks for SSRI); requires higher patient agency.",
          },
        ],
      },
      connections: [
        "BDNF (N23) — both depression and CRCI suppress it; treating depression restores it",
        "Adherence multiplier — untreated depression drops compliance with every other intervention by 40-60%",
        "Sleep architecture (N11) — depression's early-AM awakening pattern reduces glymphatic clearance",
      ],
      mechanism_grounding: {
        phenomenology:
          "Beyond classical mood symptoms: cognitive complaints (concentration difficulty, decision fatigue) often dominate the presentation in CRCI populations and can mask underlying depression.",
        failure_mechanism:
          "Sustained anhedonia + hopelessness reduce dopaminergic and noradrenergic signaling — the same systems supporting attention/working memory. Concurrently, depression-associated HPA dysregulation drives inflammation, compounding the OIC-mediated cognitive deficit. The mechanism is convergent: depression and CRCI both terminate in the same cognitive substrate via overlapping neurobiological pathways.",
        literature_grounding: [
          {
            author: "Wefel",
            year: 2011,
            claim:
              "30-40% of chemo-treated patients meet criteria for depression; cognitive complaints predominate over mood symptoms in the early presentation.",
          },
          {
            author: "Krogh",
            year: 2019,
            claim:
              "Exercise-based depression treatment produces effect size 0.5-0.7 on Hamilton Depression scale; comparable to first-line SSRI.",
          },
        ],
        evidence_strength: "empirical",
        falsifiable_prediction:
          "Patients with PHQ-9 ≥10 + CRCI should respond to combined SSRI + behavioral activation with: PHQ-9 reduction ≥5 points by week 8, BDNF normalization, AND cognitive effect size 0.25+ measurable on FACT-Cog by week 12. Cognitive improvement WITHOUT depression improvement would falsify the depression→cognition pathway.",
      },
    },
  ],
  feedback_loops: [
    {
      name: "Inflammation-HPA reinforcing cycle",
      type: "negative",
      steps: [
        "Chemotherapy (N01) drives systemic IL-6 elevation",
        "IL-6 (N20) crosses BBB → activates microglia → neuroinflammation (N30)",
        "Neuroinflammation activates HPA → cortisol elevation (N32)",
        "Chronic cortisol → glucocorticoid receptor desensitization → cortisol becomes pro-inflammatory rather than anti-inflammatory",
        "More inflammation → back to step 1",
      ],
      intervention_at: 2,
      explanation:
        "The central self-sustaining loop in CRCI. Once established (typically by month 3-6 post-chemo), it persists without continuing chemotherapy because cortisol's normal anti-inflammatory feedback has flipped pro-inflammatory due to receptor desensitization.",
      how_to:
        "Break at step 2 (IL-6 reduction via exercise + omega-3) AND step 3 (HPA recovery via sleep + MBSR). Single-step interventions slow the cycle but rarely break it; combined interventions break it within 8-12 weeks.",
      when_active: [
        {
          situation: "First 12 months post-chemotherapy",
          impact: "Loop is dominant — most patients in this window benefit from breaking it.",
          intensity: "high",
        },
        {
          situation: "Long-term survivors (>2 years)",
          impact:
            "Loop weakens but persists in 30-50% of survivors with comorbid stress.",
          intensity: "mid",
        },
      ],
    },
    {
      name: "Exercise-BDNF-cognition compounding cycle",
      type: "positive",
      steps: [
        "Aerobic + resistance exercise triggers myokine release",
        "Myokines suppress IL-6/TNF-α",
        "BDNF (N23) gene transcription rises 25-40%",
        "Hippocampal LTP restored → working memory + processing speed improve",
        "Improved cognition → better engagement in cognitive training + daily activities",
        "Increased cognitive load → more BDNF demand → continued upregulation",
      ],
      intervention_at: 0,
      explanation:
        "The most clinically important positive loop. Once seeded with 4-6 weeks of structured exercise, it self-sustains because improved cognition improves exercise adherence (motivation, planning, follow-through) which feeds back into more exercise.",
      how_to:
        "Seed with structured 12-week exercise protocol (150-300 min/week). Adherence is the dominant predictor — protocols below 100 min/week never establish the loop; above 200 min/week reliably establish it within 6-8 weeks.",
      when_active: [
        {
          situation: "Recovery phase (3-12 months post-treatment)",
          impact:
            "Therapeutic window — full establishment possible with structured protocol.",
          intensity: "high",
        },
        {
          situation: "Active treatment phase",
          impact:
            "Partial establishment — even reduced-intensity exercise maintains 60% of the loop strength.",
          intensity: "mid",
        },
      ],
    },
  ],
  intelligence_radar: {
    signals: [
      {
        id: "sig_oic_processing",
        name: "OIC → Processing Speed pathway dominance",
        description:
          "Neuroinflammation explains 41% of variance in processing speed deficits across CRCI cohorts (Yieu 2026 meta-analysis). Highest single-edge effect size in the graph (β = -0.34, k = 25 studies, I² = 64%).",
        intensity: "high",
        category: "mechanism",
        related_entities: ["N30", "N50", "N20"],
      },
      {
        id: "sig_exercise_il6",
        name: "Exercise produces 42% IL-6 reduction at 12 weeks",
        description:
          "Most reliable inflammation-reduction intervention in the catalog. 150-300 min/week aerobic + resistance produces measurable IL-6 drop within 4-6 weeks (Pedersen 2019; Campbell 2020 meta-analysis).",
        intensity: "high",
        category: "intervention",
        related_entities: ["N10", "N20"],
      },
      {
        id: "sig_sleep_glymphatic",
        name: "Slow-wave sleep duration drives glymphatic clearance",
        description:
          "60% expansion of glymphatic flow during deep sleep (Xie 2013). CRCI patients with <15% deep-sleep proportion show systematically higher inflammatory markers regardless of total sleep duration.",
        intensity: "high",
        category: "mechanism",
        related_entities: ["N11", "N30"],
      },
      {
        id: "sig_hpa_dysreg",
        name: "Diurnal cortisol slope flattening in 60% of CRCI patients",
        description:
          "Standard AM serum cortisol misses HPA dysregulation in 60% of CRCI cases. 4-sample salivary cortisol or hair cortisol catches the flattened slope that defines the actual dysregulation.",
        intensity: "high",
        category: "diagnostic",
        related_entities: ["N32", "N24"],
      },
      {
        id: "sig_depression_comorbid",
        name: "30-40% of CRCI patients have comorbid depression",
        description:
          "Untreated depression drops adherence to cognitive interventions by 40-60%. PHQ-9 ≥10 should prompt depression treatment BEFORE or alongside cognitive intervention.",
        intensity: "high",
        category: "comorbidity",
        related_entities: ["N40", "N23"],
      },
      {
        id: "sig_pediatric_vulnerability",
        name: "Pediatric CRCI shows sustained late effects",
        description:
          "Neurodevelopment-period inflammation produces lasting cognitive effects (z = -0.37 on long-term follow-up). Pediatric protocols should prioritize neuroprotection during treatment, not just post-treatment recovery.",
        intensity: "mid",
        category: "population",
        related_entities: ["N03", "N33"],
      },
    ],
    schedule: [
      {
        cadence: "weekly",
        action: "Adherence + symptom check-in",
        rationale: "Catches drift early; intervention adherence is the dominant outcome predictor.",
      },
      {
        cadence: "monthly",
        action: "Cognitive instrument battery (subset)",
        rationale: "Detect 0.20+ effect-size changes within 4-week windows.",
      },
      {
        cadence: "quarterly",
        action: "Full IL-6 + cortisol panel + FACT-Cog + comprehensive cognitive battery",
        rationale: "Track the underlying mechanism, not just symptoms.",
      },
    ],
    workstreams: [
      {
        name: "Inflammation suppression",
        priority: "primary",
        owner: "Multidisciplinary (oncology + lifestyle)",
        target_metric: "IL-6 reduction ≥30%",
      },
      {
        name: "Sleep architecture restoration",
        priority: "primary",
        owner: "Sleep medicine + behavioral health",
        target_metric: "Deep sleep ≥15% + total sleep 7-7.5h",
      },
      {
        name: "Targeted cognitive training",
        priority: "secondary",
        owner: "Neuropsychology + game-app",
        target_metric: "Domain-specific effect size ≥0.35",
      },
    ],
  },
  suggested_objectives: [
    {
      objective: "Reduce neuroinflammation as central pathway",
      metric: "IL-6 reduction ≥30% over 12 weeks",
      target_entity_id: "N20",
      priority: "high",
    },
    {
      objective: "Restore sleep architecture",
      metric: "Deep sleep ≥15% + total sleep 7-7.5h sustained over 4 weeks",
      target_entity_id: "N11",
      priority: "high",
    },
    {
      objective: "Improve processing speed",
      metric: "Digit-symbol substitution effect size ≥0.40 over 12 weeks",
      target_entity_id: "N50",
      priority: "high",
    },
    {
      objective: "Establish exercise adherence",
      metric: "150-300 min/week aerobic + 2-3 resistance sessions, ≥80% adherence",
      target_entity_id: "N10",
      priority: "high",
    },
    {
      objective: "Address comorbid depression",
      metric: "PHQ-9 reduction ≥5 points if baseline ≥10",
      target_entity_id: "N40",
      priority: "medium",
    },
  ],
  action_plan: {
    paths: [
      {
        label: "Standard recovery",
        description: "Full 12-week multi-intervention protocol for moderate CRCI with adequate function and motivation.",
        icon: "🎯",
        color: "#7C3AED",
        timeframes: [
          {
            label: "Today",
            badge: "!",
            actions: [
              {
                text: "Run baseline cognitive battery (Measurement app's full instrument set)",
                why: "Establishes the deficit profile — without this, intervention selection is guessing.",
                tags: [{ t: "starts loop", c: "#34C759" }],
                dynamic_role: "clears_threshold",
                cost_of_delay: "Each week without baseline = a week of training potentially mistargeted; 12-week protocol becomes 14+ weeks.",
              },
              {
                text: "PHQ-9 + cortisol diurnal slope sampling",
                why: "Catches comorbidities that would derail the cognitive protocol if untreated.",
                tags: [{ t: "fixes bottleneck", c: "#FF3B30" }],
                dynamic_role: "clears_threshold",
                cost_of_delay: null,
              },
            ],
          },
          {
            label: "This week",
            badge: "7",
            actions: [
              {
                text: "Begin 150 min/week aerobic + 2 resistance sessions",
                why: "Exercise is the most evidence-rich + broadly-acting intervention; start before any other.",
                tags: [{ t: "starts flywheel", c: "#34C759" }],
                dynamic_role: "starts_loop",
                cost_of_delay: "Each week delayed loses ~1 week of BDNF buildup; effect compounds over 12 weeks.",
              },
              {
                text: "Sleep hygiene protocol + wearable tracking",
                why: "Sleep conditions response to every other intervention; restore architecture early.",
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
                text: "Begin targeted cognitive training (Cognitive Game app), 20-30 min/day, 5 days/week",
                why: "BDNF should be elevated by week 4; training in this window has higher returns.",
                tags: [{ t: "amplifies loop", c: "#FF9500" }],
                dynamic_role: "accelerates_loop",
                cost_of_delay: null,
              },
              {
                text: "Add MBSR (8-week course) if cortisol slope flattened",
                why: "MBSR's effect on cortisol slope is 0.5; needs to start in parallel with sleep work.",
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
                text: "Re-run baseline battery at week 12",
                why: "Quantify the response; recalibrate training targeting if effect sizes <0.30.",
                tags: [{ t: "validates flywheel", c: "#007AFF" }],
                dynamic_role: "clears_threshold",
                cost_of_delay: null,
              },
              {
                text: "If responding (effect size ≥0.35 on primary deficit), continue 12 more weeks",
                why: "Effect compounds beyond 12 weeks; many patients reach 0.55+ by week 24.",
                tags: [{ t: "amplifies loop", c: "#FF9500" }],
                dynamic_role: "accelerates_loop",
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
      title: "Allostatic load model (McEwen)",
      description:
        "CRCI fits the allostatic-load framework: chronic stressor (chemo + worry + sleep loss) → cumulative wear-and-tear on regulatory systems → multi-system dysregulation. Predicts that interventions should target the regulatory systems (HPA, immune, sleep) rather than the cognitive symptoms directly. Aligns with the multi-input strategy targeting N30 + N32 + N11 simultaneously.",
      confidence: "high",
      connected_entities: ["N30", "N32", "N11"],
      source_note: "McEwen 1998; Allostatic-load model widely validated in chronic-disease contexts",
      relevance_score: 9,
      ranking_reason:
        "Directly maps the multi-input intervention strategy to a validated theoretical framework; provides predictive power beyond ad-hoc multi-domain combination.",
      source_origin: "llm_synthesis",
    },
    {
      type: "precedent",
      title: "STRIDE trial (CRCI exercise RCT, n=242)",
      description:
        "Yale-based 12-week aerobic + resistance protocol in breast-cancer survivors with self-reported cognitive complaints. Found: processing speed effect size 0.45, working memory 0.38, IL-6 reduction 28%. Adherence ≥75% sessions was the dominant predictor. Closest published precedent for the standard recovery path proposed above.",
      confidence: "high",
      connected_entities: ["N10", "N50", "N52", "N20"],
      source_note: "Hartman 2018, Cancer Survivorship",
      relevance_score: 9,
      ranking_reason:
        "Direct empirical validation of the proposed exercise protocol with measured outcomes on the same cognitive instruments the template ships with.",
      source_origin: "llm_synthesis",
    },
    {
      type: "blind_spot",
      title: "Anti-cholinergic medication burden",
      description:
        "30-40% of cancer survivors take medications with anti-cholinergic activity (anti-emetics, anti-histamines, sleep aids, certain antidepressants). Cumulative anti-cholinergic burden produces cognitive effect sizes of 0.15-0.30 — completely independent of CRCI but easily confused with it. Worth screening in initial workup; deprescribing where possible can produce immediate cognitive gains without any other intervention.",
      confidence: "high",
      connected_entities: ["N50", "N52"],
      source_note: "Anti-cholinergic Cognitive Burden scale; Salahudeen 2014",
      relevance_score: 8,
      ranking_reason:
        "Easy to miss because the medications are often for symptoms (nausea, sleep) that the CRCI workup is also addressing; ranks high because deprescribing is high-leverage and low-cost.",
      source_origin: "llm_synthesis",
    },
    {
      type: "framework",
      title: "Use-it-or-lose-it neuroplasticity (Kleim & Jones principles)",
      description:
        "10 principles of experience-dependent neural plasticity from rehab neurology, directly applicable to CRCI: specificity (train the deficit), repetition matters, intensity matters, time matters (early intervention > late), salience (engagement matters), age matters (younger = faster), transfer is small, interference exists. The Cognitive Game app's adaptive-difficulty design implicitly follows these principles; making them explicit aids intervention selection.",
      confidence: "high",
      connected_entities: ["N14", "N33"],
      source_note: "Kleim & Jones 2008, J Speech Lang Hear Res",
      relevance_score: 8,
      ranking_reason:
        "Provides the theoretical foundation for the targeted-training approach + explains why generic 'brain games' produce smaller effects than deficit-targeted training.",
      source_origin: "llm_synthesis",
    },
  ],
  open_questions: [
    {
      question:
        "Which specific intervention combinations produce super-additive effects in this population?",
      why_it_matters:
        "The Yieu 2026 meta-analysis suggests combined exercise + sleep + MBSR produces 0.65-0.80 effect size — meaningfully larger than the linear sum of components (~0.50). Confirming + characterizing the synergy guides protocol design.",
      what_changes:
        "If super-additive synergy is confirmed for specific triples, the strategizer should prefer joint interventions over single-lever pulls. D4 interaction discovery would surface this empirically.",
      priority: "high",
      ranking_reason:
        "Directly affects whether the 'standard recovery' protocol should be sequenced (do exercise first, then add sleep, then MBSR) or simultaneous (start all three at once).",
      related_entity_ids: ["N10", "N11", "N13"],
    },
    {
      question:
        "What's the dose-response curve for cognitive training adherence below 80%?",
      why_it_matters:
        "Most published trials enforce ≥80% adherence as inclusion criteria. Real-world adherence is 50-70%. We need to know whether the effect drops linearly (still useful at 50%) or has a threshold (negligible below 70%).",
      what_changes:
        "If threshold, recommend gamification + accountability scaffolding from day 1. If linear, even imperfect adherence has value.",
      priority: "medium",
      ranking_reason:
        "Influences the adherence-support investment in the Cognitive Game app + whether to recommend training to patients with predicted poor adherence.",
      related_entity_ids: ["N14"],
    },
    {
      question:
        "Does CBT-I produce cognitive effects independent of sleep architecture changes?",
      why_it_matters:
        "If CBT-I's cognitive effects are mediated entirely by sleep restoration, monitoring sleep architecture is sufficient. If there are sleep-independent effects (sleep-related cognition like consolidation strategies), CBT-I has additional value beyond what sleep wearables can predict.",
      what_changes:
        "Affects whether sleep wearables alone can predict CBT-I response, or whether direct cognitive monitoring is required.",
      priority: "medium",
      ranking_reason:
        "Practical question about whether self-tracking can substitute for clinical CBT-I assessment in routine care.",
      related_entity_ids: ["N11", "N52"],
    },
  ],
  domain_signature: {
    template_slug: "mind_body_cognition",
    seeded_at: "2026-04-26T00:00:00Z",
    primary_outcome_entity: "N60",
    central_pathway_entity: "N30",
    intervention_count: 6,
    instrument_count: 6,
    edge_count_with_effect_sizes: 91,
    notes:
      "Hand-baked synthesis_data from the CRCI 168-record meta-analysis. Provides full demo content for cognition-template spaces; real research+synthesize chain replaces this on async completion.",
  },
};

// ── Phase 7 — pre-baked named flights ─────────────────────────────
//
// Six causal pathways that are central to the cognition template's
// value story. Each carries a category (drives chip color +
// filter), an ordered chain of seed_ids referencing nodes in
// SEED_NODES, and (where the literature supports it) a 4-phase
// roadmap with transition criteria expressed in temporal terms.
//
// The materializer resolves step_seed_ids to entity UUIDs, computes
// score_breakdown from the underlying edges' Phase 3+5 columns, and
// inserts as flights rows with origin='template_seeded'.

const SEED_FLIGHTS: ResearchSeedFlight[] = [
  {
    seed_id: "flight_inflammation_cognition",
    name: "Inflammation → Cognition Cascade",
    description:
      "Peripheral inflammation (IL-6) activates microglia, driving central neuroinflammation that systematically impairs processing speed and working memory. The dominant pathway in chemo-induced cognitive impairment.",
    category: "inflammation",
    step_seed_ids: ["crci_n20", "crci_n30", "crci_n50"],
    phases: [
      {
        phase: 1,
        name: "Detection",
        duration_weeks: 2,
        entry_criteria:
          "Baseline IL-6, CRP, and processing speed assessment. Establish T0.",
        exit_criteria:
          "IL-6 trajectory + processing-speed baseline locked in for ≥1 week.",
        step_seed_ids: ["crci_n20"],
      },
      {
        phase: 2,
        name: "Stabilization",
        duration_weeks: 10,
        entry_criteria: "Anti-inflammatory protocol initiated.",
        exit_criteria:
          "IL-6 trending down ≥20% from baseline, sustained for 4 weeks.",
        step_seed_ids: ["crci_n20", "crci_n30"],
      },
      {
        phase: 3,
        name: "Recovery",
        duration_weeks: 14,
        entry_criteria: "Neuroinflammation markers normalizing.",
        exit_criteria:
          "Processing speed within 0.3 SD of pre-treatment baseline.",
        step_seed_ids: ["crci_n30", "crci_n50"],
      },
    ],
    expected_score_breakdown: {
      time_to_effect_days: 90,
      controllability: 0.7,
      risk_factor: 0.3,
    },
  },
  {
    seed_id: "flight_hpa_hippocampus",
    name: "HPA → Hippocampus Axis",
    description:
      "Chronic stress drives cortisol elevation, which over months produces glucocorticoid receptor desensitization (HPA dysregulation) and downstream hippocampal volume loss expressed as episodic memory impairment.",
    category: "stress_axis",
    step_seed_ids: ["crci_n13", "crci_n24", "crci_n32", "crci_n51"],
    phases: [
      {
        phase: 1,
        name: "Acute Stabilization",
        duration_weeks: 4,
        entry_criteria: "Stress-management intervention (MBSR/CBT) initiated.",
        exit_criteria:
          "Cortisol slope normalizing toward diurnal pattern over 4 consecutive weeks.",
        step_seed_ids: ["crci_n13", "crci_n24"],
      },
      {
        phase: 2,
        name: "Receptor Recovery",
        duration_weeks: 12,
        entry_criteria: "Cortisol slope within normal range.",
        exit_criteria:
          "HPA reactivity test within 1 SD of healthy reference range.",
        step_seed_ids: ["crci_n24", "crci_n32"],
      },
      {
        phase: 3,
        name: "Memory Consolidation",
        duration_weeks: 24,
        entry_criteria: "HPA reactivity normalized.",
        exit_criteria:
          "Episodic memory (Logical Memory or analogue) within 0.5 SD of expected age-matched performance.",
        step_seed_ids: ["crci_n32", "crci_n51"],
      },
    ],
    expected_score_breakdown: {
      time_to_effect_days: 280,
      controllability: 0.5,
      risk_factor: 0.4,
    },
  },
  {
    seed_id: "flight_sleep_cortisol_executive",
    name: "Sleep → Cortisol → Executive Function",
    description:
      "Sleep restoration normalizes cortisol diurnal rhythm; sustained normalization recovers HPA reactivity and downstream working-memory performance. The fastest-acting recovery axis.",
    category: "clearance",
    step_seed_ids: ["crci_n11", "crci_n24", "crci_n32", "crci_n52"],
    phases: [
      {
        phase: 1,
        name: "Sleep Hygiene",
        duration_weeks: 2,
        entry_criteria: "PSQI ≥5 or sleep efficiency <85%.",
        exit_criteria:
          "Sleep efficiency ≥85% sustained for 7 consecutive nights.",
        step_seed_ids: ["crci_n11"],
      },
      {
        phase: 2,
        name: "Cortisol Normalization",
        duration_weeks: 4,
        entry_criteria: "Sleep efficiency target met.",
        exit_criteria:
          "Morning/evening cortisol ratio within healthy reference range for 14 days.",
        step_seed_ids: ["crci_n11", "crci_n24"],
      },
      {
        phase: 3,
        name: "Working Memory Recovery",
        duration_weeks: 8,
        entry_criteria: "Cortisol slope normalized.",
        exit_criteria:
          "Digit span ≥0.5 SD above prior baseline; Stroop interference reduced.",
        step_seed_ids: ["crci_n24", "crci_n32", "crci_n52"],
      },
    ],
    expected_score_breakdown: {
      time_to_effect_days: 98,
      controllability: 0.85,
      risk_factor: 0.15,
    },
  },
  {
    seed_id: "flight_exercise_bdnf_plasticity",
    name: "Exercise → BDNF → Neuroplasticity",
    description:
      "Aerobic exercise elevates BDNF, which drives hippocampal neurogenesis and synaptic plasticity, ultimately improving processing speed. The flagship neuroprotective protocol.",
    category: "neuroplasticity",
    step_seed_ids: ["crci_n10", "crci_n23", "crci_n33", "crci_n50"],
    phases: [
      {
        phase: 1,
        name: "Foundation",
        duration_weeks: 4,
        entry_criteria:
          "Medical clearance + baseline VO₂ max assessment. Build to ≥150 min/week moderate aerobic.",
        exit_criteria:
          "150 min/week moderate aerobic activity sustained for 2 consecutive weeks.",
        step_seed_ids: ["crci_n10"],
      },
      {
        phase: 2,
        name: "Build",
        duration_weeks: 8,
        entry_criteria: "Activity baseline locked.",
        exit_criteria:
          "Serum BDNF ≥30% above baseline (or sustained activity-based proxy).",
        step_seed_ids: ["crci_n10", "crci_n23"],
      },
      {
        phase: 3,
        name: "Consolidation",
        duration_weeks: 14,
        entry_criteria: "BDNF target met.",
        exit_criteria:
          "Processing speed (TMT-A or analogue) ≥0.4 SD improvement over baseline.",
        step_seed_ids: ["crci_n23", "crci_n33", "crci_n50"],
      },
    ],
    expected_score_breakdown: {
      time_to_effect_days: 84,
      controllability: 0.9,
      risk_factor: 0.2,
    },
  },
  {
    seed_id: "flight_diet_inflammation_fatigue",
    name: "Diet → Inflammation → Fatigue",
    description:
      "Mediterranean / anti-inflammatory dietary pattern reduces baseline IL-6 + CRP, attenuating downstream neuroinflammation and the inflammation-driven fatigue that commonly compounds cognitive decline.",
    category: "nutritional",
    step_seed_ids: ["crci_n12", "crci_n20", "crci_n30", "crci_n40"],
    phases: [
      {
        phase: 1,
        name: "Dietary Pattern Adoption",
        duration_weeks: 4,
        entry_criteria: "Baseline dietary assessment + nutrient logging.",
        exit_criteria:
          "Mediterranean adherence score ≥7/10 sustained for 2 weeks.",
        step_seed_ids: ["crci_n12"],
      },
      {
        phase: 2,
        name: "Inflammatory Markers Down",
        duration_weeks: 8,
        entry_criteria: "Dietary adherence stable.",
        exit_criteria:
          "IL-6 ≥15% below baseline; CRP <3 mg/L sustained for 4 weeks.",
        step_seed_ids: ["crci_n12", "crci_n20", "crci_n30"],
      },
      {
        phase: 3,
        name: "Symptom Recovery",
        duration_weeks: 8,
        entry_criteria: "Inflammation markers normalized.",
        exit_criteria:
          "FACIT-Fatigue score improved ≥5 points over baseline.",
        step_seed_ids: ["crci_n30", "crci_n40"],
      },
    ],
    expected_score_breakdown: {
      time_to_effect_days: 84,
      controllability: 0.7,
      risk_factor: 0.2,
    },
  },
  {
    seed_id: "flight_cognitive_training_reserve",
    name: "Cognitive Training → Reserve",
    description:
      "Targeted cognitive training (deficit-specific, adaptive difficulty) drives BDNF elevation + network reorganization, building cognitive reserve that compensates for inflammation-driven processing-speed loss.",
    category: "neuroplasticity",
    step_seed_ids: ["crci_n14", "crci_n23", "crci_n33", "crci_n52"],
    phases: [
      {
        phase: 1,
        name: "Engagement",
        duration_weeks: 3,
        entry_criteria:
          "Cognitive baseline established; deficit-targeted training selected.",
        exit_criteria:
          "≥80% session adherence for 2 consecutive weeks; engagement index stable.",
        step_seed_ids: ["crci_n14"],
      },
      {
        phase: 2,
        name: "Plasticity Window",
        duration_weeks: 9,
        entry_criteria: "Adherence target met.",
        exit_criteria:
          "Within-task gains ≥1 SD above baseline; transfer to N-back +0.3 SD.",
        step_seed_ids: ["crci_n14", "crci_n23", "crci_n33"],
      },
      {
        phase: 3,
        name: "Reserve Building",
        duration_weeks: 12,
        entry_criteria: "Plasticity gains established.",
        exit_criteria:
          "Working memory composite ≥0.5 SD above baseline AND maintained 4 weeks post-cessation.",
        step_seed_ids: ["crci_n33", "crci_n52"],
      },
    ],
    expected_score_breakdown: {
      time_to_effect_days: 84,
      controllability: 0.85,
      risk_factor: 0.15,
    },
  },
];

// ── The template object ───────────────────────────────────────────

export const MIND_BODY_COGNITION_TEMPLATE: ResearchTemplate = {
  slug: "mind_body_cognition",
  title: "Cognitive Performance Optimization",
  tagline:
    "Working memory, attention, and executive function under sleep, stress, caffeine, and clinical conditions.",
  description:
    "A research-grade workspace built on a 63-node Bayesian causal graph spanning seven layers from molecular biomarkers (BDNF, IL-6, cortisol) through latent pathways (neuroinflammation, HPA dysregulation, neuroplasticity) to specific cognitive domains (working memory, processing speed, executive function) and the unified CRCI composite outcome. Edge effect sizes are pooled from 74 papers across 168 records, with heterogeneity (I²) and study counts attached so downstream Bayesian inference can weight evidence rigorously. Pre-populated with four contrasting subjects (Healthy Young Adult / Resident Post-Call at 3am / Chess Master in Flow / Post-Chemo Cognitive Recovery), six intervention kernels, and six standard cognitive instruments, all wired into the lab so you can drag, modulate, and simulate from the moment the canvas paints.",
  icon: "Brain",
  accent_color: "#7C3AED",
  accent_color_light: "#F3E8FF",
  domain_tags: [
    "cognition",
    "cognitive performance",
    "working memory",
    "attention",
    "executive function",
    "mind-body",
    "neuroscience",
    "CRCI",
    "chemobrain",
  ],
  source_citations: [
    "Yieu 2026 (CRCI Bayesian causal synthesis · 168 records · 74 papers)",
    "Cowan 2001 (working memory capacity K = 4 ± 1)",
    "Unsworth 2014 (latent-variable working memory analysis, n>4,000)",
    "Janelidze et al. 2018 (CRCI biomarker review)",
    "Lustberg 2024 (cognitive impairment in cancer survivors)",
    "Wefel et al. 2011 (chemobrain mechanisms)",
  ],
  default_space_name: "Cognitive Performance · {{date}}",
  default_description:
    "Mind-body cognitive performance research workspace. Pre-populated with the CRCI 63-node knowledge graph, 4 starter subjects, 6 interventions, 6 cognitive instruments, and edge-level effect sizes from 74 papers.",

  ontology_layers: LAYER_DEFS,
  // B1 — same axis filter as Cognitive Performance: drop `financial` +
  // `cultural` (not load-bearing for clinical / mind-body research),
  // keep the 6 frames that actually shape causal-mechanism reasoning
  // in this domain. Adaptive display_name still adapts per prompt.
  preferred_probability_space_axes: [
    "causal_scenarios",
    "evidence",
    "assumptions",
    "risk",
    "actors",
    "timeline",
  ],
  // B4 — same filter as Cognitive Performance: drop "game" +
  // "ml_personalization" which don't fit clinical research; keep the
  // 5 kinds that are load-bearing for mind-body / clinical work.
  preferred_mechanism_kinds: [
    "simulation",
    "prediction",
    "validation",
    "baseline_tracking",
    "deviation_capture",
  ],
  seed_nodes: SEED_NODES,
  seed_edges: SEED_EDGES,
  seed_subjects: SEED_SUBJECTS,
  seed_interventions: SEED_INTERVENTIONS,
  seed_instruments: SEED_INSTRUMENTS,
  // F3 / D14 — paired downstream applications (game ↔ measurement).
  seed_apps: SEED_APPS,
  // Phase 7 — pre-baked named flights (causal pathways with phase
  // structure + transition criteria). Materialized as flights rows
  // with origin='template_seeded'.
  seed_flights: SEED_FLIGHTS,
  // Phase C demo bake: pre-populated synthesis_data so all 6 side
  // panels (Convergence, Intelligence, Radar, Agents, Reflexive,
  // multi-layer view) render the moment a cognition-template space
  // loads. Real research+synthesize chain replaces this content on
  // async completion (~30-90s after creation).
  seed_synthesis_data: SEED_SYNTHESIS_DATA,
};

// ── Registry ──────────────────────────────────────────────────────
//
// Keep this registry as the single import point for the /explore
// gallery + materialization endpoints. Add new templates as additional
// entries below.

import { SLEEP_OPTIMIZATION_TEMPLATE } from "@/lib/templates/sleep-optimization/seed";
import { COGNITIVE_PERFORMANCE_TEMPLATE } from "@/lib/templates/cognitive-performance/seed";

export { SLEEP_OPTIMIZATION_TEMPLATE, COGNITIVE_PERFORMANCE_TEMPLATE };

export const RESEARCH_TEMPLATES: Record<string, ResearchTemplate> = {
  mind_body_cognition: MIND_BODY_COGNITION_TEMPLATE,
  sleep_optimization: SLEEP_OPTIMIZATION_TEMPLATE,
  cognitive_performance: COGNITIVE_PERFORMANCE_TEMPLATE,
};

export function getResearchTemplate(slug: string): ResearchTemplate | null {
  return RESEARCH_TEMPLATES[slug] ?? null;
}

export const RESEARCH_TEMPLATE_LIST: ResearchTemplate[] = Object.values(
  RESEARCH_TEMPLATES,
);
