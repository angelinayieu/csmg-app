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
  seed_nodes: SEED_NODES,
  seed_edges: SEED_EDGES,
  seed_subjects: SEED_SUBJECTS,
  seed_interventions: SEED_INTERVENTIONS,
  seed_instruments: SEED_INSTRUMENTS,
  // F3 / D14 — paired downstream applications (game ↔ measurement).
  seed_apps: SEED_APPS,
};

// ── Registry ──────────────────────────────────────────────────────

export const RESEARCH_TEMPLATES: Record<string, ResearchTemplate> = {
  mind_body_cognition: MIND_BODY_COGNITION_TEMPLATE,
};

export function getResearchTemplate(slug: string): ResearchTemplate | null {
  return RESEARCH_TEMPLATES[slug] ?? null;
}

export const RESEARCH_TEMPLATE_LIST: ResearchTemplate[] = Object.values(
  RESEARCH_TEMPLATES,
);
