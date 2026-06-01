// ── TechSpec — SpecForge-native technical specification ──────────────
//
// The structured spec produced at the END of a SpecForge run (from the
// chain's accumulated synthesis), via Opus + the UI agent skill. Distinct
// from AgentBuildSpec (which is compiled from cross-room mechanism specs):
// this one is engineering-grade reasoning over a SINGLE forged idea —
// architecture + data model + build phases (the SWE/PM lenses) plus a
// first-class `ui_plan` (the UI lens, reusing the design_intent vocabulary).
// Pure types — shared by the server composer and the client panel/card.

/** Design-language axes — reused verbatim from MechanismDesignIntent
 *  (enrich-mechanism-spec.ts) so the UI plan speaks the app's one design
 *  vocabulary rather than inventing a parallel one. */
export interface TechSpecDesignLanguage {
  glass_tier: "plate" | "card" | "float" | "hero";
  accent_intent: "signal" | "warning" | "growth" | "insight" | "neutral";
  density: "airy" | "comfortable" | "dense";
  motion_intent: "still" | "breathing" | "reveal" | "responsive";
  hero_pattern:
    | "metric"
    | "flow"
    | "cycle"
    | "before_after"
    | "evidence"
    | "decision";
}

export interface TechSpecScreen {
  name: string;
  purpose: string;
  key_components: string[];
  /** Interface states beyond the happy path (empty/loading/error/success). */
  states: string[];
}

export interface TechSpecUiPlan {
  design_language: TechSpecDesignLanguage;
  screens: TechSpecScreen[];
  component_inventory: string[];
  interaction_notes: string[];
  /** MoSCoW reduction trace ("Kept X — because Y" / "Cut Z — because W"). */
  reduction_log: string[];
  /** Cues lifted from analyzed inspiration images (empty when none pasted). */
  inspiration_cues: string[];
}

export interface TechSpecComponent {
  name: string;
  responsibility: string;
  tech: string;
}

export interface TechSpecDataEntity {
  entity: string;
  fields: string[];
  notes: string;
}

export interface TechSpecFeature {
  name: string;
  description: string;
  components: string[];
  acceptance_criteria: string[];
}

export interface TechSpecBuildPhase {
  phase: string;
  goal: string;
  deliverables: string[];
  /** Names of phases that must land first (dependency order). */
  depends_on: string[];
  acceptance_criteria: string[];
}

export interface TechSpecArchitecture {
  summary: string;
  components: TechSpecComponent[];
  layers: string[];
}

export interface TechSpec {
  title: string;
  overview: string;
  problem: string;
  target_users: string[];
  goals: string[];
  success_metrics: string[];
  non_goals: string[];
  architecture: TechSpecArchitecture;
  data_model: TechSpecDataEntity[];
  integrations: string[];
  features: TechSpecFeature[];
  build_phases: TechSpecBuildPhase[];
  risks: string[];
  open_questions: string[];
  ui_plan: TechSpecUiPlan;
}
