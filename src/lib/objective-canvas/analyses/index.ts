// ── Cross-room Analysis Registry + Orchestrator ───────────────────
//
// Two registries: TIER_1 modules run automatically on every scan;
// TIER_2_OPERATIONS are on-demand "operations" the user fires from
// the workbench. Adding a new analysis = one new file + one new
// import here.
//
// The orchestrator (runScan / runOperation) handles per-module
// error isolation — if one analysis throws, the others still
// produce findings.

import { sharedMechanisms } from "./shared-mechanisms";
import { annotationOverlap } from "./annotation-overlap";
import { orphanAnnotations } from "./orphan-annotations";
import { painCoverage } from "./pain-coverage";
import { duplicateVariations } from "./duplicate-variations";
import { distillConcepts } from "./distill-concepts";
import { distillMacroProblems } from "./distill-macro-problems";
import { recommendNextMove } from "./recommend-next-move";
import { crossRoomContradictions } from "./cross-room-contradictions";
import { layerCoverage } from "./layer-coverage";
import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

/** Tier 1 — auto-run on every scan, no LLM cost. */
export const TIER_1_ANALYSES: AnalysisModule[] = [
  sharedMechanisms,
  annotationOverlap,
  orphanAnnotations,
  painCoverage,
  duplicateVariations,
  // Phase 11.A.10 — gracefully degrades to [] when state.layers is
  // undefined (pre-11.A spaces) or when no rooms carry layer_ordinals
  // (existing spaces before the proposer extension lands).
  layerCoverage,
];

/** Tier 2 — on-demand operations the user fires from the workbench.
 *  Each click runs one operation; result findings are merged into
 *  the cached scan output, preserving disposition state. */
export const TIER_2_OPERATIONS: AnalysisModule[] = [
  distillConcepts,
  distillMacroProblems,
  recommendNextMove,
  crossRoomContradictions,
];

/** All modules (Tier 1 + Tier 2) — useful for the workbench's
 *  operation catalog rendering. */
export const ALL_ANALYSES: AnalysisModule[] = [
  ...TIER_1_ANALYSES,
  ...TIER_2_OPERATIONS,
];

/** Look up a module by key. */
export function getAnalysis(key: string): AnalysisModule | undefined {
  return ALL_ANALYSES.find((m) => m.key === key);
}

/** Run all Tier 1 analyses, returning the merged findings. Each
 *  analysis is wrapped in a try/catch so one bad module doesn't
 *  black out the whole scan. */
export async function runScan(
  state: CrossRoomState,
): Promise<AnalysisFinding[]> {
  const all: AnalysisFinding[] = [];
  for (const mod of TIER_1_ANALYSES) {
    try {
      const out = await mod.run(state);
      all.push(...out);
    } catch (err) {
      console.warn(
        `[analysis:${mod.key}] failed (non-fatal):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return all;
}

/** Run a single on-demand operation by key. Throws if the key
 *  isn't registered or the module fails — callers surface as a
 *  user-visible error. */
export async function runOperation(
  key: string,
  state: CrossRoomState,
): Promise<AnalysisFinding[]> {
  const mod = TIER_2_OPERATIONS.find((m) => m.key === key);
  if (!mod) {
    throw new Error(`Unknown operation: ${key}`);
  }
  return mod.run(state);
}

/** Merge new findings into a cached findings list. Findings with
 *  the same id are replaced (re-run overwrites stale body), but
 *  disposition is preserved — the user's "acknowledged" status
 *  survives a rescan. */
export function mergeFindings(
  existing: AnalysisFinding[],
  fresh: AnalysisFinding[],
): AnalysisFinding[] {
  const dispById = new Map(
    existing.map((f) => [f.id, f.disposition]),
  );
  const freshIds = new Set(fresh.map((f) => f.id));

  const merged: AnalysisFinding[] = [];
  for (const f of fresh) {
    const prior = dispById.get(f.id);
    merged.push({
      ...f,
      disposition: prior ?? f.disposition,
    });
  }

  // Preserve existing findings from other analysis_keys that
  // weren't part of this scan (e.g. cached Tier 2 results
  // when only Tier 1 ran).
  for (const f of existing) {
    if (freshIds.has(f.id)) continue;
    merged.push(f);
  }
  return merged;
}

export type { AnalysisFinding, AnalysisModule, CrossRoomState };
