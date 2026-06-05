// ── generate-prompt-sharpening ────────────────────────────────────
//
// Fire-and-forget helper (mirrors generate-initial-annotations): run the
// Prompt Sharpening Agent on the raw objective, run a best-effort critic,
// and persist the artifact into spaces.synthesis_data.objective_canvas
// .prompt_sharpening. Soft-fail throughout — never blocks intake.
//
// The whole artifact (visible refinement + hidden downstream metadata)
// lives in that one JSONB blob; the board card reads the visible part and
// downstream Explore / Distill agents read the hidden part.

import { llmJSON } from "../llm";
import {
  SHARPENING_AGENT_SYSTEM,
  SHARPENING_AGENT_USER,
  SHARPENING_RESPONSE_SCHEMA,
  normalizeSharpening,
  type PromptSharpeningArtifact,
} from "./prompt-sharpening-prompt";
import { patchObjectiveCanvasState } from "./clarifying-state";
import { withMetering } from "../llm/usage-meter";

// Speed is the priority for the intake card — it's the first thing the user
// waits on, and Opus made it take 30–60s. Sonnet is ~3–4x faster for this
// structured rewrite + extraction task with negligible quality loss (the
// trimmed visible-only schema does most of the speedup). To prefer maximal
// quality over speed, set this to BEST_CLAUDE_MODEL (slower).
//
// MUST be a CURRENT model id. The previous value "claude-3-5-sonnet-20241022"
// is RETIRED and the API now 404s it — llmJSON threw, generation soft-failed
// to null, the artifact was never persisted, and the intake card sat at the
// 94% progress cap (its design max) until the ~4-min poll gave up. Use the
// current fast Sonnet, which the rest of the app already runs on.
const PROMPT_SHARPENING_MODEL = "claude-sonnet-4-6";

export async function generatePromptSharpeningForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  objective: string,
  opts?: { force?: boolean },
): Promise<PromptSharpeningArtifact | null> {
  try {
    const raw = (objective ?? "").trim();
    if (raw.length < 4) return null;

    // Load the space + idempotency check (skip if already sharpened).
    const { data: space } = await db
      .from("spaces")
      .select("user_id, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space || space.user_id !== userId) return null;
    const ocState = (space.synthesis_data as Record<string, unknown> | null)
      ?.objective_canvas as
      | { sandbox?: boolean; prompt_sharpening?: PromptSharpeningArtifact }
      | undefined;
    // Sandbox spaces are blank scratch boards — never auto-sharpen them.
    if (ocState?.sandbox === true) return null;
    if (ocState?.prompt_sharpening && !opts?.force) {
      return ocState.prompt_sharpening;
    }

    // ── Agent: generate the sharpening artifact ──
    // Fast Sonnet + a trimmed visible-only schema → snappy intake. The
    // validator normalizes + guarantees all 10 heatmap zones are present.
    // Wrap in a metering context so this call's token + $ cost lands in
    // llm_call_log (no runId → no pipeline_runs aggregate; sharpening isn't a
    // pipeline run). This is the intake-path proof that the meter populates.
    let artifact = await withMetering(
      { db, userId, spaceId, callSite: "prompt_sharpening", runId: null },
      () =>
        llmJSON<PromptSharpeningArtifact>({
          system: SHARPENING_AGENT_SYSTEM,
          user: SHARPENING_AGENT_USER(raw),
          provider: "anthropic",
          model: PROMPT_SHARPENING_MODEL,
      // Token budget: the earlier "~600 tokens" estimate was wrong. The schema
      // forces a full 10-zone ambiguity_heatmap (3 fields each) AND the model
      // reliably over-produces ranked_ambiguities (~10, not the prompt's 3–5),
      // so the REAL output is ~2.1k tokens. At 2048 it hit `max_tokens` EVERY
      // time → the heatmap (generated last) was truncated off; when the cut
      // landed mid-value the Anthropic SDK couldn't parse the partial tool-call
      // and threw → generation soft-failed to null → the board card showed
      // "Couldn't sharpen the prompt". 4096 clears the real output (~2.1k) with
      // comfortable headroom (verified: stop_reason=tool_use, all 10 zones).
      maxTokens: 4096,
      responseSchema: SHARPENING_RESPONSE_SCHEMA,
      validator: (d) => normalizeSharpening(d, raw),
        }),
    );

    // Critic pass intentionally SKIPPED in the minimal/intake flow so the
    // sharpening card fills as fast as possible (the optimistic placeholder
    // already shows instantly). The agent + validator output is used as-is.
    if (!artifact.quality_status) artifact.quality_status = "agent";

    artifact.generated_at = new Date().toISOString();

    // ── Persist into synthesis_data (re-read for the freshest base) ──
    const { data: fresh } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const patched = patchObjectiveCanvasState(fresh?.synthesis_data, {
      // prompt_sharpening is a module-augmentation key on the canvas state;
      // patchObjectiveCanvasState spreads it onto objective_canvas as-is.
      prompt_sharpening: artifact,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: patched })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn("[prompt-sharpening] persist failed:", writeRes.error.message);
    }

    return artifact;
  } catch (err) {
    console.warn(
      "[prompt-sharpening] generation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
