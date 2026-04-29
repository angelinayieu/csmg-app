// ── Research Template ─────────────────────────────────────────────
//
// A `ResearchTemplate` is a scientifically-rigorous variant of the
// existing `UseCaseTemplate`. It carries the richer fields a research
// workspace needs: layer ontology, effect-size-bearing edges,
// pre-attached evidence rows, starter subjects with conditions, and
// an intervention catalog.
//
// Why a separate type (rather than extending UseCaseTemplate)?
// Existing templates (journal, career_pivot, etc.) are consumer-
// facing and don't need any of this. Forcing them through a unified
// shape would either bloat them with empty fields or push the rigor
// fields into a JSONB grab-bag — both worse than having two types.
// The /explore page consumes ResearchTemplate; /use-cases keeps
// consuming UseCaseTemplate. They share nothing at the type level
// and that's fine.
//
// Materialization endpoint: src/app/api/explore/create/route.ts
// reads a ResearchTemplate and produces:
//   - 1 space row (with manual_authoring_enabled = true)
//   - N layer_ontology rows (one per ontology_layers entry)
//   - M entities rows (one per seed_node, layer_ontology_id resolved)
//   - K edges rows (one per seed_edge, strength from effect_size)
//   - K evidence_registries rows (one per seed_edge, attached to target)
//   - S subjects rows (one per seed_subject, conditions populated)
//   - S lab_scaffolds rows (status='scaffolded' so lab opens clean)
//   - I entities rows (intervention_kernel kind, one per seed_intervention)

import type {
  SubjectFocusKind,
  SubjectArtifactState,
} from "./subject";

// ── Layer ontology ────────────────────────────────────────────────

/** One layer in the template's ontology. Maps 1:1 to a layer_ontology
 *  row when materialized into a fresh space. */
export interface ResearchSeedLayer {
  /** 1-based ordering. Lower = more fundamental. */
  ordinal: number;
  /** Slug used by node→layer mapping below. Must be unique within
   *  the template. */
  slug: string;
  /** UI label. */
  label: string;
  /** Tooltip description. */
  description: string;
  /** Hex color for KGNodeShape rendering. */
  color: string;
  /** Free-text node kinds typical for this layer. Surfaced by the
   *  +Variable button's kind picker. */
  typical_node_kinds: string[];
}

// ── Seed nodes (entities) ─────────────────────────────────────────

/** Entity category from `entities.entity_category` enum. */
export type EntityCategory =
  | "concrete"
  | "abstract"
  | "process"
  | "relational"
  | "epistemic";

export type EntityImportance =
  | "fundamental"
  | "critical"
  | "important"
  | "moderate";

/** One seed entity. The materializer resolves layer_slug → layer_ontology_id
 *  at insert time. */
export interface ResearchSeedNode {
  /** Stable id within the template. Used by edges to reference this
   *  node; rewritten to a UUID at insert time. */
  seed_id: string;
  name: string;
  /** Optional short label for compact rendering. Stored on entities. */
  short_label?: string;
  description: string;
  entity_category: EntityCategory;
  /** Free-text entity_type (e.g. "biomarker", "behavior", "treatment"). */
  entity_type: string;
  /** Slug pointing at one of the template's layers. Resolved to
   *  layer_ontology_id at materialization. */
  layer_slug: string;
  importance: EntityImportance;
  /** When false, the node is latent (composite / pathway) — hidden
   *  from default rendering modes that filter for observables. */
  observable: boolean;
  /** Optional mechanistic note (e.g. "Functional/Structural"). Carried
   *  in entities.provenance for downstream display. */
  mechanism_note?: string;
}

// ── Seed edges (relationships with effect sizes) ──────────────────

/** Status reflecting evidence quality. Drives confidence scoring. */
export type EvidenceStatus = "confirmed" | "mixed" | "sparse";

export interface ResearchSeedEdge {
  /** Stable id. Carried into entities.provenance for traceability. */
  seed_id: string;
  /** Source / target seed_id pointing at ResearchSeedNode entries. */
  source_seed_id: string;
  target_seed_id: string;
  /** Free-text relationship label (e.g. "increases", "reduces",
   *  "modulates"). Maps to edges.relationship_type. */
  relationship_type: string;
  /** Free-text dimension (e.g. "causal_mechanism", "moderation"). */
  dimension: string;
  /** Standardized effect-size coefficient (β / Cohen's d / SMD).
   *  Sign drives polarity. Magnitude drives strength. */
  effect_size: number;
  /** Reported standard error. */
  standard_error: number;
  /** Number of studies pooled. */
  num_studies: number;
  /** Heterogeneity I². Optional — null when k < 2. */
  heterogeneity_i2?: number;
  status: EvidenceStatus;
  /** Effect metric name. Defaults to "beta" but can be overridden
   *  for templates that pool standardized mean differences,
   *  log-odds-ratios, etc. */
  effect_metric?: string;
}

// ── Seed subjects ─────────────────────────────────────────────────

/** A starter subject card materialized onto the canvas. */
export interface ResearchSeedSubject {
  /** Stable id. Used to build a deterministic source_ref. */
  seed_id: string;
  name: string;
  description: string;
  focus_kind: SubjectFocusKind;
  focus_label: string;
  artifact_state?: SubjectArtifactState;
  /** Initial slider values for this subject's condition modulators.
   *  Keys must match modulator vocabulary from
   *  src/lib/subjects/modulators.ts (sleep_h, stress_0_10, etc.). */
  conditions: Record<string, number>;
  /** Hint for the lab proposal — which lab features are default-on
   *  for this subject. */
  default_lab_features?: Array<
    "monte_carlo" | "what_if" | "ab_compare" | "deepen_kg"
  >;
}

// ── Seed interventions ────────────────────────────────────────────

/** An intervention_kernel-kind entity. Pre-populates the lab's reagent
 *  bay so users can drag interventions into composition slots without
 *  hand-creating them. */
export interface ResearchSeedIntervention {
  seed_id: string;
  name: string;
  short_label: string;
  description: string;
  /** Recommended dose / intensity (e.g. "150 min/wk", "8-week protocol"). */
  recommended_dose: string;
  /** Mechanism summary (e.g. "Anti-inflammatory", "Sleep→HPA cascade"). */
  mechanism: string;
  /** Layer slug — typically the behavioral layer. */
  layer_slug: string;
  /** Pooled effect-on-primary-outcome (Cohen's d). Surfaces in the
   *  intervention list ranking. */
  effect_size: number;
  /** 95% CI on effect_size. */
  ci_lower: number;
  ci_upper: number;
  /** Stable color used by the intervention chip in the lab list. */
  color: string;
}

// ── Seed instruments (measurement tools) ──────────────────────────

/** A measurement instrument entity. Surfaces in the lab's task picker. */
// ── Seed app — paired downstream applications (F3 / D14) ─────────────
//
// A template can ship with PAIRED downstream applications that the
// twin (subject) feeds into. Cognition template ships with two:
//
//   • "Cognitive Game Development" (application_type='game')
//   • "Cognitive Measurement"      (application_type='measurement')
//
// Each is bidirectionally linked via `complementary_seed_ids` — the
// materializer resolves seed_ids to real UUIDs after both apps are
// inserted, then populates `apps.complementary_app_ids[]` on each.
//
// See supabase/migrations/20260618_apps_application_pairing.sql.
export interface ResearchSeedApp {
  /** Stable seed id (e.g. "app_cognitive_game") so other seeds can
   *  reference this one before DB UUIDs exist. */
  seed_id: string;
  name: string;
  description: string;
  /** UI shell type — matches existing `apps.app_type` enum. */
  app_type: "dashboard" | "workflow" | "tool" | "monitor" | "integration";
  /** Domain intent — matches `apps.application_type` enum from the
   *  20260618 migration. Drives canvas tether color + lab affordances. */
  application_type:
    | "game"
    | "measurement"
    | "intervention"
    | "analysis"
    | "educational"
    | "clinical"
    | "other";
  /** seed_ids of OTHER apps in the same template this one is paired
   *  with. Materializer resolves to UUIDs. */
  complementary_seed_ids: string[];
  /** Optional: which template-seeded entities this app primarily acts
   *  on (becomes `apps.dominant_entity_codes[]`). */
  dominant_entity_codes?: string[];
  /** Optional: tagline shown in the app card. */
  tagline?: string;
  /** Optional rationale for why this app exists in the template (shown
   *  in lab proposal wizard). */
  rationale?: string;
}

export interface ResearchSeedInstrument {
  seed_id: string;
  name: string;
  short_label: string;
  description: string;
  /** Domain it measures (e.g. "working_memory", "sleep_quality"). */
  measures: string;
  /** Layer slug — typically the cognitive / outcome layer. */
  layer_slug: string;
  /** Display modality tag — VER (verbal) / VIS (visuospatial) / etc.
   *  Mirrors the photo's task pills. */
  modality?: string;
}

// ── The template itself ───────────────────────────────────────────

export interface ResearchTemplate {
  /** Stable slug. Drives URL params + DB references. */
  slug: string;
  /** Human-readable title for the gallery card. */
  title: string;
  /** One-sentence pitch under the title. */
  tagline: string;
  /** 2-3 paragraph description for the card body. */
  description: string;
  /** Lucide icon name (rendered via dynamic lookup). */
  icon: string;
  /** Hex accent color for chips / borders. */
  accent_color: string;
  /** Tinted background for the icon block. */
  accent_color_light: string;
  /** Domain tags for matching (used by the planning agent later). */
  domain_tags: string[];
  /** Source citations — papers / authoritative reviews backing the
   *  template's content. Surfaced in the card's footer. */
  source_citations: string[];

  /** Default name for spaces created from this template.
   *  Supports {{date}} placeholder. */
  default_space_name: string;
  /** Default space description. */
  default_description: string;

  /** Layer ontology to materialize. */
  ontology_layers: ResearchSeedLayer[];

  /** All seed content. */
  seed_nodes: ResearchSeedNode[];
  seed_edges: ResearchSeedEdge[];
  seed_subjects: ResearchSeedSubject[];
  seed_interventions: ResearchSeedIntervention[];
  seed_instruments: ResearchSeedInstrument[];
  /** Optional — paired downstream applications this template proposes
   *  (F3 / D14). Cognition template ships with cognitive-game ↔
   *  cognitive-measurement pair. Older templates omit this. */
  seed_apps?: ResearchSeedApp[];

  /** Optional — pre-baked `synthesis_data` JSONB written DIRECTLY to
   *  `spaces.synthesis_data` on creation. Lets a template produce a
   *  fully-populated experience the instant the space loads, instead
   *  of waiting 30-90s for research+synthesize to run.
   *
   *  Real research+synthesize still chain via `/api/explore/create`'s
   *  after() block; their output overwrites the seed once available.
   *  Until then, the seeded synthesis_data unblocks all the side
   *  panels that gate on `space.synthesis_data IS NOT NULL`
   *  (Convergence, Intelligence, Radar, Agents, Reflexive, multi-
   *  layer view, etc.).
   *
   *  Shape is loose — anything `synthesis_data` can hold is valid here.
   *  Templates lift entity_id references using their own SEED_NODE
   *  display ids (C1, C5, etc.); explore/create resolves those to
   *  database UUIDs at materialization time. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seed_synthesis_data?: Record<string, any>;
}

// ── Materialization summary ───────────────────────────────────────

/** Returned by /api/explore/create after a template is materialized. */
export interface ExploreCreateResponse {
  space: {
    id: string;
    name: string;
    template_slug: string;
  };
  counts: {
    layers: number;
    entities: number;
    edges: number;
    evidence: number;
    subjects: number;
    interventions: number;
    instruments: number;
    lab_scaffolds: number;
  };
  /** First subject id — UI uses this to focus the canvas after redirect. */
  primary_subject_id: string | null;
  /** Per-step DB error messages when sub-inserts soft-failed. The
   *  space + counts still reflect what DID succeed; these warnings let
   *  the gallery UI surface "subjects didn't materialize because of X"
   *  instead of silently routing to a half-empty whiteboard. */
  warnings?: string[];
}
