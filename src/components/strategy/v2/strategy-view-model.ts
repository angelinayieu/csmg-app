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
import { paletteSlot, type PaletteSlot } from "./strategy-palette";

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
  /**
   * 0-100 progress against the key_metric target. `undefined` when the
   * metric is qualitative (current/target are non-numeric strings like
   * "high"/"low") or when neither current nor target is set — in that case
   * the UI hides the progress bar instead of rendering 0% as if measured.
   */
  progressPct?: number;
  /**
   * Lead = forward-looking signal; Lag = trailing/measured outcome. `null`
   * when the perspective doesn't carry enough information to call it either
   * way — render the chip ONLY when this is non-null. Defaulting to "lead"
   * when uncertain (the previous behaviour) was misleading.
   */
  tag: "lead" | "lag" | null;
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
  /**
   * Color-coded health status. `undefined` until a downstream tracker has
   * enough data to compute it (post-confirm). Pre-confirm we render a
   * neutral indicator instead of pretending everything is "ok".
   */
  sig?: "ok" | "warn" | "bad";
  trend?: "up" | "down" | "stable";
  /**
   * `true` when `value` is a placeholder ("Baseline", empty, em-dash, etc.)
   * rather than a real measurement. Drives muted rendering + tooltip in
   * ProxyIndicatorList instead of showing the literal placeholder string.
   */
  placeholder?: boolean;
}

/**
 * Subordinate tactical step. Rendered as a small chip beneath the row's
 * primary objective — NOT as a parallel objective card. Promoting actions
 * to objective cards previously caused visual redundancy because action.text
 * frequently paraphrases perspective.objective.
 */
export interface CascadeTactic {
  text: string;
  timeframe?: "now" | "short_term" | "medium_term" | "long_term";
  entityId?: string;
}

export interface CascadeRowVM {
  index: number;                   // 1-indexed, for numbox
  paletteKey: PaletteSlot;
  perspective: StrategyPerspective;
  question: string;                // = perspective.objective
  categoryLabel: string;           // = perspective.name
  /**
   * 0-1 weight for the cascade row's bar. Set ONLY when the LLM provided
   * `key_metric.contribution_to_health` — a real signal. `null` when the
   * value would be a confidence-bucket fallback; the UI shows a confidence
   * chip in that case instead of a fake-precise decimal.
   */
  weight: number | null;
  /** Set when the LLM provided a confidence bucket. Independent of weight. */
  confidence: "high" | "moderate" | "low" | null;
  objectives: CascadeObjective[];
  tactics: CascadeTactic[];
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
  /** Infrastructure proposals that will be materialized as apps on approval.
      Used by the pre-approval app preview to show exactly what gets created. */
  infrastructureProposals: InfrastructureProposal[];
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

  // Convergences live in `interaction_metadata.convergences` (graph-category topology),
  // not top-level — see synthesize/route.ts:1577 and propagate.ts:73 for the canonical path.
  const im = (synthData as unknown as { interaction_metadata?: { convergences?: Array<{ depth?: string }> } })
    ?.interaction_metadata;
  const convergences = im?.convergences;
  const l4Count = convergences?.filter((c) => (c.depth ?? "").toUpperCase() === "L4").length ?? 0;

  const hubCount =
    reasoningTrace?.diagnosis?.graph_insights?.hub_entities?.length ?? 0;
  const tracedChainCount = causalChains.filter((c) => !!c.calculation_trace_id).length;
  // The trace is the 3-stage diagnose → synthesize → verify chain (see
  // src/types/strategy-reasoning.ts:157). Count the steps that actually
  // produced output instead of always reporting `1` — that hardcoded value
  // made the chip purely cosmetic.
  const iterationCount = reasoningTrace
    ? [reasoningTrace.diagnosis, reasoningTrace.synthesis, reasoningTrace.verification].filter(
        Boolean,
      ).length
    : 0;

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

// Derive perspective weight from the LLM's contribution_to_health (0-100).
// Returns null when no real signal is available — the UI then shows a
// confidence chip instead of a fake-precise decimal derived from the bucket.
// (The previous fallback returned 0.85/0.7/0.5 from confidence bucket which
// rendered as e.g. "0.70" with two-decimal precision — fake rigor.)
function deriveWeight(p: StrategyPerspective): number | null {
  const c = p.key_metric?.contribution_to_health;
  if (typeof c === "number" && c >= 0) {
    return Math.max(0.2, Math.min(1, c / 100));
  }
  return null;
}

function deriveConfidence(
  p: StrategyPerspective,
): "high" | "moderate" | "low" | null {
  if (p.confidence === "high" || p.confidence === "moderate" || p.confidence === "low") {
    return p.confidence;
  }
  return null;
}

function leadLagFromTimeframe(tf: string | undefined): "lead" | "lag" | null {
  if (tf === "now" || tf === "short_term") return "lead";
  if (tf === "medium_term" || tf === "long_term") return "lag";
  return null;
}

// Lead vs Lag — only assign when the perspective gives us a real signal:
//   - explicit key_metric.trend_direction → "lead" (we're tracking direction)
//   - first action timeframe = now/short_term → "lead" (forward-looking work)
//   - first action timeframe = medium/long_term → "lag" (trailing outcome)
//   - neither → null (the row's badge is hidden rather than faking a value)
// The previous heuristic mapped any perspective whose color-slot landed on
// "finance" to "lag", which was both arbitrary and dependent on the now-dead
// regex name-mapper in strategy-palette.ts.
function deriveLeadLag(p: StrategyPerspective): "lead" | "lag" | null {
  if (p.key_metric?.trend_direction) return "lead";
  return leadLagFromTimeframe(p.actions?.[0]?.timeframe);
}

// True when a metric value is a placeholder (LLM-emitted "Baseline" /
// "TBD" / em-dash / empty) rather than a real measurement. Used to suppress
// nonsense progress strings like "Baseline → 95%" and to mute the proxy
// rendering for unmeasured metrics.
const PLACEHOLDER_VALUES = new Set([
  "",
  "—",
  "-",
  "n/a",
  "na",
  "tbd",
  "baseline",
  "current",
  "current value",
  "unknown",
]);
function isPlaceholderValue(v: string | undefined | null): boolean {
  if (v == null) return true;
  return PLACEHOLDER_VALUES.has(v.trim().toLowerCase());
}

function objectiveProgress(p: StrategyPerspective): number | undefined {
  const km = p.key_metric;
  if (!km) return undefined;
  const current = parseFirstNumber(km.current);
  const target = parseFirstNumber(km.target);
  // Qualitative metrics ("high" / "low") yield null and we return undefined
  // so the UI can render the qualitative valueLabel instead of a bogus 0%.
  if (current === null || target === null || target === 0) return undefined;
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
  const paletteKey = paletteSlot(i);
  const weight = deriveWeight(p);
  const confidence = deriveConfidence(p);
  const leadLag = deriveLeadLag(p);
  const progress = objectiveProgress(p);

  // Primary objective = the perspective's key_metric aspiration
  const primaryId = `p${i + 1}-obj-primary`;
  const matchedChain = findMatchingChain(p, causalChains, recommendation.improvement_goal_id);

  const objectives: CascadeObjective[] = [];
  if (p.key_metric) {
    // Only render the value label when at least one side is a real number,
    // so we don't ship "Baseline → 95%" or "Baseline → Baseline" as a metric.
    const km = p.key_metric;
    const kmCurrentReal = !isPlaceholderValue(km.current);
    const kmTargetReal = !isPlaceholderValue(km.target);
    const kmUnit = km.unit ? ` ${km.unit}` : "";
    let kmValueLabel: string | undefined;
    if (kmCurrentReal && kmTargetReal) {
      kmValueLabel = `${km.current} → ${km.target}${kmUnit}`;
    } else if (kmTargetReal) {
      kmValueLabel = `Target: ${km.target}${kmUnit}`;
    } else if (kmCurrentReal) {
      kmValueLabel = `${km.current}${kmUnit}`;
    }

    objectives.push({
      id: primaryId,
      title: p.objective ?? p.key_metric.name,
      progressPct: progress,
      tag: leadLag,
      valueLabel: kmValueLabel,
      description: p.rationale,
      matchedChainId: matchedChain?.id,
      sourceEntityIds: [
        ...(p.supporting_entities ?? []),
        ...(p.entity_refs ?? []),
      ],
      timeframe: p.actions?.[0]?.timeframe,
    });
  }

  // Actions become subordinate tactic chips, not parallel objective cards.
  // Exception: when the perspective has no key_metric, promote the first
  // action so the row isn't empty — the remaining actions still ship as chips.
  const allActions = p.actions ?? [];
  let tacticActions = allActions;
  if (objectives.length === 0 && allActions.length > 0) {
    const a = allActions[0];
    objectives.push({
      id: `p${i + 1}-obj-fallback`,
      title: a.text,
      progressPct: undefined,
      tag: leadLagFromTimeframe(a.timeframe),
      description: a.infrastructure_note,
      matchedChainId: matchedChain?.id,
      sourceEntityIds: a.entity_id ? [a.entity_id] : [],
      timeframe: a.timeframe,
    });
    tacticActions = allActions.slice(1);
  }

  const tactics: CascadeTactic[] = tacticActions.slice(0, 4).map((a) => ({
    text: a.text,
    timeframe: a.timeframe,
    entityId: a.entity_id,
  }));

  // Proxies: key_metric + micro_tactics whose macro_link points at this
  // perspective. `sig` is intentionally undefined — there's no metric_tracker
  // posterior in hand here to compute ok/warn/bad against, and hardcoding
  // "ok" was a structural lie. Once trackers feed into this builder, set sig
  // from the latest observation vs target delta.
  //
  // Linking: prefer exact match on perspective.id or .name. The legacy
  // first-word substring match remains as a final fallback (older snapshots
  // shipped macro_link as a free-form phrase) but it's gated on length to
  // avoid matching tiny words ("a", "is").
  //
  // Dedup by lowercased name — without this, key_metric and a tactic.metric
  // sharing a name produced the "two identical rows" symptom (e.g. two
  // 'Reminder Efficiency 70%' entries) on the cascade.
  const proxies: CascadeProxy[] = [];
  const seenProxy = new Set<string>();
  const pushProxy = (proxy: CascadeProxy) => {
    const key = proxy.name.trim().toLowerCase();
    if (!key || seenProxy.has(key)) return;
    seenProxy.add(key);
    proxies.push(proxy);
  };
  if (p.key_metric) {
    const isPh = isPlaceholderValue(p.key_metric.current);
    pushProxy({
      name: p.key_metric.name,
      value: isPh ? "—" : p.key_metric.current,
      unit: p.key_metric.unit,
      trend: p.key_metric.trend_direction,
      placeholder: isPh || undefined,
    });
  }
  const relevantTactics = (recommendation.micro_tactics ?? []).filter((t) => {
    const link = (t.macro_link ?? "").toLowerCase().trim();
    if (!link) return false;
    if (p.id && link === p.id.toLowerCase()) return true;
    if (p.name && link === p.name.toLowerCase()) return true;
    const firstWord = (p.name ?? "").toLowerCase().split(/\s+/)[0] ?? "";
    return firstWord.length > 3 && link.includes(firstWord);
  });
  for (const t of relevantTactics) {
    if (!t.metric) continue;
    if (proxies.length >= 4 + (p.key_metric ? 1 : 0)) break;
    const rawValue =
      t.metric.current_value !== undefined ? String(t.metric.current_value) : t.metric.target;
    const isPh = isPlaceholderValue(rawValue);
    pushProxy({
      name: t.metric.name,
      value: isPh ? "—" : rawValue,
      unit: t.metric.unit,
      trend: t.metric.trend,
      placeholder: isPh || undefined,
    });
  }

  return {
    index: i + 1,
    paletteKey,
    perspective: p,
    question: p.objective ?? "",
    categoryLabel: p.name,
    weight,
    confidence,
    objectives,
    tactics,
    proxies,
    proxyCount: proxies.length,
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
    infrastructureProposals: rs.infrastructure_proposals ?? [],
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
