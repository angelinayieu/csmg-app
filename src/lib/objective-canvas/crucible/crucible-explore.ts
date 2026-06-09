// ── Crucible exploration (the diverge / brainstorm half) ─────────────
//
// Orchestrates one on-demand exploration of a single ambiguity:
//   diverge → K variations  →  converge → principle (intersection) + decisions
//   (differences) + recommended default  →  persist as a swappable BLOCK.
//
// Stored as a library_objects(object_type:"decision") row whose content_snapshot
// IS the ExplorationBlock — so it lives in the same object layer as the Crucible
// loop's outputs (variables / constraints / leverage points) and can be composed
// into the objective brief later. Idempotent on source_ref (`explore:{slug}`):
// re-exploring the same ambiguity updates in place. SERVER-ONLY. Soft-fails.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLibraryObject,
  mergeObjectContentSnapshot,
  upsertLibraryObject,
} from "@/lib/objective-canvas/library-objects";
import { convergeVariations, divergeAnswers } from "./crucible-engine";
import type { FactorLite } from "./crucible-prompts";
import type { ExplorationBlock } from "./crucible-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export interface ExploreCtx {
  objective: string;
  preamble: string;
  factors: FactorLite[];
}

export interface ExploreResult {
  objectId: string | null;
  block: ExplorationBlock;
}

/** Run diverge → converge for one ambiguity and persist the block. */
export async function exploreAmbiguity(
  db: AnyDb,
  userId: string,
  spaceId: string,
  ctx: ExploreCtx,
  ambiguity: { headline: string; question: string; source?: string },
  nowIso: string,
): Promise<ExploreResult> {
  const variations = await divergeAnswers({
    objective: ctx.objective,
    preamble: ctx.preamble,
    headline: ambiguity.headline,
    question: ambiguity.question,
    factors: ctx.factors,
  });

  const converged =
    variations.length > 0
      ? await convergeVariations({
          objective: ctx.objective,
          headline: ambiguity.headline,
          variations,
        })
      : { principle: "", decisions: [], recommendedIndex: 0, recommendedWhy: "" };

  const block: ExplorationBlock = {
    headline: ambiguity.headline,
    question: ambiguity.question,
    source: ambiguity.source,
    principle: converged.principle,
    variations,
    decisions: converged.decisions,
    recommendedIndex: converged.recommendedIndex,
    activeIndex: converged.recommendedIndex,
    generatedAt: nowIso,
  };

  const objectId = await upsertLibraryObject(db, {
    spaceId,
    userId,
    objectType: "decision",
    title: ambiguity.headline.slice(0, 120),
    summary: converged.principle.slice(0, 240) || null,
    sourceRef: `explore:${slugify(ambiguity.headline)}`,
    contentSnapshot: block,
  });

  return { objectId, block };
}

/** Read a persisted exploration block (for card reload). */
export async function getExplorationBlock(
  db: AnyDb,
  objectId: string,
): Promise<ExplorationBlock | null> {
  const row = await getLibraryObject(db, objectId);
  const snap = row?.content_snapshot;
  if (snap && typeof snap === "object" && Array.isArray((snap as ExplorationBlock).variations)) {
    return snap as ExplorationBlock;
  }
  return null;
}

/** Swap the chosen variation (persists activeIndex into the block). Returns the
 *  updated block, or null if the object/index is invalid. */
export async function swapExplorationVariation(
  db: AnyDb,
  objectId: string,
  activeIndex: number,
): Promise<ExplorationBlock | null> {
  const block = await getExplorationBlock(db, objectId);
  if (!block) return null;
  if (activeIndex < 0 || activeIndex >= block.variations.length) return null;
  const next: ExplorationBlock = { ...block, activeIndex };
  await mergeObjectContentSnapshot(db, objectId, { activeIndex });
  return next;
}
