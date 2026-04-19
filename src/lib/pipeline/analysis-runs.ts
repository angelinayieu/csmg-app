// Helpers for appending to the spaces.synthesis_data.analysis_runs audit trail.
// Runs are capped at 30 entries per space to prevent JSONB bloat — the most recent
// entries are kept.

import type { AnalysisRun } from "@/types/analysis-runs";

const MAX_RUNS_PER_SPACE = 30;

export function makeRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append a run to the list, trimming to keep the most recent N. Pure — caller
 * is responsible for persisting the returned array.
 */
export function appendRun(
  existing: AnalysisRun[] | undefined | null,
  run: AnalysisRun,
  maxRuns = MAX_RUNS_PER_SPACE,
): AnalysisRun[] {
  const prior = Array.isArray(existing) ? existing.filter((r) => r.run_id !== run.run_id) : [];
  const updated = [run, ...prior].slice(0, maxRuns);
  return updated;
}

/**
 * Update an in-progress run (status=running) with completion info. Replaces the
 * matching run by run_id. If none found, appends as a new entry.
 */
export function completeRun(
  existing: AnalysisRun[] | undefined | null,
  runId: string,
  updates: Partial<AnalysisRun>,
): AnalysisRun[] {
  const prior = Array.isArray(existing) ? existing : [];
  const target = prior.find((r) => r.run_id === runId);
  if (!target) {
    // Fallback — append if we lost track of the starting entry
    return prior.slice(0, MAX_RUNS_PER_SPACE - 1);
  }
  const merged: AnalysisRun = {
    ...target,
    ...updates,
    completed_at: updates.completed_at ?? new Date().toISOString(),
  };
  return [merged, ...prior.filter((r) => r.run_id !== runId)].slice(0, MAX_RUNS_PER_SPACE);
}
