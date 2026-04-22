// GET /api/spaces/[id]/entities/catalog
//
// Phase A1.9 — enriched entity catalog powering the multi-view library
// drawer. Every row is pre-computed server-side so the UI just
// projects, never computes:
//
//   kind              — 7-class classification (tool/evidence/metric/…)
//   dominance         — compound score + component breakdown
//   upstream_count    — incoming edges (drivers)
//   downstream_count  — outgoing edges (effects)
//   chain_count       — how many causal chains touch the entity
//   goal_ids          — goals this entity serves (proxy via leverage)
//   intervention_cost — from synthesis action_plan if computed
//
// One fetch per library open per space. Heavy computation on warm
// cache (graph + synthesis + goals all in memory for the space) is
// still sub-100ms even for thousands of entities.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  classifyEntityKind,
  type EntityKind,
} from "@/lib/entities/kind-classifier";
import {
  buildDominanceContext,
  computeEntityDominance,
  countEdgeDirection,
  type DominanceBreakdown,
} from "@/lib/entities/dominance";
import {
  detectDomain,
  pickStarterKinds,
  type SpaceDomain,
  type DomainProfile,
} from "@/lib/entities/domain-detector";
import type { Entity, Edge, Space } from "@/types";
import type { ImprovementGoal } from "@/types/goals";
import type { SynthesisData, RichLeveragePoint } from "@/types/synthesis";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface EntityCatalogEntry extends Entity {
  /** Derived user-facing classification — 7 kinds. */
  kind: EntityKind;
  /** Compound dominance score with component breakdown. */
  dominance: DominanceBreakdown;
  /** Directed edge counts. upstream = drivers, downstream = effects. */
  upstream_count: number;
  downstream_count: number;
  /** Causal chains touching this entity (best-effort from synthesis). */
  chain_count: number;
  /** Active goals this entity serves (proxy: goals where leverage flags it). */
  goal_ids: string[];
  /** Effort estimate from synthesis.action_plan; null when not synthesized. */
  intervention_cost: "low" | "mid" | "high" | null;
}

export interface EntitiesCatalogResponse {
  entities: EntityCatalogEntry[];
  /** ISO timestamp of the computation (not the last synthesis). */
  computed_at: string;
  space_name: string;
  /** True when synthesis-derived fields (leverage, cost) are populated. */
  synthesis_available: boolean;
  /** Auto-detected context classification — drives dominance weights
   *  + subtle UI hints. User never picks this manually. */
  detected_domain: SpaceDomain;
  domain_profile: DomainProfile;
  /** Confidence in the detection (0–1). <0.4 → falls back to general. */
  domain_confidence: number;
  /** Top kinds to surface as starter-filter suggestions on open. */
  starter_kinds: string[];
}

/**
 * Parse synthesis_data which may be a JSON string or already a parsed
 * object depending on the database driver.
 */
function parseSynthesis(raw: unknown): SynthesisData | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as SynthesisData;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as SynthesisData;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Best-effort chain_count per entity — scans synthesis chains/loops
 * and counts memberships. When synthesis hasn't run, returns 0.
 */
function buildChainCounts(
  synthesis: SynthesisData | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!synthesis) return counts;

  // Leverage points expose a `connections` array of related entity ids.
  for (const lp of synthesis.leverage_points ?? []) {
    for (const nid of lp.connections ?? []) {
      counts.set(nid, (counts.get(nid) ?? 0) + 1);
    }
    counts.set(lp.entity_id, (counts.get(lp.entity_id) ?? 0) + 1);
  }
  // Feedback loops don't use entity ids in the public type, but risk
  // points do — count those too.
  for (const rp of synthesis.risk_points ?? []) {
    for (const nid of rp.connections ?? []) {
      counts.set(nid, (counts.get(nid) ?? 0) + 1);
    }
    counts.set(rp.entity_id, (counts.get(rp.entity_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Best-effort goal_ids per entity — a leverage entity is considered to
 * "serve" every active goal. Refine later when entity_objectives is
 * fully populated.
 */
function buildGoalLinks(
  leverage: readonly RichLeveragePoint[],
  activeGoals: readonly ImprovementGoal[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (activeGoals.length === 0) return out;
  const goalIds = activeGoals.map((g) => g.id);
  for (const lp of leverage) {
    out.set(lp.entity_id, goalIds);
  }
  return out;
}

/**
 * Rough intervention_cost heuristic: scan the synthesis action_plan
 * text for cost hints. Returns null when the plan doesn't surface one.
 * Real costing requires effort estimates on mechanisms — future work.
 */
function inferCostForEntity(
  entity: Entity,
  synthesis: SynthesisData | null,
): "low" | "mid" | "high" | null {
  if (!synthesis?.action_plan) return null;
  const plan = synthesis.action_plan;
  // Find any action whose text or supporting_chain references this entity.
  for (const path of plan.paths ?? []) {
    for (const tf of path.timeframes ?? []) {
      for (const action of tf.actions ?? []) {
        const chain = action.supporting_chain;
        const hitsChain =
          chain?.leverage_entity_ids?.includes(entity.id) ||
          chain?.risk_entity_ids?.includes(entity.id) ||
          chain?.bottleneck_entity_id === entity.id;
        const hitsText = action.text?.toLowerCase().includes(
          entity.name?.toLowerCase() ?? "___no_match___",
        );
        if (!hitsChain && !hitsText) continue;
        const costText = (action.cost_of_delay ?? "").toLowerCase();
        if (/high|critical|urgent|expensive|significant/.test(costText)) return "high";
        if (/low|quick|cheap|small|minor/.test(costText)) return "low";
        if (costText) return "mid";
      }
    }
  }
  return null;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [spaceRes, entitiesRes, edgesRes, goalsRes] = await Promise.all([
    db
      .from("spaces")
      .select("id, name, user_id, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle(),
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false }),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRes.data as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const space = spaceRes.data as Space;
  const entities = (entitiesRes.data ?? []) as Entity[];
  const edges = (edgesRes.data ?? []) as Edge[];
  const goals = (goalsRes.data ?? []) as ImprovementGoal[];
  const synthesis = parseSynthesis(
    (space as unknown as { synthesis_data?: unknown }).synthesis_data,
  );

  const leveragePoints = synthesis?.leverage_points ?? [];
  const activeGoals = goals.filter(
    (g) => (g.status as string) === "active" || (g.status as string) === "proposed",
  );

  // ── Auto-detect domain BEFORE scoring — domain-tuned weights
  //    then flow into computeEntityDominance. Zero user input. ─────────
  const domainResult = detectDomain({
    entities,
    goals,
    synthesis_available: synthesis !== null,
  });

  // ── Build all shared context once so per-entity work is O(1) ──────
  const domCtx = buildDominanceContext({
    entities,
    edges,
    leveragePoints,
    goals,
  });
  const chainCounts = buildChainCounts(synthesis);
  const goalLinks = buildGoalLinks(leveragePoints, activeGoals);

  const enriched: EntityCatalogEntry[] = entities.map((entity) => {
    const kind = classifyEntityKind(entity);
    const dominance = computeEntityDominance(
      domCtx,
      entity,
      domainResult.profile.weights,
    );
    const { upstream, downstream } = countEdgeDirection(entity, edges);
    return {
      ...entity,
      kind,
      dominance,
      upstream_count: upstream,
      downstream_count: downstream,
      chain_count: chainCounts.get(entity.id) ?? 0,
      goal_ids: goalLinks.get(entity.id) ?? [],
      intervention_cost: inferCostForEntity(entity, synthesis),
    };
  });

  // Default order: dominance score desc. Keeps the drawer useful
  // even before the user touches sort.
  enriched.sort((a, b) => b.dominance.score - a.dominance.score);

  const starter_kinds = pickStarterKinds(
    domainResult.profile,
    domainResult.ratios,
  );

  const payload: EntitiesCatalogResponse = {
    entities: enriched,
    computed_at: new Date().toISOString(),
    space_name: space.name,
    synthesis_available: synthesis !== null,
    detected_domain: domainResult.domain,
    domain_profile: domainResult.profile,
    domain_confidence: domainResult.confidence,
    starter_kinds,
  };
  return NextResponse.json(payload);
}
