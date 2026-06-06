// ── generate-emergent-salience (Tier-1 board-aware re-scan) ──────────
//
// The original `generate-sharpening-depth` pass reads ONLY raw + sharpened
// prompt — once intake lands, the rail never surfaces a new ambiguity even
// as the board grows. This sibling pass takes the SAME artifact + the current
// board cards (caller-enumerated) + the EXISTING salient concept list, and
// asks the model: what's genuinely NEW that the user's work exposed?
//
// Additive only: emergent rows are MERGED on top of the existing salience
// (slug-collision → existing wins). No re-evaluation of prior annotations,
// no touching of addressed_by / resolved_at / micro state. Skipped entirely
// when there are zero board cards (nothing to learn from) or no existing
// salience to compare against. Soft-fail throughout.

import { llmJSON } from "../llm";
import {
  SHARPENING_EMERGENT_SYSTEM,
  SHARPENING_EMERGENT_USER,
  SHARPENING_DEPTH_RESPONSE_SCHEMA,
  normalizeEmergent,
  mergeEmergentSalience,
  type EmergentBoardCard,
  type PromptSharpeningArtifact,
  type SalienceMetadata,
} from "./prompt-sharpening-prompt";
import { patchObjectiveCanvasState } from "./clarifying-state";

// Same model as the depth pass — quality matters more than speed for
// salience reasoning. `claude-sonnet-4-6` is the current reliable default.
const EMERGENT_MODEL = "claude-sonnet-4-6";

const MIN_CARDS_TO_RUN = 3;

export async function generateEmergentSalienceForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  cards: EmergentBoardCard[],
): Promise<{
  salience: SalienceMetadata;
  emergentCount: number;
} | null> {
  try {
    if (cards.length < MIN_CARDS_TO_RUN) return null;

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
    // Need a base artifact + at least one existing salient concept to compare
    // against; without that the orthogonality rule has no anchor.
    if (!artifact?.salience?.annotations?.length) return null;

    const sharpened = (artifact.sharpened_prompt || artifact.raw_prompt || "")
      .trim();
    if (sharpened.length < 4) return null;

    const existing = artifact.salience.annotations.map((a) => ({
      concept_slug: a.concept_slug,
      phrase: a.phrase,
      kind: a.kind,
    }));
    const existingSlugs = new Set(existing.map((e) => e.concept_slug));

    const nowIso = new Date().toISOString();
    const raw = await llmJSON<Record<string, unknown>>({
      system: SHARPENING_EMERGENT_SYSTEM,
      user: SHARPENING_EMERGENT_USER(sharpened, existing, cards),
      provider: "anthropic",
      model: EMERGENT_MODEL,
      // Smaller cap than the full depth pass — we only want ≤4 new rows with
      // their micros; way under the 4096 the depth pass uses.
      maxTokens: 2200,
      responseSchema: SHARPENING_DEPTH_RESPONSE_SCHEMA,
    });

    const emergent = normalizeEmergent(raw, existingSlugs, nowIso);
    if (emergent.length === 0) {
      // Nothing new — return the existing salience unchanged so callers can
      // distinguish "ran and found nothing" from "no run at all".
      return { salience: artifact.salience, emergentCount: 0 };
    }

    // Re-read fresh to minimise races with other writers (apply-resolutions,
    // micro-address). If the underlying annotation list shape changed (e.g.
    // a depth re-run replaced it), skip the merge rather than clobber.
    const { data: fresh } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const freshSynthesis =
      (fresh?.synthesis_data as Record<string, unknown> | null) ?? {};
    const freshArtifact = (
      (freshSynthesis as { objective_canvas?: unknown }).objective_canvas as
        | { prompt_sharpening?: PromptSharpeningArtifact }
        | undefined
    )?.prompt_sharpening;
    if (!freshArtifact?.salience?.annotations) {
      return { salience: artifact.salience, emergentCount: 0 };
    }

    const merged = mergeEmergentSalience(
      freshArtifact.salience.annotations,
      emergent,
    );
    // If the merge added nothing (every emergent collided with a slug some
    // parallel writer added since we started), bail without a write.
    if (merged.length === freshArtifact.salience.annotations.length) {
      return { salience: freshArtifact.salience, emergentCount: 0 };
    }

    const nextSalience: SalienceMetadata = {
      ...freshArtifact.salience,
      annotations: merged,
      generated_at: nowIso,
    };
    const patched = patchObjectiveCanvasState(freshSynthesis, {
      prompt_sharpening: { ...freshArtifact, salience: nextSalience },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: patched })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[emergent-salience] persist failed:",
        writeRes.error.message,
      );
      return { salience: artifact.salience, emergentCount: 0 };
    }

    // Count the fresh emergent rows that actually SURVIVED the merge's priority
    // cap — NOT the net size delta (which reads 0 when fresh rows displace
    // existing ones at the 10-cap, hiding the "N new questions" banner).
    const existingSlugs2 = new Set(
      freshArtifact.salience.annotations.map((a) => a.concept_slug),
    );
    const freshSlugs = new Set(
      emergent
        .map((e) => e.concept_slug)
        .filter((s) => !existingSlugs2.has(s)),
    );
    const survivedCount = merged.filter((m) =>
      freshSlugs.has(m.concept_slug),
    ).length;

    return {
      salience: nextSalience,
      emergentCount: survivedCount,
    };
  } catch (err) {
    console.warn(
      "[emergent-salience] generation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
