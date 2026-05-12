// AppManifest factory — turns a strategy InfrastructureProposal into a
// declarative AppManifest the <AppRenderer /> can render.
//
// Called by src/lib/pipeline/app-generator.ts. Per-app manifests are the
// Sprint 0 integration seam: instead of hardcoding per-app React, the
// generator emits a manifest, and Sprint 3's agent write-back loop patches
// the same manifest incrementally (apply_agent_patch action).
//
// Priority order:
//   1. Use-case app_seeds prior (future: matched by name/type from
//      UseCaseTemplate.app_seeds — wired in Seam 2).
//   2. Type-based default (this file's pickDefault*Widgets).
//   3. Fallback: emptyManifest() when we genuinely have nothing.

import type {
  AppManifest,
  AppLayoutKind,
  WidgetInstance,
  ActionBinding,
  DataBinding,
  WidgetCapability,
} from "@/types/app-manifest";
import { APP_MANIFEST_SCHEMA_VERSION } from "@/types/app-manifest";
import type {
  InfrastructureProposal,
  StrategicRecommendation,
  MicroTactic,
  MechanismHint,
} from "@/types/strategy";
import type { AppType } from "@/types/app";
import { listWidgetsByCapability } from "@/lib/apps/widget-registry";

// ── Public entry point ────────────────────────────────────────────────

export interface BuildManifestInput {
  proposal: InfrastructureProposal | null;    // null → fallback umbrella app
  appType: AppType;
  appName: string;
  recommendation: StrategicRecommendation;
  /** Micro tactics that were clustered onto THIS app. */
  tacticsForApp: MicroTactic[];
  /** Optional seed manifest from a UseCaseTemplate (Seam 2). */
  seedManifest?: AppManifest | null;
  /** Strategy version for provenance. */
  strategyVersion: number | null;
}

export function buildDefaultManifest(input: BuildManifestInput): AppManifest {
  // Prefer a use-case seed when provided — but still stamp fresh provenance
  // so it's clear which strategy run produced the final manifest.
  if (input.seedManifest) {
    return {
      ...input.seedManifest,
      provenance: provenance(input),
    };
  }

  const layoutKind = mapAppTypeToLayout(input.appType);
  const actions = defaultActions();
  const defaultWidgets = pickWidgets(layoutKind, input);

  // Item 3: mechanism-hint injection.
  // If the proposal declared mechanism_hints (Item 1 schema), look up
  // widgets that advertise matching capabilities in the registry and
  // append them. This is the only path strategies currently have to
  // reach the Item 4 lab widgets without an agent explicitly authoring
  // the manifest. Falls through silently when hints are absent.
  const hintWidgets = widgetsForMechanismHints(
    input.proposal?.mechanism_hints,
    defaultWidgets,
  );

  return {
    schema_version: APP_MANIFEST_SCHEMA_VERSION,
    version: 1,
    layout: {
      kind: layoutKind,
      columns: layoutKind === "monitor" ? 2 : 3,
      density: "cozy",
    },
    widgets: [...defaultWidgets, ...hintWidgets],
    actions,
    refresh: defaultRefreshSpec(layoutKind),
    provenance: provenance(input),
  };
}

// ── Mechanism-hint → widget injection ──────────────────────────────────
//
// Translates an InfrastructureProposal's mechanism_hints into WidgetInstance
// entries by querying the registry for widgets whose contract declares
// matching capabilities. Key properties:
//   - Deduped against the default widget set (by widget type) so we don't
//     inject e.g. a second progress_tracker just because the proposal
//     declared baseline_tracking and the default dashboard already has one.
//   - Deduped against itself so a proposal with both "prediction" and
//     "validation" doesn't insert validation_lab twice (validation_lab
//     advertises both capabilities).
//   - Each MechanismHint maps 1:1 to a WidgetCapability — the two unions
//     are intentionally parallel. Kept separate so widget authors can
//     advertise capabilities the strategy layer hasn't promoted to a
//     first-class hint yet (and vice versa).
//   - Slot is left undefined on injected widgets so AppRenderer appends
//     them at the end of the layout rather than fighting the hand-picked
//     default layout.

const HINT_TO_CAPABILITY: Record<MechanismHint, WidgetCapability> = {
  simulation: "simulation",
  prediction: "prediction",
  validation: "validation",
  baseline_tracking: "baseline_tracking",
  deviation_capture: "deviation_capture",
  game: "game",
  ml_personalization: "ml_personalization",
};

function widgetsForMechanismHints(
  hints: MechanismHint[] | undefined,
  existing: WidgetInstance[],
): WidgetInstance[] {
  if (!hints || hints.length === 0) return [];
  const existingTypes = new Set(existing.map((w) => w.type));
  const injected: WidgetInstance[] = [];
  const seenTypes = new Set<string>();
  let injectCounter = 0;

  for (const hint of hints) {
    const cap = HINT_TO_CAPABILITY[hint];
    if (!cap) continue;
    const candidates = listWidgetsByCapability(cap);
    for (const w of candidates) {
      const type = w.contract.type;
      // Skip duplicates — both against the default layout and within the
      // injection set (e.g. validation_lab matches both "validation" and
      // "prediction" capabilities).
      if (existingTypes.has(type) || seenTypes.has(type)) continue;
      seenTypes.add(type);
      injected.push({
        id: `w-hint-${hint}-${injectCounter++}`,
        type,
        // No slot — the renderer's fallback layout appends these after
        // all slotted widgets. Agents can re-slot via apply_agent_patch
        // once they have opinions.
      });
    }
  }

  return injected;
}

// ── Layout mapping ────────────────────────────────────────────────────

function mapAppTypeToLayout(t: AppType): AppLayoutKind {
  switch (t) {
    case "workflow":
      return "workflow";
    case "monitor":
      return "monitor";
    case "dashboard":
    case "tool":
    case "integration":
    default:
      return "dashboard";
  }
}

// ── Widget assembly per layout ────────────────────────────────────────

function pickWidgets(kind: AppLayoutKind, input: BuildManifestInput): WidgetInstance[] {
  switch (kind) {
    case "workflow":
      return workflowWidgets(input);
    case "monitor":
      return monitorWidgets(input);
    case "dashboard":
    case "explorer":
    default:
      return dashboardWidgets(input);
  }
}

function dashboardWidgets(input: BuildManifestInput): WidgetInstance[] {
  const widgets: WidgetInstance[] = [];

  // Top banner: recent agent signals (populated in Sprint 3's loop).
  widgets.push({
    id: "w-signals",
    type: "recent_signals_banner",
    slot: { column: 1, span: 3, order: 0 },
    bindings: {
      signals: { source: "app_state_field", selector: { field: "recent_signals" } },
    },
  });

  // Hero metric: app's rolled-up headline.
  widgets.push({
    id: "w-hero",
    type: "hero_stat",
    slot: { column: 1, span: 2, order: 10 },
    config: { label: "Status" },
    bindings: {
      value: { source: "app_state_field", selector: { field: "headline" }, fallback: "Not yet measured" },
    },
    actions: { primary: "a-reconcile" },
  });

  // Health breakdown as three small metric cards.
  const breakdownFields = ["coverage", "momentum", "risk"] as const;
  breakdownFields.forEach((field, i) => {
    widgets.push({
      id: `w-metric-${field}`,
      type: "metric_card",
      slot: { column: (i % 3) + 1 as 1 | 2 | 3, span: 1, order: 20 + i },
      config: { label: capitalize(field), unit: "%" },
      bindings: {
        value: {
          source: "app_state_field",
          selector: { field: `health_breakdown.${field}` },
          fallback: null,
        },
      },
    });
  });

  // Intervention list — this app's assigned work.
  widgets.push({
    id: "w-interventions",
    type: "intervention_list",
    slot: { column: 1, span: 2, order: 40 },
    config: { title: "Interventions" },
    bindings: {
      interventions: {
        source: "interventions",
        selector: { app_id: "__self__" },
      },
    },
    actions: { complete: "a-complete-int" },
  });

  // Surfaced metrics sidebar.
  widgets.push({
    id: "w-metrics-list",
    type: "action_list",
    slot: { column: 3, span: 1, order: 40 },
    config: { title: "Tracked metrics", kind: "metrics" },
    bindings: {
      items: {
        source: "app_config_field",
        selector: { field: "surfaced_metrics" },
        fallback: [],
      },
    },
  });

  // Sprint W5.4 — Variable contract card. Reads
  // config.variables (W5.2) + config.mediator_light (W5.3) directly;
  // no bindings needed. Slot below the metrics sidebar so the user
  // sees "what this app measures" without scrolling past everything.
  widgets.push(variableContractWidget({ column: 3, order: 50 }));

  return widgets;
}

function workflowWidgets(input: BuildManifestInput): WidgetInstance[] {
  const widgets: WidgetInstance[] = [];

  widgets.push({
    id: "w-signals",
    type: "recent_signals_banner",
    slot: { column: 1, span: 3, order: 0 },
    bindings: {
      signals: { source: "app_state_field", selector: { field: "recent_signals" } },
    },
  });

  widgets.push({
    id: "w-purpose",
    type: "text_block",
    slot: { column: 1, span: 3, order: 10 },
    config: {
      title: input.appName,
      body: input.proposal?.description ?? input.recommendation.summary,
      tone: "default",
    },
  });

  widgets.push({
    id: "w-timeline",
    type: "timeline_view",
    slot: { column: 1, span: 3, order: 20 },
    config: { title: "Execution flow", group_by: "timeframe" },
    bindings: {
      interventions: { source: "interventions", selector: { app_id: "__self__" } },
    },
  });

  widgets.push({
    id: "w-interventions",
    type: "intervention_list",
    slot: { column: 1, span: 3, order: 30 },
    config: { title: "All steps" },
    bindings: {
      interventions: {
        source: "interventions",
        selector: { app_id: "__self__" },
      },
    },
    actions: { complete: "a-complete-int" },
  });

  // Sprint W5.4 — Variable contract card in workflow layout.
  widgets.push(variableContractWidget({ column: 1, span: 3, order: 40 }));

  return widgets;
}

function monitorWidgets(input: BuildManifestInput): WidgetInstance[] {
  const widgets: WidgetInstance[] = [];

  widgets.push({
    id: "w-signals",
    type: "recent_signals_banner",
    slot: { column: 1, span: 2, order: 0 },
    bindings: {
      signals: { source: "app_state_field", selector: { field: "recent_signals" } },
    },
  });

  widgets.push({
    id: "w-hero",
    type: "hero_stat",
    slot: { column: 1, span: 2, order: 10 },
    config: { label: "Status" },
    bindings: {
      value: { source: "app_state_field", selector: { field: "headline" }, fallback: "Not yet measured" },
    },
    actions: { primary: "a-reconcile" },
  });

  widgets.push({
    id: "w-leverage",
    type: "leverage_callout",
    slot: { column: 1, span: 1, order: 20 },
    config: { title: "Leverage in scope" },
    bindings: {
      leverage_points: { source: "synthesis_leverage" },
    },
  });

  widgets.push({
    id: "w-risk",
    type: "risk_callout",
    slot: { column: 2, span: 1, order: 20 },
    config: { title: "Risks in scope" },
    bindings: {
      risk_points: { source: "synthesis_risks" },
    },
  });

  widgets.push({
    id: "w-interventions",
    type: "intervention_list",
    slot: { column: 1, span: 2, order: 30 },
    config: { title: "Mitigations + plays" },
    bindings: {
      interventions: { source: "interventions", selector: { app_id: "__self__" } },
    },
    actions: { complete: "a-complete-int" },
  });

  // Sprint W5.4 — Variable contract card in monitor layout.
  widgets.push(variableContractWidget({ column: 1, span: 2, order: 40 }));

  return widgets;
}

// ── Sprint W5.4 helper — Variable Contract widget instance ────────────
//
// Returns a WidgetInstance for the variable_contract_card. Reads
// AppConfig.variables (W5.2) + AppConfig.mediator_light (W5.3) directly
// from context.app — no bindings. The actions map references the
// shared "a-tune-variable" ActionBinding (registered in
// defaultActions), so widgets can dispatch the tune_variable stub
// (W5.6) until the override drawer ships.
function variableContractWidget(
  slot: { column: 1 | 2 | 3; span?: 1 | 2 | 3; order: number },
): WidgetInstance {
  return {
    id: "w-variable-contract",
    type: "variable_contract_card",
    slot: { column: slot.column, span: slot.span ?? 1, order: slot.order },
    actions: { primary: "a-tune-variable" },
  };
}

// ── Actions (shared across layouts) ───────────────────────────────────

function defaultActions(): ActionBinding[] {
  return [
    {
      id: "a-reconcile",
      kind: "reconcile_app",
      label: "Reconcile",
    },
    {
      id: "a-request-refresh",
      kind: "request_agent_refresh",
      label: "Ask agent to re-run",
    },
    {
      id: "a-complete-int",
      kind: "complete_intervention",
      label: "Mark complete",
    },
    {
      id: "a-open-canvas",
      kind: "open_sub_whiteboard",
      label: "Open canvas",
    },
    // Sprint W5.6 — variable contract override entry point. Stub
    // handler today (logs the request); real implementation opens
    // the override drawer that writes environment_overrides.
    {
      id: "a-tune-variable",
      kind: "tune_variable",
      label: "Tune variable",
    },
  ];
}

// ── Refresh policy ────────────────────────────────────────────────────

function defaultRefreshSpec(kind: AppLayoutKind): AppManifest["refresh"] {
  // Monitors care about KG + research deltas; workflows primarily about
  // strategy regen (new interventions). Dashboards listen to everything.
  if (kind === "monitor") {
    return { on: ["kg_changed", "new_research", "user_feedback"] };
  }
  if (kind === "workflow") {
    return { on: ["strategy_regen", "user_feedback"] };
  }
  return {
    on: [
      "kg_changed",
      "new_research",
      "user_feedback",
      "strategy_regen",
      "whiteboard_edit",
    ],
  };
}

// ── Provenance stamp ──────────────────────────────────────────────────

function provenance(input: BuildManifestInput): AppManifest["provenance"] {
  return {
    produced_by: "pipeline:app-generator",
    produced_at: new Date().toISOString(),
    source_strategy_version: input.strategyVersion ?? undefined,
    source_proposal_id: input.proposal?.id,
    source_tactic_ids: input.tacticsForApp.map((t) => t.id),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Deliberately unused to quiet TS — we accept DataBinding for future
// widget-specific binding customization.
export type _Binding = DataBinding;
