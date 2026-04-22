// ── Rich KG context formatter for the strategy LLM ──
//
// Problem (audited 2026-04-21): strategy-engine's final recommendation
// call reached the LLM with entity names + centrality only. Causal
// roles, manifold dimensions, temporal validity, edge polarity,
// dynamics, conditions, and supporting evidence claims — all of it was
// in the DB, none of it in the prompt. Outputs read generic because
// the LLM had no semantic substrate to ground against.
//
// Solution: a disciplined rich-context block the strategy engine
// prepends to its final LLM user message. Not a data dump — an
// editor's selection:
//
//   • Rank + cap: top N entities by importance, top claims by
//     confidence, top edges by confidence. Hard ceilings so a huge
//     space can't balloon the prompt.
//   • Skip defaults: if a field is empty, default-valued, or neutral
//     (e.g. polarity=neutral, topology=disjoint), omit it. Defaults
//     are noise — they crowd the signal fields.
//   • Prose over JSON: the LLM reads "C3 Customer Churn (concrete,
//     LEVERAGE, high confidence)" better than a key-value bag. Prose
//     discourages enumeration-back in the output.
//   • Instructional discipline: the caller prepends a directive
//     telling the LLM to USE this as grounding, not RESTATE it.
//
// Net: strategies stop saying "improve customer retention" and start
// saying "tighten the churn feedback loop C3→C7 — reversible,
// empirically grounded, 0.82 confidence, targets the master
// bottleneck."

import type { Entity, Edge, Claim } from "@/types";

// ── Tunable caps ──
// If these are too aggressive, the LLM flattens distinct entities
// into generic prose. If too loose, the prompt bloats and output
// quality degrades. These are the values tuned to balance that:

/** Hard ceiling on entities emitted. Prefers importance rank. */
const MAX_ENTITIES = 18;

/** Hard ceiling on claims per entity. Ranked by confidence desc. */
const MAX_CLAIMS_PER_ENTITY = 2;

/** Hard ceiling on outgoing edges emitted per entity. */
const MAX_EDGES_PER_ENTITY = 4;

/** Edges below this confidence aren't worth the prompt space — their
 *  uncertainty exceeds the reasoning value they add. */
const EDGE_CONFIDENCE_FLOOR = 0.35;

/** Claims below this confidence are speculation — skip. */
const CLAIM_CONFIDENCE_FLOOR = 0.4;

// ── Importance → rank ordering ──
const IMPORTANCE_RANK: Record<string, number> = {
  fundamental: 0,
  critical: 1,
  important: 2,
  moderate: 3,
  peripheral: 4,
};

function importanceScore(e: Entity): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imp = (e as any).importance as string | null;
  return IMPORTANCE_RANK[imp ?? "peripheral"] ?? 5;
}

function entityConfidence(e: Entity): number {
  const c = (e as Entity & { confidence?: number | null }).confidence;
  return typeof c === "number" ? c : 0.5;
}

// ── Field-presence helpers ──
// These exist so we can skip default / empty values cleanly. Every
// "undefined/empty/default" returned here becomes a prompt slot saved.

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function meaningfulPolarity(p: string | null | undefined): p is string {
  return nonEmpty(p) && p !== "neutral";
}

function meaningfulTopology(t: string | null | undefined): t is string {
  return nonEmpty(t) && t !== "disjoint";
}

function meaningfulDynamics(d: string | null | undefined): d is string {
  return nonEmpty(d) && d !== "linear" && d !== "unknown";
}

function meaningfulDecay(dr: string | null | undefined): dr is string {
  return nonEmpty(dr) && dr !== "none" && dr !== "slow";
}

// ── Entity line ──
// Prose form: "C3 Customer Churn · concrete, CRITICAL, LEVERAGE, conf 0.82, driver — [description].
// Strategic: alignment=high, reversibility=costly. Evidence: empirical, established consensus."

function formatEntityLine(e: Entity): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ae = e as any;
  const parts: string[] = [];

  const code = nonEmpty(e.entity_id) ? e.entity_id : null;
  const name = nonEmpty(e.name) ? e.name : "(unnamed)";
  parts.push(code ? `${code} ${name}` : name);

  const flags: string[] = [];
  if (ae.entity_category) flags.push(ae.entity_category);
  if (ae.importance && ae.importance !== "peripheral")
    flags.push(String(ae.importance).toUpperCase());
  if (e.is_leverage_point) flags.push("LEVERAGE");
  if (e.is_risk_point) flags.push("RISK");
  if (ae.is_master_bottleneck) flags.push("BOTTLENECK");
  const conf = entityConfidence(e);
  flags.push(`conf ${conf.toFixed(2)}`);
  if (ae.causal_role) flags.push(`role=${ae.causal_role}`);
  if (ae.knowledge_layer && ae.knowledge_layer !== "internal")
    flags.push(ae.knowledge_layer);

  let line = `${parts[0]} · ${flags.join(", ")}`;

  if (nonEmpty(e.description)) {
    const desc = e.description.trim().replace(/\s+/g, " ");
    const short = desc.length > 220 ? `${desc.slice(0, 217)}…` : desc;
    line += ` — ${short}`;
  }

  // Optional second sub-line: manifold + temporal signals when they
  // have meaningful content. Stays terse; full JSON never emitted.
  const m = ae.manifold as Record<string, Record<string, unknown>> | undefined;
  const signals: string[] = [];
  if (m?.strategic) {
    const s = m.strategic;
    if (s.alignment_to_goal && s.alignment_to_goal !== "medium")
      signals.push(`align=${s.alignment_to_goal}`);
    if (s.reversibility && s.reversibility !== "moderate")
      signals.push(`reversibility=${String(s.reversibility).replace(/_/g, " ")}`);
  }
  if (m?.epistemic) {
    const ep = m.epistemic;
    if (ep.evidence_strength && ep.evidence_strength !== "partial")
      signals.push(`evidence=${ep.evidence_strength}`);
    if (ep.consensus_level && ep.consensus_level !== "partial")
      signals.push(`consensus=${ep.consensus_level}`);
  }
  if (m?.operational?.maturity && m.operational.maturity !== "partial") {
    signals.push(`maturity=${m.operational.maturity}`);
  }
  const tv = ae.temporal_validity as Record<string, string> | undefined;
  if (tv && meaningfulDecay(tv.decay_rate)) {
    signals.push(`decay=${tv.decay_rate}`);
  }
  if (signals.length > 0) {
    line += `\n    ↳ ${signals.join("; ")}`;
  }

  return line;
}

// ── Claim line ──
// "empirical: churn rises after pricing change (0.82)"
function formatClaimLine(c: Claim): string {
  const confBit = Number.isFinite(c.confidence)
    ? ` (${Number(c.confidence).toFixed(2)})`
    : "";
  const typeBit = nonEmpty(c.claim_type) ? `${c.claim_type}: ` : "";
  const text = c.claim_text.trim().replace(/\s+/g, " ");
  const short = text.length > 180 ? `${text.slice(0, 177)}…` : text;
  return `    • ${typeBit}${short}${confBit}`;
}

// ── Edge line ──
// "→ C7 (causal, positive, threshold, conf 0.74, when=price above $X)"
function formatEdgeLine(
  edge: Edge,
  nameByResolver: (id: string) => string,
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ae = edge as any;
  const targetName = nameByResolver(edge.target_entity_id);

  const flags: string[] = [];
  if (nonEmpty(ae.dimension) && ae.dimension !== "unknown") flags.push(ae.dimension);
  if (meaningfulPolarity(ae.polarity)) flags.push(ae.polarity);
  if (meaningfulDynamics(ae.dynamics)) flags.push(ae.dynamics);
  if (meaningfulTopology(ae.topology)) flags.push(`topology=${ae.topology}`);
  const conf = typeof edge.confidence === "number" ? edge.confidence : 0.5;
  flags.push(`conf ${conf.toFixed(2)}`);

  let line = `    → ${targetName} (${flags.join(", ")})`;

  if (nonEmpty(ae.conditions)) {
    const cond = ae.conditions.trim().replace(/\s+/g, " ");
    const short = cond.length > 140 ? `${cond.slice(0, 137)}…` : cond;
    line += ` when ${short}`;
  }

  // Utility sub-fields land as a tiny third line ONLY when they'd
  // materially affect a strategic decision (failure consequence, info
  // value, decision question). Quiet otherwise.
  const u = ae.utility as Record<string, unknown> | undefined;
  if (u) {
    const hits: string[] = [];
    if (nonEmpty(u.failure_consequence as string)) {
      hits.push(`fails → ${String(u.failure_consequence).slice(0, 60)}`);
    }
    if (nonEmpty(u.decision_question as string)) {
      hits.push(`decide: ${String(u.decision_question).slice(0, 70)}`);
    }
    if (hits.length > 0) line += `\n        ${hits.join(" · ")}`;
  }

  return line;
}

// ── Public entry point ──

export interface FormatRichKgContextOpts {
  maxEntities?: number;
  maxClaimsPerEntity?: number;
  maxEdgesPerEntity?: number;
}

/**
 * Build the structured ground-truth block that the strategy LLM will
 * reference when crafting recommendations. Disciplined: ranked, capped,
 * default-suppressed, prose over JSON.
 *
 * Returns null when the KG is empty — callers should skip prepending
 * the block in that case (don't emit an empty section header).
 */
export function formatRichKgContextForStrategy(
  entities: Entity[],
  edges: Edge[],
  claims: Claim[],
  opts: FormatRichKgContextOpts = {},
): string | null {
  if (entities.length === 0) return null;

  const maxEntities = opts.maxEntities ?? MAX_ENTITIES;
  const maxClaims = opts.maxClaimsPerEntity ?? MAX_CLAIMS_PER_ENTITY;
  const maxEdges = opts.maxEdgesPerEntity ?? MAX_EDGES_PER_ENTITY;

  // Rank entities: importance asc (lower = more important), then
  // centrality_rank asc when present, then confidence desc.
  const ranked = [...entities].sort((a, b) => {
    const impDiff = importanceScore(a) - importanceScore(b);
    if (impDiff !== 0) return impDiff;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cra = (a as any).centrality_rank as number | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crb = (b as any).centrality_rank as number | null;
    if (cra != null && crb != null) return cra - crb;
    if (cra != null) return -1;
    if (crb != null) return 1;
    return entityConfidence(b) - entityConfidence(a);
  });

  const top = ranked.slice(0, maxEntities);
  const topIdSet = new Set<string>();
  for (const e of top) {
    topIdSet.add(e.id);
    if (e.entity_id) topIdSet.add(e.entity_id);
  }

  // Index claims by source_entity_id (UUID in DB).
  const claimsById = new Map<string, Claim[]>();
  for (const c of claims) {
    if (!c.source_entity_id) continue;
    if (!Number.isFinite(c.confidence) || c.confidence < CLAIM_CONFIDENCE_FLOOR)
      continue;
    const arr = claimsById.get(c.source_entity_id) ?? [];
    arr.push(c);
    claimsById.set(c.source_entity_id, arr);
  }

  // Index edges by source_entity_id (accept either UUID or entity_id
  // since legacy rows use either).
  const edgesBySrc = new Map<string, Edge[]>();
  for (const e of edges) {
    const conf = typeof e.confidence === "number" ? e.confidence : 0.5;
    if (conf < EDGE_CONFIDENCE_FLOOR) continue;
    const key = e.source_entity_id;
    if (!key) continue;
    // Only render edges whose BOTH endpoints are in the top set —
    // edges pointing into peripheral entities add noise.
    if (!topIdSet.has(key) || !topIdSet.has(e.target_entity_id)) continue;
    const arr = edgesBySrc.get(key) ?? [];
    arr.push(e);
    edgesBySrc.set(key, arr);
  }

  // Build an id → display name resolver: prefer entity_code when
  // present ("C3"), fall back to full name.
  const displayByAnyId = new Map<string, string>();
  for (const e of top) {
    const display = e.entity_id ?? e.name ?? e.id.slice(0, 6);
    displayByAnyId.set(e.id, display);
    if (e.entity_id) displayByAnyId.set(e.entity_id, display);
  }
  const resolveName = (id: string) =>
    displayByAnyId.get(id) ?? `${id.slice(0, 6)}…`;

  const lines: string[] = [];
  lines.push("## Knowledge graph — grounding (use these as your facts, do not enumerate back)");
  lines.push(
    `${top.length} top-ranked entities selected from ${entities.length} total. ` +
      `Fields listed only when non-default. Use them to justify tradeoffs, not to restate properties.`,
  );
  lines.push("");

  for (const e of top) {
    lines.push(formatEntityLine(e));

    const eClaims = (claimsById.get(e.id) ?? [])
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, maxClaims);
    for (const c of eClaims) {
      lines.push(formatClaimLine(c));
    }

    const eEdges = (edgesBySrc.get(e.id) ?? edgesBySrc.get(e.entity_id ?? "") ?? [])
      .sort(
        (a, b) =>
          (typeof b.confidence === "number" ? b.confidence : 0) -
          (typeof a.confidence === "number" ? a.confidence : 0),
      )
      .slice(0, maxEdges);
    for (const edge of eEdges) {
      lines.push(formatEdgeLine(edge, resolveName));
    }

    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
