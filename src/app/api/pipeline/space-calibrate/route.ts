// POST /api/pipeline/space-calibrate
//
// Post-hoc "did the plan pay off" sweep. Walks completed work items
// from a plan (or the N most recent plans for a space) and records a
// PlanCalibrationEvent row per item — paid_off + which surface used
// it + latency from plan generation.
//
// Weight-fitting consumes these rows later. The fitter (offline /
// separate job) reads space_plan_calibrations, runs a logistic
// regression of signals → paid_off, and emits updated signal weights.
// Nothing writes back to DEFAULT_WEIGHTS automatically — those live
// in code and ship via code review.
//
// DESIGN NOTES
// ─────────────
// Idempotent: rerunning the sweep for the same plan simply re-inserts
// rows (append-only is a feature here — latency grows monotonically
// between sweeps, so the freshest row is always the truth). A caller
// that wants to avoid duplicates can pass `skip_existing=true`, which
// filters out candidates that already have a calibration row.
//
// Per-kind payoff heuristics (v1 — intentionally simple):
//
//   signature_deepen  → target entity appears as `target_entity_id` on
//                        an intervention created after plan.generated_at
//                        → paid_off=true, surface="intervention".
//
//   intervention_combination → space_combination_results row exists for
//                        (plan_id, candidate_id) AND its novelty isn't
//                        "trivial" (the LLM uses "trivial" for "one
//                        follows trivially from the other" — not insight).
//                        paid_off=true, surface="widget_render".
//
//   axis, edge_space,
//   convergent_point,
//   intersection_probe → v1 stub executors; payoff currently recorded
//                         as false with surface=null. Real payoff
//                         heuristics land when those executors ship.
//
// If an item's work_queue row is still pending / in_progress, we skip
// it — nothing to calibrate yet. The caller can re-run the sweep
// later.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import type { SpacePlan, SignalProfile, SpaceWorkKind, PlanCalibrationEvent } from "@/types/space-plan";

export const maxDuration = 60;
export const runtime = "nodejs";

interface CalibrateRequest {
  space_id: string;
  plan_id?: string;        // specific plan (otherwise sweep recent plans)
  max_plans?: number;      // when plan_id omitted, how many most-recent plans to sweep (default 1)
  skip_existing?: boolean; // default true; dedupe on (plan_id, candidate_id)
}

interface CalibrationRowInsert {
  plan_id: string;
  space_id: string;
  user_id: string;
  candidate_id: string;
  kind: SpaceWorkKind;
  signals: SignalProfile;
  score: number;
  paid_off: boolean;
  paid_off_surface: PlanCalibrationEvent["paid_off_surface"];
  latency_seconds: number;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Partial<CalibrateRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const skipExisting = body?.skip_existing !== false; // default true
  const maxPlans = Math.min(10, Math.max(1, body?.max_plans ?? 1));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── 1. Load target plans ────────────────────────────────────────────
  //
  // Either a single plan by id, or the N most recent for the space.
  // We pull the full plan_document because per-candidate signals live
  // inside candidates_considered — the calibration row needs them.
  let plansQuery = db
    .from("space_plans")
    .select("id, space_id, user_id, generated_at, plan_document")
    .eq("space_id", spaceId)
    .eq("user_id", user.id);
  if (body?.plan_id) {
    plansQuery = plansQuery.eq("id", body.plan_id);
  } else {
    plansQuery = plansQuery.order("generated_at", { ascending: false }).limit(maxPlans);
  }
  const { data: planRows, error: planErr } = await plansQuery;
  if (planErr) {
    console.error("[calibrate] plan load failed:", planErr);
    return NextResponse.json({ error: "Failed to load plans" }, { status: 500 });
  }
  const plans = (planRows ?? []) as Array<{
    id: string;
    space_id: string;
    user_id: string;
    generated_at: string;
    plan_document: SpacePlan;
  }>;
  if (plans.length === 0) {
    return NextResponse.json({ space_id: spaceId, plans_swept: 0, rows_written: 0, results: [] });
  }

  // ── 2. For each plan, sweep its completed work items ────────────────
  const results: Array<{
    plan_id: string;
    completed_items: number;
    rows_written: number;
    paid_off_count: number;
  }> = [];
  let totalRows = 0;

  for (const plan of plans) {
    const { data: wqRows } = await db
      .from("space_work_queue")
      .select("candidate_id, kind, status, claimed_at, completed_at, outcome_summary")
      .eq("plan_id", plan.id)
      .eq("status", "completed");
    const completedItems = (wqRows ?? []) as Array<{
      candidate_id: string;
      kind: SpaceWorkKind;
      status: string;
      claimed_at: string | null;
      completed_at: string | null;
      outcome_summary: string | null;
    }>;

    if (completedItems.length === 0) {
      results.push({
        plan_id: plan.id,
        completed_items: 0,
        rows_written: 0,
        paid_off_count: 0,
      });
      continue;
    }

    // Filter out already-calibrated items if requested
    let existingKey = new Set<string>();
    if (skipExisting) {
      const { data: exRows } = await db
        .from("space_plan_calibrations")
        .select("candidate_id")
        .eq("plan_id", plan.id);
      existingKey = new Set(
        ((exRows ?? []) as Array<{ candidate_id: string }>).map((r) => r.candidate_id),
      );
    }

    // Build an index of candidates_considered for signal lookup. Not
    // every completed item has a candidate_considered entry — items
    // can be in `selected` with their own signals, too. We merge both.
    const signalIndex = buildSignalIndex(plan.plan_document);

    // ── 3. Resolve paid_off per item ──────────────────────────────────
    const toInsert: CalibrationRowInsert[] = [];
    let paidOffCount = 0;

    for (const item of completedItems) {
      if (existingKey.has(item.candidate_id)) continue;

      const idx = signalIndex.get(item.candidate_id);
      if (!idx) {
        // The work item exists but its signals are gone (plan_document
        // truncated, schema drift). Skip rather than invent zeroes —
        // that would pollute the regression with bogus rows.
        continue;
      }

      const { paid_off, surface } = await resolvePayoff(db, spaceId, plan.id, plan.generated_at, item);
      if (paid_off) paidOffCount++;

      const observedIso = new Date().toISOString();
      const latencySeconds = Math.max(
        0,
        Math.floor((new Date(observedIso).getTime() - new Date(plan.generated_at).getTime()) / 1000),
      );

      toInsert.push({
        plan_id: plan.id,
        space_id: plan.space_id,
        user_id: plan.user_id,
        candidate_id: item.candidate_id,
        kind: item.kind,
        signals: idx.signals,
        score: idx.score,
        paid_off,
        paid_off_surface: surface,
        latency_seconds: latencySeconds,
      });
    }

    // ── 4. Insert calibration rows ─────────────────────────────────────
    let rowsWritten = 0;
    if (toInsert.length > 0) {
      const { error: insErr } = await db.from("space_plan_calibrations").insert(toInsert);
      if (insErr) {
        console.warn("[calibrate] insert failed:", insErr);
      } else {
        rowsWritten = toInsert.length;
        totalRows += rowsWritten;
      }
    }

    results.push({
      plan_id: plan.id,
      completed_items: completedItems.length,
      rows_written: rowsWritten,
      paid_off_count: paidOffCount,
    });
  }

  return NextResponse.json({
    space_id: spaceId,
    plans_swept: plans.length,
    rows_written: totalRows,
    results,
  });
}

// ── Signal index ─────────────────────────────────────────────────────
//
// Merges signals from both `selected` (which has the final signal
// profile the planner saw) and `candidates_considered` (which has the
// ranker's full shortlist). Selected takes precedence on collision.

function buildSignalIndex(
  plan: SpacePlan,
): Map<string, { signals: SignalProfile; score: number }> {
  const idx = new Map<string, { signals: SignalProfile; score: number }>();
  for (const c of plan.candidates_considered ?? []) {
    idx.set(c.candidate_id, { signals: c.signals, score: c.score });
  }
  for (const s of plan.selected ?? []) {
    // `selected` items may duplicate candidate entries — prefer their
    // locked-in signal profile.
    if (s.signals) {
      idx.set(s.candidate_id, { signals: s.signals, score: s.score });
    }
  }
  return idx;
}

// ── Payoff resolvers ─────────────────────────────────────────────────
//
// Per-kind heuristic: "did something downstream actually use this
// candidate since the plan was generated?" For v1 we only have a real
// signal for signature_deepen — the other kinds are stubbed executors,
// so their payoff recording is intentionally negative.

async function resolvePayoff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  planId: string,
  planGeneratedAt: string,
  item: { candidate_id: string; kind: SpaceWorkKind; outcome_summary: string | null },
): Promise<{ paid_off: boolean; surface: PlanCalibrationEvent["paid_off_surface"] }> {
  // If the executor was stubbed, the outcome_summary is tagged; don't
  // bother checking downstream surfaces.
  if (item.outcome_summary && item.outcome_summary.startsWith("[stub]")) {
    return { paid_off: false, surface: null };
  }

  switch (item.kind) {
    case "signature_deepen": {
      const entityId = parseSigEntityId(item.candidate_id);
      if (!entityId) return { paid_off: false, surface: null };
      // Count interventions for this entity created strictly after
      // plan generation. Using head count keeps the query O(index).
      const { count } = await db
        .from("interventions")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId)
        .eq("target_entity_id", entityId)
        .gt("created_at", planGeneratedAt);
      if ((count ?? 0) > 0) return { paid_off: true, surface: "intervention" };
      return { paid_off: false, surface: null };
    }

    case "intervention_combination": {
      // The executor (src/lib/pipeline/space-executor-drain.ts)
      // persists a row to space_combination_results when the LLM
      // produces a non-trivial interpretation. Payoff = a row exists
      // for this work item AND its novelty isn't "trivial" (which the
      // LLM uses for "one entity follows trivially from the other" —
      // not insight-bearing).
      //
      // We key on candidate_id rather than work_item_id because the
      // calibration sweep doesn't have a stable handle to the queue
      // row (the queue's id isn't carried forward into the plan
      // document, only the candidate_id is). candidate_id is unique
      // per (plan_id, candidate_id) because the strategizer dedupes
      // before enqueueing.
      const { data: comboRow } = await db
        .from("space_combination_results")
        .select("novelty")
        .eq("space_id", spaceId)
        .eq("plan_id", planId)
        .eq("candidate_id", item.candidate_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const novelty = (comboRow as { novelty?: string } | null)?.novelty ?? null;
      if (novelty && novelty !== "trivial") {
        return { paid_off: true, surface: "widget_render" };
      }
      return { paid_off: false, surface: null };
    }

    case "axis":
    case "edge_space":
    case "convergent_point":
    case "intersection_probe":
      // v1 stub executors — payoff currently recorded as false. Real
      // payoff heuristics land when those executors ship.
      return { paid_off: false, surface: null };

    default: {
      // Exhaustiveness guard — if we see a kind we don't know about,
      // record negative rather than throw (the sweep should not block
      // on schema drift).
      const _never: never = item.kind;
      void _never;
      return { paid_off: false, surface: null };
    }
  }
}

function parseSigEntityId(candidateId: string): string | null {
  if (candidateId.startsWith("sig:")) {
    const id = candidateId.slice(4).trim();
    return /^[0-9a-f-]{8,}$/i.test(id) ? id : null;
  }
  return /^[0-9a-f-]{8,}$/i.test(candidateId) ? candidateId : null;
}
