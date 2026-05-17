// GET /api/spaces/[id]/calibration-summary
//
// Phase F: live calibration deltas for the strategy impact decomposition.
// Reads `edge_calibrations` rows for a space — optionally filtered by
// `strategySnapshotId` (so we can honestly say "this strategy's predictions
// are tracking ±X") and/or `edgeIds[]` (so the drawer can scope to a
// single stage's incident edges).
//
// Used by:
//   • use-strategy-view-model.ts — bucketed per-edge map for the
//     impact-weighted-metric calibration factor
//   • goal-impact-decomposition-drawer.tsx — confidence section row
//
// edge_calibrations rows are append-only (one per (prediction × edge)
// update) so we don't need to worry about deletes. The path-aware
// calibrator writes signed delta_strength + delta_confidence per row;
// we surface MEAN |delta_strength| as the headline tracking number.
//
// Output:
//   {
//     n_resolved: 8,                 // distinct prediction count
//     n_calibration_rows: 14,        // total rows (multiple edges per prediction)
//     mean_abs_delta_strength: 0.12, // primary tracking metric
//     mean_abs_delta_confidence: 0.08,
//     last_resolved_at: "2026-05-13T14:23:00Z",
//     by_edge: {
//       "<edgeId>": {
//         n: 3,
//         mean_abs_delta_strength: 0.10,
//         last_at: "2026-05-12T..."
//       },
//       ...
//     },
//     recent_deltas: [               // most-recent 12 rows, full detail
//       { edge_id, delta_strength, delta_confidence, deviation_tag,
//         applied_at, rationale, relative_error }
//     ]
//   }

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface CalibrationDelta {
  edge_id: string;
  delta_strength: number;
  delta_confidence: number;
  deviation_tag: string | null;
  applied_at: string;
  rationale: string | null;
  relative_error: number | null;
  prediction_id: string | null;
}

export interface CalibrationByEdge {
  n: number;
  mean_abs_delta_strength: number;
  mean_abs_delta_confidence: number;
  last_at: string;
}

export interface CalibrationSummaryResponse {
  /** Distinct prediction_id count (a prediction can write multiple rows
   *  — one per basis edge — so this is the user-facing "predictions
   *  resolved" number, not row count). */
  n_resolved: number;
  /** Total calibration rows in the filter window. Always >= n_resolved. */
  n_calibration_rows: number;
  /** Headline tracking metric — mean of |delta_strength| across all rows
   *  in the window. Lower = predictions resolved closer to expectation. */
  mean_abs_delta_strength: number;
  mean_abs_delta_confidence: number;
  /** ISO timestamp of the most-recent calibration applied. Null when empty. */
  last_resolved_at: string | null;
  /** Per-edge breakdown so the drawer can show "edge X has drifted most". */
  by_edge: Record<string, CalibrationByEdge>;
  /** Most-recent N rows with full detail for the recent-activity sparkline. */
  recent_deltas: CalibrationDelta[];
}

// How many recent deltas to ship back for the sparkline. The drawer
// renders maybe 6-8; 12 gives us headroom for future "expand" affordances.
const RECENT_DELTA_COUNT = 12;

export async function GET(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  // Strategy snapshot scoping — when supplied, only count calibrations
  // tied to predictions generated under this strategy. Lets the drawer
  // honestly say "this strategy's predictions" instead of conflating
  // calibrations from a stale prior strategy.
  const strategySnapshotIdRaw = url.searchParams.get("strategySnapshotId");
  const strategySnapshotId =
    strategySnapshotIdRaw && strategySnapshotIdRaw.trim().length > 0
      ? strategySnapshotIdRaw.trim()
      : null;
  // Per-stage scoping — when supplied, only count calibrations on these
  // edges (typically the edges a stage touches). Used by the drawer to
  // narrow from "space-wide" to "this stage's drift".
  const edgeIdsRaw = url.searchParams.get("edgeIds");
  const edgeIds = edgeIdsRaw
    ? edgeIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : null;
  // Time window — default to last 90 days. Older calibrations stop
  // being load-bearing for "is the model tracking?" because the user's
  // context has likely drifted. Caller can override via ?days=N.
  const daysRaw = url.searchParams.get("days");
  const daysParsed = Number.parseInt(daysRaw ?? "90", 10);
  const days = Number.isFinite(daysParsed)
    ? Math.max(7, Math.min(365, daysParsed))
    : 90;
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("edge_calibrations")
    .select(
      "edge_id, delta_strength, delta_confidence, deviation_tag, " +
        "applied_at, rationale, relative_error, prediction_id",
    )
    .eq("space_id", spaceId)
    .gte("applied_at", sinceIso)
    .order("applied_at", { ascending: false });

  if (strategySnapshotId) {
    query = query.eq("strategy_snapshot_id", strategySnapshotId);
  }
  if (edgeIds && edgeIds.length > 0) {
    query = query.in("edge_id", edgeIds);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Failed to load calibration summary", detail: error.message },
      { status: 500 },
    );
  }

  type Row = {
    edge_id: string;
    delta_strength: number | null;
    delta_confidence: number | null;
    deviation_tag: string | null;
    applied_at: string;
    rationale: string | null;
    relative_error: number | null;
    prediction_id: string | null;
  };
  const rows = (data ?? []) as Row[];

  // Filter to rows with numeric deltas (the schema permits null but
  // path_aware_v1 always writes both — defensive guard).
  const usable = rows.filter(
    (r) =>
      typeof r.delta_strength === "number" &&
      Number.isFinite(r.delta_strength) &&
      typeof r.delta_confidence === "number" &&
      Number.isFinite(r.delta_confidence),
  );

  if (usable.length === 0) {
    const empty: CalibrationSummaryResponse = {
      n_resolved: 0,
      n_calibration_rows: 0,
      mean_abs_delta_strength: 0,
      mean_abs_delta_confidence: 0,
      last_resolved_at: null,
      by_edge: {},
      recent_deltas: [],
    };
    return NextResponse.json(empty);
  }

  const sumAbsStrength = usable.reduce(
    (s, r) => s + Math.abs(r.delta_strength as number),
    0,
  );
  const sumAbsConfidence = usable.reduce(
    (s, r) => s + Math.abs(r.delta_confidence as number),
    0,
  );

  // Distinct prediction count — what the user thinks of as "predictions
  // resolved". Multiple calibration rows per prediction (one per basis
  // edge) collapse to one here.
  const predictionIds = new Set<string>();
  for (const r of usable) {
    if (r.prediction_id) predictionIds.add(r.prediction_id);
  }

  // Per-edge aggregates.
  const byEdge: Record<
    string,
    {
      n: number;
      sumAbsS: number;
      sumAbsC: number;
      lastAt: string;
    }
  > = {};
  for (const r of usable) {
    const k = r.edge_id;
    if (!byEdge[k]) {
      byEdge[k] = { n: 0, sumAbsS: 0, sumAbsC: 0, lastAt: r.applied_at };
    }
    byEdge[k].n += 1;
    byEdge[k].sumAbsS += Math.abs(r.delta_strength as number);
    byEdge[k].sumAbsC += Math.abs(r.delta_confidence as number);
    if (r.applied_at > byEdge[k].lastAt) byEdge[k].lastAt = r.applied_at;
  }
  const byEdgeOut: Record<string, CalibrationByEdge> = {};
  for (const [k, v] of Object.entries(byEdge)) {
    byEdgeOut[k] = {
      n: v.n,
      mean_abs_delta_strength: v.sumAbsS / v.n,
      mean_abs_delta_confidence: v.sumAbsC / v.n,
      last_at: v.lastAt,
    };
  }

  const payload: CalibrationSummaryResponse = {
    n_resolved: predictionIds.size,
    n_calibration_rows: usable.length,
    mean_abs_delta_strength: sumAbsStrength / usable.length,
    mean_abs_delta_confidence: sumAbsConfidence / usable.length,
    last_resolved_at: usable[0].applied_at, // first after desc sort
    by_edge: byEdgeOut,
    recent_deltas: usable.slice(0, RECENT_DELTA_COUNT).map((r) => ({
      edge_id: r.edge_id,
      delta_strength: r.delta_strength as number,
      delta_confidence: r.delta_confidence as number,
      deviation_tag: r.deviation_tag,
      applied_at: r.applied_at,
      rationale: r.rationale,
      relative_error: r.relative_error,
      prediction_id: r.prediction_id,
    })),
  };
  return NextResponse.json(payload);
}
