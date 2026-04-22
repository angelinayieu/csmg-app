// ── App Manifest ─────────────────────────────────────────────────────────
//
// A declarative spec for a generated App's UI + behavior. Agents emit these
// (not React code); the <AppRenderer /> component renders them.
//
// Lives inside `AppConfig.manifest` (see src/types/app.ts). This means an
// agent update is just a JSON patch to config.manifest, not a code change —
// which is what makes Sprint 3's continuous-update loop tractable.
//
// Design principles:
//   1. Widgets are chosen from the registry by `type` key (string id), never
//      free-form. Unknown types are rendered as a visible placeholder, not a
//      crash — so a manifest with one bad widget still mostly works.
//   2. Data bindings are *pointers* (source + selector), not materialized
//      data. The renderer resolves them at render time against the current
//      space's data context. This keeps manifests small and re-usable.
//   3. Actions are declared by id, dispatched through the uniform action
//      endpoint (POST /api/apps/:id/action). Widgets never call endpoints
//      directly.
//   4. Every manifest carries a version + schema_version so we can evolve
//      the schema and migrate forward.

// ── Versioning ──────────────────────────────────────────────────────────

/**
 * Schema version of the manifest format itself. Bump when the AppManifest
 * shape changes in an incompatible way. The renderer should branch on this.
 */
export const APP_MANIFEST_SCHEMA_VERSION = 1 as const;
export type AppManifestSchemaVersion = typeof APP_MANIFEST_SCHEMA_VERSION;

// ── Layout ──────────────────────────────────────────────────────────────

/**
 * Top-level layout kind — controls the grid shell the renderer uses.
 * Keep this a small closed set; individual widgets express their own
 * internal layout.
 */
export type AppLayoutKind =
  | "dashboard"   // multi-column card grid (default)
  | "workflow"    // stepped vertical flow
  | "monitor"     // hero metric + supporting panels
  | "explorer";   // split view (list + detail)

export interface AppLayout {
  kind: AppLayoutKind;
  /** Optional: number of grid columns at the lg breakpoint (default 3). */
  columns?: 1 | 2 | 3 | 4;
  /** Optional: vertical density — cozy default. */
  density?: "cozy" | "compact" | "comfortable";
}

// ── Data sources + bindings ─────────────────────────────────────────────

/**
 * Logical data sources the renderer knows how to resolve. The renderer
 * owns these — widgets just name the source they want to read from.
 *
 * Add a new source here only after adding a resolver in the data-context.
 * Agents producing manifests MUST only reference sources in this union.
 */
export type DataSourceKind =
  | "entity"              // a single entity by id or code
  | "entities"            // filtered list of entities
  | "intervention"        // a single intervention by id
  | "interventions"       // filtered list of interventions for this app
  | "goal"                // a single improvement_goal by id
  | "goals"               // filtered list of goals in the space
  | "cycle"               // a single cycle by id
  | "synthesis_leverage"  // leverage points from synthesis_data
  | "synthesis_risks"     // risk points from synthesis_data
  | "synthesis_scenarios" // scenarios from synthesis_data
  | "action_plan"         // action items
  | "intelligence_signals" // intelligence_radar signals (external-world events)
  | "contributors"        // list of agents + collaborators (humans) on this space
  | "kg_top_insights"     // synthesized top-insights summary (quality score + top findings)
  | "agent_workflow"      // Experiment Twin: AgentWorkflow graph (nodes + edges)
  | "metric_series"       // a named metric's time series (AppState.health_breakdown etc.)
  | "app_state_field"     // a scalar field from this app's state (e.g. "headline")
  | "app_config_field"    // a scalar field from this app's config (e.g. "tagline")
  // ── Item 2/4 digital-twin sources ─────────────────────────────────
  // Added alongside the prediction_ledger + strategy_baselines tables so
  // Item 4 lab widgets can declare bindings without a second schema bump.
  | "twin_state"          // full TwinState for the current space (read-only)
  | "strategy_baseline"   // strategy_baselines row — kg/twin/metric/predicted snapshots at T0
  | "prediction_ledger"   // filtered prediction_ledger rows (status/app/agent selectors)
  | "deviation_ledger"    // resolved prediction_ledger rows tagged regime_shift or surprise
  | "simulation_result"   // latest scenario output for this app (simulator agents write these)
  | "agent_output"        // a named agent's most recent output (by agent id)
  // Tier 3.5: per-app sub-strategy spec. Widgets read this to discover
  // app-tuned defaults (prediction horizons, hypothesis bank, simulation
  // perturbation profiles, learning loop indicators) instead of inventing
  // generic ones. Selector.section narrows to a single spec section
  // (e.g. "prediction_spec", "validation_spec") when set.
  | "app_strategy"
  | "literal";            // inline constant, bound once at author time

/**
 * A binding is a pointer: "read from this source, with this selector,
 * and hand me the result." Widgets declare what shape of binding they
 * accept via their WidgetContract.
 */
export interface DataBinding {
  /** Which logical source to read from. */
  source: DataSourceKind;
  /**
   * Source-specific selector — entity id, intervention filter, metric name.
   * Kept loose (Record<string, unknown>) on purpose so each source can
   * define its own selector shape without ballooning this union.
   */
  selector?: Record<string, unknown>;
  /** For "literal" source: the inline value. */
  value?: unknown;
  /**
   * Optional: fallback if resolution yields null/undefined. Keeps widgets
   * from needing their own null-handling everywhere.
   */
  fallback?: unknown;
}

// ── Actions ─────────────────────────────────────────────────────────────

/**
 * Uniform action ids. Widgets emit one of these when the user interacts;
 * the action dispatcher routes them to handlers. Agents can extend by
 * registering new handlers without widgets knowing.
 *
 * Any action starting with "custom:" is routed to a dynamic handler table
 * and gives agents room to introduce app-specific mutations.
 */
export type ActionKind =
  | "log_observation"          // append a recent_signal to AppState
  | "complete_intervention"    // mark intervention status=completed
  | "accept_agent_suggestion"  // apply an agent's proposed config patch
  | "reject_agent_suggestion"  // discard an agent's proposed config patch
  | "apply_agent_patch"        // agent writes Partial<AppConfig> (incl. manifest)
  | "open_sub_whiteboard"      // navigate to this app's whiteboard
  | "reconcile_app"            // recompute state against current KG now
  | "request_agent_refresh"    // flag stale; agent loop picks it up later
  | "refresh_app"              // DEPRECATED alias for request_agent_refresh
  | "focus_entity"             // surface-level nav: open entity detail
  | "focus_intervention"       // surface-level nav: open intervention detail
  | "focus_goal"               // surface-level nav: open goal detail
  // ── Item 2/4 digital-twin actions ─────────────────────────────────
  | "log_prediction"           // predictor agent writes to prediction_ledger
  | "resolve_predictions"      // manually invoke the resolver for this app
  | "run_simulation"           // simulator agent runs a what-if scenario
  | "save_scenario"            // persist a simulation result for later comparison
  | "promote_scenario_to_strategy" // take a scenario's delta into strategy regen
  | "start_experiment"         // validator agent opens an A/B or hypothesis test
  | "end_experiment"           // validator agent concludes the test + writes result
  | "apply_validation_result"  // resolve a qualitative prediction from a validator
  | "record_deviation"         // manual deviation annotation on a resolved prediction
  | "escalate_to_research"     // deviation_signal_feed → research queue
  | `custom:${string}`;        // escape hatch — dynamic handlers

export interface ActionBinding {
  /** Stable id widgets reference locally (e.g. "primary", "secondary"). */
  id: string;
  /** Which action handler to invoke when triggered. */
  kind: ActionKind;
  /** Human-readable label for the button/menu item. */
  label: string;
  /** Optional: input payload shape. Widgets may augment at dispatch time. */
  payload?: Record<string, unknown>;
  /**
   * Optional: when should this action be available. Evaluated at render
   * against the resolved data — keeps widgets declarative.
   */
  guard?: {
    /** Binding whose resolved value must be truthy. */
    when_truthy?: DataBinding;
    /** Binding whose resolved value must equal this. */
    when_equals?: { binding: DataBinding; value: unknown };
  };
}

// ── Widgets ─────────────────────────────────────────────────────────────

/**
 * Stable widget type ids. Each maps to exactly one React component in the
 * widget registry. Keep this a string union so TS catches typos in agent
 * output that was validated by our tooling — but accept arbitrary strings
 * at runtime (unknown → placeholder) so a newer agent emitting a widget
 * this client doesn't know about degrades gracefully.
 *
 * To add a widget: (a) add it here, (b) register it in
 * src/components/apps/widgets/index.ts with a matching contract.
 */
export type WidgetType =
  | "metric_card"
  | "hero_stat"
  | "intervention_card"
  | "intervention_list"
  | "progress_tracker"
  | "entity_callout"
  | "action_list"
  | "timeline_view"
  | "scenario_comparator"
  | "leverage_callout"
  | "risk_callout"
  | "recent_signals_banner"    // surfaces AppState.recent_signals at top of app
  | "external_signal_banner"   // intelligence_radar signals — "what happened outside"
  | "kg_top_insights"          // synthesis quality + top leverage/risk/bottleneck summary
  | "contributors_strip"       // agents + human collaborators on this space
  | "agent_workflow_graph"     // Experiment Twin: agent orchestration DAG
  // ── Item 4 digital-twin lab widgets ───────────────────────────────
  // Full implementations land in Item 4. Item 3 registers stub renderers
  // tagged with the right capabilities so mechanism_hints can light them
  // up end-to-end; Item 4 then swaps the stubs for real components via
  // the registry's HMR-friendly re-register path.
  | "baseline_deviation_tracker" // predicted vs actual per metric, deviation tag on each row
  | "prediction_panel"           // open predictions + their horizons
  | "validation_lab"             // experiment / hypothesis tests against predictions
  | "simulation_lab"             // what-if runs against twin_state
  | "deviation_signal_feed"      // resolved surprises + escalate-to-research action
  | "text_block"        // always-available: markdown/plain text
  | "divider";          // always-available: layout separator

// ── Widget capability + category metadata ──────────────────────────────
//
// Capabilities are the handshake between a strategy's mechanism_hints
// (see InfrastructureProposal.mechanism_hints in src/types/strategy.ts)
// and the widget registry. The manifest builder calls
// listWidgetsByCapability("simulation") to discover what lab widgets are
// currently registered and injects them into manifests whose proposal
// declares "simulation" — so new mechanisms light up without schema
// migrations or builder edits.
//
// Categories are coarser — intended for UI grouping in a future widget
// picker. Not required for dispatch, but every registered widget should
// declare one so introspection tooling can enumerate cleanly.

export type WidgetCapability =
  | "simulation"         // runs what-if scenarios against twin_state
  | "prediction"         // reads/writes prediction_ledger
  | "validation"         // runs or resolves experiments / hypothesis tests
  | "baseline_tracking"  // reads strategy_baselines to show T0 state
  | "deviation_capture"  // surfaces surprises from resolved predictions
  | "game"               // behavioral / engagement mechanics
  | "ml_personalization"; // consumes ledger data through a personalized model

export type WidgetCategory =
  | "core"          // default dashboard/monitor staples
  | "lab"           // Item 4 twin labs (simulation, validation, etc.)
  | "ml"            // personalized-model surfaces
  | "game"          // engagement / behavioral mechanics
  | "integration"   // external-system bridges
  | "layout";       // text_block, divider — pure structural

export interface WidgetInstance<Config = Record<string, unknown>> {
  /** Stable id within this manifest — used for layout and action routing. */
  id: string;
  /** Registry key — picks the React component. */
  type: WidgetType | string;
  /**
   * Optional display slot within the layout (column index, row hint).
   * The AppRenderer packs these into the layout grid.
   */
  slot?: {
    column?: 1 | 2 | 3 | 4;
    /** Grid-span in columns. Defaults to 1. */
    span?: 1 | 2 | 3 | 4;
    /** Ordering hint within a column (lower = higher up). */
    order?: number;
  };
  /**
   * Widget-specific configuration. Each widget's contract defines the
   * expected shape; validator checks it against the registry at manifest-
   * load time.
   */
  config?: Config;
  /**
   * Named data bindings this widget consumes. The keys are widget-defined
   * (documented in its contract); values are DataBindings the renderer
   * resolves at render time.
   */
  bindings?: Record<string, DataBinding>;
  /**
   * Named action ids this widget may trigger. Must exist in manifest.actions.
   * Again, keys are widget-defined (e.g. "primary", "secondary").
   */
  actions?: Record<string, string>;
  /**
   * Visual hint: should this widget be shown expanded by default.
   * Widgets that don't support expand/collapse ignore this.
   */
  initial_expanded?: boolean;
}

// ── Refresh policy ──────────────────────────────────────────────────────

/**
 * Declares when an agent should re-run to update this app. Sprint 3 will
 * consume this — Sprint 0 just stores it so manifests can carry the intent.
 */
export interface RefreshSpec {
  /** Trigger types that should mark this app stale. */
  on: Array<
    | "kg_changed"
    | "new_research"
    | "user_feedback"
    | "strategy_regen"
    | "whiteboard_edit"
    | "scheduled"
  >;
  /** For "scheduled": cadence. */
  cadence?: "hourly" | "daily" | "weekly";
  /**
   * Which agents should react to a stale flag. Human-readable identifiers
   * matching agent registry keys.
   */
  agents?: string[];
}

// ── Manifest itself ─────────────────────────────────────────────────────

export interface AppManifest {
  /** Schema version of the manifest format. */
  schema_version: AppManifestSchemaVersion;
  /** Semver-ish version of this specific manifest content (agent-bumped). */
  version: number;
  /** Layout shell. */
  layout: AppLayout;
  /** Widgets to render, in arbitrary order — slot hints handle placement. */
  widgets: WidgetInstance[];
  /** Named actions widgets can reference by id. */
  actions?: ActionBinding[];
  /** When the app should auto-refresh. */
  refresh?: RefreshSpec;
  /** Provenance: which agent/stage produced this manifest. */
  provenance?: {
    produced_by: string;       // e.g. "pipeline:app-generator" | "agent:reasoner"
    produced_at: string;       // ISO timestamp
    source_strategy_version?: number;
    source_tactic_ids?: string[];
    source_proposal_id?: string;
  };
}

// ── Widget contract (for the registry) ─────────────────────────────────

/**
 * A contract tells the validator what a given widget type expects.
 * Registered alongside the component in the widget registry.
 *
 * Runtime validation is intentionally lightweight — we check required
 * bindings are present and action references resolve, but widget config
 * shape is trusted (TS types on the component enforce it at author time).
 */
export interface WidgetContract {
  /** The widget type this contract describes. */
  type: string;
  /** Short human description — used in registry introspection. */
  description: string;
  /**
   * Coarse grouping — used by registry introspection tools. Defaults to
   * "core" for contracts that don't declare one, preserving behavior for
   * pre-Item-3 registrations.
   */
  category?: WidgetCategory;
  /**
   * Which mechanism hints this widget fulfills. The manifest builder
   * calls listWidgetsByCapability() to discover lab widgets for a
   * proposal's declared mechanism_hints, so this field is how a widget
   * opts into automatic injection. Empty array / absent means the widget
   * is only placed explicitly (default dashboards / agent patches).
   */
  capabilities?: WidgetCapability[];
  /** Named bindings this widget requires. Missing → validation error. */
  required_bindings?: string[];
  /** Named bindings this widget may optionally consume. */
  optional_bindings?: string[];
  /** Named action refs this widget requires. Missing → validation error. */
  required_actions?: string[];
  /** Optional: hint about which DataSourceKind(s) each binding accepts. */
  accepted_sources?: Record<string, DataSourceKind[]>;
}

// ── Validation result ──────────────────────────────────────────────────

export type ManifestIssueLevel = "error" | "warning";

export interface ManifestIssue {
  level: ManifestIssueLevel;
  /** Dotted path into the manifest — e.g. "widgets[2].bindings.primary". */
  path: string;
  message: string;
  /** Optional hint for the agent/author to fix. */
  hint?: string;
}

export interface ManifestValidationResult {
  ok: boolean;
  issues: ManifestIssue[];
  /**
   * A sanitized manifest with unknown widget types swapped for placeholder
   * and broken action refs removed. Safe to render. Null if the manifest
   * is unrecoverable (missing schema_version, missing widgets array, etc.).
   */
  sanitized: AppManifest | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * A minimal empty manifest — useful as a fallback when an app has no
 * manifest yet, so the renderer can still paint *something* rather than
 * crashing or rendering nothing.
 */
export function emptyManifest(): AppManifest {
  return {
    schema_version: APP_MANIFEST_SCHEMA_VERSION,
    version: 0,
    layout: { kind: "dashboard", columns: 3, density: "cozy" },
    widgets: [
      {
        id: "placeholder-empty",
        type: "text_block",
        config: {
          title: "This app has no manifest yet",
          body: "An agent will populate this app's layout the next time the pipeline runs.",
          tone: "muted",
        },
      },
    ],
  };
}
