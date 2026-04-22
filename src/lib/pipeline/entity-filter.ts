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

// Phase 51 — activate dormant taxonomy fields.
//
// source_tag encodes epistemic quality: user-stated facts (`explicit`)
// should dominate unstated assumptions. Previously this field was
// computed at write but read by NOTHING downstream, meaning a 0.4-
// confidence user hunch flagged as leverage was treated identically to
// a 0.95-confidence research-backed finding. This closes that gap.
const SOURCE_TAG_WEIGHT: Record<string, number> = {
  explicit: 1.2,     // stated by user — trust unless contradicted
  implicit: 1.0,     // derived from user input (baseline)
  assumed: 0.7,      // LLM guess without grounding — downweight
};

// entity_category carries actionability signal. Concrete + epistemic
// entities tend to produce operational strategy; abstract entities
// surface as themes but rarely as levers.
const CATEGORY_WEIGHT: Record<string, number> = {
  concrete: 1.1,
  epistemic: 1.1,
  process: 1.05,
  relational: 1.0,
  abstract: 0.9,
  fault: 1.15,  // faults are high-signal for strategy
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

    // Phase 51 — source-tag quality multiplier (applies to importance +
    // confidence components, which are the largest score contributors).
    // `assumed` entities drop to ~70% of their score; `explicit` get a
    // modest lift. This is the biggest single fix to the "high-evidence
    // and low-evidence treated identically" problem.
    const sourceTag = (e.source_tag ?? "implicit") as string;
    const sourceWeight = SOURCE_TAG_WEIGHT[sourceTag] ?? 1.0;
    score *= sourceWeight;

    // Phase 51 — entity-category actionability multiplier. Smaller than
    // source_tag because category speaks to strategy *shape* rather than
    // evidence quality. Concrete+epistemic+fault slightly over; abstract
    // slightly under.
    const category = (e.entity_category ?? "") as string;
    const catWeight = CATEGORY_WEIGHT[category] ?? 1.0;
    score *= catWeight;

    return { entity: e, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Phase 51 — layer diversity. Without this, a heavily decomposed L3
  // or L4 branch can monopolize the top-N by sheer volume, and the
  // strategy LLM loses visibility into L1–L2 mechanisms. Rebalance so
  // no single layer consumes more than `layerCapFrac` of the remaining
  // slots, reserving room for cross-abstraction representation.
  const spotsLeft = maxEntities - alwaysInclude.size;
  const layerCapFrac = 0.55;
  const layerCap = Math.max(
    4,
    Math.floor(Math.max(0, spotsLeft) * layerCapFrac),
  );
  const layerCounts = new Map<string, number>();
  const picks: Array<{ entity: Entity; score: number }> = [];
  const deferred: Array<{ entity: Entity; score: number }> = [];
  for (const s of scored) {
    if (picks.length >= spotsLeft) break;
    const layerKey = (s.entity.layer ?? "unset") as string;
    const used = layerCounts.get(layerKey) ?? 0;
    if (used >= layerCap) {
      deferred.push(s);
      continue;
    }
    picks.push(s);
    layerCounts.set(layerKey, used + 1);
  }
  // If layer caps left slots empty, fill from the deferred pool in
  // score order (the cap is soft — never exclude a high-scoring
  // entity just because its layer is over-represented).
  for (const s of deferred) {
    if (picks.length >= spotsLeft) break;
    picks.push(s);
  }

  const pickedIds = new Set(picks.map((p) => p.entity.id));
  const additionalInclude = picks;
  const excludedEntities = scored.filter((s) => !pickedIds.has(s.entity.id));

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

  reasons.push(
    `Scored ${remaining.length} remaining entities, included top ${additionalInclude.length}`,
  );

  // Phase 51 — taxonomy audit trail. Reports what the new weights
  // actually did so we can verify the activation is working.
  const tallyTag: Record<string, number> = {};
  const tallyCat: Record<string, number> = {};
  const tallyLayer: Record<string, number> = {};
  for (const s of additionalInclude) {
    const t = (s.entity.source_tag ?? "implicit") as string;
    const c = (s.entity.entity_category ?? "none") as string;
    const l = (s.entity.layer ?? "unset") as string;
    tallyTag[t] = (tallyTag[t] ?? 0) + 1;
    tallyCat[c] = (tallyCat[c] ?? 0) + 1;
    tallyLayer[l] = (tallyLayer[l] ?? 0) + 1;
  }
  const fmt = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
  reasons.push(`Taxonomy (source): ${fmt(tallyTag)}`);
  reasons.push(`Taxonomy (category): ${fmt(tallyCat)}`);
  reasons.push(`Taxonomy (layer): ${fmt(tallyLayer)}`);
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
