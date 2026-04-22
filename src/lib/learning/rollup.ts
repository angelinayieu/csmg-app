// ── Domain learning rollup + prompt helper (Phase 2I) ──
//
// Two consumers:
//   1. Learning panel UI — reads getUserDomainRollup and renders
//      per-domain bars.
//   2. Prompt composers (strategy-refresh, synthesize, format-kg-
//      rich-context) — call formatLearningContext to drop a short
//      "what this user already knows" preface into the LLM call.
//
// The agent uses the curve direction (last vs second-to-last
// measurement) to pick research depth defaults: if calibration in a
// domain is rising + novelty is falling, we bias toward cheaper
// reasoning; if novelty is still ~1, we invest in deep research.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface DomainRollupRow {
  domain: string;
  latest_space_id: string | null;
  coverage_depth: number;
  calibration_score: number | null;
  novelty_rate: number;
  citation_density: number;
  mean_evidence_reliability: number | null;
  entity_count: number;
  analyzed_entity_count: number;
  evidence_count: number;
  resolved_prediction_count: number;
  measured_at: string;
}

/**
 * Latest measurement per domain for a user. Uses the user_domain_
 * rollup view so callers get distinct-on-domain semantics without a
 * client-side dedupe pass.
 */
export async function getUserDomainRollup(
  db: AnyDb,
  userId: string,
): Promise<DomainRollupRow[]> {
  try {
    const { data, error } = await db
      .from("user_domain_rollup")
      .select("*")
      .eq("user_id", userId);
    if (error) {
      console.warn("[learning/rollup] select failed:", error.message);
      return [];
    }
    return (data ?? []) as DomainRollupRow[];
  } catch (err) {
    console.warn("[learning/rollup] threw:", err);
    return [];
  }
}

export interface DomainTrajectory {
  domain: string;
  coverageDelta: number | null;
  calibrationDelta: number | null;
  noveltyDelta: number | null;
  citationDelta: number | null;
  measurementCount: number;
}

/**
 * Direction of the learning curve per domain (latest minus
 * second-latest). Positive coverage/calibration/citation deltas and
 * negative novelty deltas are the "improving" signals.
 */
export async function getUserDomainTrajectory(
  db: AnyDb,
  userId: string,
  domain: string,
  lookback: number = 2,
): Promise<DomainTrajectory | null> {
  try {
    const { data, error } = await db
      .from("domain_learning_measurements")
      .select(
        "coverage_depth, calibration_score, novelty_rate, citation_density, measured_at",
      )
      .eq("user_id", userId)
      .eq("domain", domain)
      .order("measured_at", { ascending: false })
      .limit(lookback);
    if (error) {
      console.warn("[learning/trajectory] select failed:", error.message);
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];
    if (rows.length < 2) {
      return {
        domain,
        coverageDelta: null,
        calibrationDelta: null,
        noveltyDelta: null,
        citationDelta: null,
        measurementCount: rows.length,
      };
    }
    const [latest, prev] = rows;
    return {
      domain,
      coverageDelta: (latest.coverage_depth ?? 0) - (prev.coverage_depth ?? 0),
      calibrationDelta:
        latest.calibration_score !== null && prev.calibration_score !== null
          ? latest.calibration_score - prev.calibration_score
          : null,
      noveltyDelta: (latest.novelty_rate ?? 1) - (prev.novelty_rate ?? 1),
      citationDelta:
        (latest.citation_density ?? 0) - (prev.citation_density ?? 0),
      measurementCount: rows.length,
    };
  } catch (err) {
    console.warn("[learning/trajectory] threw:", err);
    return null;
  }
}

/**
 * Render a one-paragraph "what this user already knows" preface for
 * LLM prompts. Returns "" when there's no measurement history in
 * the target domain yet — callers can concat unconditionally.
 *
 * Scope: the caller is expected to pass the *current* space's
 * domain so the paragraph references only relevant expertise. We
 * don't surface unrelated domains because the LLM tends to
 * over-apply them ("you know pricing, so here's a pricing-flavored
 * answer to a medical question").
 */
export async function formatLearningContext(
  db: AnyDb,
  userId: string,
  domain: string,
): Promise<string> {
  const rollup = await getUserDomainRollup(db, userId);
  const match = rollup.find((r) => r.domain === domain);
  if (!match) return "";

  const cov = pct(match.coverage_depth);
  const cit = pct(match.citation_density);
  const nov = pct(match.novelty_rate);
  const calPart =
    match.calibration_score !== null
      ? `prior calibration ${pct(match.calibration_score)} across ${match.resolved_prediction_count} resolved prediction${match.resolved_prediction_count === 1 ? "" : "s"}`
      : `no resolved predictions yet`;

  const trajectory = await getUserDomainTrajectory(db, userId, domain);
  const trendBit =
    trajectory && trajectory.measurementCount >= 2
      ? ` Trend: coverage ${fmtDelta(trajectory.coverageDelta)}, novelty ${fmtDelta(trajectory.noveltyDelta)}, calibration ${fmtDelta(trajectory.calibrationDelta)}.`
      : "";

  return (
    `[DOMAIN PROFICIENCY — ${domain}] ` +
    `The user has ${match.entity_count} entities tracked (${cov} coverage depth) ` +
    `with ${match.evidence_count} grounded evidence items (${cit} citation density). ` +
    `${match.analyzed_entity_count} entities have been analyzed in depth. ` +
    `Novelty in this domain: ${nov} (high = new territory, low = familiar ground). ` +
    `${calPart}.${trendBit} ` +
    `Use this to calibrate depth: if coverage+calibration are high, skip re-explaining basics; ` +
    `if novelty is near 1.0, this is fresh territory and deserves slower, more exploratory reasoning.`
  );
}

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function fmtDelta(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)} pts`;
}
