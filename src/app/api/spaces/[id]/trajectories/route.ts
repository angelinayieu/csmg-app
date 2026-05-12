// GET /api/spaces/[id]/trajectories
//
// Returns the most recent N trajectory predictions for this space so the
// canvas can render trajectory-fan cards inside the twin/forecast room
// without re-running Monte Carlo on canvas mount. Trajectories are
// expensive to generate (the /api/trajectory/project POST runs full
// simulation); this GET reads the persisted prediction_ledger rows.
//
// Query: ?limit=N (default 3)
//
// Response shape mirrors the persist-trajectory.ts column layout, with
// `predicted_trajectory` already JSON-decoded by Supabase. Soft-fail on
// missing column or malformed row → returns empty list rather than 500.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * One step in the persisted trajectory array. Mirrors what
 * persistTrajectory writes — week index + p10/p50/p90 + mean/stddev.
 * The shape carries unknown fields through (some simulators add
 * `confidence` per-week, etc.) but only these are required for the
 * fan-chart rendering on canvas.
 */
export interface TrajectoryStep {
  week: number;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
  mean?: number | null;
  stddev?: number | null;
}

export interface TrajectoryRow {
  id: string;
  metric_label: string;
  metric_unit: string | null;
  target_entity_id: string;
  horizon_at: string | null;
  confidence: number | null;
  rationale: string | null;
  predicted_at: string;
  predicted_distribution: {
    p10?: number | null;
    p50?: number | null;
    p90?: number | null;
    mean?: number | null;
    stddev?: number | null;
  } | null;
  predicted_trajectory: TrajectoryStep[];
}

interface TrajectoriesResponse {
  trajectories: TrajectoryRow[];
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
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.max(
    1,
    Math.min(10, Number.parseInt(limitRaw ?? "3", 10) || 3),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Latest N trajectory predictions for this space, freshest first.
  // Restrict to prediction_kind='trajectory' so we don't surface point-
  // predictions that lack a per-week walk.
  const { data, error } = await db
    .from("prediction_ledger")
    .select(
      "id, metric_label, metric_unit, target_entity_id, horizon_at, " +
        "confidence, rationale, predicted_at, predicted_distribution, " +
        "predicted_trajectory",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("prediction_kind", "trajectory")
    .order("predicted_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load trajectories", detail: error.message },
      { status: 500 },
    );
  }

  // Defensive normalization: predicted_trajectory is JSONB so it might
  // arrive as null (legacy rows) or non-array. Filter to rows with at
  // least 2 steps (a single point isn't a fan).
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const trajectories: TrajectoryRow[] = rows
    .map((r): TrajectoryRow | null => {
      const raw = r.predicted_trajectory;
      const trajectory = Array.isArray(raw)
        ? (raw.filter(
            (s) =>
              s &&
              typeof s === "object" &&
              typeof (s as { week?: unknown }).week === "number",
          ) as TrajectoryStep[])
        : [];
      if (trajectory.length < 2) return null;
      return {
        id: String(r.id ?? ""),
        metric_label: String(r.metric_label ?? "metric"),
        metric_unit:
          typeof r.metric_unit === "string" ? r.metric_unit : null,
        target_entity_id: String(r.target_entity_id ?? ""),
        horizon_at:
          typeof r.horizon_at === "string" ? r.horizon_at : null,
        confidence:
          typeof r.confidence === "number" ? r.confidence : null,
        rationale: typeof r.rationale === "string" ? r.rationale : null,
        predicted_at: String(r.predicted_at ?? new Date().toISOString()),
        predicted_distribution: (r.predicted_distribution ??
          null) as TrajectoryRow["predicted_distribution"],
        predicted_trajectory: trajectory,
      };
    })
    .filter((t): t is TrajectoryRow => t !== null);

  const payload: TrajectoriesResponse = { trajectories };
  return NextResponse.json(payload);
}
