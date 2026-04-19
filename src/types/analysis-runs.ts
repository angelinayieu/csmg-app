// ── Analysis runs / audit trail ──
// Append-only log of what pipeline stages ran on a space, what was skipped,
// and cache/quality outcomes. Stored inline in spaces.synthesis_data.analysis_runs.

export type AnalysisRunPipeline =
  | "decompose"
  | "decompose_hierarchical"
  | "research"
  | "research_deep"
  | "synthesize"
  | "synthesize_layered"
  | "strategy_refresh"
  | "generate_apps"
  | "expand"
  | "quick_decompose"
  | "reevaluate"
  | "chat_incremental"
  | "interweave";

export type AnalysisRunStatus = "running" | "completed" | "failed" | "skipped_cache";

export interface AnalysisRun {
  run_id: string;
  pipeline: AnalysisRunPipeline;
  started_at: string;
  completed_at?: string;
  status: AnalysisRunStatus;
  tier?: "quick" | "standard" | "deep" | "comprehensive";
  depth?: "quick" | "standard" | "deep";
  stages_run: string[];
  stages_skipped: string[];
  cache_hits: string[];
  /** Decomposition fingerprint at time of run — lets downstream steps detect staleness */
  fingerprint?: string;
  /** 0-100 overall quality/coverage/etc depending on pipeline */
  quality_score?: number;
  /** 0-100 strategy coverage score (synthesize only) */
  coverage_pct?: number;
  /** Human-readable note about why the run was special (e.g. "cache hit", "retry used") */
  note?: string;
  error?: string;
}
