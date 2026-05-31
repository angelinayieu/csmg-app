// ── deriveMethodTier ──────────────────────────────────────────────
//
// The depth dial's "Proof" tier (and the room Map's MethodBadge) dims any
// node that has no recorded *evaluation method*, so the validated path
// stands out. The renderer reads `node.data.methodTier` — but room
// generation hardcoded it `null` everywhere, so the tier was never derived
// and Proof dimmed the WHOLE board uniformly (nothing stood out → the
// "nothing shows up at Proof" report).
//
// This module derives a tier from substrate the pipeline DOES populate:
// the causal edges touching a node — their human approval, agent rationale,
// and strength. Two sources, in priority order:
//   1. A PERSISTED tier the pipeline stamped onto the entity's causal_chain
//      JSONB (autopilot's enrich-chains pass). Authoritative when present.
//   2. A deterministic FALLBACK inferred from the node's edges at view-time
//      — so existing rooms light up at Proof with NO regeneration.
//
// Pure + dependency-light (only a type import) so both the client graph
// builder (build-room-graph.ts) and the server route (enrich-chains) can
// share ONE definition of "how rigorously was this lever evaluated".

import type { MethodTier } from "@/components/objective/causal-map/lib/types";

/** Minimal structural edge shape — satisfied by BOTH the client `RoomEdge`
 *  and the server `EdgeRow`, so neither side has to import the other. */
export interface MethodTierEdge {
  source_entity_id: string;
  target_entity_id: string;
  strength: number | null;
  approved_at?: string | null;
  agent_feedback?: Record<string, unknown> | null;
}

export interface MethodTierResult {
  tier: MethodTier;
  score: number | null;
}

/** The badge tiers, ranked low→high. Doubles as the validity allow-list
 *  for a persisted string. */
const TIER_RANK: Record<NonNullable<MethodTier>, number> = {
  heuristic: 1,
  rubric: 2,
  evidence: 3,
  ensemble: 4,
  simulated: 5,
  tested: 6,
};

function clamp01(n: unknown): number | null {
  return typeof n === "number" && !Number.isNaN(n)
    ? Math.max(0, Math.min(1, n))
    : null;
}

/** Read a tier the pipeline persisted onto an entity's causal_chain JSONB.
 *  Tolerant: unknown strings / missing keys → null. */
export function readPersistedMethodTier(
  causalChain: Record<string, unknown> | null | undefined,
): MethodTierResult {
  const cc = (causalChain ?? {}) as Record<string, unknown>;
  const raw = typeof cc.method_tier === "string" ? cc.method_tier : null;
  const tier = raw && raw in TIER_RANK ? (raw as MethodTier) : null;
  return { tier, score: clamp01(cc.method_score) };
}

/** Infer an evaluation tier for ONE node from the causal edges touching it.
 *  Human approval > strong agent rationale > agent rationale > none.
 *  Returns null (→ the node dims at Proof) for an orphan with no wiring. */
export function deriveMethodTierFromEdges(
  nodeId: string,
  edges: ReadonlyArray<MethodTierEdge>,
): MethodTierResult {
  let touchCount = 0;
  let approved = false;
  let rationale = false;
  let maxStrength = 0;
  for (const e of edges) {
    if (e.source_entity_id !== nodeId && e.target_entity_id !== nodeId)
      continue;
    touchCount += 1;
    if (e.approved_at) approved = true;
    const fb = (e.agent_feedback ?? {}) as Record<string, unknown>;
    if (typeof fb.mechanism === "string" && fb.mechanism.trim().length > 0)
      rationale = true;
    const s = clamp01(e.strength);
    if (s != null && s > maxStrength) maxStrength = s;
  }
  if (touchCount === 0) return { tier: null, score: null };
  const score = maxStrength;
  if (approved) return { tier: "tested", score };
  if (rationale && maxStrength >= 0.66) return { tier: "rubric", score };
  if (rationale) return { tier: "heuristic", score };
  return { tier: null, score };
}

/** The node's effective tier: a persisted/autopilot tier wins; otherwise
 *  the deterministic edge-derived fallback. Used at view-time by the room
 *  graph builder so every room — including pre-existing ones — surfaces a
 *  meaningful Proof tier without waiting on a pipeline re-run. */
export function effectiveMethodTier(
  causalChain: Record<string, unknown> | null | undefined,
  nodeId: string,
  edges: ReadonlyArray<MethodTierEdge>,
): MethodTierResult {
  const persisted = readPersistedMethodTier(causalChain);
  if (persisted.tier) return persisted;
  return deriveMethodTierFromEdges(nodeId, edges);
}
