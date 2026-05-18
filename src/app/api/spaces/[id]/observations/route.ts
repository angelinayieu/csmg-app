// ── /api/spaces/[id]/observations ───────────────────────────────────
//
// W2 — the user's reality-data ingress.
//
//   POST  → insert observation, run light calibration scoring against
//           open predictions, invalidate twin dashboard cache, return
//           the inserted row + calibration verdict
//   GET   → list latest N observations for the Outcomes tab feed
//
// Light calibration scoring (W7):
//   - If actual_value JSONB carries { metric, value }, find open
//     predictions in this space whose metric_label matches (case-
//     insensitive). For each match, inline-resolve the prediction
//     (status → 'resolved', resolved_actual, resolved_at, deviation,
//     deviation_tag).
//   - Threshold parity with resolve-predictions cron:
//       ≤10% → expected · ≤50% same-sign → regime_shift · else surprise
//   - When actual_value has no numeric, we still insert the observation
//     and tag calibration_applied.verdict = "qualitative".
//
// Full skeptic-agent edge-weight calibration is deferred to Phase 3.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { invalidateTwinDashboardCache } from "@/lib/twin/invalidate-dashboard-cache";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// ── Request / response types ──────────────────────────────────────

interface PostBody {
  observation_text: string;
  observed_at?: string; // defaults to now
  tags?: string[];
  predicted_entity_ids?: string[];
  /** Optional structured measurement: { metric, value, unit? } */
  actual_value?: {
    metric: string;
    value: number;
    unit?: string;
  } | null;
}

export interface ObservationRow {
  id: string;
  observation_text: string;
  observed_at: string;
  tags: string[];
  predicted_entity_ids: string[];
  actual_value: PostBody["actual_value"] | null;
  calibration_applied: CalibrationApplied | null;
  created_at: string;
}

interface CalibrationApplied {
  verdict: "confirms" | "partial" | "refutes" | "qualitative" | "no_match";
  matched_prediction_ids: string[];
  /** Per-match deviation summary so the UI can show "expected vs surprise" chips. */
  deviation_summary: Array<{
    prediction_id: string;
    metric_label: string;
    predicted_value: number | null;
    actual_value: number;
    relative_error: number; // (actual - predicted) / |predicted|
    deviation_tag: "expected" | "regime_shift" | "surprise" | "qualitative";
  }>;
  /** Plain-English narrative for the row's expanded view. */
  narrative: string;
}

// ── POST ──────────────────────────────────────────────────────────

export async function POST(req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body || typeof body.observation_text !== "string") {
    return NextResponse.json(
      { error: "observation_text is required" },
      { status: 400 },
    );
  }
  const text = body.observation_text.trim();
  if (text.length === 0) {
    return NextResponse.json(
      { error: "observation_text cannot be empty" },
      { status: 400 },
    );
  }
  if (text.length > 4000) {
    return NextResponse.json(
      { error: "observation_text too long (max 4000 chars)" },
      { status: 400 },
    );
  }

  // Authorization — confirm space belongs to caller before write.
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

  const observedAt = body.observed_at
    ? new Date(body.observed_at).toISOString()
    : new Date().toISOString();
  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 20) : [];
  const predictedEntityIds = Array.isArray(body.predicted_entity_ids)
    ? body.predicted_entity_ids.slice(0, 50)
    : [];
  const actualValue = body.actual_value ?? null;

  // Light calibration — only runs when actual_value carries a numeric.
  let calibration: CalibrationApplied | null = null;
  if (actualValue && typeof actualValue.value === "number") {
    calibration = await scoreCalibration(
      db,
      spaceId,
      user.id,
      actualValue,
    );
  } else {
    calibration = {
      verdict: "qualitative",
      matched_prediction_ids: [],
      deviation_summary: [],
      narrative:
        "Qualitative observation — no numeric value to score against open predictions.",
    };
  }

  // Insert observation row.
  const { data: inserted, error: insertErr } = await db
    .from("observations")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      observation_text: text,
      observed_at: observedAt,
      tags,
      predicted_entity_ids: predictedEntityIds,
      actual_value: actualValue,
      calibration_applied: calibration,
    })
    .select("*")
    .single();

  if (insertErr || !inserted) {
    console.error("[observations.POST] insert failed:", insertErr);
    return NextResponse.json(
      { error: "Failed to insert observation" },
      { status: 500 },
    );
  }

  // Bust the dashboard cache so the next bundle GET picks up the
  // updated daysSinceLastObservation + prediction history.
  await invalidateTwinDashboardCache(db, spaceId);

  return NextResponse.json({
    observation: shapeObservationRow(inserted),
  });
}

// ── GET ───────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20),
    100,
  );

  // Auth scope is enforced by RLS, but explicit user_id filter is
  // belt-and-braces.
  const { data, error } = await db
    .from("observations")
    .select("*")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("observed_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[observations.GET] failed:", error);
    return NextResponse.json(
      { error: "Failed to list observations" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    observations: (data ?? []).map(shapeObservationRow),
  });
}

// ── Calibration scoring helper ────────────────────────────────────

async function scoreCalibration(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  actualValue: { metric: string; value: number; unit?: string },
): Promise<CalibrationApplied> {
  // Pull open predictions whose metric_label fuzzily matches the
  // observation's metric name. ilike pattern keeps it tolerant to
  // capitalization + minor whitespace differences. We don't try to
  // resolve trajectories here — those have their own resolver.
  const { data: openPreds } = await db
    .from("prediction_ledger")
    .select(
      "id, metric_label, predicted_value, predicted_value_text, prediction_kind",
    )
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .eq("status", "open")
    .ilike("metric_label", `%${actualValue.metric.trim()}%`)
    .limit(20);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches = (openPreds ?? []) as Array<any>;

  if (matches.length === 0) {
    return {
      verdict: "no_match",
      matched_prediction_ids: [],
      deviation_summary: [],
      narrative: `No open predictions for "${actualValue.metric}" — observation recorded for the future.`,
    };
  }

  const deviationSummary: CalibrationApplied["deviation_summary"] = [];
  const matchedIds: string[] = [];
  const updates: Promise<unknown>[] = [];

  for (const pred of matches) {
    const predictedValue =
      typeof pred.predicted_value === "number" ? pred.predicted_value : null;
    let tag: "expected" | "regime_shift" | "surprise" | "qualitative";
    let relErr = 0;

    if (predictedValue === null) {
      // Text-only prediction — can't compute numeric deviation.
      tag = "qualitative";
    } else if (predictedValue === 0) {
      // Degenerate baseline — any non-zero actual is "surprise."
      tag = actualValue.value === 0 ? "expected" : "surprise";
      relErr =
        actualValue.value === 0
          ? 0
          : (actualValue.value - predictedValue) / 1;
    } else {
      relErr = (actualValue.value - predictedValue) / Math.abs(predictedValue);
      const absErr = Math.abs(relErr);
      const sameSign =
        Math.sign(actualValue.value) === Math.sign(predictedValue) ||
        predictedValue === 0;
      if (absErr <= 0.1) tag = "expected";
      else if (absErr <= 0.5 && sameSign) tag = "regime_shift";
      else tag = "surprise";
    }

    deviationSummary.push({
      prediction_id: pred.id,
      metric_label: pred.metric_label,
      predicted_value: predictedValue,
      actual_value: actualValue.value,
      relative_error: relErr,
      deviation_tag: tag,
    });
    matchedIds.push(pred.id);

    // Inline resolve. Soft-fail per-row so one bad update doesn't
    // kill the whole observation insert.
    updates.push(
      db
        .from("prediction_ledger")
        .update({
          status: "resolved",
          resolved_actual: predictedValue !== null ? actualValue.value : null,
          resolved_actual_text:
            predictedValue === null ? String(actualValue.value) : null,
          resolved_at: new Date().toISOString(),
          deviation:
            predictedValue !== null
              ? actualValue.value - predictedValue
              : null,
          deviation_tag: tag,
          resolution_notes: `Resolved by observation on "${actualValue.metric}"`,
        })
        .eq("id", pred.id)
        .then(
          () => null,
          (err: unknown) => {
            console.warn("[calibration] resolve failed for", pred.id, err);
            return null;
          },
        ),
    );
  }

  await Promise.all(updates);

  // Verdict heuristic: majority class.
  const tagCounts: Record<string, number> = {};
  for (const d of deviationSummary) {
    tagCounts[d.deviation_tag] = (tagCounts[d.deviation_tag] ?? 0) + 1;
  }
  const dominantTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const verdict: CalibrationApplied["verdict"] =
    dominantTag === "expected"
      ? "confirms"
      : dominantTag === "regime_shift"
      ? "partial"
      : dominantTag === "surprise"
      ? "refutes"
      : "qualitative";

  const narrative =
    matches.length === 1
      ? `Matched 1 open prediction. Tag: ${deviationSummary[0].deviation_tag}.`
      : `Matched ${matches.length} open predictions (${verdict}).`;

  return {
    verdict,
    matched_prediction_ids: matchedIds,
    deviation_summary: deviationSummary,
    narrative,
  };
}

// ── Row shaper ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeObservationRow(row: any): ObservationRow {
  return {
    id: row.id,
    observation_text: row.observation_text,
    observed_at: row.observed_at,
    tags: row.tags ?? [],
    predicted_entity_ids: row.predicted_entity_ids ?? [],
    actual_value: row.actual_value ?? null,
    calibration_applied: row.calibration_applied ?? null,
    created_at: row.created_at,
  };
}
