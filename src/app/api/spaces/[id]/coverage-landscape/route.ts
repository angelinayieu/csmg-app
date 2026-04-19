/**
 * GET /api/spaces/[id]/coverage-landscape
 *
 * Single endpoint exposing the reflexive-loop introspection views.
 * Powers the Coverage HUD's blind-spot detector.
 *
 * Returns:
 *   dimensions[]            per-dimension coverage (which relationship types are under-examined)
 *   category_pairs[]        per-category-pair coverage (which kinds of connections we ignore)
 *   examination_levels[]    L1 vs L2 vs L3 distribution (shallow vs deep coverage)
 *   calibration[]           prospector acceptance rate per dimension
 *   high_value_uncovered[]  top 20 pairs we haven't checked, ranked by potential value
 *   summary                 aggregate stats from space_coverage_stats
 */

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const maxDuration = 15;

export interface DimensionCoverageRow {
  dimension: string;
  pair_checks: number;
  edges_found: number;
  level_2_plus: number;
  avg_examination_level: number;
  last_check_at: string | null;
}

export interface CategoryPairCoverageRow {
  category_a: string;
  category_b: string;
  pair_checks: number;
  edges_found: number;
  level_2_plus: number;
  user_accepted: number;
  user_rejected: number;
  last_check_at: string | null;
}

export interface ExaminationDistributionRow {
  examination_level: number;
  pair_checks: number;
  edges_found: number;
  avg_negative_confidence: number | null;
}

export interface CalibrationRow {
  dimension: string;
  proposed_count: number;
  accepted_count: number;
  rejected_count: number;
  unreviewed_count: number;
  acceptance_rate: number | null;
}

export interface HighValueUncoveredRow {
  entity_a_id: string;
  entity_a_name: string;
  entity_b_id: string;
  entity_b_name: string;
  priority_score: number;
  reason: string;
}

export interface CoverageSummary {
  total_checks: number;
  edges_proposed: number;
  no_edge_verdicts: number;
  level_2_plus: number;
  level_3_plus: number;
  user_reviewed: number;
  user_rejected: number;
  avg_negative_confidence: number | null;
  last_check_at: string | null;
  prospector_acceptance_rate: number | null;
}

export interface CoverageLandscape {
  dimensions: DimensionCoverageRow[];
  category_pairs: CategoryPairCoverageRow[];
  examination_levels: ExaminationDistributionRow[];
  calibration: CalibrationRow[];
  high_value_uncovered: HighValueUncoveredRow[];
  summary: CoverageSummary | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fire all queries in parallel — each view is a simple scan so the whole
  // endpoint should resolve in ~100ms even on large spaces.
  const [
    dimsRes,
    catPairsRes,
    examRes,
    calibRes,
    uncoveredRes,
    summaryRes,
  ] = await Promise.all([
    db.from("space_dimension_coverage").select("*").eq("space_id", spaceId),
    db.from("space_category_pair_coverage").select("*").eq("space_id", spaceId),
    db.from("space_examination_distribution").select("*").eq("space_id", spaceId),
    db.from("space_calibration_by_dimension").select("*").eq("space_id", spaceId),
    db.rpc("high_value_uncovered_pairs", { target_space_id: spaceId, limit_count: 20 }),
    db.from("space_coverage_stats").select("*").eq("space_id", spaceId).maybeSingle(),
  ]);

  // Graceful fallback: if the views don't exist yet (migration not applied),
  // return empty structures rather than erroring. The HUD degrades visibly
  // rather than throwing.
  const landscape: CoverageLandscape = {
    dimensions: (dimsRes.data ?? []) as DimensionCoverageRow[],
    category_pairs: (catPairsRes.data ?? []) as CategoryPairCoverageRow[],
    examination_levels: (examRes.data ?? []) as ExaminationDistributionRow[],
    calibration: (calibRes.data ?? []) as CalibrationRow[],
    high_value_uncovered: (uncoveredRes.data ?? []) as HighValueUncoveredRow[],
    summary: (summaryRes.data as CoverageSummary | null) ?? null,
  };

  return NextResponse.json(landscape);
}
