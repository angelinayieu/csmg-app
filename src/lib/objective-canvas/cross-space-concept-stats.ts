// ── Cross-Space Concept Stats ──────────────────────────────────────
//
// Given a set of concept_slugs in use on the CURRENT space (derived
// from its annotations / glossary), look up the user's OTHER spaces
// and count how many of them have entities whose names slugify to the
// same value. Powers the "ACROSS WORKSPACE · N spaces" affordance on
// the annotation popover.
//
// Why this exists / why not canonical_concepts:
//   The signature-pipeline `canonical_concepts.canonical_code` is a
//   structured dot-joined code (e.g. `pain.cortisol.feedback-loop`)
//   built by `buildCanonicalCode(basis)` — NOT a slugified concept
//   noun phrase. So my annotation-derived `concept_slug` (e.g.
//   `vivid-experience`) cannot cleanly equality-match `canonical_code`.
//   Bridging via entity.name (slugified at read time) is the additive
//   path: no schema change, soft-coupled to whatever entities the user
//   has spread across their spaces.
//
// Soft-fail throughout: any DB error returns an empty map so the
// affordance hides gracefully — the popover keeps working with just
// the in-space glossary definition.

import { slugifyConcept } from "@/lib/objective-canvas/normalize-annotations";

export interface CrossSpaceConceptStat {
  /** Distinct OTHER spaces (excluding the current) where this concept
   *  surfaces as an entity name. Higher = stronger "you've reasoned
   *  about this across your work" signal. */
  space_count: number;
  /** Total entities (across those spaces) with names that slugify to
   *  this concept_slug. Coarser signal than space_count — multiple
   *  entities in one space still count once toward space_count. */
  entity_count: number;
  /** One example display_name from those entities, useful as a chip
   *  label when the popover wants to show "as: Vivid Experiences" in
   *  the cross-space context. First-seen wins. */
  sample_name: string;
}

export interface LoadCrossSpaceConceptStatsArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  /** The space we're rendering — entities IN this space don't count
   *  as "cross-space" evidence (they're already visible in the
   *  current view). */
  currentSpaceId: string;
  /** The concept_slugs we want stats for. Typically derived from this
   *  space's annotations / glossary upstream. Empty array → no work
   *  done (returns empty map). */
  conceptSlugs: string[];
  /** Cap on entities pulled per query (the user's own KG, but still
   *  worth bounding). Defaults match concept-memory-feed's pattern. */
  entityCap?: number;
}

/** Returns Map<concept_slug, stats>. Slugs with zero hits across other
 *  spaces are OMITTED from the map (callers check `.has(slug)` before
 *  rendering the affordance). */
export async function loadCrossSpaceConceptStats(
  args: LoadCrossSpaceConceptStatsArgs,
): Promise<Map<string, CrossSpaceConceptStat>> {
  const { db, userId, currentSpaceId, conceptSlugs, entityCap = 2000 } = args;
  const out = new Map<string, CrossSpaceConceptStat>();
  if (conceptSlugs.length === 0) return out;

  // Build a Set for O(1) slug-membership checks during aggregation —
  // entities can be many, slugs are few.
  const targetSlugs = new Set(conceptSlugs.filter((s) => s.length > 0));
  if (targetSlugs.size === 0) return out;

  // ── 1. Resolve user's OTHER spaces (exclude the current one). ──
  const { data: spaceRows, error: spaceErr } = await db
    .from("spaces")
    .select("id")
    .eq("user_id", userId)
    .neq("id", currentSpaceId);
  if (spaceErr) {
    console.warn(
      "[cross-space-concept-stats] space lookup failed:",
      spaceErr.message,
    );
    return out;
  }
  const otherSpaceIds = ((spaceRows ?? []) as Array<{ id: string }>).map(
    (s) => s.id,
  );
  if (otherSpaceIds.length === 0) return out;

  // ── 2. Pull entities (name + space_id) from those spaces, cap-bounded.
  //      RLS handles the auth side; explicit `.in(space_id, ...)` keeps
  //      the query plan tight even with many spaces. ──
  const { data: entityRows, error: entityErr } = await db
    .from("entities")
    .select("name, space_id")
    .in("space_id", otherSpaceIds)
    .limit(entityCap);
  if (entityErr) {
    console.warn(
      "[cross-space-concept-stats] entity lookup failed:",
      entityErr.message,
    );
    return out;
  }
  const entities = ((entityRows ?? []) as Array<{
    name: string;
    space_id: string;
  }>) ?? [];
  if (entities.length === 0) return out;

  // ── 3. Aggregate. For each entity, slugify its name; if the slug is
  //      in our target set, fold it into the per-slug accumulator. ──
  type Agg = {
    space_ids: Set<string>;
    entity_count: number;
    sample_name: string;
  };
  const agg = new Map<string, Agg>();
  for (const e of entities) {
    if (!e.name) continue;
    const slug = slugifyConcept(e.name);
    if (!slug || !targetSlugs.has(slug)) continue;
    const cell = agg.get(slug) ?? {
      space_ids: new Set<string>(),
      entity_count: 0,
      sample_name: e.name,
    };
    cell.space_ids.add(e.space_id);
    cell.entity_count += 1;
    agg.set(slug, cell);
  }

  // ── 4. Materialize as Map<slug, stats>. Slugs with zero matches
  //      are naturally omitted (never added to `agg`). ──
  for (const [slug, cell] of agg.entries()) {
    out.set(slug, {
      space_count: cell.space_ids.size,
      entity_count: cell.entity_count,
      sample_name: cell.sample_name,
    });
  }
  return out;
}
