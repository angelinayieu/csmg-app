// Strategy view-model derivations — pure functions, no React.
// Merges StrategicRecommendation + CausalChains + Entities + goals into shapes the UI consumes.

import type { Entity } from "@/types";
import type {
  StrategicRecommendation,
  StrategyPerspective,
  MicroTactic,
  RankedStrategy,
  InfrastructureMap,
  InfrastructureProposal,
} from "@/types/strategy";
import type { StrategyReasoningTrace } from "@/types/strategy-reasoning";
import type { CausalChain } from "@/types/causal-chains";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import { perspectiveKey, type PerspectiveKey } from "./strategy-palette";

// ── Hero ──

export interface HeroProvenance {
  kg: { entities: number; hubs: number };
  convergence: { count: number; l4Count: number };
  chains: { count: number; traced: number };
  trace: { present: boolean; iterationCount: number };
}

export interface HeroMetrics {
  confidence: number;              // 0-100
  targetMetric: {
    name: string;
    current: string;
    target: string;
    unit?: string;
  } | null;
  alternativesCount: number;
  perspectivesCount: number;
  microTacticsCount: number;
}

export interface HeroVM {
  title: string;
  summary: string;
  posture: string;
  postureLabel: string;           // human-readable
  confidence: number;
  spaceName: string;
  provenance: HeroProvenance;
  metrics: HeroMetrics;
}

// ── Cascade ──

export interface CascadeObjective {
  id: string;
  title: string;
  progressPct: number;             // 0-100
  tag: "lead" | "lag";
  valueLabel?: string;
  description?: string;
  matchedChainId?: string;         // for mechanism expansion
  sourceEntityIds: string[];
  timeframe?: string;
}

export interface CascadeProxy {
  name: string;
  value: string;
  unit?: string;
  sig: "ok" | "warn" | "bad";
  trend?: "up" | "down" | "stable";
}

export interface CascadeRowVM {
  index: number;                   // 1-indexed, for numbox
  paletteKey: PerspectiveKey;
  perspective: StrategyPerspective;
  question: string;                // = perspective.objective
  categoryLabel: string;           // = perspective.name
  weight: number;                  // 0-1, for the weight bar
  objectives: CascadeObjective[];
  proxies: CascadeProxy[];
  proxyCount: number;              // total, may exceed proxies.length
}

// ── Variants ──

export interface VariantVM {
  rank: number;
  id: string;
  title: string;
  approach: string;                // short description
  tradeoff?: string | null;
  impact: { display: string; numeric: number };
  risk: { display: string; level: "low" | "med" | "high" };
  roi: { display: string; quarter?: string };
  crown: boolean;
  recommendation: StrategicRecommendation;
  rankingRationale: string;
}

// ── Flowchart (variant detail) ──

export interface FlowNode {
  id: string;
  column: "driver" | "rule" | "action" | "outcome" | "proxy";
  title: string;
  sub?: string;
  entityId?: string;
  sourceId?: string;               // for click-through (chain id, tactic id, etc.)
  highlight?: boolean;
}

export interface FlowEdge {
  from: string;                    // node id
  to: string;
  tint?: "accent" | "success";
}

export interface FlowchartVM {
  drivers: FlowNode[];
  rules: FlowNode[];
  actions: FlowNode[];
  outcomes: FlowNode[];
  proxies: FlowNode[];
  edges: FlowEdge[];
}

// ── Main view model ──

export interface StrategyVM {
  hero: HeroVM;
  cascade: CascadeRowVM[];
  bridge: { variantCount: number };
  variants: VariantVM[];
  topVariant: VariantVM | null;
  infrastructure?: {
    map: InfrastructureMap | undefined;
    proposals: InfrastructureProposal[];
  };
}

// ── Builders ──

const POSTURE_LABELS: Record<string, string> = {
  aggressive_growth: "Aggressive Growth",
  cautious_validation: "Cautious Validation",
  pivot_exploration: "Pivot Exploration",
  consolidation: "Consolidation",
  defensive: "Defensive",
};

export function buildHeroVM(args: {
  recommendation: StrategicRecommendation;
  reasoningTrace?: StrategyReasoningTrace | null;
  synthData: SynthesisData | null;
  entityCount: number;
  causalChains: CausalChain[];
  spaceName: string;
  alternativesCount: number;
}): HeroVM {
  const { recommendation: rec, reasoningTrace, synthData, entityCount, causalChains, spaceName, alternativesCount } = args;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convergences = (synthData as any)?.convergences as Array<{ depth?: string }> | undefined;
  const l4Count = convergences?.filter((c) => (c.depth ?? "").toUpperCase() === "L4").length ?? 0;

  const hubCount =
    reasoningTrace?.diagnosis?.graph_insights?.hub_entities?.length ?? 0;
  const tracedChainCount = causalChains.filter((c) => !!c.calculation_trace_id).length;
  // StrategyReasoningTrace has no iteration list in the current shape; use presence as a proxy.
  const iterationCount = reasoningTrace ? 1 : 0;

  const tgt = rec.target_objective;
  const targetMetric = tgt
    ? {
        name: tgt.metric ?? tgt.title ?? "target",
        current: String(tgt.current ?? "—"),
        target: String(tgt.target ?? "—"),
        unit: undefined as string | undefined,
      }
    : null;

  return {
    title: rec.title,
    summary: rec.summary ?? "",
    posture: rec.strategic_posture,
    postureLabel: POSTURE_LABELS[rec.strategic_posture] ?? rec.strategic_posture,
    confidence: rec.confidence ?? 0,
    spaceName,
    provenance: {
      kg: { entities: entityCount, hubs: hubCount },
      convergence: { count: convergences?.length ?? 0, l4Count },
      chains: { count: causalChains.length, traced: tracedChainCount },
      trace: { present: !!reasoningTrace, iterationCount },
    },
    metrics: {
      confidence: rec.confidence ?? 0,
      targetMetric,
      alternativesCount,
      perspectivesCount: rec.perspectives.length,
      microTacticsCount: (rec.micro_tactics ?? []).length,
    },
  };
}

// Derive perspective weight 0-1.  contribution_to_health is 0-100; confidence bucket if missing.
function deriveWeight(p: StrategyPerspective): number {
  const c = p.key_metric?.contribution_to_health;
  if (typeof c === "number" && c >= 0) return Math.max(0.2, Math.min(1, c / 100));
  switch (p.confidence) {
    case "high":
      return 0.85;
    case "moderate":
      return 0.7;
    case "low":
      return 0.5;
    default:
      return 0.7;
  }
}

// Lead vs Lag: leading indicators trend, lagging measure past state.
// Heuristic: if key_metric has trend_direction, it's lead; if action.timeframe is long, lag.
function deriveLeadLag(p: StrategyPerspective, i: number): "lead" | "lag" {
  if (p.key_metric?.trend_direction) return "lead";
  // Finance is typically lagging, customers/internal/learning lead
  const key = perspectiveKey(p.name, i);
  return key === "finance" ? "lag" : "lead";
}

function objectiveProgress(p: StrategyPerspective): number {
  const km = p.key_metric;
  if (!km) return 0;
  const current = parseFirstNumber(km.current);
  const target = parseFirstNumber(km.target);
  if (current === null || target === null || target === 0) return 0;
  const pct = (current / target) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

function parseFirstNumber(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  return parseFloat(m[0]);
}

/**
 * Match a strategy perspective to a causal chain.
 *
 * Phase 3: prefer chains that share the active goal id with the strategy, then
 * fall back to entity overlap. The goal-first preference prevents accidental
 * matches when two chains share entities but serve different objectives.
 */
function findMatchingChain(
  p: StrategyPerspective,
  causalChains: CausalChain[],
  activeGoalId?: string | null,
): CausalChain | null {
  const refs = new Set(
    [...(p.supporting_entities ?? []), ...(p.entity_refs ?? [])].filter(Boolean),
  );

  // Preferred: chain serving the same goal AND touching this perspective's entities.
  if (activeGoalId) {
    for (const chain of causalChains) {
      if (chain.primary_goal_id !== activeGoalId) continue;
      for (const eid of chain.entity_ids) {
        if (refs.has(eid)) return chain;
      }
    }
    // Same goal but no entity overlap — still preferable to a different-goal chain.
    const goalOnly = causalChains.find((c) => c.primary_goal_id === activeGoalId);
    if (goalOnly) return goalOnly;
  }

  // Fallback: entity overlap regardless of goal (legacy behaviour).
  for (const chain of causalChains) {
    for (const eid of chain.entity_ids) {
      if (refs.has(eid)) return chain;
    }
  }
  return null;
}

export function buildCascadeRow(
  p: StrategyPerspective,
  i: number,
  recommendation: StrategicRecommendation,
  causalChains: CausalChain[],
): CascadeRowVM {
  const paletteKey = perspectiveKey(p.name, i);
  const weight = deriveWeight(p);
  const leadLag = deriveLeadLag(p, i);
  const progress = objectiveProgress(p);

  // Primary objective = the perspective's key_metric aspiration
  const primaryId = `p${i + 1}-obj-primary`;
  const matchedChain = findMatchingChain(p, causalChains, recommendation.improvement_goal_id);

  const objectives: CascadeObjective[] = [];
  if (p.key_metric) {
    objectives.push({
      id: primaryId,
      title: p.objective ?? p.key_metric.name,
      progressPct: progress,
      tag: leadLag,
      valueLabel:
        p.key_metric.current && p.key_metric.target
          ? `${p.key_metric.current} → ${p.key_metric.target}${p.key_metric.unit ? ` ${p.key_metric.unit}` : ""}`
          : undefined,
      description: p.rationale,
      matchedChainId: matchedChain?.id,
      sourceEntityIds: [
        ...(p.supporting_entities ?? []),
        ...(p.entity_refs ?? []),
      ],
      timeframe: p.actions?.[0]?.timeframe,
    });
  }

  // Secondary objectives derived from actions (one row per action, up to 2)
  const actionObjs: CascadeObjective[] = (p.actions ?? []).slice(0, 3).map((a, ai) => ({
    id: `p${i + 1}-obj-action-${ai}`,
    title: a.text,
    progressPct: 0, // actions start at 0
    tag: a.timeframe === "long_term" || a.timeframe === "medium_term" ? "lag" : "lead",
    description: a.infrastructure_note,
    matchedChainId: matchedChain?.id,
    sourceEntityIds: a.entity_id ? [a.entity_id] : [],
    timeframe: a.timeframe,
  }));

  // Prefer action-based objectives when key_metric absent
  const combined = [...objectives, ...actionObjs].slice(0, 3);

  // Proxies: key_metric + all micro_tactics whose macro_link matches this perspective
  const proxies: CascadeProxy[] = [];
  if (p.key_metric) {
    proxies.push({
      name: p.key_metric.name,
      value: p.key_metric.current,
      unit: p.key_metric.unit,
      sig: "ok",
      trend: p.key_metric.trend_direction,
    });
  }
  const relevantTactics = (recommendation.micro_tactics ?? []).filter((t) =>
    (t.macro_link ?? "").toLowerCase().includes((p.name ?? "").toLowerCase().split(" ")[0] ?? ""),
  );
  for (const t of relevantTactics.slice(0, 4)) {
    if (!t.metric) continue;
    proxies.push({
      name: t.metric.name,
      value:
        t.metric.current_value !== undefined ? String(t.metric.current_value) : t.metric.target,
      unit: t.metric.unit,
      sig: "ok",
      trend: t.metric.trend,
    });
  }

  return {
    index: i + 1,
    paletteKey,
    perspective: p,
    question: p.objective ?? "",
    categoryLabel: p.name,
    weight,
    objectives: combined,
    proxies,
    proxyCount: proxies.length + Math.max(0, relevantTactics.length - 4),
  };
}

// ── Variants ──

function severityScore(level: string | undefined): number {
  switch (level) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function computeVariantImpact(rec: StrategicRecommendation): {
  display: string;
  numeric: number;
} {
  // impact ≈ target delta × confidence/100
  const tgt = rec.target_objective;
  if (tgt && tgt.current !== undefined && tgt.target !== undefined) {
    const c = parseFirstNumber(String(tgt.current));
    const t = parseFirstNumber(String(tgt.target));
    if (c !== null && t !== null) {
      const delta = t - c;
      const signed = delta * (rec.confidence / 100);
      // StrategyTargetObjective has no unit field; infer a coarse suffix from the metric label.
      const unit = /percent|%|pp/i.test(tgt.metric ?? "") ? "%" : "pp";
      return {
        display: `${signed >= 0 ? "+" : ""}${signed.toFixed(1)}${unit}`,
        numeric: signed,
      };
    }
  }
  return { display: `${rec.confidence}%`, numeric: rec.confidence };
}

function computeVariantRisk(rec: StrategicRecommendation): {
  display: string;
  level: "low" | "med" | "high";
} {
  const pm = rec.pre_mortem ?? [];
  const maxSev = Math.max(0, ...pm.map((p) => severityScore(p.severity)));
  if (maxSev >= 3) return { display: "High", level: "high" };
  if (maxSev >= 2) return { display: "Med", level: "med" };
  return { display: "Low", level: "low" };
}

function computeVariantROI(rec: StrategicRecommendation): {
  display: string;
  quarter?: string;
} {
  const tp = rec.temporal_phases ?? [];
  const first = tp.find((p) => p.label?.toLowerCase().includes("now") || p.label?.toLowerCase().includes("short"))
    ?? tp[0];
  if (first?.label) return { display: first.label.split(" ")[0] ?? first.label, quarter: first.label };
  return { display: "—" };
}

export function buildVariantVM(rs: RankedStrategy, isTop: boolean): VariantVM {
  const rec = rs.recommendation;
  return {
    rank: rs.rank,
    id: `variant-${rs.rank}`,
    title: rec.title,
    approach: rec.summary ?? rs.ranking_rationale,
    tradeoff: rs.tradeoff_vs_top,
    impact: computeVariantImpact(rec),
    risk: computeVariantRisk(rec),
    roi: computeVariantROI(rec),
    crown: isTop,
    recommendation: rec,
    rankingRationale: rs.ranking_rationale,
  };
}

// ── Flowchart ──

export function buildFlowchart(
  rec: StrategicRecommendation,
  causalChains: CausalChain[],
  entityMap: Map<string, Entity>,
): FlowchartVM {
  const drivers: FlowNode[] = [];
  const rules: FlowNode[] = [];
  const actions: FlowNode[] = [];
  const outcomes: FlowNode[] = [];
  const proxies: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // Drivers: L4 stage titles from causal chains (up to 4)
  const chainSeeds = causalChains.slice(0, 4);
  for (const chain of chainSeeds) {
    const seed = chain.stages[0];
    drivers.push({
      id: `d-${chain.id}`,
      column: "driver",
      title: seed?.title ?? chain.name,
      sub: "L4 TRUTH",
      entityId: seed?.entity_id ?? undefined,
      sourceId: chain.id,
    });
  }
  if (drivers.length === 0) {
    // fallback: use supporting_entities from perspectives
    const seen = new Set<string>();
    for (const p of rec.perspectives) {
      for (const eid of p.supporting_entities ?? []) {
        if (seen.has(eid)) continue;
        seen.add(eid);
        const e = entityMap.get(eid);
        drivers.push({
          id: `d-${eid}`,
          column: "driver",
          title: e?.name ?? eid,
          sub: e?.entity_category ?? "driver",
          entityId: eid,
          sourceId: eid,
        });
        if (drivers.length >= 4) break;
      }
      if (drivers.length >= 4) break;
    }
  }

  // Rules = micro_tactics with infrastructure_action != null (up to 4)
  const ruleTactics = (rec.micro_tactics ?? [])
    .filter((t) => !!t.infrastructure_action)
    .slice(0, 4);
  ruleTactics.forEach((t, i) => {
    rules.push({
      id: `r-${t.id}`,
      column: "rule",
      title: t.title.length > 40 ? t.title.slice(0, 37) + "…" : t.title,
      sub: `R-${String(i + 1).padStart(3, "0")} · ${t.infrastructure_action?.toUpperCase()}`,
      entityId: t.entity_id,
      sourceId: t.id,
    });
  });

  // Actions = micro_tactics (titles + timeframes), up to 5
  const actionTactics = (rec.micro_tactics ?? []).slice(0, 5);
  actionTactics.forEach((t) => {
    actions.push({
      id: `a-${t.id}`,
      column: "action",
      title: t.title.length > 40 ? t.title.slice(0, 37) + "…" : t.title,
      sub: t.timeframe?.toUpperCase().replace(/_/g, " "),
      entityId: t.entity_id,
      sourceId: t.id,
    });
  });

  // Outcomes = causal_chain outcome stage OR perspective.key_metric.target
  chainSeeds.forEach((chain) => {
    const out = chain.stages[4];
    if (!out) return;
    outcomes.push({
      id: `o-${chain.id}`,
      column: "outcome",
      title: out.title.length > 40 ? out.title.slice(0, 37) + "…" : out.title,
      sub: "MEASURED",
      entityId: out.entity_id ?? undefined,
      sourceId: chain.id,
    });
  });
  if (outcomes.length === 0) {
    rec.perspectives.forEach((p, i) => {
      if (!p.key_metric) return;
      outcomes.push({
        id: `o-persp-${i}`,
        column: "outcome",
        title: `${p.key_metric.name} → ${p.key_metric.target}`,
        sub: "TARGET",
      });
    });
  }

  // Proxies = key_metrics + micro_tactic metrics, up to 5
  const seenProxy = new Set<string>();
  for (const p of rec.perspectives) {
    if (!p.key_metric) continue;
    const id = `px-persp-${p.key_metric.name}`;
    if (seenProxy.has(id)) continue;
    seenProxy.add(id);
    proxies.push({
      id,
      column: "proxy",
      title: p.key_metric.name,
      sub: `${p.key_metric.current}${p.key_metric.unit ?? ""}`,
    });
    if (proxies.length >= 5) break;
  }
  for (const t of rec.micro_tactics ?? []) {
    if (!t.metric) continue;
    const id = `px-tactic-${t.id}`;
    if (seenProxy.has(id)) continue;
    seenProxy.add(id);
    proxies.push({
      id,
      column: "proxy",
      title: t.metric.name,
      sub: t.metric.target,
    });
    if (proxies.length >= 5) break;
  }

  // Edges (simple fan-out)
  drivers.forEach((d) => {
    rules.forEach((r) => edges.push({ from: d.id, to: r.id, tint: "accent" }));
  });
  rules.forEach((r, ri) => {
    const action = actions[ri] ?? actions[0];
    if (action) edges.push({ from: r.id, to: action.id, tint: "accent" });
  });
  actions.forEach((a, ai) => {
    const out = outcomes[ai] ?? outcomes[0];
    if (out) edges.push({ from: a.id, to: out.id, tint: "accent" });
  });
  outcomes.forEach((o, oi) => {
    const px = proxies[oi] ?? proxies[0];
    if (px) edges.push({ from: o.id, to: px.id, tint: "success" });
  });

  return { drivers, rules, actions, outcomes, proxies, edges };
}

export function buildStrategyVM(args: {
  recommendation: StrategicRecommendation;
  rankedStrategies: RankedStrategy[];
  reasoningTrace?: StrategyReasoningTrace | null;
  causalChains: CausalChain[];
  synthData: SynthesisData | null;
  entityCount: number;
  spaceName: string;
}): StrategyVM {
  const {
    recommendation,
    rankedStrategies,
    reasoningTrace,
    causalChains,
    synthData,
    entityCount,
    spaceName,
  } = args;

  const hero = buildHeroVM({
    recommendation,
    reasoningTrace,
    synthData,
    entityCount,
    causalChains,
    spaceName,
    alternativesCount: Math.max(0, rankedStrategies.length - 1),
  });

  const cascade = recommendation.perspectives.map((p, i) =>
    buildCascadeRow(p, i, recommendation, causalChains),
  );

  const variantSource =
    rankedStrategies.length > 0
      ? rankedStrategies
      : // synthesize a single variant from the confirmed recommendation
        [
          {
            rank: 1,
            recommendation,
            ranking_rationale: "Primary strategy",
            infrastructure_proposals: [],
            tradeoff_vs_top: null,
          } as RankedStrategy,
        ];

  const variants = variantSource
    .slice(0, 3)
    .map((rs, i) => buildVariantVM(rs, i === 0));

  const infraMap = recommendation.infrastructure_map;
  const infraProposals = (variantSource[0]?.infrastructure_proposals ?? []) as InfrastructureProposal[];
  const hasInfra =
    !!infraMap &&
    ((infraMap.core_components?.length ?? 0) > 0 ||
      (infraMap.key_channels?.length ?? 0) > 0 ||
      (infraMap.activated_loops?.length ?? 0) > 0);
  const infrastructure =
    hasInfra || infraProposals.length > 0
      ? { map: infraMap, proposals: infraProposals }
      : undefined;

  return {
    hero,
    cascade,
    bridge: { variantCount: variants.length },
    variants,
    topVariant: variants[0] ?? null,
    infrastructure,
  };
}
