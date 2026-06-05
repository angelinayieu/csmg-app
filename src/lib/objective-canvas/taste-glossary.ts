// ── taste-glossary ──────────────────────────────────────────────────
//
// Fuses the space GLOSSARY (term → context-specific definition + provenance)
// with the REFERENCES the user fed in (`context_concept` rows — see
// context-frontier.ts), so a term's meaning is DEEPENED by the material the
// user actually supplied, and so every surface can SHOW whose taste shaped
// each term.
//
// `concept_slug` is the universal join key: glossary terms, objective
// annotations, and context_concepts all live in the same slug namespace.
// Evidence for a term = the context_concepts whose slug matches it. Provenance
// = a 3-tier read of WHO owns the meaning: you (pinned/authored) > grounded
// (backed by refs you added) > ai (model-suggested, untouched).
//
// Pure read + soft-fail: any error → terms pass through with empty evidence
// and a source-only provenance, so callers behave exactly as before.

import type { GlossaryTerm } from "./generate-glossary";
import { slugifyConcept } from "./normalize-annotations";

/** yours = you pinned / authored it; grounded = backed by references you
 *  added; ai = model-suggested, you haven't touched it. Drives the visible
 *  provenance cue AND the "honor exactly" hint in the LLM preamble. */
export type TasteProvenance = "yours" | "grounded" | "ai";

export interface TasteEvidence {
  /** reference = material to honor; prior_idea = your own earlier thinking. */
  kind: "reference" | "prior_idea";
  /** The concept title — the chip label. */
  label: string;
  /** One line of what it said — the concept summary. */
  detail: string;
}

export interface TasteEnrichedTerm extends GlossaryTerm {
  provenance: TasteProvenance;
  /** Reference rows (context_concepts) that share this term's concept_slug. */
  evidence: TasteEvidence[];
}

/** Stable slug for a glossary term (prefers the stored concept_slug). */
export function termSlug(t: { concept_slug?: string; term: string }): string {
  return (t.concept_slug && t.concept_slug.trim()) || slugifyConcept(t.term);
}

/** 3-tier provenance from authority + whether the user grounded it. Pure. */
export function provenanceOf(
  term: Pick<GlossaryTerm, "source" | "pinned">,
  hasEvidence: boolean,
): TasteProvenance {
  if (term.pinned || term.source === "user") return "yours";
  // grounded = backed by references the user added, OR derived from the user's
  // own objective phrasing (annotation lens). entity-mined / llm jargon the
  // user hasn't touched reads as "ai" until they ground or pin it. The client
  // inline cue (glossary-text.tsx) mirrors this exact rule.
  if (hasEvidence || term.source === "annotation") return "grounded";
  return "ai";
}

/**
 * Attach reference evidence to each glossary term by concept_slug and stamp a
 * provenance. One query against this space's `context_concept` rows; soft-fails
 * to bare passthrough.
 */
export async function enrichGlossaryWithEvidence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  terms: GlossaryTerm[],
): Promise<TasteEnrichedTerm[]> {
  if (terms.length === 0) return [];
  const passthrough = (): TasteEnrichedTerm[] =>
    terms.map((t) => ({
      ...t,
      provenance: provenanceOf(t, false),
      evidence: [],
    }));
  try {
    const { data: rows } = await db
      .from("library_objects")
      .select("title, summary, content_snapshot")
      .eq("space_id", spaceId)
      .eq("object_type", "context_concept");

    // Group the user's reference concepts by slug.
    const bySlug = new Map<string, TasteEvidence[]>();
    for (const r of (rows as Array<{
      title: string;
      summary: string | null;
      content_snapshot?: unknown;
    }> | null) ?? []) {
      const snap =
        r.content_snapshot && typeof r.content_snapshot === "object"
          ? (r.content_snapshot as { concept_slug?: unknown; role?: unknown })
          : null;
      const slug = snap && typeof snap.concept_slug === "string" ? snap.concept_slug : "";
      if (!slug) continue;
      const kind: TasteEvidence["kind"] =
        snap && snap.role === "reference" ? "reference" : "prior_idea";
      const arr = bySlug.get(slug) ?? [];
      arr.push({ kind, label: r.title, detail: (r.summary ?? "").slice(0, 160) });
      bySlug.set(slug, arr);
    }

    return terms.map((t) => {
      const ev = bySlug.get(termSlug(t)) ?? [];
      return { ...t, provenance: provenanceOf(t, ev.length > 0), evidence: ev };
    });
  } catch {
    return passthrough();
  }
}

/**
 * Render the taste-deepened glossary block for an LLM preamble. Each term
 * carries its definition, a marker of the user's authority over it ("yours —
 * honor exactly"), and the references that ground it — so generation reasons
 * WITH the material the user fed in, not just the bare definition.
 */
export function renderTasteGlossaryBlock(enriched: TasteEnrichedTerm[]): string {
  const lines = enriched
    .filter((t) => t.term && t.definition)
    .map((t) => {
      const tag =
        t.provenance === "yours"
          ? " [yours — honor this meaning exactly]"
          : t.provenance === "grounded"
            ? " [grounded in the user's references]"
            : "";
      let line = `- ${t.term}: ${t.definition}${tag}`;
      if (t.evidence.length > 0) {
        const refs = t.evidence
          .slice(0, 3)
          .map((e) => e.detail || e.label)
          .filter(Boolean);
        if (refs.length > 0) {
          line += `\n    ↳ from the user's material: ${refs.join("; ")}`;
        }
      }
      return line;
    });
  return lines.length > 0
    ? "Defined terms (use these EXACT meanings; never silently redefine):\n" +
        lines.join("\n")
    : "";
}

// ── Cross-application taste (P3.0 — Option C, see CROSS_SPACE_TASTE_SPEC.md) ──
//
// "Define once, reuse across apps." A term the user PINNED in one space carries
// their meaning into every other space that uses the same concept_slug — no
// embeddings, no canonical_concepts, no revival of the deprecated rails. Just a
// read of the user's other glossaries + a seed at build time, so the persisted
// glossary already holds the inherited meaning (the hot reasoning path pays
// nothing extra). Same-space pinned ALWAYS wins; this only upgrades weak terms.

export interface CrossSpaceDef {
  definition: string;
  sourceSpaceId: string;
  sourceSpaceTitle: string;
  /** Most-recent pinned wins across the user's spaces. */
  updatedAt: string;
  /** Distinct OTHER spaces where this slug is the user's local taste — powers
   *  the "also defined by you in N spaces" reuse signal (P3.1). */
  spaceCount: number;
}

/**
 * For the given slugs, find the user's PINNED / user-authored definition of the
 * same slug in their OTHER (non-archived) spaces. Returns the most-recent one
 * per slug. Bounded + soft-fail → empty map (callers behave as before). Meant
 * for the rare glossary-BUILD path, not per-read hot paths.
 */
export async function loadCrossSpaceGlossary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  currentSpaceId: string,
  slugs: string[],
): Promise<Map<string, CrossSpaceDef>> {
  const out = new Map<string, CrossSpaceDef>();
  const counts = new Map<string, Set<string>>(); // slug → distinct space ids
  const want = new Set(slugs.filter((s) => s && s.length > 0));
  if (want.size === 0) return out;
  try {
    const { data: spaces } = await db
      .from("spaces")
      .select("id, name, primary_goal, synthesis_data")
      .eq("user_id", userId)
      .eq("archived", false)
      .neq("id", currentSpaceId)
      .limit(40);
    for (const s of (spaces as Array<{
      id: string;
      name: string | null;
      primary_goal: string | null;
      synthesis_data: { glossary?: unknown } | null;
    }> | null) ?? []) {
      const g = s.synthesis_data?.glossary;
      if (!Array.isArray(g)) continue;
      const title = String(s.name ?? s.primary_goal ?? "another space").slice(0, 80);
      for (const t of g as GlossaryTerm[]) {
        // Only the user's OWN authored taste travels — never AI/annotation
        // guesses, and never an already-INHERITED term (avoids transitive
        // A→B→C chains + keeps attribution pointing at the true origin).
        const isLocalTaste =
          t?.pinned || (t?.source === "user" && !t?.cross_space_origin);
        if (!isLocalTaste) continue;
        if (!t.term || !t.definition) continue;
        const slug = termSlug(t);
        if (!want.has(slug)) continue;
        // Count every space this slug is local taste in (for the reuse pill).
        const set = counts.get(slug) ?? new Set<string>();
        set.add(s.id);
        counts.set(slug, set);
        // Keep the most-recent pinned definition (for inheritance seeding).
        const updatedAt = t.updated_at ?? "";
        const prev = out.get(slug);
        if (!prev || updatedAt > prev.updatedAt) {
          out.set(slug, {
            definition: t.definition,
            sourceSpaceId: s.id,
            sourceSpaceTitle: title,
            updatedAt,
            spaceCount: 0,
          });
        }
      }
    }
    for (const [slug, def] of out) {
      def.spaceCount = counts.get(slug)?.size ?? 0;
    }
  } catch {
    /* soft-fail — no cross-space inheritance this build */
  }
  return out;
}

/**
 * Upgrade weak terms (anything NOT same-space pinned/user-authored) with the
 * user's cross-space pinned meaning. The inherited term becomes source:'user'
 * (so it reads as "yours" + outranks annotation/entity on the next merge) but
 * is left UNPINNED, so a local edit still wins and the next rebuild refreshes
 * it. Pure; no-op when there's nothing to inherit.
 */
export function applyCrossSpaceSeeds(
  terms: GlossaryTerm[],
  crossSpace: Map<string, CrossSpaceDef>,
): GlossaryTerm[] {
  if (crossSpace.size === 0) return terms;
  return terms.map((t) => {
    // Local taste wins + is never overwritten: a pinned term, or a user-authored
    // term that is NOT itself an inheritance. Inherited terms (source 'user' +
    // cross_space_origin, unpinned) DO refresh from the latest cross-space pin.
    const locallyOwned =
      t.pinned || (t.source === "user" && !t.cross_space_origin);
    if (locallyOwned) return t;
    const x = crossSpace.get(termSlug(t));
    if (!x || x.definition.trim() === (t.definition ?? "").trim()) return t;
    return {
      ...t,
      definition: x.definition,
      source: "user",
      cross_space_origin: x.sourceSpaceId,
      cross_space_origin_title: x.sourceSpaceTitle,
    };
  });
}
