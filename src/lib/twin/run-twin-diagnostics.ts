// ── runTwinDiagnostics (R5 Phase A — P5) ─────────────────────────────
//
// Wraps the two existing diagnostic producers against a frozen
// snapshot and persists the result:
//
//   1. validateTwinQuality — structural quality across 4 layers
//      (input / coherence / strategy_alignment / trajectory). Cheap,
//      synchronous, deterministic. Always runs.
//
//   2. runRealityCalibration — reality-reconciliation verdicts per
//      baseline. Tier 3/4 (numerical-first post-R2). LLM fallback is
//      non-trivial cost, so calibration is opt-in per call.
//
// Pure function over snapshot JSONB — no live KG reads. Re-running is
// safe and intentional (appends history rather than overwriting).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entity, Edge, Cycle } from "@/types";
import { validateTwinQuality } from "./validate-twin-quality";
import type { TwinQualityReport } from "./validate-twin-quality";
import type { RealityCalibration } from "@/types/calibration";
import type { TwinSnapshot } from "@/types/snapshot";
import type {
  CalibrationSummaryStatus,
  TwinQualityGrade,
} from "@/types/twin-diagnostics";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any> | any;

export interface RunDiagnosticsOpts {
  snapshotId: string;
  /** When true, also run reality calibration. Default false — cheap
   *  quality checks always run; calibration is an explicit ask
   *  because it may invoke an LLM. */
  includeCalibration?: boolean;
}

export interface RunDiagnosticsResult {
  diagnosticsId: string | null;
  quality: TwinQualityReport;
  calibration: RealityCalibration | null;
  persisted: boolean;
  /** Non-null when something partial failed but we still wrote a row. */
  warning: string | null;
}

/**
 * Load snapshot + its space context, run validateTwinQuality (+
 * optional calibration), persist a `twin_diagnostics` row, return the
 * full report to the caller.
 *
 * Soft-fails on persistence: if the DB write fails, we still return
 * the computed report so the caller can render it. The row is lost
 * but the user sees the result.
 */
export async function runTwinDiagnostics(
  db: AnyDb,
  opts: RunDiagnosticsOpts,
): Promise<RunDiagnosticsResult | { error: string }> {
  // Load snapshot (full payload).
  const { data: snapshotRow, error: snapErr } = await db
    .from("twin_snapshots")
    .select(
      "id, space_id, user_id, entities, edges, cycles, captured_at",
    )
    .eq("id", opts.snapshotId)
    .maybeSingle();
  if (snapErr || !snapshotRow) {
    return {
      error: snapErr?.message ?? `snapshot ${opts.snapshotId} not found`,
    };
  }
  const snap = snapshotRow as Pick<
    TwinSnapshot,
    "id" | "space_id" | "user_id" | "entities" | "edges" | "cycles"
  >;

  // Load space for synthesis_data + active goal. Both feed quality
  // checks; without them the `coherence` / `strategy_alignment` /
  // `trajectory` layers degrade to info-level warnings. That's the
  // intended degraded state — a snapshot of a sparse KG gets a low
  // coherence score, and the UI surfaces it.
  const [spaceRes, goalRes] = await Promise.all([
    db.from("spaces").select("*").eq("id", snap.space_id).maybeSingle(),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", snap.space_id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spaceRow = spaceRes?.data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeGoal = (goalRes?.data as any) ?? null;

  // Normalize synthesis_data (JSON string or object) the same way
  // computeTwinState does.
  let synthesisData: unknown = null;
  const synthRaw =
    (spaceRow as { synthesis_data?: unknown } | null)?.synthesis_data ?? null;
  if (synthRaw && typeof synthRaw === "object") synthesisData = synthRaw;
  else if (typeof synthRaw === "string") {
    try {
      synthesisData = JSON.parse(synthRaw);
    } catch {
      synthesisData = null;
    }
  }

  // Run quality validator.
  const entities = Array.isArray(snap.entities)
    ? (snap.entities as Entity[])
    : [];
  const edges = Array.isArray(snap.edges) ? (snap.edges as Edge[]) : [];
  const cycles = Array.isArray(snap.cycles)
    ? (snap.cycles as unknown as Cycle[])
    : [];
  const quality = validateTwinQuality({
    entities,
    edges,
    cycles,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    synthesisData: (synthesisData as any) ?? null,
    activeGoal,
  });

  // Optionally run reality calibration.
  let calibration: RealityCalibration | null = null;
  let calibrationStatus: CalibrationSummaryStatus | null = null;
  let calibrationScore: number | null = null;
  let warning: string | null = null;
  if (opts.includeCalibration) {
    try {
      // The calibration orchestrator expects a strategy_baseline_id
      // (it's historically been keyed that way). For snapshot-driven
      // diagnostics we don't have one, so we synthesize a deterministic
      // id from snapshot_id — the `reality_calibrations` row won't be
      // written (no FK match), but the in-memory report still comes
      // back. Future: extend runRealityCalibration to take a
      // snapshot_id target directly.
      const { runRealityCalibration } = await import(
        "@/lib/pipeline/reality-calibration"
      );
      const { data: baselineRow } = await db
        .from("strategy_baselines")
        .select("id, metric_baselines")
        .eq("space_id", snap.space_id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const baselineId = (baselineRow as { id?: string } | null)?.id ?? null;
      const baselines = Array.isArray(
        (baselineRow as { metric_baselines?: unknown[] } | null)
          ?.metric_baselines,
      )
        ? ((baselineRow as { metric_baselines?: unknown[] })
            .metric_baselines as unknown[])
        : [];
      if (baselineId && baselines.length > 0) {
        const result = await runRealityCalibration(db, {
          strategyBaselineId: baselineId,
          spaceId: snap.space_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          baselines: baselines as any,
          entities,
          edges,
        });
        calibration = result.calibration;
        calibrationStatus = calibration.status;
        calibrationScore = calibration.aggregate_score;
      } else {
        warning =
          "calibration skipped: no strategy_baseline_id or metric_baselines for this space";
      }
    } catch (err) {
      warning = `calibration failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  // Persist.
  const gradeForColumn: TwinQualityGrade = quality.grade;
  const row = {
    space_id: snap.space_id,
    user_id: snap.user_id,
    snapshot_id: snap.id,
    quality_report: quality,
    calibration,
    score: Math.round(quality.score),
    grade: gradeForColumn,
    passed: quality.passed,
    error_count: quality.error_count,
    warning_count: quality.warning_count,
    info_count: quality.info_count,
    calibration_status: calibrationStatus,
    calibration_score: calibrationScore,
  };
  const { data: inserted, error: insErr } = await db
    .from("twin_diagnostics")
    .insert(row)
    .select("id")
    .single();

  if (insErr || !inserted) {
    return {
      diagnosticsId: null,
      quality,
      calibration,
      persisted: false,
      warning:
        warning ??
        `persist failed: ${insErr?.message ?? "no row returned"}`,
    };
  }

  return {
    diagnosticsId: (inserted as { id: string }).id,
    quality,
    calibration,
    persisted: true,
    warning,
  };
}
