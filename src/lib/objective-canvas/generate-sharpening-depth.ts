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
} from "./prompt-sharpening-prompt";
import { patchObjectiveCanvasState } from "./clarifying-state";

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

    const result = await llmJSON<Record<string, unknown>>({
      system: SHARPENING_DEPTH_SYSTEM,
      user: SHARPENING_DEPTH_USER(raw, sharpened),
      provider: "anthropic",
      model: DEPTH_MODEL,
      // Depth pass returns more than the fast pass: interpretation fields + up
      // to ~10 salience annotations, and EACH annotation now also carries 2–4
      // micro_questions (added later). That ~tripled the output, so the prior
      // 4096 cap truncated the LAST schema field (salience_annotations) →
      // normalizeSalience returned [] → the function returned null and nothing
      // persisted (no salience → no priority map, no "Optimize for", no resolve
      // panel — the pipeline silently stalled after the heatmap). 8192 restores
      // real headroom for the micro-decomposed output. If it ever truncates
      // again, lower the annotation/micro cap rather than starving the cap.
      maxTokens: 8192,
      responseSchema: SHARPENING_DEPTH_RESPONSE_SCHEMA,
    });

    const { hidden, salience } = normalizeSalience(result);
    if (!salience.annotations.length) {
      // Nothing usable — don't persist an empty block (lets a later retry
      // try again rather than caching a dud).
      return null;
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
