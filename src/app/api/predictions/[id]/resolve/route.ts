// POST /api/predictions/[id]/resolve
//
// Phase 5 — close the loop on a trajectory prediction. Accepts an
// `actualTrajectory` array of {week, value} observations the user
// reports for the predicted target. Computes per-week deviation +
// the temporal lag between predicted and actual peak, writes the
// resolution to prediction_ledger, and emits edge_calibrations rows
// against the prediction's basis edges with both magnitude and
// temporal deltas (method='path_aware_temporal_v1').
//
// Body:
//   {
//     actualTrajectory: [{ week: number, value: number,
//                          n_observed?: number,
//                          source_quote?: string }, ...],
//     reviewerNotes?: string,
//     overrideDeviationTag?: 'expected' | 'regime_shift' | 'surprise' | 'qualitative'
//   }
//
// Auth: user must own the prediction's space.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import {
  resolveTrajectoryPrediction,
  type ActualTrajectoryEntry,
} from "@/lib/predictions/resolve-prediction";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ResolveBody {
  actualTrajectory?: ActualTrajectoryEntry[];
  reviewerNotes?: string;
  overrideDeviationTag?:
    | "expected"
    | "regime_shift"
    | "surprise"
    | "qualitative";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: predictionId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body, error: bodyErr } = await safeJsonParse<ResolveBody>(
    request,
  );
  if (bodyErr) return bodyErr;
  if (
    !body ||
    !Array.isArray(body.actualTrajectory) ||
    body.actualTrajectory.length === 0
  ) {
    return NextResponse.json(
      { error: "actualTrajectory must be a non-empty array" },
      { status: 400 },
    );
  }

  // Authorize via the prediction's space.
  const { data: pred } = (await db
    .from("prediction_ledger")
    .select("id, space_id, status")
    .eq("id", predictionId)
    .maybeSingle()) as {
    data: { id: string; space_id: string; status: string } | null;
  };
  if (!pred) {
    return NextResponse.json(
      { error: "Prediction not found" },
      { status: 404 },
    );
  }
  const owns = await verifySpaceOwnership(supabase, pred.space_id, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (pred.status === "resolved") {
    return NextResponse.json(
      { error: "Prediction already resolved" },
      { status: 409 },
    );
  }

  // Run the resolver.
  const result = await resolveTrajectoryPrediction(db, predictionId, {
    actualTrajectory: body.actualTrajectory,
    reviewerNotes: body.reviewerNotes ?? null,
    overrideDeviationTag: body.overrideDeviationTag ?? null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ result });
}
