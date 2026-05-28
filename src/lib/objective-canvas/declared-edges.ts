// ── Declared-primary edge builder (Arc 3.2 / 3.6) ──────────────────
//
// Pure helper that turns each feature's DECLARED causal bindings
// (addresses[] {pain, root_cause}, moves[] {outcome, indicator,
// direction}) into Pain→Feature + Feature→Outcome edge rows.
//
// Why pure + extracted: this exact logic is needed in TWO places —
// the one-shot room/generate "all" path AND the second-phase
// /room/[subId]/mechanisms endpoint (the checkpoint flow). Extracting
// it keeps them from drifting. No DB, no async — the caller inserts
// the returned rows and uses declaredPairs to dedupe the supplementary
// correlation pass.
//
// These edges reflect the mechanism's STATED causal intent, so they're
// higher-confidence than the inferred correlation pass — which then
// runs only to fill links the features didn't declare.

import type { FeatureItem } from "./layered-generation";

export interface DeclaredEdgeInput {
  /** Features carrying their declared bindings (name + addresses + moves). */
  features: Array<Pick<FeatureItem, "name" | "addresses" | "moves">>;
  /** Persisted pain entities (id + name) to resolve addresses[].pain. */
  painEntities: Array<{ id: string; name: string }>;
  /** Persisted outcome entities (id + name) to resolve moves[].outcome. */
  outcomeEntities: Array<{ id: string; name: string }>;
  /** Persisted feature entities (id + name) to resolve the feature endpoint. */
  featureEntities: Array<{ id: string; name: string }>;
  spaceId: string;
  subObjectiveId: string;
}

export interface DeclaredEdgeResult {
  /** Edge rows ready for `db.from("edges").insert(rows)`. */
  rows: Array<Record<string, unknown>>;
  /** `${sourceId}|${targetId}` pairs — pass to the correlation pass so
   *  it can dedupe (both directions) and only add undeclared links. */
  declaredPairs: Set<string>;
}

/** Resolve a declared endpoint name → entity id. Exact (case-
 *  insensitive) first, then a contains-fallback for slight LLM
 *  paraphrases. Returns null when nothing plausibly matches (the
 *  binding is dropped — correlation may still catch it). */
function resolveId(m: Map<string, string>, name: string): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  const exact = m.get(lower);
  if (exact) return exact;
  for (const [k, v] of m) {
    if (k.includes(lower) || lower.includes(k)) return v;
  }
  return null;
}

export function buildDeclaredEdgeRows(
  input: DeclaredEdgeInput,
): DeclaredEdgeResult {
  const painIdByName = new Map<string, string>();
  const outcomeIdByName = new Map<string, string>();
  const featureIdByName = new Map<string, string>();
  for (const e of input.painEntities)
    painIdByName.set(e.name.toLowerCase(), e.id);
  for (const e of input.outcomeEntities)
    outcomeIdByName.set(e.name.toLowerCase(), e.id);
  for (const e of input.featureEntities)
    featureIdByName.set(e.name.toLowerCase(), e.id);

  const declaredPairs = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];

  for (const f of input.features) {
    const fid = featureIdByName.get(f.name.toLowerCase());
    if (!fid) continue;
    for (const a of f.addresses ?? []) {
      const pid = resolveId(painIdByName, a.pain);
      if (!pid) continue;
      const key = `${pid}|${fid}`;
      if (declaredPairs.has(key)) continue;
      declaredPairs.add(key);
      rows.push({
        space_id: input.spaceId,
        parent_sub_objective_id: input.subObjectiveId,
        source_entity_id: pid,
        target_entity_id: fid,
        relationship_type: "addressed_by",
        dimension: "causal",
        source_tag: "inferred",
        strength: 0.72,
        polarity: "negative",
        confidence: 0.7,
        conditions: a.root_cause
          ? `Declared: feature addresses root cause "${a.root_cause}"`.slice(
              0,
              500,
            )
          : "Declared binding (feature addresses pain)",
        agent_feedback: {
          mechanism: a.root_cause ? a.root_cause.slice(0, 60) : "addresses pain",
          binding: "declared",
          ...(a.root_cause ? { root_cause: a.root_cause } : {}),
        },
      });
    }
    for (const mv of f.moves ?? []) {
      const oid = resolveId(outcomeIdByName, mv.outcome);
      if (!oid) continue;
      const key = `${fid}|${oid}`;
      if (declaredPairs.has(key)) continue;
      declaredPairs.add(key);
      rows.push({
        space_id: input.spaceId,
        parent_sub_objective_id: input.subObjectiveId,
        source_entity_id: fid,
        target_entity_id: oid,
        // "produces" edge — the feature positively produces the desired
        // outcome state. The indicator's good direction lives in
        // agent_feedback.direction; edge polarity is positive because
        // the feature drives the outcome (matches the enrich-chains
        // complementary-edge convention).
        relationship_type: "produces",
        dimension: "causal",
        source_tag: "inferred",
        strength: 0.72,
        polarity: "positive",
        confidence: 0.7,
        conditions: mv.indicator
          ? `Declared: feature moves indicator "${mv.indicator}" (${mv.direction})`.slice(
              0,
              500,
            )
          : "Declared binding (feature produces outcome)",
        agent_feedback: {
          mechanism: mv.indicator ? mv.indicator.slice(0, 60) : "produces outcome",
          binding: "declared",
          ...(mv.indicator ? { indicator: mv.indicator } : {}),
          direction: mv.direction,
        },
      });
    }
  }

  return { rows, declaredPairs };
}
