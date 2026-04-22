// ── runLearningMeasure — shared core ──
//
// Factored out of /api/pipeline/learning-measure so the end-of-run
// hook (strategy-refresh terminal block) can call it inline. The
// HTTP endpoint wraps this same function.
//
// Soft-fail: returns a result with `success: false` rather than
// throwing, so a measurement miss never blocks the pipeline.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCalibration,
  computeCitationDensity,
  computeCoverageDepth,
  computeNoveltyRate,
} from "./metric-computers";
import type { CoarseDomain } from "@/lib/research/source-strategy";
import type { Entity } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const ALLOWED_DOMAINS: CoarseDomain[] = [
  "business",
  "finance_macro",
  "medical",
  "science_hard",
  "science_cognitive",
  "engineering",
  "policy_legal",
  "personal",
  "cultural_social",
  "creative",
  "generic",
];

export interface RunLearningMeasureOpts {
  spaceId: string;
  userId: string;
  /** CoarseDomain string — falls back to "generic" if unknown. */
  domain?: string | null;
}

export interface RunLearningMeasureResult {
  success: boolean;
  measurementId: string | null;
  measuredAt: string | null;
  domain: CoarseDomain;
  metrics: {
    coverage_depth: number;
    calibration_score: number | null;
    novelty_rate: number;
    citation_density: number;
    mean_evidence_reliability: number | null;
  };
  counts: {
    entities: number;
    analyzed: number;
    evidence: number;
    resolved_predictions: number;
  };
  error?: string;
}

export async function runLearningMeasure(
  db: AnyDb,
  opts: RunLearningMeasureOpts,
): Promise<RunLearningMeasureResult> {
  const domain: CoarseDomain = (ALLOWED_DOMAINS as string[]).includes(
    opts.domain ?? "",
  )
    ? (opts.domain as CoarseDomain)
    : "generic";

  try {
    const { data: entRows, error: entErr } = await db
      .from("entities")
      .select(
        "id, name, analysis_count, evidence_strength, importance, is_leverage_point, is_risk_point, is_master_bottleneck",
      )
      .eq("space_id", opts.spaceId);
    if (entErr) {
      return emptyResult(domain, `entities load: ${entErr.message}`);
    }
    const entities = (entRows ?? []) as Array<
      Pick<
        Entity,
        | "id"
        | "name"
        | "analysis_count"
        | "evidence_strength"
        | "importance"
        | "is_leverage_point"
        | "is_risk_point"
        | "is_master_bottleneck"
      >
    >;

    let evidenceReliabilities: Array<number | null> = [];
    let evidenceCount = 0;
    try {
      const { data: evLinks } = await db
        .from("claim_evidence_links")
        .select(
          "evidence_id, claims!inner(space_id), evidence_items!inner(reliability_prior)",
        )
        .eq("claims.space_id", opts.spaceId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (evLinks ?? []) as any[];
      evidenceCount = rows.length;
      evidenceReliabilities = rows.map(
        (r) => r.evidence_items?.reliability_prior ?? null,
      );
    } catch (err) {
      console.warn("[learning/run-measure] evidence join soft-fail:", err);
    }

    let resolvedPreds: Array<{
      deviation: number | null;
      confidence: number | null;
    }> = [];
    try {
      const { data: predRows } = await db
        .from("prediction_ledger")
        .select("deviation, confidence, status")
        .eq("user_id", opts.userId)
        .eq("status", "resolved");
      resolvedPreds = (predRows ?? []).map(
        (r: { deviation: number | null; confidence: number | null }) => ({
          deviation: r.deviation,
          confidence: r.confidence,
        }),
      );
    } catch (err) {
      console.warn("[learning/run-measure] predictions soft-fail:", err);
    }

    let priorEntityNames: string[] = [];
    try {
      const { data: priorMeasurements } = await db
        .from("domain_learning_measurements")
        .select("space_id")
        .eq("user_id", opts.userId)
        .eq("domain", domain)
        .neq("space_id", opts.spaceId)
        .order("measured_at", { ascending: false })
        .limit(10);
      const priorSpaceIds = (priorMeasurements ?? [])
        .map((m: { space_id: string | null }) => m.space_id)
        .filter((v: string | null): v is string => typeof v === "string");
      if (priorSpaceIds.length > 0) {
        const { data: priorEnts } = await db
          .from("entities")
          .select("name")
          .in("space_id", priorSpaceIds);
        priorEntityNames = (priorEnts ?? []).map(
          (e: { name: string }) => e.name,
        );
      }
    } catch (err) {
      console.warn("[learning/run-measure] novelty lookup soft-fail:", err);
    }

    const coverageDepth = computeCoverageDepth({ entities });
    const calibration = computeCalibration({ predictions: resolvedPreds });
    const citation = computeCitationDensity({
      entityCount: entities.length,
      evidenceCount,
      evidenceReliabilities,
    });
    const novelty = computeNoveltyRate({
      currentEntityNames: entities.map((e) => e.name),
      priorEntityNames,
    });

    const analyzedCount = entities.filter(
      (e) => (e.analysis_count ?? 0) > 0 || (e.evidence_strength ?? 0) > 0,
    ).length;

    const row = {
      user_id: opts.userId,
      space_id: opts.spaceId,
      domain,
      coverage_depth: coverageDepth,
      calibration_score: calibration.score,
      novelty_rate: novelty,
      citation_density: citation.density,
      mean_evidence_reliability: citation.meanReliability,
      entity_count: entities.length,
      analyzed_entity_count: analyzedCount,
      evidence_count: evidenceCount,
      resolved_prediction_count: calibration.resolvedCount,
      raw_features: {
        mean_abs_deviation: calibration.meanAbsDeviation,
        evidence_per_entity: citation.perEntity,
        prior_spaces_seen: priorEntityNames.length > 0,
        prior_entity_names_sample: priorEntityNames.slice(0, 20),
      },
    };

    const { data: inserted, error: insErr } = await db
      .from("domain_learning_measurements")
      .insert(row)
      .select("id, measured_at")
      .single();
    if (insErr) {
      return emptyResult(domain, `measurement insert: ${insErr.message}`);
    }

    return {
      success: true,
      measurementId: (inserted as { id: string } | null)?.id ?? null,
      measuredAt:
        (inserted as { measured_at: string } | null)?.measured_at ?? null,
      domain,
      metrics: {
        coverage_depth: coverageDepth,
        calibration_score: calibration.score,
        novelty_rate: novelty,
        citation_density: citation.density,
        mean_evidence_reliability: citation.meanReliability,
      },
      counts: {
        entities: entities.length,
        analyzed: analyzedCount,
        evidence: evidenceCount,
        resolved_predictions: calibration.resolvedCount,
      },
    };
  } catch (err) {
    return emptyResult(
      domain,
      err instanceof Error ? err.message : "learning-measure threw",
    );
  }
}

function emptyResult(
  domain: CoarseDomain,
  error: string,
): RunLearningMeasureResult {
  return {
    success: false,
    measurementId: null,
    measuredAt: null,
    domain,
    metrics: {
      coverage_depth: 0,
      calibration_score: null,
      novelty_rate: 1,
      citation_density: 0,
      mean_evidence_reliability: null,
    },
    counts: {
      entities: 0,
      analyzed: 0,
      evidence: 0,
      resolved_predictions: 0,
    },
    error,
  };
}
