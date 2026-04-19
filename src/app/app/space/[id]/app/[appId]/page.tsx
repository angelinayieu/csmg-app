"use client";

/**
 * Per-App Detail page — /app/space/:id/app/:appId
 *
 * Sprint 0↔Sprints 1-3 integration: this page is now a thin host for the
 * <AppRenderer /> which consumes config.manifest. The page's only job is
 *   (a) fetching app + interventions + space synthesis context,
 *   (b) providing a ResolverTable that maps manifest data sources to
 *       actual runtime data,
 *   (c) rendering the glass-hero breadcrumb chrome + <AppRenderer /> body.
 *
 * Everything visible in the body is declared in the manifest and can be
 * patched by agents via the `apply_agent_patch` action — no JSX changes
 * needed when the app evolves.
 */

import { motion } from "framer-motion";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppRenderer } from "@/components/apps/app-renderer";
import { TwinSurface } from "@/components/twin/twin-surface";
import type { ResolverTable, Resolver } from "@/lib/apps/binding-resolver";
import type { App } from "@/types/app";
import { hydrateApp } from "@/types/app";
import type { AppRow } from "@/types/app";
import type { Intervention } from "@/types/intervention";
import type { StrategyBaselineRow, PredictionLedgerRow } from "@/types/prediction";

const EASE = [0.22, 1, 0.36, 1] as const;

interface AppDetail {
  app: App;
  interventions: Intervention[];
  sub_space: { id: string; name: string } | null;
}

export default function AppDetailPage() {
  const params = useParams<{ id: string; appId: string }>();
  const router = useRouter();
  const spaceId = params?.id;
  const appId = params?.appId;

  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [synth, setSynth] = useState<Record<string, unknown> | null>(null);
  // Item 4: digital-twin lab data, pre-fetched on the same roundtrip as
  // the app. Stored on the page so the ResolverTable memo can close over
  // it; refetch-on-action can swap these in place via setter.
  const [strategyBaseline, setStrategyBaseline] = useState<StrategyBaselineRow | null>(null);
  const [predictions, setPredictions] = useState<PredictionLedgerRow[]>([]);

  // ── Load app + interventions + synthesis (single endpoint) ──
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!appId || !spaceId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/apps/${appId}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed (HTTP ${res.status})`);
        }
        const json = (await res.json()) as {
          app: AppRow;
          interventions: Intervention[];
          sub_space: AppDetail["sub_space"];
          synthesis: Record<string, unknown> | null;
          strategy_baseline?: StrategyBaselineRow | null;
          predictions?: PredictionLedgerRow[];
        };
        if (cancelled) return;
        setDetail({
          app: hydrateApp(json.app),
          interventions: json.interventions ?? [],
          sub_space: json.sub_space,
        });
        setSynth(json.synthesis ?? null);
        setStrategyBaseline(json.strategy_baseline ?? null);
        setPredictions(json.predictions ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load app");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [appId, spaceId]);

  // ── Resolver table handed to AppRenderer ──
  // Maps manifest DataSourceKind → actual data. The AppRenderer already
  // supplies defaults for `literal`, `app_state_field`, `app_config_field`;
  // we layer page-scoped resolvers on top for the rest.
  const resolverTable = useMemo<ResolverTable>(() => {
    if (!detail) return {};
    const { interventions } = detail;

    const interventionsResolver: Resolver = (selector, ctx) => {
      const appIdFilter = selector?.app_id;
      const statusFilter = selector?.status;
      const targetAppId = appIdFilter === "__self__" ? ctx.app.id : appIdFilter;
      return interventions.filter((iv) => {
        if (targetAppId && iv.app_id !== targetAppId) return false;
        if (typeof statusFilter === "string" && iv.status !== statusFilter) return false;
        return true;
      });
    };

    const interventionByIdResolver: Resolver = (selector) => {
      const id = typeof selector?.id === "string" ? selector.id : null;
      if (!id) return null;
      return interventions.find((iv) => iv.id === id) ?? null;
    };

    const leverageResolver: Resolver = () => {
      const pts = synth?.leverage_points;
      return Array.isArray(pts) ? pts : [];
    };
    const riskResolver: Resolver = () => {
      const pts = synth?.risk_points;
      return Array.isArray(pts) ? pts : [];
    };
    const scenariosResolver: Resolver = () => {
      const sc = synth?.scenarios;
      return Array.isArray(sc) ? sc : [];
    };
    const actionPlanResolver: Resolver = () => {
      const ap = synth?.action_plan;
      return Array.isArray(ap) ? ap : [];
    };

    // ── Item 4 digital-twin resolvers ───────────────────────────────
    // The lab widgets rely on pre-fetched ledger data. Selectors are
    // small filter objects defined per widget contract (see the binding
    // declarations in src/components/apps/widgets/index.ts).
    //
    //   strategy_baseline — returns the whole baseline row; widgets pick
    //                       kg_snapshot/metric_baselines/predicted_outcomes
    //                       from it in-component.
    //   prediction_ledger — filtered by selector.status (open|resolved|
    //                       abandoned), selector.app_id (or "__self__"),
    //                       selector.tracker_id. Default: open for this app.
    //   deviation_ledger  — resolved predictions tagged surprise or
    //                       regime_shift. Same selector shape as above plus
    //                       selector.tag (optional).
    //   twin_state        — pulled from synthesis_data.twin_state if present
    //                       (strategy-commit stores the snapshot there).
    //   simulation_result — not persisted yet; lives in app.state for now.
    //                       Widget writes via run_simulation action.
    //   agent_output      — latest recent_signal keyed by agent name.

    const strategyBaselineResolver: Resolver = () => strategyBaseline;

    const predictionLedgerResolver: Resolver = (selector, ctx) => {
      const status = typeof selector?.status === "string" ? selector.status : "open";
      const appIdFilter = selector?.app_id;
      const targetAppId = appIdFilter === "__self__" ? ctx.app.id : appIdFilter;
      const trackerFilter = typeof selector?.tracker_id === "string" ? selector.tracker_id : null;
      const agentFilter = typeof selector?.agent_id === "string" ? selector.agent_id : null;

      return predictions.filter((p) => {
        if (p.status !== status) return false;
        if (targetAppId && p.app_id && p.app_id !== targetAppId) return false;
        if (trackerFilter && p.tracker_id !== trackerFilter) return false;
        if (agentFilter && p.agent_id !== agentFilter) return false;
        return true;
      });
    };

    const deviationLedgerResolver: Resolver = (selector, ctx) => {
      const appIdFilter = selector?.app_id;
      const targetAppId = appIdFilter === "__self__" ? ctx.app.id : appIdFilter;
      const tagFilter = typeof selector?.tag === "string" ? selector.tag : null;
      return predictions.filter((p) => {
        if (p.status !== "resolved") return false;
        // Default: include surprise + regime_shift (the "interesting" deviations).
        // Explicit tag selector narrows further.
        if (tagFilter) {
          if (p.deviation_tag !== tagFilter) return false;
        } else {
          if (!p.deviation_tag || !["surprise", "regime_shift"].includes(p.deviation_tag)) return false;
        }
        if (targetAppId && p.app_id && p.app_id !== targetAppId) return false;
        return true;
      });
    };

    const twinStateResolver: Resolver = () => {
      const ts = synth?.twin_state;
      return ts && typeof ts === "object" ? ts : null;
    };

    const simulationResultResolver: Resolver = (_selector, ctx) => {
      // Written by run_simulation action into app.state.last_simulation.
      const state = ctx.app.state as Record<string, unknown>;
      return state?.last_simulation ?? null;
    };

    const agentOutputResolver: Resolver = (selector, ctx) => {
      const agentName = typeof selector?.agent_id === "string" ? selector.agent_id : null;
      const signals = (ctx.app.state?.recent_signals ?? []) as Array<{ agent?: string }>;
      if (!agentName) return signals[0] ?? null;
      return signals.find((s) => s.agent === agentName) ?? null;
    };

    return {
      interventions: interventionsResolver,
      intervention: interventionByIdResolver,
      synthesis_leverage: leverageResolver,
      synthesis_risks: riskResolver,
      synthesis_scenarios: scenariosResolver,
      action_plan: actionPlanResolver,
      strategy_baseline: strategyBaselineResolver,
      prediction_ledger: predictionLedgerResolver,
      deviation_ledger: deviationLedgerResolver,
      twin_state: twinStateResolver,
      simulation_result: simulationResultResolver,
      agent_output: agentOutputResolver,
    };
  }, [detail, synth, strategyBaseline, predictions]);

  // ── Parent refresh when an action updated the app ──
  const handleAppUpdated = (next: App) => {
    setDetail((prior) => (prior ? { ...prior, app: next } : prior));
  };

  // ── Navigation actions from AppRenderer ──
  const handleNavigate = (href: string) => {
    router.push(href);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-pulse text-[13px] text-[color:var(--muted-fg,#86868b)]">
          Loading app…
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <p className="text-[14px] text-[color:var(--muted-fg,#48484a)]">
          {error ?? "App not found."}
        </p>
        <button
          onClick={() => router.back()}
          className="mt-4 rounded-full bg-black/5 px-4 py-1.5 text-[12px] font-medium hover:bg-black/10"
        >
          Go back
        </button>
      </div>
    );
  }

  const { app } = detail;
  const whiteboardHref = `/app/space/${spaceId}/app/${appId}/whiteboard`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="mx-auto w-full max-w-6xl px-6 py-6"
    >
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 text-[12px] text-[color:var(--muted-fg,#86868b)]">
        <Link
          href={`/app/space/${spaceId}`}
          className="hover:text-[color:var(--fg,#1d1d1f)]"
        >
          Dashboard
        </Link>
        <span>›</span>
        <span>Apps</span>
        <span>›</span>
        <span className="text-[color:var(--fg,#1d1d1f)]">{app.name}</span>
      </div>

      {/* Glass-hero header */}
      <section className="glass-hero mb-6 rounded-[20px] px-7 py-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-fg,#6b7280)]">
              {app.app_type} · {app.status}
              {app.stale_reason ? (
                <span className="ml-2 rounded-full bg-[rgba(255,159,10,0.18)] px-2 py-0.5 text-[10px] font-semibold text-[#8a4a00]">
                  Stale: {app.stale_reason}
                </span>
              ) : null}
            </div>
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.01em] text-[color:var(--fg,#1d1d1f)]">
              {app.name}
            </h1>
            {app.config?.tagline || app.description ? (
              <p className="mt-2 max-w-2xl text-[14px] leading-[1.5] text-[color:var(--muted-fg,#48484a)]">
                {app.config?.tagline ?? app.description}
              </p>
            ) : null}
          </div>

          <Link
            href={whiteboardHref}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[color:rgb(var(--accent-rgb))] px-4 py-2 text-[12px] font-semibold text-white shadow-md transition-transform hover:scale-[1.02]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <rect x="1.5" y="2.5" width="11" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M3 5.5 L5.5 7 L8 4.5 L11 7.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Open canvas
          </Link>
        </div>

        {/* Key facts strip */}
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-[color:var(--muted-fg,#6b7280)]">
          {app.dominant_entity_codes?.length ? (
            <Fact label="Dominant factors" value={app.dominant_entity_codes.join(", ")} />
          ) : null}
          {app.serves_goal_title ? (
            <Fact label="Serves goal" value={app.serves_goal_title} />
          ) : null}
          {app.source_perspective ? (
            <Fact label="From perspective" value={app.source_perspective} />
          ) : null}
          {app.complexity ? <Fact label="Complexity" value={app.complexity} /> : null}
        </div>
      </section>

      {/* Per-app Twin mini — Subject filtered to this app's dominant
          factors. Renders the slice of the workflow this app is actually
          touching, so the user can see "what part of the twin does THIS
          app affect?" at a glance. */}
      {app.dominant_entity_codes && app.dominant_entity_codes.length > 0 ? (
        <div className="mb-6">
          <TwinSurface
            layers={["subject"]}
            density="medium"
            filter={{ entityCodes: app.dominant_entity_codes }}
            onOpenTwin={() => router.push(`/app/space/${spaceId}/twin?tab=design`)}
          />
        </div>
      ) : null}

      {/* Declarative body — AppRenderer reads config.manifest */}
      <AppRenderer
        app={app}
        resolverTable={resolverTable}
        onNavigate={handleNavigate}
        onAppUpdated={handleAppUpdated}
      />
    </motion.div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide">
        {label}
      </span>
      <span className="font-medium text-[color:var(--fg,#1d1d1f)]">{value}</span>
    </span>
  );
}
