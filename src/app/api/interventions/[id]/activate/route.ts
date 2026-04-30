// POST /api/interventions/[id]/activate
//
// Phase 5 — flip an intervention to status='active' AND auto-register
// a trajectory prediction in prediction_ledger so the resolution loop
// has something to compare against when the user reports outcomes.
//
// Mirrors the existing [id]/complete and [id]/abandon endpoints in
// shape — same auth, same response shape (returns the updated row),
// soft-fail discipline on the prediction registration so a missing
// temporal pool doesn't block activation.
//
// Body (optional):
//   { weeklyHorizon?: number, iterations?: number, seed?: number }
//   These pass through to the simulator that builds the trajectory.
//   Defaults: horizon = max(2 × peak_weeks, 26); iterations = 500;
//   seed = 42.
//
// Response:
//   {
//     intervention: <full updated row>,
//     prediction: { id, horizon_at, weeks_horizon } | null
//   }
// `prediction` is null when the intervention lacked the temporal data
// needed to build a trajectory (no temporal_basis_edge_id, no
// target_entity_id, etc). Activation still succeeds.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import { registerInterventionPrediction } from "@/lib/predictions/register-prediction";
import type { InterventionRow } from "@/types/intervention";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ActivateBody {
  weeklyHorizon?: number;
  iterations?: number;
  seed?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: interventionId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body } = await safeJsonParse<ActivateBody>(request);

  // 1. Load the intervention to authorize.
  const { data: existing } = (await db
    .from("interventions")
    .select("id, space_id, user_id, status")
    .eq("id", interventionId)
    .maybeSingle()) as {
    data: { id: string; space_id: string; user_id: string; status: string } | null;
  };
  if (!existing) {
    return NextResponse.json(
      { error: "Intervention not found" },
      { status: 404 },
    );
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const owns = await verifySpaceOwnership(supabase, existing.space_id, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (existing.status === "active") {
    return NextResponse.json(
      { error: "Intervention already active" },
      { status: 409 },
    );
  }
  if (
    existing.status === "completed" ||
    existing.status === "superseded" ||
    existing.status === "abandoned"
  ) {
    return NextResponse.json(
      { error: `Cannot activate from terminal status ${existing.status}` },
      { status: 409 },
    );
  }

  // 2. Flip status to active.
  const { data: updated, error: updErr } = (await db
    .from("interventions")
    .update({ status: "active" })
    .eq("id", interventionId)
    .select("*")
    .single()) as {
    data: InterventionRow | null;
    error: { message?: string } | null;
  };
  if (updErr || !updated) {
    return NextResponse.json(
      { error: updErr?.message ?? "Activation failed" },
      { status: 500 },
    );
  }

  // 3. Pre-register a trajectory prediction. Soft-fail discipline:
  // any error here is logged but does NOT roll back the activation
  // (the user activated their intervention; failing because we
  // couldn't compute a forecast would be a UX hostility). Returns
  // null when the intervention lacks temporal data — the strategy
  // drawer surfaces "no forecast available" in that case and the
  // user can still proceed.
  let prediction = null;
  try {
    prediction = await registerInterventionPrediction(db, interventionId, {
      weeklyHorizon: body?.weeklyHorizon,
      iterations: body?.iterations,
      seed: body?.seed,
    });
  } catch (err) {
    console.warn("[intervention activate] prediction soft-failed:", err);
  }

  return NextResponse.json({ intervention: updated, prediction });
}
