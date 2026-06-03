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

import { llmJSON, BEST_CLAUDE_MODEL } from "../llm";
import {
  SHARPENING_AGENT_SYSTEM,
  SHARPENING_AGENT_USER,
  SHARPENING_RESPONSE_SCHEMA,
  normalizeSharpening,
  type PromptSharpeningArtifact,
} from "./prompt-sharpening-prompt";
import { patchObjectiveCanvasState } from "./clarifying-state";

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
    const existing = (space.synthesis_data as Record<string, unknown> | null)
      ?.objective_canvas as { prompt_sharpening?: PromptSharpeningArtifact } | undefined;
    if (existing?.prompt_sharpening && !opts?.force) {
      return existing.prompt_sharpening;
    }

    // ── Agent: generate the sharpening artifact ──
    // Opus 4.8 (frontier, no temperature param) — output quality IS the
    // product here. The validator normalizes + guarantees all 10 heatmap
    // zones are present.
    let artifact = await llmJSON<PromptSharpeningArtifact>({
      system: SHARPENING_AGENT_SYSTEM,
      user: SHARPENING_AGENT_USER(raw),
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 4096,
      responseSchema: SHARPENING_RESPONSE_SCHEMA,
      validator: (d) => normalizeSharpening(d, raw),
    });

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
