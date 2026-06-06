// ── generate-sharpening-depth ──────────────────────────────────────
//
// Lazy SECOND pass for the Prompt Sharpening Card. The fast intake pass
// (generate-prompt-sharpening) lands the visible refinement quickly; this
// pass deepens the SAME artifact — filling the interpretation metadata the
// fast schema drops AND adding a salience map (which concepts carry the most
// leverage / pain / goal weight and most need optimisation modelling).
// Driven on-demand by the card once the base artifact exists. Soft-fail
// throughout — never blocks the board.
//
// It writes back into the one JSONB blob the fast pass owns
// (spaces.synthesis_data.objective_canvas.prompt_sharpening) so there is a
// single source of truth; downstream agents + the Resolution Studio read the
// salience map from there.

import { llmJSON } from "../llm";
import {
  SHARPENING_DEPTH_SYSTEM,
  SHARPENING_DEPTH_USER,
  SHARPENING_DEPTH_RESPONSE_SCHEMA,
  normalizeSalience,
  type PromptSharpeningArtifact,
  type SalienceMetadata,
  type SalienceAnnotation,
} from "./prompt-sharpening-prompt";
import { patchObjectiveCanvasState } from "./clarifying-state";

const slugifyConcept = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);

/** Fallback salience when the LLM depth pass yields none (truncation / model
 *  error). Derives a usable priority map from the fast pass's
 *  `ranked_ambiguities` (which always exist) so the downstream — priority map,
 *  resolve panel, goal rail — NEVER goes blank. Coarser than the real pass (no
 *  micro-decomposition, no candidate readings) but never nothing. */
function deriveSalienceFromRanked(
  artifact: PromptSharpeningArtifact,
): SalienceAnnotation[] {
  const ranked = Array.isArray(artifact.ranked_ambiguities)
    ? artifact.ranked_ambiguities
    : [];
  return ranked.slice(0, 8).map((r) => {
    const uncertainty =
      r.severity === "high" ? 0.85 : r.severity === "medium" ? 0.6 : 0.4;
    const phrase =
      (r.ambiguity_type || "").replace(/ambiguity/i, "").trim() ||
      (r.ambiguity || "").slice(0, 48) ||
      "Ambiguity";
    const leverage = 0.7;
    return {
      phrase,
      kind: "concept",
      leverage,
      uncertainty,
      why: (r.ambiguity || r.question_to_resolve || "").trim(),
      candidate_readings: [],
      concept_slug: slugifyConcept(phrase),
      priority: Math.round(leverage * (0.5 + 0.5 * uncertainty) * 1000) / 1000,
    };
  });
}

// The depth pass is lazy/background, so quality matters more than raw speed.
// Sonnet-4-6 is the reliable, current default; bump to BEST_CLAUDE_MODEL for
// maximal depth (slower). MUST be a current model id (a retired id 404s →
// soft-fail → no salience).
const DEPTH_MODEL = "claude-sonnet-4-6";

export async function generateSharpeningDepthForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  opts?: { force?: boolean },
): Promise<SalienceMetadata | null> {
  try {
    const { data: space } = await db
      .from("spaces")
      .select("user_id, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space || space.user_id !== userId) return null;

    const oc = (space.synthesis_data as Record<string, unknown> | null)
      ?.objective_canvas as
      | { prompt_sharpening?: PromptSharpeningArtifact }
      | undefined;
    const artifact = oc?.prompt_sharpening;
    // The base (fast) pass must have landed first — it supplies the sharpened
    // prompt this pass reads. If it's not there yet, the card retries later.
    if (!artifact) return null;
    // Idempotent: skip if already deepened (unless forced, e.g. re-sharpen).
    if (artifact.salience?.annotations?.length && !opts?.force) {
      return artifact.salience;
    }

    const raw = (artifact.raw_prompt || "").trim();
    const sharpened = (artifact.sharpened_prompt || raw).trim();
    if (sharpened.length < 4) return null;

    // Resilient: catch the LLM error locally (don't let it bubble to the outer
    // catch) so we can fall back to ranked_ambiguities below either way.
    let result: Record<string, unknown> | null = null;
    try {
      result = await llmJSON<Record<string, unknown>>({
        system: SHARPENING_DEPTH_SYSTEM,
        user: SHARPENING_DEPTH_USER(raw, sharpened),
        provider: "anthropic",
        model: DEPTH_MODEL,
        // CRITICAL: llmJSON's anthropic path aborts each attempt at 60s
        // (timeout: 60_000) and withRetry then retries up to 4×, so an output
        // that takes >60s to GENERATE never returns — it just times out, retries,
        // and blows past the route's 120s maxDuration → 504 → nothing persists
        // (both the card fork AND the goal rail go blank). The prompt is now
        // capped at 5 annotations × 2–3 micros precisely so the response stays
        // ~2–2.8k tokens and generates in well under 60s. maxTokens 3500 leaves
        // headroom against truncation while bounding worst-case time. If it
        // STILL truncates, the ranked-ambiguities fallback below keeps the
        // downstream alive. Do NOT raise this without also raising the SDK
        // per-attempt timeout in llm.ts — they are coupled.
        maxTokens: 3500,
        responseSchema: SHARPENING_DEPTH_RESPONSE_SCHEMA,
      });
    } catch (e) {
      console.warn(
        "[sharpening-depth] LLM call failed; falling back to ranked_ambiguities:",
        e instanceof Error ? e.message : String(e),
      );
    }

    const { hidden, salience } = normalizeSalience(result ?? {});
    if (!salience.annotations.length) {
      // The LLM depth pass produced no usable salience (truncation OR error).
      // Rather than stall the WHOLE downstream (priority map + resolve panel +
      // goal rail all need salience), derive a fallback priority map from the
      // fast pass's ranked_ambiguities so the user ALWAYS gets a priority map +
      // can resolve. Coarser (no micro-decomposition) but never blank.
      const fallback = deriveSalienceFromRanked(artifact);
      if (!fallback.length) return null;
      salience.annotations = fallback;
    }
    salience.generated_at = new Date().toISOString();

    // ── Merge into the SAME artifact: enrich hidden_metadata + attach
    // salience. known_constraints is derived from the constraint annotations
    // so downstream agents get a clean constraint list for free. ──
    const merged: PromptSharpeningArtifact = {
      ...artifact,
      hidden_metadata_for_agents: {
        ...artifact.hidden_metadata_for_agents,
        explicit_meaning: hidden.explicit_meaning,
        inferred_meaning: hidden.inferred_meaning,
        deep_intent: hidden.deep_intent,
        hidden_assumptions: hidden.hidden_assumptions,
        layered_understanding: hidden.layered_understanding,
        known_constraints: salience.annotations
          .filter((a) => a.kind === "constraint")
          .map((a) => a.phrase),
      },
      salience,
    };

    // Re-read for the freshest base, then patch (the fast pass or a parallel
    // write may have touched synthesis_data since we loaded it).
    const { data: fresh } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const patched = patchObjectiveCanvasState(fresh?.synthesis_data, {
      prompt_sharpening: merged,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: patched })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[sharpening-depth] persist failed:",
        writeRes.error.message,
      );
    }

    return salience;
  } catch (err) {
    console.warn(
      "[sharpening-depth] generation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
