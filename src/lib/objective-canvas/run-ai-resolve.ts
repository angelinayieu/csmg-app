// ── runAiResolve — shared headless "AI resolve" orchestration ─────────
//
// The network sequence behind every AI-driven resolve — the sharpening card's
// inline "Let AI decide", the forked ambiguity card's "AI resolve" / "Resolve
// all": auto-resolve the given concepts → persist resolutions → apply (re-frame
// the sharpened prompt + pinned-glossary write-back). Returns the re-framed
// prompt so the caller can decompose against it.
//
// Reuses the existing routes — does NOT fork them. This is the base
// (non-recursive) form of the clarification agent; the diverge→converge→
// self-question recursion is a later enhancement layered on top. Centralising
// it here also removes the near-duplicate commit logic the plan flagged across
// the two resolve entry points.

import type { Resolution } from "./prompt-sharpening-prompt";
import { planResolution } from "./clarify-planner";

export interface ResolveConcept {
  phrase: string;
  kind: string;
  why?: string;
  leverage?: number;
  uncertainty?: number;
  candidate_readings?: string[];
  concept_slug?: string;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);

/** Run the AI-resolve sequence for `concepts`. Returns the re-framed sharpened
 *  prompt (undefined if apply didn't return one), or null if nothing committed.
 *  Soft-fails per step: a failed auto-resolve falls back to each concept's top
 *  candidate reading so something coherent is always committed. */
export async function runAiResolve(
  spaceId: string,
  concepts: ResolveConcept[],
): Promise<{ sharpenedPrompt?: string; shouldDecompose: boolean } | null> {
  if (!spaceId || concepts.length === 0) return null;
  // Plan the strategy: only decompose into Feature/Variable cards when ≥1
  // concept warrants it (a goal/pain/lever). A pure term/definition resolves
  // into a glossary meaning, not a card spray (the super-picky board rule).
  const plan = planResolution(concepts);
  const now = new Date().toISOString();

  // 1. One batched model call for a coherent reading per concept.
  let aiRes: Resolution[] = [];
  try {
    const r = await fetch(`/api/objective/${spaceId}/auto-resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        concepts: concepts.map((c) => ({
          concept_slug: c.concept_slug || slugify(c.phrase),
          phrase: c.phrase,
          kind: c.kind,
          why: c.why,
          candidate_readings: c.candidate_readings || [],
        })),
      }),
    });
    if (r.ok) {
      const j = (await r.json()) as { resolutions?: Resolution[] };
      aiRes = Array.isArray(j?.resolutions) ? j.resolutions : [];
    }
  } catch {
    /* fall back below */
  }

  // 2. Merge: AI answers win; fall back to each concept's top reading so every
  //    concept is committed even if the call failed entirely.
  const bySlug = new Map<string, Resolution>();
  for (const c of concepts) {
    const slug = c.concept_slug || slugify(c.phrase);
    const reads = c.candidate_readings || [];
    if (reads.length) {
      bySlug.set(slug, {
        concept_slug: slug,
        phrase: c.phrase,
        kind: c.kind,
        chosen_readings: [reads[0]],
        answer_text: "",
        source: "ai",
        resolved_at: now,
      });
    }
  }
  for (const r of aiRes) if (r?.concept_slug) bySlug.set(r.concept_slug, r);
  const resolutions = [...bySlug.values()];
  if (resolutions.length === 0) return null;

  // 3. Persist the resolutions.
  try {
    await fetch(`/api/objective/${spaceId}/resolutions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolutions }),
    });
  } catch {
    return null;
  }

  // 4. Apply: re-frame the prompt + write back the pinned glossary.
  let sharpenedPrompt: string | undefined;
  try {
    const r = await fetch(`/api/objective/${spaceId}/apply-resolutions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (r.ok) {
      const j = (await r.json()) as { sharpenedPrompt?: string };
      sharpenedPrompt = j?.sharpenedPrompt;
    }
  } catch {
    /* resolutions still saved — re-frame is best-effort */
  }
  return { sharpenedPrompt, shouldDecompose: plan.shouldDecompose };
}
