// ── POST /api/spaces/[id]/twin/run-prediction ──────────────────────
//
// User-triggered ad-hoc prediction. The pipeline already emits
// predictions automatically (from interventions + trajectories) via
// internal lib functions, but until now there was no REST entry for
// "I, the user, predict X by date Y" — Phase 2 W1 adds it so the
// Coach action `run_prediction` and the page-header menu both have
// a real endpoint to call.
//
// Writes a single row into `prediction_ledger` with:
//   - status = 'open'
//   - app_id / strategy_snapshot_id / agent_id all null (user-emitted)
//   - tracker_id null (manual metric, no auto-resolution)
//
// The cron resolver will see horizon_at and pick this up like any
// other open prediction. If the user later logs an observation
// with a matching metric, our W7 calibration scoring resolves it
// inline.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { invalidateTwinDashboardCache } from "@/lib/twin/invalidate-dashboard-cache";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface PostBody {
  metric_label: string;
  /** Numeric forecast — required when predicted_value_text is absent */
  predicted_value?: number | null;
  /** Qualitative forecast — required when predicted_value is absent */
  predicted_value_text?: string | null;
  metric_unit?: string | null;
  /** When should this be evaluated. ISO 8601. */
  horizon_at: string;
  rationale?: string | null;
  /** Self-reported 0..1 confidence. */
  confidence?: number | null;
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) {
    return NextResponse.json({ error: "Body required" }, { status: 400 });
  }
  const metric = (body.metric_label ?? "").trim();
  if (metric.length === 0) {
    return NextResponse.json(
      { error: "metric_label is required" },
      { status: 400 },
    );
  }
  if (metric.length > 200) {
    return NextResponse.json(
      { error: "metric_label too long (max 200 chars)" },
      { status: 400 },
    );
  }

  // Need at least one value lane (matches the prediction_has_value
  // check constraint in the migration).
  const hasNumeric = typeof body.predicted_value === "number" && Number.isFinite(body.predicted_value);
  const hasText =
    typeof body.predicted_value_text === "string" &&
    body.predicted_value_text.trim().length > 0;
  if (!hasNumeric && !hasText) {
    return NextResponse.json(
      { error: "Either predicted_value or predicted_value_text is required" },
      { status: 400 },
    );
  }

  const horizonDate = new Date(body.horizon_at);
  if (!Number.isFinite(horizonDate.getTime())) {
    return NextResponse.json(
      { error: "horizon_at must be a valid ISO date" },
      { status: 400 },
    );
  }
  // Reasonable bounds — must be in the future, not more than 5 years out.
  const now = Date.now();
  if (horizonDate.getTime() <= now) {
    return NextResponse.json(
      { error: "horizon_at must be in the future" },
      { status: 400 },
    );
  }
  if (horizonDate.getTime() > now + 5 * 365 * 24 * 3600 * 1000) {
    return NextResponse.json(
      { error: "horizon_at can't be more than 5 years out" },
      { status: 400 },
    );
  }

  const confidence =
    typeof body.confidence === "number" &&
    body.confidence >= 0 &&
    body.confidence <= 1
      ? body.confidence
      : null;

  // Authorization check.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: inserted, error } = await db
    .from("prediction_ledger")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      metric_label: metric,
      metric_unit: body.metric_unit?.trim() || null,
      predicted_at: new Date().toISOString(),
      horizon_at: horizonDate.toISOString(),
      predicted_value: hasNumeric ? body.predicted_value : null,
      predicted_value_text: hasText
        ? (body.predicted_value_text as string).trim()
        : null,
      rationale: body.rationale?.trim() || null,
      confidence,
      status: "open",
    })
    .select("id, metric_label, horizon_at, predicted_at")
    .single();

  if (error || !inserted) {
    console.error("[run-prediction] insert failed:", error);
    return NextResponse.json(
      { error: "Failed to insert prediction" },
      { status: 500 },
    );
  }

  // Bust dashboard cache so prediction_history + coach inputs refresh.
  await invalidateTwinDashboardCache(db, spaceId);

  return NextResponse.json({ prediction: inserted });
}
