// ── Numerical reality calibration (R2 — Tier 1 → Tier 4 bridge) ──────
//
// Replaces the LLM-judgment step of `runRealityCalibration` with a
// deterministic numerical comparison for baselines where the data
// actually exists:
//
//   Tier 4 path — tracker observation:
//     When `baseline.tracker_id` is set, look up the linked
//     `metric_trackers.current_value` and/or the latest
//     `metric_observations.value`. Compute relative_error vs
//     baseline.value; verdict = reproduced / off based on tolerance.
//     Pure arithmetic, no LLM.
//
//   Tier 3 path — entity parameter:
//     When no tracker exists but `baseline.value` is numeric, search
//     the calibration subgraph's entity.parameters for a
//     lexically-similar key with a numeric value within tolerance.
//     Still deterministic — the LLM isn't asked to judge, just the
//     parameter-map lookup is done.
//
// For baselines that fall through BOTH paths (qualitative, no tracker,
// no matching parameter), the orchestrator falls back to the existing
// LLM audit. That verdict is then tagged `verdict_provenance: "llm_audit"`
// so the UI discloses the difference.
//
// This module deliberately does NOT call the LLM. It returns a list of
// resolved attempts + a list of unresolved baselines for the
// orchestrator to pass to the LLM. Clean separation: numerical code
// here, LLM code in `reality-calibration.ts`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { MetricBaseline } from "@/types/prediction";
import type { ReproductionAttempt } from "@/types/calibration";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

const DEFAULT_TOLERANCE = 0.10;
const MAX_OBSERVATION_AGE_DAYS = 180; // observations older than this are stale

export interface NumericalCalibrationInput {
  baselines: MetricBaseline[];
  /** Subgraph produced by the calibration orchestrator — entities with
   *  parameter maps, used for the Tier 3 parameter-lookup path. */
  subgraph: {
    entities: Array<{
      entity_id: string;
      name: string;
      description: string | null;
      entity_category: string | null;
      parameters: Record<string, number | string | null>;
    }>;
    edges: unknown[]; // not used numerically — kept for shape compat
  };
}

export interface NumericalCalibrationResult {
  /** Attempts resolved deterministically — these do NOT need the LLM. */
  resolved: ReproductionAttempt[];
  /** Baselines the numerical path couldn't reconcile. Pass these to
   *  the LLM orchestrator as today. */
  unresolved: MetricBaseline[];
}

/**
 * Try to numerically reconcile every baseline. Returns resolved +
 * unresolved slices. The orchestrator only calls the LLM for the
 * unresolved ones, minimizing latency + cost AND moving credibility
 * up a tier for everything we CAN reconcile.
 */
export async function runNumericalCalibration(
  db: DB,
  input: NumericalCalibrationInput,
): Promise<NumericalCalibrationResult> {
  const resolved: ReproductionAttempt[] = [];
  const unresolved: MetricBaseline[] = [];

  // Pre-fetch tracker rows for every tracker_id referenced by the
  // baselines — one DB roundtrip instead of N.
  const trackerIds = Array.from(
    new Set(
      input.baselines
        .map((b) => b.tracker_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const trackerById = new Map<
    string,
    { current_value: number | null; baseline_value: number | null; label: string; unit: string | null }
  >();
  if (trackerIds.length > 0) {
    try {
      const { data } = await db
        .from("metric_trackers")
        .select("id, current_value, baseline_value, label, unit")
        .in("id", trackerIds);
      for (const row of (data ?? []) as Array<{
        id: string;
        current_value: number | null;
        baseline_value: number | null;
        label: string;
        unit: string | null;
      }>) {
        trackerById.set(row.id, {
          current_value: row.current_value,
          baseline_value: row.baseline_value,
          label: row.label,
          unit: row.unit,
        });
      }
    } catch (err) {
      console.warn(
        "[numerical-calibration] tracker fetch failed (will fall back to LLM):",
        err,
      );
    }
  }

  // For each tracker, also pull the most recent observation — that's
  // often more authoritative than current_value (which can lag).
  const latestObservationByTracker = new Map<
    string,
    { value: number | null; recorded_at: string }
  >();
  if (trackerIds.length > 0) {
    try {
      const cutoff = new Date(
        Date.now() - MAX_OBSERVATION_AGE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data } = await db
        .from("metric_observations")
        .select("tracker_id, value, recorded_at")
        .in("tracker_id", trackerIds)
        .gte("recorded_at", cutoff)
        .order("recorded_at", { ascending: false });
      const rows = (data ?? []) as Array<{
        tracker_id: string;
        value: number | null;
        recorded_at: string;
      }>;
      for (const r of rows) {
        if (!latestObservationByTracker.has(r.tracker_id)) {
          latestObservationByTracker.set(r.tracker_id, {
            value: r.value,
            recorded_at: r.recorded_at,
          });
        }
      }
    } catch (err) {
      console.warn(
        "[numerical-calibration] observation fetch failed (non-fatal):",
        err,
      );
    }
  }

  // ── Per-baseline resolution ─────────────────────────────────────
  for (const b of input.baselines) {
    // Qualitative baselines (value_text only) can't be numerically
    // reconciled — hand them straight to the LLM.
    if (typeof b.value !== "number" || !Number.isFinite(b.value)) {
      unresolved.push(b);
      continue;
    }

    const tolerance = chooseTolerance(b);

    // ── Tier 4: tracker + observation comparison ─────────────────
    if (b.tracker_id && trackerById.has(b.tracker_id)) {
      const tracker = trackerById.get(b.tracker_id)!;
      const latestObs = latestObservationByTracker.get(b.tracker_id);
      // Prefer the most recent observation; fall back to
      // tracker.current_value; fall back to tracker.baseline_value.
      const currentNumeric =
        latestObs?.value ??
        tracker.current_value ??
        tracker.baseline_value ??
        null;

      if (typeof currentNumeric === "number" && Number.isFinite(currentNumeric)) {
        const relative_error = computeRelativeError(currentNumeric, b.value);
        const verdict: ReproductionAttempt["verdict"] =
          relative_error <= tolerance ? "reproduced" : "off";
        const source = latestObs
          ? `latest metric observation (recorded ${latestObs.recorded_at.slice(0, 10)})`
          : tracker.current_value !== null
            ? "tracker current_value"
            : "tracker baseline_value";
        resolved.push({
          baseline: b,
          computed_value: currentNumeric,
          relative_error,
          verdict,
          tolerance,
          rationale: `Numerical reconciliation via ${source}: ${b.value}${b.unit ? ` ${b.unit}` : ""} stated vs ${currentNumeric}${tracker.unit ? ` ${tracker.unit}` : ""} observed (relative error ${(relative_error * 100).toFixed(1)}%, tolerance ${(tolerance * 100).toFixed(1)}%).`,
          blocker_entity_ids: verdict === "off" ? [] : [],
          verdict_provenance: "numerical_recompute",
        });
        continue;
      }
      // Tracker exists but no numeric value available — fall through
      // to Tier 3 (entity parameter lookup) before giving up.
    }

    // ── Tier 3: entity parameter lookup ──────────────────────────
    const paramMatch = findMatchingEntityParameter(
      b,
      input.subgraph.entities,
    );
    if (paramMatch) {
      const relative_error = computeRelativeError(
        paramMatch.value,
        b.value,
      );
      const verdict: ReproductionAttempt["verdict"] =
        relative_error <= tolerance ? "reproduced" : "off";
      resolved.push({
        baseline: b,
        computed_value: paramMatch.value,
        relative_error,
        verdict,
        tolerance,
        rationale: `Numerical reconciliation via entity parameter "${paramMatch.key}" on entity "${paramMatch.entityName}": ${b.value}${b.unit ? ` ${b.unit}` : ""} stated vs ${paramMatch.value} on the KG (relative error ${(relative_error * 100).toFixed(1)}%, tolerance ${(tolerance * 100).toFixed(1)}%).`,
        blocker_entity_ids: verdict === "off" ? [paramMatch.entityId] : [],
        verdict_provenance: "numerical_recompute",
      });
      continue;
    }

    // No deterministic path for this baseline — hand to LLM.
    unresolved.push(b);
  }

  return { resolved, unresolved };
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Pick a tolerance appropriate to the baseline's source_kind + unit.
 * Money, counts, and ratios get tighter tolerance; qualitative-adjacent
 * metrics (engagement, satisfaction) get looser.
 */
function chooseTolerance(b: MetricBaseline): number {
  const unit = (b.unit ?? "").toLowerCase();
  // Tight: money, percentages, conversion rates, counts.
  if (
    unit.includes("$") ||
    unit.includes("usd") ||
    unit.includes("eur") ||
    unit === "%" ||
    unit.includes("count") ||
    unit === "each" ||
    unit === "units"
  ) {
    return 0.05;
  }
  // Loose: free-form "score" / "rating" / "index" units typically have
  // higher noise.
  if (unit.includes("score") || unit.includes("rating") || unit.includes("index")) {
    return 0.20;
  }
  return DEFAULT_TOLERANCE;
}

function computeRelativeError(computed: number, stated: number): number {
  // Denominator floor at 1 (matches ReproductionAttempt type comment).
  // Preserves bounded values for near-zero baselines without lying.
  const denom = Math.max(Math.abs(stated), 1);
  return Math.abs(computed - stated) / denom;
}

/**
 * Search the subgraph's entity parameters for a numeric value whose
 * parameter-KEY is lexically similar to the baseline label. Returns the
 * first match, or null when no parameter looks relevant.
 *
 * Matching rules:
 *   - Tokenize baseline.label and each parameter key (split on non-word
 *     chars, lowercase).
 *   - Require at least ONE token overlap AND one of:
 *       * parameter value is within 10× of baseline.value (ballpark
 *         sanity — prevents "customer_id=42" matching a rate baseline)
 *       * parameter key exactly matches the last token of the baseline
 *         label (e.g. baseline "customer_churn_rate" → key "rate")
 */
function findMatchingEntityParameter(
  b: MetricBaseline,
  entities: NumericalCalibrationInput["subgraph"]["entities"],
): { entityId: string; entityName: string; key: string; value: number } | null {
  const baselineTokens = tokenize(b.label);
  if (baselineTokens.length === 0) return null;
  const baselineValue = b.value as number;

  for (const e of entities) {
    const params = e.parameters ?? {};
    for (const [key, rawVal] of Object.entries(params)) {
      if (typeof rawVal !== "number" || !Number.isFinite(rawVal)) continue;
      const keyTokens = tokenize(key);
      if (keyTokens.length === 0) continue;
      const overlap = keyTokens.filter((kt) => baselineTokens.includes(kt));
      if (overlap.length === 0) continue;
      // Ballpark check: accept if within 10× of baseline magnitude OR
      // if the overlap is strong (≥2 tokens or last-token exact match).
      const magnitudeRatio =
        Math.abs(rawVal) === 0
          ? 1
          : Math.abs(baselineValue) === 0
            ? Number.POSITIVE_INFINITY
            : Math.max(Math.abs(rawVal), Math.abs(baselineValue)) /
              Math.max(
                Math.min(Math.abs(rawVal), Math.abs(baselineValue)),
                1e-9,
              );
      const strongOverlap =
        overlap.length >= 2 ||
        keyTokens[keyTokens.length - 1] ===
          baselineTokens[baselineTokens.length - 1];
      if (!strongOverlap && magnitudeRatio > 10) continue;
      return {
        entityId: e.entity_id,
        entityName: e.name,
        key,
        value: rawVal,
      };
    }
  }
  return null;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}
