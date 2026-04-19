// Pre-synthesis entity filtering — Gap 3 + Gap 8 (temporal validity)
// Reduces noise in LLM context by selecting the most relevant entities
// and flagging temporally stale evidence

import type { Entity, Edge } from "@/types";
import type { ImprovementGoal } from "@/types/goals";

export interface FilterReport {
  total: number;
  included: number;
  excluded: number;
  reasons: string[];
  temporal_flags: number;
}

export interface FilterResult {
  included: Entity[];
  excluded: Entity[];
  excludedSummary: string;
  filterReport: FilterReport;
  temporalAnnotations: Map<string, string>; // entity_id → annotation string
}

const IMPORTANCE_WEIGHT: Record<string, number> = {
  fundamental: 4,
  critical: 3,
  important: 2,
  moderate: 1,
};

/**
 * Filter entities for synthesis LLM context.
 * Always includes high-signal entities (leverage, risk, bottleneck, fundamental/critical).
 * Scores and ranks remaining entities by connectivity, confidence, and temporal freshness.
 * Flags temporally stale entities with annotations.
 */
export function filterEntitiesForSynthesis(
  entities: Entity[],
  edges: Edge[],
  goal: ImprovementGoal | null,
  maxEntities: number = 40,
): FilterResult {
  const temporalAnnotations = new Map<string, string>();
  const reasons: string[] = [];
  let temporalFlags = 0;

  // ── Temporal staleness detection (Gap 8) ──
  const now = Date.now();
  for (const e of entities) {
    const tv = (e as any).temporal_validity as Record<string, unknown> | null;
    if (!tv) continue;

    const scope = tv.temporal_scope as string | undefined;
    const decayRate = tv.decay_rate as string | undefined;

    // Flag entities with explicit decay
    if (decayRate && decayRate !== "none" && decayRate !== "stable") {
      const annotation = `[TEMPORAL: ${decayRate} decay${scope ? `, scope: ${scope}` : ""}]`;
      temporalAnnotations.set(e.entity_id, annotation);
      temporalFlags++;
    }

    // Flag entities with short temporal scopes
    if (scope) {
      const shortScopes = ["days", "weeks", "this_quarter", "current_cycle"];
      if (shortScopes.some((s) => scope.toLowerCase().includes(s))) {
        if (!temporalAnnotations.has(e.entity_id)) {
          temporalAnnotations.set(e.entity_id, `[TEMPORAL: potentially stale, scope=${scope}]`);
          temporalFlags++;
        }
      }
    }
  }

  // ── If under max, include all ──
  if (entities.length <= maxEntities) {
    return {
      included: entities,
      excluded: [],
      excludedSummary: "",
      filterReport: {
        total: entities.length,
        included: entities.length,
        excluded: 0,
        reasons: ["All entities included (under threshold)"],
        temporal_flags: temporalFlags,
      },
      temporalAnnotations,
    };
  }

  // ── Always-include set ──
  const alwaysInclude = new Set<string>();

  for (const e of entities) {
    // Structural importance
    if (e.is_leverage_point) alwaysInclude.add(e.id);
    if (e.is_risk_point) alwaysInclude.add(e.id);
    if (e.is_master_bottleneck) alwaysInclude.add(e.id);

    // High importance
    const imp = e.importance ?? "moderate";
    if (imp === "fundamental" || imp === "critical") alwaysInclude.add(e.id);

    // External entities (from research agent)
    if (e.knowledge_layer === "external") alwaysInclude.add(e.id);
  }

  // Goal critical path entities (1-hop from goal source)
  if (goal) {
    const goalSourceId = (goal as any).source_entity_id as string | undefined;
    if (goalSourceId) {
      const sourceEntity = entities.find((e) => e.entity_id === goalSourceId);
      if (sourceEntity) {
        alwaysInclude.add(sourceEntity.id);
        // Add 1-hop neighbors
        for (const edge of edges) {
          if (edge.source_entity_id === sourceEntity.id) {
            alwaysInclude.add(edge.target_entity_id);
          }
          if (edge.target_entity_id === sourceEntity.id) {
            alwaysInclude.add(edge.source_entity_id);
          }
        }
      }
    }
  }

  reasons.push(`Always-include: ${alwaysInclude.size} entities (leverage/risk/bottleneck/critical/external)`);

  // ── Score remaining entities ──
  const edgeCount = new Map<string, number>();
  for (const edge of edges) {
    edgeCount.set(edge.source_entity_id, (edgeCount.get(edge.source_entity_id) ?? 0) + 1);
    edgeCount.set(edge.target_entity_id, (edgeCount.get(edge.target_entity_id) ?? 0) + 1);
  }

  const remaining = entities.filter((e) => !alwaysInclude.has(e.id));
  const scored = remaining.map((e) => {
    let score = 0;

    // Importance weight
    score += (IMPORTANCE_WEIGHT[e.importance ?? "moderate"] ?? 1) * 10;

    // Connectivity (edges)
    score += Math.min((edgeCount.get(e.id) ?? 0) * 3, 15);

    // Confidence
    score += (typeof e.confidence === "number" ? e.confidence : 0.5) * 10;

    // Penalty for temporally stale
    if (temporalAnnotations.has(e.entity_id)) {
      score -= 5;
    }

    // Bonus for shared variables (cross-space relevance)
    if (e.is_shared_variable) score += 8;

    return { entity: e, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const spotsLeft = maxEntities - alwaysInclude.size;
  const additionalInclude = scored.slice(0, Math.max(0, spotsLeft));
  const excludedEntities = scored.slice(Math.max(0, spotsLeft));

  const included = [
    ...entities.filter((e) => alwaysInclude.has(e.id)),
    ...additionalInclude.map((s) => s.entity),
  ];
  const excluded = excludedEntities.map((s) => s.entity);

  // Build excluded summary for LLM context
  let excludedSummary = "";
  if (excluded.length > 0) {
    const names = excluded.slice(0, 8).map((e) => `${e.entity_id}:${e.name}`);
    const more = excluded.length > 8 ? ` (+${excluded.length - 8} more)` : "";
    excludedSummary = `\n[${excluded.length} lower-priority entities omitted for focus: ${names.join(", ")}${more}]`;
  }

  reasons.push(`Scored ${remaining.length} remaining entities, included top ${additionalInclude.length}`);
  reasons.push(`Excluded ${excluded.length} entities (lowest connectivity + importance)`);

  return {
    included,
    excluded,
    excludedSummary,
    filterReport: {
      total: entities.length,
      included: included.length,
      excluded: excluded.length,
      reasons,
      temporal_flags: temporalFlags,
    },
    temporalAnnotations,
  };
}
