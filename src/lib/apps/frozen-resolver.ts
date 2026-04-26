// ── Frozen Resolver (Phase 3 — VP Project report rendering) ─────────
//
// Builds a ResolverTable that reads from a frozen ReportPayload instead of
// live page state. The point: when the user opens a report they saved
// last Tuesday, the widgets render the exact numbers that were there on
// last Tuesday — not today's. No live DB reads, no live synthesis fetch,
// no "wait, my champion variant changed between the report and now."
//
// Every resolver mirrors the equivalent live resolver in
// /app/space/:id/app/:appId/page.tsx. Because both produce the same
// shapes (ExperimentTaxonomy, ExperimentVariant[], DownstreamReality,
// RankedStrategy[], CausalChain[], GoalTreeNode), widgets can't tell
// the difference — which is the whole point of the resolver table
// indirection.
//
// Keep this file dependency-free beyond type imports: any "real-world"
// lookup leaks into frozen reports and defeats the purpose.

import type { Resolver, ResolverTable } from "./binding-resolver";
import type { ReportPayload } from "@/types/report";
import type { DownstreamReality } from "@/types/variant-outcomes";
import { composeDownstreamReality } from "@/types/variant-outcomes";
import type { GoalTreeNode } from "@/types/goals";
import type { CausalChain } from "@/types/causal-chains";
import type { RankedStrategy } from "@/types/strategy";

/**
 * Build a frozen ResolverTable from a report's payload. The returned
 * table covers every DataSourceKind the VP Project widgets declare as
 * an `accepted_sources` entry. Unknown kinds fall through to the
 * AppRenderer's built-in defaults (literal / app_state_field /
 * app_config_field) which still work because `app_snapshot` is handed
 * in via ResolverContext.
 */
export function buildFrozenResolverTable(payload: ReportPayload): ResolverTable {
  // ── Caches ─────────────────────────────────────────────────────────
  // Compose once per resolver-table instance. Widgets re-render a lot;
  // re-building the DownstreamReality + goal tree on each call would
  // be wasteful.
  let downstreamCache: DownstreamReality | null = null;
  const computeDownstream = (): DownstreamReality => {
    if (!downstreamCache) {
      downstreamCache = composeDownstreamReality(
        payload.latent_variables ?? [],
        payload.variant_outcome_scores ?? [],
      );
    }
    return downstreamCache;
  };

  interface GoalTreeBuild {
    byId: Map<string, GoalTreeNode>;
    roots: GoalTreeNode[];
  }
  let goalTreeBuild: GoalTreeBuild | null = null;
  const computeGoalTree = (): GoalTreeBuild => {
    if (goalTreeBuild) return goalTreeBuild;
    const byId = new Map<string, GoalTreeNode>();
    const roots: GoalTreeNode[] = [];
    for (const g of payload.improvement_goals ?? []) {
      byId.set(g.id, { ...g, children: [] });
    }
    for (const g of payload.improvement_goals ?? []) {
      const node = byId.get(g.id)!;
      if (g.parent_goal_id) {
        const parent = byId.get(g.parent_goal_id);
        if (parent) {
          parent.children.push(node);
          continue;
        }
      }
      roots.push(node);
    }
    goalTreeBuild = { byId, roots };
    return goalTreeBuild;
  };

  // ── Resolvers ──────────────────────────────────────────────────────

  const interventionsResolver: Resolver = (selector, ctx) => {
    const appIdFilter = selector?.app_id;
    const statusFilter = selector?.status;
    const targetAppId = appIdFilter === "__self__" ? ctx.app.id : appIdFilter;
    return (payload.interventions ?? []).filter((iv) => {
      if (targetAppId && iv.app_id !== targetAppId) return false;
      if (typeof statusFilter === "string" && iv.status !== statusFilter) return false;
      return true;
    });
  };

  const interventionByIdResolver: Resolver = (selector) => {
    const id = typeof selector?.id === "string" ? selector.id : null;
    if (!id) return null;
    return (payload.interventions ?? []).find((iv) => iv.id === id) ?? null;
  };

  const leverageResolver: Resolver = () => {
    const pts = payload.synthesis?.leverage_points;
    return Array.isArray(pts) ? pts : [];
  };
  const riskResolver: Resolver = () => {
    const pts = payload.synthesis?.risk_points;
    return Array.isArray(pts) ? pts : [];
  };
  const scenariosResolver: Resolver = () => {
    const sc = payload.synthesis?.scenarios;
    return Array.isArray(sc) ? sc : [];
  };
  const actionPlanResolver: Resolver = () => {
    const ap = payload.synthesis?.action_plan;
    return Array.isArray(ap) ? ap : [];
  };

  const strategyBaselineResolver: Resolver = () => payload.strategy_baseline;

  const appStrategyResolver: Resolver = (selector) => {
    const s = payload.app_strategy;
    if (!s || s.status !== "active") return null;
    const section = typeof selector?.section === "string" ? selector.section : null;
    if (!section) return s.spec;
    const spec = s.spec as unknown as Record<string, unknown>;
    return spec[section] ?? null;
  };

  const predictionLedgerResolver: Resolver = (selector, ctx) => {
    const status = typeof selector?.status === "string" ? selector.status : "open";
    const appIdFilter = selector?.app_id;
    const targetAppId = appIdFilter === "__self__" ? ctx.app.id : appIdFilter;
    const trackerFilter = typeof selector?.tracker_id === "string" ? selector.tracker_id : null;
    const agentFilter = typeof selector?.agent_id === "string" ? selector.agent_id : null;
    return (payload.predictions ?? []).filter((p) => {
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
    return (payload.predictions ?? []).filter((p) => {
      if (p.status !== "resolved") return false;
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
    const ts = payload.synthesis?.twin_state;
    return ts && typeof ts === "object" ? ts : null;
  };

  // ── Phase 3 VP Project resolvers ──────────────────────────────────

  const taxonomyResolver: Resolver = () => payload.taxonomy;

  const variantsResolver: Resolver = (selector, ctx) => {
    const appIdFilter = selector?.app_id;
    const targetAppId = appIdFilter === "__self__" ? ctx.app.id : appIdFilter;
    const statusFilter = typeof selector?.status === "string" ? selector.status : null;
    return (payload.variants ?? []).filter((v) => {
      if (targetAppId && v.app_id && v.app_id !== targetAppId) return false;
      if (statusFilter && v.status !== statusFilter) return false;
      return true;
    });
  };

  const activeVariantResolver: Resolver = () => payload.active_variant;

  const downstreamResolver: Resolver = () => computeDownstream();

  const causalChainsResolver: Resolver = (selector) => {
    const raw = (payload.synthesis?.causal_chains ?? []) as CausalChain[];
    const goalId = typeof selector?.goal_id === "string" ? selector.goal_id : null;
    if (!goalId) return raw;
    return raw.filter((c) => c.primary_goal_id === goalId);
  };

  const rankedStrategiesResolver: Resolver = () => {
    const rec = payload.synthesis?.strategic_recommendation as
      | { ranked_strategies?: RankedStrategy[]; recommendation?: unknown }
      | null
      | undefined;
    if (!rec) return [];
    if (Array.isArray(rec.ranked_strategies) && rec.ranked_strategies.length > 0) {
      return rec.ranked_strategies;
    }
    if (rec.recommendation) {
      return [
        {
          rank: 1,
          recommendation: rec.recommendation,
          ranking_rationale:
            "Primary recommendation from synthesis — no alternatives were generated at the time this report was frozen.",
          infrastructure_proposals: [],
          tradeoff_vs_top: null,
        },
      ];
    }
    return [];
  };

  const goalTreeResolver: Resolver = (selector) => {
    const { byId, roots } = computeGoalTree();
    const rootId = typeof selector?.root_id === "string" ? selector.root_id : null;
    if (rootId) return byId.get(rootId) ?? null;
    if (roots.length === 1) return roots[0];
    return roots;
  };

  // ── Batch 8 — frozen node_signatures resolver ──
  //
  // Mirrors the live resolver in app/space/[id]/app/[appId]/page.tsx.
  // Reads from payload.node_signature_entities (optional — old reports
  // simply return [] and the constellation widget renders its empty
  // state). Same selector knobs: min_zoom + entity_id.
  const nodeSignaturesResolver: Resolver = (selector) => {
    const rows = payload.node_signature_entities ?? [];
    const minZoom =
      typeof selector?.min_zoom === "number" ? selector.min_zoom : null;
    const entityId =
      typeof selector?.entity_id === "string" ? selector.entity_id : null;
    const items: Array<{ signature: NonNullable<typeof rows[number]["node_signature"]>; entity_name: string }> = [];
    for (const row of rows) {
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
    app_strategy: appStrategyResolver,
    experiment_taxonomy: taxonomyResolver,
    experiment_variants: variantsResolver,
    experiment_active_variant: activeVariantResolver,
    downstream_reality: downstreamResolver,
    causal_chains: causalChainsResolver,
    ranked_strategies: rankedStrategiesResolver,
    goal_tree: goalTreeResolver,
    node_signatures: nodeSignaturesResolver,
  };
}
