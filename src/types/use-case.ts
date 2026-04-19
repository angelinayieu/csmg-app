// ── Use Case templates ──
//
// A UseCaseTemplate is a vertical — a pre-configured entry point into the
// knowledge-graph pipeline. Templates seed a new space with appropriate
// starter entities, customize the decomposition prompt, provide a question
// library, set a synthesis frame, and route the user to a template-specific
// surface (journal form, whiteboard, upload, etc.).
//
// Templates are defined in code (src/lib/use-cases/templates/) rather than
// the database so they ship with releases and can be versioned.

import type { ContextType } from "./analysis";
import type { AppManifest } from "./app-manifest";

// ── Template identifier + metadata ──

export type UseCaseId =
  | "journal_self_discovery"    // the exemplar — daily journaling for self-understanding
  | "startup_strategy"           // business strategy / founding
  | "research_project"           // research planning
  | "career_pivot"               // career transition
  | "reading_synthesis"          // notes from reading
  | "relationship_dynamics"      // understanding a relationship
  | "team_retro";                // team retrospectives

// ── Surface routing ──

export type UseCaseSurface =
  | "whiteboard_overview"    // default — routes to /whiteboard/overview
  | "whiteboard_playground"  // routes to /whiteboard/playground
  | "journal"                // routes to /journal
  | "reading_import"         // routes to /reading (upload-oriented)
  | "structured_form";       // structured multi-field form

// ── Seed entities ──
// Pre-populated starter entities that appear when a space is created from a
// template. They help the user understand what the template is about and
// give downstream extraction something to merge against.

export interface SeedEntity {
  // Temporary id — gets replaced with UUID on insert
  seed_id: string;
  name: string;
  description: string;
  entity_category: "concrete" | "abstract" | "process" | "relational" | "epistemic";
  entity_type: string;
  layer: "system" | "domain" | "thread" | null;
  importance: "fundamental" | "critical" | "important" | "moderate";
  // Visual affordance: hint that the user can expand / interact with this
  notes?: string;
}

export interface SeedEdge {
  source_seed_id: string;
  target_seed_id: string;
  relationship_type: string;
  dimension: string;
}

// ── Question library ──
// Categorized questions the surface can offer to the user. Different kinds of
// moments call for different kinds of questions.

export type QuestionKind =
  | "opener"          // prompts a fresh entry — "what stood out today?"
  | "deepener"        // goes deeper into something they just wrote
  | "tension_prober"  // surfaces a specific tension to explore
  | "pattern_probe"   // asks about a recurring theme
  | "values_check"    // checks stated values against recent behavior
  | "future_scope";   // scopes toward action / possibility

export interface TemplateQuestion {
  id: string;
  kind: QuestionKind;
  text: string;
  // Optional: context that makes this question ready to ask
  applicable_when?: {
    min_entries?: number;        // need at least N entries
    mentions_entity?: string[];  // only fire when user mentions these kinds of entities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  // Tags for filtering + ranking
  tags?: string[];
}

// ── Decomposition frame ──
// A bit of prompt text that gets prepended to the standard decomposition
// prompt to bias extraction toward the template's domain.

export interface DecompositionFrame {
  // Prefix added to system prompt — describes the lens
  system_prefix: string;
  // Categories that should be surfaced preferentially
  preferred_entity_categories: Array<"concrete" | "abstract" | "process" | "relational" | "epistemic">;
  // Specific entity_type values to look for (domain vocabulary)
  preferred_entity_types: string[];
}

// ── Synthesis frame ──

export interface SynthesisFrame {
  // What does "fulcrum system" mean for this template?
  fulcrum_definition: string;
  // What does a good outcome look like?
  outcome_criterion: string;
  // Any template-specific narrative flavor
  narrative_hint?: string;
}

// ── Template main shape ──

export interface UseCaseTemplate {
  id: UseCaseId;
  name: string;                    // "Journal for self-discovery"
  tagline: string;                 // one-sentence pitch
  description: string;             // 2-3 paragraphs

  // Visual
  icon: string;                    // lucide icon name
  accent_color: string;            // hex
  accent_color_light: string;      // hex — tinted background

  // Categorization for the gallery
  category: "personal" | "professional" | "research" | "strategic" | "relational";

  // Ties into existing space `context_type`
  context_type: ContextType;

  // What surface to route to after creation
  default_surface: UseCaseSurface;

  // Space setup
  default_space_name: string;      // template for new-space name; can use {{date}}
  default_description: string;

  // Seeds
  seed_entities: SeedEntity[];
  seed_edges: SeedEdge[];

  // Prompting / framing
  decomposition_frame: DecompositionFrame;
  synthesis_frame: SynthesisFrame;

  // Question library
  question_library: TemplateQuestion[];

  // Additional surfaces this template unlocks in the sidebar
  unlocked_surfaces?: UseCaseSurface[];

  // App seeds — post-synthesis priors.
  //
  // The template doesn't just seed the KG; it also declares the kinds of
  // Apps this vertical typically produces. app-generator.ts consumes these
  // as priors when materializing apps from the strategy output, so that
  // e.g. "startup_strategy" reliably produces a Fundraising Pipeline app
  // rather than reinventing the structure each run. Agents may still add,
  // omit, or rename seeded apps — these are starting points, not contracts.
  app_seeds?: AppSeed[];
}

/**
 * A seeded App — a prior manifest + metadata the pipeline can materialize
 * into an `apps` row when the template fires. Only the parts an author
 * can know *before* synthesis runs; things like dominant entity ids are
 * filled in by app-generator.ts after the KG exists.
 */
export interface AppSeed {
  /** Stable slug — lets regen align on a stable identity. */
  seed_id: string;
  /** Human-readable name for the app. */
  name: string;
  /** One-sentence description shown on the card. */
  tagline?: string;
  /** Which of the template's sub-objectives this app primarily serves. */
  serves_objective_hint?: string;
  /** App type classification — matches AppType in types/app.ts. */
  app_type: "dashboard" | "workflow" | "tool" | "monitor" | "integration";
  /** Starter manifest. Agents will refine + extend it post-synthesis. */
  manifest: AppManifest;
}

// ── Journal entry (template-specific data) ──

export interface JournalEntry {
  id: string;
  space_id: string;
  entry_date: string;              // ISO date (no time) — 1 entry per date typically
  text: string;
  word_count: number;

  // Extracted entity UUIDs that this entry touches (references)
  referenced_entity_ids: string[];

  // Extracted metadata about the entry itself
  emotions_mentioned: string[];    // short labels ["anxious", "hopeful"]
  values_surfaced: string[];       // ["autonomy", "belonging"]
  tensions_detected: string[];     // free-text tension descriptions
  flow_activities: string[];       // things they did that felt good
  drain_activities: string[];      // things that drained them

  // Optional LLM-generated reflection prompt for next time
  next_prompt?: string | null;

  created_at: string;
  updated_at: string;
}

// ── Gallery ranking helpers ──

export interface UseCaseGalleryItem {
  template: UseCaseTemplate;
  // For UI: has the user ever created a space from this template?
  has_been_used?: boolean;
  // Count of spaces from this template
  space_count?: number;
}
