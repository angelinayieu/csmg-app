// GET /api/predictions?space_id=...&status=open&kind=trajectory
//
// Phase 5 — list predictions for a space, with optional status / kind
// filters. Drives the predictions panel + the strategy drawer's
// "outstanding predictions for this intervention" surface.
//
// Defaults: status='open', no kind filter. Limit defaults to 50.
//
// Auth: user must own the space.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json(
      { error: "space_id query parameter required" },
      { status: 400 },
    );
  }
  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind");
  const interventionId = url.searchParams.get("intervention_id");
  const targetEntityId = url.searchParams.get("target_entity_id");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw
    ? Math.min(MAX_LIMIT, Math.max(1, parseInt(limitRaw, 10)))
    : DEFAULT_LIMIT;

  let query = db
    .from("prediction_ledger")
    .select(
      "id, space_id, status, prediction_kind, target_entity_id, intervention_id, " +
        "metric_label, metric_unit, predicted_at, horizon_at, " +
        "predicted_value, predicted_value_text, predicted_distribution, " +
        "predicted_trajectory, actual_trajectory, " +
        "predicted_basis_edge_ids, predicted_basis_evidence_ids, predicted_simulator, " +
        "rationale, confidence, " +
        "resolved_actual, resolved_at, deviation, deviation_tag, resolution_notes",
    )
    .eq("space_id", spaceId)
    .order("predicted_at", { ascending: false })
    .limit(limit);

  if (status === "open" || status === "resolved" || status === "abandoned") {
    query = query.eq("status", status);
  } else if (status === null) {
    query = query.eq("status", "open"); // default
  }
  if (kind === "trajectory" || kind === "point_value") {
    query = query.eq("prediction_kind", kind);
  }
  if (interventionId) {
    query = query.eq("intervention_id", interventionId);
  }
  if (targetEntityId) {
    query = query.eq("target_entity_id", targetEntityId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[predictions GET] query failed:", error);
    return NextResponse.json(
      { error: error.message ?? "query failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ rows: data ?? [] });
}
