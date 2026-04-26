// POST /api/lab/calibration/recompute
//
// Body: { space_id }
//
// Re-runs reality calibration against the CURRENT KG state (entities +
// edges as they exist right now) and the LATEST strategy_baseline's
// metric_baselines[]. Upserts the resulting row keyed on
// strategy_baseline_id, so a second call just overwrites.
//
// Why this exists:
//   The initial calibration runs as step 7 of capture-baseline. If the
//   user opens the lab, sees "uncalibrated", clicks "Review gaps",
//   understands why, and fixes the flagged entities (tunes parameters,
//   adds missing edges), there's no way to tell the system "re-check me"
//   short of regenerating the whole strategy. That's the wrong ergonomic
//   — fixing the KG should have a dedicated "recompute" button on the
//   strip, and this is its endpoint.
//
// Soft-fail: a crash here must never corrupt the existing calibration
// row. `runRealityCalibration` only upserts on a clean agent response;
// a failed agent call falls through to the blanket-unverifiable
// attempts path which is still a valid (if unhelpful) result. We return
// the new summary so the client can update the strip without a refetch.
//
// Not throttled here — the orchestrator's LLM call is the only real
// cost and the UI disables the button while running. If spam becomes a
// problem we'll add a per-space cooldown.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { summarizeCalibration } from "@/types/simulation-mode";
import type { Entity, Edge } from "@/types";
import type { MetricBaseline } from "@/types/prediction";

export const maxDuration = 45;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const spaceId = (body as { space_id?: string } | null)?.space_id;
  if (!spaceId) {
    return NextResponse.json(
      { error: "space_id is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Ownership.
  const { data: space } = await db
    .from("spaces")
    .select("id")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // 2. Latest strategy_baseline for this space. Without one, there's
  //    nothing to calibrate against — return an honest 404 instead of
  //    silently creating a stub.
  const { data: baseline } = (await db
    .from("strategy_baselines")
    .select("id, metric_baselines")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data: {
      id: string;
      metric_baselines: MetricBaseline[] | null;
    } | null;
  };
  if (!baseline) {
    return NextResponse.json(
      {
        error:
          "No strategy baseline yet — generate a strategy first, then calibration has something to check against.",
      },
      { status: 404 },
    );
  }
  const metricBaselines = Array.isArray(baseline.metric_baselines)
    ? baseline.metric_baselines
    : [];

  // 3. Load current entities + edges. These are the "after-fix" version
  //    the user wants re-checked against their declared baselines.
  const [{ data: entitiesData }, { data: edgesData }] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
  ]);
  const entities = (entitiesData ?? []) as Entity[];
  const edges = (edgesData ?? []) as Edge[];

  // 4. Re-run the orchestrator. This upserts on strategy_baseline_id,
  //    so the existing row is overwritten atomically — the status
  //    coherence trigger will re-derive `status` from the new counts.
  const { runRealityCalibration } = await import(
    "@/lib/pipeline/reality-calibration"
  );

  let calibrationResult;
  try {
    calibrationResult = await runRealityCalibration(db, {
      strategyBaselineId: baseline.id,
      spaceId,
      baselines: metricBaselines,
      entities,
      edges,
    });
  } catch (err) {
    // Deliberately distinct from the orchestrator's internal soft-fail
    // (which persists a blanket-unverifiable row). If the orchestrator
    // itself threw, we return 500 so the panel keeps the previous
    // strip state rather than flashing "uncalibrated" from a crashed run.
    console.error("[calibration recompute] orchestrator threw:", err);
    return NextResponse.json(
      { error: "Calibration engine crashed — previous state preserved." },
      { status: 500 },
    );
  }

  const { calibration, persisted } = calibrationResult;

  // 5. Build the same response shape the strip's GET returns so the
  //    client can drop it in without a refetch round-trip.
  const blockerSet = new Set<string>();
  for (const a of calibration.attempts ?? []) {
    if (a.verdict === "reproduced") continue;
    for (const id of a.blocker_entity_ids ?? []) blockerSet.add(id);
  }
  const summary = summarizeCalibration(
    calibration.reproduced_count,
    calibration.total_count,
    !!calibration.bypassed_at,
  );

  return NextResponse.json({
    persisted,
    summary: {
      ...summary,
      blockerEntityIds: Array.from(blockerSet),
    },
    attempts: calibration.attempts,
    aggregate_score: calibration.aggregate_score,
    strategy_baseline_id: calibration.strategy_baseline_id,
    computed_at: calibration.computed_at,
  });
}
