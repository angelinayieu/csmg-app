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
import type { AppStrategyRow, AppStrategyVersionRow, AppStrategy } from "@/types/app-strategy";
import { hydrateAppStrategy } from "@/types/app-strategy";
import { AppStrategyPanel } from "@/components/apps/app-strategy-panel";
import { ReportButton } from "@/components/apps/report-button";
import type {
  ExperimentTaxonomy,
  ExperimentVariant,
  VariantWithSlots,
} from "@/types/experiment-taxonomy";
import { hydrateTaxonomy } from "@/types/experiment-taxonomy";
import type {
  DownstreamReality,
  LatentVariable,
  VariantOutcomeScore,
} from "@/types/variant-outcomes";
import { composeDownstreamReality } from "@/types/variant-outcomes";
import type { ImprovementGoal, GoalTreeNode } from "@/types/goals";
import type { CausalChain } from "@/types/causal-chains";
import type { RankedStrategy } from "@/types/strategy";
import type { NodeSignature } from "@/types/node-signature";
import { SpacePlanDrawer, type QueueSummary, type CombinationResultLite } from "@/components/signatures/space-plan-drawer";
import { ConditionalGatePanel } from "@/components/apps/conditional-gate-panel";
import { useKGHighlight } from "@/components/layout/kg-highlight-context";
import type { SpacePlan } from "@/types/space-plan";
import type { ConstellationItem } from "@/components/apps/widgets/signature-constellation-widget";

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
  // Tier 3.5: per-app sub-strategy state. Hydrated from /api/apps/:id and
  // patched in place by the panel's Generate / Promote actions so the
  // page doesn't need a full reload after each action.
  const [appStrategy, setAppStrategy] = useState<AppStrategy | null>(null);
  const [appStrategyVersions, setAppStrategyVersions] = useState<AppStrategyVersionRow[]>([]);
  // Tier 3.5: lazy auto-generation guard. Without this, the auto-trigger
  // useEffect can fire repeatedly on re-renders (state updates → effect
  // re-runs → another POST). We only ever attempt one auto-gen per app
  // load; the user can manually regenerate after that via the panel.
  const [autoGenAttempted, setAutoGenAttempted] = useState(false);
  // Tier 3.6: surface sub-strategy generation errors to the panel so the
  // user sees what went wrong instead of the button appearing to do nothing.
  // Cleared on successful generate; rewritten on each retry failure.
  const [subStrategyError, setSubStrategyError] = useState<string | null>(null);
  // Phase 3 (VP Project report): experiment taxonomy + variants. These
  // feed the iv_decomposition + variant_carousel widgets through the
  // ResolverTable. Hydrated once on /api/apps/:id response.
  const [taxonomy, setTaxonomy] = useState<ExperimentTaxonomy | null>(null);
  const [variants, setVariants] = useState<ExperimentVariant[]>([]);
  const [activeVariant, setActiveVariant] = useState<VariantWithSlots | null>(null);
  // Phase 3 Batch 3 — downstream reality (variant × latent-variable heatmap).
  // Raw rows get hydrated into a DownstreamReality via composeDownstreamReality
  // inside the resolver memo to keep the page state flat.
  const [latentVariables, setLatentVariables] = useState<LatentVariable[]>([]);
  const [outcomeScores, setOutcomeScores] = useState<VariantOutcomeScore[]>([]);
  // Phase 3 Batch 4 — explanatory widget sources. Goals arrive flat and
  // get composed into a tree inside the resolver memo. Causal chains +
  // ranked strategies come from synthesis_data; we derive them from the
  // existing `synth` state rather than adding new fetches.
  const [goals, setGoals] = useState<ImprovementGoal[]>([]);
  // Batch 8 — node signatures + their entity names. Server returns rows
  // shaped as `{ id, name, node_signature }`; we keep them in that shape
  // here and build ConstellationItem at resolve time.
  const [signatureEntities, setSignatureEntities] = useState<
    Array<{ id: string; name: string; node_signature: NodeSignature | null }>
  >([]);
  // Strategizer plan drawer — opens on demand, fetches the latest plan
  // for this space lazily so the page load isn't gated on it. The plan
  // is the audit trail for what the strategizer chose to generate next;
  // without this drawer the strategizer is invisible to the user.
  const [planOpen, setPlanOpen] = useState(false);
  const [planRow, setPlanRow] = useState<SpacePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  // Separate from planLoading: loading is the passive GET-latest fetch,
  // generating is the active POST that produces a new plan. We want
  // different UI for each — generating is a 5-15s LLM roundtrip.
  const [planGenerating, setPlanGenerating] = useState(false);
  // Executor queue summary — kept separately from planRow because it
  // changes much more often (cron drains every 10 min) and the drawer
  // should reflect that without re-fetching the whole plan.
  const [queueSummary, setQueueSummary] = useState<QueueSummary | null>(null);
  // Combination executor results, keyed by candidate_id (e.g. "combo:a+b").
  // Threaded into the drawer so each selected `intervention_combination`
  // item can render its joint-analysis card. Empty map = nothing executed
  // yet for this plan; the drawer falls back to a "pending" card.
  const [combinationResults, setCombinationResults] = useState<
    Record<string, CombinationResultLite>
  >({});

  // Fetch the LLM-drafted combination analyses for this space. Soft-fail
  // to an empty map — a missing endpoint or empty result just means the
  // drawer renders pending cards instead of joint-analysis cards.
  async function refreshCombinationResults(planId?: string | null) {
    if (!spaceId) return;
    try {
      const params = new URLSearchParams({ space_id: spaceId });
      if (planId) params.set("plan_id", planId);
      const res = await fetch(
        `/api/pipeline/space-combinations?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        results?: Array<CombinationResultLite & { id: string; created_at: string }>;
      };
      const map: Record<string, CombinationResultLite> = {};
      for (const r of json.results ?? []) {
        // First-write-wins by candidate_id — the route already orders
        // results created_at desc so the freshest entry sits at index 0.
        if (!map[r.candidate_id]) {
          map[r.candidate_id] = {
            candidate_id: r.candidate_id,
            entity_a_name: r.entity_a_name ?? null,
            entity_b_name: r.entity_b_name ?? null,
            title: r.title,
            novelty: r.novelty,
            implication: r.implication,
            mechanism: r.mechanism,
            probes: Array.isArray(r.probes) ? r.probes : [],
          };
        }
      }
      setCombinationResults(map);
    } catch {
      // swallow — drawer falls back to pending cards
    }
  }

  // Fetch the executor queue summary. Soft-fail: a hiccup here should
  // never block the plan drawer from opening.
  async function refreshQueueSummary() {
    if (!spaceId) return;
    try {
      const res = await fetch(
        `/api/pipeline/space-executor?space_id=${encodeURIComponent(spaceId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as QueueSummary;
      setQueueSummary(json);
    } catch {
      // swallow — strip just won't appear
    }
  }

  async function openPlanDrawer() {
    setPlanOpen(true);
    // Always refresh the queue summary on open — it changes out-of-band
    // (the cron drains every 10 min), so a cached value from a previous
    // open session would be misleading. Fire-and-forget; no await.
    void refreshQueueSummary();
    if (planRow || planLoading) return;
    if (!spaceId) return;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const res = await fetch(
        `/api/pipeline/space-strategizer?space_id=${encodeURIComponent(spaceId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (HTTP ${res.status})`);
      }
      const json = (await res.json()) as {
        plan:
          | (SpacePlan & { plan_document?: SpacePlan })
          | null;
      };
      // The GET endpoint returns the row shape (with plan_document
      // nested) — unwrap to the plan itself if present, else accept the
      // top-level shape as-is. A null plan is a legitimate empty state,
      // NOT an error — the drawer renders EmptyBlock with a Generate
      // action from there.
      const next =
        json.plan && typeof json.plan === "object" && "plan_document" in json.plan
          ? ((json.plan as { plan_document: SpacePlan }).plan_document ?? null)
          : (json.plan as SpacePlan | null);
      setPlanRow(next);
      // Pull the combination-executor results scoped to this plan so each
      // selected `intervention_combination` item can render its joint
      // analysis card. Fire-and-forget — the drawer will live-fill cards
      // as they arrive.
      void refreshCombinationResults(next?.id ?? null);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanLoading(false);
    }
  }

  // Strategizer POST — produces a new plan + enqueues space_work_queue
  // rows. Defaults below match the route's internal defaults; we only
  // hardcode `budget_tokens` because the route rejects without one.
  //
  // The drain cron at /api/cron/space-executor-drain will pick up the
  // queued rows within ~10 minutes. Users who want instant execution
  // can hit POST /api/pipeline/space-executor manually.
  async function generatePlan() {
    if (!spaceId) return;
    if (planGenerating) return;
    setPlanGenerating(true);
    setPlanError(null);
    try {
      const res = await fetch("/api/pipeline/space-strategizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space_id: spaceId,
          // ~6k tokens = ≈ 8 items × ~750 tok avg. Enough headroom for
          // a meaningful plan without burning through a weekly budget
          // on one cycle. Tune per-space later if needed.
          budget_tokens: 6000,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? body.error ?? `Failed (HTTP ${res.status})`);
      }
      const json = (await res.json()) as {
        plan: SpacePlan;
        persisted?: boolean;
        invariant_violations?: unknown[];
      };
      // POST returns the plan already unwrapped (unlike GET which wraps
      // it in a row). Set directly.
      setPlanRow(json.plan ?? null);
      // A fresh plan just wrote new rows into space_work_queue — refresh
      // the summary so the strip reflects the new "pending" count.
      void refreshQueueSummary();
      // Reset combination cards optimistically (a fresh plan invalidates
      // any prior plan's combo executor outputs), then refetch scoped to
      // the new plan id. Cards will appear after the next drain cron run.
      setCombinationResults({});
      void refreshCombinationResults(json.plan?.id ?? null);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanGenerating(false);
    }
  }

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
          app_strategy?: AppStrategyRow | null;
          app_strategy_versions?: AppStrategyVersionRow[];
          experiment_taxonomy?: Parameters<typeof hydrateTaxonomy>[0] | null;
          experiment_variants?: ExperimentVariant[];
          experiment_active_variant?: VariantWithSlots | null;
          latent_variables?: LatentVariable[];
          variant_outcome_scores?: VariantOutcomeScore[];
          improvement_goals?: ImprovementGoal[];
          node_signature_entities?: Array<{
            id: string;
            name: string;
            node_signature: NodeSignature | null;
          }>;
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
        setAppStrategy(json.app_strategy ? hydrateAppStrategy(json.app_strategy) : null);
        setAppStrategyVersions(json.app_strategy_versions ?? []);
        setTaxonomy(
          json.experiment_taxonomy ? hydrateTaxonomy(json.experiment_taxonomy) : null,
        );
        setVariants(json.experiment_variants ?? []);
        setActiveVariant(json.experiment_active_variant ?? null);
        setLatentVariables(json.latent_variables ?? []);
        setOutcomeScores(json.variant_outcome_scores ?? []);
        setGoals(json.improvement_goals ?? []);
        setSignatureEntities(json.node_signature_entities ?? []);
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

    // Tier 3.5: app_strategy resolver — widgets can bind to either the
    // whole spec or a single section via selector.section. Returns null
    // when no sub-strategy exists or its status isn't "active" (drafts
    // are surfaced via the panel, not via widget bindings — widgets
    // shouldn't read in-progress refinements).
    const appStrategyResolver: Resolver = (selector) => {
      if (!appStrategy || appStrategy.status !== "active") return null;
      const section = typeof selector?.section === "string" ? selector.section : null;
      if (!section) return appStrategy.spec;
      const spec = appStrategy.spec as unknown as Record<string, unknown>;
      return spec[section] ?? null;
    };

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

    // ── Phase 3 (VP Project report) resolvers ─────────────────────────
    //
    //   experiment_taxonomy        — single row; the slot schema + status
    //                                vocab + outcome-axes the space's
    //                                domain-inferrer settled on.
    //   experiment_variants        — full variant list for this space.
    //                                selector.app_id narrows to variants
    //                                owned by the current app ("__self__"
    //                                convention matches the intervention
    //                                resolver above).
    //   experiment_active_variant  — the single hydrated card (variant +
    //                                its slot rows) the iv_decomposition
    //                                widget should show up front. Callers
    //                                wanting a different variant should
    //                                dispatch activate_variant first and
    //                                the parent page re-fetches.
    const experimentTaxonomyResolver: Resolver = () => taxonomy;
    const experimentVariantsResolver: Resolver = (selector, ctx) => {
      const appIdFilter = selector?.app_id;
      const targetAppId = appIdFilter === "__self__" ? ctx.app.id : appIdFilter;
      const statusFilter =
        typeof selector?.status === "string" ? selector.status : null;
      return variants.filter((v) => {
        if (targetAppId && v.app_id && v.app_id !== targetAppId) return false;
        if (statusFilter && v.status !== statusFilter) return false;
        return true;
      });
    };
    const experimentActiveVariantResolver: Resolver = () => activeVariant;

    // Phase 3 Batch 3 — downstream reality resolver. Composes the
    // grid from two flat arrays on the fly; memo'd per render so the
    // widget's context.resolve() returns a stable reference until
    // either array changes.
    const downstreamRealityCache: { value: DownstreamReality | null } = {
      value: null,
    };
    const downstreamRealityResolver: Resolver = () => {
      if (!downstreamRealityCache.value) {
        downstreamRealityCache.value = composeDownstreamReality(
          latentVariables,
          outcomeScores,
        );
      }
      return downstreamRealityCache.value;
    };

    // ── Phase 3 Batch 4 — explanatory widget resolvers ──────────────
    //
    //   causal_chains      — reads synthesis_data.causal_chains. selector
    //                        .goal_id narrows to chains whose
    //                        primary_goal_id matches (useful for
    //                        per-app scoping once apps expose
    //                        serves_goal_id).
    //   ranked_strategies  — reads synthesis_data.strategic_recommendation
    //                        .ranked_strategies. If the synthesis only
    //                        contains a `recommendation` (older spaces),
    //                        synthesizes a single rank-1 wrapper so the
    //                        widget can still render.
    //   goal_tree          — composes a parent→children tree from the
    //                        flat improvement_goals array. selector
    //                        .root_id picks a specific root; default is
    //                        the first root (parent_goal_id === null).
    //                        Returns either one GoalTreeNode or a
    //                        GoalTreeNode[] when multiple roots exist
    //                        and no selector was given.
    const causalChainsResolver: Resolver = (selector) => {
      const raw = (synth?.causal_chains ?? []) as CausalChain[];
      const goalId = typeof selector?.goal_id === "string" ? selector.goal_id : null;
      if (!goalId) return raw;
      return raw.filter((c) => c.primary_goal_id === goalId);
    };

    const rankedStrategiesResolver: Resolver = () => {
      const rec = synth?.strategic_recommendation as
        | { ranked_strategies?: RankedStrategy[]; recommendation?: unknown }
        | null
        | undefined;
      if (!rec) return [];
      if (Array.isArray(rec.ranked_strategies) && rec.ranked_strategies.length > 0) {
        return rec.ranked_strategies;
      }
      // Back-compat: older syntheses store only the primary recommendation.
      // Wrap it as a rank-1 RankedStrategy so the widget isn't empty.
      if (rec.recommendation) {
        return [
          {
            rank: 1,
            recommendation: rec.recommendation,
            ranking_rationale:
              "Primary recommendation from synthesis — no alternatives were generated for this space.",
            infrastructure_proposals: [],
            tradeoff_vs_top: null,
          },
        ];
      }
      return [];
    };

    // Tree composer — one pass to build an id→node map, second pass to
    // wire children. Cached so subsequent resolver calls in the same
    // render (e.g., multiple objective_tree widgets) don't rebuild.
    const goalTreeCache: { built: boolean; byId: Map<string, GoalTreeNode>; roots: GoalTreeNode[] } = {
      built: false,
      byId: new Map(),
      roots: [],
    };
    const buildGoalTree = () => {
      if (goalTreeCache.built) return;
      goalTreeCache.built = true;
      for (const g of goals) {
        goalTreeCache.byId.set(g.id, { ...g, children: [] });
      }
      for (const g of goals) {
        const node = goalTreeCache.byId.get(g.id)!;
        if (g.parent_goal_id) {
          const parent = goalTreeCache.byId.get(g.parent_goal_id);
          if (parent) {
            parent.children.push(node);
            continue;
          }
          // Orphan with missing parent FK — treat as a root rather than
          // dropping it so the user still sees the goal.
        }
        goalTreeCache.roots.push(node);
      }
    };
    const goalTreeResolver: Resolver = (selector) => {
      buildGoalTree();
      const rootId = typeof selector?.root_id === "string" ? selector.root_id : null;
      if (rootId) {
        return goalTreeCache.byId.get(rootId) ?? null;
      }
      // Default: if exactly one root, return the single node so the
      // widget's most-common path (one ultimate goal) stays typed as
      // GoalTreeNode. Otherwise return the whole roots[] array.
      if (goalTreeCache.roots.length === 1) return goalTreeCache.roots[0];
      return goalTreeCache.roots;
    };

    // ── Batch 8 — node_signatures resolver ──
    //
    // Joins entity name into each NodeSignature so the constellation
    // widget gets ConstellationItem[] without a second lookup. Filters
    // out rows that came back without a signature (defensive — server
    // already filters on `not("node_signature", "is", null)` but a
    // network-level retry could still surface partials).
    //
    // Selector knobs:
    //   - min_zoom (number) — drop signatures whose resolution.zoom is
    //     less than this. Useful when a widget wants only the well-
    //     resolved nodes.
    //   - entity_id (string) — return just the matching item (or [] if
    //     unknown) for single-entity ring embeds.
    const nodeSignaturesResolver: Resolver = (selector) => {
      const minZoom =
        typeof selector?.min_zoom === "number" ? selector.min_zoom : null;
      const entityId =
        typeof selector?.entity_id === "string" ? selector.entity_id : null;
      const items: ConstellationItem[] = [];
      for (const row of signatureEntities) {
        if (!row.node_signature) continue;
        if (entityId && row.id !== entityId) continue;
        if (minZoom !== null && row.node_signature.resolution.zoom < minZoom) continue;
        items.push({ signature: row.node_signature, entity_name: row.name });
      }
      return items;
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
      app_strategy: appStrategyResolver,
      experiment_taxonomy: experimentTaxonomyResolver,
      experiment_variants: experimentVariantsResolver,
      experiment_active_variant: experimentActiveVariantResolver,
      downstream_reality: downstreamRealityResolver,
      causal_chains: causalChainsResolver,
      ranked_strategies: rankedStrategiesResolver,
      goal_tree: goalTreeResolver,
      node_signatures: nodeSignaturesResolver,
    };
  }, [
    detail,
    synth,
    strategyBaseline,
    predictions,
    appStrategy,
    taxonomy,
    variants,
    activeVariant,
    latentVariables,
    outcomeScores,
    goals,
    signatureEntities,
  ]);

  // Entity-name lookup for the strategizer plan drawer. The drawer needs
  // to decode candidate ids like `combo:{uuidA}+{uuidB}` and `sig:{uuid}`
  // back into human names — `signatureEntities` already carries the rows
  // we need, so we just project to a flat map. Recomputed only when the
  // signature list changes.
  const entityNamesById = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const e of signatureEntities) {
      out[e.id] = e.name;
    }
    return out;
  }, [signatureEntities]);

  // ── Parent refresh when an action updated the app ──
  const handleAppUpdated = (next: App) => {
    setDetail((prior) => (prior ? { ...prior, app: next } : prior));
  };

  // ── Highlight this app's dominant entities in the persistent KG mini-map ──
  // The mini-map lives in space-shell; we just push an id-set + reason here
  // so it can light up the relevant nodes while this page is mounted. The
  // ids are UUIDs (matching `entity.id`), which is what the rail expects.
  // Effect re-runs when navigating between apps so the highlight follows
  // the user without a full layout remount.
  const { setHighlight, clearHighlight } = useKGHighlight();
  useEffect(() => {
    const ids = detail?.app?.dominant_entity_ids ?? [];
    if (!ids.length) {
      clearHighlight("app-detail");
      return;
    }
    setHighlight("app-detail", {
      ids: new Set(ids),
      reason: `Active app · ${ids.length} dominant ${ids.length === 1 ? "entity" : "entities"}`,
    });
    return () => clearHighlight("app-detail");
  }, [detail?.app?.dominant_entity_ids, setHighlight, clearHighlight]);

  // ── Navigation actions from AppRenderer ──
  const handleNavigate = (href: string) => {
    router.push(href);
  };

  // ── Tier 3.5: sub-strategy actions ────────────────────────────────
  // Generate (or regenerate) the app's sub-strategy. Used by both the
  // lazy auto-trigger below and the panel's manual button. Returns the
  // newly active strategy so the caller can update local state without
  // a full refetch.
  const generateSubstrategy = async (
    triggerReason: string,
  ): Promise<AppStrategy | null> => {
    if (!appId) return null;
    // Clear prior error optimistically so the "Regenerating…" state doesn't
    // show a stale banner. Overwritten if this attempt also fails.
    setSubStrategyError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger_reason: triggerReason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { strategy: AppStrategy };
      // Update both the active strategy AND refetch the version log so
      // the panel's audit list shows the new entry.
      setAppStrategy(json.strategy);
      try {
        const verRes = await fetch(`/api/apps/${appId}/strategy`, { cache: "no-store" });
        if (verRes.ok) {
          const verJson = (await verRes.json()) as { versions: AppStrategyVersionRow[] };
          setAppStrategyVersions(verJson.versions ?? []);
        }
      } catch {
        /* version log refetch is non-critical */
      }
      return json.strategy;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[app-detail] sub-strategy generation failed:", err);
      setSubStrategyError(message);
      return null;
    }
  };

  // Promote a draft sub-strategy to active. Surfaced when the latest
  // generation hit quality gates and was persisted as draft.
  const promoteDraft = async (): Promise<AppStrategy | null> => {
    if (!appId || !appStrategy || appStrategy.status !== "draft") return null;
    try {
      const res = await fetch(`/api/apps/${appId}/strategy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: appStrategy.id,
          status: "active",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { strategy: AppStrategy };
      setAppStrategy(json.strategy);
      return json.strategy;
    } catch (err) {
      console.warn("[app-detail] draft promotion failed:", err);
      return null;
    }
  };

  // Lazy auto-generation: when an app loads with no sub-strategy at all,
  // fire generation in the background. Guarded so it only happens once
  // per app load — manual regen via the panel is the path for subsequent
  // re-runs. Skipped when generation is in flight (autoGenAttempted is
  // set BEFORE the await so concurrent renders don't double-fire).
  useEffect(() => {
    if (!detail || !appId) return;
    if (appStrategy) return;
    if (autoGenAttempted) return;
    setAutoGenAttempted(true);
    void generateSubstrategy("Initial sub-strategy on first app open");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, appId, appStrategy, autoGenAttempted]);

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

          <div className="flex shrink-0 items-center gap-2">
            {/* Strategizer plan drawer — exposes the latest SpacePlan so
                the user can see what the strategizer chose to generate,
                what it skipped, and why. Without this surface, all the
                strategizer's rigor is invisible to the user. */}
            <button
              type="button"
              onClick={openPlanDrawer}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-[12px] font-medium text-[color:var(--fg,#1d1d1f)] hover:bg-black/[0.03]"
              aria-label="View strategy plan"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
                <path d="M6.5 3.5 V6.5 L8.5 8" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
              </svg>
              View plan
            </button>
            {/* Phase 3 Batch 5 — "Generate report" freezes the current
                app state into an immutable snapshot and navigates to
                the read-only report page. */}
            {spaceId && appId && (
              <ReportButton spaceId={spaceId} appId={appId} variant="ghost" />
            )}
            <Link
              href={whiteboardHref}
              className="inline-flex items-center gap-2 rounded-full bg-[color:rgb(var(--accent-rgb))] px-4 py-2 text-[12px] font-semibold text-white shadow-md transition-transform hover:scale-[1.02]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <rect x="1.5" y="2.5" width="11" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.2" fill="none" />
                <path d="M3 5.5 L5.5 7 L8 4.5 L11 7.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Open canvas
            </Link>
          </div>
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

      {/* Phase 4 §5.4 audit — conditional-gate verdicts surfaced from
          the per-app simulation pass. Renders only when the chain
          contained at least one conditional edge; otherwise returns
          null and takes no vertical space. Reads from the same app
          state row that drives the canvas card's p10/p50/p90 band. */}
      {app.state?.simulation_distribution?.gate_decisions &&
      app.state.simulation_distribution.gate_decisions.length > 0 ? (
        <div className="mb-5">
          <ConditionalGatePanel
            decisions={app.state.simulation_distribution.gate_decisions}
            entityNamesById={entityNamesById}
          />
        </div>
      ) : null}

      {/* Tier 3.5: per-app sub-strategy panel — sits between the twin
          surface (above) and the manifest body (below). Read-only spec
          summary + Regenerate / Promote actions. Renders an empty
          "generating…" shell when the lazy auto-trigger is in flight. */}
      <div className="mb-5">
        <AppStrategyPanel
          strategy={appStrategy}
          versions={appStrategyVersions}
          generating={autoGenAttempted && !appStrategy && !subStrategyError}
          lastError={subStrategyError}
          onRegenerate={async (reason) => {
            await generateSubstrategy(reason);
          }}
          onPromoteDraft={async () => {
            await promoteDraft();
          }}
        />
      </div>

      {/* Declarative body — AppRenderer reads config.manifest */}
      <AppRenderer
        app={app}
        resolverTable={resolverTable}
        onNavigate={handleNavigate}
        onAppUpdated={handleAppUpdated}
      />

      {/* Strategizer plan drawer — mounted at page root so it overlays
          everything cleanly via fixed-position styles. State + fetch
          handler live in the page; the drawer is purely presentational. */}
      <SpacePlanDrawer
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        plan={planRow}
        loading={planLoading}
        error={planError}
        onGenerate={generatePlan}
        generating={planGenerating}
        queueSummary={queueSummary}
        entityNamesById={entityNamesById}
        combinationResultsByCandidateId={combinationResults}
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
