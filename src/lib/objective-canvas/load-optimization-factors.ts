// ── Optimization factors — the intake-defined "what matters" ──────────
//
// One small helper shared by every surface that scores against the seed
// objective: deep-synthesize, derive-micro-objectives, make_plan, brief
// composition, expansion recommendations, etc.
//
// Source = spaces.synthesis_data.objective_canvas.prompt_sharpening
//          .salience.annotations[]  (concept_slug / phrase / kind / why
//                                    + leverage / uncertainty / priority)
//
// We rank by `priority` (falls back to leverage × uncertainty) and keep
// the top N — synthesis prompts saturate fast and these are weighting,
// not enumeration. Empty list on a legacy space that never ran sharpening;
// every caller treats that as "no factors, no scoring" and degrades gracefully.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** Trimmed intake factor for prompts + chips. `slug` is the stable id; the
 *  rest is display + reasoning fuel. */
export interface OptimizationFactor {
  slug: string;
  /** ≤ 36 char display (intake phrase, truncated with ellipsis). */
  label: string;
  /** pain | goal | constraint | lever | concept — drives chip color. */
  kind: string;
  /** Why-it-matters from intake; threaded into the prompt so models reason
   *  about coverage rather than slug-match. */
  why: string;
}

interface SaliencePayload {
  prompt_sharpening?: {
    salience?: {
      annotations?: unknown;
    };
  };
}

/** Load top-N factors for `spaceId`. Soft-fails to []. */
export async function loadOptimizationFactors(
  db: AnyDb,
  spaceId: string,
  limit = 8,
): Promise<OptimizationFactor[]> {
  try {
    const { data: space } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const synth = (space?.synthesis_data ?? {}) as Record<string, unknown>;
    const oc = synth.objective_canvas as SaliencePayload | undefined;
    const anns = oc?.prompt_sharpening?.salience?.annotations;
    if (!Array.isArray(anns)) return [];
    return anns
      .map((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        const phrase = typeof o.phrase === "string" ? o.phrase.trim() : "";
        const slug = typeof o.concept_slug === "string" ? o.concept_slug : "";
        const kind = typeof o.kind === "string" ? o.kind : "concept";
        const why = typeof o.why === "string" ? o.why.trim() : "";
        const lev = typeof o.leverage === "number" ? o.leverage : 0;
        const unc = typeof o.uncertainty === "number" ? o.uncertainty : 0;
        const pri = typeof o.priority === "number" ? o.priority : lev * unc;
        return { slug, phrase, kind, why, priority: pri };
      })
      .filter((f) => f.slug && f.phrase)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit)
      .map((f) => ({
        slug: f.slug,
        label: f.phrase.length > 36 ? f.phrase.slice(0, 35) + "…" : f.phrase,
        kind: f.kind,
        why: f.why,
      }));
  } catch (err) {
    console.warn("[load-optimization-factors] failed (soft):", err);
    return [];
  }
}

/** Build the { slug → { label, kind } } index the client uses to render
 *  the trace-back chip without re-deriving from prompt_sharpening. Always
 *  includes "general" as a passthrough. */
export function buildFactorIndex(
  factors: OptimizationFactor[],
): Record<string, { label: string; kind: string }> {
  const idx: Record<string, { label: string; kind: string }> = {
    general: { label: "General", kind: "concept" },
  };
  for (const f of factors) idx[f.slug] = { label: f.label, kind: f.kind };
  return idx;
}
