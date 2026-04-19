"use client";

import { useMemo } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { computeTwinState, computeEntityHealthContributions } from "@/lib/twin/compute-twin-state";
import type { SynthesisData } from "@/types/synthesis";
import type {
  OperatingTwinModel,
  LabCard,
  LabCategory,
  LabMode,
  LabSourceType,
  LabStatus,
  LabMetric,
  ActiveFrame,
  ApprovalItem,
  InsightItem,
  ServiceConnection,
  SystemPulseState,
  TwinIdentity,
  DataSufficiencyReport,
  TrendDirection,
} from "@/types/operating-twin";

const MAX_LABS = 10;

// ── Helpers ──

function parseSynthesisData(raw: unknown): SynthesisData | null {
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as SynthesisData;
  } catch {
    return null;
  }
}

function daysBetween(iso: string | null | undefined): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  const diff = Date.now() - then;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function timeAgoLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMin = Math.floor((Date.now() - then) / (1000 * 60));
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

function contributionToStatus(contribution: number, isRisk: boolean): LabStatus {
  if (isRisk && contribution < -3) return "critical";
  if (contribution < -1) return "warning";
  if (contribution > 2) return "healthy";
  return "idle";
}

function sizeFromContribution(absContribution: number): "xl" | "l" | "m" | "s" {
  if (absContribution >= 20) return "xl";
  if (absContribution >= 10) return "l";
  if (absContribution >= 4) return "m";
  return "s";
}

// ── Main hook ──

export function useOperatingTwinData(): OperatingTwinModel {
  const ctx = useSpaceData();

  return useMemo(() => {
    const synthData = parseSynthesisData(ctx.space.synthesis_data);

    // Compute twin state (reuse existing logic)
    const twinState = computeTwinState(
      ctx.space,
      ctx.entities,
      ctx.edges,
      ctx.cycles,
      synthData,
      ctx.activeGoal ?? null,
      [], // recommendations not needed here
    );

    const contributions = computeEntityHealthContributions(ctx.entities, ctx.cycles);

    // ── Identity ──
    const identity: TwinIdentity = {
      name: ctx.space.name,
      avatar_letter: (ctx.space.name || "S").trim().charAt(0).toUpperCase(),
      day_count: daysBetween(ctx.space.created_at),
      label: twinState.macro.health_label,
      total_labs: 0, // filled in below after lab computation
      total_atoms: ctx.entities.length,
      total_claims: (ctx.claims?.length ?? 0) + (ctx.propositions?.length ?? 0),
    };

    // ── Build labs ──

    const labs: LabCard[] = [];
    const usedEntityIds = new Set<string>();

    // Strategy recommendation (might contain perspectives with richer data)
    const strategicRec = (synthData as unknown as Record<string, unknown>)
      ?.strategic_recommendation as Record<string, unknown> | undefined;
    const perspectives = (strategicRec?.perspectives ?? []) as Array<Record<string, unknown>>;

    // 1. Strategy perspectives → Lab cards
    for (const p of perspectives) {
      const keyMetric = (p?.key_metric ?? {}) as Record<string, unknown>;
      const trendDirection = (keyMetric?.trend_direction as TrendDirection) ?? "unknown";
      const contributionHealth = typeof keyMetric?.contribution_to_health === "number"
        ? (keyMetric.contribution_to_health as number)
        : 0;

      const currentVal = keyMetric?.current;
      const targetVal = keyMetric?.target;
      const metricName = (keyMetric?.name as string) ?? "metric";

      const primaryMetric: LabMetric = {
        label: metricName,
        value: currentVal != null ? String(currentVal) : "—",
        target: targetVal != null ? String(targetVal) : undefined,
        trend: trendDirection,
        trend_delta: keyMetric?.trend_delta as string | undefined,
      };

      const entityRefs = (p?.entity_refs ?? []) as string[];
      labs.push({
        id: `perspective-${(p?.id as string) ?? labs.length}`,
        name: (p?.name as string) ?? "Perspective",
        category: "perspective" as LabCategory,
        description: p?.rationale as string | undefined,
        mode: "lab" as LabMode,
        metrics: [primaryMetric],
        contribution_pct: Math.round(contributionHealth),
        contribution_abs: Math.abs(contributionHealth),
        confidence: typeof p?.confidence === "number" ? (p.confidence as number) / 100 : 0.7,
        status: contributionToStatus(contributionHealth, false),
        entity_ids: entityRefs,
        primary_entity_id: entityRefs[0] ?? null,
        source_type: "strategy_perspective" as LabSourceType,
        source_id: (p?.id as string) ?? `p-${labs.length}`,
      });
    }

    // 2. Leverage points → Lab cards
    const leveragePoints = synthData?.leverage_points ?? [];
    for (const lp of leveragePoints) {
      if (labs.length >= MAX_LABS) break;
      const entity = ctx.entities.find(
        (e) => e.id === lp.entity_id || e.entity_id === lp.entity_id,
      );
      if (!entity) continue;
      if (usedEntityIds.has(entity.id)) continue;
      usedEntityIds.add(entity.id);

      const contrib = contributions.get(entity.id);
      const contribValue = contrib?.contribution ?? 0;

      const primaryMetric: LabMetric = {
        label: "centrality",
        value: String(entity.centrality_rank ?? "—"),
        trend: contribValue > 0 ? "up" : contribValue < 0 ? "down" : "stable",
        trend_delta: contribValue !== 0
          ? `${contribValue > 0 ? "↑" : "↓"} ${Math.abs(contribValue).toFixed(1)}`
          : undefined,
      };

      labs.push({
        id: `leverage-${entity.id}`,
        name: entity.name,
        category: "leverage",
        description: lp.summary ?? undefined,
        mode: "lab",
        metrics: [primaryMetric],
        contribution_pct: Math.round(contribValue * 5), // scale up a bit for visual weight
        contribution_abs: Math.abs(contribValue * 5),
        confidence: entity.confidence ?? 0.7,
        status: contribValue > 2 ? "healthy" : "idle",
        entity_ids: [entity.id],
        primary_entity_id: entity.id,
        source_type: "leverage_point",
        source_id: entity.id,
      });
    }

    // 3. Child goals (sub-objectives of active goal) → Lab cards
    const childGoals = ctx.childGoals ?? [];
    for (const child of childGoals) {
      if (labs.length >= MAX_LABS) break;
      const range = Number(child.target_value) - Number(child.baseline_value);
      const progress = Number(child.current_value) - Number(child.baseline_value);
      const pct = range !== 0 ? Math.round((progress / range) * 100) : 0;

      const primaryMetric: LabMetric = {
        label: child.metric_name ?? "progress",
        value: `${pct}%`,
        target: `${Number(child.target_value)} ${child.metric_unit ?? ""}`.trim(),
        trend: pct > 0 ? "up" : "stable",
        trend_delta: pct > 0 ? `↑ ${pct}%` : undefined,
      };

      labs.push({
        id: `goal-${child.id}`,
        name: child.title,
        category: "objective",
        description: child.description ?? undefined,
        mode: "tracker",
        metrics: [primaryMetric],
        contribution_pct: Math.min(15, Math.max(-5, Math.round(pct / 6))),
        contribution_abs: Math.min(15, Math.abs(pct / 6)),
        confidence: 0.8,
        status: child.status === "achieved" ? "healthy" : pct > 50 ? "healthy" : "idle",
        entity_ids: [],
        source_type: "goal",
        source_id: child.id,
      });
    }

    // 4. High blast-radius risk points → Lab cards (warning style)
    const riskEntities = ctx.entities.filter((e) => e.is_risk_point);
    const totalEntities = ctx.entities.length || 1;
    const criticalThreshold = totalEntities * 0.3;
    const criticalRisks = riskEntities
      .filter((e) => (e.blast_radius ?? 0) > criticalThreshold)
      .sort((a, b) => (b.blast_radius ?? 0) - (a.blast_radius ?? 0));

    for (const risk of criticalRisks) {
      if (labs.length >= MAX_LABS) break;
      if (usedEntityIds.has(risk.id)) continue;
      usedEntityIds.add(risk.id);

      const blastPct = Math.round(((risk.blast_radius ?? 0) / totalEntities) * 100);
      const contrib = contributions.get(risk.id);
      const contribValue = contrib?.contribution ?? -3;

      const primaryMetric: LabMetric = {
        label: "blast radius",
        value: `${blastPct}%`,
        trend: "down",
        trend_delta: `↓ ${Math.round(Math.abs(contribValue))} pts`,
      };

      labs.push({
        id: `risk-${risk.id}`,
        name: risk.name,
        category: "risk",
        description: `${blastPct}% system impact if failure occurs`,
        mode: "tracker",
        metrics: [primaryMetric],
        contribution_pct: Math.round(contribValue * 2),
        contribution_abs: Math.abs(contribValue * 2),
        confidence: risk.confidence ?? 0.7,
        status: "warning",
        entity_ids: [risk.id],
        primary_entity_id: risk.id,
        source_type: "risk_point",
        source_id: risk.id,
      });
    }

    // Sort labs by contribution (highest first)
    labs.sort((a, b) => b.contribution_abs - a.contribution_abs);

    // Size labs by contribution
    for (const lab of labs) {
      lab.size = sizeFromContribution(lab.contribution_abs);
    }

    // Update identity with actual lab count
    identity.total_labs = labs.length;

    // ── Active frame ──

    let activeFrame: ActiveFrame | null = null;
    if (ctx.activeGoal && twinState.goal_overlay) {
      const overlay = twinState.goal_overlay;
      const childLabs = labs.filter((l) => l.source_type === "goal");
      activeFrame = {
        goal: ctx.activeGoal,
        progress_pct: overlay.progress_pct,
        gap_remaining: overlay.gap_remaining,
        trajectory_weeks: overlay.trajectory?.estimated_weeks ?? null,
        trajectory_confidence: overlay.trajectory?.confidence,
        contributing_labs_count: Math.max(1, childLabs.length + Math.min(labs.length, 3)),
        total_labs_count: labs.length,
        day_count: daysBetween(ctx.activeGoal.created_at),
      };
    }

    // ── Approvals queue ──

    const approvals: ApprovalItem[] = [];

    // Pending suggested objectives (not yet accepted)
    if (ctx.pendingObjectives && ctx.pendingObjectives.length > 0) {
      for (const obj of ctx.pendingObjectives.slice(0, 3)) {
        approvals.push({
          id: `obj-${obj.key}`,
          type: "objective",
          tag_label: "Lab proposal",
          title: `Spawn lab: ${obj.title}`,
          summary: obj.description ?? obj.rationale ?? "",
          confidence:
            obj.confidence === "high" ? 0.9 : obj.confidence === "moderate" ? 0.7 : 0.5,
          priority: obj.priority ?? 5,
          time_label: "new",
          created_at: new Date().toISOString(),
        });
      }
    }

    // Strategy approval pending
    if (strategicRec && (strategicRec as Record<string, unknown>).status !== "confirmed") {
      approvals.push({
        id: "strategy-pending",
        type: "strategy",
        tag_label: "Strategy",
        title: (strategicRec.title as string) ?? "Strategy awaiting approval",
        summary: (strategicRec.summary as string) ?? "Review and confirm the proposed strategy",
        confidence:
          typeof strategicRec.confidence === "number"
            ? (strategicRec.confidence as number) / 100
            : 0.7,
        priority: 1,
        time_label: timeAgoLabel(ctx.space.updated_at),
        created_at: ctx.space.updated_at,
        action_url: `/app/space/${ctx.space.id}/strategy`,
      });
    }

    // ── Recent insights ──

    const recentInsights: InsightItem[] = [];
    const connections = (synthData?.discovered_connections ?? []) as Array<{
      id?: string;
      description?: string;
      confidence?: number;
      entity_ids?: string[];
    }>;
    for (const c of connections.slice(0, 2)) {
      recentInsights.push({
        id: `conn-${c.id ?? recentInsights.length}`,
        type: "connection",
        name: c.description ?? "Novel connection",
        meta: "novel connection",
        severity: "medium",
        confidence: c.confidence ?? 0.7,
        timestamp: ctx.space.updated_at,
        entity_ids: c.entity_ids ?? [],
        badge: "full",
        badge_text: "3/3",
      });
    }

    const contradictions = (synthData?.contradictions ?? []) as Array<{
      id?: string;
      description?: string;
      confidence?: number;
    }>;
    for (const c of contradictions.slice(0, 2)) {
      recentInsights.push({
        id: `contra-${c.id ?? recentInsights.length}`,
        type: "contradiction",
        name: c.description ?? "Contradiction",
        meta: "incomplete · needs reconciliation",
        severity: "high",
        confidence: c.confidence ?? 0.6,
        timestamp: ctx.space.updated_at,
        entity_ids: [],
        badge: "partial",
        badge_text: "2/3",
      });
    }

    const crossContext = (synthData?.cross_context_insights ?? []) as unknown as Array<{
      id?: string;
      insight?: string;
      description?: string;
      confidence?: number | string;
    }>;
    for (const c of crossContext.slice(0, 1)) {
      const confNum =
        typeof c.confidence === "number"
          ? c.confidence
          : c.confidence === "high"
            ? 0.9
            : c.confidence === "moderate"
              ? 0.7
              : 0.5;
      recentInsights.push({
        id: `cross-${c.id ?? recentInsights.length}`,
        type: "cross_context",
        name: c.insight ?? c.description ?? "Cross-context insight",
        meta: "bridges domains",
        severity: "medium",
        confidence: confNum,
        timestamp: ctx.space.updated_at,
        entity_ids: [],
        badge: "new",
        badge_text: "new",
      });
    }

    // ── Connected services ──

    const connectedServices: ServiceConnection[] = [];
    const externalEntities = ctx.entities.filter((e) => e.knowledge_layer === "external");
    const sourceGroups = new Map<string, number>();
    for (const e of externalEntities) {
      const src = (e as unknown as Record<string, unknown>).source as string | undefined;
      const key = src ?? "external";
      sourceGroups.set(key, (sourceGroups.get(key) ?? 0) + 1);
    }
    let sIdx = 0;
    for (const [name, count] of sourceGroups.entries()) {
      connectedServices.push({
        id: `svc-${sIdx++}`,
        name,
        source_type: "external_entity",
        status: "connected",
        entity_count: count,
      });
      if (connectedServices.length >= 5) break;
    }

    // ── System pulse ──

    const systemPulse: SystemPulseState = {
      connected_count: connectedServices.length,
      total_possible: 12,
      connected_ok: connectedServices.length > 0,
      scheduled_research_count: 0,
      next_research_label: null,
      data_points_today: ctx.entities.length + ctx.edges.length,
      freshness: (synthData as unknown as { is_stale?: boolean })?.is_stale
        ? "stale"
        : "fresh",
      last_synthesis_at: ctx.space.updated_at,
    };

    // ── Data sufficiency ──

    const sufficiency: DataSufficiencyReport = {
      sufficient: labs.length >= 3 && ctx.entities.length >= 5 && !!synthData,
      lab_count: labs.length,
      min_labs_recommended: 3,
      missing: [],
      actions_available: ["deep_research", "enrich_kg", "continue_chat"],
    };

    if (ctx.entities.length < 5) {
      sufficiency.missing.push({
        kind: "entities",
        have: ctx.entities.length,
        need: 5,
        label: `Only ${ctx.entities.length} entities in your graph — 5+ recommended`,
      });
    }
    if (!synthData) {
      sufficiency.missing.push({
        kind: "synthesis",
        have: 0,
        need: 1,
        label: "Synthesis not run yet — needed to detect leverage points & risks",
      });
    }
    if ((leveragePoints.length ?? 0) < 2) {
      sufficiency.missing.push({
        kind: "leverage_points",
        have: leveragePoints.length ?? 0,
        need: 2,
        label: `Only ${leveragePoints.length ?? 0} leverage points detected — 2+ recommended`,
      });
    }
    if (labs.length < 3) {
      sufficiency.missing.push({
        kind: "leverage_points",
        have: labs.length,
        need: 3,
        label: `Only ${labs.length} lab(s) could be built — 3+ recommended for a useful twin`,
      });
    }

    return {
      identity,
      health_score: twinState.macro.health_score,
      health_label: twinState.macro.health_label,
      active_frame: activeFrame,
      labs,
      approvals,
      recent_insights: recentInsights,
      connected_services: connectedServices,
      system_pulse: systemPulse,
      sufficiency,
    };
  }, [
    ctx.space,
    ctx.entities,
    ctx.edges,
    ctx.cycles,
    ctx.claims,
    ctx.propositions,
    ctx.activeGoal,
    ctx.childGoals,
    ctx.pendingObjectives,
  ]);
}
