// ── Twin diagnostics types (R5 Phase A — P5) ─────────────────────────
//
// Row shape + scalar-only view for `twin_diagnostics`. A diagnostics
// row carries the output of one diagnostic pass against a single
// snapshot: the full TwinQualityReport + optional RealityCalibration.
// Summary scalars (score, grade, passed, counts) are denormalized for
// cheap list reads.
//
// See:
//   - supabase/migrations/20260603_twin_diagnostics.sql (schema)
//   - src/lib/twin/run-twin-diagnostics.ts (producer)
//   - docs/R5_STRATEGIC_BRIEF.md §4

import type { TwinQualityReport } from "@/lib/twin/validate-twin-quality";
import type { RealityCalibration } from "@/types/calibration";

export type TwinQualityGrade =
  | "excellent"
  | "good"
  | "fair"
  | "needs_attention"
  | "critical";

// Mirrors `CalibrationStatus` from `@/types/simulation-mode` — kept in
// sync so the migration's CHECK constraint, this type, and the
// calibration-status strip all agree on the enum values.
export type CalibrationSummaryStatus =
  | "calibrated"
  | "partial"
  | "uncalibrated"
  | "unknown"
  | "bypassed";

export interface TwinDiagnostics {
  id: string;
  space_id: string;
  user_id: string;
  snapshot_id: string;

  quality_report: TwinQualityReport | null;
  calibration: RealityCalibration | null;

  /** 0-100 clamped. Denormalized from quality_report.score. */
  score: number | null;
  grade: TwinQualityGrade | null;
  passed: boolean | null;
  error_count: number;
  warning_count: number;
  info_count: number;

  calibration_status: CalibrationSummaryStatus | null;
  calibration_score: number | null;

  computed_at: string;
}

/**
 * Scalar-only view for list UIs. Drop the heavy JSONB blobs when you
 * only need "what's the latest summary for snapshot X."
 */
export interface TwinDiagnosticsMeta {
  id: string;
  snapshot_id: string;
  score: number | null;
  grade: TwinQualityGrade | null;
  passed: boolean | null;
  error_count: number;
  warning_count: number;
  info_count: number;
  calibration_status: CalibrationSummaryStatus | null;
  calibration_score: number | null;
  computed_at: string;
}
