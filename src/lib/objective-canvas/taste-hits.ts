// ── taste-hits ──────────────────────────────────────────────────────
//
// The "taste receipt" primitive: given AI-generated text + the space's
// enriched glossary, return the USER-SHAPED terms that actually appear
// in the text. This is what makes agent transparency real — instead of
// trusting the agent honored the user's vocabulary, the user sees the
// receipt under every AI output.
//
// Filters out AI-only terms (provenance='ai' or absent) so the receipt
// only reflects vocabulary the user has authority over (yours/grounded).
// Word-boundary matched so substrings don't false-positive ("cache" in
// "caches" matches; "cache" in "cacheable" does NOT).
//
// Pure. No fetch, no state. Surfaces (drawer, oc-card shape, prototype
// caption, brief footer) call this with the same shape and render the
// same receipt visual.

/** A glossary term as the enriched endpoint returns it. */
export interface TasteTermLite {
  term: string;
  aliases?: string[];
  provenance?: "yours" | "grounded" | "ai";
  definition?: string;
  concept_slug?: string;
}

/** One receipt entry: a term the AI used, tagged with whose taste shaped it. */
export interface TasteHit {
  term: string;
  /** True = user-authored / pinned ("yours"); false = grounded by sources. */
  yours: boolean;
}

/**
 * Compute the taste receipt. Word-boundary match against term + aliases,
 * capped so a long card doesn't list 30 hits. AI-only terms are skipped —
 * the receipt is about the user's authority, not the model's.
 */
export function tasteHitsFor(
  text: string,
  terms: TasteTermLite[],
  cap = 6,
): TasteHit[] {
  const hay = text.toLowerCase();
  if (!hay.trim() || terms.length === 0) return [];
  const out: TasteHit[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    if (!t.term || t.provenance === "ai" || !t.provenance) continue;
    const surfaces = [t.term, ...(t.aliases ?? [])]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const hit = surfaces.some((s) => {
      const i = hay.indexOf(s);
      if (i === -1) return false;
      const before = i === 0 ? " " : hay[i - 1];
      const after = i + s.length >= hay.length ? " " : hay[i + s.length];
      return /[^a-z0-9]/.test(before) && /[^a-z0-9]/.test(after);
    });
    const key = t.term.toLowerCase();
    if (hit && !seen.has(key)) {
      seen.add(key);
      out.push({ term: t.term, yours: t.provenance === "yours" });
      if (out.length >= cap) break;
    }
  }
  return out;
}
