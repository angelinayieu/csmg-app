// GET /api/spaces/[id]/calibration-reliability
//
// Brier score + ECE + reliability bins for the user's confidence-stamped
// predictions. The numbers say honestly whether "0.8 confidence" claims
// are actually right 80% of the time — the only artifact in the codebase
// that grounds the system's stated uncertainty in measured outcomes.
//
// Scope:
//   default (?scope=user) — every resolved prediction this user has
//     made, across all spaces. Sample-efficient; calibration is a
//     personal property that crosses spaces.
//   ?scope=space          — restrict to this space only. Useful when
//     the user wants to know "am I better/worse calibrated *here*",
//     at the cost of a smaller sample.
//
// Below MIN_SAMPLE_FOR_CALIBRATION (20) the endpoint returns
// `enough_data: false` and null metrics — the UI hides itself rather
// than report numbers it can't defend.
//
// Hit definition: deviation_tag === 'expected' (within ±10% of
// prediction per resolve-predictions.ts thresholds). 'regime_shift' and
// 'surprise' count as misses. 'qualitative' and 'failed' are filtered
// out — neither can be cleanly bucketed as hit/miss.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  computeBrier,
  computeECE,
  computeReliabilityBins,
  toCalibrationPoints,
  MIN_SAMPLE_FOR_CALIBRATION,
  type ReliabilityBin,
} from "@/lib/learning/calibration-metrics";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface CalibrationReliabilityResponse {
  scope: "user" | "space";
  /** Resolved predictions the user has logged in the chosen scope. */
  resolved_count: number;
  /** Subset of resolved predictions that contribute to brier/ece —
   *  must carry a non-null stated confidence AND a quantitative
   *  deviation_tag ('expected' | 'regime_shift' | 'surprise'). */
  calibratable_count: number;
  /** True iff calibratable_count >= MIN_SAMPLE_FOR_CALIBRATION. When
   *  false, all metric fields are null and the UI should hide. */
  enough_data: boolean;
  /** The minimum sample needed before metrics surface — exposed so the
   *  UI can render "12 / 20 predictions until calibration is reported". */
  min_sample: number;
  brier: number | null;
  ece: number | null;
  reliability_bins: ReliabilityBin[] | null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const scopeParam = url.searchParams.get("scope");
  const scope: "user" | "space" = scopeParam === "space" ? "space" : "user";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("prediction_ledger")
    .select("confidence, deviation_tag, status")
    .eq("user_id", user.id)
    .eq("status", "resolved");

  if (scope === "space") {
    query = query.eq("space_id", spaceId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Failed to load predictions", detail: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as Array<{
    confidence: number | null;
    deviation_tag: string | null;
    status: string | null;
  }>;
  const points = toCalibrationPoints(rows);
  const enough = points.length >= MIN_SAMPLE_FOR_CALIBRATION;

  const payload: CalibrationReliabilityResponse = {
    scope,
    resolved_count: rows.length,
    calibratable_count: points.length,
    enough_data: enough,
    min_sample: MIN_SAMPLE_FOR_CALIBRATION,
    brier: enough ? computeBrier(points) : null,
    ece: enough ? computeECE(points) : null,
    reliability_bins: enough ? computeReliabilityBins(points) : null,
  };

  return NextResponse.json(payload);
}
