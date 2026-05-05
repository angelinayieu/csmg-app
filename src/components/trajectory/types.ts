// Shared client-side types for the trajectory engine UI. Mirrors the
// shapes returned by /api/trajectory/project so multiple components
// (panel, chart, gap chips, future surfaces like the dashboard
// sparkline) consume from one source of truth.

export type TrajectoryGapKind =
  | "low_confidence"
  | "missing_timing"
  | "weak_strength";

export interface TrajectoryGap {
  kind: TrajectoryGapKind;
  edgeId: string;
  sourceName: string;
  targetName: string;
  /** 0..1; higher = more impact on band width / structural fidelity. */
  severity: number;
  /** Compact display label (e.g. "Low conf (0.32)", "No timing"). */
  label: string;
  remediation:
    | "research_rounds"
    | "extract_temporal"
    | "extract_effect_size";
}
