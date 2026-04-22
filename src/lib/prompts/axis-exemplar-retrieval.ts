// ── Axis exemplar retrieval ──
//
// The orchestrator (per-axis PS generator) calls
// `loadAxisExemplars(axis, k)` and gets back k high-quality exemplars
// for few-shot injection. Priority order:
//
//   1. DB-sourced exemplars — high-quality historical runs the
//      semantic scorer rated highly, stored in `axis_exemplars` table
//      when that table exists. This makes the system self-improving:
//      the more analyses users run, the better the exemplars get.
//
//   2. Seed file — hand-written exemplars shipped in the repo
//      (axis-exemplar-seeds.ts). Used when DB is empty or the query
//      fails. Every axis has ≥1 hand-written seed to guarantee some
//      exemplar is always available.
//
// Soft-fails: if the DB read throws, silently falls back to seeds.
// Few-shot exemplars are a quality uplift, not a hard dependency.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type { AxisExemplar } from "./axis-prompts";
import { getAxisExemplarSeeds } from "./axis-exemplar-seeds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/**
 * Expected DB row shape for `axis_exemplars` (table may not yet exist
 * — falls back to seeds when the query errors). Kept permissive so a
 * future migration can evolve the schema without breaking this path.
 */
interface AxisExemplarRow {
  axis: ProbabilitySpaceAxis;
  input_gist: string;
  output_excerpt: string;
  /** Semantic quality score the row was accepted at. Higher is better. */
  quality_score: number | null;
  /** Recency — prefer recent exemplars as vocabulary drifts. */
  created_at: string;
}

export interface LoadExemplarsOpts {
  /** How many exemplars to return. Default 2 (keeps prompt context
   *  bounded — more than 2 tends to cargo-cult rather than generalize). */
  k?: number;
  /** Minimum semantic score a DB exemplar must have to be eligible.
   *  0.7 is the default ("meets the bar for the lesson we want the
   *  model to internalize"). */
  minQualityScore?: number;
}

/**
 * Returns up to `k` axis-specific exemplars for few-shot injection
 * into a probability-space generator's system prompt.
 */
export async function loadAxisExemplars(
  db: AnyDb | null,
  axis: ProbabilitySpaceAxis,
  opts: LoadExemplarsOpts = {},
): Promise<AxisExemplar[]> {
  const k = opts.k ?? 2;
  const minScore = opts.minQualityScore ?? 0.7;

  // Try DB first. Gracefully degrade if the table doesn't exist yet
  // (PGRST205 / 42P01) or the query throws — seed file is the safe
  // fallback and every axis has at least one hand-written seed.
  if (db) {
    try {
      const { data, error } = await db
        .from("axis_exemplars")
        .select("axis, input_gist, output_excerpt, quality_score, created_at")
        .eq("axis", axis)
        .gte("quality_score", minScore)
        .order("quality_score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(k);

      if (!error && data && data.length > 0) {
        const rows = data as AxisExemplarRow[];
        return rows.map((r) => ({
          inputGist: r.input_gist,
          outputExcerpt: r.output_excerpt,
        }));
      }
    } catch (err) {
      // Common case pre-migration: table doesn't exist → fall through
      // to seeds silently. Only log on genuinely unexpected errors.
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !msg.includes("PGRST205") &&
        !msg.includes("relation") &&
        !msg.includes("does not exist")
      ) {
        console.warn(
          `[axis-exemplars] DB fetch failed for ${axis}, using seeds:`,
          err,
        );
      }
    }
  }

  // Seed fallback — hand-written, always available.
  return getAxisExemplarSeeds(axis).slice(0, k);
}

/**
 * Hydrate ALL axes in parallel. Call this once at the top of the
 * parallel-generation orchestration so each per-axis call doesn't
 * re-fetch. Returns a map keyed by axis for easy lookup.
 */
export async function loadAllAxisExemplars(
  db: AnyDb | null,
  axes: ProbabilitySpaceAxis[],
  opts: LoadExemplarsOpts = {},
): Promise<Map<ProbabilitySpaceAxis, AxisExemplar[]>> {
  const results = await Promise.all(
    axes.map(async (a) => [a, await loadAxisExemplars(db, a, opts)] as const),
  );
  return new Map(results);
}
