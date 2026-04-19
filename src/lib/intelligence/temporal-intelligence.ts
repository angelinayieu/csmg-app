/**
 * Temporal Intelligence Layer
 *
 * Extracts time-based intelligence from existing data:
 * - Signal velocity: are signals accelerating or decelerating?
 * - Entity staleness: which entities haven't been touched in a while?
 * - Coverage trajectory: is coverage improving or degrading over time?
 * - Cadence recommendation: should the user research more or less frequently?
 *
 * Pure computation — no LLM calls, no DB writes.
 */

import type { Entity, Edge } from "@/types";
import type { IntelligenceSignal, ResearchSchedule } from "@/types/intelligence";
import type {
  SignalVelocity,
  EntityStaleness,
  CoverageTrajectory,
  CadenceRecommendation,
  TemporalIntelligence,
  CoverageImprovementRec,
} from "@/types/intelligence-v2";
import { getBridgedExternalIds } from "./bridge-semantics";

// ── Signal Velocity ──

const DEFAULT_PERIOD_DAYS = 14;
const STALENESS_THRESHOLD_DAYS = 21;

/**
 * Compute signal velocity: how many signals per period, broken down by type,
 * and whether the rate is accelerating or decelerating.
 */
export function computeSignalVelocity(
  signals: IntelligenceSignal[],
  periodDays: number = DEFAULT_PERIOD_DAYS
): SignalVelocity {
  const now = Date.now();
  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  const currentCutoff = now - periodMs;
  const previousCutoff = now - periodMs * 2;

  const currentPeriod: IntelligenceSignal[] = [];
  const previousPeriod: IntelligenceSignal[] = [];

  for (const sig of signals) {
    const t = new Date(sig.detected_at).getTime();
    if (t >= currentCutoff) {
      currentPeriod.push(sig);
    } else if (t >= previousCutoff) {
      previousPeriod.push(sig);
    }
  }

  // By type counts for current period
  const byType: Record<string, number> = {};
  for (const sig of currentPeriod) {
    byType[sig.type] = (byType[sig.type] ?? 0) + 1;
  }

  const currentCount = currentPeriod.length;
  const previousCount = previousPeriod.length;
  const acceleration = previousCount > 0 ? currentCount / previousCount : currentCount > 0 ? 2.0 : 1.0;

  return {
    by_type: byType,
    current_period_count: currentCount,
    previous_period_count: previousCount,
    acceleration: Math.round(acceleration * 100) / 100,
    period_days: periodDays,
    computed_at: new Date().toISOString(),
  };
}

// ── Entity Staleness ──

/**
 * Detect stale entities — external entities that haven't been touched by
 * any pipeline action (research, signal, bridge creation, authority update)
 * within the staleness threshold.
 */
export function computeEntityStaleness(
  externalEntities: Entity[],
  signals: IntelligenceSignal[],
  bridgeEdges: Edge[],
  thresholdDays: number = STALENESS_THRESHOLD_DAYS
): EntityStaleness[] {
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

  // Build last-touch map from multiple sources
  const lastTouch = new Map<string, { time: number; source: EntityStaleness["last_touched_by"] }>();

  // Signals
  for (const sig of signals) {
    const t = new Date(sig.detected_at).getTime();
    const prev = lastTouch.get(sig.entity_id);
    if (!prev || t > prev.time) {
      lastTouch.set(sig.entity_id, { time: t, source: "signal" });
    }
  }

  // Bridge edges (use created_at or updated_at)
  for (const edge of bridgeEdges) {
    const edgeTime = new Date(
      (edge as Record<string, unknown>).updated_at as string ||
      (edge as Record<string, unknown>).created_at as string ||
      0
    ).getTime();
    if (edgeTime <= 0) continue;

    for (const eid of [edge.source_entity_id, edge.target_entity_id]) {
      const prev = lastTouch.get(eid);
      if (!prev || edgeTime > prev.time) {
        lastTouch.set(eid, { time: edgeTime, source: "bridge" });
      }
    }
  }

  // Entity timestamps (created_at, updated_at)
  for (const e of externalEntities) {
    const entityTime = new Date(
      (e as Record<string, unknown>).updated_at as string ||
      (e as Record<string, unknown>).created_at as string ||
      0
    ).getTime();
    if (entityTime <= 0) continue;

    const prev = lastTouch.get(e.entity_id);
    if (!prev || entityTime > prev.time) {
      lastTouch.set(e.entity_id, { time: entityTime, source: "research" });
    }
  }

  const results: EntityStaleness[] = [];
  for (const e of externalEntities) {
    const touch = lastTouch.get(e.entity_id);
    const daysSince = touch
      ? Math.floor((now - touch.time) / (24 * 60 * 60 * 1000))
      : 999;

    results.push({
      entity_id: e.entity_id,
      entity_name: e.name,
      days_since_last_touch: daysSince,
      last_touched_by: touch?.source ?? "research",
      stale: daysSince > thresholdDays,
    });
  }

  // Sort: most stale first
  return results
    .filter((s) => s.stale)
    .sort((a, b) => b.days_since_last_touch - a.days_since_last_touch);
}

// ── Coverage Trajectory ──

/**
 * Compute coverage trajectory from historical snapshots stored in
 * synthesis_data.intelligence_radar_v2.temporal.coverage_trajectory.snapshots.
 *
 * If no prior snapshots exist, initializes with the current score.
 */
export function computeCoverageTrajectory(
  currentScore: number,
  existingSnapshots: Array<{ score: number; date: string }> = []
): CoverageTrajectory {
  const today = new Date().toISOString().slice(0, 10);

  // Add current score if it's a new day
  const snapshots = [...existingSnapshots];
  const lastDate = snapshots.length > 0 ? snapshots[snapshots.length - 1].date : null;
  if (lastDate !== today) {
    snapshots.push({ score: currentScore, date: today });
  } else {
    // Update today's snapshot
    snapshots[snapshots.length - 1] = { score: currentScore, date: today };
  }

  // Keep max 30 snapshots
  while (snapshots.length > 30) snapshots.shift();

  // Compute trend
  let trend: CoverageTrajectory["trend"] = "stable";
  let deltaPerPeriod = 0;

  if (snapshots.length >= 3) {
    const recent = snapshots.slice(-3);
    const deltas = [];
    for (let i = 1; i < recent.length; i++) {
      deltas.push(recent[i].score - recent[i - 1].score);
    }
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    deltaPerPeriod = Math.round(avgDelta * 10) / 10;

    if (avgDelta > 2) trend = "improving";
    else if (avgDelta < -2) trend = "degrading";
    else trend = "stable";
  }

  return { snapshots, trend, delta_per_period: deltaPerPeriod };
}

// ── Cadence Recommendation ──

/**
 * Recommend research cadence based on signal velocity, staleness, and coverage trend.
 */
export function computeCadenceRecommendation(
  velocity: SignalVelocity,
  staleCount: number,
  coverageTrend: CoverageTrajectory["trend"],
  currentSchedule: ResearchSchedule | null
): CadenceRecommendation | null {
  const currentCadence = currentSchedule?.cadence ?? "manual";

  // Determine landscape volatility
  let volatility: "high" | "medium" | "low" = "medium";
  if (velocity.acceleration > 1.5 || velocity.current_period_count > 8) {
    volatility = "high";
  } else if (velocity.acceleration < 0.5 && velocity.current_period_count < 2) {
    volatility = "low";
  }

  // Build recommendation
  let recommendedCadence = currentCadence;
  let reason = "";

  if (volatility === "high" && coverageTrend !== "improving") {
    recommendedCadence = "daily";
    reason = `Signal rate is accelerating (${velocity.acceleration}x) and coverage is ${coverageTrend}. More frequent research would help you keep up with changes.`;
  } else if (volatility === "high" && coverageTrend === "improving") {
    recommendedCadence = "weekly";
    reason = `Landscape is volatile but your coverage is improving. Weekly research maintains momentum.`;
  } else if (volatility === "low" && staleCount === 0 && coverageTrend !== "degrading") {
    recommendedCadence = "biweekly";
    reason = `Landscape is stable with no stale entities. You can reduce to biweekly without losing coverage.`;
  } else if (staleCount > 5) {
    recommendedCadence = "weekly";
    reason = `${staleCount} entities are stale. Weekly research prevents blind spots from forming.`;
  }

  // Don't recommend if same as current
  if (recommendedCadence === currentCadence) return null;

  return {
    current_cadence: currentCadence,
    recommended_cadence: recommendedCadence,
    reason,
    landscape_volatility: volatility,
  };
}

// ── Coverage Improvement Recommendations ──

/**
 * Generate actionable recommendations for improving coverage score.
 * Pure computation from existing data.
 */
export function computeCoverageImprovements(params: {
  externalEntities: Entity[];
  internalEntities: Entity[];
  edges: Edge[];
  coverageScore: number;
  coverageBreakdown: { quantity_ratio: number; bridge_coverage: number; authority_quality: number; category_diversity: number };
}): CoverageImprovementRec[] {
  const { externalEntities, internalEntities, edges, coverageBreakdown } = params;
  const recs: CoverageImprovementRec[] = [];
  let priority = 1;

  const bridgedIds = getBridgedExternalIds(edges, [...externalEntities, ...internalEntities]);

  // 1. Low bridge coverage — suggest specific entities to bridge
  if (coverageBreakdown.bridge_coverage < 0.5) {
    const unbridged = externalEntities
      .filter((e) => !bridgedIds.has(e.entity_id))
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 4);

    for (const entity of unbridged) {
      // Find closest internal entity by shared connections
      const closestInternal = findClosestInternalEntity(entity, internalEntities, edges);
      recs.push({
        action: "create_bridge",
        description: `Bridge "${entity.name}" to ${closestInternal?.name ?? "your core system"} — currently unconnected landscape entity with ${entity.authority_level ?? "unverified"} authority`,
        target_entity_id: entity.entity_id,
        target_entity_name: entity.name,
        internal_entity_id: closestInternal?.entity_id,
        internal_entity_name: closestInternal?.name,
        estimated_coverage_gain: Math.round(
          (1 / Math.max(1, externalEntities.length)) * 30 // bridge_coverage weight = 30
        ),
        effort: "low",
        priority: priority++,
      });
    }
  }

  // 2. Low authority quality — suggest upgrades
  if (coverageBreakdown.authority_quality < 0.5) {
    const lowAuthority = externalEntities
      .filter((e) => e.authority_level === "low" || e.authority_level === "unverified")
      .filter((e) => bridgedIds.has(e.entity_id)) // prioritize bridged entities
      .slice(0, 3);

    for (const entity of lowAuthority) {
      recs.push({
        action: "upgrade_authority",
        description: `Verify "${entity.name}" — currently ${entity.authority_level ?? "unverified"} but has bridge connections to your system`,
        target_entity_id: entity.entity_id,
        target_entity_name: entity.name,
        estimated_coverage_gain: Math.round(
          (1 / Math.max(1, externalEntities.length)) * 25
        ),
        effort: "medium",
        priority: priority++,
      });
    }
  }

  // 3. Low category diversity — suggest missing categories
  if (coverageBreakdown.category_diversity < 0.6) {
    const allCategories = new Set(["competitor", "framework", "pattern", "data_point", "analogy", "risk_pattern", "resource"]);
    const presentCategories = new Set<string>();
    for (const e of externalEntities) {
      const prov = e.provenance as Record<string, unknown> | null;
      const cat = (prov?.category as string) ?? "pattern";
      presentCategories.add(cat);
    }
    const missingCategories = [...allCategories].filter((c) => !presentCategories.has(c));

    if (missingCategories.length > 0) {
      recs.push({
        action: "research_category",
        description: `Research missing categories: ${missingCategories.join(", ")}. Your landscape is missing ${missingCategories.length} of 7 intelligence categories.`,
        estimated_coverage_gain: Math.round(
          (missingCategories.length / 7) * 20 // category_diversity weight = 20
        ),
        effort: "medium",
        priority: priority++,
      });
    }
  }

  // 4. Low quantity ratio — need more external entities
  if (coverageBreakdown.quantity_ratio < 0.5 && internalEntities.length > 3) {
    const targetCount = Math.ceil(internalEntities.length * 0.5);
    const deficit = Math.max(0, targetCount - externalEntities.length);
    if (deficit > 0) {
      recs.push({
        action: "add_entity",
        description: `Add ~${deficit} more external entities. You have ${externalEntities.length} external vs ${internalEntities.length} internal — the landscape is thin.`,
        estimated_coverage_gain: Math.min(10, Math.round(deficit * 2)),
        effort: "medium",
        priority: priority++,
      });
    }
  }

  return recs;
}

// ── Helper ──

function findClosestInternalEntity(
  external: Entity,
  internalEntities: Entity[],
  edges: Edge[]
): Entity | null {
  // Find internal entity sharing most edges with the external entity's neighbors
  const neighbors = new Set<string>();
  for (const e of edges) {
    if (e.source_entity_id === external.entity_id || e.source_entity_id === external.id) {
      neighbors.add(e.target_entity_id);
    }
    if (e.target_entity_id === external.entity_id || e.target_entity_id === external.id) {
      neighbors.add(e.source_entity_id);
    }
  }

  // Prefer leverage/risk/bottleneck internal entities
  const prioritized = internalEntities.filter(
    (e) => e.is_leverage_point || e.is_risk_point || e.is_master_bottleneck
  );

  // Check if any prioritized internal entities share neighbors
  for (const ie of prioritized) {
    if (neighbors.has(ie.entity_id) || neighbors.has(ie.id)) {
      return ie;
    }
  }

  // Fallback: return highest-importance internal entity
  const importanceOrder: Record<string, number> = { fundamental: 0, critical: 1, important: 2, moderate: 3, minor: 4 };
  return [...internalEntities].sort(
    (a, b) => (importanceOrder[a.importance ?? "moderate"] ?? 3) - (importanceOrder[b.importance ?? "moderate"] ?? 3)
  )[0] ?? null;
}

// ── Main entry point ──

/**
 * Compute all temporal intelligence from existing data.
 * Pure function — no LLM, no DB writes.
 */
export function computeTemporalIntelligence(params: {
  signals: IntelligenceSignal[];
  externalEntities: Entity[];
  internalEntities: Entity[];
  bridgeEdges: Edge[];
  coverageScore: number;
  existingSnapshots?: Array<{ score: number; date: string }>;
  schedule: ResearchSchedule | null;
}): TemporalIntelligence {
  const velocity = computeSignalVelocity(params.signals);

  const staleEntities = computeEntityStaleness(
    params.externalEntities,
    params.signals,
    params.bridgeEdges
  );

  const coverageTrajectory = computeCoverageTrajectory(
    params.coverageScore,
    params.existingSnapshots
  );

  const cadenceRecommendation = computeCadenceRecommendation(
    velocity,
    staleEntities.length,
    coverageTrajectory.trend,
    params.schedule
  );

  return {
    signal_velocity: velocity,
    stale_entities: staleEntities,
    coverage_trajectory: coverageTrajectory,
    cadence_recommendation: cadenceRecommendation,
    computed_at: new Date().toISOString(),
  };
}
