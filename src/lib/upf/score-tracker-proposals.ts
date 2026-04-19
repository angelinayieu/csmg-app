/**
 * UPF — descriptor derivation for infrastructure / tracker proposals (Phase 4c-next).
 *
 * A strategy's `infrastructure_proposals[]` are candidate tools the user
 * could build. Each proposal has:
 *   - `complexity` (low | medium | high)           → friction
 *   - `metrics_tracked[]`                          → data categories + info breadth
 *   - `priority` (1..N, 1 = highest by LLM)        → info-bit bonus
 *   - `source_components[]` (entity_ids)           → entity-aware info boost
 *
 * We emit a ProxyDescriptor per proposal so `selectNextProxy` can rank them.
 * Crucially, because metrics_tracked strings can classify to sensitive data
 * categories (health_signals, financial, …), passing the user's consent
 * manifest into the selector will automatically filter proposals that would
 * require data the user hasn't opted in to.
 *
 * Pure function; same auditable coefficient-style scoring as the question
 * and entity scorers.
 */

import type {
  InfrastructureProposal,
} from "@/types/strategy";
import type { Entity } from "@/types";
import type { DataCategory } from "@/types/consent";
import type { DepthTier, ProxyDescriptor } from "./types";
import { classifyTracker } from "@/lib/strategy/classify-tracker";
import { entityReferenceInfoBits, entityReferenceTags } from "./derive-entity-descriptor";

// ── Friction by LLM-declared complexity ──────────────────────────────
const COMPLEXITY_FRICTION: Record<InfrastructureProposal["complexity"], number> = {
  low: 0.25,
  medium: 0.55,
  high: 0.80,
};

// ── Info-bit contributions ───────────────────────────────────────────
/** Each metric tracked adds this much info, up to the cap. */
const BITS_PER_METRIC = 0.5;
const METRIC_COUNT_CAP = 6;

/** LLM-assigned priority ladder. 1 = highest; anything past 5 gets zero. */
const PRIORITY_BONUS_BITS: Record<number, number> = {
  1: 1.6,
  2: 0.9,
  3: 0.4,
  4: 0.15,
  5: 0.05,
};

/** Weight applied to entityReferenceInfoBits when summing source_components. */
const COMPONENT_ENTITY_WEIGHT = 0.3;

/** Tool type bias — monitors/dashboards surface info passively (slight boost). */
const TYPE_BIAS_BITS: Record<InfrastructureProposal["type"], number> = {
  monitor: 0.4,
  dashboard: 0.3,
  workflow: 0.1,
  integration: 0.1,
  app: 0.0,
  tool: 0.0,
};

// ── Depth tier mapping ───────────────────────────────────────────────
function deriveDepthTier(p: InfrastructureProposal): DepthTier {
  if (p.complexity === "high") return "heavy";
  if (p.complexity === "medium") return "mid";
  return "light";
}

// ── Data-category inference from metrics_tracked ──────────────────────
/**
 * Reuse Phase 4a's keyword classifier. Proposal metrics arrive as free-text
 * strings ("weekly trial sign-up count", "CAC:LTV ratio", …) so we feed each
 * into classifyTracker and union the resulting non-generic categories.
 *
 * We default the sourceKind to `perspective_key_metric` (mid tier) since
 * proposals sit between leading indicators and outcome objectives; the
 * category inference is what we care about here, not the tier.
 */
function inferDataCategories(metrics: string[]): DataCategory[] {
  const seen = new Set<DataCategory>();
  for (const label of metrics) {
    if (!label) continue;
    const { data_category } = classifyTracker({
      sourceKind: "perspective_key_metric",
      label,
    });
    if (data_category !== "generic") seen.add(data_category);
  }
  return [...seen];
}

// ── Rationale ─────────────────────────────────────────────────────────

/** One-line rationale for tooltips / "why was this picked". */
export function proposalRationale(
  p: InfrastructureProposal,
  ctx?: { entityLookup?: (id: string) => Entity | undefined }
): string {
  const parts: string[] = [];
  parts.push(`${p.complexity} complexity`);
  const metricCount = Math.min(p.metrics_tracked?.length ?? 0, METRIC_COUNT_CAP);
  if (metricCount > 0) {
    parts.push(`tracks ${metricCount} metric${metricCount === 1 ? "" : "s"}`);
  }
  if (p.priority && p.priority <= 2) {
    parts.push(`priority #${p.priority}`);
  }

  if (ctx?.entityLookup && (p.source_components ?? []).length > 0) {
    const tags = new Set<string>();
    for (const eid of p.source_components ?? []) {
      const ent = ctx.entityLookup(eid);
      if (!ent) continue;
      for (const t of entityReferenceTags(ent)) tags.add(t);
    }
    if (tags.has("bottleneck")) parts.push("implements bottleneck");
    else if (tags.has("leverage")) parts.push("implements leverage");
    else if (tags.has("risk")) parts.push("guards risk");
    else if (tags.has("fundamental")) parts.push("implements fundamental node");
  }

  if (p.type === "monitor" || p.type === "dashboard") {
    parts.push(`passive ${p.type}`);
  }

  return parts.join(" · ");
}

// ── Public API ────────────────────────────────────────────────────────

export interface ProposalScoreContext {
  entityLookup?: (id: string) => Entity | undefined;
}

export function scoreProposalInfoBits(
  p: InfrastructureProposal,
  ctx?: ProposalScoreContext
): number {
  const metricCount = Math.min(p.metrics_tracked?.length ?? 0, METRIC_COUNT_CAP);
  const metricBits = metricCount * BITS_PER_METRIC;
  const priorityBits = PRIORITY_BONUS_BITS[p.priority] ?? 0;
  const typeBits = TYPE_BIAS_BITS[p.type] ?? 0;

  let componentBits = 0;
  if (ctx?.entityLookup && (p.source_components ?? []).length > 0) {
    for (const eid of p.source_components ?? []) {
      const ent = ctx.entityLookup(eid);
      if (ent) componentBits += entityReferenceInfoBits(ent) * COMPONENT_ENTITY_WEIGHT;
    }
  }

  return metricBits + priorityBits + typeBits + componentBits;
}

export function scoreProposalFriction(p: InfrastructureProposal): number {
  return COMPLEXITY_FRICTION[p.complexity] ?? 0.5;
}

export function proposalToDescriptor(
  p: InfrastructureProposal,
  spaceId: string,
  ctx?: ProposalScoreContext
): ProxyDescriptor {
  const construct_id = `proposal:${p.name.trim().toLowerCase()}`;

  // Phase 4c-final upgrade: every proposal probes (a) its own construct,
  // (b) each entity it implements, (c) each metric it tracks. When any of
  // those get observations later, the proposal's effective info-bits sink.
  const probes_constructs = [
    construct_id,
    ...(p.source_components ?? []).map((eid) => `entity:${eid}`),
    ...(p.metrics_tracked ?? []).map((m) => `metric:${m.trim().toLowerCase()}`),
  ];

  return {
    id: `proposal:${spaceId}:${p.id}`,
    construct_id,
    kind: "metric",
    depth_tier: deriveDepthTier(p),
    friction_cost: scoreProposalFriction(p),
    expected_info_bits: scoreProposalInfoBits(p, ctx),
    data_categories: inferDataCategories(p.metrics_tracked ?? []),
    probes_constructs,
    metadata: {
      proposal_id: p.id,
      name: p.name,
      type: p.type,
      complexity: p.complexity,
      priority: p.priority,
      metrics_tracked: p.metrics_tracked ?? [],
      rationale: proposalRationale(p, ctx),
    },
  };
}
