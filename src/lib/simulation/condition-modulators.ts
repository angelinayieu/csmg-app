// ── Condition modulators (simulation-side helpers) ──────────────────────
//
// Joins subjects.conditions JSONB against the condition_modulators
// table (migration 20260509_condition_modulators.sql) to produce
// per-edge effect-size multipliers. Used by the Monte Carlo
// simulator to apply per-patient calibration to edge strengths
// BEFORE propagation, and by the EnvironmentDefinition aggregator
// to surface "applied modulators" in the page drawer.
//
// Math:
//   For each edge e with N matching active modulators
//   {m_1, m_2, ..., m_N}:
//     edge.strength_personalized = edge.strength_population * Π m_i.multiplier_p50
//
//   The p50 product is the central-estimate path. Per-iteration
//   sampling from (p10, p90) for honest uncertainty propagation
//   is a future ticket — today we use the point estimate.
//
//   Multipliers compose multiplicatively because they represent
//   independent biological effects (e.g., post-chemo dampens BDNF
//   response by 0.55 AND high-stress dampens it independently by
//   0.7 → combined 0.55 × 0.7 = 0.385). When two modulators target
//   the same biological pathway and aren't independent, the
//   modulator-extraction pipeline should fold them into a single
//   row.

/** Mirror of public.condition_modulators row shape. */
export interface ConditionModulatorRow {
  id: string;
  space_id: string;
  condition_key: string;
  value_match: string | null;
  target_edge_id: string;
  multiplier_p10: number;
  multiplier_p50: number;
  multiplier_p90: number;
  source_evidence_ids: string[];
  rationale: string | null;
  population_label: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// value_match evaluation
// ────────────────────────────────────────────────────────────────────────
//
// Supported clause forms (per migration 20260509_condition_modulators):
//   null / undefined / "" — always-on
//   "<N", "<=N", ">N", ">=N" — numeric comparison (N parses as number)
//   "=value" — exact match (numeric or string)
//   "[a,b]" — inclusive numeric range
//   "{a,b,c}" — set membership (string match after trim)
//
// Fail-open by design: unparseable clauses return true so a typo'd
// modulator doesn't silently disappear from the page or simulation;
// the user sees it and can audit.

export function evaluateValueMatch(
  clause: string | null,
  value: unknown,
): boolean {
  if (clause === null || clause === undefined || clause.trim() === "") {
    return true;
  }
  const c = clause.trim();

  // Range: [a,b] inclusive
  const rangeMatch = c.match(/^\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]$/);
  if (rangeMatch && typeof value === "number") {
    const lo = parseFloat(rangeMatch[1]);
    const hi = parseFloat(rangeMatch[2]);
    return value >= lo && value <= hi;
  }

  // Set: {a,b,c}
  const setMatch = c.match(/^\{(.+)\}$/);
  if (setMatch) {
    const members = setMatch[1].split(",").map((s) => s.trim());
    return members.includes(String(value));
  }

  // Exact: =value
  if (c.startsWith("=")) {
    const target = c.slice(1).trim();
    if (typeof value === "number") {
      const targetNum = parseFloat(target);
      return Number.isFinite(targetNum) && value === targetNum;
    }
    if (typeof value === "boolean") {
      return target === String(value);
    }
    return String(value) === target;
  }

  // Comparison: <, <=, >, >=
  const cmpMatch = c.match(/^(<=|>=|<|>)\s*(-?[\d.]+)$/);
  if (cmpMatch && typeof value === "number") {
    const op = cmpMatch[1];
    const n = parseFloat(cmpMatch[2]);
    if (!Number.isFinite(n)) return true; // fail-open
    switch (op) {
      case "<":
        return value < n;
      case "<=":
        return value <= n;
      case ">":
        return value > n;
      case ">=":
        return value >= n;
    }
  }

  // Unparseable — fail open.
  return true;
}

// ────────────────────────────────────────────────────────────────────────
// Edge multiplier composition
// ────────────────────────────────────────────────────────────────────────

export interface EdgeMultiplierApplied {
  edge_id: string;
  multiplier_product_p50: number;
  /** Audit trail: which modulator rows fired. */
  applied_modulator_ids: string[];
}

/**
 * For each edge in the space, compute the product of all
 * condition_modulator p50 values that activate for the given
 * subject conditions. Returns a Map<edge_id, multiplier> where
 * absent edges implicitly have multiplier 1.0 (no modulation).
 *
 * Pure function — no DB. Caller fetches the modulator rows once
 * and passes them in.
 */
export function computeEdgeMultipliers(
  subjectConditions: Record<string, unknown>,
  modulators: ReadonlyArray<ConditionModulatorRow>,
): Map<string, EdgeMultiplierApplied> {
  const out = new Map<string, EdgeMultiplierApplied>();
  for (const m of modulators) {
    const conditionValue = subjectConditions[m.condition_key];
    if (conditionValue === undefined) continue;
    if (!evaluateValueMatch(m.value_match, conditionValue)) continue;

    const existing = out.get(m.target_edge_id);
    if (existing) {
      existing.multiplier_product_p50 *= m.multiplier_p50;
      existing.applied_modulator_ids.push(m.id);
    } else {
      out.set(m.target_edge_id, {
        edge_id: m.target_edge_id,
        multiplier_product_p50: m.multiplier_p50,
        applied_modulator_ids: [m.id],
      });
    }
  }
  return out;
}
