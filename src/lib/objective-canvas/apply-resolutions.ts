// ── apply-resolutions (Phase 3 write-back) ──────────────────────────
//
// Turns the user's Resolution Studio answers into durable metadata:
//   1. each answer → an AUTHORITATIVE glossary term (source "user", pinned —
//      so later entity/llm glossary passes never overwrite the user's taste),
//      merged into synthesis_data.glossary via the shared mergeGlossary,
//   2. the sharpened prompt is RE-FRAMED to bake in the resolved meanings.
// Variable/Feature re-synthesis is triggered separately (the board decomposes
// the re-framed objective). Soft-fail throughout — never throws to the route.

import { llmJSON } from "../llm";
import { mergeGlossary, type GlossaryTerm } from "./generate-glossary";
import { patchObjectiveCanvasState } from "./clarifying-state";
import {
  REFRAME_SYSTEM,
  REFRAME_USER,
  REFRAME_RESPONSE_SCHEMA,
  type PromptSharpeningArtifact,
} from "./prompt-sharpening-prompt";

const REFRAME_MODEL = "claude-sonnet-4-6";

export async function applyResolutionsForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
): Promise<{ sharpenedPrompt: string; glossaryCount: number } | null> {
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
    const resolutions = artifact?.resolutions ?? [];
    if (!artifact || resolutions.length === 0) return null;

    const now = new Date().toISOString();

    // ── Glossary terms from the answers — user-authoritative + pinned. ──
    const incoming: GlossaryTerm[] = resolutions
      .filter((r) => r.answer_text.trim() || r.chosen_readings.length)
      .map((r) => ({
        term: r.phrase.slice(0, 60),
        definition: (r.answer_text.trim() || r.chosen_readings.join("; ")).slice(
          0,
          320,
        ),
        aliases: [],
        source: "user" as const,
        pinned: true,
        concept_slug: r.concept_slug,
        layer_tag: r.kind,
        weight: 1,
        updated_at: now,
      }));

    // ── Re-frame the sharpened prompt (doesn't need the freshest synthesis). ──
    let reframed = artifact.sharpened_prompt;
    try {
      const out = await llmJSON<{ sharpened_prompt?: string }>({
        system: REFRAME_SYSTEM,
        user: REFRAME_USER(
          artifact.raw_prompt || "",
          artifact.sharpened_prompt || "",
          resolutions,
        ),
        provider: "anthropic",
        model: REFRAME_MODEL,
        maxTokens: 600,
        responseSchema: REFRAME_RESPONSE_SCHEMA,
      });
      if (out?.sharpened_prompt && out.sharpened_prompt.trim()) {
        reframed = out.sharpened_prompt.trim();
      }
    } catch (err) {
      console.warn(
        "[apply-resolutions] reframe failed (keeping prior prompt):",
        err instanceof Error ? err.message : String(err),
      );
    }

    // ── Persist: re-read fresh, merge glossary off the fresh copy, patch the
    // artifact, then write glossary at the top level (preserving everything). ──
    const { data: fresh } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const freshSynthesis = (fresh?.synthesis_data as Record<string, unknown> | null) ?? {};
    const existingGlossary: GlossaryTerm[] = Array.isArray(freshSynthesis.glossary)
      ? (freshSynthesis.glossary as GlossaryTerm[])
      : [];
    const mergedGlossary = incoming.length
      ? mergeGlossary(existingGlossary, incoming)
      : existingGlossary;

    const patched = patchObjectiveCanvasState(freshSynthesis, {
      prompt_sharpening: {
        ...artifact,
        sharpened_prompt: reframed,
        resolutions_applied_at: now,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const next = {
      ...(patched as Record<string, unknown>),
      glossary: mergedGlossary,
    };
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: next })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[apply-resolutions] persist failed:",
        writeRes.error.message,
      );
    }

    return { sharpenedPrompt: reframed, glossaryCount: mergedGlossary.length };
  } catch (err) {
    console.warn(
      "[apply-resolutions] failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
