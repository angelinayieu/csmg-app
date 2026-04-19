// ── Example manifests ──────────────────────────────────────────────────
//
// Used by (a) the smoke-test harness, (b) Sprint 2's dashboard preview,
// (c) as priors for agents producing their first manifests. Keep these
// small and realistic — they're also documentation by example.

import {
  APP_MANIFEST_SCHEMA_VERSION,
  type AppManifest,
} from "@/types/app-manifest";

// A compact "monitor" app — hero headline + health breakdown + recent
// signals + one primary action. Validates + renders against the stock
// resolver set (app_state/app_config/literal).
export const EXAMPLE_MONITOR_MANIFEST: AppManifest = {
  schema_version: APP_MANIFEST_SCHEMA_VERSION,
  version: 1,
  layout: { kind: "monitor", columns: 3, density: "cozy" },
  provenance: {
    produced_by: "example:smoke-test",
    produced_at: new Date("2026-04-17T00:00:00Z").toISOString(),
  },
  actions: [
    {
      id: "log_note",
      kind: "log_observation",
      label: "Log observation",
    },
    {
      id: "open_whiteboard",
      kind: "open_sub_whiteboard",
      label: "Open whiteboard",
    },
    {
      id: "refresh",
      kind: "refresh_app",
      label: "Refresh",
    },
  ],
  widgets: [
    // Row 1: Hero + ring
    {
      id: "hero",
      type: "hero_stat",
      slot: { column: 1, span: 3, order: 0 },
      config: {
        subhead: "Current headline",
        headline: "How this app is doing right now",
        accent: "#3b82f6",
      },
      bindings: {
        value: {
          source: "app_state_field",
          selector: { field: "headline" },
          fallback: "—",
        },
      },
      actions: { primary: "refresh" },
    },
    // Row 2: Three metric cards (health breakdown)
    {
      id: "m-coverage",
      type: "metric_card",
      slot: { column: 1, order: 1 },
      config: { label: "Coverage", accent: "#10b981" },
      bindings: {
        value: {
          source: "app_state_field",
          selector: { field: "health_breakdown.coverage" },
          fallback: 0,
        },
      },
    },
    {
      id: "m-momentum",
      type: "metric_card",
      slot: { column: 2, order: 1 },
      config: { label: "Momentum", accent: "#6366f1" },
      bindings: {
        value: {
          source: "app_state_field",
          selector: { field: "health_breakdown.momentum" },
          fallback: 0,
        },
      },
    },
    {
      id: "m-risk",
      type: "metric_card",
      slot: { column: 3, order: 1 },
      config: { label: "Risk", accent: "#ef4444" },
      bindings: {
        value: {
          source: "app_state_field",
          selector: { field: "health_breakdown.risk" },
          fallback: 0,
        },
      },
    },
    // Row 3: Divider
    {
      id: "d-1",
      type: "divider",
      slot: { column: 1, span: 3, order: 2 },
      config: { caption: "What happened lately" },
    },
    // Row 4: Timeline of recent signals
    {
      id: "timeline",
      type: "timeline_view",
      slot: { column: 1, span: 2, order: 3 },
      config: { label: "Recent signals", accent: "#6366f1" },
      bindings: {
        items: {
          source: "app_state_field",
          selector: { field: "recent_signals" },
          fallback: [],
        },
      },
    },
    // Row 4 right: Text block with tagline
    {
      id: "tagline",
      type: "text_block",
      slot: { column: 3, order: 3 },
      config: {
        title: "About this app",
        tone: "muted",
      },
    },
  ],
  refresh: {
    on: ["kg_changed", "new_research", "user_feedback"],
    agents: ["reasoner", "research_loop"],
  },
};

// An "explorer" variant for when the app clusters a set of interventions.
// Showcases intervention_list + action_list + scenario_comparator.
export const EXAMPLE_WORKFLOW_MANIFEST: AppManifest = {
  schema_version: APP_MANIFEST_SCHEMA_VERSION,
  version: 1,
  layout: { kind: "dashboard", columns: 3, density: "cozy" },
  provenance: {
    produced_by: "example:smoke-test",
    produced_at: new Date("2026-04-17T00:00:00Z").toISOString(),
  },
  actions: [
    {
      id: "complete_iv",
      kind: "complete_intervention",
      label: "Mark complete",
    },
    {
      id: "focus_iv",
      kind: "focus_intervention",
      label: "Open intervention",
    },
  ],
  widgets: [
    {
      id: "interventions",
      type: "intervention_list",
      slot: { column: 1, span: 2, order: 0 },
      config: { label: "Interventions in this app", limit: 6 },
      bindings: {
        items: {
          source: "interventions",
          selector: { app_id_current: true },
          fallback: [],
        },
      },
      actions: { primary: "complete_iv", focus: "focus_iv" },
    },
    {
      id: "actions",
      type: "action_list",
      slot: { column: 3, order: 0 },
      config: { label: "Next steps" },
      bindings: {
        items: {
          source: "literal",
          value: [
            { label: "Review agent suggestions", detail: "3 pending" },
            { label: "Assign an owner to each intervention" },
          ],
        },
      },
    },
  ],
};
