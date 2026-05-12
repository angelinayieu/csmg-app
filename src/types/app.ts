// First-class App domain type.
//
// Upstream producer: src/lib/pipeline/app-generator.ts clusters
// StrategicRecommendation.micro_tactics[] + ranked_strategies[0].infrastructure_proposals[]
// into persistent App rows after strategy-refresh.
// Downstream consumers:
//   - Dashboard "Apps" column (Sprint 2)
//   - Per-app whiteboard route (Sprint 2) — leverages sub_space_id
//   - Agent write-back paths (Sprint 3): patch config/state, bump app_versions
//   - Whiteboard staleness triggers (Sprint 3): edits set stale_reason
//
// Stable identity: (space_id, source_infrastructure_proposal_id) — regen upserts
// so the same proposal across two strategy versions maps to the same App.

import type { Database, Json } from "./database.types";
import type { AppManifest } from "./app-manifest";
import type { CardSpec } from "./card-spec";
import type { VariableEntry } from "./preflight";
import type { VariableRole } from "./variable-proposals";

/**
 * App-flavored variable entry. Reuses the preflight VariableEntry shape
 * (entity_id, name, observability, rationale, etc.) but adds a `role`
 * discriminator because apps store variables as a flat array — there's
 * no bucket-by-role layer like preflight has.
 *
 * Producer: src/lib/pipeline/derive-app-variables.ts (W5.2) reads the
 * preflight buckets via partitionVariablesByRole, then flattens them
 * into role-tagged entries on apps.config.variables.
 *
 * Consumer: variable-contract-card.tsx (W5.4) groups by role for the
 * "Variable contract" panel on the App detail page; reasoning agents
 * read this in lieu of joining persisted artifacts.
 */
export interface AppVariableEntry extends VariableEntry {
  role: VariableRole;
}

export type AppType = "dashboard" | "workflow" | "tool" | "monitor" | "integration";
export type AppStatus = "proposed" | "approved" | "active" | "paused" | "retired";
export type AppComplexity = "low" | "medium" | "high";

/**
 * Reasons an App has been flagged as stale — what kind of upstream change
 * invalidated its current state. Consumed by Sprint 3's regen loop.
 */
export type AppStaleReason =
  | "kg_changed"          // entity/edge add/remove in the KG
  | "new_research"        // deep-research loop produced new evidence
  | "user_feedback"       // user annotated / flagged the app
  | "strategy_regen"      // upstream strategy changed
  | "whiteboard_edit"     // user edited the per-app whiteboard
  | "lab_regen";          // Phase 2 (Week 4): user picked a different
                          // lab_twin → execution_brief + variants are
                          // no longer aligned. Matches the DB CHECK
                          // value added in
                          // 20260717_apps_stale_reason_lab_regen.sql.

/** Row shape as stored in Postgres — mirrors database.types.ts `apps.Row`. */
export type AppRow = Database["public"]["Tables"]["apps"]["Row"];
export type AppInsert = Database["public"]["Tables"]["apps"]["Insert"];
export type AppUpdate = Database["public"]["Tables"]["apps"]["Update"];

/** Row shape for append-only change history. */
export type AppVersionRow = Database["public"]["Tables"]["app_versions"]["Row"];
export type AppVersionInsert = Database["public"]["Tables"]["app_versions"]["Insert"];
export type AppVersionChangeType = AppVersionRow["change_type"];

/**
 * Structured schema for `apps.config` JSONB.
 *
 * Keep this shape stable — `config` is what agents patch in Sprint 3, so
 * every field they may write needs a home here. Prefer adding optional fields
 * over overloading existing ones.
 */
export interface AppConfig {
  /** Short tagline rendered on the app card. 1 sentence. */
  tagline?: string;
  /** Primary "why does this exist" summary — 2–3 sentences. */
  rationale?: string;
  /** Which sub-objectives (goal titles or ids) this app is designed to move. */
  serves_objectives?: string[];
  /** Channels this app monitors/controls — entity-to-entity pairs. */
  channels?: Array<{ from: string; to: string; description?: string }>;
  /** Metric identifiers this app surfaces. Human-readable names, not just ids. */
  surfaced_metrics?: Array<{ name: string; target?: string; unit?: string }>;
  /** Agent-authored "what to look at first" hints. Populated in Sprint 3. */
  agent_hints?: Array<{ agent: string; hint: string; recorded_at: string }>;
  /** Free-form tags / facets for filtering on the dashboard. */
  tags?: string[];
  /** Visual theming for the app card (color accent, icon). */
  theme?: { accent?: string; icon?: string };
  /**
   * Declarative UI + behavior spec the <AppRenderer /> consumes.
   *
   * Agents patch this (not JSX) when Sprint 3's update loop fires — so
   * continuous updates are JSON diffs, not code regeneration. When absent,
   * the renderer falls back to emptyManifest().
   *
   * See src/types/app-manifest.ts for the shape.
   */
  manifest?: AppManifest;
  /**
   * Archetype-driven card spec. Produced at T7 by the CardGenerator
   * agent and consumed by <CardSpecRenderer /> wherever this app
   * appears (canvas drop, lab panel, dashboard widget). Replaces the
   * ad-hoc DistributionBand on the canvas card. When absent, surfaces
   * fall back to legacy card chrome.
   *
   * See src/types/card-spec.ts for the discriminated union.
   */
  card_spec?: CardSpec;
  /** ISO timestamp the card_spec was last (re)generated. Bumps when
   *  the strategizer's simulation output changes enough to invalidate
   *  the prior spec. */
  card_spec_generated_at?: string;
  /**
   * Reasoning provenance — backlinks from this app to upstream strategy
   * artifacts that justify its existence. Computed by app-generator from
   * the union of provenance fields on the tactics that cluster onto this
   * proposal. All arrays are optional + may be empty; the validator
   * doesn't reject apps without provenance, but UI surfaces (audit views,
   * "why this app?" tooltips) read these to explain coverage.
   */
  reasoning_provenance?: {
    axiom_ids_respected?: string[];
    axiom_ids_challenged?: string[];
    convergence_ids_addressed?: string[];
    coverage_gap_ids_closed?: string[];
    inversion_ids_tested?: string[];
    hidden_signal_refs?: string[];
  };
  /**
   * Sprint W5.1 — App variable contract. The IV/DV/control/mediator/
   * moderator set this app operates against, flattened from the preflight
   * role buckets (partitionVariablesByRole) at app-generator time and
   * re-derived on lab-pick / preflight-override change.
   *
   * Why on AppConfig (JSONB) and not a relational table:
   *   Variables are derived from preflight role buckets which are
   *   themselves recomputed per page load (no persisted role rows).
   *   Persisting derived state in a relational table would require a
   *   second source of truth that the cascade must keep in sync. JSONB
   *   keeps the contract co-located with the app — when the app is
   *   stale_reason='lab_regen', a single row update bumps both the
   *   contract AND the staleness flag.
   *
   * Population path:
   *   - W5.2 derive-app-variables.ts populates this from preflight
   *     buckets after generateAppsAndInterventions clusters the
   *     infrastructure proposals into Apps.
   *   - W5.2.5 lab-pick reflows the role priority (lab IV/DV beats
   *     LLM proposal but not user override) and re-derives.
   *
   * Optional + may be empty: legacy apps generated before W5.1 will
   * simply have no variables field; UI surfaces (W5.4) treat absence
   * as "contract not yet derived" rather than "no variables exist."
   */
  variables?: AppVariableEntry[];
  /**
   * Sprint W5.3 — Mediator light. The user-visible "this app sits on
   * mechanism X" signal that the variable-contract-card (W5.4) renders.
   *
   * Why this exists as a denormalized snapshot:
   *   apps.parent_mechanism_id is already the canonical pointer, but
   *   reading it requires a join against the mechanisms table on
   *   every render. Snapshotting name + kind into config keeps the
   *   card render fast and stable when the parent mechanism is later
   *   renamed (the app's contract snapshot stays consistent until the
   *   next strategy regen, which is what users expect for an
   *   approved app).
   *
   * Producer: app-generator's materializeApps populates this when
   * parent_mechanism_id resolves. Absent when parent_mechanism_id is
   * null (legacy apps; apps generated before Week 4's mechanism
   * substrate).
   */
  mediator_light?: {
    mechanism_id: string;
    mechanism_name: string;
    mechanism_kind: string;
  };
}

/**
 * Structured schema for `apps.state` JSONB.
 *
 * `state` holds *runtime* values — the app's current health, derived numbers,
 * latest agent output. Distinct from `config` which holds its *definition*.
 */
export interface AppState {
  /** Rolled-up headline value displayed on the card (e.g. "72% on-track"). */
  headline?: string;
  /** Composite 0–100 score, redundant with apps.health_score column but richer breakdown. */
  health_breakdown?: {
    coverage?: number;
    momentum?: number;
    risk?: number;
  };
  /** Wave B — mirrors apps.health_score scalar for fast UI reads without
   *  a second query. Populated by reconcileAppWithKG + recomputeAppHealth. */
  health_score?: number;
  /** Wave B — per-factor contribution + bonus breakdown for the score.
   *  Feeds tooltips / debugging; the scalar health_score is the source
   *  of truth for UI badges. */
  health_score_factors?: {
    coverage_contribution: number;
    momentum_contribution: number;
    inverse_risk_contribution: number;
    goal_bonus: number;
    delivery_bonus: number;
    surprise_penalty: number;
  };
  /** Wave B — 1-line human-readable "why this score" string. */
  health_score_rationale?: string;
  /** Most recent agent update envelope. */
  last_agent_update?: {
    agent: string;            // e.g. "reasoner" | "research_loop" | "critic"
    summary: string;          // 1-line change
    patched_fields: string[]; // which config/state paths were changed
    at: string;               // ISO timestamp
  };
  /** Recent notable signals the app surfaced to the user. */
  recent_signals?: Array<{
    kind: "alert" | "insight" | "opportunity" | "risk";
    message: string;
    at: string;
  }>;
  /**
   * Monte Carlo distribution of the outcome-deviation signal for this
   * app's first dominant entity. Computed post-upsert by
   * simulateEntityChain — surfaces as the p10/p50/p90 band on the
   * canvas app-card shape. `null`-equivalent: field omitted.
   */
  simulation_distribution?: {
    p10: number;
    p50: number;
    p90: number;
    mean?: number;
    stddev?: number;
    computed_at: string;
    /**
     * Per-conditional-edge gate verdicts produced by the heuristic
     * resolver during the same simulation pass. Surfaces in the app
     * detail page as a "Conditional gates in this chain" audit panel —
     * lets the user see which edges were treated as flaky and why,
     * instead of having that rigor disappear inside a numeric band.
     *
     * Always omitted (rather than `[]`) when the chain contained no
     * conditional edges, so legacy app rows stay shape-stable.
     */
    gate_decisions?: Array<{
      source_id: string;
      target_id: string;
      gate: number;
      source:
        | "always"
        | "usually"
        | "sometimes"
        | "rarely"
        | "never"
        | "conditional"
        | "confidence_fallback"
        | "default_neutral";
      certainty: number;
      condition_text: string | null;
    }>;
  };
}

/**
 * Domain-level App — what consumers (UI, agents) work with.
 * Extends the row with typed config/state and derived/joined fields.
 */
export interface App extends Omit<AppRow, "config" | "state"> {
  config: AppConfig;
  state: AppState;

  /** Joined: count of interventions currently assigned to this app. */
  intervention_count?: number;
  /** Joined: name of the sub-space acting as the per-app whiteboard. */
  sub_space_name?: string | null;
  /** Joined: name of the goal this app serves. */
  serves_goal_title?: string | null;
}

/**
 * Helper: safely cast the JSONB `config` column to `AppConfig`.
 * The DB column is typed as `Json` — we deliberately widen then narrow at the seam.
 */
export function asAppConfig(value: Json | null | undefined): AppConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AppConfig;
}

export function asAppState(value: Json | null | undefined): AppState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AppState;
}

/** Map a raw AppRow into the domain App, materializing config/state. */
export function hydrateApp(row: AppRow): App {
  return {
    ...row,
    config: asAppConfig(row.config),
    state: asAppState(row.state),
  };
}
