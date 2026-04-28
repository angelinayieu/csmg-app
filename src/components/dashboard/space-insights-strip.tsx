"use client";

// ── SpaceInsightsStrip ──────────────────────────────────────────────
//
// Renders the three space-level insight widgets as a row above the
// dashboard grid:
//
//   [ external_signal_banner ]  [ contributors_strip ]
//   [ kg_top_insights ]
//
// This is the first step toward a manifest-driven space dashboard. Today
// the manifest is hardcoded in this component; when we promote it to
// `spaces.dashboard_manifest` (Tier 3 of the roadmap), the widget
// registration + resolver wiring here transfers verbatim — only the
// manifest source changes.
//
// Deliberate architectural choice: we render widgets directly via their
// registered components rather than going through AppRenderer. AppRenderer
// is scoped to real Apps (action dispatch, preferences round-trip,
// interaction tracking). The space dashboard doesn't have an App row, so
// using a pseudo-App is misleading. When space-level manifests become a
// real data concept with their own mutation endpoints, we'll either
// extend AppRenderer to accept a nullable app or build a small
// `ManifestRenderer` parallel. Keeping this thin until then.

import { motion } from "framer-motion";
import { useMemo } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { useAgents } from "@/lib/hooks/use-agents";
import type { AppManifest, DataBinding, WidgetInstance } from "@/types/app-manifest";
import { APP_MANIFEST_SCHEMA_VERSION } from "@/types/app-manifest";
import { getWidget } from "@/lib/apps/widget-registry";
import {
  makeResolve,
  type Resolver,
  type ResolverTable,
} from "@/lib/apps/binding-resolver";
import type {
  ResolvedBinding,
  WidgetRenderContext,
} from "@/lib/apps/widget-context";
import { hydrateApp } from "@/types/app";
import type { App, AppRow } from "@/types/app";
import type { ContributorLite } from "@/components/apps/widgets/space-insights-widgets";

// Auto-bootstrap the widget registry (idempotent; same pattern as AppRenderer).
import "@/components/apps/widgets";

const EASE = [0.22, 1, 0.36, 1] as const;

// ── Hardcoded manifest for the space-level insights row ──
// When promoted to a DB-backed manifest, move this into the default
// space-dashboard manifest builder.
const SPACE_INSIGHTS_MANIFEST: AppManifest = {
  schema_version: APP_MANIFEST_SCHEMA_VERSION,
  version: 1,
  layout: { kind: "dashboard", columns: 3, density: "cozy" },
  widgets: [
    {
      id: "space-signals",
      type: "external_signal_banner",
      slot: { column: 1, span: 2, order: 0 },
      bindings: {
        signals: { source: "intelligence_signals" },
      },
    },
    {
      id: "space-contributors",
      type: "contributors_strip",
      slot: { column: 3, span: 1, order: 0 },
      bindings: {
        contributors: { source: "contributors" },
      },
      config: { max_visible: 5, show_names: false },
    },
    {
      id: "space-top-insights",
      type: "kg_top_insights",
      slot: { column: 1, span: 3, order: 10 },
      bindings: {
        insights: { source: "kg_top_insights" },
      },
    },
  ],
  actions: [],
  provenance: {
    produced_by: "pipeline:space-dashboard-default",
    produced_at: "2026-04-17T00:00:00.000Z",
  },
};

// ── Component ────────────────────────────────────────────────────────

function prettifyKind(kind: string): string {
  return kind
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

type AgentStatusLite = "idle" | "queued" | "running" | "paused" | "error" | "retired";
function statusToContributor(s: AgentStatusLite): ContributorLite["status"] {
  if (s === "running" || s === "queued") return "running";
  if (s === "error") return "failed";
  return s === "idle" ? "idle" : "done";
}

export function SpaceInsightsStrip() {
  const { space, entities, goalList, activeGoal } = useSpaceData();

  // Shared agents fetch (deduped + polled across all dashboard consumers).
  // Replaces the prior hardcoded Synthesizer/Critic/Reasoner triplet.
  const { data: agentsPayload } = useAgents(space?.id);
  const agentRows = agentsPayload?.agents ?? [];
  const agentRuns = agentsPayload?.recent_runs ?? [];

  // ── Resolver wiring ──
  // Each resolver is a pure function of the space context (closed-over
  // below). Changes to the context re-build the table via useMemo so
  // widgets see fresh values on re-render.
  const resolverTable: ResolverTable = useMemo(() => {
    // Pull synthesis_data off the space row — it's a JSONB blob with an
    // internal intelligence_radar, leverage_points, etc.
    const synth = (space?.synthesis_data as Record<string, unknown> | null | undefined) ?? null;
    const radar = (synth?.intelligence_radar ?? null) as Record<string, unknown> | null;
    const signals = Array.isArray(radar?.signals) ? radar.signals : [];

    const intelligence_signals_resolver: Resolver = () => signals;

    const kg_top_insights_resolver: Resolver = () => {
      if (!synth) return null;
      const lev = Array.isArray(synth.leverage_points)
        ? (synth.leverage_points as Array<Record<string, unknown>>)
        : [];
      const risks = Array.isArray(synth.risk_points)
        ? (synth.risk_points as Array<Record<string, unknown>>)
        : [];
      const bottleneck = synth.master_bottleneck as Record<string, unknown> | null | undefined;
      const openQs = Array.isArray(synth.open_questions)
        ? synth.open_questions as unknown[]
        : [];
      const loops = Array.isArray(synth.feedback_loops)
        ? synth.feedback_loops as unknown[]
        : [];
      const quality =
        typeof synth.quality_score === "object" && synth.quality_score !== null
          ? (synth.quality_score as Record<string, unknown>)
          : null;

      return {
        quality_score: (quality?.overall as number | undefined) ?? null,
        quality_label: (quality?.label as string | undefined) ?? null,
        total_entities: entities.length,
        leverage_points: lev.slice(0, 5).map((p) => ({
          entity_name: p.entity_name as string | undefined,
          reason: p.reason as string | undefined,
          downstream_impact: p.downstream_impact as number | undefined,
        })),
        risk_points: risks.slice(0, 5).map((p) => ({
          entity_name: p.entity_name as string | undefined,
          reason: p.reason as string | undefined,
          blast_radius: p.blast_radius as number | undefined,
        })),
        master_bottleneck: bottleneck
          ? {
              entity_name: bottleneck.entity_name as string | undefined,
              explanation: bottleneck.explanation as string | undefined,
            }
          : null,
        open_question_count: openQs.length,
        feedback_loop_count: loops.length,
      };
    };

    const contributors_resolver: Resolver = () => {
      // Sprint 5B scope-down: owner-as-user + any known agents. When
      // space_collaborators lands, this resolver extends to a union.
      // For now we synthesize a minimal list so the widget has something
      // to show immediately.
      const contributors: ContributorLite[] = [];

      // Owner (single user today). Name/avatar are not in useSpaceData;
      // we render a placeholder until we wire up a profiles fetch.
      if (space?.user_id) {
        contributors.push({
          id: `user:${space.user_id}`,
          name: "You",
          kind: "user",
          role: "Owner",
          recent_contribution: activeGoal
            ? `Tracking goal: ${activeGoal.title}`
            : goalList.length > 0
              ? `${goalList.length} active goal${goalList.length === 1 ? "" : "s"}`
              : null,
          status: "idle",
        });
      }

      // Real agents from /api/agents (replaces the prior hardcoded triplet).
      // Skips retired agents. Sorts running first, then by last_run_at desc.
      const lastRunByAgent = new Map<string, string>();
      for (const r of agentRuns) {
        const prior = lastRunByAgent.get(r.agent_id);
        if (!prior || new Date(r.started_at) > new Date(prior)) {
          lastRunByAgent.set(r.agent_id, r.started_at);
        }
      }

      const agentContribs = agentRows
        .filter((a) => a.status !== "retired")
        .map<ContributorLite>((a) => ({
          id: `agent:${a.id}`,
          name: a.display_name ?? prettifyKind(a.kind),
          kind: "agent",
          role: prettifyKind(a.kind),
          status: statusToContributor(a.status),
          last_active_at: a.last_run_at ?? lastRunByAgent.get(a.id) ?? null,
        }))
        .sort((a, b) => {
          if (a.status === "running" && b.status !== "running") return -1;
          if (b.status === "running" && a.status !== "running") return 1;
          const ta = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
          const tb = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
          return tb - ta;
        });

      contributors.push(...agentContribs);

      return contributors;
    };

    return {
      intelligence_signals: intelligence_signals_resolver,
      kg_top_insights: kg_top_insights_resolver,
      contributors: contributors_resolver,
    };
  }, [space, entities.length, goalList, activeGoal, agentRows, agentRuns]);

  // ── Pseudo-App for WidgetRenderContext.app ──
  // Some widget contracts read app.state / app.config fields via the
  // default resolvers (app_state_field, app_config_field). None of our
  // three widgets do, but the type demands an App — synthesize a minimal
  // one so the context satisfies the contract without lying about state.
  const pseudoApp: App = useMemo(() => {
    const row: AppRow = {
      id: `space:${space?.id ?? "unknown"}`,
      space_id: space?.id ?? "",
      user_id: space?.user_id ?? "",
      name: space?.name ?? "Space",
      description: space?.description ?? null,
      app_type: "dashboard",
      source_strategy_version: null,
      source_perspective: null,
      source_infrastructure_proposal_id: null,
      dominant_entity_ids: [],
      dominant_entity_codes: [],
      sub_space_id: null,
      serves_goal_id: activeGoal?.id ?? null,
      serves_sub_objective_ids: [],
      tracked_metric_tracker_ids: [],
      config: {},
      state: {},
      status: "active",
      health_score: null,
      stale_reason: null,
      stale_since: null,
      last_refreshed_at: null,
      last_updated_by: null,
      priority: 1,
      complexity: null,
      // F3 / D14 — pseudo-App for the dashboard context; not a real
      // downstream-application, so no domain intent or pairings.
      application_type: null,
      complementary_app_ids: [],
      created_at: space?.created_at ?? new Date().toISOString(),
      updated_at: space?.updated_at ?? new Date().toISOString(),
    };
    return hydrateApp(row);
  }, [space, activeGoal]);

  const resolve = useMemo(
    () => makeResolve(resolverTable, pseudoApp),
    [resolverTable, pseudoApp]
  );

  // Minimal render context — this row doesn't dispatch actions or
  // navigate, so we stub those as no-ops.
  const context: WidgetRenderContext = useMemo(
    () => ({
      app: pseudoApp,
      manifest: SPACE_INSIGHTS_MANIFEST,
      resolve: <T,>(binding: DataBinding | undefined): ResolvedBinding<T> =>
        resolve<T>(binding),
      dispatch: async () => ({ ok: false, reason: "Space dashboard does not dispatch actions" }),
      getAction: () => undefined,
      isActionAvailable: () => false,
      navigate: (href: string) => {
        if (typeof window !== "undefined") window.location.href = href;
      },
    }),
    [pseudoApp, resolve]
  );

  // ── Render widgets by slot ──
  // Slots: column 1-2 signals, column 3 contributors (row 0);
  // column 1-3 kg_top_insights (row 10). Rendered as a 3-col grid at lg+.
  const widgetsByRow = useMemo(() => {
    const byOrder = [...SPACE_INSIGHTS_MANIFEST.widgets].sort(
      (a, b) => (a.slot?.order ?? 0) - (b.slot?.order ?? 0)
    );
    // Group by order band: order 0-9 = top row, 10-19 = second row, etc.
    const rows: WidgetInstance[][] = [];
    let currentBand = -1;
    for (const w of byOrder) {
      const band = Math.floor((w.slot?.order ?? 0) / 10);
      if (band !== currentBand) {
        rows.push([]);
        currentBand = band;
      }
      rows[rows.length - 1].push(w);
    }
    return rows;
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay: 0.04 }}
      className="flex flex-col gap-4"
      aria-label="Space insights"
    >
      {widgetsByRow.map((row, rowIdx) => (
        <div
          key={`row-${rowIdx}`}
          className="grid grid-cols-1 gap-4 md:grid-cols-3"
        >
          {row.map((instance) => (
            <WidgetSlot
              key={instance.id}
              instance={instance}
              context={context}
            />
          ))}
        </div>
      ))}
    </motion.section>
  );
}

// ── Per-widget slot wrapper ──────────────────────────────────────────

function WidgetSlot({
  instance,
  context,
}: {
  instance: WidgetInstance;
  context: WidgetRenderContext;
}) {
  const registered = getWidget(instance.type);

  // Grid span from slot hint
  const span = instance.slot?.span ?? 1;
  const spanClass =
    span === 3 ? "md:col-span-3" : span === 2 ? "md:col-span-2" : "md:col-span-1";

  if (!registered) {
    return (
      <div className={spanClass}>
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50 p-3 text-[11px] text-red-700">
          Unknown widget: <code className="font-mono">{instance.type}</code>
        </div>
      </div>
    );
  }

  const Component = registered.Component;

  return (
    <div className={spanClass}>
      <Component instance={instance} context={context} />
    </div>
  );
}
